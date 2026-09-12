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

import reader_demo
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
DAGR_FACTORY = "dagr_mcp_local_demo.counterpedia_acquisition:build_adapter"
DAGR_EVIDENCE_DIR = Path.home() / ".counterpedia" / "local" / "dagr-evidence" / "live-authoring-accept0"


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


def _same_path(actual: Any, expected: Path) -> bool:
    if not isinstance(actual, str) or not actual:
        return False
    try:
        return Path(actual).expanduser().resolve() == expected.expanduser().resolve()
    except OSError:
        return False


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


def _owned_live_terminal_pid(state: dict[str, Any]) -> int:
    """Return the tracked Terminal pid only when its live command still matches.

    A state file by itself is never enough: stale state plus PID reuse must not
    let the kit adopt or later terminate a foreign process.
    """
    pid = state.get("pid")
    signature = state.get("cmd_signature")
    live_commands = reset_demo.get_live_commands()
    live_command = live_commands.get(pid) if isinstance(pid, int) else None
    disposition = reset_demo.classify_tracked_process(
        "counterpedia_terminal", pid, signature, live_command
    )
    if disposition.classification != "owned_stop" or disposition.pid is None:
        raise DemoKitRuntimeError(
            "Counterpedia Terminal is reachable but the recorded launch ownership no longer "
            f"matches the live process ({disposition.classification}); refusing to reuse it"
        )
    return disposition.pid


def _assert_terminal_affinity(state: dict[str, Any], terminal_dir: Path) -> int:
    if not _same_path(state.get("terminal_dir"), terminal_dir):
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: live Counterpedia Terminal belongs to a different "
            "bundle component; refusing cross-kit reuse"
        )
    return _owned_live_terminal_pid(state)


def _reader_state_affinity(counterpedia_dir: Path) -> dict[str, Any]:
    if not reader_demo.probe_reader():
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: canonical Counterpedia reader is not ready"
        )
    state = reader_demo._load_state()  # same local-demo ownership subsystem
    if state is None:
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: compatible Counterpedia reader is live but untracked; "
            "refusing to assume ownership or bundle identity"
        )
    if not _same_path(state.get("repo_dir"), counterpedia_dir):
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: live Counterpedia reader belongs to a different "
            "bundle component; refusing cross-kit reuse"
        )
    pid = state.get("pid")
    signature = state.get("cmd_signature")
    live_commands = reset_demo.get_live_commands()
    live_command = live_commands.get(pid) if isinstance(pid, int) else None
    disposition = reset_demo.classify_tracked_process(
        "counterpedia_reader", pid, signature, live_command
    )
    if disposition.classification != "owned_stop" or disposition.pid is None:
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: Counterpedia reader state does not bind to the live "
            f"process ({disposition.classification})"
        )
    return {
        "pid": disposition.pid,
        "repo_dir": str(counterpedia_dir.resolve()),
        "live_signature": "matched",
    }


def _refuse_reader_reuse_conflict(counterpedia_dir: Path) -> None:
    """Fail before nested launch if :3000 is already a compatible reader from another kit."""
    if reader_demo.probe_reader():
        _reader_state_affinity(counterpedia_dir)


def _local_supervisor_status(timeout: float = 1.0) -> dict[str, Any]:
    url = "http://127.0.0.1:8790/v0/status"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status != 200:
                raise DemoKitRuntimeError(
                    "DEMO_RUNTIME_AFFINITY_REFUSED: Counterpedia Local status is not HTTP 200"
                )
            payload = json.loads(response.read().decode("utf-8"))
    except DemoKitRuntimeError:
        raise
    except (OSError, urllib.error.URLError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: Counterpedia Local status is unavailable or malformed"
        ) from exc
    if not isinstance(payload, dict) or payload.get("service") != "counterpedia-local":
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: :8790 is not the Counterpedia Local supervisor"
        )
    return payload


def _assert_local_affinity(
    acquisition_dir: Path,
    acquisition_python: Path,
    authoring_dir: Path,
) -> dict[str, Any]:
    status = _local_supervisor_status()
    dependencies = status.get("dependencies")
    if not isinstance(dependencies, dict):
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: Counterpedia Local dependency report is missing"
        )
    expected = {
        "acquisition_dir": acquisition_dir.resolve(),
        "acquisition_python": acquisition_python.resolve(),
        "authoring_dir": authoring_dir.resolve(),
    }
    for key, path in expected.items():
        if not _same_path(dependencies.get(key), path):
            raise DemoKitRuntimeError(
                "DEMO_RUNTIME_AFFINITY_REFUSED: Counterpedia Local dependency "
                f"{key} does not point into this bundle"
            )
    return {
        "acquisition_dir": str(expected["acquisition_dir"]),
        "acquisition_python": str(expected["acquisition_python"]),
        "authoring_dir": str(expected["authoring_dir"]),
    }


