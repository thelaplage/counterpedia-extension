#!/usr/bin/env python3
"""Counterpedia Local macOS app bootstrap.

Packaging-only bootstrap. It binds the frozen Counterpedia Local supervisor to
runtime helpers embedded in the .app bundle, then delegates to the existing
operator wrapper. It does not alter acquisition, authoring, custody, admission,
verification, standing, or publication semantics.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

KEYCHAIN_SERVICE = "counterpedia-openai-api-key"
DAGR_FACTORY = "dagr_mcp_local_demo.counterpedia_acquisition:build_adapter"
DAGR_EVIDENCE_DIR = Path.home() / ".counterpedia" / "local" / "dagr-evidence" / "macos-app0"


def app_helpers_root(executable: Path | None = None) -> Path:
    """Resolve ``Contents/Helpers`` from a frozen app executable path."""
    exe = Path(sys.executable if executable is None else executable).absolute()
    if exe.parent.name != "MacOS" or exe.parent.parent.name != "Contents":
        raise RuntimeError("Counterpedia Local must run from its macOS .app bundle")
    helpers = exe.parent.parent / "Helpers"
    if not helpers.is_dir():
        raise RuntimeError(f"Counterpedia Local app helpers are missing: {helpers}")
    return helpers


def runtime_layout(helpers: Path) -> tuple[Path, Path]:
    acquisition = helpers / "runtime" / "counterpedia-acquisition"
    authoring = helpers / "runtime" / "counterpedia-authoring"
    required = (
        acquisition / ".venv" / "bin" / "python",
        acquisition / "scripts" / "run_counterpedia_local_transport.py",
        acquisition / ".venv" / "bin" / "counterpedia-acquisition-mcp",
        acquisition / ".venv" / "bin" / "counterpedia-wikipedia-harvest",
        acquisition / ".venv" / "bin" / "counterpedia-ingest-operator-snapshot",
        authoring / ".venv" / "bin" / "counterpedia-authoring-live-source",
    )
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("Counterpedia Local bundled runtime is incomplete: " + ", ".join(missing))
    return acquisition, authoring


def _load_keychain_key(env: dict[str, str]) -> None:
    """Load the existing optional drafting key without printing its value."""
    if env.get("OPENAI_API_KEY", "").strip():
        return
    security = Path("/usr/bin/security")
    if not security.is_file():
        return
    completed = subprocess.run(
        [str(security), "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=3,
        check=False,
    )
    if completed.returncode == 0 and completed.stdout.strip():
        env["OPENAI_API_KEY"] = completed.stdout.strip()


def configure_environment(helpers: Path, env: dict[str, str] | None = None) -> dict[str, str]:
    target = os.environ if env is None else env
    acquisition, authoring = runtime_layout(helpers)
    target["COUNTERPEDIA_ACQUISITION_DIR"] = str(acquisition)
    target["COUNTERPEDIA_ACQUISITION_PYTHON"] = str(acquisition / ".venv" / "bin" / "python")
    target["COUNTERPEDIA_AUTHORING_DIR"] = str(authoring)
    # Same explicit local-demo DAGR composition already owned by the stacked
    # Demo Kit lane. This is execution governance for the acquisition MCP call,
    # not Counterpedia corpus admission.
    DAGR_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    target["COUNTERPEDIA_ACQUISITION_DAGR_ADAPTER_FACTORY"] = DAGR_FACTORY
    target["COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR"] = str(DAGR_EVIDENCE_DIR)
    _load_keychain_key(target)
    return target


def main() -> int:
    helpers = app_helpers_root()
    configure_environment(helpers)
    from counterpedia_local_operator import main as local_main

    return local_main(["--open"])


if __name__ == "__main__":
    raise SystemExit(main())
