# WIKI-FRONTIER-CAPTURE0 — explicit capture of Wikipedia-discovered sources

## Purpose

Consume the local discovery frontier produced by `WIKI-HARVEST-BRIDGE0` without
changing what that frontier means.

```text
Wikipedia exact revision
  -> ACQ-WIKI0 reference manifest
  -> exact local source-index classification
  -> operator queues NEW source locators locally
  -> [separate explicit act]
  -> Counterpedia Local /v0/capture-url
  -> producer-owned counterpedia-capture-url
  -> AcquisitionMcpSurface.capture_url
  -> SINGLE_FETCH
  -> exact retained bytes + genuine CaptureReceipt
```

## Dependency

This lane is stacked on extension PR #35 (`WIKI-HARVEST-BRIDGE0`) and requires the
producer command introduced by `counterpedia-acquisition` PR #99.

The extension does **not** synthesize a `BrowserPageCapture` for a citation URL.
The producer already owns URL-only capture semantics, so the companion invokes the
producer-owned command instead.

## Immutable discovery boundary

The persisted frontier remains:

```text
schema_version = counterpedia.wikipedia_reference_frontier.v0.1
authority_posture = discovery_only
acquisition_state = not_attempted
admission = not_performed
```

Capture does not rewrite those fields. A separate local capture-run projection records
what happened during the explicit capture act.

## Capture-run projection

`counterpedia.wikipedia_capture_run.v0.1` stores only receipt-adjacent producer facts
needed to remember the local run:

- source URL;
- `capture_status`;
- `capture_id`;
- `source_id`;
- `source_locator`;
- captured content address;
- byte count;
- failure detail.

The full producer `CaptureReceipt` remains durably registered in the acquisition
producer's existing capture registry. The extension does not mint or canonicalize a
second receipt.

Every local capture-run record states:

```text
authority_posture = capture_receipt_projection_only
admission = not_performed
```

## Explicit-act and boundedness rules

- no capture happens when Wikipedia is visited;
- no capture happens when references are harvested;
- no capture happens when NEW sources are queued;
- capture requires a separate `Capture selected sources` click;
- one UI run is capped at 25 selected URLs;
- each URL is one producer `SINGLE_FETCH` action;
- calls are sequential, not recursive;
- no discovered source is treated as claim support merely because Wikipedia cites it;
- no successful capture becomes admitted, verified, canonical, published, or standing.

## Transport boundary

Counterpedia Local exposes `POST /v0/capture-url` on loopback only. The route:

1. requires a `chrome-extension://` Origin;
2. requires that Origin to equal the currently paired extension id;
3. accepts exactly `{ "url": <string> }`;
4. invokes `counterpedia-capture-url` from the configured acquisition environment;
5. passes the same durable acquisition store root used by browser capture;
6. validates the returned object is exactly the existing
   `acquisition.mcp_surface.v0.1` / `acquisition.capture_url` projection;
7. rejects authority-bearing fields, source-locator mismatch, capture-id mismatch,
   or dishonest `capture_failed` receipt/address output.

The extension then independently validates the same producer result through the
existing `acquisitionResponseGuard` before displaying or recording it.

## Authority statement

**Capture proves only that acquisition fetched and retained bytes and emitted its
CaptureReceipt. It does not prove the source is true, relevant, supportive, admissible,
verified, published, or standing. Admission is not performed.**
