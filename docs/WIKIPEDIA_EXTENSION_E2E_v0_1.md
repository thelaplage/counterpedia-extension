# WIKIPEDIA-EXT-E2E0 — real Chrome → durable capture → historical draft

Status: implementation/acceptance runbook for the WIKIPEDIA-EXT-E2E0 closure lane.

This runbook proves one bounded product loop:

```text
real Chrome page
  -> explicit Capture this source
  -> BrowserPageCapture
  -> ACQ1 localhost HTTP :8787
  -> producer re-fetches the source
  -> exact bytes + CaptureReceipt persisted locally
  -> extension renders UNADMITTED acquisition result
  -> separate explicit Draft from source
  -> AUTHOR localhost HTTP :8788
  -> acquisition.process_held_capture(capture_ref)
  -> SAME retained exact bytes reprocessed, ZERO live source fetch
  -> AuthoringAdmissionHandoff(authority_posture=proposal_only)
```

It does **not** prove or perform admission, publication, standing, verification,
or canonical Counterpedia identity.

## Required checkouts

Use the current landed implementations as the operator targets:

- `counterpedia-extension`: `agent/wikipedia-e2e-closure-v0-1` (team beta adds
  the `team/local-beta-v0-1` one-click Counterpedia Local launcher on top of
  this closure branch — see `tools/counterpedia-local/README.md` for that layer)
- `counterpedia-acquisition`: merged replacement `counterpedia-acquisition` PR #76
  at `32ee58c6a544c04b3118ddb77af734d026d024ec`
- `counterpedia-authoring`: merged replacement `counterpedia-authoring` PR #112
  at `7c2b82496ea516e2073bedcd3124433939887663`

The historical branch labels (`agent/extension-durable-store-v0-1`,
`agent/live-held-source-http-v0-1`) are retained only as provenance for the old
drafts. The extension branch is based on the reviewed historical-source head from
PR #16, so `[Draft from source]` calls only the held-capture action and has no
URL-refetch fallback.

## 1. Install the local Python runtimes

In `counterpedia-acquisition`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[mcp]'
```

In `counterpedia-authoring`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[mcp]'
```

The live historical-source runtime uses the OpenAI-backed acquisition observer
and authoring composer, so export the key in the shell that launches authoring:

```bash
export OPENAI_API_KEY='...'
```

Do not put the key in the extension.

## 2. Build and load the Chrome extension

In `counterpedia-extension`:

```bash
npm install
npm run build:authoring-dev
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `counterpedia-extension/dist/`.
5. Copy the extension ID shown by Chrome.

The authoring-dev manifest is intentionally loopback-only: `127.0.0.1:8787`
for acquisition and `127.0.0.1:8788` for authoring.

## 3. Start durable ACQ1

The standalone ACQ1 launcher now defaults to the durable root:

```text
~/.counterpedia/acquisition
```

An explicit `CP_ACQUISITION_HTTP_STORE_ROOT` still overrides it.

In the acquisition virtualenv:

```bash
export CP_ACQUISITION_ALLOWED_ORIGIN="chrome-extension://<EXTENSION_ID>"
export CP_ACQUISITION_TRANSPORT_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export CP_ACQUISITION_HTTP_USER_AGENT='Counterpedia local acquisition/0.1 operator@example.com'
python scripts/run_acquisition_http.py
```

Keep the generated capture token available for step 5. The token is local
transport authentication only; it has no epistemic or admission authority.

Expected listener:

```text
http://127.0.0.1:8787
```

Expected durable layout after successful captures:

```text
~/.counterpedia/acquisition/
├── <2 hex>/
│   └── <62 hex>                     exact content-addressed source bytes
├── capture-registry/
│   └── <capture_id>.json             immutable producer CaptureReceipt
└── sessions/
    └── ...                           producer session results when created
```

## 4. Start live historical-source authoring

In the authoring virtualenv, with `OPENAI_API_KEY` exported and the acquisition
`counterpedia-acquisition-mcp` executable available on `PATH` from the merged
replacement acquisition checkout:

```bash
counterpedia-authoring-live-source \
  --store-root "$HOME/.counterpedia/acquisition" \
  --port 8788
