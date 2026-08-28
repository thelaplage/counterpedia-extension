#!/usr/bin/env python3
"""Program C -- AUTOMATED recovery-cohort yield-run harness.

Runs a fixed 27-URL cohort through the REAL acquisition + recovery backend
and prints a yield table + totals. This BYPASSES the extension UI entirely
(no toolbar-gesture/activeTab problem, see SELF-LOAD0's PERMISSION FINDING
in verify_ui_click_through_e2e.py): for each URL it uses Chrome-for-Testing
+ CDP to render the page and extract a browser observation -- built to
EXACTLY match what the real extension capture produces (see "HOW THE BPC IS
BUILT" below) -- then POSTs it directly to the acquisition transport, the
same way the extension's own background service worker + panel would.

Per URL:
  1. CDP: navigate a fresh tab to the URL, wait (bounded) for it to settle,
     extract raw page data via a JS expression that mirrors
     src/capture/captureScript.ts::capturePageData EXACTLY (same fields,
     same DOM queries, same stripping rules) -- never fabricated.
  2. Normalize that raw data into a BrowserPageCapture (BPC1) using
     normalize_capture_data(), a straight Python port of
     src/lib/browserPageCapture.ts::normalizeCaptureData (same bounds,
     same null-byte stripping, same JSON-LD re-serialization rule) -- so the
     wire payload is byte-for-byte what the real extension would send for
     the same rendered DOM.
  3. POST /v0/browser-observation {browser_page_capture: BPC} with
     X-Counterpedia-Transport-Token -> a held capture receipt (the REAL
     acquisition executor fetches source.url server-side for the baseline
     -- this is the SAME live re-fetch the SSRF-guard finding in
     verify_ui_click_through_e2e.py documents; it is what makes the SSRF
     guard exercise-able / not exercised here, since every cohort URL is a
     real, owner-authorized external source).
  4. POST /v0/recovery-assessment {capture_ref, browser_page_capture: BPC}
     (same BPC, zero re-fetch server-side for this step -- the baseline
     bytes/digest/posture are resolved from the registry, never re-fetched)
     -> eligibility + recovery_outcome.
  5. Any per-URL failure (render timeout, capture_failed, HTTP error) is
     recorded as its own row and logged -- the cohort run continues.

Usage:
  COUNTERPEDIA_ACQUISITION_DIR=/private/tmp/cplocalacq0 \\
  COUNTERPEDIA_ACQUISITION_PYTHON="$HOME/Developer/repos/counterpedia-acquisition/.venv-review/bin/python" \\
  python3 tools/counterpedia-local/recovery_cohort.py
  # or, in a sandbox with no attached WindowServer:
  COUNTERPEDIA_VERIFY_HEADLESS=1 python3 tools/counterpedia-local/recovery_cohort.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cdp  # noqa: E402
import demo_browser as db  # noqa: E402
from verify_self_load_e2e import (  # noqa: E402
    COMPANION_PORT,
    ProcessGuard,
    VerifyFailure,
    compute_expected_extension_id,
    log,
    pair_extension,
    start_companion,
    wait_for,
)

CDP_PORT = 9940
RENDER_SETTLE_S = 2.5  # extra settle time after readyState=='complete' for SPA JS to run
NAV_TIMEOUT_S = 25.0
POST_TIMEOUT_S = 60.0  # acquisition does a real server-side fetch of the source

# ---------------------------------------------------------------------------
# THE 27-URL COHORT, with the reference (may-drift) baseline classification
# given by the coordinator, for display only -- never a hard assertion. The
# real, OBSERVED posture is always what gets recorded/reported.
# ---------------------------------------------------------------------------

NOT_ELIGIBLE_EXPECTED = [
    ("https://en.wikipedia.org/wiki/Provenance", "CONTENTFUL"),
    ("https://example.com/", "CONTENTFUL"),
    ("https://www.gnu.org/philosophy/free-sw.html", "CONTENTFUL"),
    ("https://news.ycombinator.com/", "CONTENTFUL"),
    ("https://docs.python.org/3/tutorial/index.html", "CONTENTFUL"),
    ("https://developer.mozilla.org/en-US/docs/Web/HTML", "CONTENTFUL"),
    ("https://www.gutenberg.org/files/1342/1342-h/1342-h.htm", "CONTENTFUL"),
    ("https://plato.stanford.edu/entries/scientific-realism/", "CONTENTFUL"),
    ("https://old.reddit.com/r/science/", "CONTENTFUL"),
    ("https://svelte.dev/", "CONTENTFUL"),
    ("https://vitejs.dev/", "CONTENTFUL"),
    ("https://ciechanow.ski/", "CONTENTFUL"),
    ("https://regex101.com/", "CONTENTFUL"),
    ("https://www.rfc-editor.org/rfc/rfc9110.html", "LIKELY_ERROR_PAGE"),
    ("https://www.geogebra.org/calculator", "LIKELY_ACCESS_WALL"),
    ("https://www.google.com/", "LIKELY_ACCESS_WALL"),
]

ELIGIBLE_EXPECTED = [
    ("https://mastodon.social/explore", "LIKELY_LOADER"),
    ("https://mastodon.online/explore", "LIKELY_LOADER"),
    ("https://mas.to/explore", "LIKELY_LOADER"),
    ("https://excalidraw.com/", "LIKELY_LOADER"),
    ("https://www.tldraw.com/", "LIKELY_LOADER"),
    ("https://bsky.app/", "LIKELY_LOADER"),
    ("https://app.element.io/", "LIKELY_LOADER"),
    ("https://www.desmos.com/calculator", "LIKELY_LOADER"),
    ("https://play.tailwindcss.com/", "LIKELY_LOADER"),
    ("https://squoosh.app/", "AMBIGUOUS"),
    ("https://cobalt.tools/", "AMBIGUOUS"),
]

COHORT: list[tuple[str, str, str]] = [
    (url, posture, "NOT_ELIGIBLE_expected") for url, posture in NOT_ELIGIBLE_EXPECTED
] + [(url, posture, "ELIGIBLE_expected") for url, posture in ELIGIBLE_EXPECTED]

assert len(COHORT) == 27, f"cohort must be exactly 27 URLs, got {len(COHORT)}"

RESULTS_JSON_PATH = HERE / "cohort_results.json"

# ---------------------------------------------------------------------------
# BPC construction -- mirrors src/capture/captureScript.ts +
# src/lib/browserPageCapture.ts EXACTLY. See module docstring.
# ---------------------------------------------------------------------------

# Direct transliteration of capturePageData() in src/capture/captureScript.ts.
# Same DOM queries, same stripping rules, same field names on the raw object.
# Evaluated via CDP Runtime.evaluate in the CONTENT tab's own execution
# context -- this is real DOM extraction, not a fabricated/synthetic payload.
_CAPTURE_PAGE_DATA_JS = r"""
(() => {
  const requestedUrl = %(requested_url)s;

  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const rawCanonical = canonicalEl ? canonicalEl.href : null;

  const metaEl = document.querySelector('meta[name="description"]');
  const rawMeta = metaEl ? metaEl.content : null;

  const json_ld_raw = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    const text = el.textContent || "";
    if (text) json_ld_raw.push(text);
  });

  const selectionText = (window.getSelection() && window.getSelection().toString()) || "";

  let main_text = null;
  const mainEl = document.querySelector("main") || document.querySelector("article");
  if (mainEl) {
    const clone = mainEl.cloneNode(true);
    clone.querySelectorAll("input, textarea, select, script, style").forEach((el) => el.remove());
    const text = clone.innerText;
    if (text) main_text = text;
  }

  let rendered_text = null;
  if (document.body) {
    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll("input, textarea, select, script, style, noscript").forEach((el) => el.remove());
    const text = bodyClone.innerText;
    if (text) rendered_text = text;
  }

  return {
    requested_url: requestedUrl,
    current_url: document.URL,
    canonical_url: rawCanonical || null,
    document_title: document.title,
    document_language: document.documentElement.lang || null,
    meta_description: rawMeta || null,
    json_ld_raw: json_ld_raw,
    selected_text: selectionText || null,
    main_text: main_text || null,
    rendered_text: rendered_text || null,
  };
})()
"""

# Bounds -- exact copy of BOUNDS in src/lib/browserPageCapture.ts.
BOUNDS = {
    "TITLE": 500,
    "URL": 2048,
    "META_DESCRIPTION": 500,
    "SELECTED_TEXT": 5_000,
    "MAIN_TEXT": 50_000,
    "RENDERED_TEXT": 50_000,
    "JSON_LD_ITEMS": 10,
    "JSON_LD_ITEM_CHARS": 10_000,
    "LANGUAGE": 35,
}


def _strip_null_bytes(s: str) -> str:
    return s.replace("\0", "")


def _bound_str(s: str | None, max_len: int) -> str | None:
    if s is None:
        return None
    cleaned = _strip_null_bytes(s).strip()
    return None if len(cleaned) == 0 else cleaned[:max_len]


def _bound_url(s: str | None) -> str | None:
    return _bound_str(s, BOUNDS["URL"])


def _normalize_json_ld(raw_items: list[str]) -> list[Any]:
    result: list[Any] = []
    for raw in (raw_items or [])[: BOUNDS["JSON_LD_ITEMS"]]:
        cleaned = _strip_null_bytes(raw).strip()
        if not cleaned:
            continue
        try:
            parsed = json.loads(cleaned)
        except (ValueError, TypeError):
            continue
        serialized = json.dumps(parsed)
        if len(serialized) > BOUNDS["JSON_LD_ITEM_CHARS"]:
            continue
        result.append(parsed)
    return result


def normalize_capture_data(raw: dict[str, Any], captured_at: str) -> dict[str, Any]:
    """Pure port of normalizeCaptureData() in src/lib/browserPageCapture.ts.

    Same field set, same bounds, same stripping/truncation rules -- produces
    the exact BrowserPageCapture v0.1 shape the real extension would send
    for the same raw capture. Fully unit-testable (see
    test_recovery_cohort.py).
    """
    return {
        "artifact_type": "BrowserPageCapture",
        "spec_version": "v0.1",
        "requested_url": _bound_url(raw.get("requested_url")) or "",
        "current_url": _bound_url(raw.get("current_url")) or "",
        "canonical_url": _bound_url(raw.get("canonical_url")),
        "document_title": _bound_str(raw.get("document_title"), BOUNDS["TITLE"]) or "",
        "document_language": _bound_str(raw.get("document_language"), BOUNDS["LANGUAGE"]),
        "meta_description": _bound_str(raw.get("meta_description"), BOUNDS["META_DESCRIPTION"]),
        "json_ld": _normalize_json_ld(raw.get("json_ld_raw") or []),
        "selected_text": _bound_str(raw.get("selected_text"), BOUNDS["SELECTED_TEXT"]),
        "main_text": _bound_str(raw.get("main_text"), BOUNDS["MAIN_TEXT"]),
        "rendered_text": _bound_str(raw.get("rendered_text"), BOUNDS["RENDERED_TEXT"]),
        "captured_at": captured_at,
    }


# ---------------------------------------------------------------------------
# Cohort row + tally -- pure, unit-testable.
# ---------------------------------------------------------------------------


@dataclass
class CohortRow:
    url: str
    reference_posture: str
    reference_bucket: str
    http_status: int | None = None
    byte_count: int | None = None
    exact_bytes_sha256: str | None = None
    capture_status: str | None = None
    baseline_content_posture: str | None = None
    eligibility: str | None = None
    recovery_outcome: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "reference_posture": self.reference_posture,
            "reference_bucket": self.reference_bucket,
            "http_status": self.http_status,
            "byte_count": self.byte_count,
            "exact_bytes_sha256": self.exact_bytes_sha256,
            "capture_status": self.capture_status,
            "baseline_content_posture": self.baseline_content_posture,
            "eligibility": self.eligibility,
            "recovery_outcome": self.recovery_outcome,
            "error": self.error,
        }


def tally_recovery_outcomes(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Pure tally over already-collected rows. Unit-testable.

    Returns counts by recovery_outcome (including the synthetic "ERROR"
    bucket for rows that never reached an outcome), plus the headline
    RECOVERED count and total row count.
    """
    by_outcome: dict[str, int] = {}
    for row in rows:
        if row.get("error"):
            key = "ERROR"
        else:
            key = row.get("recovery_outcome") or "UNKNOWN"
        by_outcome[key] = by_outcome.get(key, 0) + 1
    return {
        "total": len(rows),
        "by_recovery_outcome": by_outcome,
        "recovered_count": by_outcome.get("RECOVERED", 0),
        "error_count": by_outcome.get("ERROR", 0),
    }


