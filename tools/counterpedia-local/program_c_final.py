#!/usr/bin/env python3
"""Authoritative Program C final-run instrumentation wrapper.

This module deliberately does not change Program C's cohort, settling rule,
content floor, recovery thresholds, BrowserPageCapture construction, or
acquisition/recovery calls. It wraps the landed C1b harness only to add:

- settle-phase elapsed duration (monotonic time spent inside
  ``wait_for_render_settle`` only; navigation/readyState wait excluded),
- the final local settle word count alongside the existing trajectory,
- a richer all-URL settle table, and
- an optional durable results path via ``COUNTERPEDIA_COHORT_RESULTS_PATH``.

The landed ``recovery_cohort.py`` remains the semantic owner of the run.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import recovery_cohort as cohort

RESULTS_PATH_ENV = "COUNTERPEDIA_COHORT_RESULTS_PATH"

_ORIGINAL_WAIT_FOR_RENDER_SETTLE = cohort.wait_for_render_settle
_ORIGINAL_PROCESS_ONE_URL = cohort.process_one_url
_ORIGINAL_COHORT_ROW_TO_DICT = cohort.CohortRow.to_dict
_SETTLE_DURATIONS_BY_URL: dict[str, float] = {}
_INSTALLED = False


def _timed_wait_for_render_settle(conn: Any, session: str, url: str) -> Any:
    """Time only the authoritative settle phase and return its result unchanged."""
    started = time.monotonic()
    result = _ORIGINAL_WAIT_FOR_RENDER_SETTLE(conn, session, url)
    _SETTLE_DURATIONS_BY_URL[url] = max(0.0, time.monotonic() - started)
    return result


def _process_one_url(
    conn: Any,
    origin: str,
    token: str,
    acquisition_base_url: str,
    url: str,
    reference_posture: str,
    reference_bucket: str,
) -> Any:
    """Attach the measured settle duration to the existing CohortRow object."""
    _SETTLE_DURATIONS_BY_URL.pop(url, None)
    row = _ORIGINAL_PROCESS_ONE_URL(
        conn,
        origin,
        token,
        acquisition_base_url,
        url,
        reference_posture,
        reference_bucket,
    )
    # CohortRow is a normal (non-slotted) dataclass, so this additive audit
    # attribute does not alter its constructor or any existing caller.
    row.settle_duration_s = _SETTLE_DURATIONS_BY_URL.get(url)
    return row


def _cohort_row_to_dict(self: Any) -> dict[str, Any]:
    """Preserve the landed row shape and append two audit-only fields."""
    data = _ORIGINAL_COHORT_ROW_TO_DICT(self)
    duration = getattr(self, "settle_duration_s", None)
    data["settle_duration_s"] = None if duration is None else round(float(duration), 3)
    trajectory = list(getattr(self, "word_count_trajectory", []) or [])
    data["final_settle_word_count"] = trajectory[-1] if trajectory else None
    return data


def _format_duration(value: Any) -> str:
    if value is None:
        return "-"
    return f"{float(value):.3f}"


def render_final_settle_table(rows: list[dict[str, Any]]) -> str:
    """Render the owner-required per-URL final Program C audit table.

    ``final_words`` is the local word-count sample whose stability terminated
    the settle loop. It stays distinct from ``browser_visible_word_count``,
    which remains the server-authoritative input to the recovery classifier.
    """
    headers = [
        "url",
        "recovery_outcome",
        "final_words",
        "settle_s",
        "settle_reason",
        "word_count_trajectory",
    ]
    col_rows: list[list[str]] = []
    for row in rows:
        trajectory = row.get("word_count_trajectory") or []
        final_words = row.get("final_settle_word_count")
        if final_words is None and trajectory:
            final_words = trajectory[-1]
        col_rows.append(
            [
                row["url"],
                row.get("recovery_outcome") or "-",
                str(final_words) if final_words is not None else "-",
                _format_duration(row.get("settle_duration_s")),
                row.get("settle_reason") or "-",
                cohort.format_trajectory(trajectory),
            ]
        )
    if not col_rows:
        return ""
    return cohort._text_table(headers, col_rows)


def _configure_results_path() -> Path:
    """Select a durable output path without changing the landed default."""
    raw = os.environ.get(RESULTS_PATH_ENV, "").strip()
    if not raw:
        return cohort.RESULTS_JSON_PATH
    path = Path(raw).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    cohort.RESULTS_JSON_PATH = path
    return path


def install_instrumentation() -> Path:
    """Install audit-only wrappers exactly once; return the results path."""
    global _INSTALLED
    if not _INSTALLED:
        cohort.wait_for_render_settle = _timed_wait_for_render_settle
        cohort.process_one_url = _process_one_url
        cohort.CohortRow.to_dict = _cohort_row_to_dict
        cohort.render_settle_table = render_final_settle_table
        _INSTALLED = True
    return _configure_results_path()


def main() -> int:
    output_path = install_instrumentation()
    cohort.log(f"Program C final instrumentation: results_path={output_path}")
    cohort.log(
        "Program C final instrumentation: settle semantics/thresholds unchanged; "
        "duration measures wait_for_render_settle only"
    )
    return cohort.main()


if __name__ == "__main__":
    raise SystemExit(main())
