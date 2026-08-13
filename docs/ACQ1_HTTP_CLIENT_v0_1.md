# ACQ1-HTTP — browser → acquisition client (v0.1)

The extension half of the ACQ1-HTTP loop: submit an existing `BrowserPageCapture`
to the **real** localhost acquisition producer over a constrained HTTP transport
and render the result as **UNADMITTED**.

## The loop

```text
browser capture (BrowserPageCapture)
  → createHttpAcquisitionClient  (src/lib/acquisitionClient.ts)
  → POST http://127.0.0.1:8787/v0/browser-observation
      { "browser_page_capture": <BPC> }   + X-Counterpedia-Transport-Token
  → real counterpedia-acquisition HTTP adapter → real producer → CaptureReceipt
  → parseAcquisitionCaptureResult  (src/lib/acquisitionResponseGuard.ts)   [fail closed]
  → renderAcquisitionResult        (src/lib/acquisitionState.ts)
  → UNADMITTED
```

## Files

- `src/lib/acquisitionClient.ts` — HTTP client, `notConfigured` client, honest selection, config read.
- `src/lib/acquisitionResponseGuard.ts` — fail-closed response allow-list (client-side defense-in-depth).
- `src/lib/acquisitionState.ts` — `CAPTURED → ACQUISITION_PENDING → RECEIPT_AVAILABLE → UNADMITTED`; never renders ADMITTED/VERIFIED/PUBLISHED/SUPPORTED.
- `manifest.acquisition-dev.json` — dev build carrying the `127.0.0.1:8787` host permission (production/demo manifests untouched). Build with `npm run build:acquisition-dev`.
- `tests/acquisitionLoop.e2e.test.ts` — real cross-process E2E (spawns the real Python server).

## Configuration

Stored in `chrome.storage.sync`, mirroring the existing `counterpedia_base_url`
pattern:

| Key | Meaning |
|---|---|
| `counterpedia_acquisition_base_url` | e.g. `http://127.0.0.1:8787` (loopback only) |
| `counterpedia_acquisition_token` | per-run local transport token |

Selection is honest: without both values, `selectAcquisitionClient` returns the
`notConfigured` client, which **never fabricates** a successful acquisition.

## What this proves / does not prove

**Proves:** a real configured browser surface can drive the real acquisition
producer over an authenticated, origin-restricted, loopback-only transport and
receive genuine capture facts whose `exact_bytes_sha256` is independently
verifiable.

**Does NOT prove:** claim truth, source authority, claim admission, publication
eligibility, `ClaimSupportEdge` promotion, governed support, or semantic standing.
A successful capture is terminally **UNADMITTED**.

## Lane firewall

ACQ1-HTTP is the product/ingestion lane. Success here **cannot** populate or
satisfy any cell of the **DAGR — ClaimSupportEdge Producer Promotion Gate**
(G1/G2/G9/G13), cannot choose the ClaimSupportEdge schema/ownership, cannot mint a
`support_type`/`governance_state` vocabulary, and cannot authorize
`CG-EDGE-ADAPT0`. Enforced by `tests/acquisitionNegativeSpace.test.ts` and the
client-side response guard.

## Transport authentication

The transport token authenticates **transport access only**. It is not an
epistemic, admission, publication, verification, or corpus capability and must
never be reused as one. It lives solely in `acquisitionClient.ts`.

## Defense-in-depth

The localhost server validates its own output, but the client does **not** trust a
response merely because it is localhost. `parseAcquisitionCaptureResult` fails
closed on any unknown top-level field, any authority-bearing key at any nesting
depth (`standing`/`admitted`/`published`/`verified`/`support_type`/
`governance_state`/`claim_support_edge`/…), any non-`captured`/`capture_failed`
status, and any success/failure field-integrity violation.

## Running the real loop test

```bash
COUNTERPEDIA_ACQUISITION_DIR=/path/to/counterpedia-acquisition npm test
```

The E2E spawns the real Python acquisition server, serves deterministic fixture
bytes from a local source, drives the real client + guard, and asserts the digest
and the `UNADMITTED` terminal state. If no acquisition checkout is found it
**skips loudly** (the loop is not exercised) rather than passing hollow.
