from __future__ import annotations

import importlib
import os
import sys
import tempfile
import types
import unittest
from dataclasses import dataclass, field
from pathlib import Path
from unittest import mock


def _load_subject():
    fake = types.ModuleType("recovery_cohort")

    @dataclass
    class CohortRow:
        url: str
        reference_posture: str
        reference_bucket: str
        recovery_outcome: str | None = None
        settle_reason: str | None = None
        word_count_trajectory: list[int] = field(default_factory=list)

        def to_dict(self):
            return {
                "url": self.url,
                "reference_posture": self.reference_posture,
                "reference_bucket": self.reference_bucket,
                "recovery_outcome": self.recovery_outcome,
                "settle_reason": self.settle_reason,
                "word_count_trajectory": self.word_count_trajectory,
            }

    fake.CohortRow = CohortRow
    fake.RESULTS_JSON_PATH = Path("cohort_results.json")
    fake.SETTLE_POLL_INTERVAL_S = 0.5
    fake.SETTLE_REQUIRED_STABLE_SAMPLES = 3
    fake.SETTLE_MIN_CONTENT_WORDS = 20
    fake.RECOVERED_MIN_BROWSER_WORDS = 200
    fake.RECOVERED_MIN_RATIO = 3.0
    fake.wait_for_render_settle = lambda conn, session, url: object()

    def process_one_url(conn, origin, token, base, url, posture, bucket):
        return CohortRow(url, posture, bucket)

    fake.process_one_url = process_one_url
    fake.format_trajectory = lambda values: "→".join(str(v) for v in values) if values else "-"

    def text_table(headers, rows):
        return "|".join(headers) + "\n" + "\n".join("|".join(r) for r in rows)

    fake._text_table = text_table
    fake.log = lambda message: None
    fake.main = lambda: 0

    sys.modules["recovery_cohort"] = fake
    sys.modules.pop("program_c_final", None)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        subject = importlib.import_module("program_c_final")
    finally:
        sys.path.pop(0)
    return subject, fake


def _restore_module(name: str, previous):
    if previous is None:
        sys.modules.pop(name, None)
    else:
        sys.modules[name] = previous


class ProgramCFinalTests(unittest.TestCase):
    def setUp(self):
        self._previous_recovery = sys.modules.get("recovery_cohort")
        self._previous_subject = sys.modules.get("program_c_final")
        self.subject, self.fake = _load_subject()

    def tearDown(self):
        _restore_module("recovery_cohort", self._previous_recovery)
        _restore_module("program_c_final", self._previous_subject)

    def test_timed_wrapper_returns_original_result_and_records_elapsed(self):
        sentinel = object()
        self.subject._ORIGINAL_WAIT_FOR_RENDER_SETTLE = lambda conn, session, url: sentinel
        with mock.patch.object(self.subject.time, "monotonic", side_effect=[10.0, 12.3456]):
            result = self.subject._timed_wait_for_render_settle(None, "session", "https://example.test/")
        self.assertIs(result, sentinel)
        self.assertAlmostEqual(self.subject._SETTLE_DURATIONS_BY_URL["https://example.test/"], 2.3456)

    def test_row_serialization_appends_duration_and_final_local_word_count(self):
        row = self.fake.CohortRow("u", "p", "b", recovery_outcome="RECOVERED", settle_reason="STABLE")
        row.word_count_trajectory = [0, 41, 300, 302, 302, 302]
        row.settle_duration_s = 3.45678
        data = self.subject._cohort_row_to_dict(row)
        self.assertEqual(data["final_settle_word_count"], 302)
        self.assertEqual(data["settle_duration_s"], 3.457)
        self.assertEqual(data["recovery_outcome"], "RECOVERED")

    def test_navigation_error_serializes_null_duration_and_no_final_words(self):
        row = self.fake.CohortRow("u", "p", "b", settle_reason="NAVIGATION_ERROR")
        row.settle_duration_s = None
        data = self.subject._cohort_row_to_dict(row)
        self.assertIsNone(data["settle_duration_s"])
        self.assertIsNone(data["final_settle_word_count"])

    def test_final_table_contains_required_columns(self):
        table = self.subject.render_final_settle_table(
            [
                {
                    "url": "https://bsky.app/",
                    "recovery_outcome": "RECOVERED",
                    "final_settle_word_count": 412,
                    "settle_duration_s": 3.125,
                    "settle_reason": "STABLE",
                    "word_count_trajectory": [0, 41, 412, 412, 412],
                }
            ]
        )
        self.assertIn("recovery_outcome", table)
        self.assertIn("final_words", table)
        self.assertIn("settle_s", table)
        self.assertIn("RECOVERED", table)
        self.assertIn("3.125", table)

    def test_results_path_override_is_explicit_and_creates_parent_only(self):
        with tempfile.TemporaryDirectory() as td:
            target = Path(td) / "program-c" / "final" / "cohort_results.json"
            with mock.patch.dict(os.environ, {self.subject.RESULTS_PATH_ENV: str(target)}, clear=False):
                resolved = self.subject._configure_results_path()
            self.assertEqual(resolved, target.resolve())
            self.assertEqual(self.fake.RESULTS_JSON_PATH, target.resolve())
            self.assertTrue(target.parent.is_dir())
            self.assertFalse(target.exists())

    def test_installation_does_not_change_settle_or_recovery_constants(self):
        before = (
            self.fake.SETTLE_POLL_INTERVAL_S,
            self.fake.SETTLE_REQUIRED_STABLE_SAMPLES,
            self.fake.SETTLE_MIN_CONTENT_WORDS,
            self.fake.RECOVERED_MIN_BROWSER_WORDS,
            self.fake.RECOVERED_MIN_RATIO,
        )
        self.subject.install_instrumentation()
        after = (
            self.fake.SETTLE_POLL_INTERVAL_S,
            self.fake.SETTLE_REQUIRED_STABLE_SAMPLES,
            self.fake.SETTLE_MIN_CONTENT_WORDS,
            self.fake.RECOVERED_MIN_BROWSER_WORDS,
            self.fake.RECOVERED_MIN_RATIO,
        )
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
