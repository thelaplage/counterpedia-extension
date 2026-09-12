from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import demo_kit_runtime as runtime


class DemoKitRuntimeAffinityTests(unittest.TestCase):
    def _terminal_state(self, terminal_dir: Path) -> dict[str, object]:
        return {
            "schema_version": runtime.TERMINAL_STATE_SCHEMA,
            "pid": 101,
            "cmd_signature": "terminal-signature",
            "terminal_dir": str(terminal_dir),
            "started_at": "2026-09-12T00:00:00Z",
        }

    def _reader_state(self, repo_dir: Path) -> dict[str, object]:
        return {
            "schema_version": "counterpedia_local.reader_session.v0.1",
            "pid": 202,
            "cmd_signature": "reader-signature",
            "repo_dir": str(repo_dir),
            "started_at": "2026-09-12T00:00:00Z",
        }

    def test_terminal_reuse_refuses_other_bundle_component(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            expected = root / "new" / "counterpedia-console"
            other = root / "old" / "counterpedia-console"
            state = self._terminal_state(other)
            with (
                mock.patch.object(runtime, "_terminal_ready", return_value=True),
                mock.patch.object(runtime, "_load_terminal_state", return_value=state),
            ):
                with self.assertRaisesRegex(
                    runtime.DemoKitRuntimeError,
                    "DEMO_RUNTIME_AFFINITY_REFUSED.*Terminal",
                ):
                    runtime._start_terminal(expected)

    def test_terminal_reuse_requires_live_signature_and_exact_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            terminal = Path(tmp) / "counterpedia-console"
            state = self._terminal_state(terminal)
            with (
                mock.patch.object(runtime, "_terminal_ready", return_value=True),
                mock.patch.object(runtime, "_load_terminal_state", return_value=state),
                mock.patch.object(
                    runtime.reset_demo,
                    "get_live_commands",
                    return_value={101: "/usr/bin/node terminal-signature"},
                ),
            ):
                started, pid = runtime._start_terminal(terminal)
            self.assertFalse(started)
            self.assertEqual(pid, 101)

    def test_compatible_reader_without_tracked_state_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            expected = Path(tmp) / "counterpedia"
            with (
                mock.patch.object(runtime.reader_demo, "probe_reader", return_value=True),
                mock.patch.object(runtime.reader_demo, "_load_state", return_value=None),
            ):
                with self.assertRaisesRegex(
                    runtime.DemoKitRuntimeError,
                    "compatible Counterpedia reader is live but untracked",
                ):
                    runtime._refuse_reader_reuse_conflict(expected)

    def test_compatible_reader_from_other_bundle_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            expected = root / "new" / "counterpedia"
            state = self._reader_state(root / "old" / "counterpedia")
            with (
                mock.patch.object(runtime.reader_demo, "probe_reader", return_value=True),
                mock.patch.object(runtime.reader_demo, "_load_state", return_value=state),
            ):
                with self.assertRaisesRegex(
                    runtime.DemoKitRuntimeError,
                    "reader belongs to a different bundle component",
                ):
                    runtime._reader_state_affinity(expected)

    def test_reader_affinity_requires_exact_repo_and_live_signature(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            expected = Path(tmp) / "counterpedia"
            state = self._reader_state(expected)
            with (
                mock.patch.object(runtime.reader_demo, "probe_reader", return_value=True),
                mock.patch.object(runtime.reader_demo, "_load_state", return_value=state),
                mock.patch.object(
                    runtime.reset_demo,
                    "get_live_commands",
                    return_value={202: "/tmp/next reader-signature"},
                ),
            ):
                result = runtime._reader_state_affinity(expected)
            self.assertEqual(result["pid"], 202)
            self.assertEqual(Path(result["repo_dir"]), expected.resolve())
            self.assertEqual(result["live_signature"], "matched")

    def test_local_supervisor_dependency_paths_must_match_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            acquisition = root / "counterpedia-acquisition"
            authoring = root / "counterpedia-authoring"
            acq_python = acquisition / ".venv" / "bin" / "python"
            status = {
                "service": "counterpedia-local",
                "dependencies": {
                    "acquisition_dir": str(root / "other-acquisition"),
                    "acquisition_python": str(acq_python),
                    "authoring_dir": str(authoring),
                },
            }
            with mock.patch.object(runtime, "_local_supervisor_status", return_value=status):
                with self.assertRaisesRegex(
                    runtime.DemoKitRuntimeError,
                    "acquisition_dir does not point into this bundle",
                ):
                    runtime._assert_local_affinity(acquisition, acq_python, authoring)

    def test_nested_session_requires_live_local_and_browser_and_exact_profile(self) -> None:
        state = {
            "schema_version": runtime.reset_demo.SESSION_STATE_SCHEMA,
            "local_pid": 303,
            "local_cmd_signature": "local-signature",
            "demo_browser_pid": 404,
            "demo_browser_cmd_signature": "browser-signature",
            "demo_profile_dir": str(runtime.DEMO_PROFILE_DIR),
            "started_at": "2026-09-12T00:00:00Z",
        }
        with (
            mock.patch.object(
                runtime.reset_demo,
                "load_session_state",
                return_value=state,
            ),
            mock.patch.object(
                runtime.reset_demo,
                "get_live_commands",
                return_value={
                    303: "/usr/bin/python local-signature",
                    404: "/tmp/chrome browser-signature",
                },
            ),
        ):
            result = runtime._assert_nested_session_affinity()
        self.assertEqual(result["counterpedia_local"], 303)
        self.assertEqual(result["demo_browser"], 404)

    def test_runtime_ready_result_is_after_affinity_gate(self) -> None:
        source = Path(runtime.__file__).read_text(encoding="utf-8")
        post_browser = source.index("browser_binding = _wait_for_extension_binding(extension)")
        affinity_gate = source.index("runtime_affinity = _assert_runtime_affinity", post_browser)
        ready_result = source.index('result = {', affinity_gate)
        self.assertLess(post_browser, affinity_gate)
        self.assertLess(affinity_gate, ready_result)
        self.assertIn('"runtime_affinity": "ready"', source)
        self.assertIn('print("Runtime affinity: READY")', source)


if __name__ == "__main__":
    unittest.main()
