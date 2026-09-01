#!/usr/bin/env python3
"""SUPERVISOR — unified, additive readiness across the full pitch estate.

Additive only. This module NEVER redefines the existing, FROZEN
``preflight.build_preflight_report`` / ``pitch_ready`` contract and it NEVER
redefines counterpedia's own corpus-freshness contract. Where a contract is
owned elsewhere, this module delegates to that owner and reports the result.

New readiness lines layered above the frozen capture preflight:
  counterpedia_web        — HTTP reachability of local Next.js
  counterpedia_reader     — exact canonical proposal-route fail-closed probe
  network_artifacts       — delegates to counterpedia's own demo preflight
  countergraph_query      — local CG4 query-service reachability
  countergraph_mcp_health — deployed countergraph-mcp /health reachability
  server_side_auth        — presence-only signing-key configuration check

PROFILES (the existing bare ``pitch_ready`` boolean is untouched):
  capture_demo           = frozen preflight gate verbatim
  authoring_demo         = capture_demo + authoring
  draft_from_source_demo = capture_demo + authoring + canonical proposal reader
  network_replay_demo    = counterpedia_web + network_artifacts
  live_graph_demo        = counterpedia_web + graph services + server-side auth
  canonical_pitch        = union of all named profiles

This module starts nothing and stops nothing.
"""
from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import preflight
import reader_demo

DEFAULT_COUNTERGRAPH_MCP_HEALTH_URL = "https://p01--countergraph-mcp--vbz5gfd5crgq.code.run/health"
DEFAULT_COUNTERGRAPH_QUERY_URL = "http://127.0.0.1:8000/health"
DEFAULT_COUNTERPEDIA_WEB_URL = "http://127.0.0.1:3000/"
SERVER_SIDE_AUTH_ENV_VAR = "COUNTERGRAPH_MCP_SIGNING_KEY_PATH"


@dataclass
class ReadinessLine:
    key: str
    label: str
    status: str
    ok: bool
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "status": self.status,
            "ok": self.ok,
            "detail": self.detail,
        }


def _http_reachable(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError, ValueError):
        return False


def check_counterpedia_web(url: str | None = None) -> ReadinessLine:
    url = url or os.environ.get("COUNTERPEDIA_WEB_URL", DEFAULT_COUNTERPEDIA_WEB_URL)
    ok = _http_reachable(url)
    return ReadinessLine(
        "counterpedia_web",
        "Counterpedia web",
        "reachable" if ok else "not_ready",
        ok,
        url,
    )


def check_counterpedia_reader() -> ReadinessLine:
    """Consume reader_demo's exact route probe; never replace it with GET /.

    A generic service on :3000 is therefore NOT enough to satisfy the
    draft-from-source product profile.
    """
    ok = reader_demo.probe_reader()
    return ReadinessLine(
        "counterpedia_reader",
        "Counterpedia proposal reader",
        "ready" if ok else "not_ready",
        ok,
        reader_demo.READER_URL,
    )


def _default_counterpedia_repo_dir() -> Path:
    override = os.environ.get("COUNTERPEDIA_REPO_DIR")
    if override:
        return Path(override).expanduser()
    ext_root = Path(__file__).resolve().parent.parent.parent
    return ext_root.parent / "counterpedia"


