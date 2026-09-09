from __future__ import annotations

import unittest
from pathlib import Path

import demo_kit_builder as builder


HERE = Path(__file__).resolve().parent


class DemoKitDagrWiringTests(unittest.TestCase):
    def test_builder_owns_both_dagr_source_snapshots(self) -> None:
        names = [name for name, _repository in builder.COMPONENTS]
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("dagr-sdk", names)
        self.assertIn("dagr-mcp", names)

    def test_installer_uses_bundled_dagr_sources_in_acquisition_venv(self) -> None:
        text = (HERE / "demo_kit_install.py").read_text(encoding="utf-8")
        self.assertIn('_component(root, "dagr-sdk")', text)
        self.assertIn('_component(root, "dagr-mcp")', text)
        self.assertIn('"pip", "install", "-e", str(dagr_sdk)', text)
        self.assertIn('f"{dagr_mcp}[official-sdk]"', text)
        self.assertIn("DAGR_DEMO_BINDING=READY", text)
        self.assertIn("dagr_mcp_local_demo.counterpedia_acquisition", text)
        self.assertIn("dagr_mcp_sdk_binding.adapter", text)

    def test_runtime_selects_only_canonical_local_demo_factory(self) -> None:
        text = (HERE / "demo_kit_runtime.py").read_text(encoding="utf-8")
        self.assertIn(
            'DAGR_FACTORY = "dagr_mcp_local_demo.counterpedia_acquisition:build_adapter"',
            text,
        )
        self.assertIn("COUNTERPEDIA_ACQUISITION_DAGR_ADAPTER_FACTORY", text)
        self.assertIn("COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR", text)
        self.assertIn('"authority_movement": 0', text)

    def test_readiness_includes_dagr_binding_probe(self) -> None:
        text = (HERE / "demo_kit_check.py").read_text(encoding="utf-8")
        self.assertIn("_dagr_binding_status", text)
        self.assertIn('"dagr": {', text)
        self.assertIn("and dagr_ready", text)


if __name__ == "__main__":
    unittest.main()