def render_yield_table(rows: list[dict[str, Any]]) -> str:
    """Pure text table renderer. Unit-testable."""
    headers = ["url", "baseline_posture", "eligibility", "recovery_outcome", "http_status", "bytes"]
    col_rows = []
    for row in rows:
        url = row["url"]
        posture = row.get("baseline_content_posture") or (f"ERROR: {row['error']}" if row.get("error") else "-")
        eligibility = row.get("eligibility") or "-"
        outcome = row.get("recovery_outcome") or "-"
        status = str(row.get("http_status")) if row.get("http_status") is not None else "-"
        byte_count = str(row.get("byte_count")) if row.get("byte_count") is not None else "-"
        col_rows.append([url, posture, eligibility, outcome, status, byte_count])

    widths = [len(h) for h in headers]
    for r in col_rows:
        for i, cell in enumerate(r):
            widths[i] = max(widths[i], len(cell))

    def fmt_row(cells: list[str]) -> str:
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    lines = [fmt_row(headers), fmt_row(["-" * w for w in widths])]
    lines.extend(fmt_row(r) for r in col_rows)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# HTTP helpers against the acquisition transport (direct, not through the
# extension) -- same envelope/headers as src/lib/acquisitionClient.ts and
# recoveryClient.ts, just issued from Python.
# ---------------------------------------------------------------------------

