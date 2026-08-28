#!/usr/bin/env python3
"""Unit tests for recovery_cohort.py's pure logic: BPC normalization,
outcome tally, and table rendering. No network, no browser, no companion.

Run: python3 tools/counterpedia-local/test_recovery_cohort.py -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import recovery_cohort as rc  # noqa: E402


def raw_page(**overrides) -> dict:
    base = {
        "requested_url": "https://example.org/page",
        "current_url": "https://example.org/page",
        "canonical_url": None,
        "document_title": "Example Page",
        "document_language": "en",
        "meta_description": "A fixture page.",
        "json_ld_raw": [],
        "selected_text": None,
        "main_text": "Main content here.",
        "rendered_text": "Full body text here.",
    }
    base.update(overrides)
    return base


class CohortShapeTests(unittest.TestCase):
    def test_cohort_is_exactly_27_urls(self) -> None:
        self.assertEqual(len(rc.COHORT), 27)

    def test_cohort_urls_are_unique(self) -> None:
        urls = [u for u, _, _ in rc.COHORT]
        self.assertEqual(len(urls), len(set(urls)))

    def test_cohort_urls_are_https(self) -> None:
        for url, _, _ in rc.COHORT:
            self.assertTrue(url.startswith("https://"), url)

    def test_cohort_has_both_reference_buckets(self) -> None:
        buckets = {bucket for _, _, bucket in rc.COHORT}
        self.assertEqual(buckets, {"NOT_ELIGIBLE_expected", "ELIGIBLE_expected"})


class NormalizeCaptureDataTests(unittest.TestCase):
    """Pure port of src/lib/browserPageCapture.ts::normalizeCaptureData."""

    def test_produces_the_exact_bpc1_field_set(self) -> None:
        bpc = rc.normalize_capture_data(raw_page(), "2026-08-28T00:00:00Z")
        expected_keys = {
            "artifact_type",
            "spec_version",
            "requested_url",
            "current_url",
            "canonical_url",
            "document_title",
            "document_language",
            "meta_description",
            "json_ld",
            "selected_text",
            "main_text",
            "rendered_text",
            "captured_at",
        }
        self.assertEqual(set(bpc.keys()), expected_keys)
        self.assertEqual(bpc["artifact_type"], "BrowserPageCapture")
        self.assertEqual(bpc["spec_version"], "v0.1")

    def test_missing_title_becomes_empty_string_not_null(self) -> None:
        bpc = rc.normalize_capture_data(raw_page(document_title=""), "2026-08-28T00:00:00Z")
        self.assertEqual(bpc["document_title"], "")

    def test_absent_optional_fields_become_null(self) -> None:
        bpc = rc.normalize_capture_data(
            raw_page(canonical_url=None, meta_description=None, selected_text=None),
            "2026-08-28T00:00:00Z",
        )
        self.assertIsNone(bpc["canonical_url"])
        self.assertIsNone(bpc["meta_description"])
        self.assertIsNone(bpc["selected_text"])

    def test_strips_null_bytes_and_trims_whitespace(self) -> None:
        bpc = rc.normalize_capture_data(
            raw_page(document_title="  Has\x00Null  "), "2026-08-28T00:00:00Z"
        )
        self.assertEqual(bpc["document_title"], "HasNull")

    def test_truncates_to_bounds(self) -> None:
        long_text = "x" * (rc.BOUNDS["RENDERED_TEXT"] + 500)
        bpc = rc.normalize_capture_data(raw_page(rendered_text=long_text), "2026-08-28T00:00:00Z")
        self.assertEqual(len(bpc["rendered_text"]), rc.BOUNDS["RENDERED_TEXT"])

    def test_json_ld_parses_and_bounds_item_count(self) -> None:
        items = ['{"a": 1}'] * 15  # more than JSON_LD_ITEMS
        bpc = rc.normalize_capture_data(raw_page(json_ld_raw=items), "2026-08-28T00:00:00Z")
        self.assertEqual(len(bpc["json_ld"]), rc.BOUNDS["JSON_LD_ITEMS"])
        self.assertEqual(bpc["json_ld"][0], {"a": 1})

    def test_json_ld_drops_malformed_blocks_silently(self) -> None:
        bpc = rc.normalize_capture_data(
            raw_page(json_ld_raw=["not json", '{"ok": true}']), "2026-08-28T00:00:00Z"
        )
        self.assertEqual(bpc["json_ld"], [{"ok": True}])

    def test_json_ld_drops_oversized_items(self) -> None:
        huge = '{"a": "' + ("x" * rc.BOUNDS["JSON_LD_ITEM_CHARS"]) + '"}'
        bpc = rc.normalize_capture_data(raw_page(json_ld_raw=[huge]), "2026-08-28T00:00:00Z")
        self.assertEqual(bpc["json_ld"], [])

    def test_captured_at_passed_through_verbatim(self) -> None:
        bpc = rc.normalize_capture_data(raw_page(), "2026-08-28T12:34:56Z")
        self.assertEqual(bpc["captured_at"], "2026-08-28T12:34:56Z")

    def test_never_fabricates_content_absent_from_raw(self) -> None:
        # Regression guard: this harness must reflect actual rendered DOM,
        # never invent text. Empty raw fields stay empty/null, not filled in.
        bpc = rc.normalize_capture_data(
            raw_page(main_text=None, rendered_text=None), "2026-08-28T00:00:00Z"
        )
        self.assertIsNone(bpc["main_text"])
        self.assertIsNone(bpc["rendered_text"])


class TallyRecoveryOutcomesTests(unittest.TestCase):
    def test_empty_rows(self) -> None:
        tally = rc.tally_recovery_outcomes([])
        self.assertEqual(tally["total"], 0)
        self.assertEqual(tally["recovered_count"], 0)
        self.assertEqual(tally["by_recovery_outcome"], {})

    def test_counts_by_outcome(self) -> None:
        rows = [
            {"recovery_outcome": "RECOVERED", "error": None},
            {"recovery_outcome": "RECOVERED", "error": None},
            {"recovery_outcome": "NOT_ELIGIBLE", "error": None},
            {"recovery_outcome": "STILL_NOT_OBSERVED", "error": None},
            {"recovery_outcome": "AMBIGUOUS", "error": None},
        ]
        tally = rc.tally_recovery_outcomes(rows)
        self.assertEqual(tally["total"], 5)
        self.assertEqual(tally["recovered_count"], 2)
        self.assertEqual(
            tally["by_recovery_outcome"],
            {"RECOVERED": 2, "NOT_ELIGIBLE": 1, "STILL_NOT_OBSERVED": 1, "AMBIGUOUS": 1},
        )

    def test_error_rows_bucket_separately_and_never_count_as_recovered(self) -> None:
        rows = [
            {"recovery_outcome": None, "error": "render_failed: timeout"},
            {"recovery_outcome": "RECOVERED", "error": None},
        ]
        tally = rc.tally_recovery_outcomes(rows)
        self.assertEqual(tally["error_count"], 1)
        self.assertEqual(tally["recovered_count"], 1)
        self.assertEqual(tally["by_recovery_outcome"]["ERROR"], 1)

    def test_error_flag_wins_even_if_outcome_somehow_present(self) -> None:
        # Defensive: an errored row must never silently count toward a real
        # outcome bucket, even if partial data leaked through.
        rows = [{"recovery_outcome": "RECOVERED", "error": "recovery_transport_error: boom"}]
        tally = rc.tally_recovery_outcomes(rows)
        self.assertEqual(tally["by_recovery_outcome"], {"ERROR": 1})
        self.assertEqual(tally["recovered_count"], 0)


class RenderYieldTableTests(unittest.TestCase):
    def test_renders_header_and_one_row_per_url(self) -> None:
        rows = [
            {
                "url": "https://example.org/",
                "baseline_content_posture": "CONTENTFUL",
                "eligibility": "NOT_ELIGIBLE",
                "recovery_outcome": "NOT_ELIGIBLE",
                "http_status": 200,
                "byte_count": 1234,
                "error": None,
            }
        ]
        table = rc.render_yield_table(rows)
        lines = table.splitlines()
        self.assertIn("url", lines[0])
        self.assertIn("recovery_outcome", lines[0])
        self.assertIn("https://example.org/", table)
        self.assertIn("CONTENTFUL", table)
        self.assertIn("1234", table)

    def test_error_rows_render_the_error_in_place_of_posture(self) -> None:
        rows = [
            {
                "url": "https://broken.example/",
                "baseline_content_posture": None,
                "eligibility": None,
                "recovery_outcome": None,
                "http_status": None,
                "byte_count": None,
                "error": "render_failed: timed out",
            }
        ]
        table = rc.render_yield_table(rows)
        self.assertIn("ERROR: render_failed: timed out", table)

    def test_empty_rows_still_renders_a_header(self) -> None:
        table = rc.render_yield_table([])
        self.assertIn("url", table.splitlines()[0])


if __name__ == "__main__":
    unittest.main()