def _assert_nested_session_affinity() -> dict[str, Any]:
    state = reset_demo.load_session_state(reset_demo.SESSION_STATE_PATH)
    if state is None:
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: nested Local/browser session state is missing"
        )
    if not _same_path(state.get("demo_profile_dir"), DEMO_PROFILE_DIR):
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: tracked demo browser profile is not the canonical "
            "Counterpedia Local profile"
        )
    live_commands = reset_demo.get_live_commands()
    results: dict[str, Any] = {}
    for role, pid_key, sig_key in (
        ("counterpedia_local", "local_pid", "local_cmd_signature"),
        ("demo_browser", "demo_browser_pid", "demo_browser_cmd_signature"),
    ):
        pid = state.get(pid_key)
        live = live_commands.get(pid) if isinstance(pid, int) else None
        disposition = reset_demo.classify_tracked_process(role, pid, state.get(sig_key), live)
        if disposition.classification != "owned_stop" or disposition.pid is None:
            raise DemoKitRuntimeError(
                "DEMO_RUNTIME_AFFINITY_REFUSED: tracked "
                f"{role} state does not bind to the live process ({disposition.classification})"
            )
        results[role] = disposition.pid
    results["demo_profile_dir"] = str(DEMO_PROFILE_DIR)
    return results


def _start_terminal(terminal_dir: Path, timeout: float = 10.0) -> tuple[bool, int | None]:
    state = _load_terminal_state()
    if _terminal_ready():
        if state is None:
            raise DemoKitRuntimeError(
                f"port {TERMINAL_PORT} already serves a Terminal-like endpoint but this kit did not start it; "
                "refusing to assume ownership"
            )
        return False, _assert_terminal_affinity(state, terminal_dir)
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


def _extension_dist(extension: Path) -> Path:
    dist = (extension / "dist").resolve()
    if not (dist / "manifest.json").is_file():
        raise DemoKitRuntimeError(
            f"built Counterpedia extension is missing dist/manifest.json: {dist}"
        )
    return dist


def _browser_binding_flags(extension: Path) -> tuple[str, str]:
    return (
        f"--user-data-dir={DEMO_PROFILE_DIR}",
        f"--load-extension={_extension_dist(extension)}",
    )


def _live_extension_bound_browser_command(
    extension: Path,
    live_commands: dict[int, str] | None = None,
) -> str | None:
    """Return a live demo-browser command only if profile + extension bind together.

    The TEAM r3 recipient run exposed a real orchestration defect: a later
    kit-triggered Chrome invocation reused the dedicated profile but omitted
    ``--load-extension``, and that no-extension invocation became the surviving
    primary browser. A profile match alone is therefore not a load proof.
    """
    profile_flag, load_flag = _browser_binding_flags(extension)
    commands = reset_demo.get_live_commands() if live_commands is None else live_commands
    for command in commands.values():
        if profile_flag in command and load_flag in command:
            return command
    return None