```

This launcher wires two explicit, non-fallback actions:

```text
POST /v0/draft-from-source  historical retained bytes; NO source fetch
POST /v0/draft-from-url     fresh URL observation; separate action
```

The extension's **Draft from source** button uses only the first action.

Expected startup lines include:

```text
listen: http://127.0.0.1:8788
capture store: .../.counterpedia/acquisition
historical action: POST /v0/draft-from-source (retained bytes, NO source fetch)
authority posture: PROPOSAL ONLY
```

## 5. Configure the unpacked extension

Open the service-worker or side-panel DevTools console for the unpacked extension.
Configure the non-secret loopback endpoints in sync storage and keep the ACQ
transport secret session-only:

```js
await chrome.storage.sync.set({
  counterpedia_acquisition_base_url: 'http://127.0.0.1:8787',
  counterpedia_authoring_base_url: 'http://127.0.0.1:8788',
  // AUTHOR-HTTP's current client contract requires a non-empty local token value.
  // It is not an admission/standing credential.
  counterpedia_authoring_token: 'local-authoring-dev'
});

await chrome.storage.session.set({
  counterpedia_acquisition_token: '<CP_ACQUISITION_TRANSPORT_TOKEN>'
});
```

Reload the extension after configuration.

`counterpedia_acquisition_token` is intentionally read only from
`chrome.storage.session`; it is not synced as durable browser configuration.

## 6. Real Wikipedia canary

Open a normal Wikipedia article, for example the Boeing 737 MAX article used in
the earlier manual acceptance run.

In the Counterpedia side panel:

1. Click **Capture this source** exactly once.
2. Wait for acquisition to return a `captured` result.
3. Confirm the visible acquisition state terminates at **UNADMITTED** and shows a
   `sha256:<64 hex>` captured-object address.
4. Record the returned `capture_id` from the acquisition response / DevTools if
   needed for disk inspection.

Do not click Draft until acquisition is actually `captured`.

## 7. Prove the bytes and receipt are durable

With the capture's `sha256:<hex>` object address, split the hex digest into its
first two and remaining sixty-two characters:

```bash
DIGEST='<64-hex-without-sha256-prefix>'
OBJECT="$HOME/.counterpedia/acquisition/${DIGEST:0:2}/${DIGEST:2}"
ls -lh "$OBJECT"
shasum -a 256 "$OBJECT"
```

The computed hash must equal the object address returned by acquisition.

For the capture event:

```bash
ls -lh "$HOME/.counterpedia/acquisition/capture-registry/<capture_id>.json"
cat "$HOME/.counterpedia/acquisition/capture-registry/<capture_id>.json"
```

The registry record's own `capture_receipt.capture_id` must equal the filename's
capture id, and its exact-byte digest must equal the content-addressed object.

## 8. Draft from the historical source

Back in the panel, provide the bounded operator material required by the current
proposal surface:

- subject seed;
- your claim text;
- one or more evidence handles such as `evidence:E001` when produced by the held
  source processing.

Click **Draft from source**.

Acceptance result:

```text
proposal assembled
AUTHORITY: proposal only
Admission: not performed
```

The request must carry the acquisition `capture_id` only as `capture_ref` plus
the source locator as a continuity constraint. It must not copy the receipt,
digest, source id, bytes, standing, publication, or admission fields into the
authoring request.

## 9. Strong no-refetch gate

The automated cross-process test on the extension historical-source branch is
stronger than a normal Wikipedia manual run: it captures source A, shuts the
origin down entirely, and then successfully drafts from the retained bytes.
That gate must remain green before merge because it proves that a hidden URL
fallback could not have succeeded. The current tracked operator runbook should
be read against the merged replacement backend implementations above, not the
historical draft branch labels.

Run with clean backend checkouts wired:

```bash
COUNTERPEDIA_ACQUISITION_DIR=/path/to/counterpedia-acquisition \
COUNTERPEDIA_AUTHORING_DIR=/path/to/counterpedia-authoring \
npx vitest run tests/draftFromSource.e2e.test.ts tests/wikipediaE2EClosure.test.ts
```

## Merge gate

Before any merge:

```text
[ ] extension authoring-dev build loads unpacked in real Chrome
[ ] extension unit/full suite green
[ ] historical source E2E green with real backend checkouts
[ ] acquisition full suite green
[ ] authoring full suite green
[ ] real Wikipedia capture returns durable exact-byte object + registry receipt
[ ] real Draft from source returns proposal_only
[ ] Admission remains not performed
[ ] no URL fallback exists for the historical action
```

No merge, ready flip, or admission/publication change is authorized by this
runbook itself.
