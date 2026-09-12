#!/usr/bin/env python3
"""Ownership-scoped reset for a built Counterpedia Demo Kit.

Delegates browser/Local/reader teardown to the existing reset launcher, then
stops only a Terminal process whose live command still matches the signature
recorded by demo_kit_runtime.py. Retained Acquisition custody is untouched by
default.
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
import reset_demo


class DemoKitResetError(RuntimeError):
    pass


def _component(root: Path, name: str) -> Path:
    path = root / "components" / name
    if not path.is_dir():
        raise DemoKitResetError(f"bundle component missing: {path}")
    return path


def _reset_terminal() -> dict[str, Any]:
    state = runtime._load_terminal_state()
    if state is None:
        return {"status": "not_tracked", "stopped": False}
    pid = state.get("pid")
    signature = state.get("cmd_signature")
    live_commands = reset_demo.get_live_commands()
    live_command = live_commands.get(pid) if isinstance(pid, int) else None
    disposition = reset_demo.classify_tracked_process("counterpedia_terminal", pid, signature, live_command)

    stopped = False
    if disposition.classification == "owned_stop" and disposition.pid is not None:
        reset_demo.stop_owned_process(disposition.pid)
        stopped = True
    elif disposition.classification == "foreign_signature_mismatch":
        return {
            "status": disposition.classification,
            "stopped": False,
            "pid": disposition.pid,
            "detail": disposition.detail,
        }

    try:
        runtime.TERMINAL_STATE_PATH.unlink()
    except OSError:
        pass
    return {
        "status": disposition.classification,
        "stopped": stopped,
        "pid": disposition.pid,
        "detail": disposition.detail,
    }


def reset(bundle_root: Path, *, purge_custody: bool = False) -> dict[str, Any]:
    root = bundle_root.expanduser().resolve()
    extension = _component(root, "counterpedia-extension")
    nested = extension / "tools/counterpedia-local/Reset Counterpedia Demo.command"
    if not nested.is_file():
        raise DemoKitResetError(f"existing reset launcher missing: {nested}")

    env = os.environ.copy()
    if purge_custody:
        env["COUNTERPEDIA_DEMO_PURGE_CUSTODY"] = "1"
    completed = subprocess.run(["bash", str(nested)], cwd=str(extension), env=env, check=False)
    terminal = _reset_terminal()

    result = {
        "browser_local_reader_reset_exit": completed.returncode,
        "terminal": terminal,
        "purge_custody_requested": purge_custody,
        "authority_movement": 0,
    }
    print(json.dumps(result, indent=2))

    if completed.returncode != 0:
        raise DemoKitResetError(f"existing browser/Local/reader reset failed with exit {completed.returncode}")
    if terminal.get("status") == "foreign_signature_mismatch":
        raise DemoKitResetError("Terminal reset refused because tracked pid signature no longer matches")
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--purge-custody", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        reset(args.bundle_root, purge_custody=args.purge_custody)
    except DemoKitResetError as exc:
        print(f"DEMO_KIT_RESET_REFUSED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
