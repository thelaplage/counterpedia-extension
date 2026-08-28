#!/usr/bin/env python3
"""RESET DEMO — bounded, ownership-scoped reset for the Counterpedia Local demo appliance.

Stops ONLY the processes THIS supervisor's own launcher spawned (tracked by
pid + a live-command signature recorded at launch time via ``record-session``,
called once from ``Start Counterpedia Demo.command``), clears ONLY this run's
own ephemeral demo browser profile and session-state file, and NEVER touches
the retained acquisition capture-registry (``~/.counterpedia/acquisition`` by
default) unless ``--purge-custody`` is passed explicitly.

FOREIGN-PROCESS GUARD: a tracked pid is stopped only when its *live* command
(read fresh from ``ps`` at reset time) still contains the signature substring
recorded at launch. If the OS has since reused that pid for an unrelated
process, reset refuses to touch it and reports it as
``foreign_signature_mismatch`` -- the same discipline as
``LocalSupervisor._refuse_if_port_foreign`` in ``counterpedia_local.py``.

Planning (``build_reset_plan``) is pure and separated from I/O
(``execute_reset_plan``) so classification is unit-testable without spawning
real processes or touching the filesystem.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOCAL_ROOT = Path.home() / ".counterpedia" / "local"
STATE_DIR = LOCAL_ROOT / "state"
SESSION_STATE_PATH = STATE_DIR / "demo-session.json"
DEMO_PROFILE_DIR = (
    Path.home() / "Library" / "Application Support" / "CounterpediaLocal" / "demo-profile"
)
RETAINED_CUSTODY_ROOT = Path.home() / ".counterpedia" / "acquisition"
SESSION_STATE_SCHEMA = "counterpedia_local.demo_session_state.v0.1"
_REQUIRED_STATE_KEYS = {
    "schema_version",
    "local_pid",
    "local_cmd_signature",
    "demo_browser_pid",
    "demo_browser_cmd_signature",
    "demo_profile_dir",
    "started_at",
}


def write_session_state(
    path: Path,
    local_pid: int,
    local_cmd_signature: str,
    demo_browser_pid: int,
    demo_browser_cmd_signature: str,
    demo_profile_dir: str,
    started_at: str,
) -> None:
    """Called once by the launcher right after it spawns both children.

    Deliberately a single bounded JSON write -- the launcher shell script
    invokes this via ``reset_demo.py record-session ...`` and never imports
    Python directly.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": SESSION_STATE_SCHEMA,
        "local_pid": local_pid,
        "local_cmd_signature": local_cmd_signature,
        "demo_browser_pid": demo_browser_pid,
        "demo_browser_cmd_signature": demo_browser_cmd_signature,
        "demo_profile_dir": demo_profile_dir,
        "started_at": started_at,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_session_state(path: Path) -> dict[str, Any] | None:
    """Bounded, validated read. Never raises; an unreadable/malformed/foreign
    -shaped state file is treated as "no tracked session", never guessed at."""
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or set(data) != _REQUIRED_STATE_KEYS:
        return None
    if data.get("schema_version") != SESSION_STATE_SCHEMA:
        return None
    return data


@dataclass
class ProcessDisposition:
    role: str
    pid: int | None
    classification: str  # not_tracked | already_exited | owned_stop | foreign_signature_mismatch
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "pid": self.pid,
            "classification": self.classification,
            "detail": self.detail,
        }


def classify_tracked_process(
    role: str, pid: Any, expected_signature: Any, live_command: str | None
) -> ProcessDisposition:
    if not isinstance(pid, int) or not isinstance(expected_signature, str) or not expected_signature:
        return ProcessDisposition(role, None, "not_tracked", "no valid tracked pid/signature recorded")
    if live_command is None:
        return ProcessDisposition(role, pid, "already_exited", "tracked pid is not currently running")
    if expected_signature in live_command:
        return ProcessDisposition(
            role, pid, "owned_stop", "live command matches the signature recorded at launch"
        )
    return ProcessDisposition(
        role,
        pid,
        "foreign_signature_mismatch",
        "live command does NOT match the signature recorded at launch -- the OS "
        "has likely reused this pid for an unrelated process; refusing to touch it",
    )


@dataclass
class ResetPlan:
    processes: list[ProcessDisposition]
    profile_dir: Path | None
    remove_profile: bool
    custody_root: Path | None
    remove_custody: bool
    state_path: Path
    remove_state: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "processes": [p.to_dict() for p in self.processes],
            "profile_dir": str(self.profile_dir) if self.profile_dir else None,
            "remove_profile": self.remove_profile,
            "custody_root": str(self.custody_root) if self.custody_root else None,
            "remove_custody": self.remove_custody,
            "state_path": str(self.state_path),
            "remove_state": self.remove_state,
        }


