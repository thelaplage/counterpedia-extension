# BrowserPageCapture v0.1 — Contract Provenance

**producer:** counterpedia-extension
**contract:** BrowserPageCapture v0.1
**source implementation:** `src/lib/browserPageCapture.ts`
**transport serialization:** `src/lib/captureDigest.ts::captureBytes`
**exact transport rule:** `UTF-8 JSON.stringify(capture)` — identity-preserving; no sorting or normalization

## Serialization note

The transport bytes are produced by `captureBytes(capture) = JSON.stringify(capture)`.
This is **NOT** RFC 8785 / JCS canonical JSON and must not be described as such.
Property order reflects the object literal order in `normalizeCaptureData()` and is
**not** alphabetically sorted. Do not silently re-serialize or rebuild the object
before hashing — that would change the digest and break the producer guarantee.

## Observation artifact

BrowserPageCapture is an **observation artifact**. It records what the browser's
rendering engine presented to the user at capture time.

- It is **not** HTTP source bytes.
- It is **not** truth evidence for the content of the original document.

### Downstream consumer obligations

- `rendered_text` and `main_text` MUST NOT be promoted into source bytes or treated
  as authoritative representations of the original document.
- `selected_text` MAY be used only as a relevance hint unless another explicit
  authority grants it a stronger status.

## Schema

See `browser-page-capture.v0.1.schema.json` in this directory.

## Golden fixture

See `tests/fixtures/browser-page-capture/v0.1/golden.json` for the committed
producer golden (exact `captureBytes()` output) and `golden.sha256` for the
SHA-256 pin over those bytes.
