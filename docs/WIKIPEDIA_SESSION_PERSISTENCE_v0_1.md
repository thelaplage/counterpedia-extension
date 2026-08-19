# WIKI-SESSION-PERSIST0 — Wikipedia extension lifecycle recovery

## Purpose

Make the extension honest across side-panel close, browser-window close, extension service-worker suspension, and browser restart without moving capture authority into the browser client.

The rule is simple: **durable producer facts stay producer-owned; resumable operator intent may be cached locally; transient UI is reconstructed.** A reset panel must never imply that an already-completed acquisition capture disappeared.

## State ownership

| State | Store | Durability | Meaning |
| --- | --- | --- | --- |
| Capture object bytes + CaptureReceipt + capture registry | `counterpedia-acquisition` | producer-durable | Authoritative acquisition fact. Extension lifecycle does not delete or downgrade it. |
| Wikipedia reference frontier | `chrome.storage.local` / `counterpedia_wikipedia_reference_frontier_v0_1` | local-durable | Resumable discovery queue only. `NEW` source locators are not captured, admitted, or supported merely because they are queued. |
| Wikipedia completed capture-run projection | `chrome.storage.local` / `counterpedia_wikipedia_capture_runs_v0_1` | local-durable after batch commit | Bounded local audit of producer outcomes. It is metadata-only and carries no admission/support authority. In-progress batch progress is not durable. |
| Explicit Draft-from-source selection | `chrome.storage.local` / `counterpedia_governed_source_selection_v0_1` | local-durable, `LOCAL_ONLY` | Resumable operator intent pointing at one already-guarded successful producer result. Restore only makes the existing draft action ready. |
| Research sessions / encounter refs | existing extension local stores | local-durable | Separate human grouping/history feature; not capture authority and not a substitute for the Wikipedia frontier/capture-run records. |
| Local companion transport credential | `chrome.storage.session` | session-only by design | Secret transport state. It is deliberately **not** promoted to durable local storage by this lane. |
| Checkboxes, DOM status copy, scroll position, transient panel search state | page/module memory | ephemeral | Reconstructed UI. No correctness claim may depend on its survival. |
| A request whose producer response has not yet been recorded locally | in flight | **unknown locally after lifecycle loss** | Never infer `capture_failed` or `not captured`; never auto-retry merely because the panel restarted. |

## Recovery semantics

### Queued work

The Wikipedia reference frontier already lives in `chrome.storage.local`. Reopening the panel re-reads the same frontier and reconstructs the queue. Checkbox presentation is intentionally not persisted; queue membership is the durable fact.

### Completed capture-run history

Completed Wikipedia capture runs already live in `chrome.storage.local`. This lane adds a strict read/recovery path for that existing store and renders recent matching runs when the panel is reopened. The reader rejects malformed or authority-widened records instead of treating them as trustworthy history.

The capture-run record is committed at the end of the explicit batch operation; this lane does **not** turn per-click UI progress into a durable transaction log. Once committed, the run summary is designed to survive panel/window/browser restart, because it is read back from `chrome.storage.local` on panel initialization rather than kept in module memory. Exact bytes, CaptureReceipt authority, and registry custody remain in `counterpedia-acquisition`.

**Proof status:** storage-based session persistence is implemented and unit-tested (the recovery reader in `tests/wikipediaSessionPersistence.test.ts` is exercised against an in-memory `chrome.storage.local` mock, not a real browser). A live Chrome kill/restart acceptance test is **not yet established** — there is no puppeteer/playwright browser-automation harness in this repo that actually kills and relaunches Chrome against a persisted profile. Treat "survives restart" as an implemented-and-unit-tested design property, not as a live-verified fact, until the scripted regression proof below has actually been run and recorded.

If lifecycle loss occurs before the batch's local run record is committed, even producer responses that may already have completed are not reconstructed from UI memory. Those local outcomes are classified as unknown until a producer-owned reconciliation path proves them. This is intentional and avoids duplicate automatic capture acts.

### Explicit Draft-from-source selection

`Use for Draft from source` persists the already-guarded `AcquisitionCaptureResult` as `LOCAL_ONLY` selection state and then selects it in memory. On panel initialization the extension:

1. reads the local record;
2. validates the exact local manifest shape;
3. re-runs the acquisition response guard;
4. re-runs capture/receipt continuity checks;
5. restores selection readiness only if all checks pass.

