from __future__ import annotations

import importlib.util
import tempfile
import unittest
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
    def test_app_resources_requires_contents_macos_shape(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            resources = root / "Counterpedia Local.app" / "Contents" / "Resources"
            executable = root / "Counterpedia Local.app" / "Contents" / "MacOS" / "Counterpedia Local"
            resources.mkdir(parents=True)
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.write_text("x")
            self.assertEqual(launcher.app_resources(executable), resources)

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
        exe = Path("/App/Contents/Resources/runtime/counterpedia-acquisition/.venv/bin/python")
        self.assertEqual(
            shim._expected_script(exe),
            Path("/App/Contents/Resources/runtime/counterpedia-acquisition/scripts/run_counterpedia_local_transport.py"),
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


if __name__ == "__main__":
    unittest.main()