TRANSPORT_TOKEN_HEADER = "X-Counterpedia-Transport-Token"
OBSERVATION_PATH = "/v0/browser-observation"
RECOVERY_PATH = "/v0/recovery-assessment"


def post_json(url: str, origin: str, token: str, payload: dict[str, Any], timeout: float) -> tuple[int, dict[str, Any] | None, str | None]:
    """POST payload as JSON; returns (http_status, parsed_body_or_None, error_text_or_None).

    Never raises for an HTTP-level failure (4xx/5xx) -- those are legitimate,
    expected outcomes for some cohort URLs (e.g. a capture_failed). Only a
    connection-level failure (refused/timeout/DNS) is surfaced as an error.
    """
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Origin": origin,
            TRANSPORT_TOKEN_HEADER: token,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None), None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        return exc.code, parsed, None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return 0, None, str(exc)


# ---------------------------------------------------------------------------
# CDP-driven per-URL capture.
# ---------------------------------------------------------------------------


def render_and_extract_bpc(conn: cdp.CDPConnection, url: str) -> dict[str, Any]:
    """Navigate a fresh tab to url, wait for it to settle, and extract a BPC.

    Raises VerifyFailure on a render timeout/failure -- callers turn that
    into an ERROR row rather than aborting the cohort.
    """
    target_id = conn.create_target(url)
    try:
        session = conn.attach(target_id)

        def _settled() -> bool:
            state = conn.evaluate(session, "document.readyState", timeout=3)
            return state == "complete"

        wait_for(_settled, NAV_TIMEOUT_S, f"{url} to finish loading")
        time.sleep(RENDER_SETTLE_S)  # let SPA JS run past the initial load event

        expr = _CAPTURE_PAGE_DATA_JS % {"requested_url": json.dumps(url)}
        raw = conn.evaluate(session, expr, timeout=15)
        if not isinstance(raw, dict):
            raise VerifyFailure(f"capture script returned unexpected shape for {url}: {raw!r}")
        return raw
    finally:
        try:
            conn.call("Target.closeTarget", {"targetId": target_id}, timeout=5)
        except cdp.CDPError:
            pass


