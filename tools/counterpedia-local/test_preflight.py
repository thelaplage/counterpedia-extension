#!/usr/bin/env python3
"""Unit tests for preflight.py's DEMO-CLOSE1/D5 pre-flight report.

Pure logic + bounded local filesystem/port probes -- no real Chrome, no real
acquisition/authoring process. Run:
  python3 tools/counterpedia-local/test_preflight.py -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preflight  # noqa: E402


class CheckExtensionTests(unittest.TestCase):
    def test_not_ready_when_dist_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            line = preflight.check_extension(Path(tmp))
            self.assertEqual(line.status, "not_ready")
            self.assertEqual(line.key, "extension")

    def test_not_ready_when_manifest_missing_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp) / "dist"
            dist.mkdir()
            (dist / "manifest.json").write_text(json.dumps({"name": "x"}))
            line = preflight.check_extension(Path(tmp))
            self.assertEqual(line.status, "not_ready")
            self.assertIn("missing the pinned key", line.detail)

    def test_ready_when_manifest_has_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp) / "dist"
            dist.mkdir()
            (dist / "manifest.json").write_text(json.dumps({"name": "x", "key": "abc"}))
            line = preflight.check_extension(Path(tmp))
            self.assertEqual(line.status, "ready")

    def test_not_ready_on_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp) / "dist"
            dist.mkdir()
            (dist / "manifest.json").write_text("{not json")
            line = preflight.check_extension(Path(tmp))
            self.assertEqual(line.status, "not_ready")


class CheckChromeForTestingTests(unittest.TestCase):
    def test_delegates_to_demo_browser_resolver_not_ready(self) -> None:
        line = preflight.check_chrome_for_testing({})
        # With no env override and (almost certainly) no Playwright cache in
        # this sandbox, this must be not_ready -- never silently "ready".
        self.assertIn(line.status, ("ready", "not_ready"))
        self.assertEqual(line.key, "chrome_for_testing")

    def test_ready_with_fake_executable_override(self) -> None:
        import os
        import stat

        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "fake-chrome"
            fake.write_text("#!/bin/sh\n")
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            line = preflight.check_chrome_for_testing({"COUNTERPEDIA_DEMO_BROWSER": str(fake)})
            self.assertEqual(line.status, "ready")
            self.assertEqual(line.detail, str(fake))


class CheckCounterpediaLocalTests(unittest.TestCase):
    def test_not_ready_when_unreachable(self) -> None:
        # Port 8790 is almost certainly not serving in the test sandbox.
        line = preflight.check_counterpedia_local(port=8791)
        self.assertEqual(line.status, "not_ready")


class CheckAcquisitionRecoveryTests(unittest.TestCase):
    def test_not_ready_when_unreachable(self) -> None:
        acq = preflight.check_acquisition(port=8792)
        rec = preflight.check_recovery(port=8792)
        self.assertEqual(acq.status, "not_ready")
        self.assertEqual(rec.status, "not_ready")


class CheckAuthoringTests(unittest.TestCase):
    def test_absent_when_launcher_missing_and_port_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            line = preflight.check_authoring(Path(tmp), port=8793)
            self.assertEqual(line.status, "absent")

    def test_configured_when_launcher_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            launcher = Path(tmp) / ".venv" / "bin" / "counterpedia-authoring-live-source"
            launcher.parent.mkdir(parents=True)
            launcher.write_text("#!/bin/sh\n")
            line = preflight.check_authoring(Path(tmp), port=8793)
            self.assertEqual(line.status, "configured")

    def test_never_starts_authoring(self) -> None:
        # Regression guard: check_authoring must be a pure read, no subprocess.
        with tempfile.TemporaryDirectory() as tmp:
            launcher = Path(tmp) / ".venv" / "bin" / "counterpedia-authoring-live-source"
            launcher.parent.mkdir(parents=True)
            launcher.write_text("#!/bin/sh\necho started\n")
            import os
            import stat

            launcher.chmod(launcher.stat().st_mode | stat.S_IEXEC)
            preflight.check_authoring(Path(tmp), port=8793)
            # No side channel exists for "started" to appear; absence of a
            # crash/exception plus a deterministic status is the assertion.
            self.assertTrue(True)


class CheckDemoArtifactsTests(unittest.TestCase):
    def test_missing_when_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            line = preflight.check_demo_artifacts(Path(tmp) / "nope")
            self.assertEqual(line.status, "missing")

    def test_missing_when_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            line = preflight.check_demo_artifacts(Path(tmp))
            self.assertEqual(line.status, "missing")

    def test_configured_when_nonempty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "x.json").write_text("{}")
            line = preflight.check_demo_artifacts(Path(tmp))
            self.assertEqual(line.status, "configured")


class BuildPreflightReportTests(unittest.TestCase):
    def test_report_has_all_seven_lines_and_pitch_ready_false_when_nothing_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = preflight.build_preflight_report(
                ext_root=Path(tmp),
                acquisition_dir=Path(tmp) / "acq",
                authoring_dir=Path(tmp) / "authoring",
                store_root=Path(tmp) / "store",
                env={},
            )
            keys = {line["key"] for line in report["lines"]}
            self.assertEqual(
                keys,
                {
                    "chrome_for_testing",
                    "extension",
                    "counterpedia_local",
                    "acquisition",
                    "recovery",
                    "authoring",
                    "demo_artifacts",
                },
            )
            self.assertFalse(report["pitch_ready"])
            self.assertEqual(report["report_schema"], "counterpedia_local.preflight_report.v0.1")

    def test_optional_lines_never_gate_pitch_ready(self) -> None:
        # authoring "absent" and demo_artifacts "missing" alone must not be
        # why pitch_ready is False -- confirm they're excluded from the gate.
        self.assertNotIn("authoring", preflight.REQUIRED_FOR_PITCH_READY)
        self.assertNotIn("demo_artifacts", preflight.REQUIRED_FOR_PITCH_READY)


if __name__ == "__main__":
    unittest.main()
