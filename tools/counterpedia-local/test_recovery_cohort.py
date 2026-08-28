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


class LocalWordCountTests(unittest.TestCase):
    """Local settle-heuristic word counting (mirrors, but is NOT, the server's
    _word_count/_browser_word_count -- used only to decide when to stop
    waiting, never as the reported/authoritative count)."""

    def test_counts_whitespace_delimited_tokens(self) -> None:
        self.assertEqual(rc.local_word_count("one two three"), 3)

    def test_none_and_empty_are_zero(self) -> None:
        self.assertEqual(rc.local_word_count(None), 0)
        self.assertEqual(rc.local_word_count(""), 0)

    def test_collapses_runs_of_whitespace(self) -> None:
        self.assertEqual(rc.local_word_count("one   two\n\nthree\tfour"), 4)

    def test_browser_word_count_is_max_across_the_three_fields(self) -> None:
        raw = {
            "main_text": "one two",
            "rendered_text": "one two three four five",
            "selected_text": "one",
        }
        self.assertEqual(rc.local_browser_word_count(raw), 5)

    def test_browser_word_count_handles_missing_fields(self) -> None:
        self.assertEqual(rc.local_browser_word_count({}), 0)
        self.assertEqual(rc.local_browser_word_count({"rendered_text": None}), 0)


class IsMaterialGrowthTests(unittest.TestCase):
    """Pure growth classifier -- see module docstring 'OWNER CORRECTION'.

    Only growth beyond both an absolute AND a relative floor resets the
    stability streak; a shrink, an unchanged count, or a small wobble does
    not.
    """

    def test_unchanged_is_not_growth(self) -> None:
        self.assertFalse(rc.is_material_growth(300, 300))

    def test_shrink_is_not_growth(self) -> None:
        self.assertFalse(rc.is_material_growth(300, 250))

    def test_small_absolute_wobble_is_not_material(self) -> None:
        # +3 words on a base of 300 is well under both floors.
        self.assertFalse(rc.is_material_growth(300, 303))

    def test_a_late_feed_batch_is_material_growth(self) -> None:
        # This is the mastodon.social/explore case: 41 -> 106 is a large
        # absolute AND relative jump -- must re-arm the stability streak.
        self.assertTrue(rc.is_material_growth(41, 106))

    def test_large_relative_growth_on_a_small_base_is_material(self) -> None:
        self.assertTrue(rc.is_material_growth(10, 30))

    def test_small_relative_but_large_absolute_growth_is_material(self) -> None:
        # +50 words on a base of 1000 is only 5% (borderline) but well past
        # the absolute floor -- the "OR" between the two floors matters.
        self.assertTrue(rc.is_material_growth(1000, 1051))


class IsRenderSettledTests(unittest.TestCase):
    """Pure settle predicate -- see module docstring 'Adaptive render-settle'.

    AUTHORITATIVE: consecutive_stable_samples has reached the required count.
    ADVISORY-ONLY: network_idle may permit an EARLIER determination (fewer
    samples required), but its absence must never block settling once the
    stable-sample requirement is met on its own -- this is the owner's
    explicit correction over network-idle ever being a hard requirement.
    """

    def test_not_settled_before_enough_stable_samples_network_not_idle(self) -> None:
        self.assertFalse(rc.is_render_settled(consecutive_stable_samples=2, network_idle=False))

    def test_settled_once_required_stable_samples_reached_even_without_network_idle(self) -> None:
        # This is the core owner correction: a feed page with persistent
        # polling/SSE/WebSocket traffic that NEVER goes network-idle must
        # still settle once content has genuinely stabilized.
        self.assertTrue(rc.is_render_settled(consecutive_stable_samples=3, network_idle=False))

    def test_network_idle_permits_an_earlier_determination(self) -> None:
        # Fewer consecutive stable samples needed once network is idle too.
        self.assertTrue(rc.is_render_settled(consecutive_stable_samples=2, network_idle=True))

    def test_network_idle_alone_with_no_stability_never_settles(self) -> None:
        # Advisory-only: network_idle never substitutes for ANY stability.
        self.assertFalse(rc.is_render_settled(consecutive_stable_samples=0, network_idle=True))

    def test_network_idle_absence_never_causes_a_later_settle_than_required(self) -> None:
        # Reaching the full requirement settles regardless of network state
        # -- network-idle can only help, never hinder or delay.
        self.assertEqual(
            rc.is_render_settled(consecutive_stable_samples=3, network_idle=False),
            rc.is_render_settled(consecutive_stable_samples=3, network_idle=True),
        )


