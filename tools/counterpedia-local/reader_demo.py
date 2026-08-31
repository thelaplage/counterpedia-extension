#!/usr/bin/env python3
"""Chrome-host canary helper for the Counterpedia proposal reader service.

This is operational demo scaffolding only. It does not own reader semantics.
It starts the accepted Counterpedia checkout's existing Next.js reader route
on 127.0.0.1:3000 when needed, reuses an already-compatible service when one
is present, refuses to kill/replace a foreign or incompatible process, and
records only a process it started itself.

Readiness is intentionally specific: POSTing an empty JSON object to
/api/counterpedia/reader/proposal must fail closed with HTTP 422 and the
canonical `proposal_projection_refused` code. A generic web server on :3000
is not sufficient.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import reset_demo

HOST = "127.0.0.1"
PORT = 3000
ROUTE = "/api/counterpedia/reader/proposal"
READER_URL = f"http://{HOST}:{PORT}{ROUTE}"
STATE_PATH = reset_demo.STATE_DIR / "counterpedia-reader-session.json"
STATE_SCHEMA = "counterpedia_local.reader_session.v0.1"
LOG_DIR = Path.home() / ".counterpedia" / "local" / "logs"
LOG_PATH = LOG_DIR / "counterpedia-reader.log"


def default_counterpedia_dir() -> Path:
    override = os.environ.get("COUNTERPEDIA_DIR") or os.environ.get("COUNTERPEDIA_REPO_DIR")
    if override:
        return Path(override).expanduser()
    ext_root = Path(__file__).resolve().parent.parent.parent
    return ext_root.parent / "counterpedia"


def port_open(host: str = HOST, port: int = PORT) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.4):
            return True
    except OSError:
        return False


def probe_reader(url: str = READER_URL, timeout: float = 2.0) -> bool:
    """True only for the canonical fail-closed proposal projection route."""
    request = urllib.request.Request(
        url,
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            # Empty input must not succeed. A 2xx here is not the expected route.
            response.read()
            return False
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return False
        return (
            exc.code == 422
            and isinstance(payload, dict)
            and isinstance(payload.get("error"), dict)
            and payload["error"].get("code") == "proposal_projection_refused"
        )
    except (OSError, urllib.error.URLError, ValueError):
        return False


def _load_state(path: Path = STATE_PATH) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    expected = {"schema_version", "pid", "cmd_signature", "repo_dir", "started_at"}
    if not isinstance(payload, dict) or set(payload) != expected:
        return None
    if payload.get("schema_version") != STATE_SCHEMA:
        return None
    return payload


def _write_state(pid: int, cmd_signature: str, repo_dir: Path, path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": STATE_SCHEMA,
        "pid": pid,
        "cmd_signature": cmd_signature,
        "repo_dir": str(repo_dir),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _assert_checkout(repo_dir: Path) -> Path:
    route = repo_dir / "app" / "api" / "counterpedia" / "reader" / "proposal" / "route.ts"
    package = repo_dir / "package.json"
    next_bin = repo_dir / "node_modules" / ".bin" / "next"
    if not route.is_file():
        raise RuntimeError(
            f"Counterpedia checkout at {repo_dir} lacks {ROUTE}; set COUNTERPEDIA_DIR "
            "to the accepted reader stack checkout (for example the #936/#942 worktree)."
        )
    if not package.is_file():
        raise RuntimeError(f"Counterpedia checkout at {repo_dir} has no package.json")
    if not next_bin.is_file():
        raise RuntimeError(
            f"Counterpedia dependencies are unavailable at {repo_dir}/node_modules; run npm install there first."
        )
    return next_bin


def start_reader(repo_dir: Path | None = None, timeout: float = 35.0) -> dict[str, Any]:
    repo_dir = (repo_dir or default_counterpedia_dir()).expanduser().resolve()

    if probe_reader():
        state = _load_state()
        return {
            "status": "already_ready",
            "url": READER_URL,
            "owned": bool(state),
            "pid": state.get("pid") if state else None,
            "repo_dir": str(repo_dir),
        }

    if port_open():
        raise RuntimeError(
            f"port {PORT} is already in use but {READER_URL} is not the compatible proposal reader route; "
            "refusing to replace or kill a foreign process"
        )

    next_bin = _assert_checkout(repo_dir)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_handle = LOG_PATH.open("ab", buffering=0)
    env = {**os.environ, "NEXT_TELEMETRY_DISABLED": "1"}
    process = subprocess.Popen(
        [str(next_bin), "dev", "--hostname", HOST, "--port", str(PORT)],
        cwd=str(repo_dir),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(
                    f"Counterpedia reader exited with code {process.returncode}; see {LOG_PATH}"
                )
            if probe_reader(timeout=0.8):
                break
            time.sleep(0.2)
        else:
            raise RuntimeError(
                f"Counterpedia reader did not become ready within {timeout:.0f}s; see {LOG_PATH}"
            )

        # Record the exact live command of the process we just spawned. Reset
        # later requires this same signature before it will touch the pid.
        signature = ""
        for _ in range(20):
            signature = reset_demo.get_live_commands().get(process.pid, "")
            if signature:
                break
            time.sleep(0.05)
        if not signature:
            raise RuntimeError("could not bind the launched reader pid to a live command signature")

        _write_state(process.pid, signature, repo_dir)
        return {
            "status": "started",
            "url": READER_URL,
            "owned": True,
            "pid": process.pid,
            "repo_dir": str(repo_dir),
            "log": str(LOG_PATH),
        }
    except Exception:
        if process.poll() is None:
            reset_demo.stop_owned_process(process.pid)
        raise
    finally:
        log_handle.close()


def reader_status() -> dict[str, Any]:
    state = _load_state()
    return {
        "ready": probe_reader(),
        "url": READER_URL,
        "owned": bool(state),
        "pid": state.get("pid") if state else None,
        "repo_dir": state.get("repo_dir") if state else None,
    }


def reset_reader(path: Path = STATE_PATH) -> dict[str, Any]:
    state = _load_state(path)
    if state is None:
        return {"status": "not_tracked", "stopped": False, "state_path": str(path)}

    pid = state.get("pid")
    signature = state.get("cmd_signature")
    live_commands = reset_demo.get_live_commands()
    live_command = live_commands.get(pid) if isinstance(pid, int) else None
    disposition = reset_demo.classify_tracked_process(
        "counterpedia_reader", pid, signature, live_command
    )

    stopped = False
    if disposition.classification == "owned_stop" and disposition.pid is not None:
        reset_demo.stop_owned_process(disposition.pid)
        stopped = True
    elif disposition.classification == "foreign_signature_mismatch":
        # Preserve the state file so the refusal remains inspectable. Never
        # convert a signature mismatch into permission to kill.
        return {
            "status": disposition.classification,
            "stopped": False,
            "pid": disposition.pid,
            "detail": disposition.detail,
            "state_path": str(path),
        }

    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass

    return {
        "status": disposition.classification,
        "stopped": stopped,
        "pid": disposition.pid,
        "detail": disposition.detail,
        "state_path": str(path),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="start or reuse the compatible Counterpedia reader")
    start.add_argument("--counterpedia-dir", type=Path, default=None)
    start.add_argument("--timeout", type=float, default=35.0)

    sub.add_parser("status", help="report route readiness + launcher ownership")
    sub.add_parser("reset", help="stop only a reader process this helper started")
    return parser


def _main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "start":
            result = start_reader(args.counterpedia_dir, args.timeout)
        elif args.command == "status":
            result = reader_status()
        else:
            result = reset_reader()
    except RuntimeError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    if args.command == "status":
        return 0 if result["ready"] else 1
    if args.command == "reset" and result["status"] == "foreign_signature_mismatch":
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
