#!/usr/bin/env python3
"""PRE-FLIGHT — bounded pitch-readiness report for the Counterpedia Local demo appliance.

Additive only. Every line here is either a read of an already-exposed
capability (the FROZEN ``/healthz`` capabilities contract, via
``counterpedia_local.acquisition_capabilities``) or a bounded local
filesystem/port probe of a resource the existing launcher already depends on
(``demo_browser.resolve_demo_browser``, the built ``dist/manifest.json``, the
authoring checkout layout). It invents no new readiness signal, starts
nothing, and stops nothing -- callers (the status page, this module's own
CLI, or the launcher) decide what to do with a "not ready" line.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import counterpedia_local as base
import demo_browser

# Lines whose "ready" status is required for a clean pitch start. "Authoring"
# and "Optional demo artifacts" are deliberately excluded: authoring is an
# externally-started, optionally-configured dependency (preflight must never
# start it -- see check_authoring), and demo artifacts are, per their name,
# optional.
REQUIRED_FOR_PITCH_READY = frozenset(
    {"chrome_for_testing", "extension", "counterpedia_local", "acquisition", "recovery"}
)


@dataclass
class ReadinessLine:
    key: str
    label: str
    status: str  # "ready" | "not_ready" | "configured" | "reachable" | "absent" | "missing"
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "label": self.label, "status": self.status, "detail": self.detail}


def check_chrome_for_testing(env: dict[str, str] | None = None) -> ReadinessLine:
    """Reuses demo_browser.py's own resolver -- never a second resolution path."""
    try:
        path = demo_browser.resolve_demo_browser(env)
    except demo_browser.DemoBrowserNotFoundError as exc:
        return ReadinessLine("chrome_for_testing", "Chrome for Testing", "not_ready", str(exc))
    return ReadinessLine("chrome_for_testing", "Chrome for Testing", "ready", str(path))


def check_extension(ext_root: Path) -> ReadinessLine:
    """dist/ present + manifest carries the pinned key (stable-id guarantee).

    Mirrors the exact check ``Start Counterpedia Demo.command`` already
    performs (``dist_manifest_has_key``) before deciding whether to rebuild --
    this does not reinterpret that contract, only reports it.
    """
    manifest_path = ext_root / "dist" / "manifest.json"
    if not manifest_path.is_file():
        return ReadinessLine("extension", "Extension", "not_ready", f"{manifest_path} not built")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return ReadinessLine("extension", "Extension", "not_ready", f"{manifest_path} is not valid JSON")
    if not isinstance(manifest, dict) or not manifest.get("key"):
        return ReadinessLine(
            "extension",
            "Extension",
            "not_ready",
            f"{manifest_path} is missing the pinned key (stable id not guaranteed)",
        )
    return ReadinessLine("extension", "Extension", "ready", str(manifest_path))


def check_counterpedia_local(host: str = base.HOST, port: int = base.COMPANION_PORT) -> ReadinessLine:
    payload = base.http_json(f"http://{host}:{port}/healthz")
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        return ReadinessLine(
            "counterpedia_local", "Counterpedia Local", "not_ready", f"http://{host}:{port} unreachable"
        )
    return ReadinessLine("counterpedia_local", "Counterpedia Local", "ready", f"http://{host}:{port}")


def check_acquisition(host: str = base.HOST, port: int = base.ACQUISITION_PORT) -> ReadinessLine:
    """Capability-derived: reuses ``acquisition_capabilities``'s frozen readiness contract."""
    _health_valid, browser_observation_ready, _recovery_assessment_ready = base.acquisition_capabilities(
        host, port
    )
    status = "ready" if browser_observation_ready else "not_ready"
    return ReadinessLine("acquisition", "Acquisition", status, "capabilities.browser_observation")


def check_recovery(host: str = base.HOST, port: int = base.ACQUISITION_PORT) -> ReadinessLine:
    """Capability-derived: reuses ``acquisition_capabilities``'s frozen readiness contract."""
    _health_valid, _browser_observation_ready, recovery_assessment_ready = base.acquisition_capabilities(
        host, port
    )
    status = "ready" if recovery_assessment_ready else "not_ready"
    return ReadinessLine("recovery", "Recovery", status, "capabilities.recovery_assessment")


def check_authoring(authoring_dir: Path, host: str = base.HOST, port: int = base.AUTHORING_PORT) -> ReadinessLine:
    """Reports configured/reachable/absent only -- preflight never starts authoring."""
    launcher = authoring_dir / ".venv" / "bin" / "counterpedia-authoring-live-source"
    if base.port_open(port):
        return ReadinessLine("authoring", "Authoring", "reachable", f"http://{host}:{port}")
    if launcher.is_file():
        return ReadinessLine("authoring", "Authoring", "configured", str(launcher))
    return ReadinessLine(
        "authoring", "Authoring", "absent", f"{launcher} not present (external dependency, not started here)"
    )


def check_demo_artifacts(store_root: Path) -> ReadinessLine:
    if store_root.is_dir() and any(store_root.iterdir()):
        return ReadinessLine("demo_artifacts", "Optional demo artifacts", "configured", str(store_root))
    return ReadinessLine("demo_artifacts", "Optional demo artifacts", "missing", str(store_root))


def build_preflight_report(
    ext_root: Path,
    acquisition_dir: Path,
    authoring_dir: Path,
    store_root: Path,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    del acquisition_dir  # reserved for a future capability-derived acquisition-checkout line; unused today
    lines = [
        check_chrome_for_testing(env),
        check_extension(ext_root),
        check_counterpedia_local(),
        check_acquisition(),
        check_recovery(),
        check_authoring(authoring_dir),
        check_demo_artifacts(store_root),
    ]
    pitch_ready = all(line.status == "ready" for line in lines if line.key in REQUIRED_FOR_PITCH_READY)
    return {
        "report_schema": "counterpedia_local.preflight_report.v0.1",
        "pitch_ready": pitch_ready,
        "lines": [line.to_dict() for line in lines],
    }


def _default_ext_root() -> Path:
    # tools/counterpedia-local/preflight.py -> repo root is two parents up.
    return Path(__file__).resolve().parent.parent.parent


def _main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquisition-dir", type=Path, default=base.default_acquisition_dir())
    parser.add_argument("--authoring-dir", type=Path, default=base.default_authoring_dir())
    parser.add_argument("--store-root", type=Path, default=base.DEFAULT_STORE_ROOT)
    parser.add_argument("--ext-root", type=Path, default=_default_ext_root())
    parser.add_argument("--json", action="store_true", help="print the machine-readable report only")
    args = parser.parse_args(argv)

    report = build_preflight_report(
        ext_root=args.ext_root.expanduser(),
        acquisition_dir=args.acquisition_dir.expanduser(),
        authoring_dir=args.authoring_dir.expanduser(),
        store_root=args.store_root.expanduser(),
    )
    if args.json:
        print(json.dumps(report, indent=2))
        return 0 if report["pitch_ready"] else 1

    print("Counterpedia Local — pre-flight")
    for line in report["lines"]:
        marker = "OK " if line["status"] in ("ready", "configured", "reachable") else ".. "
        print(f"  {marker}{line['label']:<28} {line['status']:<10} {line['detail']}")
    print()
    print("Pitch ready:" , "YES" if report["pitch_ready"] else "NO")
    return 0 if report["pitch_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(_main())
