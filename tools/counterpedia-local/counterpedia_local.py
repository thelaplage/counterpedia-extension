#!/usr/bin/env python3
"""Counterpedia Local — team-beta supervisor and browser pairing service.

Operational boundary only: this starts the existing acquisition and authoring
processes, pairs one Chrome extension instance to local transport, exposes one
explicit Wikipedia-reference discovery proxy and one explicit discovered-source
capture proxy into the existing acquisition producer, and reports bounded health.
It performs no admission, publication, verification, standing, or corpus writes.

Security posture:
- binds only to 127.0.0.1;
- pairing accepts only chrome-extension:// origins whose runtime id matches the
  request body;
- Wikipedia harvesting and discovered-source capture accept only the currently
  paired extension origin and run only after separate explicit browser actions;
- discovered-source capture delegates to the producer-owned counterpedia-capture-url
  command; this companion never fabricates BrowserPageCapture objects or receipts;
- acquisition transport credentials are generated in memory and never logged;
- OPENAI_API_KEY is read from this process environment only and never returned;
- pairing values are transport/runtime configuration, never epistemic authority.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = "127.0.0.1"
COMPANION_PORT = 8790
ACQUISITION_PORT = 8787
AUTHORING_PORT = 8788
DEFAULT_STORE_ROOT = Path.home() / ".counterpedia" / "acquisition"
LOCAL_ROOT = Path.home() / ".counterpedia" / "local"
LOG_ROOT = LOCAL_ROOT / "logs"
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")
CHROME_ORIGIN_RE = re.compile(r"^chrome-extension://([a-p]{32})$")
MAX_WIKIPEDIA_HARVEST_BYTES = 5_000_000
MAX_CAPTURE_RESULT_BYTES = 1_000_000
_CAPTURE_RESULT_KEYS = {
    "tool",
    "surface_schema",
    "capture_status",
    "capture_id",
    "source_id",
    "source_locator",
    "captured_object_address",
    "byte_count",
    "failure_detail",
    "capture_receipt",
}
_FORBIDDEN_AUTHORITY_KEYS = {
    "standing",
    "admitted",
    "admission",
    "published",
    "publication",
    "verified",
    "verification",
    "support_type",
    "governance_state",
    "authority",
    "authorized",
}


def default_acquisition_dir() -> Path:
    configured = os.environ.get("COUNTERPEDIA_ACQUISITION_DIR")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "Developer" / "repos" / "counterpedia-acquisition"


def default_authoring_dir() -> Path:
    configured = os.environ.get("COUNTERPEDIA_AUTHORING_DIR")
    if configured:
        return Path(configured).expanduser()
    worktree = Path.home() / "Developer" / "worktrees" / "counterpedia-authoring-live-source"
    if worktree.exists():
        return worktree
    return Path.home() / "Developer" / "repos" / "counterpedia-authoring"


def port_open(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=0.25):
            return True
    except OSError:
        return False


def http_health(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=0.5) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError):
        return False


def safe_tail(path: Path, limit: int = 12) -> list[str]:
    """Bounded log tail with obvious secret-bearing lines suppressed."""
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    safe: list[str] = []
    for line in lines[-limit:]:
        lowered = line.lower()
        if any(marker in lowered for marker in ("api_key", "authorization", "transport_token")):
            safe.append("[redacted secret-bearing log line]")
        else:
            safe.append(line[-500:])
    return safe


def contains_forbidden_authority(value: Any) -> bool:
    if isinstance(value, list):
        return any(contains_forbidden_authority(item) for item in value)
    if not isinstance(value, dict):
        return False
    for key, child in value.items():
        if str(key).lower() in _FORBIDDEN_AUTHORITY_KEYS:
            return True
        if contains_forbidden_authority(child):
            return True
    return False


@dataclass
class ManagedProcess:
    name: str
    process: subprocess.Popen[str] | None = None
    log_handle: Any = None

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop(self) -> None:
        proc = self.process
        if proc is None or proc.poll() is not None:
            self.process = None
            return
        try:
            proc.terminate()
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
        finally:
            self.process = None
            if self.log_handle is not None:
                try:
                    self.log_handle.close()
                except OSError:
                    pass
                self.log_handle = None


class LocalSupervisor:
    def __init__(self, acquisition_dir: Path, authoring_dir: Path, store_root: Path) -> None:
        self.acquisition_dir = acquisition_dir
        self.authoring_dir = authoring_dir
        self.store_root = store_root
        self.acquisition = ManagedProcess("acquisition")
        self.authoring = ManagedProcess("authoring")
        self._lock = threading.RLock()
        self._paired_extension_id: str | None = None

    @property
    def acquisition_log(self) -> Path:
        return LOG_ROOT / "acquisition.log"

    @property
    def authoring_log(self) -> Path:
        return LOG_ROOT / "authoring.log"

    def dependency_status(self) -> dict[str, Any]:
        acq_launcher = self.acquisition_dir / "scripts" / "run_acquisition_http.py"
        acq_python = self.acquisition_dir / ".venv" / "bin" / "python"
        acq_mcp = self.acquisition_dir / ".venv" / "bin" / "counterpedia-acquisition-mcp"
        wiki_harvester = (
            self.acquisition_dir / ".venv" / "bin" / "counterpedia-wikipedia-harvest"
        )
        capture_url_cli = self.acquisition_dir / ".venv" / "bin" / "counterpedia-capture-url"
        author_cmd = self.authoring_dir / ".venv" / "bin" / "counterpedia-authoring-live-source"
        return {
            "acquisition_dir": str(self.acquisition_dir),
            "acquisition_launcher_present": acq_launcher.is_file(),
            "acquisition_python_present": acq_python.is_file(),
            "acquisition_mcp_present": acq_mcp.is_file(),
            "wikipedia_harvester_present": wiki_harvester.is_file(),
            "capture_url_cli_present": capture_url_cli.is_file(),
            "authoring_dir": str(self.authoring_dir),
            "authoring_launcher_present": author_cmd.is_file(),
            "openai_key_configured": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
        }

    def status(self) -> dict[str, Any]:
        return {
            "service": "counterpedia-local",
            "version": "0.1",
            "authority_posture": "transport_supervisor_only",
            "admission": "not_performed",
            "paired": self._paired_extension_id is not None,
            "paired_extension_id": self._paired_extension_id,
            "acquisition": {
                "ready": http_health(f"http://{HOST}:{ACQUISITION_PORT}/healthz"),
                "port": ACQUISITION_PORT,
                "durable_store": str(self.store_root),
                "process_managed": self.acquisition.running(),
            },
            "authoring": {
                "ready": port_open(AUTHORING_PORT),
                "port": AUTHORING_PORT,
                "process_managed": self.authoring.running(),
            },
            "dependencies": self.dependency_status(),
        }

    def diagnostics(self) -> dict[str, Any]:
        data = self.status()
        data["logs"] = {
            "acquisition": safe_tail(self.acquisition_log),
            "authoring": safe_tail(self.authoring_log),
        }
        return data

    @staticmethod
    def wait_ready(check: Any, proc: subprocess.Popen[str], name: str) -> None:
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"{name} exited before becoming ready")
            if check():
                return
            time.sleep(0.15)
        raise RuntimeError(f"{name} did not become ready")

    def start_acquisition(self, extension_id: str, token: str) -> None:
        self.acquisition.stop()
        acq_python = self.acquisition_dir / ".venv" / "bin" / "python"
        launcher = self.acquisition_dir / "scripts" / "run_acquisition_http.py"
        if not acq_python.is_file() or not launcher.is_file():
            raise RuntimeError(
                "Counterpedia acquisition is not installed in the expected team-beta location"
            )

        LOG_ROOT.mkdir(parents=True, exist_ok=True)
        self.store_root.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(
            {
                "CP_ACQUISITION_ALLOWED_ORIGIN": f"chrome-extension://{extension_id}",
                "CP_ACQUISITION_TRANSPORT_TOKEN": token,
                "CP_ACQUISITION_HTTP_STORE_ROOT": str(self.store_root),
                "CP_ACQUISITION_HTTP_HOST": HOST,
                "CP_ACQUISITION_HTTP_PORT": str(ACQUISITION_PORT),
                "CP_ACQUISITION_HTTP_USER_AGENT": os.environ.get(
                    "CP_ACQUISITION_HTTP_USER_AGENT",
                    "Counterpedia Local/0.1 (explicit source capture)",
                ),
            }
        )
        handle = self.acquisition_log.open("a", encoding="utf-8")
        handle.write("\n--- Counterpedia Local starting acquisition ---\n")
        handle.flush()
        proc = subprocess.Popen(
            [str(acq_python), str(launcher)],
            cwd=self.acquisition_dir,
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        self.acquisition.process = proc
        self.acquisition.log_handle = handle
        self.wait_ready(
            lambda: http_health(f"http://{HOST}:{ACQUISITION_PORT}/healthz"),
            proc,
            "acquisition",
        )

    def start_authoring(self) -> bool:
        key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not key:
            return False

        self.authoring.stop()
        author_cmd = self.authoring_dir / ".venv" / "bin" / "counterpedia-authoring-live-source"
        acq_mcp = self.acquisition_dir / ".venv" / "bin" / "counterpedia-acquisition-mcp"
        if not author_cmd.is_file() or not acq_mcp.is_file():
            return False

        LOG_ROOT.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["OPENAI_API_KEY"] = key
        handle = self.authoring_log.open("a", encoding="utf-8")
        handle.write("\n--- Counterpedia Local starting authoring ---\n")
        handle.flush()
        proc = subprocess.Popen(
            [
                str(author_cmd),
                "--acquisition-command",
                str(acq_mcp),
                "--store-root",
                str(self.store_root),
                "--port",
                str(AUTHORING_PORT),
            ],
            cwd=self.authoring_dir,
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        self.authoring.process = proc
        self.authoring.log_handle = handle
        try:
            self.wait_ready(lambda: port_open(AUTHORING_PORT), proc, "authoring")
        except RuntimeError:
            return False
        return True

    def pair(self, extension_id: str) -> dict[str, Any]:
        if not EXTENSION_ID_RE.fullmatch(extension_id):
            raise ValueError("invalid Chrome extension id")
        with self._lock:
            token = secrets.token_urlsafe(32)
            self.start_acquisition(extension_id, token)
            authoring_ready = self.start_authoring()
            self._paired_extension_id = extension_id
            return {
                "pairing_schema": "counterpedia.local_pairing.v0.1",
                "acquisition_base_url": f"http://{HOST}:{ACQUISITION_PORT}",
                "authoring_base_url": f"http://{HOST}:{AUTHORING_PORT}",
                "acquisition_transport_token": token,
                "authoring_transport_token": "local-authoring-dev",
                "authoring_ready": authoring_ready,
                "authority_posture": "transport_configuration_only",
                "admission": "not_performed",
            }

    def is_paired_extension(self, extension_id: str | None) -> bool:
        with self._lock:
            return extension_id is not None and extension_id == self._paired_extension_id

    def harvest_wikipedia(self, page: str) -> dict[str, Any]:
        if not isinstance(page, str) or not page.strip() or len(page) > 4096:
            raise ValueError("Wikipedia page must be a bounded non-empty URL")
        harvester = (
            self.acquisition_dir / ".venv" / "bin" / "counterpedia-wikipedia-harvest"
        )
        if not harvester.is_file():
            raise RuntimeError("Counterpedia Wikipedia harvester is not installed")

        user_agent = os.environ.get(
            "CP_WIKIPEDIA_HARVEST_USER_AGENT",
            "Counterpedia Local/0.1 (explicit Wikipedia reference discovery)",
        ).strip()
        if not user_agent:
            raise RuntimeError("Wikipedia harvest User-Agent is not configured")

        try:
            completed = subprocess.run(
                [str(harvester), page, "--user-agent", user_agent],
                cwd=self.acquisition_dir,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Wikipedia reference harvest timed out") from exc
        except OSError as exc:
            raise RuntimeError("Wikipedia reference harvester could not start") from exc

        if completed.returncode != 0:
            raise RuntimeError("Wikipedia reference harvest failed")
        encoded = completed.stdout.encode("utf-8")
        if not encoded or len(encoded) > MAX_WIKIPEDIA_HARVEST_BYTES:
            raise RuntimeError("Wikipedia reference harvest output size refused")
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Wikipedia reference harvester returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("Wikipedia reference harvester returned a non-object")
        if payload.get("schema_version") != "acquisition.wikipedia_reference_manifest.v0.1":
            raise RuntimeError("Wikipedia reference harvester returned an unexpected schema")
        boundary = payload.get("boundary")
        if not isinstance(boundary, dict):
            raise RuntimeError("Wikipedia reference harvester omitted its discovery boundary")
        if (
            boundary.get("article_prose_copied") is not False
            or boundary.get("wikipedia_support_inferred") is not False
            or boundary.get("capture_receipts_emitted") is not False
            or boundary.get("srs_receipts_emitted") is not False
            or boundary.get("governed_declaration_bound") is not False
            or boundary.get("srs_binding_state") != "unbound_discovery"
        ):
            raise RuntimeError("Wikipedia reference harvester crossed its discovery boundary")
        return payload

    def capture_url(self, url: str) -> dict[str, Any]:
        if not isinstance(url, str) or not url.strip() or len(url) > 4096:
            raise ValueError("capture URL must be a bounded non-empty string")
        capture_cli = self.acquisition_dir / ".venv" / "bin" / "counterpedia-capture-url"
        if not capture_cli.is_file():
            raise RuntimeError("Counterpedia explicit URL capture producer is not installed")
        user_agent = os.environ.get(
            "CP_DISCOVERED_SOURCE_CAPTURE_USER_AGENT",
            "Counterpedia Local/0.1 (explicit discovered-source capture)",
        ).strip()
        if not user_agent:
            raise RuntimeError("discovered-source capture User-Agent is not configured")

        try:
            completed = subprocess.run(
                [
                    str(capture_cli),
                    url,
                    "--store-root",
                    str(self.store_root),
                    "--user-agent",
                    user_agent,
                ],
                cwd=self.acquisition_dir,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=45,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("explicit source capture timed out") from exc
        except OSError as exc:
            raise RuntimeError("explicit source capture producer could not start") from exc

        if completed.returncode != 0:
            raise RuntimeError("explicit source capture producer failed")
        encoded = completed.stdout.encode("utf-8")
        if not encoded or len(encoded) > MAX_CAPTURE_RESULT_BYTES:
            raise RuntimeError("explicit source capture output size refused")
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("explicit source capture producer returned invalid JSON") from exc
        if not isinstance(payload, dict) or set(payload) != _CAPTURE_RESULT_KEYS:
            raise RuntimeError("explicit source capture producer returned an unexpected shape")
        if contains_forbidden_authority(payload):
            raise RuntimeError("explicit source capture producer crossed the authority boundary")
        if payload.get("tool") != "acquisition.capture_url":
            raise RuntimeError("explicit source capture producer returned an unexpected tool")
        if payload.get("surface_schema") != "acquisition.mcp_surface.v0.1":
            raise RuntimeError("explicit source capture producer returned an unexpected schema")
        status = payload.get("capture_status")
        if status not in {"captured", "capture_failed"}:
            raise RuntimeError("explicit source capture producer returned an unexpected status")
        if payload.get("source_locator") != url:
            raise RuntimeError("explicit source capture producer returned a mismatched source locator")
        receipt = payload.get("capture_receipt")
        address = payload.get("captured_object_address")
        if status == "captured":
            if not isinstance(receipt, dict) or not isinstance(address, str) or not address:
                raise RuntimeError("captured producer result omitted its receipt/address")
            if payload.get("capture_id") != receipt.get("capture_id"):
                raise RuntimeError("captured producer result has mismatched capture identity")
            if receipt.get("source_locator") != url:
                raise RuntimeError("captured producer receipt has mismatched source locator")
        elif receipt is not None or address is not None:
            raise RuntimeError("capture_failed producer result carried a receipt/address")
        return payload

    def restart_authoring(self) -> bool:
        with self._lock:
            return self.start_authoring()

    def stop_all(self) -> None:
        with self._lock:
            self.authoring.stop()
            self.acquisition.stop()


def status_page() -> bytes:
    return b"""<!doctype html>
