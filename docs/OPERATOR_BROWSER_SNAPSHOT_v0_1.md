# OPERATOR-BROWSER0 — explicit browser page snapshot v0.1

## Purpose

Provide a legitimate operator-mediated acquisition route for a source that an ordinary browser can load after automated acquisition routes have failed or been blocked.

This lane does **not** attempt to defeat anti-bot controls. It records what the operator explicitly chose to retain from the active Chrome tab.

## Product path

```text
operator opens source in ordinary Chrome
  -> explicit "Capture browser snapshot" click
  -> chrome.pageCapture.saveAsMHTML(active tab)
  -> bounded multipart/related snapshot bytes
  -> paired Counterpedia Local :8790
  -> counterpedia-ingest-operator-snapshot (Acquisition producer)
  -> content-addressed object store
  -> distinct OperatorBrowserSnapshotReceipt
```

## Deliberate non-equivalences

```text
BrowserPageCapture observation != operator page snapshot bytes
operator page snapshot != raw HTTP response
operator page snapshot receipt != HttpFetcher CaptureReceipt
browser loaded != source identity proven
requested URL != current URL unless equal
snapshot retained != verified/admitted/published/standing
```

The existing `BrowserPageCapture v0.1` contract is unchanged. It remains an observation artifact built from document/DOM projections.

## Locator provenance

The operator snapshot producer preserves two locator fields independently:

- `expected_source_locator`: optional URL supplied by the operator/task;
- `current_locator`: active-tab URL at snapshot time.

Exact equality is a mechanical continuity fact. Any drift is shown as review-required and is not promoted to source equivalence by the extension or Acquisition.

## Permission posture

The team-beta authoring manifest adds only Chrome's purpose-built `pageCapture` permission. This lane does not add:

- `debugger`;
- `webRequest` / response interception;
- broad `all_urls` host access;
- fingerprint spoofing / stealth plugins;
- CAPTCHA automation;
- credential or paywall bypass.

## Local companion

`counterpedia_local_operator.py` is an additive wrapper around the existing Counterpedia Local supervisor/handler. Existing routes are inherited unchanged. The new `/v0/operator-snapshot` route:

- accepts only the paired extension origin;
- bounds JSON and decoded snapshot size;
- validates `multipart/related`;
- invokes the producer-owned Acquisition CLI with snapshot bytes on stdin;
- strictly validates the returned distinct snapshot receipt;
- refuses any claim that the strict capture registry was written.

## Dependency

Requires `counterpedia-acquisition` PR #146 (`OPERATOR-SNAPSHOT-INGEST0`) installed in the Acquisition environment so `.venv/bin/counterpedia-ingest-operator-snapshot` exists.

## Authority

`AUTHORITY_MOVEMENT=0`.

No automatic capture, crawl, verification, admission, standing, publication, or source-equivalence decision is introduced.
