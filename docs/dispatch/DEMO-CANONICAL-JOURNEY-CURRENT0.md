# DEMO-CANONICAL-JOURNEY-CURRENT0

**DRAFT / DISPATCH ONLY / DO NOT MERGE AS PRODUCT WORK**

`AUTHORITY_MOVEMENT=0` · `ADMISSION_EFFECT=none` · `STANDING_EFFECT=none` · `MERGE_AUTHORIZATION=NONE`

## Mission

Prove the canonical current-main product journey over a real Chrome-for-Testing browser without replaying or redesigning already-landed product seams:

```text
ordinary browser page
  -> real extension observation
  -> explicit Capture
  -> real Acquisition exact-byte custody + CaptureReceipt
  -> explicit Draft from source
  -> current Authoring v0.5 proposal-only handoff
  -> current Counterpedia canonical proposal/read-model projection
  -> real extension compact preview
```

Then, **only after that transaction is green**, run the already-landed navigation-only `Open in Counterpedia CHECK` crossing as a separate explicit branch of the same encounter. CHECK must remain a Counterpedia-owned epistemic operation. A scanner observation is never a CHECK conclusion, and a CHECK gap never authorizes acquisition.

This lane is verification/convergence first. If current bytes expose a defect, repair only the first owning boundary in a separate minimal product lane and rerun the whole transaction. Do not use this dispatch PR itself as a product landing vehicle.

## Fresh starting pins

These were read from the live default branches immediately before this dispatch was cut:

- `counterpedia-extension/main@2dadb1c17d095bcfb90238e0435796608022663a`
- `counterpedia-acquisition/main@efc928ca2b564e433adf7602bb2619d142f3a824`
- `counterpedia-authoring/main@ea4f49db1616f024d1ceccd78f901722c10c6e74`
- `counterpedia/main@06667c641a8b51622a949935ed92131f9e5b1845`

**Do not trust these pins at execution time without fetching and rereading all four current mains.** If any main moved, record the new exact heads before running. Do not silently reset a sibling repo or overwrite concurrent work.

## Why a fresh run is required

Extension PR #73 contains a genuine prior Chrome-for-Testing browser proof at donor head `8d1f0a49ab1da68b29de797f10e479ff84537370`. Its browser commit added only proof/harness files and recorded a real navigation, real `#capture-btn` click, real Draft-from-source form fill, real `#authoring-draft-btn` click, Acquisition custody, proposal-only Authoring handoff, Counterpedia reader projection, and extension preview.

That historical PASS is **not today's release proof**. Its provenance packet bound Authoring head `04cd16e345fff681f35fc9059bcba5d075106d29`, the later #225 merge that was explicitly ruled a merge-control breach and reverted. Current Authoring main is different. The product-relevant extension guard repair from #73 was independently recut and landed through #74, so current extension main already owns the production fix; the old #73 proof branch must not be merged wholesale.

Historical proof is donor evidence, not inherited GREEN.

## Overlap classification at dispatch cut

