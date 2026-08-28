#!/usr/bin/env python3
"""Unit tests for replay_entry.py's forward-compatible REPLAY ENTRY hook.

Pure filesystem-probe logic -- no D4 packet schema is assumed or fabricated.
Run:
  python3 tools/counterpedia-local/test_replay_entry.py -v
"""
from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import replay_entry as re_  # noqa: E402


class ResolveReplayPacketTests(unittest.TestCase):
    def test_not_available_with_no_env_and_missing_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            status = re_.resolve_replay_packet(env={}, replay_dir=Path(tmp) / "nope")
            self.assertEqual(status.availability, "NOT_AVAILABLE")
            self.assertIsNone(status.packet_path)
            self.assertEqual(status.to_dict()["external_execution"], "not_performed")
            self.assertEqual(status.to_dict()["mode"], "replay")

    def test_not_available_with_empty_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            status = re_.resolve_replay_packet(env={}, replay_dir=Path(tmp))
            self.assertEqual(status.availability, "NOT_AVAILABLE")

    def test_candidate_found_with_newest_file_in_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            older = Path(tmp) / "older.json"
            newer = Path(tmp) / "newer.json"
            older.write_text("{}")
            time.sleep(0.02)
            newer.write_text("{}")
            status = re_.resolve_replay_packet(env={}, replay_dir=Path(tmp))
            self.assertEqual(status.availability, "CANDIDATE_FOUND")
            self.assertEqual(status.packet_path, str(newer))

    def test_env_override_used_when_file_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            packet = Path(tmp) / "packet.bin"
            packet.write_text("anything")
            status = re_.resolve_replay_packet(env={re_.REPLAY_PACKET_ENV: str(packet)})
            self.assertEqual(status.availability, "CANDIDATE_FOUND")
            self.assertEqual(status.packet_path, str(packet))

    def test_env_override_missing_file_is_not_available(self) -> None:
        status = re_.resolve_replay_packet(env={re_.REPLAY_PACKET_ENV: "/nonexistent/packet.bin"})
        self.assertEqual(status.availability, "NOT_AVAILABLE")
        self.assertIsNone(status.packet_path)

    def test_never_reads_or_parses_the_candidate_file(self) -> None:
        # Regression guard: a candidate file containing garbage must not
        # raise -- resolve_replay_packet never opens/parses it.
        with tempfile.TemporaryDirectory() as tmp:
            packet = Path(tmp) / "garbage.bin"
            packet.write_bytes(b"\xff\xfe\x00not json or any known schema")
            status = re_.resolve_replay_packet(env={re_.REPLAY_PACKET_ENV: str(packet)})
            self.assertEqual(status.availability, "CANDIDATE_FOUND")

    def test_no_fabricated_schema_language_in_not_available_detail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            status = re_.resolve_replay_packet(env={}, replay_dir=Path(tmp) / "nope")
            self.assertIn("does not exist yet", status.detail)


if __name__ == "__main__":
    unittest.main()
