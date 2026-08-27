# PITCH-RESEARCH1A — browser → localhost acquisition seam v0.1

**Status:** DRAFT / BUILD VEHICLE

**Authority movement:** 0

This lane connects the existing explicit browser `BrowserPageCapture` gesture to
the current real localhost HTTP transport in `counterpedia-acquisition`. It does
not create a second browser capture, a second acquisition schema, an SRS receipt,
verification, admission, standing, or publication state.

## Exact dependency pin

The cross-process pitch harness is pinned to the current acquisition build head:

```text
repo:   thelaplage/counterpedia-acquisition
PR:     #158
branch: feat/pitch-research1a-http
head:   dfa7a3b00c105f9cc0796b7777ef88eaef36d30d
runtime parent: 384ce7c364a2784356a93d3295873b2c0b420c00
status: implementation present; current pitch-head execution not yet claimed here
```

The pitch head differs from the runtime parent only by the PITCH-RESEARCH1A
dispatch record. The pin is an integration dependency, not authority. Any
producer change requires an explicit re-pin and a fresh cross-process run.

## Canonical browser path

```text
explicit user click
  → existing CAPTURE_PAGE request (exactly once)
  → BrowserPageCapture v0.1
  → browser posture = observed_in_browser
  → local acquisition posture = pending
  → POST /v0/browser-observation
       Origin: browser-owned chrome-extension://<id>
       X-Counterpedia-Transport-Token: per-browser-session local token
       { browser_page_capture: <the exact same BPC object> }
  → real acquisition producer
       resolve_browser_capture_source_for_capture()
       → AcquisitionMcpSurface.capture_url()
       → HttpFetcher
       → exact source bytes
       → acquisition.capture.v0.1 CaptureReceipt
  → strict CaptureUrlResult validation in the extension
  → acquisition capture receipt available | capture_failed | transport unavailable
```

Browser `main_text`, `rendered_text`, and `selected_text` remain observation hints.
The acquisition producer fetches the selected source URL itself. The browser
observation is never promoted to authoritative source bytes.

## State separation

The Source panel deliberately does not collapse these states:

```text
Browser observation
  Observed in this browser

Acquisition
  Acquisition capture receipt: available | failed | not configured
  exact bytes: sha256:...

Counterpedia source work
  Source-work receipt: available | not yet available

SRS
  SRS source-capture receipt: not represented

Admission
  Admission: not established
```

A successful acquisition response is **not** displayed as a generic “receipt
available” that could be mistaken for SRS or source-work authority. It is
specifically an **acquisition capture receipt**.

The pre-existing Counterpedia source-work / receipt resolution lane remains
independent and is not advanced by acquisition success.

## Stale-result discipline

A browser navigation or `CLEAR` event invalidates the current acquisition request
generation and clears the stored BPC before a new source is rendered. A slow
result for page A therefore cannot arrive after the panel has moved to page B and
overwrite page B's acquisition state. This is a UI/source-coherence boundary, not
an admission or verification rule.

## Token posture

- No token exists in source or manifest.
- The demo panel accepts the operator's local token in a password field.
- The token is stored only in `chrome.storage.session`; it is not written to
  `chrome.storage.local`.
- The input is cleared immediately after save.
- UI copy never renders the token.
- The token authenticates local transport only. It carries no epistemic or
  governance authority.

The production acquisition server is started with the same token and the exact
extension Origin:

```bash
export CP_ACQUISITION_ALLOWED_ORIGIN='chrome-extension://<actual-extension-id>'
export CP_ACQUISITION_TRANSPORT_TOKEN='<local-session-token>'
python3 scripts/run_acquisition_http.py
```

Production retains its fail-closed network egress policy. There is **no**
production environment switch that relaxes loopback/SSRF target policy.

## Permission posture

Production `manifest.json` has **no host_permissions**.

Only `manifest.demo.json` grants the exact local services used by the demo:

```text
http://127.0.0.1:4317/*   # pre-existing legacy demo orchestrator
http://127.0.0.1:8787/*   # acquisition HTTP transport
```

No `<all_urls>` or non-loopback permission is introduced.

## Response validation

`src/lib/acquisitionTransport.ts` validates the existing producer shape, not a
new extension-owned capture schema:

- exact `tool = acquisition.capture_url`;
- exact `surface_schema = acquisition.mcp_surface.v0.1`;
- exact closed top-level field set;
- nested `acquisition.capture.v0.1` receipt shape;
- `sha256:<64 lowercase hex>` content address;
- non-negative byte counts;
- top-level capture id/source locator/digest/byte count must equal the nested
  receipt values on `captured`;
- `capture_failed` must carry no receipt/digest/byte count;
- unknown/future fields fail closed.

The extension does **not** rederive acquisition `source_id`; producer identity
semantics remain producer-owned.

## True cross-process acceptance gate

Unit tests are not sufficient for this lane. The acceptance harness at
`tests/integration/acq1CrossProcess.test.ts` is opt-in and requires an explicit
acquisition checkout at the exact pin above:

```bash
COUNTERPEDIA_ACQUISITION_REPO=/path/to/counterpedia-acquisition \
  npm run test:acq1:cross-process
```

When enabled it:

1. refuses unless the acquisition checkout HEAD equals the exact pitch pin;
2. starts a real local HTTP source fixture with literal bytes;
3. spawns `scripts/run_acquisition_http_test_fixture.py` from the real producer;
4. sends a real BPC through the real TypeScript client;
5. exercises the real Python `HttpFetcher` path;
6. independently SHA-256 hashes the fixture bytes in Node;
7. requires returned object address / receipt digest / byte count to match;
8. proves deliberately different BPC rendered text did not become source bytes;
9. asserts the producer result carries no SRS/admission/standing/publication
   surface.

The test-only launcher is a separate source file from the production launcher.
It relaxes only outbound target-address classification so a loopback fixture can
stand in for a remote source; the production launcher cannot select that policy.

This is a cross-process producer-consumer exact-byte proof. It does not by itself
prove Chrome's browser-owned Origin behavior because the Node wrapper supplies
the Origin under test. Chrome acceptance remains a separate browser-level gate.

With `COUNTERPEDIA_ACQUISITION_REPO` absent, this integration test is skipped. A
skip is **not** evidence that the cross-process seam passed.

## Required validation before merge consideration

```bash
npm run lint
npm test
npm run build
npm run build:demo
COUNTERPEDIA_ACQUISITION_REPO=/path/to/counterpedia-acquisition \
  npm run test:acq1:cross-process
git diff --check
```

The current acquisition producer head's focused/full Python tests must also be
observed green. Prior-head results do not establish this pin.

## Not established

This lane establishes none of the following:

- SRS receipt emission;
- source declaration binding;
- source truth;
- claim support;
- verification;
- custody;
- admission;
- publication;
- Counterpedia canonical identity;
- producer delegation.

Once the cross-process proof is observed against the current pin, **stop
acquisition work**. The next product lane is **Draft from source**, using the
existing proposal-only `counterpedia-authoring` contracts rather than extending
acquisition further.
