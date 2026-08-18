# WIKI-CAPTURE-AUTHOR0 — captured Wikipedia source → existing held-source authoring

## Purpose

Connect a successful source capture discovered through the Wikipedia reference frontier to the already-existing historical **Draft from source** action without creating a Wikipedia-specific authoring pipeline.

The bridge is deliberately only a **selection** seam:

```text
Wikipedia revision
  -> reference discovery
  -> operator queues NEW source
  -> explicit source capture
  -> real acquisition.capture_url result + CaptureReceipt
  -> explicit "Use for Draft from source" selection
  -> LOCAL_ONLY selection saved for lifecycle recovery
  -> existing generic Draft-from-source UI becomes ready
  -> operator supplies claim material
  -> separate Draft from source click
  -> existing /v0/draft-from-source
  -> acquisition.process_held_capture over retained bytes
  -> proposal_only authoring handoff
```

## Ownership

No new producer capability is added here.

- `counterpedia-acquisition` owns source capture, the durable object store, CaptureReceipt identity, the capture registry, and `acquisition.process_held_capture`.
- `counterpedia-authoring` owns `/v0/draft-from-source`, source-locator continuity, held-byte reprocessing, and the terminal proposal-only handoff.
- `counterpedia-extension` owns only the explicit operator selection, its `LOCAL_ONLY` lifecycle-recovery cache, and the existing authoring UI gesture.

## Selection seam and lifecycle recovery

`src/lib/governedSourceSelection.ts` accepts only an already-guarded result satisfying all of:

- `tool = acquisition.capture_url`
- `surface_schema = acquisition.mcp_surface.v0.1`
- `capture_status = captured`
- non-empty `capture_id`
- non-empty `source_locator`
- non-empty `captured_object_address`
- real `capture_receipt` object
- `capture_receipt.capture_id == capture_id`
- `capture_receipt.source_locator == source_locator`

The explicit selection may be persisted under `counterpedia_governed_source_selection_v0_1` in `chrome.storage.local` as `LOCAL_ONLY` / `selection_only` resumable work. On restore the extension re-runs both the acquisition response guard and the selection continuity checks before making the historical source available again.

This local record is not a second capture contract or receipt authority. It copies the exact already-guarded producer projection solely so the operator's explicit selection can survive panel/window/browser lifecycle loss. Producer bytes, registry custody, and CaptureReceipt authority remain in `counterpedia-acquisition`.

Persist, restore, and selection perform no acquisition or authoring network operation. Restore never auto-drafts.

See `docs/WIKIPEDIA_SESSION_PERSISTENCE_v0_1.md` for the complete lifecycle state classification, completed-run recovery semantics, and typed-unknown rule for an interrupted batch that never committed its local summary.

## Explicit acts remain separate

The sequence contains distinct operator decisions:

1. Harvest Wikipedia references.
2. Queue a NEW reference locator.
3. Capture selected source(s).
4. Choose one successful capture with **Use for Draft from source**.
5. Supply operator-authored claim/evidence material.
6. Click the existing **Draft from source** button.

No earlier step triggers a later one automatically. Restart recovery only reconstructs local readiness for an earlier explicit selection.

## One draft path, zero fallback

The Wikipedia capture panel does **not** import or call `authoringClient`, `/v0/draft-from-source`, or `/v0/draft-from-url`.

It persists the explicit local selection and calls `selectGovernedSource(result)`; neither operation drafts.

The existing `draftFromSourceButton.ts` remains the sole dispatch surface and calls only:

```text
client.draftFromHeldCapture(...)
```

It never calls `draftFromUrl()` as a primary path, retry, or fallback.

When both exist, an active-page governed capture remains primary over the restored historical selection, preserving the pre-existing page-capture behavior.

## Authority boundary

```text
Wikipedia citation != claim support
capture != evidence support
capture != admission
selection != draft
selection persistence != capture authority
restore != draft
Draft from source != admission
proposal_only != publication
```

**AUTHORITY MOVEMENT = 0.**

## Validation

Focused gates:

```bash
npx vitest run \
  tests/governedSourceSelection.test.ts \
  tests/wikipediaCaptureAuthoringBoundary.test.ts \
  tests/draftFromSourceButton.test.ts \
  tests/wikipediaFrontierCapture.test.ts
npm test
npm run lint
npm run build:authoring-dev
git diff --check
```

Live acceptance:

1. Harvest a real Wikipedia revision.
2. Queue one NEW reference URL.
3. Capture it through the producer and require `capture_status=captured`.
4. Click **Use for Draft from source** and verify no authoring request is emitted yet.
5. Close/reopen the panel or browser and verify the local selection is revalidated and the existing Draft-from-source lane becomes ready without drafting.
6. Enter operator-authored claim/evidence material.
7. Click **Draft from source** exactly once.
8. Require `/v0/draft-from-source` / held-capture processing against the selected `capture_id` and exact source locator.
9. Confirm no new source fetch occurs during drafting and the terminal handoff remains `proposal_only`.