<meta charset="utf-8">
<title>Counterpedia Local</title>
<style>
body{font:15px system-ui,-apple-system,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#17211f}
h1{margin-bottom:4px}.sub{color:#53615e;margin-top:0}.card{border:1px solid #d7dfdc;border-radius:12px;padding:18px;margin:16px 0}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eef1f0}.row:last-child{border:0}
.ok{color:#177245}.bad{color:#a13c32}button{font:inherit;border:1px solid #8ca09a;border-radius:8px;padding:9px 13px;background:white;cursor:pointer}
pre{white-space:pre-wrap;background:#f7f9f8;padding:12px;border-radius:8px;font-size:12px}
</style>
<h1>Counterpedia Local</h1>
<p class="sub">Local capture + authoring supervisor. No admission or publication.</p>
<div class="card">
  <div class="row"><span>Browser pairing</span><strong id="paired">Checking...</strong></div>
  <div class="row"><span>Source capture</span><strong id="acq">Checking...</strong></div>
  <div class="row"><span>Historical authoring</span><strong id="author">Checking...</strong></div>
  <div class="row"><span>OpenAI key</span><strong id="key">Checking...</strong></div>
</div>
<div class="card">
  <strong>Use Counterpedia</strong>
  <p>Open the Counterpedia browser side panel and choose <b>Connect Counterpedia Local</b>. The browser configures itself; no extension ID, token, port, or DevTools setup is required.</p>
  <button id="restart">Restart authoring</button>
  <button id="diag">Copy diagnostic report</button>
  <pre id="detail"></pre>
</div>
<script>
const el=id=>document.getElementById(id);
function setState(node,ok,yes,no){node.textContent=ok?yes:no;node.className=ok?'ok':'bad'}
async function refresh(){try{const s=await fetch('/v0/status').then(r=>r.json());setState(el('paired'),s.paired,'Browser connected','Not connected');setState(el('acq'),s.acquisition.ready,'Capture ready','Not ready');setState(el('author'),s.authoring.ready,'Authoring ready','Not ready');setState(el('key'),s.dependencies.openai_key_configured,'Configured','Needs setup');el('detail').textContent=s.dependencies.openai_key_configured?'':'Start Counterpedia Local with OPENAI_API_KEY configured to enable authoring.';}catch(e){el('detail').textContent='Counterpedia Local status unavailable: '+e}}
el('restart').onclick=async()=>{await fetch('/v0/restart-authoring',{method:'POST'});refresh()};
el('diag').onclick=async()=>{const d=await fetch('/v0/diagnostics').then(r=>r.json());await navigator.clipboard.writeText(JSON.stringify(d,null,2));el('detail').textContent='Safe diagnostic report copied. Secrets are not included.'};
refresh();setInterval(refresh,2000);
</script>"""


class Handler(BaseHTTPRequestHandler):
    supervisor: LocalSupervisor

    def log_message(self, format: str, *args: Any) -> None:
        return

    def extension_origin_id(self) -> str | None:
        origin = self.headers.get("Origin")
        if not origin:
            return None
        match = CHROME_ORIGIN_RE.fullmatch(origin)
        return match.group(1) if match else None

    def add_cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin and CHROME_ORIGIN_RE.fullmatch(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.add_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length < 2 or length > 4096:
            raise ValueError("request body size refused")
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self.extension_origin_id() is None:
            self.send_error(403)
            return
        self.send_response(204)
        self.add_cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/":
            body = status_page()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path in {"/healthz", "/v0/status"}:
            self.send_json(200, self.supervisor.status())
            return
        if self.path == "/v0/diagnostics":
            self.send_json(200, self.supervisor.diagnostics())
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/v0/pair":
            origin_id = self.extension_origin_id()
            if origin_id is None:
                self.send_json(403, {"error": "extension_origin_required"})
                return
            try:
                data = self.read_json()
                if set(data) != {"extension_id"}:
                    raise ValueError("pair request accepts only extension_id")
                extension_id = data.get("extension_id")
                if extension_id != origin_id:
                    raise ValueError("extension id does not match request Origin")
                paired = self.supervisor.pair(str(extension_id))
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json(400, {"error": "invalid_pair_request", "detail": str(exc)})
                return
            except RuntimeError as exc:
                self.send_json(503, {"error": "local_service_start_failed", "detail": str(exc)})
                return
            self.send_json(200, paired)
            return

        if self.path == "/v0/wikipedia-harvest":
            origin_id = self.extension_origin_id()
            if not self.supervisor.is_paired_extension(origin_id):
                self.send_json(403, {"error": "paired_extension_origin_required"})
                return
            try:
                data = self.read_json()
                if set(data) != {"page"}:
                    raise ValueError("Wikipedia harvest request accepts only page")
                page = data.get("page")
                if not isinstance(page, str):
                    raise ValueError("Wikipedia harvest page must be a string")
                manifest = self.supervisor.harvest_wikipedia(page)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json(400, {"error": "invalid_wikipedia_harvest_request", "detail": str(exc)})
                return
            except RuntimeError as exc:
                self.send_json(503, {"error": "wikipedia_harvest_failed", "detail": str(exc)})
                return
            self.send_json(200, manifest)
            return

        if self.path == "/v0/capture-url":
            origin_id = self.extension_origin_id()
            if not self.supervisor.is_paired_extension(origin_id):
                self.send_json(403, {"error": "paired_extension_origin_required"})
                return
            try:
                data = self.read_json()
                if set(data) != {"url"}:
                    raise ValueError("capture request accepts only url")
                url = data.get("url")
                if not isinstance(url, str):
                    raise ValueError("capture url must be a string")
                result = self.supervisor.capture_url(url)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json(400, {"error": "invalid_capture_url_request", "detail": str(exc)})
                return
            except RuntimeError as exc:
                self.send_json(503, {"error": "capture_url_failed", "detail": str(exc)})
                return
            self.send_json(200, result)
            return

        if self.path == "/v0/restart-authoring":
            try:
                ready = self.supervisor.restart_authoring()
            except RuntimeError as exc:
                self.send_json(503, {"error": "authoring_restart_failed", "detail": str(exc)})
                return
            self.send_json(200, {"authoring_ready": ready})
            return

        self.send_json(404, {"error": "not_found"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Counterpedia Local team beta")
    parser.add_argument("--port", type=int, default=COMPANION_PORT)
    parser.add_argument("--open", action="store_true", help="Open the local status page")
    parser.add_argument("--acquisition-dir", type=Path, default=default_acquisition_dir())
    parser.add_argument("--authoring-dir", type=Path, default=default_authoring_dir())
    parser.add_argument("--store-root", type=Path, default=DEFAULT_STORE_ROOT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.port != COMPANION_PORT:
        print(f"Counterpedia Local v0.1 requires port {COMPANION_PORT}", file=sys.stderr)
        return 2

    supervisor = LocalSupervisor(
        acquisition_dir=args.acquisition_dir.expanduser(),
        authoring_dir=args.authoring_dir.expanduser(),
        store_root=args.store_root.expanduser(),
    )
    Handler.supervisor = supervisor
    server = ThreadingHTTPServer((HOST, args.port), Handler)

    def shutdown(_signum: int, _frame: Any) -> None:
        supervisor.stop_all()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    print(f"Counterpedia Local listening on http://{HOST}:{args.port}", flush=True)
    print("Authority posture: TRANSPORT SUPERVISOR ONLY; admission not performed", flush=True)
    if args.open:
        threading.Timer(0.25, lambda: webbrowser.open(f"http://{HOST}:{args.port}/")).start()

    try:
        server.serve_forever()
    finally:
        supervisor.stop_all()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
