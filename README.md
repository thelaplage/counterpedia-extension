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

## Portable Demo Kit (team beta / invited evaluator)

`DEMO-KIT0` adds a packaging layer for giving the working browser + local runtime + Counterpedia Terminal experience to another Mac without giving the recipient our git/worktree topology.

The builder accepts exact clean checkouts of:

- `counterpedia-extension`;
- `counterpedia-acquisition`;
- `counterpedia-authoring`;
- `dagr-sdk`;
- `dagr-mcp`;
- `counterpedia`;
- `counterpedia-console`.

The two DAGR repositories are first-class bundle components because the governed retained-capture Draft path runs through the reviewed `dagr-mcp` local-demo adapter and SDK lifecycle binding. The installer binds those exact local source snapshots into Acquisition's own venv; it does not rely on a hidden developer checkout or a GitHub clone at Draft time.

It copies **git-tracked source snapshots only**, pins every source commit and snapshot digest in `demo-kit-manifest.json`, and emits one folder/zip with Finder-launchable **Install**, **Start**, **Reset**, and optional **Configure Drafting Key** commands. It does not copy `.git`, node_modules, virtualenvs, user capture custody, logs, transport tokens, or model keys.

Example operator build:

```bash
npm run demo:kit:build -- \
  --acquisition-dir ../counterpedia-acquisition \
  --authoring-dir ../counterpedia-authoring \
  --dagr-sdk-dir ../dagr-sdk \
  --dagr-mcp-dir ../dagr-mcp \
  --counterpedia-dir ../counterpedia \
  --terminal-dir ../counterpedia-console \
  --output-dir "$HOME/Desktop/Counterpedia Demo Kit" \
  --zip
```

Hermetic packaging gates:

```bash
npm run demo:kit:test
python3 tools/counterpedia-local/test_demo_kit_dagr_wiring.py
```

Recipient experience after unzipping:

1. Double-click **Install Counterpedia Demo.command** once.
2. Optional for Draft from source: double-click **Configure Drafting Key.command**.
3. Double-click **Start Counterpedia Demo.command** for normal use.
4. Browse Wikipedia (the kit opens `OpenAI` as the default walkthrough), open the Counterpedia side panel, scan/match, capture, optionally draft, and explicitly cross into Counterpedia CHECK when wanted.
5. Use the Counterpedia Terminal tab as the local/private record-layer inspection surface.
6. Double-click **Reset Counterpedia Demo.command** when finished.

Successful capture remains **UNADMITTED**. DAGR may govern execution of the retained-capture tool, but that execution receipt is not Counterpedia admission. Draft remains proposal-only and Counterpedia admission remains not performed unless a separate real authority acts.

Packaging success is not a substitute for the separately-owned current multi-repository browser proof. Scanner observation remains distinct from CHECK conclusion; successful capture remains UNADMITTED; Draft remains proposal-only. `AUTHORITY_MOVEMENT=0`.

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
  demo_kit_builder.py              — exact tracked-source bundle builder
  demo_kit_install.py              — one-time bundle dependency installer
  demo_kit_runtime.py              — kit start composition (Local + browser + Terminal)
  demo_kit_check.py                — bounded Local/reader/DAGR/Terminal readiness
  demo_kit_reset.py                — kit reset composition
```

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Permissions

- `sidePanel` — open the side panel
- `activeTab` — read the active tab's URL
- `storage` — session cache / local runtime configuration
- `contextMenus` — "Check selection" right-click menu item

Manifest variants may add only the loopback host permissions needed by their local development/demo runtime. No remote code is loaded.
