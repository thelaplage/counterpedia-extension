#!/usr/bin/env python3
"""SELF-LOAD0 automated E2E verify.

HEADFUL (real windowed, not --headless) against a self-loaded
Chrome-for-Testing instance, this proves what a manual "load into daily
Chrome" flow could never give an automated gate:

  1. the unpacked extension actually loads (its service worker target is
     present, and is NOT one of Chrome's own component extensions);
  2. the loaded extension id equals the id computed from the manifest "key"
     (i.e. the id really is stable / deterministic, not "it happened to load
     this time");
  3. Counterpedia Local pairs for that extension's Origin (driven the same
     way the extension's own pairing client drives it: POST /v0/pair with an
     Origin header and a JSON body -- see src/lib/localCompanionClient.ts)
     and both capabilities (browser_observation, recovery_assessment) become
     true against the REAL frozen acquisition checkout;
  4. the status projection (what the status page renders) shows
     Connected / Acquisition Ready / Recovery Ready;
  5. teardown releases every port and kills only the processes THIS script
     spawned -- never a foreign process.

This script performs no admission, publication, verification, or standing
claim. It only proves operational self-load + pairing readiness.

Usage:
  COUNTERPEDIA_ACQUISITION_DIR=/private/tmp/cplocalacq0 \\
  COUNTERPEDIA_ACQUISITION_PYTHON="$HOME/Developer/repos/counterpedia-acquisition/.venv-review/bin/python" \\
  python3 tools/counterpedia-local/verify_self_load_e2e.py
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXT_ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import demo_browser as db  # noqa: E402

KEY_PATH = HERE / ".self-load-key.pem"
DIST_DIR = EXT_ROOT / "dist"
COMPANION_PORT = 8790
CDP_PORT = 9922
HEALTH_TIMEOUT_S = 15.0
LOAD_TIMEOUT_S = 15.0
PAIR_TIMEOUT_S = 20.0


class VerifyFailure(RuntimeError):
    pass


def log(msg: str) -> None:
    print(f"[verify] {msg}", flush=True)


def wait_for(predicate, timeout_s: float, description: str, interval_s: float = 0.25):
    deadline = time.monotonic() + timeout_s
    last_exc: Exception | None = None
    while time.monotonic() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except Exception as exc:  # noqa: BLE001 - surfaced on timeout only
            last_exc = exc
        time.sleep(interval_s)
    detail = f" (last error: {last_exc})" if last_exc else ""
    raise VerifyFailure(f"timed out waiting for {description}{detail}")


def http_get_json(url: str, timeout: float = 2.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class ProcessGuard:
    """Tracks every process/dir this script spawns/creates, for guaranteed teardown."""

    def __init__(self) -> None:
        self.processes: list[subprocess.Popen] = []
        self.temp_dirs: list[Path] = []

    def spawn(self, *args, **kwargs) -> subprocess.Popen:
        proc = subprocess.Popen(*args, **kwargs)
        self.processes.append(proc)
        return proc

    def track_dir(self, path: Path) -> Path:
        self.temp_dirs.append(path)
        return path

    def teardown(self) -> None:
        for proc in self.processes:
            if proc.poll() is not None:
                continue
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)
            except Exception:  # noqa: BLE001
                pass
        for d in self.temp_dirs:
            shutil.rmtree(d, ignore_errors=True)


def ensure_dist_built() -> None:
    manifest_path = DIST_DIR / "manifest.json"

    def _has_key() -> bool:
        if not manifest_path.is_file():
            return False
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        return isinstance(data, dict) and isinstance(data.get("key"), str) and bool(data["key"])

    if _has_key():
        return
    # Covers both "dist/ missing" and "dist/manifest.json present but is the
    # production manifest (no deterministic-id key)" -- e.g. a plain `vite
    # build` (without the `cp manifest.authoring-dev.json dist/manifest.json`
    # step) was run afterwards and left the wrong manifest in place.
    log("dist/manifest.json missing or lacks the self-load 'key' -- (re)building authoring-dev...")
    subprocess.run(["npm", "run", "build:authoring-dev"], cwd=EXT_ROOT, check=True)
    if not _has_key():
        raise VerifyFailure(
            "npm run build:authoring-dev did not produce a dist/manifest.json with a 'key' field"
        )


def compute_expected_extension_id() -> str:
    if not KEY_PATH.is_file():
        raise VerifyFailure(
            f"self-load private key not found at {KEY_PATH}. Generate it before running verify."
        )
    return db.compute_stable_extension_id_from_pem(KEY_PATH.read_bytes())


def start_companion(guard: ProcessGuard, acquisition_dir: str, acquisition_python: str) -> Path:
    store_root = guard.track_dir(Path(tempfile.mkdtemp(prefix="cpselfload0-store-")))
    env = os.environ.copy()
    env["COUNTERPEDIA_ACQUISITION_DIR"] = acquisition_dir
    env["COUNTERPEDIA_ACQUISITION_PYTHON"] = acquisition_python
    log(f"starting Counterpedia Local companion (store={store_root})...")
    log_path = guard.track_dir(Path(tempfile.mkdtemp(prefix="cpselfload0-logs-"))) / "companion.log"
    log_handle = open(log_path, "w", encoding="utf-8")
    proc = guard.spawn(
        [sys.executable, str(HERE / "counterpedia_local_operator.py"), "--store-root", str(store_root)],
        cwd=str(HERE),
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )

    def _healthy():
        if proc.poll() is not None:
            raise VerifyFailure(f"companion process exited early (see {log_path})")
        try:
            payload = http_get_json(f"http://127.0.0.1:{COMPANION_PORT}/healthz", timeout=0.5)
        except (OSError, urllib.error.URLError):
            return None
        return payload if payload.get("service") == "counterpedia-local" else None

    wait_for(_healthy, HEALTH_TIMEOUT_S, "Counterpedia Local companion /healthz")
    log("companion healthy.")
    return store_root


def start_demo_browser(guard: ProcessGuard, browser_path: Path) -> Path:
    profile_dir = guard.track_dir(Path(tempfile.mkdtemp(prefix="cpselfload0-profile-")))
    # Default: HEADFUL, matching the real double-click demo path exactly (no
    # --headless, no --enable-automation, no infobar). SELF-LOAD0 explicitly
    # wants this proof to run against the same real windowed browser a demo
    # uses, not a synthetic headless mode.
    #
    # COUNTERPEDIA_VERIFY_HEADLESS=1 is an explicit, opt-in escape hatch for
    # environments with no WindowServer/display attached to the process that
    # spawns Chrome (e.g. certain sandboxed CI/agent shells) -- in such
    # environments headful Chrome-for-Testing never binds its
    # --remote-debugging-port at all (verified empirically: the process
    # starts, GPU/renderer helpers spawn, but no CDP port opens), which is an
    # environment constraint, not something --headless=new should silently
    # paper over on a real desktop. Never enabled unless explicitly requested.
    headless = os.environ.get("COUNTERPEDIA_VERIFY_HEADLESS", "").strip() == "1"
    mode = "HEADLESS (COUNTERPEDIA_VERIFY_HEADLESS=1 override)" if headless else "HEADFUL"
    log(f"launching demo browser {mode} (profile={profile_dir})...")
    argv = [
        str(browser_path),
        f"--user-data-dir={profile_dir}",
        f"--load-extension={DIST_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        f"--remote-debugging-port={CDP_PORT}",
        "about:blank",
    ]
    if headless:
        argv.insert(1, "--headless=new")
    guard.spawn(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return profile_dir


def find_extension_service_worker(expected_id: str) -> dict:
    def _find():
        try:
            targets = http_get_json(f"http://127.0.0.1:{CDP_PORT}/json", timeout=0.5)
        except (OSError, urllib.error.URLError):
            return None
        for target in targets:
            url = target.get("url", "")
            if not url.startswith("chrome-extension://"):
                continue
            ext_id = url[len("chrome-extension://") :].split("/", 1)[0]
            if ext_id in db.CHROME_COMPONENT_EXTENSION_IDS:
                continue
            # Our extension's service worker script is background/service-worker.js
            # specifically -- this is the precise oracle (the component-id
            # denylist above is a secondary, documented defense, not the sole
            # filter: unrelated Chrome-internal targets can carry extension
            # ids outside that denylist too).
            if "background/service-worker.js" not in url:
                continue
            return target
        return None

    target = wait_for(_find, LOAD_TIMEOUT_S, "our extension's service worker in CDP /json")
    ext_id = target["url"][len("chrome-extension://") :].split("/", 1)[0]
    if ext_id != expected_id:
        raise VerifyFailure(
            f"loaded extension id {ext_id!r} != computed stable id {expected_id!r}"
        )
    if "background/service-worker.js" not in target["url"]:
        raise VerifyFailure(f"unexpected service worker script: {target['url']}")
    return target


def pair_extension(extension_id: str) -> dict:
    """Drives POST /v0/pair exactly the way src/lib/localCompanionClient.ts does."""
    origin = f"chrome-extension://{extension_id}"
    body = json.dumps({"extension_id": extension_id}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{COMPANION_PORT}/v0/pair",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Origin": origin},
    )

    def _pair():
        try:
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise VerifyFailure(f"pair request failed HTTP {exc.code}: {detail}") from exc

    return wait_for(_pair, PAIR_TIMEOUT_S, "POST /v0/pair to succeed")


def read_status_projection() -> dict:
    return http_get_json(f"http://127.0.0.1:{COMPANION_PORT}/v0/status", timeout=2.0)


def render_status_rows(status: dict) -> list[str]:
    def row(label: str, ok: bool) -> str:
        return f"  {label:<20} {'Ready' if ok else 'Not ready'}" if label != "Browser" else (
            f"  {label:<20} {'Connected' if ok else 'Not connected'}"
        )

    return [
        row("Browser", bool(status.get("paired"))),
        row("Acquisition", bool(status.get("acquisition", {}).get("ready"))),
        row("Recovery", bool(status.get("recovery", {}).get("ready"))),
        row("Authoring", bool(status.get("authoring", {}).get("ready"))),
    ]


def main() -> int:
    acquisition_dir = os.environ.get("COUNTERPEDIA_ACQUISITION_DIR")
    acquisition_python = os.environ.get("COUNTERPEDIA_ACQUISITION_PYTHON")
    if not acquisition_dir or not acquisition_python:
        print(
            "error: set COUNTERPEDIA_ACQUISITION_DIR and COUNTERPEDIA_ACQUISITION_PYTHON "
            "to point at the reviewed acquisition checkout + interpreter before running verify.",
            file=sys.stderr,
        )
        return 2

    guard = ProcessGuard()
    try:
        ensure_dist_built()
        expected_id = compute_expected_extension_id()
        log(f"expected stable extension id: {expected_id}")

        browser_path = db.resolve_demo_browser()
        log(f"resolved demo browser: {browser_path}")

        start_companion(guard, acquisition_dir, acquisition_python)
        start_demo_browser(guard, browser_path)

        sw_target = find_extension_service_worker(expected_id)
        log(f"LOAD PROOF: service worker present at {sw_target['url']}")
        log(f"LOAD PROOF: loaded extension id == computed stable id ({expected_id})")

        pairing = pair_extension(expected_id)
        if pairing.get("pairing_schema") != "counterpedia.local_pairing.v0.1":
            raise VerifyFailure(f"unexpected pairing schema: {pairing.get('pairing_schema')}")
        if pairing.get("authority_posture") != "transport_configuration_only":
            raise VerifyFailure("pairing crossed authority boundary")
        if pairing.get("admission") != "not_performed":
            raise VerifyFailure("pairing asserted admission")
        log("PAIRING PROOF: /v0/pair succeeded, schema+authority posture correct.")

        def _capable():
            status = read_status_projection()
            if status.get("paired") and status.get("acquisition", {}).get("ready") and status.get(
                "recovery", {}
            ).get("ready"):
                return status
            return None

        status = wait_for(_capable, PAIR_TIMEOUT_S, "both capabilities to become ready")
        log("CAPABILITY PROOF: browser_observation and recovery_assessment both true.")

        rows = render_status_rows(status)
        log("STATUS PROJECTION:")
        for r in rows:
            print(r)

        log("RESULT: PASS")
        return 0
    except VerifyFailure as exc:
        log(f"RESULT: FAIL -- {exc}")
        return 1
    finally:
        log("tearing down spawned processes and temp dirs...")
        guard.teardown()
        log("teardown complete.")


if __name__ == "__main__":
    raise SystemExit(main())
