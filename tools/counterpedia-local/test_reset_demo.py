#!/usr/bin/env python3
"""Unit tests for reset_demo.py's ownership-scoped RESET DEMO.

Covers pure planning/classification (no process spawned, no filesystem
touched) plus a hostile end-to-end proof: a real supervisor-owned child is
stopped, a real foreign-signature-mismatch pid is refused (never killed),
and the retained custody root survives a default reset while a genuinely
ephemeral profile/state file are cleared.

Run: python3 tools/counterpedia-local/test_reset_demo.py -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reset_demo as rd  # noqa: E402


class SessionStateRoundTripTests(unittest.TestCase):
    def test_write_then_load_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state" / "demo-session.json"
            rd.write_session_state(path, 111, "sig-a", 222, "sig-b", "/tmp/profile", "2026-08-28T00:00:00Z")
            loaded = rd.load_session_state(path)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["local_pid"], 111)
            self.assertEqual(loaded["demo_browser_pid"], 222)
            self.assertEqual(loaded["schema_version"], rd.SESSION_STATE_SCHEMA)

    def test_load_missing_file_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(rd.load_session_state(Path(tmp) / "nope.json"))

    def test_load_malformed_json_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{not json")
            self.assertIsNone(rd.load_session_state(path))

    def test_load_wrong_shape_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text(json.dumps({"local_pid": 1}))
            self.assertIsNone(rd.load_session_state(path))

    def test_load_wrong_schema_version_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            payload = {
                "schema_version": "some.other.v9",
                "local_pid": 1,
                "local_cmd_signature": "x",
                "demo_browser_pid": 2,
                "demo_browser_cmd_signature": "y",
                "demo_profile_dir": "/tmp/z",
                "started_at": "now",
            }
            path.write_text(json.dumps(payload))
            self.assertIsNone(rd.load_session_state(path))


class ClassifyTrackedProcessTests(unittest.TestCase):
    def test_owned_stop_when_signature_matches(self) -> None:
        d = rd.classify_tracked_process("role", 100, "counterpedia_local_operator.py", "/usr/bin/python3 counterpedia_local_operator.py")
        self.assertEqual(d.classification, "owned_stop")

    def test_foreign_signature_mismatch_when_signature_differs(self) -> None:
        d = rd.classify_tracked_process("role", 100, "counterpedia_local_operator.py", "/usr/bin/some-other-daemon --flag")
        self.assertEqual(d.classification, "foreign_signature_mismatch")

    def test_already_exited_when_no_live_command(self) -> None:
        d = rd.classify_tracked_process("role", 100, "sig", None)
        self.assertEqual(d.classification, "already_exited")

    def test_not_tracked_when_pid_missing(self) -> None:
        d = rd.classify_tracked_process("role", None, "sig", "anything")
        self.assertEqual(d.classification, "not_tracked")

    def test_not_tracked_when_signature_missing(self) -> None:
        d = rd.classify_tracked_process("role", 100, "", "anything")
        self.assertEqual(d.classification, "not_tracked")


class BuildResetPlanTests(unittest.TestCase):
    def _state(self, **overrides):
        base = {
            "schema_version": rd.SESSION_STATE_SCHEMA,
            "local_pid": 100,
            "local_cmd_signature": "counterpedia_local_operator.py",
            "demo_browser_pid": 200,
            "demo_browser_cmd_signature": "--user-data-dir=/tmp/demo-profile",
            "demo_profile_dir": "/tmp/demo-profile",
            "started_at": "2026-08-28T00:00:00Z",
        }
        base.update(overrides)
        return base

    def test_no_state_means_no_processes_but_still_removes_default_profile(self) -> None:
        plan = rd.build_reset_plan(None, {}, purge_custody=False)
        self.assertEqual(plan.processes, [])
        self.assertEqual(plan.profile_dir, rd.DEMO_PROFILE_DIR)
        self.assertTrue(plan.remove_profile)
        self.assertIsNone(plan.custody_root)
        self.assertFalse(plan.remove_custody)

    def test_owned_processes_planned_to_stop(self) -> None:
        state = self._state()
        live = {
            100: "/usr/bin/python3 counterpedia_local_operator.py",
            200: "/path/Google Chrome for Testing --user-data-dir=/tmp/demo-profile --load-extension=/dist",
        }
        plan = rd.build_reset_plan(state, live, purge_custody=False)
        classes = {p.role: p.classification for p in plan.processes}
        self.assertEqual(classes["counterpedia_local"], "owned_stop")
        self.assertEqual(classes["demo_browser"], "owned_stop")
        self.assertEqual(str(plan.profile_dir), "/tmp/demo-profile")

    def test_foreign_pid_never_planned_to_stop(self) -> None:
        state = self._state()
        live = {100: "/usr/sbin/unrelated-system-daemon", 200: "/usr/bin/vim notes.txt"}
        plan = rd.build_reset_plan(state, live, purge_custody=False)
        classes = {p.role: p.classification for p in plan.processes}
        self.assertEqual(classes["counterpedia_local"], "foreign_signature_mismatch")
        self.assertEqual(classes["demo_browser"], "foreign_signature_mismatch")

    def test_purge_custody_false_by_default_leaves_custody_root_none(self) -> None:
        plan = rd.build_reset_plan(self._state(), {}, purge_custody=False)
        self.assertIsNone(plan.custody_root)
        self.assertFalse(plan.remove_custody)

    def test_purge_custody_true_sets_custody_root(self) -> None:
        plan = rd.build_reset_plan(
            self._state(), {}, purge_custody=True, custody_root=Path("/tmp/some-custody-root")
        )
        self.assertEqual(plan.custody_root, Path("/tmp/some-custody-root"))
        self.assertTrue(plan.remove_custody)


class ExecuteResetPlanDryRunTests(unittest.TestCase):
    def test_dry_run_reports_but_does_not_touch_filesystem(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile = Path(tmp) / "profile"
            profile.mkdir()
            (profile / "marker").write_text("x")
            state_path = Path(tmp) / "state.json"
            state_path.write_text("{}")
            plan = rd.ResetPlan(
                processes=[],
                profile_dir=profile,
                remove_profile=True,
                custody_root=None,
                remove_custody=False,
                state_path=state_path,
                remove_state=True,
            )
            result = rd.execute_reset_plan(plan, dry_run=True)
            self.assertTrue(result["profile_removed"])  # reported as planned
            self.assertTrue(profile.is_dir())  # but NOT actually removed
            self.assertTrue(state_path.is_file())

    def test_real_run_removes_profile_and_state_leaves_custody_alone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile = Path(tmp) / "profile"
            profile.mkdir()
            custody = Path(tmp) / "custody"
            custody.mkdir()
            (custody / "capture.json").write_text("{}")
            state_path = Path(tmp) / "state.json"
            state_path.write_text("{}")
            plan = rd.ResetPlan(
                processes=[],
                profile_dir=profile,
                remove_profile=True,
                custody_root=None,
                remove_custody=False,
                state_path=state_path,
                remove_state=True,
            )
            result = rd.execute_reset_plan(plan, dry_run=False)
            self.assertFalse(profile.exists())
            self.assertFalse(state_path.exists())
            self.assertTrue(custody.is_dir())
            self.assertTrue((custody / "capture.json").is_file())


class HostileEndToEndResetTests(unittest.TestCase):
    """Real subprocess proof: owned child is actually stopped; a pid whose
    live command doesn't match the recorded signature is refused (never
    killed); retained custody survives a default (non-purge) reset."""

    def test_owned_child_stopped_foreign_refused_custody_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            profile = tmp_path / "profile"
            profile.mkdir()
            custody = tmp_path / "custody"
            custody.mkdir()
            (custody / "capture-registry.json").write_text('{"kept": true}')
            state_path = tmp_path / "state.json"

            # A real, supervisor-owned long-lived child.
            owned = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(60)"],
            )
            # A second, genuinely unrelated real process standing in for
            # "the OS reused this pid" -- classified purely by live command
            # content, so any live process whose command does not contain
            # the recorded signature proves the guard without needing an
            # actual pid-reuse race.
            foreign = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(60)"],
            )
            try:
                time.sleep(0.2)  # let both children actually start
                rd.write_session_state(
                    state_path,
                    owned.pid,
                    "sleep(60)",  # matches: owned's argv contains this
                    foreign.pid,
                    "signature-that-will-never-appear-in-argv",  # never matches foreign's real argv
                    str(profile),
                    "2026-08-28T00:00:00Z",
                )
                state = rd.load_session_state(state_path)
                self.assertIsNotNone(state)
                live_commands = rd.get_live_commands()
                plan = rd.build_reset_plan(
                    state, live_commands, purge_custody=False, state_path=state_path, custody_root=custody
                )
                result = rd.execute_reset_plan(plan, dry_run=False)

                self.assertEqual(len(result["stopped"]), 1)
                self.assertEqual(result["stopped"][0]["pid"], owned.pid)
                self.assertEqual(len(result["refused"]), 1)
                self.assertEqual(result["refused"][0]["pid"], foreign.pid)

                # owned really terminated
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline and owned.poll() is None:
                    time.sleep(0.1)
                self.assertIsNotNone(owned.poll(), "owned child was not actually stopped")

                # foreign was NEVER touched -- still alive
                self.assertIsNone(foreign.poll(), "foreign-signature-mismatch pid must never be killed")

                # custody untouched (no --purge-custody)
                self.assertTrue(custody.is_dir())
                self.assertTrue((custody / "capture-registry.json").is_file())
                self.assertFalse(result["custody_removed"])

                # ephemeral profile + state ARE cleared
                self.assertFalse(profile.exists())
                self.assertFalse(state_path.exists())
            finally:
                for proc in (owned, foreign):
                    if proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait(timeout=3)


class RecordSessionCliParsingTests(unittest.TestCase):
    """Regression guard: argparse treats a positional arg starting with '--'
    as an unrecognized option, which silently ate started_at when the demo
    browser signature was recorded as '--user-data-dir=...'. The launcher
    now records 'user-data-dir=...' (no leading dashes) precisely to avoid
    this; this test pins that CLI shape parses correctly."""

    def test_record_session_argv_shape_used_by_the_launcher_parses(self) -> None:
        args = rd.build_parser().parse_args(
            [
                "record-session",
                "123",
                "counterpedia_local_operator.py",
                "456",
                "user-data-dir=/tmp/demo-profile",
                "/tmp/demo-profile",
                "2026-08-28T00:00:00Z",
            ]
        )
        self.assertEqual(args.command, "record-session")
        self.assertEqual(args.local_pid, 123)
        self.assertEqual(args.demo_browser_pid, 456)
        self.assertEqual(args.started_at, "2026-08-28T00:00:00Z")

    def test_leading_double_dash_signature_would_break_parsing(self) -> None:
        # Documents *why* the launcher avoids a leading '--' in the recorded
        # signature: argparse consumes it as an option and started_at is
        # dropped from the parsed args (this is the historical bug, kept as
        # an explicit regression trap).
        with self.assertRaises(SystemExit):
            rd.build_parser().parse_args(
                [
                    "record-session",
                    "123",
                    "counterpedia_local_operator.py",
                    "456",
                    "--user-data-dir=/tmp/demo-profile",
                    "/tmp/demo-profile",
                    "2026-08-28T00:00:00Z",
                ]
            )


class GetLiveCommandsTests(unittest.TestCase):
    def test_returns_a_dict_including_this_test_process(self) -> None:
        commands = rd.get_live_commands()
        self.assertIsInstance(commands, dict)
        self.assertIn(os.getpid(), commands)


if __name__ == "__main__":
    unittest.main()