def build_reset_plan(
    state: dict[str, Any] | None,
    live_commands: dict[int, str],
    purge_custody: bool,
    state_path: Path = SESSION_STATE_PATH,
    custody_root: Path = RETAINED_CUSTODY_ROOT,
    default_profile_dir: Path = DEMO_PROFILE_DIR,
) -> ResetPlan:
    """Pure planning: no process is killed and no file is touched here."""
    processes: list[ProcessDisposition] = []
    profile_dir: Path | None = None
    if state is not None:
        for role, pid_key, sig_key in (
            ("counterpedia_local", "local_pid", "local_cmd_signature"),
            ("demo_browser", "demo_browser_pid", "demo_browser_cmd_signature"),
        ):
            pid = state.get(pid_key)
            live_command = live_commands.get(pid) if isinstance(pid, int) else None
            processes.append(classify_tracked_process(role, pid, state.get(sig_key), live_command))
        recorded_profile = state.get("demo_profile_dir")
        if isinstance(recorded_profile, str) and recorded_profile:
            profile_dir = Path(recorded_profile)

    if profile_dir is None:
        profile_dir = default_profile_dir

    return ResetPlan(
        processes=processes,
        profile_dir=profile_dir,
        remove_profile=True,
        custody_root=custody_root if purge_custody else None,
        remove_custody=purge_custody,
        state_path=state_path,
        remove_state=True,
    )


def get_live_commands() -> dict[int, str]:
    """Bounded, best-effort live pid->full-command map via ``ps``.

    Returns an empty dict (never raises) if ``ps`` is unavailable or fails --
    callers must then treat every tracked pid as unverifiable
    (``live_command=None`` -> ``already_exited``/refused-to-assume-owned),
    never as owned by default.
    """
    try:
        completed = subprocess.run(
            ["ps", "-A", "-ww", "-o", "pid=,command="],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if completed.returncode != 0:
        return {}
    commands: dict[int, str] = {}
    for line in completed.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        commands[pid] = parts[1]
    return commands


def stop_owned_process(pid: int) -> None:
    """Terminate a pid already classified ``owned_stop``. Never called on a
    pid classified ``foreign_signature_mismatch``. Same terminate-then-kill
    discipline as ``ManagedProcess.stop()`` in ``counterpedia_local.py``."""
    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    deadline = time.monotonic() + 4.0
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def execute_reset_plan(plan: ResetPlan, dry_run: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "dry_run": dry_run,
        "stopped": [],
        "refused": [],
        "already_exited": [],
        "not_tracked": [],
    }
    for disposition in plan.processes:
        if disposition.classification == "owned_stop":
            if not dry_run and disposition.pid is not None:
                stop_owned_process(disposition.pid)
            result["stopped"].append(disposition.to_dict())
        elif disposition.classification == "foreign_signature_mismatch":
            result["refused"].append(disposition.to_dict())
        elif disposition.classification == "already_exited":
            result["already_exited"].append(disposition.to_dict())
        else:
            result["not_tracked"].append(disposition.to_dict())

    result["profile_dir"] = str(plan.profile_dir) if plan.profile_dir else None
    result["profile_removed"] = False
    if plan.remove_profile and plan.profile_dir is not None and plan.profile_dir.is_dir():
        if not dry_run:
            shutil.rmtree(plan.profile_dir, ignore_errors=True)
        result["profile_removed"] = True

    result["custody_root"] = str(plan.custody_root) if plan.custody_root else None
    result["custody_removed"] = False
    if plan.remove_custody and plan.custody_root is not None and plan.custody_root.is_dir():
        if not dry_run:
            shutil.rmtree(plan.custody_root, ignore_errors=True)
        result["custody_removed"] = True

    result["state_removed"] = False
    if plan.remove_state and plan.state_path.is_file():
        if not dry_run:
            try:
                plan.state_path.unlink()
            except OSError:
                pass
        result["state_removed"] = True

    return result


def reset_demo(purge_custody: bool = False, dry_run: bool = False) -> dict[str, Any]:
    state = load_session_state(SESSION_STATE_PATH)
    live_commands = get_live_commands()
    plan = build_reset_plan(state, live_commands, purge_custody)
    result = execute_reset_plan(plan, dry_run=dry_run)
    result["had_session_state"] = state is not None
    result["purge_custody_requested"] = purge_custody
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    record = sub.add_parser(
        "record-session",
        help="record this launcher's own spawned pids (called by the .command launcher only)",
    )
    record.add_argument("local_pid", type=int)
    record.add_argument("local_cmd_signature")
    record.add_argument("demo_browser_pid", type=int)
    record.add_argument("demo_browser_cmd_signature")
    record.add_argument("demo_profile_dir")
    record.add_argument("started_at")

    reset_parser = sub.add_parser(
        "reset", help="stop supervisor-owned processes + clear ephemeral demo state"
    )
    reset_parser.add_argument(
        "--purge-custody",
        action="store_true",
        help=(
            "ALSO delete the retained acquisition capture-registry at "
            f"{RETAINED_CUSTODY_ROOT}. Off by default -- custody bytes are never "
            "removed unless this is passed explicitly."
        ),
    )
    reset_parser.add_argument(
        "--dry-run", action="store_true", help="print the plan without stopping/deleting anything"
    )
    return parser


def _main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "record-session":
        write_session_state(
            SESSION_STATE_PATH,
            args.local_pid,
            args.local_cmd_signature,
            args.demo_browser_pid,
            args.demo_browser_cmd_signature,
            args.demo_profile_dir,
            args.started_at,
        )
        print(json.dumps({"recorded": True, "state_path": str(SESSION_STATE_PATH)}))
        return 0

    result = reset_demo(purge_custody=args.purge_custody, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))
    if result["refused"]:
        print(
            "note: one or more tracked pids were refused (foreign-process guard) -- "
            "their live command no longer matches what was launched.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
