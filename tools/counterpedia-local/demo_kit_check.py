#!/usr/bin/env python3
"""Bounded readiness report for a built/running Counterpedia Demo Kit.

Composes existing preflight and reader readiness contracts and adds only the
Terminal presentation-process readiness line owned by the kit. It starts
nothing, stops nothing, and creates no epistemic state.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import demo_kit_runtime as runtime

REPORT_SCHEMA = "counterpedia.demo_kit_readiness.v0.1"


class DemoKitCheckError(RuntimeError):
    pass


def _component(root: Path, name: str) -> Path:
    path = root / "components" / name
    if not path.is_dir():
        raise DemoKitCheckError(f"bundle component missing: {path}")
    return path


def _json_command(command: list[str], *, cwd: Path, env: dict[str, str]) -> tuple[int, dict[str, Any]]:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DemoKitCheckError(f"could not run {' '.join(command)}") from exc
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise DemoKitCheckError(f"readiness command returned invalid JSON: {detail}") from exc
    if not isinstance(payload, dict):
        raise DemoKitCheckError("readiness command returned a non-object")
    return completed.returncode, payload


def check(bundle_root: Path) -> dict[str, Any]:
    root = bundle_root.expanduser().resolve()
    runtime._assert_installed(root)
    extension = _component(root, "counterpedia-extension")
    acquisition = _component(root, "counterpedia-acquisition")
    authoring = _component(root, "counterpedia-authoring")
    counterpedia = _component(root, "counterpedia")

    acq_python = acquisition / ".venv" / "bin" / "python"
    if not acq_python.is_file():
        raise DemoKitCheckError("Acquisition runtime is not installed")

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
    local_dir = extension / "tools/counterpedia-local"
    preflight_rc, preflight = _json_command(
        [sys.executable, str(local_dir / "preflight.py"), "--json", "--ext-root", str(extension),
         "--acquisition-dir", str(acquisition), "--authoring-dir", str(authoring)],
        cwd=local_dir,
        env=env,
    )
    reader_rc, reader = _json_command(
        [sys.executable, str(local_dir / "reader_demo.py"), "status"],
        cwd=local_dir,
        env=env,
    )
    terminal_ready = runtime._terminal_ready()
    terminal_owned = False
    terminal_detail = "not ready"
    state = runtime._load_terminal_state()
    if terminal_ready and state is not None:
        try:
            pid = runtime._owned_live_terminal_pid(state)
        except runtime.DemoKitRuntimeError as exc:
            terminal_detail = str(exc)
        else:
            terminal_owned = True
            terminal_detail = f"owned live pid {pid}"
    elif terminal_ready:
        terminal_detail = "reachable but not owned by this kit"

    ready = (
        preflight_rc == 0
        and preflight.get("pitch_ready") is True
        and reader_rc == 0
        and reader.get("ready") is True
        and terminal_ready
        and terminal_owned
    )
    return {
        "report_schema": REPORT_SCHEMA,
        "ready": ready,
        "counterpedia_local_preflight": preflight,
        "reader": reader,
        "terminal": {
            "ready": terminal_ready,
            "owned": terminal_owned,
            "url": runtime.TERMINAL_URL,
            "detail": terminal_detail,
        },
        "authority_movement": 0,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = check(args.bundle_root)
    except (DemoKitCheckError, runtime.DemoKitRuntimeError) as exc:
        print(f"DEMO_KIT_CHECK_REFUSED: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("Counterpedia Demo Kit — readiness")
        print(f"  Counterpedia Local: {'READY' if report['counterpedia_local_preflight'].get('pitch_ready') else 'NOT READY'}")
        print(f"  Counterpedia reader: {'READY' if report['reader'].get('ready') else 'NOT READY'}")
        terminal = report["terminal"]
        print(f"  Counterpedia Terminal: {'READY' if terminal['ready'] and terminal['owned'] else 'NOT READY'}")
        print()
        print("Demo ready:", "YES" if report["ready"] else "NO")
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
