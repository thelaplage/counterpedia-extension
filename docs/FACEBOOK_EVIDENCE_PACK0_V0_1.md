# FACEBOOK-EVIDENCE-PACK0 v0.1 — operator observation to reviewable evidence packet

**Status:** DRAFT / DO NOT MERGE · `AUTHORITY_MOVEMENT=0` · local operator tooling only

## Final pin reconciliation (2026-09-12)

The Facebook stack has now landed/reconciled. This packet remains exact-pin and
fail-closed, but its producer pins are refreshed to the reviewed source heads
that actually landed:

```text
counterpedia-extension / FACEBOOK-GRAPH0-OPERATOR #78
reviewed head e812813a8e88b1a7d8cfe143640a223205e5768a
merge 5cdeba55c632d9efdcef0407ba43f2195a20622f

counterpedia-acquisition / FACEBOOK-GRAPH0 #226
reviewed head c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb
merge 39ea8f10e0ba08c0492f258925f32b70fd148d60

counterpedia-acquisition / FACEBOOK-STABILITY0 #229
reviewed head 226c319a217ad050e541f1feb7e430c6a8795426
merge 5c44b7c71ae5e6f6b4cee2f70148fda04a0e2dee

counterpedia-acquisition / FACEBOOK-REFERENCE-DESCENT0 #230
reviewed head b46b427b0560f6bdc2016922d54befe13d0b014c
merge 6bedd467f4439d50de625eac0b1e2b3be947fe0e

counterpedia-registry / FACEBOOK-REG0-CROSSWALK0 #38
6725013c4f27ae6f6d1d266a712d45b8caea7d7d

counterpedia-workbench / WB-FACEBOOK-OBS-FEED0 #7
4d6e0608424e4343311ce96a9d3d1f47ce9271c6
```

The orchestrator intentionally pins reviewed source heads rather than drifting
branch tips or merge commits. Those are the exact producer semantics reviewed
before landing.

## Purpose

FACEBOOK-GRAPH0 already has the individual pieces:

1. extension PR #78 observes bounded Facebook web GraphQL traffic from an operator-selected tab;
2. Acquisition PR #226 normalizes those observations and builds a graph-shape census;
3. Acquisition PR #229 compares ordered censuses descriptively over time;
4. Acquisition PR #230 extracts explicit external HTTP(S) strings as candidate locators only;
5. Registry PR #38 decomposes a G0 observation into existing REG0 identity roles without minting Observation or SourceRecord identity;
6. Workbench PR #7 maps those producer artifacts into the producer-preserving review-inbox contract from Workbench PR #6.

What was missing was one bounded operator-side composition that turns a real #78 session into all of those artifacts without manually replaying five CLIs and without implementing any producer semantics a second time.

This lane adds that composition.

## Exact-pin behavior

The pack builder refuses to run a transformation against a different producer head. It searches the ordinary sibling checkout first and then existing worktrees for the exact pinned commit. It does not silently accept a newer branch because the evidence semantics would no longer be the reviewed semantics of this packet.

## Ownership / overlap

- FACEBOOK-GRAPH0-OPERATOR #78: **COMPOSED / LANDED**. This lane does not add another CDP observer.
- FACEBOOK-GRAPH0 #226: **CONSUMED AT EXACT PIN**. No normalizer/census logic is copied here.
- FACEBOOK-STABILITY0 #229: **CONSUMED AT EXACT PIN**. No second drift implementation.
- FACEBOOK-REFERENCE-DESCENT0 #230: **CONSUMED AT EXACT PIN**. No second locator extractor.
- FACEBOOK-REG0-CROSSWALK0 #38: **CONSUMED AT EXACT PIN**. No Registry identity logic is copied here.
- WB-REVIEW-INBOX0 #6 / WB-FACEBOOK-OBS-FEED0 #7: **CONSUMER CONTRACT ONLY**. This lane inventories exact artifacts for #7; it does not execute Workbench or create review actions.
- shipping Counterpedia extension: **UNTOUCHED**. No manifest, content script, background listener, host permission, cookie API, or runtime Facebook behavior changes.

## Critical fix: run-specific census reconstruction

The #78 operator intentionally maintains one cumulative `census.json` across all captured observations. That is useful for cross-surface recurrence, but it is not the correct input shape for a longitudinal drift comparison: comparing successive cumulative censuses would mechanically bias toward growth and could hide removals.

The operator run ledger already records exactly which normalized observations were created in each bounded run:

```text
operator-run-*.json
  -> normalized_observation_files[]
```

FACEBOOK-EVIDENCE-PACK0 uses that producer-owned run membership to reconstruct a **run-specific census from only the observations created in that run**. Those run-specific censuses feed FACEBOOK-STABILITY0. The overall cumulative census is separately rebuilt from all observations and retained as its own artifact.

A run that produced zero normalized observations is not deleted or converted into an empty synthetic census. It remains explicitly recorded in `manifest.json.zero_observation_runs`. Because the current #226 census CLI structurally requires at least one observation, zero-observation runs are excluded from #229's census comparison rather than fabricated into it.

