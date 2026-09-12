#!/usr/bin/env python3
"""Regression tests for non-object Counterpedia Local supervisor JSON."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preflight  # noqa: E402


class CheckCounterpediaLocalNonObjectPayloadTests(unittest.TestCase):
    def test_non_object_json_fails_closed(self) -> None:
        for payload in ([], "ok", 123, True):
            with self.subTest(payload=payload):
                with patch.object(preflight.base, "http_json", return_value=payload):
                    line = preflight.check_counterpedia_local()
                self.assertEqual(line.status, "not_ready")
                self.assertIn("not the counterpedia-local supervisor document", line.detail)
                self.assertNotIn("unreachable", line.detail)


if __name__ == "__main__":
    unittest.main()
