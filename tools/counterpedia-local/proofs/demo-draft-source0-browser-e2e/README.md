# DEMO-DRAFT-SOURCE0 — browser-leg closure proof

Closes the ONE honest gap PR #73 itself declared: its own real four-service
transaction proof (`tests/draftFromSourceFourService.e2e.test.ts`,
`scripts/draft-e2e-gate.sh`) fed the pipeline a fixture-injected
`BrowserPageCapture` object, not an actually-navigated Chrome tab. This
directory is the same-run provenance packet + screenshots from a REAL
Chrome-for-Testing run that drives the real, built, unpacked extension end to
end: real navigation, a real click on the real `#capture-btn`, a real fill of
the real "Draft from source" form, and a real click on the real
`#authoring-draft-btn`.

Run with:

```
COUNTERPEDIA_ACQUISITION_DIR=~/Developer/repos/counterpedia-acquisition \
COUNTERPEDIA_AUTHORING_DIR=~/Developer/repos/counterpedia-authoring \
COUNTERPEDIA_DIR=~/Developer/repos/counterpedia \
RUN_DIR=/tmp/demo-draft-source0-browser-run \
python3 tools/counterpedia-local/verify_draft_from_source_browser_e2e.py
```

## What is proven

- `01_content_before.png` / `06_content_after.png` — the real Chrome tab
  after a real navigation to a loopback fixture "source" page.
- `02_panel_before_capture.png` — the real, unpacked extension's side panel,
  loaded fresh, before any click.
- `03_panel_after_capture.png` — after a real, CDP-dispatched click on the
  real `#capture-btn`: `#capture-status` shows the real captured page URL;
  `#acquisition-status` shows the real acquisition backend's
  `Captured — UNADMITTED — sha256:...` response.
- `04_panel_before_draft.png` — the real "Draft from source" form, filled via
  real DOM `input` events (subject/claim/evidence), draft button now enabled.
- `05_panel_after_draft.png` — after a real click on `#authoring-draft-btn`:
  the real panel renders `Proposal assembled (proposal) — proposal only`,
  `Admission: not performed`, a real `Handoff: sha256:...` digest, and the
  real compact proposal preview (title, lead, Background section, evidence
  handles) — the same `buildAuthoringProposalPreview` projector PR #73's own
  vitest test exercises programmatically, here rendered into the real DOM.
- `provenance_packet.json` — machine-readable form of the same run: exact
  sibling-repo HEAD SHAs, the built `dist/manifest.json` sha256, the resolved
  Chrome-for-Testing binary, every screenshot's sha256, and the exact
  `#capture-status` / `#acquisition-status` / `#authoring-status-*` /
  proposal-preview-title text read directly from the real DOM at each step.

## Backend processes used (same fixtures PR #73's own vitest gate uses)

- `counterpedia-acquisition/scripts/run_acquisition_http_test_fixture.py`
  (real acquisition HTTP surface, real SSRF-relaxed test-only egress policy,
  real capture registry) on `127.0.0.1:8787`.
- `tools/counterpedia-local/browserDraftFromSourceHermeticRunner.py` — a
  DELIBERATE FORK of `tests/support/authorHttpSourceHermeticRunner.py` (that
  shared vitest fixture file is untouched). The only difference: the
  completeness adapter installed for `RoleBearingDraftFromSourceService` no
  longer hardcodes the vitest test's own synthetic claim/proposition ids —
  see the fork's module docstring for the full, disclosed reasoning (a real
  browser-driven "Draft from source" click always auto-upgrades the recipe to
  the v0.5 role-bearing shape via already-shipped `buildSourceRecipe` logic in
  `src/lib/authoringClient.ts`, and the real panel UI always mints
  `claim_id: "claim-operator-1"`, which the original hardcoded fixture
  adapter — built only for the vitest test's own object construction — was
  never going to match). Real backend on `127.0.0.1:8788`.
- Real Counterpedia `npm run dev` reader route
  (`/api/counterpedia/reader/proposal`) on `127.0.0.1:3000`.
- A tiny static fixture HTTP server on `127.0.0.1:8790` (an
  already-host-permitted loopback slot in `manifest.authoring-dev.json`)
  serving the field-free "source" page real Chrome navigates to.

## What was deliberately NOT done, and why

The extension's transport config (`chrome.storage.sync`/`.session`:
acquisition/authoring base URLs + tokens) was written directly via a real
`chrome.storage` call in the service worker's own CDP session, instead of
driving the "Connect Counterpedia Local" pairing button
(`verify_ui_click_through_e2e.py` / `verify_self_load_e2e.py`'s own proven
flow). That pairing flow launches a *live-source* Authoring process requiring
a real `OPENAI_API_KEY`; reusing it here would have silently swapped PR #73's
own already-proven hermetic, deterministic backend for a live one requiring a
credential this environment may not hold, widening scope beyond "close the
browser-leg gap." This substitution is disclosed here, not hidden.