## Pipeline

```text
#78 operator output
  observations/*.json
  operator-run-*.json
  object store (outside pack)
        |
        | exact run membership
        v
#226 run-specific census x N
#226 overall census
        |
        +-------------------> #229 stability.json
        |
        +-- each observation -> #230 references/*.json
        |
        +-- each observation -> #38 reg0-crosswalk/*.json
                                   |
                                   v
                       workbench-inputs.json
                         pinned to #7
                                   |
                                   v
                            manifest.json
```

## Evidence pack contents

A successful pack contains:

```text
censuses/run-000.json
censuses/run-001.json
...
census-overall.json
stability.json
references/<observation-file>.json
reg0-crosswalk/<observation-file>.json
workbench-inputs.json
manifest.json
```

The pack deliberately does **not** contain the retained raw/CDP-observed Facebook GraphQL response bodies. Those remain where #226 put them: the local content-addressed Acquisition object store. The derived reference sets are allowed to contain literal external URLs because literal locator evidence is the purpose of #230; this is a controlled local evidence packet, not a publication artifact.

## `workbench-inputs.json`

This file is an input inventory, not a Workbench projection.

It lists the exact producer artifacts that `WB-FACEBOOK-OBS-FEED0` #7 accepts, along with relative pack path, exact producer schema version, producer-owned digest, SHA-256 of the local JSON file, and exact #7 consumer SHA.

The pack builder does not execute `facebookArtifactToReviewFeed` and does not invent `availableActions`. #7 currently emits no executable actions for these artifacts.

## `manifest.json`

The manifest records all producer/consumer pins, operator run count, non-empty run count, explicitly preserved zero-observation runs, normalized observation count, run-census/reference-set/REG0-crosswalk counts, SHA-256 for every generated JSON artifact, explicit statement that raw response bodies were not copied, explicit statement that Workbench was not executed, permanent non-claims, and deterministic `pack_digest` over the manifest payload before the digest field is added.

No local absolute checkout or object-store path is written into the manifest or Workbench inventory.

## Operator use

The existing executable macOS launcher remains the primary entry point:

```text
tools/counterpedia-local/Start Facebook Graph Observer.command
```

After the ordinary bounded observation session finishes, the launcher offers to build the full evidence pack. It passes the already-resolved #226 checkout and lets the pack builder discover exact #229/#230/#38 worktrees.

Direct invocation is also supported:

```bash
python3 tools/counterpedia-local/facebook_graph_evidence_pack.py \
  --operator-output "$HOME/.counterpedia/facebook-graph0/operator" \
  --object-store "$HOME/.counterpedia/facebook-graph0/objects"
```

If an exact downstream worktree is not available, point to it explicitly:

```bash
--stability-root /path/to/counterpedia-acquisition-at-226c319 \
--descent-root /path/to/counterpedia-acquisition-at-b46b427 \
--registry-root /path/to/counterpedia-registry-at-6725013
```

The script does not fetch branches, create worktrees, rebase repositories, or move refs. Missing pins fail closed with the exact expected SHA.

## Security / authority boundary

FACEBOOK-EVIDENCE-PACK0 has no code for Facebook network access, Chrome/CDP access, login or credential handling, GraphQL replay, crawling or navigation, fetching an outbound reference, redirect-wrapper unwrapping, source admission or support evaluation, SourceRecord minting, Registry writes or RegistrarRequest construction, Workbench action execution, Countergraph mutation, or CHECK invocation.

Permanent inequalities:

```text
evidence_pack != admission
candidate_locator != capture
longitudinal_report != stability_verdict
registry_crosswalk_proposal != source_record_identity
workbench_input_inventory != review_action
facebook_observation != public_reproducibility
```

## Tests

Hermetic tests are in:

```text
tools/counterpedia-local/test_facebook_graph_evidence_pack.py
```

They exercise valid run-to-observation membership, unknown run-field fail-closed behavior, observation filename path-traversal refusal, duplicate observation ownership refusal, exact #226 acquisition-pin refusal, nonzero observation authority refusal, relative Workbench artifact descriptors with producer + file digests, deterministic canonical manifest digesting, and preservation of zero-observation operator runs.

The test file is byte-identical to the previously reviewed/rebased #80 head; this final recut changes producer pin constants and documentation, not the orchestration algorithm or hermetic test logic.

Cross-repo producer execution remains an exact-head integration proof and must not be inferred from these hermetic tests alone.

## GRAPH1 gate

This lane still does not authorize FACEBOOK-GRAPH1.

The decision evidence is now one packet: real operation/type/path census, repeated-run persistence and drift, recurring typed-ID behavior, real external locator yield, identity decomposition into REG0 roles, and inspectable Workbench inputs.

Only that empirical packet can justify widening the Facebook program. If it shows high session noise, low recurrence, weak external-reference yield, or unstable structure, the correct result is to preserve the packet and stop.
