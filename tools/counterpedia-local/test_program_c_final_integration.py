from __future__ import annotations

import os
import unittest
from unittest import mock

import program_c_final as final
import recovery_cohort as cohort


class ProgramCFinalIntegrationTests(unittest.TestCase):
    def test_installation_preserves_landed_c1b_semantic_constants(self):
        before = (
            cohort.SETTLE_POLL_INTERVAL_S,
            cohort.SETTLE_REQUIRED_STABLE_SAMPLES,
            cohort.SETTLE_NETWORK_IDLE_RELAXED_STABLE_SAMPLES,
            cohort.SETTLE_NETWORK_IDLE_S,
            cohort.SETTLE_HARD_CEILING_S,
            cohort.SETTLE_GROWTH_MIN_ABS_WORDS,
            cohort.SETTLE_GROWTH_MIN_RATIO,
            cohort.SETTLE_MIN_CONTENT_WORDS,
            cohort.RECOVERED_MIN_BROWSER_WORDS,
            cohort.RECOVERED_MIN_RATIO,
            tuple(cohort.COHORT),
        )
        with mock.patch.dict(os.environ, {}, clear=False):
            final.install_instrumentation()
        after = (
            cohort.SETTLE_POLL_INTERVAL_S,
            cohort.SETTLE_REQUIRED_STABLE_SAMPLES,
            cohort.SETTLE_NETWORK_IDLE_RELAXED_STABLE_SAMPLES,
            cohort.SETTLE_NETWORK_IDLE_S,
            cohort.SETTLE_HARD_CEILING_S,
            cohort.SETTLE_GROWTH_MIN_ABS_WORDS,
            cohort.SETTLE_GROWTH_MIN_RATIO,
            cohort.SETTLE_MIN_CONTENT_WORDS,
            cohort.RECOVERED_MIN_BROWSER_WORDS,
            cohort.RECOVERED_MIN_RATIO,
            tuple(cohort.COHORT),
        )
        self.assertEqual(after, before)
        self.assertEqual(len(cohort.COHORT), 27)

    def test_actual_cohort_row_serializes_duration_and_final_settle_word_count(self):
        final.install_instrumentation()
        row = cohort.CohortRow(
            url="https://bsky.app/",
            reference_posture="LIKELY_LOADER",
            reference_bucket="ELIGIBLE_expected",
        )
        row.recovery_outcome = "RECOVERED"
        row.settle_reason = cohort.SETTLE_REASON_STABLE
        row.word_count_trajectory = [0, 0, 41, 300, 412, 412, 412]
        row.settle_duration_s = 3.45678
        data = row.to_dict()
        self.assertEqual(data["settle_duration_s"], 3.457)
        self.assertEqual(data["final_settle_word_count"], 412)
        self.assertEqual(data["recovery_outcome"], "RECOVERED")
        self.assertEqual(data["settle_reason"], "STABLE")

    def test_actual_final_table_keeps_local_and_server_word_counts_conceptually_distinct(self):
        final.install_instrumentation()
        row = cohort.CohortRow(
            url="https://mastodon.social/explore",
            reference_posture="LIKELY_LOADER",
            reference_bucket="ELIGIBLE_expected",
        )
        row.recovery_outcome = "RECOVERED"
        row.browser_visible_word_count = 487
        row.settle_reason = cohort.SETTLE_REASON_STABLE
        row.word_count_trajectory = [0, 41, 318, 490, 492, 492, 492]
        row.settle_duration_s = 4.125
        data = row.to_dict()
        self.assertEqual(data["browser_visible_word_count"], 487)
        self.assertEqual(data["final_settle_word_count"], 492)
        table = final.render_final_settle_table([data])
        self.assertIn("final_words", table)
        self.assertIn("492", table)
        self.assertIn("4.125", table)
        self.assertNotIn("browser_words", table)


if __name__ == "__main__":
    unittest.main()