def process_one_url(
    conn: cdp.CDPConnection,
    origin: str,
    token: str,
    acquisition_base_url: str,
    url: str,
    reference_posture: str,
    reference_bucket: str,
) -> CohortRow:
    row = CohortRow(url=url, reference_posture=reference_posture, reference_bucket=reference_bucket)
    try:
        raw = render_and_extract_bpc(conn, url)
    except (VerifyFailure, cdp.CDPError, cdp.CDPTimeout) as exc:
        row.error = f"render_failed: {exc}"
        log(f"  [{url}] ERROR (render): {exc}")
        return row

    captured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    bpc = normalize_capture_data(raw, captured_at)

    status, body, err = post_json(
        acquisition_base_url + OBSERVATION_PATH,
        origin,
        token,
        {"browser_page_capture": bpc},
        POST_TIMEOUT_S,
    )
    row.http_status = status if status else None
    if err:
        row.error = f"observation_transport_error: {err}"
        log(f"  [{url}] ERROR (observation transport): {err}")
        return row
    if not isinstance(body, dict):
        row.error = f"observation_bad_response: HTTP {status}"
        log(f"  [{url}] ERROR (observation bad response): HTTP {status}")
        return row

    row.capture_status = body.get("capture_status")
    row.byte_count = body.get("byte_count")
    row.exact_bytes_sha256 = body.get("captured_object_address")

    if row.capture_status != "captured" or not body.get("capture_id"):
        row.error = f"capture_failed: {body.get('failure_detail') or 'no failure_detail'}"
        log(f"  [{url}] capture_failed: {body.get('failure_detail')}")
        return row

    capture_id = body["capture_id"]
    status2, body2, err2 = post_json(
        acquisition_base_url + RECOVERY_PATH,
        origin,
        token,
        {"capture_ref": capture_id, "browser_page_capture": bpc},
        POST_TIMEOUT_S,
    )
    if err2:
        row.error = f"recovery_transport_error: {err2}"
        log(f"  [{url}] ERROR (recovery transport): {err2}")
        return row
    if not isinstance(body2, dict):
        row.error = f"recovery_bad_response: HTTP {status2}"
        log(f"  [{url}] ERROR (recovery bad response): HTTP {status2}")
        return row

    if body2.get("assessment_status") != "assessed":
        row.error = f"recovery_not_assessed: {body2.get('assessment_status')} ({body2.get('failure_detail')})"
        log(f"  [{url}] recovery not assessed: {body2.get('assessment_status')}")
        return row

    observation = body2.get("recovery_observation") or {}
    row.baseline_content_posture = observation.get("baseline_content_posture")
    row.eligibility = observation.get("eligibility")
    row.recovery_outcome = observation.get("recovery_outcome")
    log(
        f"  [{url}] posture={row.baseline_content_posture} eligibility={row.eligibility} "
        f"outcome={row.recovery_outcome}"
    )
    return row


