#!/usr/bin/env python3
"""Unit tests for supervisor.py's I1 DEMO-SUPERVISOR-CONVERGE0 unified report.

Pure logic + bounded local filesystem/port probes -- no real Chrome, no real
acquisition/authoring/countergraph process, no real network egress assumed.
Run:
  python3 tools/counterpedia-local/test_supervisor.py -v
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preflight  # noqa: E402
import supervisor  # noqa: E402


class ServerSideAuthTests(unittest.TestCase):
    def test_absent_when_env_var_unset(self) -> None:
        line = supervisor.check_server_side_auth({})
        self.assertEqual(line.status, "absent")
        self.assertFalse(line.ok)

    def test_configured_when_env_var_set_and_value_never_echoed(self) -> None:
        secret_path = "/run/secrets/super-secret-signing-key-do-not-print.pem"
        line = supervisor.check_server_side_auth({supervisor.SERVER_SIDE_AUTH_ENV_VAR: secret_path})
        self.assertEqual(line.status, "configured")
        self.assertTrue(line.ok)
        # The value itself must never appear anywhere in the reported line.
        rendered = str(line.to_dict())
        self.assertNotIn(secret_path, rendered)

    def test_absent_when_env_var_blank(self) -> None:
        line = supervisor.check_server_side_auth({supervisor.SERVER_SIDE_AUTH_ENV_VAR: "   "})
        self.assertEqual(line.status, "absent")


class HttpReachabilityTests(unittest.TestCase):
    def test_counterpedia_web_not_ready_when_unreachable(self) -> None:
        line = supervisor.check_counterpedia_web("http://127.0.0.1:1/")  # port 1: refused, deterministic
        self.assertEqual(line.status, "not_ready")
        self.assertFalse(line.ok)

    def test_countergraph_query_not_ready_when_unreachable(self) -> None:
        line = supervisor.check_countergraph_query("http://127.0.0.1:1/health")
        self.assertEqual(line.status, "not_ready")
        self.assertFalse(line.ok)

    def test_countergraph_mcp_health_not_ready_when_unreachable(self) -> None:
        line = supervisor.check_countergraph_mcp_health("http://127.0.0.1:1/health")
        self.assertEqual(line.status, "not_ready")
        self.assertFalse(line.ok)


class NetworkArtifactsDelegationTests(unittest.TestCase):
    def test_not_evaluated_when_counterpedia_repo_not_found(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            line = supervisor.check_network_artifacts(Path(tmp) / "does-not-exist")
            self.assertEqual(line.status, "not_evaluated")
            self.assertFalse(line.ok)
            self.assertIn("not found", line.detail)


class ProfileDefinitionTests(unittest.TestCase):
    def test_capture_demo_equals_frozen_pitch_ready_gate_verbatim(self) -> None:
        # This is the load-bearing assertion: capture_demo must be the exact
        # same set as preflight.REQUIRED_FOR_PITCH_READY -- not a redefinition.
        self.assertEqual(supervisor.CAPTURE_DEMO, preflight.REQUIRED_FOR_PITCH_READY)

    def test_authoring_demo_is_capture_demo_plus_authoring_only(self) -> None:
        self.assertEqual(supervisor.AUTHORING_DEMO - supervisor.CAPTURE_DEMO, {"authoring"})

    def test_canonical_pitch_is_union_of_all_named_profiles(self) -> None:
        union = (
            supervisor.CAPTURE_DEMO
            | supervisor.AUTHORING_DEMO
            | supervisor.NETWORK_REPLAY_DEMO
            | supervisor.LIVE_GRAPH_DEMO
        )
        self.assertEqual(supervisor.CANONICAL_PITCH, union)

    def test_profiles_dict_has_exactly_five_named_profiles(self) -> None:
        self.assertEqual(
            set(supervisor.PROFILES),
            {"capture_demo", "authoring_demo", "network_replay_demo", "live_graph_demo", "canonical_pitch"},
        )


class BuildSupervisorReportTests(unittest.TestCase):
    def test_pitch_ready_unchanged_matches_bare_preflight_call_exactly(self) -> None:
        """Before/after proof: the SAME env produces the SAME pitch_ready
        verdict whether computed by preflight.py alone or read off the
        supervisor's composed report -- the existing contract's truth
        conditions are not altered by this additive layer."""
        with tempfile.TemporaryDirectory() as tmp:
            ext_root = Path(tmp)
            acquisition_dir = Path(tmp) / "acq"
            authoring_dir = Path(tmp) / "authoring"
            store_root = Path(tmp) / "store"

            before = preflight.build_preflight_report(
                ext_root=ext_root,
                acquisition_dir=acquisition_dir,
                authoring_dir=authoring_dir,
                store_root=store_root,
                env={},
            )
            after = supervisor.build_supervisor_report(
                ext_root=ext_root,
                acquisition_dir=acquisition_dir,
                authoring_dir=authoring_dir,
                store_root=store_root,
                env={},
                counterpedia_repo_dir=Path(tmp) / "no-counterpedia-here",
                skip_network_artifacts=True,
            )
            self.assertEqual(before["pitch_ready"], after["pitch_ready"])
            self.assertFalse(after["pitch_ready"])  # nothing up in this sandbox tmp dir

    def test_report_contains_all_new_component_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = supervisor.build_supervisor_report(
                ext_root=Path(tmp),
                acquisition_dir=Path(tmp) / "acq",
                authoring_dir=Path(tmp) / "authoring",
                store_root=Path(tmp) / "store",
                env={},
                counterpedia_repo_dir=Path(tmp) / "no-counterpedia-here",
                skip_network_artifacts=True,
            )
            for key in (
                "chrome_for_testing",
                "extension",
                "counterpedia_local",
                "acquisition",
                "recovery",
                "authoring",
                "demo_artifacts",
                "counterpedia_web",
                "network_artifacts",
                "countergraph_query",
                "countergraph_mcp_health",
                "server_side_auth",
            ):
                self.assertIn(key, report["lines"])

    def test_canonical_pitch_not_ready_when_nothing_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = supervisor.build_supervisor_report(
                ext_root=Path(tmp),
                acquisition_dir=Path(tmp) / "acq",
                authoring_dir=Path(tmp) / "authoring",
                store_root=Path(tmp) / "store",
                env={},
                counterpedia_repo_dir=Path(tmp) / "no-counterpedia-here",
                skip_network_artifacts=True,
            )
            self.assertFalse(report["profiles"]["canonical_pitch"]["ready"])
            self.assertFalse(report["profiles"]["live_graph_demo"]["ready"])
            self.assertIn("server_side_auth", report["profiles"]["live_graph_demo"]["missing"])

    def test_no_secret_value_anywhere_in_report_even_when_env_var_set(self) -> None:
        secret_path = "/run/secrets/never-print-this-signing-key.pem"
        with tempfile.TemporaryDirectory() as tmp:
            report = supervisor.build_supervisor_report(
                ext_root=Path(tmp),
                acquisition_dir=Path(tmp) / "acq",
                authoring_dir=Path(tmp) / "authoring",
                store_root=Path(tmp) / "store",
                env={supervisor.SERVER_SIDE_AUTH_ENV_VAR: secret_path},
                counterpedia_repo_dir=Path(tmp) / "no-counterpedia-here",
                skip_network_artifacts=True,
            )
            import json

            rendered = json.dumps(report)
            self.assertNotIn(secret_path, rendered)
            self.assertEqual(report["lines"]["server_side_auth"]["status"], "configured")


if __name__ == "__main__":
    unittest.main()