def _wait_for_extension_binding(extension: Path, timeout: float = 5.0) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        command = _live_extension_bound_browser_command(extension)
        if command is not None:
            return command
        time.sleep(0.1)
    raise DemoKitRuntimeError(
        "DEMO_EXTENSION_LOAD_REFUSED: dedicated demo browser is not live with both "
        "the expected profile and exact bundled --load-extension binding"
    )


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
    profile_flag, load_flag = _browser_binding_flags(extension)
    subprocess.Popen(
        [
            browser,
            profile_flag,
            load_flag,
            "--no-first-run",
            "--no-default-browser-check",
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _reset_nested_after_failed_binding(extension: Path, env: dict[str, str]) -> None:
    """Best-effort ownership-scoped teardown after a post-launch binding refusal."""
    nested_reset = extension / "tools/counterpedia-local/Reset Counterpedia Demo.command"
    if not nested_reset.is_file():
        return
    try:
        subprocess.run(
            ["bash", str(nested_reset)],
            cwd=str(extension),
            env=env,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def _assert_runtime_affinity(
    *,
    extension: Path,
    acquisition: Path,
    acquisition_python: Path,
    authoring: Path,
    counterpedia: Path,
    terminal: Path,
) -> dict[str, Any]:
    terminal_state = _load_terminal_state()
    if terminal_state is None:
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: Counterpedia Terminal state is missing"
        )
    terminal_pid = _assert_terminal_affinity(terminal_state, terminal)
    reader = _reader_state_affinity(counterpedia)
    local = _assert_local_affinity(acquisition, acquisition_python, authoring)
    nested = _assert_nested_session_affinity()
    browser_command = _live_extension_bound_browser_command(extension)
    if browser_command is None:
        raise DemoKitRuntimeError(
            "DEMO_RUNTIME_AFFINITY_REFUSED: no live browser is bound to this bundle's exact "
            "extension dist"
        )
    return {
        "terminal_pid": terminal_pid,
        "terminal_dir": str(terminal.resolve()),
        "reader": reader,
        "local": local,
        "nested_session": nested,
        "browser_extension_command": browser_command,
    }


def start(bundle_root: Path) -> dict[str, Any]:
    root = bundle_root.expanduser().resolve()
    _assert_installed(root)
    extension = _component(root, "counterpedia-extension")
    acquisition = _component(root, "counterpedia-acquisition")
    authoring = _component(root, "counterpedia-authoring")
    # These two components are installed into Acquisition's venv by the kit
    # installer. Resolve them here as a bundle-integrity check even though the
    # nested Local launcher consumes them via that interpreter rather than path.
    _component(root, "dagr-sdk")
    _component(root, "dagr-mcp")
    counterpedia = _component(root, "counterpedia")
    terminal = _component(root, "counterpedia-console")

    acq_python = acquisition / ".venv" / "bin" / "python"
    if not acq_python.is_file():
        raise DemoKitRuntimeError("Acquisition runtime is not installed; rerun the kit installer")

    # A compatible reader already running from a different kit must be refused
    # before this launch starts or reuses any additional runtime process.
    _refuse_reader_reuse_conflict(counterpedia)

    DAGR_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    terminal_started, terminal_pid = _start_terminal(terminal)
    env = os.environ.copy()
    env.update(
        {
            "COUNTERPEDIA_ACQUISITION_DIR": str(acquisition),
            "COUNTERPEDIA_ACQUISITION_PYTHON": str(acq_python),
            "COUNTERPEDIA_AUTHORING_DIR": str(authoring),
            "COUNTERPEDIA_DIR": str(counterpedia),
            "COUNTERPEDIA_REPO_DIR": str(counterpedia),
            # Packaging owns provisioning of the already-reviewed local-demo
            # DAGR adapter. Generic Acquisition MCP remains fail-closed if no
            # operator selects an adapter; this bundle selects the exact demo
            # adapter only for this explicit local-demo composition.
            "COUNTERPEDIA_ACQUISITION_DAGR_ADAPTER_FACTORY": DAGR_FACTORY,
            "COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR": str(DAGR_EVIDENCE_DIR),
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

    # The nested launcher is the first owner of the dedicated browser. Prove it
    # left a live profile+extension binding before the kit adds convenience tabs.
    try:
        _wait_for_extension_binding(extension)

        # Add two tabs to the already-running dedicated demo-browser profile.
        # Every kit-triggered invocation repeats the exact extension binding;
        # omitting it was the TEAM r3 recipient failure. These navigations still
        # perform no capture/CHECK action by themselves.
        wikipedia_url = os.environ.get("COUNTERPEDIA_DEMO_START_URL", DEFAULT_WIKIPEDIA_START).strip()
        if wikipedia_url:
            _open_demo_tab(extension, wikipedia_url)
        _open_demo_tab(extension, TERMINAL_URL)

        # Fail closed after the convenience-tab invocations too. A live browser
        # on the expected profile without the bundled extension is NOT ready.
        browser_binding = _wait_for_extension_binding(extension)

        # READY is stronger than endpoint compatibility: every reused/live
        # runtime owner must still bind to THIS installed bundle's component
        # directories and tracked live process signatures.
        runtime_affinity = _assert_runtime_affinity(
            extension=extension,
            acquisition=acquisition,
            acquisition_python=acq_python,
            authoring=authoring,
            counterpedia=counterpedia,
            terminal=terminal,
        )
    except DemoKitRuntimeError:
        _reset_nested_after_failed_binding(extension, env)
        if terminal_started:
            _stop_terminal_if_started(terminal_pid)
        raise

    result = {
        "status": "started",
        "terminal": TERMINAL_URL,
        "wikipedia_start": wikipedia_url or None,
        "terminal_started_by_this_run": terminal_started,
        "terminal_pid": terminal_pid,
        "browser_extension_binding": "ready",
        "browser_extension_command": browser_binding,
        "runtime_affinity": "ready",
        "runtime_affinity_evidence": runtime_affinity,
        "dagr_factory": DAGR_FACTORY,
        "dagr_evidence_dir": str(DAGR_EVIDENCE_DIR),
        "authority_movement": 0,
    }
    print(json.dumps(result, indent=2))
    print()
    print("Counterpedia Demo Kit is ready.")
    print("Browser extension binding: READY")
    print("Runtime affinity: READY")
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
