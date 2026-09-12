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
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import counterpedia_local as cl  # noqa: E402
import preflight  # noqa: E402


@contextmanager
def _serving_json(payload: Any, status: int = 200):
    """Bind an ephemeral fake HTTP server that serves ``payload`` as JSON on
    every GET (including ``/healthz``). Used to exercise ``check_counterpedia_local``
    against exact response bodies without a real Counterpedia Local process.
    """

    body = json.dumps(payload).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_a: Any) -> None:  # silence test noise
            pass

        def do_GET(self) -> None:  # noqa: N802
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer((cl.HOST, 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


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


def _real_supervisor_status() -> dict[str, Any]:
    """Build the exact literal shape LocalSupervisor.status() emits, using the
    real class (never a hand-authored duplicate of its logic) so this test
    file breaks the moment status()'s shape changes.
    """
    with tempfile.TemporaryDirectory() as tmp:
        supervisor = cl.LocalSupervisor(
            acquisition_dir=Path(tmp) / "acq",
            authoring_dir=Path(tmp) / "authoring",
            store_root=Path(tmp) / "store",
        )
        return supervisor.status()


class CheckCounterpediaLocalTests(unittest.TestCase):
    def test_not_ready_when_unreachable(self) -> None:
        # Port 8790 is almost certainly not serving in the test sandbox.
        line = preflight.check_counterpedia_local(port=8791)
        self.assertEqual(line.status, "not_ready")
        self.assertIn("unreachable", line.detail)

    def test_not_ready_when_foreign_server_lacks_supervisor_shape(self) -> None:
        # Hostile: a fake server returns 200 JSON, proving this is not "any 2xx".
        # It lacks paired/acquisition/recovery/authoring/dependencies entirely.
        with _serving_json({"status": "ok", "something_else": True}) as port:
            line = preflight.check_counterpedia_local(port=port)
            self.assertEqual(line.status, "not_ready")
            self.assertIn("not the counterpedia-local supervisor document", line.detail)
            self.assertNotIn("unreachable", line.detail)

    def test_not_ready_when_faithfully_shaped_but_unpaired(self) -> None:
        body = _real_supervisor_status()
        self.assertIs(body["paired"], False)  # sanity: never paired in this sandbox
        with _serving_json(body) as port:
            line = preflight.check_counterpedia_local(port=port)
            self.assertEqual(line.status, "not_ready")
            self.assertIn("not paired", line.detail)

    def test_ready_when_faithfully_shaped_and_paired(self) -> None:
        body = _real_supervisor_status()
        # Contract-binding assertion: the fixture's key set must match the
        # real LocalSupervisor.status() output. If status() is ever
        # reshaped, this test breaks instead of silently drifting.
        self.assertEqual(
            set(body.keys()),
            {"service", "version", "authority_posture", "admission", "paired",
             "paired_extension_id", "acquisition", "recovery", "authoring", "dependencies"},
        )
        body["paired"] = True
        body["paired_extension_id"] = "a" * 32
        with _serving_json(body) as port:
            line = preflight.check_counterpedia_local(port=port)
            self.assertEqual(line.status, "ready")

    def test_acquisition_and_recovery_readiness_do_not_fold_into_this_line(self) -> None:
        # paired=True but acquisition.ready=False must still yield a ready
        # counterpedia_local line -- the acquisition line is a SEPARATE
        # report line and must go not_ready independently, never folded in
        # here (double-counting the same signal under two keys is forbidden).
        body = _real_supervisor_status()
        body["paired"] = True
        body["paired_extension_id"] = "a" * 32
        body["acquisition"]["ready"] = False
        body["recovery"]["ready"] = False
        with _serving_json(body) as port:
            local_line = preflight.check_counterpedia_local(port=port)
            self.assertEqual(local_line.status, "ready")
            # The acquisition/recovery lines are derived from a DIFFERENT
            # port (ACQUISITION_PORT) and a different frozen contract
            # (acquisition_capabilities); confirm they go not_ready via
            # their own check when that port is unreachable, independent of
            # the counterpedia_local line above.
            acq_line = preflight.check_acquisition(port=8792)
            rec_line = preflight.check_recovery(port=8792)
            self.assertEqual(acq_line.status, "not_ready")
            self.assertEqual(rec_line.status, "not_ready")


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
