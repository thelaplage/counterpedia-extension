#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "facebook_graph_evidence_pack.py"
SPEC = importlib.util.spec_from_file_location("facebook_graph_evidence_pack", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _observation() -> dict[str, object]:
    digest = "sha256:" + "a" * 64
    return {
        "schema_version": "acquisition.facebook_graph_observation.v0.1",
        "authority_movement": 0,
        "response_bytes_sha256": digest,
        "response_object_address": digest,
    }


def _run(names: list[str], **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "artifact_type": "FacebookGraphOperatorRun",
        "spec_version": "v0.1",
        "authority_movement": 0,
        "shipping_extension_runtime_modified": False,
        "target_id": "target-1",
        "target_url": "https://www.facebook.com/example",
        "surface_class": "page_post",
        "access_class": "session_observed",
        "duration_seconds": 30.0,
        "acquisition_sha": MODULE.FACEBOOK_G0_SHA,
        "normalized_observation_files": names,
        "new_observation_count": len(names),
        "census_file": "census.json" if names else None,
    }
    body.update(overrides)
    return body


class FacebookEvidencePackTests(unittest.TestCase):
    def test_valid_operator_ledger_preserves_run_to_observation_ownership(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "observations" / "obs-1.json", _observation())
            _write_json(root / "operator-run-001.json", _run(["obs-1.json"]))

            runs = MODULE._load_operator_runs(root)
            self.assertEqual(len(runs), 1)
            self.assertEqual(runs[0].surface_class, "page_post")
            self.assertEqual(runs[0].access_class, "session_observed")
            self.assertEqual(runs[0].observation_files[0].name, "obs-1.json")

    def test_unknown_operator_run_field_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "observations" / "obs-1.json", _observation())
            body = _run(["obs-1.json"])
            body["admitted"] = True
            _write_json(root / "operator-run-001.json", body)

            with self.assertRaisesRegex(MODULE.EvidencePackError, "unknown operator-run fields"):
                MODULE._load_operator_runs(root)

    def test_observation_filename_path_traversal_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "operator-run-001.json", _run(["../outside.json"]))

            with self.assertRaisesRegex(MODULE.EvidencePackError, "must be a basename"):
                MODULE._load_operator_runs(root)

    def test_same_observation_cannot_belong_to_two_operator_runs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "observations" / "obs-1.json", _observation())
            _write_json(root / "operator-run-001.json", _run(["obs-1.json"]))
            _write_json(root / "operator-run-002.json", _run(["obs-1.json"], target_id="target-2"))

            with self.assertRaisesRegex(MODULE.EvidencePackError, "duplicate observation ownership"):
                MODULE._load_operator_runs(root)

    def test_wrong_acquisition_pin_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "observations" / "obs-1.json", _observation())
            _write_json(root / "operator-run-001.json", _run(["obs-1.json"], acquisition_sha="0" * 40))

            with self.assertRaisesRegex(MODULE.EvidencePackError, "acquisition pin mismatch"):
                MODULE._load_operator_runs(root)

    def test_nonzero_authority_observation_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            observation = _observation()
            observation["authority_movement"] = 1
            _write_json(root / "observations" / "obs-1.json", observation)
            _write_json(root / "operator-run-001.json", _run(["obs-1.json"]))

            with self.assertRaisesRegex(MODULE.EvidencePackError, "authority_movement must equal 0"):
                MODULE._load_operator_runs(root)

    def test_artifact_descriptor_is_relative_and_binds_producer_and_file_digests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "stability.json"
            report_digest = "sha256:" + "b" * 64
            _write_json(
                artifact,
                {
                    "schema_version": "acquisition.facebook_graph_stability.v0.1",
                    "report_digest": report_digest,
                    "authority_movement": 0,
                },
            )
            descriptor = MODULE._artifact_descriptor(artifact, root)
            self.assertEqual(descriptor["path"], "stability.json")
            self.assertEqual(descriptor["producer_digest"], report_digest)
            self.assertRegex(descriptor["file_sha256"], r"^sha256:[0-9a-f]{64}$")
            self.assertNotIn(str(root), json.dumps(descriptor))

    def test_manifest_digest_helper_is_key_order_independent(self) -> None:
        left = MODULE._digest_json({"a": 1, "b": [2, 3]})
        right = MODULE._digest_json({"b": [2, 3], "a": 1})
        self.assertEqual(left, right)
        self.assertRegex(left, r"^sha256:[0-9a-f]{64}$")

    def test_zero_observation_run_is_preserved_by_ledger_loader(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "operator-run-001.json", _run([]))
            runs = MODULE._load_operator_runs(root)
            self.assertEqual(len(runs), 1)
            self.assertEqual(runs[0].observation_files, ())


if __name__ == "__main__":
    unittest.main(verbosity=2)
