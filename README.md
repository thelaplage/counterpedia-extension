# counterpedia-extension

Counterpedia Chrome Extension — source-match side panel v0.1.

A Manifest V3 Chrome extension that shows Counterpedia governed records matching
the current page URL or explicitly selected text.

## Features

- Side panel showing Counterpedia record matches for the active tab
- Context menu: "Check selection in Counterpedia" for selected text
- Badge showing match count
- Session-cached search index (no re-fetch on every search)
- No remote code loading, no eval, no unsafe-inline

## Development

```bash
npm install
npm run build   # compile TypeScript → dist/
npm test        # run unit tests
npm run lint    # TypeScript type-check
npm run package # build + zip for distribution
```

## Loading in Chrome

1. Run `npm run build`
2. Open Chrome → `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select the `dist/` folder

## Architecture

```
src/
  background/service-worker.ts  — message routing, badge, context menu
  panel/panel.ts                — side panel UI and search logic
  panel/index.html              — side panel HTML
  panel/panel.css               — side panel styles
  popup/popup.ts                — toolbar popup (open panel button)
  popup/index.html              — popup HTML
  lib/
    counterpediaClient.ts       — fetch + cache search index, local search
    cardModel.ts                — pinned W1 card schema (version 1)
    search.ts                   — URL normalization
    messaging.ts                — typed Chrome message protocol
  types.ts                      — shared TypeScript types
```

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Permissions

- `sidePanel` — open the side panel
- `activeTab` — read the active tab's URL
- `storage` — session cache for search index; configurable base URL
- `contextMenus` — "Check selection" right-click menu item

No `<all_urls>` host permissions. No access to page content.
