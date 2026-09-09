#!/usr/bin/env python3
"""Start a built Counterpedia Demo Kit by composing existing runtime owners.

This module owns only kit orchestration. Browser pairing, Acquisition, Authoring,
reader semantics, CHECK, and Terminal semantics remain in their existing owners.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import reset_demo

INSTALL_STATE_SCHEMA = "counterpedia.demo_kit_install_state.v0.1"
MANIFEST_SCHEMA = "counterpedia.demo_kit_manifest.v0.1"
TERMINAL_STATE_SCHEMA = "counterpedia.demo_kit_terminal_state.v0.1"
TERMINAL_HOST = "127.0.0.1"
TERMINAL_PORT = 8800
TERMINAL_URL = f"http://{TERMINAL_HOST}:{TERMINAL_PORT}/"
TERMINAL_MODEL_URL = f"http://{TERMINAL_HOST}:{TERMINAL_PORT}/api/model"
TERMINAL_STATE_PATH = reset_demo.STATE_DIR / "demo-kit-terminal.json"
TERMINAL_LOG_PATH = Path.home() / ".counterpedia" / "local" / "logs" / "terminal.log"
DEFAULT_WIKIPEDIA_START = "https://en.wikipedia.org/wiki/OpenAI"
DEMO_PROFILE_DIR = Path.home() / "Library" / "Application Support" / "CounterpediaLocal" / "demo-profile"


class DemoKitRuntimeError(RuntimeError):
    pass


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DemoKitRuntimeError(f"invalid or missing {path}") from exc
    if not isinstance(payload, dict):
        raise DemoKitRuntimeError(f"expected JSON object in {path}")
    return payload


def _assert_installed(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = _load_json(root / "demo-kit-manifest.json")
    state = _load_json(root / ".demo-kit-installed.json")
    if manifest.get("schema_version") != MANIFEST_SCHEMA:
        raise DemoKitRuntimeError("unsupported demo-kit manifest schema")
    if state.get("schema_version") != INSTALL_STATE_SCHEMA:
        raise DemoKitRuntimeError("unsupported demo-kit install-state schema")
    if state.get("manifest_digest") != manifest.get("manifest_digest"):
        raise DemoKitRuntimeError(
            "bundle manifest changed after installation; rerun Install Counterpedia Demo.command"
        )
    return manifest, state


def _component(root: Path, name: str) -> Path:
    path = root / "components" / name
    if not path.is_dir():
        raise DemoKitRuntimeError(f"bundle component missing: {path}")
    return path


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection((TERMINAL_HOST, port), timeout=0.3):
            return True
    except OSError:
        return False


def _terminal_ready(timeout: float = 0.8) -> bool:
    try:
        with urllib.request.urlopen(TERMINAL_MODEL_URL, timeout=timeout) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return False
    # Presentation identity only. This does not infer any epistemic state.
    return isinstance(payload, dict) and isinstance(payload.get("source"), dict)


def _load_terminal_state() -> dict[str, Any] | None:
    if not TERMINAL_STATE_PATH.is_file():
        return None
    try:
        payload = json.loads(TERMINAL_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    expected = {"schema_version", "pid", "cmd_signature", "terminal_dir", "started_at"}
    if not isinstance(payload, dict) or set(payload) != expected:
        return None
    if payload.get("schema_version") != TERMINAL_STATE_SCHEMA:
        return None
    return payload


def _write_terminal_state(pid: int, signature: str, terminal_dir: Path) -> None:
    TERMINAL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": TERMINAL_STATE_SCHEMA,
        "pid": pid,
        "cmd_signature": signature,
        "terminal_dir": str(terminal_dir),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    TERMINAL_STATE_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _start_terminal(terminal_dir: Path, timeout: float = 10.0) -> tuple[bool, int | None]:
    state = _load_terminal_state()
    if _terminal_ready():
        if state is None:
            raise DemoKitRuntimeError(
                f"port {TERMINAL_PORT} already serves a Terminal-like endpoint but this kit did not start it; "
                "refusing to assume ownership"
            )
        return False, state.get("pid") if isinstance(state.get("pid"), int) else None
    if _port_open(TERMINAL_PORT):
        raise DemoKitRuntimeError(
            f"port {TERMINAL_PORT} is occupied by a foreign/incompatible process; refusing to replace it"
        )

    server = terminal_dir / "server.js"
    if not server.is_file():
        raise DemoKitRuntimeError(f"Terminal server missing: {server}")
    node = shutil_which("node")
    TERMINAL_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log_handle = TERMINAL_LOG_PATH.open("ab", buffering=0)
    process = subprocess.Popen(
        [node, str(server)],
        cwd=str(terminal_dir),
        env={**os.environ, "COUNTERPEDIA_CONSOLE_PORT": str(TERMINAL_PORT)},
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise DemoKitRuntimeError(
                    f"Counterpedia Terminal exited with code {process.returncode}; see {TERMINAL_LOG_PATH}"
                )
            if _terminal_ready():
                break
            time.sleep(0.15)
        else:
            raise DemoKitRuntimeError(f"Counterpedia Terminal did not become ready; see {TERMINAL_LOG_PATH}")

        signature = ""
        for _ in range(20):
            signature = reset_demo.get_live_commands().get(process.pid, "")
            if signature:
                break
            time.sleep(0.05)
        if not signature:
            raise DemoKitRuntimeError("could not bind Terminal pid to a live command signature")
        _write_terminal_state(process.pid, signature, terminal_dir)
        return True, process.pid
    except Exception:
        if process.poll() is None:
            reset_demo.stop_owned_process(process.pid)
        raise
    finally:
        log_handle.close()


def shutil_which(name: str) -> str:
    import shutil
    path = shutil.which(name)
    if not path:
        raise DemoKitRuntimeError(f"required tool is unavailable: {name}")
    return path


def _stop_terminal_if_started(pid: int | None) -> None:
    if pid is not None:
        reset_demo.stop_owned_process(pid)
    try:
        TERMINAL_STATE_PATH.unlink()
    except OSError:
        pass


def _open_demo_tab(extension: Path, url: str) -> None:
    resolver = extension / "tools/counterpedia-local/demo_browser.py"
    try:
        completed = subprocess.run(
            [sys.executable, str(resolver), "resolve"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    if completed.returncode != 0:
        return
    browser = completed.stdout.strip()
    if not browser:
        return
    subprocess.Popen(
        [browser, f"--user-data-dir={DEMO_PROFILE_DIR}", url],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def start(bundle_root: Path) -> dict[str, Any]:
    root = bundle_root.expanduser().resolve()
    _assert_installed(root)
    extension = _component(root, "counterpedia-extension")
    acquisition = _component(root, "counterpedia-acquisition")
    authoring = _component(root, "counterpedia-authoring")
    counterpedia = _component(root, "counterpedia")
    terminal = _component(root, "counterpedia-console")

    acq_python = acquisition / ".venv" / "bin" / "python"
    if not acq_python.is_file():
        raise DemoKitRuntimeError("Acquisition runtime is not installed; rerun the kit installer")

    terminal_started, terminal_pid = _start_terminal(terminal)
    env = os.environ.copy()
    env.update(
        {
            "COUNTERPEDIA_ACQUISITION_DIR": str(acquisition),
            "COUNTERPEDIA_ACQUISITION_PYTHON": str(acq_python),
            "COUNTERPEDIA_AUTHORING_DIR": str(authoring),
            "COUNTERPEDIA_DIR": str(counterpedia),
            "COUNTERPEDIA_REPO_DIR": str(counterpedia),
        }
    )

    nested = extension / "tools/counterpedia-local/Start Counterpedia Demo.command"
    if not nested.is_file():
        if terminal_started:
            _stop_terminal_if_started(terminal_pid)
        raise DemoKitRuntimeError(f"existing Counterpedia launcher missing: {nested}")

    try:
        completed = subprocess.run(["bash", str(nested)], cwd=str(extension), env=env, check=False)
    except OSError as exc:
        if terminal_started:
            _stop_terminal_if_started(terminal_pid)
        raise DemoKitRuntimeError("could not start existing Counterpedia launcher") from exc
    if completed.returncode != 0:
        if terminal_started:
            _stop_terminal_if_started(terminal_pid)
        raise DemoKitRuntimeError(f"existing Counterpedia launcher failed with exit {completed.returncode}")

    # Add two tabs to the already-running dedicated demo-browser profile. These
    # navigations perform no capture/CHECK action by themselves.
    wikipedia_url = os.environ.get("COUNTERPEDIA_DEMO_START_URL", DEFAULT_WIKIPEDIA_START).strip()
    if wikipedia_url:
        _open_demo_tab(extension, wikipedia_url)
    _open_demo_tab(extension, TERMINAL_URL)

    result = {
        "status": "started",
        "terminal": TERMINAL_URL,
        "wikipedia_start": wikipedia_url or None,
        "terminal_started_by_this_run": terminal_started,
        "terminal_pid": terminal_pid,
        "authority_movement": 0,
    }
    print(json.dumps(result, indent=2))
    print()
    print("Counterpedia Demo Kit is ready.")
    print("Use the Wikipedia tab for the canonical browse -> scan -> capture walkthrough.")
    print("Use the Terminal tab to inspect the local/private record-layer surface.")
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-root", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        start(args.bundle_root)
    except DemoKitRuntimeError as exc:
        print(f"DEMO_KIT_START_REFUSED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
