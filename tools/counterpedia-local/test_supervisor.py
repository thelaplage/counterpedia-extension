#!/usr/bin/env python3
"""Unit tests for supervisor.py's additive readiness profiles.

Pure logic + bounded local probes; no real Chrome or external service is
required. Run:
  python3 tools/counterpedia-local/test_supervisor.py -v
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import preflight
import supervisor


class ServerSideAuthTests(unittest.TestCase):
    def test_absent_when_env_var_unset(self) -> None:
        line = supervisor.check_server_side_auth({})
        self.assertEqual(line.status, "absent")
        self.assertFalse(line.ok)

    def test_configured_when_env_var_set_and_value_never_echoed(self) -> None:
        secret_path = "/run/secrets/super-secret-signing-key-do-not-print.pem"
        line = supervisor.check_server_side_auth(
            {supervisor.SERVER_SIDE_AUTH_ENV_VAR: secret_path}
        )
        self.assertEqual(line.status, "configured")
        self.assertTrue(line.ok)
        self.assertNotIn(secret_path, str(line.to_dict()))

    def test_absent_when_env_var_blank(self) -> None:
        line = supervisor.check_server_side_auth(
            {supervisor.SERVER_SIDE_AUTH_ENV_VAR: "   "}
        )
        self.assertEqual(line.status, "absent")


class HttpReachabilityTests(unittest.TestCase):
    def test_counterpedia_web_not_ready_when_unreachable(self) -> None:
        line = supervisor.check_counterpedia_web("http://127.0.0.1:1/")
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


class CanonicalReaderReadinessTests(unittest.TestCase):
    def test_reader_not_ready_when_exact_route_probe_fails(self) -> None:
        with mock.patch.object(supervisor.reader_demo, "probe_reader", return_value=False):
            line = supervisor.check_counterpedia_reader()
        self.assertEqual(line.status, "not_ready")
        self.assertFalse(line.ok)
        self.assertEqual(line.detail, supervisor.reader_demo.READER_URL)

    def test_reader_ready_only_from_exact_route_probe(self) -> None:
        with mock.patch.object(supervisor.reader_demo, "probe_reader", return_value=True):
            line = supervisor.check_counterpedia_reader()
        self.assertEqual(line.status, "ready")
        self.assertTrue(line.ok)


class NetworkArtifactsDelegationTests(unittest.TestCase):
    def test_not_evaluated_when_counterpedia_repo_not_found(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            line = supervisor.check_network_artifacts(Path(tmp) / "does-not-exist")
            self.assertEqual(line.status, "not_evaluated")
            self.assertFalse(line.ok)
            self.assertIn("not found", line.detail)


class ProfileDefinitionTests(unittest.TestCase):
    def test_capture_demo_equals_frozen_pitch_ready_gate_verbatim(self) -> None:
        self.assertEqual(supervisor.CAPTURE_DEMO, preflight.REQUIRED_FOR_PITCH_READY)

    def test_authoring_demo_is_capture_demo_plus_authoring_only(self) -> None:
        self.assertEqual(
            supervisor.AUTHORING_DEMO - supervisor.CAPTURE_DEMO,
            {"authoring"},
        )

    def test_draft_from_source_demo_adds_only_authoring_and_canonical_reader(self) -> None:
        self.assertEqual(
            supervisor.DRAFT_FROM_SOURCE_DEMO - supervisor.CAPTURE_DEMO,
            {"authoring", "counterpedia_reader"},
        )

    def test_canonical_pitch_is_union_of_all_named_product_profiles(self) -> None:
        union = (
            supervisor.CAPTURE_DEMO
            | supervisor.AUTHORING_DEMO
            | supervisor.DRAFT_FROM_SOURCE_DEMO
            | supervisor.NETWORK_REPLAY_DEMO
            | supervisor.LIVE_GRAPH_DEMO
        )
        self.assertEqual(supervisor.CANONICAL_PITCH, union)

    def test_profiles_dict_has_exactly_six_named_profiles(self) -> None:
        self.assertEqual(
            set(supervisor.PROFILES),
            {
                "capture_demo",
                "authoring_demo",
                "draft_from_source_demo",
                "network_replay_demo",
                "live_graph_demo",
                "canonical_pitch",
            },
        )


class BuildSupervisorReportTests(unittest.TestCase):
    def _build(self, tmp: str) -> dict:
        with mock.patch.object(supervisor.reader_demo, "probe_reader", return_value=False):
            return supervisor.build_supervisor_report(
                ext_root=Path(tmp),
                acquisition_dir=Path(tmp) / "acq",
                authoring_dir=Path(tmp) / "authoring",
                store_root=Path(tmp) / "store",
                env={},
                counterpedia_repo_dir=Path(tmp) / "no-counterpedia-here",
                skip_network_artifacts=True,
            )

    def test_pitch_ready_unchanged_matches_bare_preflight_call_exactly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            before = preflight.build_preflight_report(
                ext_root=Path(tmp),
                acquisition_dir=Path(tmp) / "acq",
                authoring_dir=Path(tmp) / "authoring",
                store_root=Path(tmp) / "store",
                env={},
            )
            after = self._build(tmp)
            self.assertEqual(before["pitch_ready"], after["pitch_ready"])
            self.assertFalse(after["pitch_ready"])

    def test_report_contains_canonical_reader_component(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = self._build(tmp)
            for key in (
                "chrome_for_testing",
                "extension",
                "counterpedia_local",
                "acquisition",
                "recovery",
                "authoring",
                "demo_artifacts",
                "counterpedia_web",
                "counterpedia_reader",
                "network_artifacts",
                "countergraph_query",
                "countergraph_mcp_health",
                "server_side_auth",
            ):
                self.assertIn(key, report["lines"])

    def test_draft_from_source_profile_names_reader_when_reader_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = self._build(tmp)
            profile = report["profiles"]["draft_from_source_demo"]
            self.assertFalse(profile["ready"])
            self.assertIn("counterpedia_reader", profile["missing"])
            self.assertIn("authoring", profile["missing"])

    def test_canonical_pitch_not_ready_when_nothing_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = self._build(tmp)
            self.assertFalse(report["profiles"]["canonical_pitch"]["ready"])
            self.assertFalse(report["profiles"]["live_graph_demo"]["ready"])
            self.assertIn(
                "server_side_auth", report["profiles"]["live_graph_demo"]["missing"]
            )

    def test_no_secret_value_anywhere_in_report_even_when_env_var_set(self) -> None:
        import json

        secret_path = "/run/secrets/never-print-this-signing-key.pem"
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(
                supervisor.reader_demo, "probe_reader", return_value=False
            ):
                report = supervisor.build_supervisor_report(
                    ext_root=Path(tmp),
                    acquisition_dir=Path(tmp) / "acq",
                    authoring_dir=Path(tmp) / "authoring",
                    store_root=Path(tmp) / "store",
                    env={supervisor.SERVER_SIDE_AUTH_ENV_VAR: secret_path},
                    counterpedia_repo_dir=Path(tmp) / "no-counterpedia-here",
                    skip_network_artifacts=True,
                )
            rendered = json.dumps(report)
            self.assertNotIn(secret_path, rendered)
            self.assertEqual(
                report["lines"]["server_side_auth"]["status"], "configured"
            )


if __name__ == "__main__":
    unittest.main()