def check_network_artifacts(repo_dir: Path | None = None) -> ReadinessLine:
    """Delegate to counterpedia's OWN authoritative non-mutating preflight."""
    repo_dir = repo_dir or _default_counterpedia_repo_dir()
    package_json = repo_dir / "package.json"
    if not package_json.is_file():
        return ReadinessLine(
            "network_artifacts",
            "Network replay artifacts (wikidata/join/graph/index/search)",
            "not_evaluated",
            False,
            f"{repo_dir} not found -- set COUNTERPEDIA_REPO_DIR to delegate to its own preflight",
        )
    try:
        result = subprocess.run(
            ["npm", "run", "demo:local", "--", "--check-only"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return ReadinessLine(
            "network_artifacts",
            "Network replay artifacts (wikidata/join/graph/index/search)",
            "not_evaluated",
            False,
            f"delegated check-only run failed to execute: {exc}",
        )
    ok = result.returncode == 0
    tail = (result.stdout or result.stderr or "").strip().splitlines()
    detail = tail[-1] if tail else f"exit={result.returncode}"
    return ReadinessLine(
        "network_artifacts",
        "Network replay artifacts (wikidata/join/graph/index/search)",
        "ready" if ok else "not_ready",
        ok,
        detail,
    )


def check_countergraph_query(url: str | None = None) -> ReadinessLine:
    url = url or os.environ.get("COUNTERGRAPH_QUERY_URL", DEFAULT_COUNTERGRAPH_QUERY_URL)
    ok = _http_reachable(url)
    return ReadinessLine(
        "countergraph_query",
        "Countergraph query service",
        "reachable" if ok else "not_ready",
        ok,
        url,
    )


def check_countergraph_mcp_health(url: str | None = None) -> ReadinessLine:
    url = url or os.environ.get("COUNTERGRAPH_MCP_HEALTH_URL", DEFAULT_COUNTERGRAPH_MCP_HEALTH_URL)
    ok = _http_reachable(url)
    return ReadinessLine(
        "countergraph_mcp_health",
        "Countergraph MCP /health",
        "reachable" if ok else "not_ready",
        ok,
        url,
    )


def check_server_side_auth(env: dict[str, str] | None = None) -> ReadinessLine:
    env = os.environ if env is None else env
    present = bool(env.get(SERVER_SIDE_AUTH_ENV_VAR, "").strip())
    detail = (
        f"{SERVER_SIDE_AUTH_ENV_VAR} is set"
        if present
        else f"{SERVER_SIDE_AUTH_ENV_VAR} is not set"
    )
    return ReadinessLine(
        "server_side_auth",
        "Server-side auth configured",
        "configured" if present else "absent",
        present,
        detail,
    )


# --- Profiles ---------------------------------------------------------------

CAPTURE_DEMO = frozenset(preflight.REQUIRED_FOR_PITCH_READY)
AUTHORING_DEMO = CAPTURE_DEMO | {"authoring"}
DRAFT_FROM_SOURCE_DEMO = CAPTURE_DEMO | {"authoring", "counterpedia_reader"}
NETWORK_REPLAY_DEMO = frozenset({"counterpedia_web", "network_artifacts"})
LIVE_GRAPH_DEMO = frozenset(
    {"counterpedia_web", "countergraph_query", "countergraph_mcp_health", "server_side_auth"}
)
CANONICAL_PITCH = (
    CAPTURE_DEMO
    | AUTHORING_DEMO
    | DRAFT_FROM_SOURCE_DEMO
    | NETWORK_REPLAY_DEMO
    | LIVE_GRAPH_DEMO
)

PROFILES: dict[str, frozenset[str]] = {
    "capture_demo": CAPTURE_DEMO,
    "authoring_demo": AUTHORING_DEMO,
    "draft_from_source_demo": DRAFT_FROM_SOURCE_DEMO,
    "network_replay_demo": NETWORK_REPLAY_DEMO,
    "live_graph_demo": LIVE_GRAPH_DEMO,
    "canonical_pitch": CANONICAL_PITCH,
}


def build_supervisor_report(
    ext_root: Path,
    acquisition_dir: Path,
    authoring_dir: Path,
    store_root: Path,
    env: dict[str, str] | None = None,
    counterpedia_repo_dir: Path | None = None,
    skip_network_artifacts: bool = False,
) -> dict[str, Any]:
    base_report = preflight.build_preflight_report(
        ext_root=ext_root,
        acquisition_dir=acquisition_dir,
        authoring_dir=authoring_dir,
        store_root=store_root,
        env=env,
    )
    pitch_ready_unchanged = base_report["pitch_ready"]

    base_ok_statuses = {"ready", "reachable", "configured"}
    lines: dict[str, ReadinessLine] = {}
    for base_line in base_report["lines"]:
        if base_line["key"] == "authoring":
            ok = base_line["status"] == "reachable"
        else:
            ok = base_line["status"] in base_ok_statuses
        lines[base_line["key"]] = ReadinessLine(
            base_line["key"],
            base_line["label"],
            base_line["status"],
            ok,
            base_line["detail"],
        )

    new_lines = [check_counterpedia_web(), check_counterpedia_reader()]
    if skip_network_artifacts:
        new_lines.append(
            ReadinessLine(
                "network_artifacts",
                "Network replay artifacts (wikidata/join/graph/index/search)",
                "not_evaluated",
                False,
                "skipped (--skip-network-artifacts)",
            )
        )
    else:
        new_lines.append(check_network_artifacts(counterpedia_repo_dir))
    new_lines.extend(
        [
            check_countergraph_query(),
            check_countergraph_mcp_health(),
            check_server_side_auth(env),
        ]
    )
    for line in new_lines:
        lines[line.key] = line

    profiles: dict[str, dict[str, Any]] = {}
    for name, required_keys in PROFILES.items():
        missing = sorted(k for k in required_keys if not lines[k].ok)
        profiles[name] = {
            "ready": len(missing) == 0,
            "required": sorted(required_keys),
            "missing": missing,
        }

    return {
        "report_schema": "counterpedia_local.supervisor_report.v0.1",
        "pitch_ready": pitch_ready_unchanged,
        "profiles": profiles,
        "lines": {key: line.to_dict() for key, line in lines.items()},
    }


def _main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--acquisition-dir", type=Path, default=preflight.base.default_acquisition_dir())
    parser.add_argument("--authoring-dir", type=Path, default=preflight.base.default_authoring_dir())
    parser.add_argument("--store-root", type=Path, default=preflight.base.DEFAULT_STORE_ROOT)
    parser.add_argument("--ext-root", type=Path, default=preflight._default_ext_root())
    parser.add_argument("--counterpedia-repo-dir", type=Path, default=None)
    parser.add_argument(
        "--skip-network-artifacts",
        action="store_true",
        help="skip the delegated `npm run demo:local -- --check-only` subprocess call",
    )
    parser.add_argument("--json", action="store_true", help="print the machine-readable report only")
    args = parser.parse_args(argv)

    report = build_supervisor_report(
        ext_root=args.ext_root.expanduser(),
        acquisition_dir=args.acquisition_dir.expanduser(),
        authoring_dir=args.authoring_dir.expanduser(),
        store_root=args.store_root.expanduser(),
        counterpedia_repo_dir=(
            args.counterpedia_repo_dir.expanduser() if args.counterpedia_repo_dir else None
        ),
        skip_network_artifacts=args.skip_network_artifacts,
    )

    if args.json:
        print(json.dumps(report, indent=2))
        return 0 if report["profiles"]["canonical_pitch"]["ready"] else 1

    print("Counterpedia — unified pitch supervisor")
    print()
    for line in report["lines"].values():
        marker = "OK " if line["ok"] else ".. "
        print(f"  {marker}{line['label']:<45} {line['status']:<14} {line['detail']}")
    print()
    print(
        "pitch_ready (unchanged, capture-only contract):",
        "YES" if report["pitch_ready"] else "NO",
    )
    print()
    for name in (
        "capture_demo",
        "authoring_demo",
        "draft_from_source_demo",
        "network_replay_demo",
        "live_graph_demo",
        "canonical_pitch",
    ):
        profile = report["profiles"][name]
        status = (
            "READY"
            if profile["ready"]
            else f"NOT READY (missing: {', '.join(profile['missing']) or 'n/a'})"
        )
        print(f"  {name:<24} {status}")
    return 0 if report["profiles"]["canonical_pitch"]["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(_main())
