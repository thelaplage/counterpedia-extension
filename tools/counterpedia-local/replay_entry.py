#!/usr/bin/env python3
"""REPLAY ENTRY — forward-compatible hook to open an existing DEMO-CLOSE1 proof
packet in REPLAY mode, causing no external execution.

The D4 proof-packet format does not exist yet -- it is downstream, in the
counterpedia repo, and currently blocked. This module intentionally does NOT
fabricate a packet schema that would diverge from whatever D4 eventually
defines. It only:

1. looks for a *candidate* file (an explicit env override, else the newest
   file under a bounded local directory) without opening, parsing, or
   validating it against any schema;
2. returns a typed ``NOT_AVAILABLE`` result when no candidate exists -- which
   is the expected, non-error state until D4 lands;
3. returns a typed ``CANDIDATE_FOUND`` result (path only) when a candidate
   file is present, still without asserting it is a valid D4 packet.

Every result carries ``mode: "replay"`` and ``external_execution:
"not_performed"`` -- this hook never launches a browser, never calls a
producer, and never performs network access.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPLAY_PACKET_ENV = "COUNTERPEDIA_DEMO_REPLAY_PACKET"
DEFAULT_REPLAY_DIR = Path.home() / ".counterpedia" / "local" / "replay"

_NOT_AVAILABLE = "NOT_AVAILABLE"
_CANDIDATE_FOUND = "CANDIDATE_FOUND"


@dataclass
class ReplayStatus:
    availability: str  # "NOT_AVAILABLE" | "CANDIDATE_FOUND"
    packet_path: str | None
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "replay_schema": "counterpedia_local.replay_entry.v0.1",
            "mode": "replay",
            "availability": self.availability,
            "packet_path": self.packet_path,
            "detail": self.detail,
            "external_execution": "not_performed",
        }


def resolve_replay_packet(
    env: dict[str, str] | None = None, replay_dir: Path | None = None
) -> ReplayStatus:
    """Locate a candidate DEMO-CLOSE1 proof packet without opening/parsing it.

    Resolution order: an explicit ``COUNTERPEDIA_DEMO_REPLAY_PACKET`` env
    override, else the newest file under ``replay_dir`` (default
    ``~/.counterpedia/local/replay``). Neither path is validated against a
    packet schema -- D4's schema does not exist yet. Finding a file only
    reports its path as a candidate; nothing here reads, parses, or executes
    it.
    """
    env = os.environ if env is None else env
    override = env.get(REPLAY_PACKET_ENV, "").strip()
    if override:
        path = Path(override).expanduser()
        if path.is_file():
            return ReplayStatus(
                availability=_CANDIDATE_FOUND,
                packet_path=str(path),
                detail=(
                    f"Candidate replay packet found via {REPLAY_PACKET_ENV}. The "
                    "DEMO-CLOSE1/D4 proof-packet schema is not yet defined; this "
                    "hook reports the path only and performs no parsing or execution."
                ),
            )
        return ReplayStatus(
            availability=_NOT_AVAILABLE,
            packet_path=None,
            detail=f"{REPLAY_PACKET_ENV}={override!r} does not point at a file.",
        )

    directory = replay_dir if replay_dir is not None else DEFAULT_REPLAY_DIR
    if not directory.is_dir():
        return ReplayStatus(
            availability=_NOT_AVAILABLE,
            packet_path=None,
            detail=(
                "No replay packet configured or found. The DEMO-CLOSE1/D4 "
                "proof-packet format does not exist yet (downstream, currently "
                "blocked) -- this is expected, not an error."
            ),
        )
    try:
        candidates = sorted(
            (p for p in directory.iterdir() if p.is_file()),
            key=lambda p: p.stat().st_mtime,
        )
    except OSError:
        candidates = []
    if not candidates:
        return ReplayStatus(
            availability=_NOT_AVAILABLE,
            packet_path=None,
            detail=(
                f"No files found under {directory}. The DEMO-CLOSE1/D4 "
                "proof-packet format does not exist yet -- this is expected, "
                "not an error."
            ),
        )
    newest = candidates[-1]
    return ReplayStatus(
        availability=_CANDIDATE_FOUND,
        packet_path=str(newest),
        detail=(
            "Candidate file found under the replay directory. The DEMO-CLOSE1/D4 "
            "proof-packet schema is not yet defined; this hook reports the path "
            "only and performs no parsing or execution."
        ),
    )


def _main(argv: list[str] | None = None) -> int:
    import json

    status = resolve_replay_packet()
    print(json.dumps(status.to_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
