# Counterpedia Local — team beta

Counterpedia Local is a **local process supervisor and browser-pairing utility**. It is not an admission, verification, publication, standing, or corpus authority.

Its job is operational only:

```text
Counterpedia browser extension
        |
        | one-click local pairing
        v
Counterpedia Local :8790
   |                    |
   v                    v
Acquisition :8787    Authoring :8788
   |                    |
   +---- same durable --+
         capture store
```

## Team-member experience

After one-time technical installation:

1. Double-click **Counterpedia Local.command**.
2. The local status page opens.
3. Open the Counterpedia browser side panel.
4. Click **Connect Counterpedia Local**.
5. Browse to a source and click **Capture this source**.
6. A successful producer capture still terminates visibly as **UNADMITTED**.
7. Enter operator claim material and choose **Draft from source**.
8. A successful authoring result remains **proposal only** and **Admission: not performed**.

No extension ID, localhost port, transport token, `chrome.storage`, DevTools, git branch, or virtualenv command is part of normal use.

## One-time technical installation

This first beta intentionally supervises the already-reviewed sibling implementations rather than copying their logic. Prepare these checkouts/environments once on the Mac:

- `counterpedia-acquisition` on `agent/extension-durable-store-v0-1` with `.venv` and the `mcp` extra installed;
- `counterpedia-authoring` live-source worktree/checkout on `agent/live-held-source-http-v0-1` with `.venv` and the `mcp` extra installed;
- this extension branch built with `npm run build:authoring-dev` and loaded unpacked from `dist/`.

Defaults:

```text
acquisition: ~/Developer/repos/counterpedia-acquisition
authoring:   ~/Developer/worktrees/counterpedia-authoring-live-source
store:       ~/.counterpedia/acquisition
```

Technical installers may override the first two with `COUNTERPEDIA_ACQUISITION_DIR` and `COUNTERPEDIA_AUTHORING_DIR`.

Authoring currently reads `OPENAI_API_KEY` from the environment that launches Counterpedia Local. The key is never returned by `/v0/status`, `/v0/diagnostics`, or `/v0/pair`, and the companion suppresses obvious secret-bearing log lines in its bounded diagnostic report.

## Pairing contract

The extension calls `POST http://127.0.0.1:8790/v0/pair` with its own `chrome.runtime.id`.

Counterpedia Local:

1. requires a `chrome-extension://<id>` Origin;
2. requires the body `extension_id` to equal that Origin's id;
3. generates a fresh acquisition transport token;
4. launches acquisition with that exact extension Origin, token, and durable store root;
5. launches authoring against the same durable store when an OpenAI key is configured;
6. returns only local transport/runtime configuration.

The extension validates the exact pairing schema and exact loopback endpoints before writing anything. The acquisition credential goes only to `chrome.storage.session`; it is never written to sync storage.

Pairing is **transport configuration only**. It establishes no truth, evidence authority, admission, publication, standing, or verification.

## Bounded diagnostics

The local status page exposes **Copy diagnostic report**. The report contains service readiness, dependency paths/presence, durable-store path, paired extension id, and a short sanitized log tail. It does not include the acquisition transport token or OpenAI API key.

## Current beta boundary

This removes day-to-day terminal/DevTools configuration but is not yet a signed installer. The remaining packaging lane is to bundle the sibling runtimes and this supervisor into a signed/notarized Counterpedia Local macOS app so technical installation also disappears.
