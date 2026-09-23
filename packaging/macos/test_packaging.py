from __future__ import annotations

import importlib.util
import tempfile
import unittest
from unittest import mock
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, HERE / path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


launcher = load("cp_macos_launcher", "launcher.py")
shim = load("cp_macos_shim", "acquisition_python_shim.py")
builder = load("cp_macos_builder", "build_app.py")


class LauncherTests(unittest.TestCase):
    def test_app_helpers_root_requires_contents_macos_shape(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            helpers = root / "Counterpedia Local.app" / "Contents" / "Helpers"
            executable = root / "Counterpedia Local.app" / "Contents" / "MacOS" / "Counterpedia Local"
            helpers.mkdir(parents=True)
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.write_text("x")
            self.assertEqual(launcher.app_helpers_root(executable), helpers)

    def test_runtime_layout_fails_closed_on_missing_helper(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(RuntimeError, "bundled runtime is incomplete"):
                launcher.runtime_layout(Path(td))

    def test_runtime_layout_accepts_only_complete_expected_shape(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            paths = [
                root / "runtime/counterpedia-acquisition/.venv/bin/python",
                root / "runtime/counterpedia-acquisition/scripts/run_counterpedia_local_transport.py",
                root / "runtime/counterpedia-acquisition/.venv/bin/counterpedia-acquisition-mcp",
                root / "runtime/counterpedia-acquisition/.venv/bin/counterpedia-wikipedia-harvest",
                root / "runtime/counterpedia-acquisition/.venv/bin/counterpedia-ingest-operator-snapshot",
                root / "runtime/counterpedia-authoring/.venv/bin/counterpedia-authoring-live-source",
            ]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("x")
            acquisition, authoring = launcher.runtime_layout(root)
            self.assertEqual(acquisition, root / "runtime/counterpedia-acquisition")
            self.assertEqual(authoring, root / "runtime/counterpedia-authoring")


class ShimTests(unittest.TestCase):
    def test_expected_script_is_checkout_contract_path(self) -> None:
        exe = Path("/App/Contents/Helpers/runtime/counterpedia-acquisition/.venv/bin/python")
        self.assertEqual(
            shim._expected_script(exe),
            Path("/App/Contents/Helpers/runtime/counterpedia-acquisition/scripts/run_counterpedia_local_transport.py"),
        )


class BuilderTests(unittest.TestCase):
    def test_version_and_bundle_identity_are_pinned(self) -> None:
        self.assertEqual(builder.PYINSTALLER_VERSION, "6.22.3")
        self.assertEqual(builder.BUNDLE_ID, "org.counterpedia.local")
        self.assertEqual(builder.MANIFEST_SCHEMA, "counterpedia.local_macos_bundle.v0.1")

    def test_launcher_selects_existing_demo_kit_dagr_factory(self) -> None:
        self.assertEqual(
            launcher.DAGR_FACTORY,
            "dagr_mcp_local_demo.counterpedia_acquisition:build_adapter",
        )

    def test_git_pin_refuses_clean_checkout_at_wrong_head(self) -> None:
        actual = "a" * 40
        expected = "b" * 40
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            clean = mock.Mock(returncode=0)
            with (
                mock.patch.object(builder, "run", return_value=actual),
                mock.patch.object(builder.subprocess, "run", return_value=clean),
            ):
                with self.assertRaisesRegex(
                    builder.BuildError,
                    f"SOURCE_PIN_MISMATCH counterpedia-acquisition expected={expected} actual={actual}",
                ):
                    builder.git_pin(repo, expected, "counterpedia-acquisition")

    def test_git_pin_accepts_exact_clean_head(self) -> None:
        expected = "c" * 40
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            clean = mock.Mock(returncode=0)
            with (
                mock.patch.object(builder, "run", return_value=expected),
                mock.patch.object(builder.subprocess, "run", return_value=clean),
            ):
                self.assertEqual(
                    builder.git_pin(repo, expected, "dagr-sdk"),
                    expected,
                )

    def test_mcp_collection_is_bounded_and_excludes_cli(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            dist = root / "dist"
            work = root / "work"
            specs = root / "specs"
            dist.mkdir(); work.mkdir(); specs.mkdir()
            script = root / "entry.py"
            script.write_text("pass\n")
            calls: list[list[str]] = []

            def fake_run(command, **_kwargs):
                calls.append(command)
                (dist / "helper").write_text("binary")
                return ""

            with mock.patch.object(builder, "run", side_effect=fake_run):
                builder.build_onefile(
                    Path("/build/python"),
                    script,
                    "helper",
                    dist=dist,
                    work=work,
                    specs=specs,
                    collect_all=("acquisition",),
                    hidden_imports=builder.ACQUISITION_MCP_HIDDEN_IMPORTS,
                    codesign_identity=None,
                )

            command = calls[0]
            collect_all_values = [
                command[index + 1]
                for index, value in enumerate(command[:-1])
                if value == "--collect-all"
            ]
            hidden_import_values = [
                command[index + 1]
                for index, value in enumerate(command[:-1])
                if value == "--hidden-import"
            ]
            self.assertNotIn("mcp", collect_all_values)
            self.assertNotIn("mcp.cli", hidden_import_values)
            self.assertEqual(
                hidden_import_values,
                list(builder.ACQUISITION_MCP_HIDDEN_IMPORTS),
            )

    def test_final_app_signing_is_not_deep_but_verification_is(self) -> None:
        calls: list[list[str]] = []
        with mock.patch.object(builder, "run", side_effect=lambda command, **_kwargs: calls.append(command) or ""):
            builder._resign_app(Path("/tmp/Counterpedia Local.app"), "Developer ID Application: Test")
        self.assertNotIn("--deep", calls[0])
        self.assertIn("--options", calls[0])
        self.assertIn("runtime", calls[0])
        self.assertIn("--timestamp", calls[0])
        self.assertIn("--deep", calls[1])
        self.assertIn("--verify", calls[1])


if __name__ == "__main__":
    unittest.main()
