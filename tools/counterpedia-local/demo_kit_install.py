#!/usr/bin/env python3
"""One-time installer for a built Counterpedia Demo Kit.

Creates fresh local runtimes inside the bundle from the exact source snapshots
recorded in demo-kit-manifest.json. It never reads/writes an API key and never
changes Counterpedia authority semantics.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

MANIFEST_SCHEMA = "counterpedia.demo_kit_manifest.v0.1"
INSTALL_STATE_SCHEMA = "counterpedia.demo_kit_install_state.v0.1"


class DemoKitInstallError(RuntimeError):
    pass


def _run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"+ {' '.join(command)}")
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            env=env,
            check=False,
        )
    except OSError as exc:
        raise DemoKitInstallError(f"could not run {' '.join(command)}") from exc
    if completed.returncode != 0:
        raise DemoKitInstallError(f"command failed ({completed.returncode}): {' '.join(command)}")


def _capture(command: list[str], *, cwd: Path | None = None) -> str:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DemoKitInstallError(f"could not run {' '.join(command)}") from exc
    if completed.returncode != 0:
        raise DemoKitInstallError(completed.stderr.strip() or f"command failed: {' '.join(command)}")
    return completed.stdout.strip()


def _load_manifest(root: Path) -> dict[str, Any]:
    path = root / "demo-kit-manifest.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DemoKitInstallError(f"invalid or missing {path}") from exc
    if not isinstance(payload, dict) or payload.get("schema_version") != MANIFEST_SCHEMA:
        raise DemoKitInstallError("unsupported demo-kit manifest schema")
    components = payload.get("components")
    if not isinstance(components, list):
        raise DemoKitInstallError("demo-kit manifest is missing components")
    names = {item.get("name") for item in components if isinstance(item, dict)}
    required = {
        "counterpedia-extension",
        "counterpedia-acquisition",
        "counterpedia-authoring",
        "dagr-sdk",
        "dagr-mcp",
        "counterpedia",
        "counterpedia-console",
    }
    if names != required:
        raise DemoKitInstallError(f"demo-kit component set mismatch: {sorted(names)}")
    return payload


def _component(root: Path, name: str) -> Path:
    path = root / "components" / name
    if not path.is_dir():
        raise DemoKitInstallError(f"bundle component missing: {path}")
    return path


def _require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise DemoKitInstallError(f"required tool is not installed: {name}")
    return path


def _require_python312() -> None:
    if sys.version_info < (3, 12):
        raise DemoKitInstallError(
            f"Python 3.12+ is required by Counterpedia Acquisition; found {sys.version.split()[0]}"
        )


def _ensure_venv(source: Path, extras: str) -> Path:
    venv = source / ".venv"
    python = venv / "bin" / "python"
    if not python.is_file():
        _run([sys.executable, "-m", "venv", str(venv)])
    if not python.is_file():
        raise DemoKitInstallError(f"venv creation failed: {venv}")
    _run([str(python), "-m", "pip", "install", "-e", extras], cwd=source)
    return python


def _assert_dagr_binding(acq_python: Path, dagr_mcp: Path, dagr_sdk: Path) -> None:
    probe = r'''
import importlib
from pathlib import Path
import sys

mcp_root = Path(sys.argv[1]).resolve()
sdk_root = Path(sys.argv[2]).resolve()
demo = importlib.import_module("dagr_mcp_local_demo.counterpedia_acquisition")
binding = importlib.import_module("dagr_mcp_sdk_binding.adapter")
sdk = importlib.import_module("dagr_sdk")
factory = getattr(demo, "build_adapter", None)
if not callable(factory):
    raise SystemExit("local-demo DAGR factory is missing or not callable")
for label, module, root in (
    ("local-demo factory", demo, mcp_root),
    ("SDK lifecycle binding", binding, mcp_root),
    ("dagr-sdk", sdk, sdk_root),
):
    origin = Path(module.__file__).resolve()
    try:
        origin.relative_to(root)
    except ValueError as exc:
        raise SystemExit(f"{label} resolved outside bundled source: {origin}") from exc
print("DAGR_DEMO_BINDING=READY")
'''
    result = _capture(
        [str(acq_python), "-c", probe, str(dagr_mcp), str(dagr_sdk)]
    )
    if result != "DAGR_DEMO_BINDING=READY":
        raise DemoKitInstallError(f"unexpected DAGR binding probe result: {result}")


def install(bundle_root: Path, *, skip_browser_install: bool = False) -> dict[str, Any]:
    root = bundle_root.expanduser().resolve()
    manifest = _load_manifest(root)
    _require_python312()
    node = _require_tool("node")
    npm = _require_tool("npm")

    extension = _component(root, "counterpedia-extension")
    acquisition = _component(root, "counterpedia-acquisition")
    authoring = _component(root, "counterpedia-authoring")
    dagr_sdk = _component(root, "dagr-sdk")
    dagr_mcp = _component(root, "dagr-mcp")
    counterpedia = _component(root, "counterpedia")
    terminal = _component(root, "counterpedia-console")

    if not (acquisition / "pyproject.toml").is_file():
        raise DemoKitInstallError("Acquisition pyproject.toml missing from source snapshot")
    if not (authoring / "pyproject.toml").is_file():
        raise DemoKitInstallError("Authoring pyproject.toml missing from source snapshot")
    if not (dagr_sdk / "pyproject.toml").is_file():
        raise DemoKitInstallError("dagr-sdk pyproject.toml missing from source snapshot")
    if not (dagr_mcp / "pyproject.toml").is_file():
        raise DemoKitInstallError("dagr-mcp pyproject.toml missing from source snapshot")
    if not (extension / "package-lock.json").is_file():
        raise DemoKitInstallError("Extension package-lock.json missing from source snapshot")
    if not (counterpedia / "package-lock.json").is_file():
        raise DemoKitInstallError("Counterpedia package-lock.json missing from source snapshot")
    if not (terminal / "server.js").is_file():
        raise DemoKitInstallError("Counterpedia Terminal server.js missing from source snapshot")

    print("Counterpedia Demo Kit — one-time install")
    print(f"Bundle: {root}")
    print(f"Python: {sys.executable} ({sys.version.split()[0]})")
    print(f"Node: {_capture([node, '--version'])}")
    print(f"npm: {_capture([npm, '--version'])}")
    print()

    # Acquisition owns the Python environment used to serve its governed MCP
    # surface. Install the exact bundled DAGR sources into that same venv so the
    # local-demo factory is available without a GitHub checkout or hidden host
    # environment. dagr-sdk is installed first; dagr-mcp's package requirement
    # must therefore be satisfiable locally as dagr-sdk==0.1.0.
    acq_python = _ensure_venv(acquisition, ".[mcp]")
    _run([str(acq_python), "-m", "pip", "install", "-e", str(dagr_sdk)])
    _run([str(acq_python), "-m", "pip", "install", "-e", f"{dagr_mcp}[official-sdk]"])
    _assert_dagr_binding(acq_python, dagr_mcp, dagr_sdk)

    _ensure_venv(authoring, ".[mcp]")

    _run([npm, "ci"], cwd=extension)
    _run([npm, "run", "build:authoring-dev"], cwd=extension)

    _run([npm, "ci"], cwd=counterpedia)
    if not skip_browser_install:
        # counterpedia already carries @playwright/test; installing Chromium here
        # feeds the exact cache location demo_browser.py resolves.
        _run(["npx", "playwright", "install", "chromium"], cwd=counterpedia)

    _run([node, "--check", str(terminal / "server.js")], cwd=terminal)

    env = os.environ.copy()
    env["COUNTERPEDIA_ACQUISITION_DIR"] = str(acquisition)
    env["COUNTERPEDIA_ACQUISITION_PYTHON"] = str(acq_python)
    env["COUNTERPEDIA_AUTHORING_DIR"] = str(authoring)
    env["COUNTERPEDIA_DIR"] = str(counterpedia)
    # Pure resolver: confirms a self-loadable browser exists but starts nothing.
    _run([sys.executable, str(extension / "tools/counterpedia-local/demo_browser.py"), "resolve"], env=env)

    state = {
        "schema_version": INSTALL_STATE_SCHEMA,
        "installed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "manifest_digest": manifest.get("manifest_digest"),
        "python_version": sys.version.split()[0],
        "node_version": _capture([node, "--version"]),
        "npm_version": _capture([npm, "--version"]),
        "dagr_binding": "ready",
        "authority_movement": 0,
    }
    state_path = root / ".demo-kit-installed.json"
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    print()
    print("DAGR local-demo binding: READY")
    print("INSTALL COMPLETE")
    print("Optional drafting setup: double-click 'Configure Drafting Key.command'.")
    print("Then double-click 'Start Counterpedia Demo.command'.")
    return state


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument(
        "--skip-browser-install",
        action="store_true",
        help="do not download Playwright Chromium; useful only when COUNTERPEDIA_DEMO_BROWSER already resolves",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        install(args.bundle_root, skip_browser_install=args.skip_browser_install)
    except DemoKitInstallError as exc:
        print(f"DEMO_KIT_INSTALL_REFUSED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
