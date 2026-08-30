# counterpedia-extension

Counterpedia Chrome Extension — source-match side panel v0.1, plus the local capture/recovery demo surface.

A Manifest V3 Chrome extension that can show Counterpedia record matches for the active page and, in the local demo configuration, pair with Counterpedia Local for governed capture/recovery workflows.

## Easy launch (macOS demo)

After the one-time technical setup described in [`tools/counterpedia-local/README.md`](./tools/counterpedia-local/README.md), normal demo use is:

```bash
npm run demo:chrome
```

That command delegates to the already-landed `Start Counterpedia Demo.command`. It:

- builds the unpacked extension only when needed;
- starts the existing Counterpedia Local supervisor on loopback;
- waits for the local companion to become ready;
- self-loads the extension into a dedicated Chrome-for-Testing/Chromium profile;
- opens the demo browser without touching the user's normal Chrome profile;
- records only the processes it started so reset can stop them safely.

Useful companion commands:

```bash
npm run demo:check   # bounded readiness/preflight only
npm run demo:reset   # stop this demo session's tracked processes/reset its demo profile
```

The launcher is operational only. Pairing, capture, recovery, and authoring preserve their existing authority semantics; launching the extension does not imply admission, verification, publication, standing, or truth.

## Features

- Side panel showing Counterpedia record matches for the active tab
- Context menu: "Check selection in Counterpedia" for selected text
- Badge showing match count
- Session-cached search index (no re-fetch on every search)
- Local Counterpedia pairing/capture/recovery path in the demo/team-beta configuration
- No remote code loading, no eval, no unsafe-inline

## Development

```bash
npm install
npm run build   # compile TypeScript → dist/
npm test        # run unit tests
npm run lint    # TypeScript type-check
npm run package # build + zip for distribution
```

## Manual Chrome loading

For ordinary extension development without the dedicated demo browser:

1. Run `npm run build` (or the appropriate development build variant).
2. Open Chrome → `chrome://extensions`.
3. Enable "Developer mode".
4. Click "Load unpacked" → select the `dist/` folder.

The one-command demo path intentionally uses Chrome-for-Testing/Chromium instead of the user's stable daily Chrome; see `Start Counterpedia Demo.command` for the bounded self-load behavior.

## Architecture

```text
src/
  background/service-worker.ts  — message routing, badge, context menu
  panel/panel.ts                 — side panel UI and search logic
  panel/index.html               — side panel HTML
  panel/panel.css                — side panel styles
  popup/popup.ts                 — toolbar popup (open panel button)
  popup/index.html               — popup HTML
  lib/
    counterpediaClient.ts        — fetch + cache search index, local search
    cardModel.ts                 — pinned W1 card schema (version 1)
    search.ts                    — URL normalization
    messaging.ts                 — typed Chrome message protocol
  types.ts                       — shared TypeScript types

tools/counterpedia-local/
  Start Counterpedia Demo.command — existing one-click demo bootstrap
  preflight.py                     — bounded readiness check
  reset_demo.py                    — tracked-process/profile reset
  counterpedia_local_operator.py   — local operational supervisor
```

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Permissions

- `sidePanel` — open the side panel
- `activeTab` — read the active tab's URL
- `storage` — session cache / local runtime configuration
- `contextMenus` — "Check selection" right-click menu item

Manifest variants may add only the loopback host permissions needed by their local development/demo runtime. No remote code is loaded.
