#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

import demo_kit_builder as kit


class DemoKitBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _git(self, repo: Path, *args: str) -> str:
        completed = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return completed.stdout.strip()

    def _repo(self, name: str, *, tracked_env: bool = False, escaping_symlink: bool = False) -> Path:
        repo = self.root / name
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        self._git(repo, "config", "user.email", "demo-kit-test@example.invalid")
        self._git(repo, "config", "user.name", "Demo Kit Test")
        (repo / "README.md").write_text(f"# {name}\n", encoding="utf-8")
        script = repo / "run.command"
        script.write_text("#!/bin/bash\necho ok\n", encoding="utf-8")
        script.chmod(script.stat().st_mode | stat.S_IXUSR)
        if tracked_env:
            (repo / ".env").write_text("OPENAI_API_KEY=must-not-ship\n", encoding="utf-8")
        if escaping_symlink:
            outside = self.root / "outside.txt"
            outside.write_text("outside\n", encoding="utf-8")
            os.symlink("../outside.txt", repo / "escape-link")
        self._git(repo, "add", ".")
        self._git(repo, "commit", "-qm", "fixture")
        return repo

    def _sources(self, **special: dict[str, object]) -> dict[str, Path]:
        result: dict[str, Path] = {}
        for name, _repository in kit.COMPONENTS:
            result[name] = self._repo(name, **special.get(name, {}))
        return result

    def _build(self, sources: dict[str, Path], output: Path, *, make_zip: bool = False) -> dict[str, object]:
        return kit.build_demo_kit(
            extension_dir=sources["counterpedia-extension"],
            acquisition_dir=sources["counterpedia-acquisition"],
            authoring_dir=sources["counterpedia-authoring"],
            counterpedia_dir=sources["counterpedia"],
            terminal_dir=sources["counterpedia-console"],
            output_dir=output,
            make_zip=make_zip,
        )

    def test_build_copies_only_tracked_snapshots_and_pins_every_component(self) -> None:
        sources = self._sources()
        # Machine-local/untracked material must never enter the package.
        for repo in sources.values():
            (repo / "node_modules").mkdir()
            (repo / "node_modules" / "junk.js").write_text("junk", encoding="utf-8")
            (repo / ".env.local.untracked").write_text("secret", encoding="utf-8")

        output = self.root / "Counterpedia Demo Kit"
        manifest = self._build(sources, output, make_zip=True)

        self.assertEqual(manifest["schema_version"], kit.MANIFEST_SCHEMA)
        self.assertEqual(manifest["authority_movement"], 0)
        component_rows = {row["name"]: row for row in manifest["components"]}
        self.assertEqual(set(component_rows), {name for name, _ in kit.COMPONENTS})
        for name, _repository in kit.COMPONENTS:
            component = output / "components" / name
            self.assertTrue((component / "README.md").is_file())
            self.assertTrue((component / "run.command").is_file())
            self.assertFalse((component / ".git").exists())
            self.assertFalse((component / "node_modules").exists())
            self.assertFalse((component / ".env.local.untracked").exists())
            self.assertEqual(component_rows[name]["commit_sha"], self._git(sources[name], "rev-parse", "HEAD"))
            self.assertRegex(component_rows[name]["snapshot_sha256"], r"^[0-9a-f]{64}$")

        for launcher in (
            "Install Counterpedia Demo.command",
            "Start Counterpedia Demo.command",
            "Check Counterpedia Demo.command",
            "Reset Counterpedia Demo.command",
            "Configure Drafting Key.command",
        ):
            path = output / launcher
            self.assertTrue(path.is_file())
            self.assertTrue(os.access(path, os.X_OK))
        demo = output / "DEMO.md"
        self.assertTrue(demo.is_file())
        demo_text = demo.read_text(encoding="utf-8")
        self.assertIn("Five-Minute Wikipedia Demo", demo_text)
        self.assertIn("UNADMITTED", demo_text)
        self.assertIn("Run Check", demo_text)

        zip_path = output.with_suffix(".zip")
        self.assertTrue(zip_path.is_file())
        with zipfile.ZipFile(zip_path) as zf:
            self.assertIn(f"{output.name}/DEMO.md", zf.namelist())

        disk_manifest = json.loads((output / "demo-kit-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(disk_manifest["manifest_digest"], manifest["manifest_digest"])

    def test_tracked_working_tree_change_fails_closed(self) -> None:
        sources = self._sources()
        (sources["counterpedia-acquisition"] / "README.md").write_text("dirty\n", encoding="utf-8")
        output = self.root / "kit"
        with self.assertRaisesRegex(kit.DemoKitBuildError, "tracked working-tree changes"):
            self._build(sources, output)
        self.assertFalse(output.exists())

    def test_tracked_env_file_is_refused(self) -> None:
        sources = self._sources(**{"counterpedia-authoring": {"tracked_env": True}})
        output = self.root / "kit"
        with self.assertRaisesRegex(kit.DemoKitBuildError, "secret/machine-local"):
            self._build(sources, output)
        self.assertFalse(output.exists())

    def test_symlink_that_escapes_source_checkout_is_refused(self) -> None:
        sources = self._sources(**{"counterpedia-console": {"escaping_symlink": True}})
        output = self.root / "kit"
        with self.assertRaisesRegex(kit.DemoKitBuildError, "symlink escaping"):
            self._build(sources, output)
        self.assertFalse(output.exists())

    def test_existing_output_is_never_overwritten(self) -> None:
        sources = self._sources()
        output = self.root / "kit"
        output.mkdir()
        marker = output / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(kit.DemoKitBuildError, "refusing to overwrite"):
            self._build(sources, output)
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
