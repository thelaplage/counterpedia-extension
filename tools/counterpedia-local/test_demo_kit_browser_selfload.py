from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import demo_kit_runtime as runtime


class DemoKitBrowserSelfloadTests(unittest.TestCase):
    def _extension(self, root: Path) -> Path:
        extension = root / "counterpedia-extension"
        (extension / "dist").mkdir(parents=True)
        (extension / "dist" / "manifest.json").write_text("{}\n", encoding="utf-8")
        return extension

    def test_every_kit_open_repeats_exact_profile_and_load_extension_binding(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            extension = self._extension(Path(tmp))
            profile = Path(tmp) / "demo-profile"
            completed = SimpleNamespace(returncode=0, stdout="/tmp/Chrome for Testing\n")

            with (
                mock.patch.object(runtime, "DEMO_PROFILE_DIR", profile),
                mock.patch.object(runtime.subprocess, "run", return_value=completed),
                mock.patch.object(runtime.subprocess, "Popen") as popen,
            ):
                runtime._open_demo_tab(extension, "http://127.0.0.1:8800/")

            argv = popen.call_args.args[0]
            self.assertEqual(argv[0], "/tmp/Chrome for Testing")
            self.assertIn(f"--user-data-dir={profile}", argv)
            self.assertIn(f"--load-extension={(extension / 'dist').resolve()}", argv)
            self.assertIn("--no-first-run", argv)
            self.assertIn("--no-default-browser-check", argv)
            self.assertEqual(argv[-1], "http://127.0.0.1:8800/")

    def test_profile_only_browser_is_not_extension_load_proof(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            extension = self._extension(Path(tmp))
            profile = Path(tmp) / "demo-profile"
            commands = {
                10: f"/tmp/chrome --user-data-dir={profile} http://127.0.0.1:8800/"
            }
            with mock.patch.object(runtime, "DEMO_PROFILE_DIR", profile):
                self.assertIsNone(
                    runtime._live_extension_bound_browser_command(extension, commands)
                )

    def test_exact_profile_plus_exact_bundle_dist_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            extension = self._extension(Path(tmp))
            profile = Path(tmp) / "demo-profile"
            dist = (extension / "dist").resolve()
            command = (
                f"/tmp/chrome --user-data-dir={profile} "
                f"--load-extension={dist} https://example.com/"
            )
            with mock.patch.object(runtime, "DEMO_PROFILE_DIR", profile):
                self.assertEqual(
                    runtime._live_extension_bound_browser_command(extension, {11: command}),
                    command,
                )

    def test_binding_failure_has_explicit_fail_closed_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            extension = self._extension(Path(tmp))
            with (
                mock.patch.object(
                    runtime,
                    "_live_extension_bound_browser_command",
                    return_value=None,
                ),
                mock.patch.object(runtime.time, "monotonic", side_effect=[0.0, 0.0, 1.0]),
                mock.patch.object(runtime.time, "sleep"),
            ):
                with self.assertRaisesRegex(
                    runtime.DemoKitRuntimeError,
                    "DEMO_EXTENSION_LOAD_REFUSED",
                ):
                    runtime._wait_for_extension_binding(extension, timeout=0.5)

    def test_post_convenience_tab_binding_gate_precedes_ready_result(self) -> None:
        source = Path(runtime.__file__).read_text(encoding="utf-8")
        terminal_open = source.index("_open_demo_tab(extension, TERMINAL_URL)")
        post_gate = source.index(
            "browser_binding = _wait_for_extension_binding(extension)",
            terminal_open,
        )
        ready_result = source.index('result = {', post_gate)
        self.assertLess(terminal_open, post_gate)
        self.assertLess(post_gate, ready_result)
        self.assertIn('"browser_extension_binding": "ready"', source)


if __name__ == "__main__":
    unittest.main()
