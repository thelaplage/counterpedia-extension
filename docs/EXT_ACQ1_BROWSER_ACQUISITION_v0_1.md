# EXT-ACQ1 — browser → localhost acquisition seam v0.1

**Status:** DRAFT / CANDIDATE

**Authority movement:** 0

EXT-ACQ1 connects the existing explicit browser `BrowserPageCapture` gesture to
the real localhost ACQ1 transport in `counterpedia-acquisition`. It does not
create a second browser capture, a second acquisition schema, an SRS receipt,
verification, admission, standing, or publication state.

## Exact dependency pin

This draft is built against the current hardened ACQ1 candidate head:

```text
repo:   thelaplage/counterpedia-acquisition
PR:     #30
head:   84da042c3b422cad2128fe2a0b72055637328539
status: DRAFT / UNMERGED at EXT-ACQ1 authoring time
```

That pin is an integration dependency, not authority. If ACQ1 #30 changes before
landing, the cross-process test must be re-pinned and re-run; do not silently test
against a different checkout.

## Canonical browser path

```text
explicit user click
  → existing CAPTURE_PAGE request (exactly once)
  → BrowserPageCapture v0.1
  → browser posture = observed_in_browser
  → EXT-ACQ1 local acquisition posture = pending
  → POST /v0/browser-observation
       Origin: browser-owned chrome-extension://<id>
       X-Counterpedia-Transport-Token: per-browser-session local token
       { browser_page_capture: <the exact same BPC object> }
  → ACQ1 real producer
       resolve_browser_capture_source()
       → AcquisitionMcpSurface.capture_url()
       → HttpFetcher
       → exact source bytes
       → acquisition.capture.v0.1 CaptureReceipt
  → strict CaptureUrlResult validation in the extension
  → acquisition capture receipt available | capture_failed | transport unavailable
```

Browser `main_text`, `rendered_text`, and `selected_text` remain observation hints.
The acquisition producer refetches the source. The browser observation is never
promoted to authoritative source bytes.

## State separation

The Source panel deliberately does not collapse these states:

```text
Browser observation
  Observed in this browser

Acquisition
  Acquisition capture receipt: available | failed | not configured
  exact bytes: sha256:...

SRS
  SRS source-capture receipt: not represented

Admission
  Admission: not established
```

A successful ACQ1 response is **not** displayed as a generic “receipt available”
that could be mistaken for SRS or source-work authority. It is specifically an
**acquisition capture receipt**.

The pre-existing EXT-BROWSER1 `Counterpedia source work` / receipt resolution
lane remains independent and is not advanced by ACQ1.

## Token posture

- No token exists in source or manifest.
- The demo panel accepts the operator's local token in a password field.
- The token is stored only in `chrome.storage.session` under the pinned EXT-ACQ1
  key; it is not written to `chrome.storage.local`.
- The input is cleared immediately after save.
- UI copy never renders the token.
- The token authenticates local transport only. It carries no epistemic or
  governance authority.

The acquisition server must be started with the same token and with the exact
extension Origin:

```bash
export CP_ACQUISITION_ALLOWED_ORIGIN='chrome-extension://<actual-extension-id>'
export CP_ACQUISITION_TRANSPORT_TOKEN='<local-session-token>'
python3 scripts/run_acquisition_http.py
```

## Permission posture

Production `manifest.json` is unchanged and still has **no host_permissions**.

Only `manifest.demo.json` gains:

```text
http://127.0.0.1:8787/*
```

The pre-existing legacy demo orchestrator permission at `:4317` remains separate.
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
acquisition checkout:

```bash
COUNTERPEDIA_ACQUISITION_REPO=/path/to/counterpedia-acquisition \
  npm run test:acq1:cross-process
```

When enabled it:

1. refuses unless the acquisition checkout HEAD equals the exact pin above;
2. starts a real local HTTP source fixture with literal bytes;
3. spawns the real Python ACQ1 server on an ephemeral loopback port;
4. sends a real BPC through the real TypeScript client;
5. exercises the real Python `HttpFetcher` path;
6. independently SHA-256 hashes the fixture bytes in Node;
7. requires the returned content address and receipt digest to equal that
   independently computed digest;
8. proves the deliberately different BPC rendered text did not become source
   bytes;
9. asserts the producer result carries no SRS/admission/standing/publication
   surface.

With `COUNTERPEDIA_ACQUISITION_REPO` absent, this integration test is skipped. A
skip is **not** evidence that the cross-process seam passed.

## Required validation before merge

```bash
npm run lint
npm test
npm run build
npm run build:demo
COUNTERPEDIA_ACQUISITION_REPO=/path/to/counterpedia-acquisition \
  npm run test:acq1:cross-process
git diff --check
```

Additionally, ACQ1 #30's **own** current-head focused/full Python test suite must
be observed green before this integration pin is treated as stable.

## Not established

EXT-ACQ1 establishes none of the following:

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

The next product lane after this seam is proven is **Draft from source**, using the
already-existing proposal-only authoring contracts rather than extending
acquisition further.