Restore performs no network request, no re-acquisition, and no authoring action. The operator must still supply claim material and click the existing **Draft from source** button.

An active-page governed capture remains primary over the restored historical selection.

## Typed unknown for interrupted requests

There is an unavoidable boundary between producer durability and client knowledge:

```text
extension sends capture request
        |
        | producer may complete durable capture
        v
extension receives + validates producer response
        |
        v
extension commits local capture-run summary
```

If lifecycle loss occurs before the validated producer response is recorded locally, the extension does not know the outcome on restart. The correct local state is **unknown**, not failure and not success.

This lane deliberately does **not** auto-retry that URL. Automatic retry could create duplicate capture acts and would turn absence of local knowledge into an unauthorized behavioral assumption. Backend reconciliation may later recover the producer fact through a producer-owned read surface; until then the UI says the local outcome is unknown.

## Lifecycle matrix

| Event | Frontier | Recorded capture runs | Draft-source selection | In-flight request | Backend captures |
| --- | --- | --- | --- | --- | --- |
| Close/reopen side panel | recover | recover if batch committed | recover | not resumed; unknown if batch/local result not committed | unchanged |
| Close/reopen browser window | recover | recover if batch committed | recover | not resumed; unknown if batch/local result not committed | unchanged |
| Browser restart* | recover | recover if batch committed | recover | not resumed; unknown if batch/local result not committed | unchanged |
| MV3 service-worker suspension | recover | recover if committed | recover | no correctness assumption from worker/UI memory | unchanged |
| Clear extension local storage / uninstall | local state removed | local state removed | local state removed | unknown | **unchanged in acquisition** |

`chrome.storage.session` transport credentials follow their existing secret/session lifecycle and may require re-pairing after browser restart. That is separate from capture persistence.

\* "recover" on browser restart is the unit-tested storage-read design behavior against a `chrome.storage.local` mock; it is not yet confirmed by a live Chrome kill/restart run (see "Proof status" above).

## User-visible recovery surface

The Wikipedia capture panel now distinguishes:

- queued source locators that remain locally resumable;
- recorded local capture outcomes from prior runs;
- a recovered Draft-from-source selection;
- a saved selection that failed revalidation;
- an interrupted request for which no local outcome may be inferred.

The surface explicitly states that producer captures remain backend-owned and durable independently of panel visibility.

## Authority boundary

```text
Wikipedia citation != claim support
queue != capture
capture != evidence support
capture != admission
local capture-run projection != CaptureReceipt authority
selection != draft
restore != draft
draft != admission
proposal_only != publication
```

**AUTHORITY MOVEMENT = 0.**

## Scripted regression proof

1. Use the authoring-dev extension and local companion against a real acquisition producer.
2. Harvest a fixed Wikipedia revision and queue at least two `NEW` reference URLs.
3. Close and reopen the panel before capture. Verify the same frontier returns; checkbox UI may reset because it is reconstructible presentation.
4. Complete one explicit capture batch and reopen the panel. Verify the committed run is shown as recovered history and that the UI does **not** say the durable capture was lost.
5. Separately interrupt another capture batch before its local run summary is committed.
6. Reopen the panel and require an explicit `unknown`/not-auto-resumed posture for that interrupted batch. Do not infer failure and do not auto-retry; independently verify any producer-side capture through the acquisition registry.
7. On a successful recorded capture, click **Use for Draft from source**. Verify no authoring request is emitted by selection.
8. Close and reopen the panel/browser. Verify the selected captured source is revalidated, restored, and the existing Draft-from-source button is ready without any draft request being emitted.
9. Supply operator-authored claim material and click **Draft from source** exactly once. Verify the existing held-capture path is used and no URL reacquisition fallback occurs.
10. Independently inspect the acquisition capture registry/object store and verify producer durability is unaffected by every extension lifecycle transition above.

## Validation gates

Focused code gates:

```bash
npx vitest run \
  tests/governedSourceSelection.test.ts \
  tests/wikipediaFrontierCapture.test.ts \
  tests/wikipediaSessionPersistence.test.ts \
  tests/wikipediaCaptureAuthoringBoundary.test.ts \
  tests/draftFromSourceButton.test.ts
npm test
npm run lint
npm run build:authoring-dev
git diff --check
```

A green local suite alone is not live lifecycle proof; the scripted browser restart/close exercise above remains the acceptance gate for the user-facing persistence claim.