class RenderWordCountTableTests(unittest.TestCase):
    def test_empty_when_no_eligible_rows(self) -> None:
        rows = [{"eligibility": "NOT_ELIGIBLE", "url": "https://example.org/"}]
        self.assertEqual(rc.render_word_count_table(rows), "")

    def test_empty_when_eligible_but_missing_word_counts(self) -> None:
        rows = [{"eligibility": "ELIGIBLE", "url": "https://example.org/", "baseline_visible_word_count": None}]
        self.assertEqual(rc.render_word_count_table(rows), "")

    def test_renders_one_row_per_eligible_url_with_counts(self) -> None:
        rows = [
            {
                "eligibility": "ELIGIBLE",
                "url": "https://mastodon.social/explore",
                "baseline_visible_word_count": 40,
                "browser_visible_word_count": 400,
                "recovery_outcome": "RECOVERED",
            },
            {
                "eligibility": "NOT_ELIGIBLE",
                "url": "https://example.com/",
                "baseline_visible_word_count": 5,
                "browser_visible_word_count": 5,
                "recovery_outcome": "NOT_ELIGIBLE",
            },
        ]
        table = rc.render_word_count_table(rows)
        self.assertIn("mastodon.social/explore", table)
        self.assertNotIn("example.com", table)
        self.assertIn("400", table)
        self.assertIn("40", table)
        self.assertIn("RECOVERED", table)

    def test_meets_threshold_column_matches_the_200_and_3x_rule(self) -> None:
        rows = [
            {
                "eligibility": "ELIGIBLE",
                "url": "https://a.example/",
                "baseline_visible_word_count": 50,
                "browser_visible_word_count": 250,  # >=200 and >=3x50 -> yes
                "recovery_outcome": "RECOVERED",
            },
            {
                "eligibility": "ELIGIBLE",
                "url": "https://b.example/",
                "baseline_visible_word_count": 10,
                "browser_visible_word_count": 150,  # >=3x10 but <200 -> no
                "recovery_outcome": "STILL_NOT_OBSERVED",
            },
        ]
        table = rc.render_word_count_table(rows)
        lines = {line.split()[0]: line for line in table.splitlines() if "example" in line}
        self.assertIn("yes", lines["https://a.example/"])
        self.assertIn("no", lines["https://b.example/"])

    def test_includes_settle_reason_and_trajectory_columns(self) -> None:
        rows = [
            {
                "eligibility": "ELIGIBLE",
                "url": "https://mastodon.social/explore",
                "baseline_visible_word_count": 40,
                "browser_visible_word_count": 414,
                "recovery_outcome": "RECOVERED",
                "settle_reason": "STABLE",
                "word_count_trajectory": [41, 106, 287, 412, 414, 414, 414],
            }
        ]
        table = rc.render_word_count_table(rows)
        self.assertIn("STABLE", table)
        self.assertIn("41→106→287→412→414→414→414", table)


class FormatTrajectoryTests(unittest.TestCase):
    def test_empty_trajectory(self) -> None:
        self.assertEqual(rc.format_trajectory([]), "-")

    def test_short_trajectory_shown_in_full(self) -> None:
        self.assertEqual(rc.format_trajectory([41, 106, 287, 414]), "41→106→287→414")

    def test_long_trajectory_is_compacted_with_elided_count(self) -> None:
        trajectory = list(range(20))  # 0..19, longer than head+tail
        rendered = rc.format_trajectory(trajectory)
        self.assertTrue(rendered.startswith("0→1→2→3→"))
        self.assertTrue(rendered.endswith("→16→17→18→19"))
        self.assertIn("+", rendered)  # elided-count marker present

    def test_never_drops_data_silently_marks_elision(self) -> None:
        trajectory = list(range(9))  # 9 = head(4) + tail(4) + 1 elided
        rendered = rc.format_trajectory(trajectory)
        self.assertIn("(+1)", rendered)


class RenderSettleTableTests(unittest.TestCase):
    def test_empty_rows(self) -> None:
        self.assertEqual(rc.render_settle_table([]), "")

    def test_one_row_per_url_regardless_of_eligibility(self) -> None:
        rows = [
            {
                "url": "https://example.com/",
                "settle_reason": "STABLE",
                "word_count_trajectory": [5, 5, 5],
            },
            {
                "url": "https://mastodon.social/explore",
                "settle_reason": "STABLE",
                "word_count_trajectory": [41, 106, 287, 412, 414, 414, 414],
            },
            {
                "url": "https://broken.example/",
                "settle_reason": "NAVIGATION_ERROR",
                "word_count_trajectory": [],
            },
        ]
        table = rc.render_settle_table(rows)
        self.assertIn("example.com", table)
        self.assertIn("mastodon.social/explore", table)
        self.assertIn("NAVIGATION_ERROR", table)
        self.assertIn("STABLE", table)
        # NAVIGATION_ERROR rows have no samples -- must render "-", not crash.
        broken_line = [line for line in table.splitlines() if "broken.example" in line][0]
        self.assertIn("-", broken_line)


if __name__ == "__main__":
    unittest.main()