- Extension #74 production v0.5 response-guard repair: **ALREADY_IMPLEMENTED / MERGED**. Do not re-edit or re-land it.
- Extension #73 browser harness/proof files: **COMPOSABLE DONOR**. Reuse the harness architecture; do not inherit its old product commit or treat its old proof packet as current.
- Extension scanner→CHECK convergence / real-browser CHECK handoff (#67-#70): **ALREADY_IMPLEMENTED / COMPOSABLE**. CHECK remains a separate explicit crossing after the draft transaction.
- Acquisition current mobile encounter #224 and capture-witness #223: **DISJOINT** from this browser proof. Do not absorb them.
- Acquisition PAGE12 execution lanes #219/#221/#222: **DISJOINT**. Do not make source-scale execution a dependency of product convergence.
- Authoring PAGE12/WHY-NOT open drafts: **DISJOINT** unless a fresh path scan proves otherwise.
- Counterpedia current `/entry`/`/entries`, Network demo, corpus, and governance work: **COMPOSABLE/DISJOINT** unless the canonical proposal reader or CHECK paths changed; inspect those exact paths before execution.

Executor must reclassify overlap from current bytes immediately before mutation using:

`DISJOINT | COMPOSABLE | OWNERSHIP_CONFLICT | ALREADY_IMPLEMENTED | VACANT`

Stop on semantic or ownership conflict.

## Construction rule: transplant the proof harness, not the old branch

The old #73 browser closure commit is:

`8d1f0a49ab1da68b29de797f10e479ff84537370`

Its parent `a2d7fc382480baa188fc2c6a16c747dc9eb7a504` contains the product guard repair. Current main already has that repair through #74.

Create a fresh execution worktree/branch from the then-current extension main. Reuse only these two harness files from the #73 browser commit:

- `tools/counterpedia-local/browserDraftFromSourceHermeticRunner.py`
- `tools/counterpedia-local/verify_draft_from_source_browser_e2e.py`

Preferred local mechanical transplant:

```bash
git cherry-pick -n 8d1f0a49ab1da68b29de797f10e479ff84537370

git restore --staged --worktree \
  tools/counterpedia-local/proofs/demo-draft-source0-browser-e2e

# Confirm no product file from #73 was reintroduced.
git diff --name-status
```

If the donor commit does not apply cleanly onto fresh main, **do not resolve by broad hand-merge**. Inspect the current harness primitives first and port the minimum additive delta.

Do not copy the old screenshots or old `provenance_packet.json` into the current proof directory. Fresh evidence must be generated by the fresh run.

## Gate 0 — exact current bytes before execution

Before starting any process:

1. fetch all four repos;
2. record exact current `main` SHA for each;
3. verify each checkout/worktree is clean or isolate a fresh worktree;
4. inspect open/draft PRs touching the exact harness, capture, Draft-from-source, proposal-reader, and CHECK paths;
5. verify the extension product guard from #74 is already present on current main;
6. verify current Authoring still exposes the real v0.5 Draft-from-source / role-bearing completeness path;
7. verify current Counterpedia still owns `/api/counterpedia/reader/proposal` and `/check/new` rather than an extension-local semantic substitute;
8. record the four exact execution heads in the run packet before the first click.

No execution if any required owner seam is missing or ambiguous.

## Transaction A — current-main real-browser capture -> draft -> Counterpedia

Run the transplanted harness against the exact current sibling checkouts. Preserve the established fixture discipline unless current code forces an owner-correct repair:

- real Chrome-for-Testing navigation;
- real unpacked current extension build;
- real extension `#capture-btn` click;
- real Acquisition HTTP fixture / real object store / real capture registry;
- real retained CaptureReceipt and exact-byte binding;
- real extension Draft-from-source form;
- real `#authoring-draft-btn` click;
- real current Authoring v0.5 role-bearing/completeness path;
- real current Counterpedia proposal-reader HTTP route;
- real extension compact preview.

The deterministic composer/completeness test adapters remain harness fixtures and must be disclosed as such. Do not promote this into a live-model quality test. The point is to prove the actual ownership/custody/wire/UI transaction over current product bytes.

### Required positive terminal

The run is GREEN only if the same-run evidence proves all of the following:

- browser source page actually navigated;
- capture button actually clicked;
- capture status references that source encounter;
- Acquisition reports captured bytes, not fixture-injected `BrowserPageCapture` success;
- returned capture identity resolves through the real producer registry/store;
- retained bytes independently rehash to the CaptureReceipt digest;
- Draft-from-source button actually clicked after explicit operator material is entered;
- Authoring returns `authoring_admission_handoff.v0.5` and remains proposal-only;
- extension accepts the current handoff without interpreting `claim_support_assessment_set` as its own support authority;
- Counterpedia canonical proposal/read-model route consumes the same handoff lineage;
- extension preview is projected from Counterpedia-owned reader data;
- user-visible terminal includes proposal-only / admission-not-performed posture;
- no admitted/published/standing/verified/trusted promotion is emitted by this transaction;
- no source refetch occurs during held-capture authoring;
- no silent Draft-from-URL fallback occurs.

### Required fresh evidence

Write a new run directory, suggested:

`tools/counterpedia-local/proofs/demo-canonical-journey-current0/`

Materialize at minimum:

- `provenance_packet.json` with exact four repo heads, extension manifest digest, browser binary, timestamps, capture id/source id/content digest, Authoring handoff digest, Counterpedia proposal/read-model response digest if exposed, and exact DOM terminal strings;
- screenshots before capture, after capture, before draft, after draft, and final preview;
- a compact `README.md` that states exactly what was real, what was deterministic fixture infrastructure, and what was not exercised;
- independently recomputed SHA-256s for every screenshot and retained capture bytes;
- an explicit `AUTHORITY_MOVEMENT=0` / `ADMISSION_EFFECT=none` terminal.

Never copy old proof bytes forward and relabel them current.

## Transaction B — explicit CHECK crossing, separately

Only after Transaction A passes on current heads:

1. from the same browser encounter, invoke the already-landed `Open in Counterpedia CHECK` navigation action;
2. require navigation to the current Counterpedia `/check/new` surface;
3. require source URL and only explicit bounded selection/claim inputs to be carried;
4. prove **no completed CHECK result exists before explicit Run Check**;
5. run CHECK only through Counterpedia's canonical API/engine path;
6. if current hosted Acquisition/receipt dependencies are not configured, require the existing honest typed-unavailable/not-configured result rather than fabricating a local browser CHECK;
7. if a real CHECK result is available, preserve its canonical response and receipt/verification posture exactly; the extension may render/consume but must not mint or reinterpret it.

Transaction B does **not** authorize acquisition merely because CHECK reveals a gap.

Do not combine A and B into one semantic object. They are two explicit user acts sharing one encounter.

## Repair rule

If any step fails:

- identify the first owning boundary that failed;
- classify the failure before editing;
- make the smallest owner-local repair in a separate DRAFT product lane;
- rerun focused owner tests;
- rerun the **entire** Transaction A from a fresh browser profile and fresh run directory;
- rerun Transaction B only after A is green again.

Do not patch around a producer failure in the extension. Do not make Counterpedia acquire. Do not make Acquisition infer support. Do not make Authoring admit. Do not let CHECK silently capture.

## Stop conditions

STOP immediately on:

- repo-head drift after execution begins;
- uncommitted sibling-repo mutation not owned by this lane;
- ambiguous process/port ownership;
- source/capture identity mismatch;
- retained-byte digest mismatch;
- Authoring falling back from held capture to URL refetch;
- proposal handoff lifecycle other than `proposal`;
- reader projection that invents admission/standing/support;
- CHECK execution before explicit user action;
- any need to weaken capture egress, receipt, completeness, admission, or authority boundaries merely to make the demo pass.

## Merge posture

This dispatch is a construction/execution instruction only. New implementation/proof lanes remain **DRAFT / DO NOT MERGE** until separately reviewed and separately authorized. Passing the browser transaction is not merge authority, admission authority, or standing authority.