def main() -> int:
    acquisition_dir = os.environ.get("COUNTERPEDIA_ACQUISITION_DIR")
    acquisition_python = os.environ.get("COUNTERPEDIA_ACQUISITION_PYTHON")
    if not acquisition_dir or not acquisition_python:
        print(
            "error: set COUNTERPEDIA_ACQUISITION_DIR and COUNTERPEDIA_ACQUISITION_PYTHON "
            "to point at the reviewed acquisition checkout + interpreter before running.",
            file=sys.stderr,
        )
        return 2

    guard = ProcessGuard()
    conn: cdp.CDPConnection | None = None
    try:
        browser_path = db.resolve_demo_browser()
        log(f"resolved demo browser: {browser_path}")

        # This harness bypasses the extension UI entirely (no toolbar-gesture
        # / activeTab problem -- see PERMISSION FINDING in
        # verify_ui_click_through_e2e.py), so it never loads the unpacked
        # extension into Chrome; it only needs Chrome-for-Testing to RENDER
        # pages, and talks to the acquisition transport directly.
        start_companion(guard, acquisition_dir, acquisition_python)

        extension_id = compute_expected_extension_id()
        origin = f"chrome-extension://{extension_id}"
        pairing = pair_extension(extension_id)
        acquisition_base_url = pairing["acquisition_base_url"]
        token = pairing["acquisition_transport_token"]
        log(f"paired: acquisition_base_url={acquisition_base_url} origin={origin}")

        profile_dir = guard.track_dir(Path(tempfile.mkdtemp(prefix="cpselfload0-cohort-profile-")))
        headless = os.environ.get("COUNTERPEDIA_VERIFY_HEADLESS", "").strip() == "1"
        mode = "HEADLESS (COUNTERPEDIA_VERIFY_HEADLESS=1 override)" if headless else "HEADFUL"
        log(f"launching render browser {mode} (profile={profile_dir})...")
        argv = [
            str(browser_path),
            f"--user-data-dir={profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            f"--remote-debugging-port={CDP_PORT}",
            "about:blank",
        ]
        if headless:
            argv.insert(1, "--headless=new")
        guard.spawn(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

        ws_url = wait_for(lambda: cdp.fetch_browser_ws_url(CDP_PORT), 15.0, "CDP browser endpoint")
        conn = cdp.CDPConnection(ws_url)
        log(f"cohort size: {len(COHORT)} URLs")

        rows: list[CohortRow] = []
        for index, (url, reference_posture, reference_bucket) in enumerate(COHORT, start=1):
            log(f"[{index}/{len(COHORT)}] {url}")
            row = process_one_url(conn, origin, token, acquisition_base_url, url, reference_posture, reference_bucket)
            rows.append(row)

        row_dicts = [r.to_dict() for r in rows]
        tally = tally_recovery_outcomes(row_dicts)

        table = render_yield_table(row_dicts)
        print()
        print(table)
        print()
        print("TOTALS BY recovery_outcome:")
        for outcome, count in sorted(tally["by_recovery_outcome"].items()):
            print(f"  {outcome:<20} {count}")
        print(f"\nRECOVERED: {tally['recovered_count']} / {tally['total']}")
        if tally["error_count"]:
            print(f"ERRORS (render/transport/capture failures): {tally['error_count']}")
            for r in row_dicts:
                if r["error"]:
                    print(f"  - {r['url']}: {r['error']}")

        RESULTS_JSON_PATH.write_text(
            json.dumps({"cohort": row_dicts, "totals": tally}, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        log(f"wrote {RESULTS_JSON_PATH}")

        log("RESULT: PASS (cohort run completed; see table/totals above for yield)")
        return 0
    finally:
        if conn is not None:
            conn.close()
        log("tearing down spawned processes and temp dirs...")
        guard.teardown()
        log("teardown complete.")


if __name__ == "__main__":
    raise SystemExit(main())
