# FACEBOOK-GRAPH0-OPERATOR v0.1 — bounded Facebook UI evidence harness

**Status:** DRAFT / DO NOT MERGE · `AUTHORITY_MOVEMENT=0` · operator tooling only

## Pin reconciliation (2026-09-12)

The operator is now pinned to the reconciled FACEBOOK-GRAPH0 producer head
`c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb`, which landed through
Acquisition PR #226 as merge `39ea8f10e0ba08c0492f258925f32b70fd148d60`.
This is a pin-only follow-up after the #226/#78 stack landed; no operator
semantics changed.

## Purpose

This lane supplies the missing real-evidence leg for `counterpedia-acquisition` PR #226 (`FACEBOOK-GRAPH0`). It does not build `FACEBOOK-GRAPH1` and it does not add Facebook capture to the shipping Counterpedia extension.

The question is narrow:

> When an operator uses ordinary Facebook web UI surfaces, do the web client's own `/api/graphql/` responses expose recurring typed objects and stable source-near relationship paths that materially improve Counterpedia source navigation?

The output is the exact input expected by the already-built FACEBOOK-GRAPH0 normalizer/census, produced from a bounded operator-selected Chrome tab.

## Live construction basis

Extension operator composition landed through:

```text
thelaplage/counterpedia-extension
FACEBOOK-GRAPH0-OPERATOR PR #78
reviewed head e812813a8e88b1a7d8cfe143640a223205e5768a
merge 5cdeba55c632d9efdcef0407ba43f2195a20622f
```

Acquisition consumer/normalizer pin:

```text
thelaplage/counterpedia-acquisition
FACEBOOK-GRAPH0 PR #226
c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb
```

The harness fails closed if the supplied Acquisition checkout is not exactly that reviewed producer commit. This is an evidence pin, not a runtime product dependency.

## Ownership / overlap classification

- shipping extension runtime: **OWNERSHIP BOUNDARY / UNTOUCHED**;
- extension `CLAUDE.md` red line against page-content/DOM/cookie/history capture: **PRESERVED** — this lane adds no extension runtime listener, content script, manifest permission, host permission, cookie API, or history API;
- existing local Chrome/CDP verification tooling under `tools/counterpedia-local/`: **COMPOSABLE**;
- open #76 canonical-browser-journey dispatch: **COMPOSABLE** — no authoring, CHECK, preview, manifest, or journey paths touched;
- open #73 draft-source proof: **DISJOINT**;
- Acquisition #226: **CONSUMED AT EXACT PIN**;
- Countergraph direct write/admission: **OWNERSHIP_CONFLICT / UNTOUCHED**.

## Files

```text
tools/counterpedia-local/facebook_graph_operator.py
tools/counterpedia-local/test_facebook_graph_operator.py
docs/FACEBOOK_GRAPH0_OPERATOR_V0_1.md
```

As of the EXT-FB-OPERATOR-RECUT0 recut, `facebook_graph_operator.py` is a thin adapter over the generic, already-landed `tools/counterpedia-local/session_observe0.py` kernel (SESSION-OBSERVE0, PR #88): the bounded CDP attach/observe/pump loop, target listing, and the closed no-headers `RequestView` matcher contract live in that kernel. `session_observe0.py` itself is composed (imported), not modified, by this lane.

## What the harness does

```text
operator-controlled Chrome tab
        |
        | CDP Network events, bounded duration
        v
facebook_graph_operator.py
        |
        +-- only https://www.facebook.com/api/graphql/
        +-- request post body parsed IN MEMORY
        +-- retain only doc_id + friendly name + variables
        +-- never retain fb_dtsg / lsd / jazoest / Cookie / headers
        +-- wait for Network.loadingFinished
        +-- Network.getResponseBody
        v
private TemporaryDirectory (0700)
        |
        | metadata.json + response.bin (0600, transient)
        v
Acquisition #226 normalize
        |
        +-- credential/authority-variable fail-closed checks
        +-- content-address response body bytes
        +-- variable digest, no durable variable values
        v
normalized FacebookGraphObservation
        |
        v
Acquisition #226 census
        |
        +-- typed object counts
        +-- recurring typed-ID digests
        +-- source-near JSON paths
        v
census.json
```

The temporary directory is destroyed after each normalizer subprocess returns. The request POST body itself is never written to disk by this harness.

## Important evidence-strength precision

`Network.getResponseBody` returns the response body representation exposed by Chrome DevTools Protocol. The harness retains **those exact returned body bytes** (including strict base64 decoding when CDP marks the body as base64).

That is not a claim that the harness captured raw HTTP/2/TLS wire bytes or the origin's compressed transfer representation. It is exact custody of the CDP-observed response body bytes supplied to FACEBOOK-GRAPH0. Do not call it a packet capture or wire-exact HTTP capture.

This does not weaken the graph census question: the typed-object/path analysis is over the exact JSON body Counterpedia actually observed. It does define the correct provenance language for the adapter.

## Explicit negative space

The harness has no code for:

- Facebook login;
- password entry;
- cookie reading or decryption;
- token extraction;
- browser profile copying;
- GraphQL request replay;
- autonomous Facebook navigation;
- DOM extraction;
- page text extraction;
- screenshot capture;
- private-message capture;
- settings/account/security/privacy surfaces;
- CAPTCHA or anti-bot handling;
- pagination loops or crawling;
- Countergraph mutation;
- CHECK invocation;
- admission, standing, verification, or publication.

Sensitive paths including `/messages`, `/settings`, `/login`, `/checkpoint`, `/security`, `/privacy`, and `/accounts` fail closed at target/document-URL validation.

A public Group surface may be observed if the operator legitimately chooses it; this lane never attempts to determine or bypass Group access controls.

## Operator procedure

Use a dedicated Chrome debugging profile. The operator logs into Facebook manually if an authenticated surface is required; the harness never receives credentials.

Example macOS launch:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.counterpedia-facebook-observer"
```

Then open the Facebook surface normally in that Chrome window.

List eligible Facebook tabs:

```bash
python3 tools/counterpedia-local/facebook_graph_operator.py list-targets \
  --cdp-port 9222
```

Run one bounded observation window:

```bash
python3 tools/counterpedia-local/facebook_graph_operator.py capture \
  --cdp-port 9222 \
  --target-id <TARGET_ID> \
  --duration 30 \
  --surface-class page_post \
  --access-class session_observed \
  --acquisition-root ../counterpedia-acquisition \
  --output-dir "$HOME/.counterpedia/facebook-graph0/operator" \
  --object-store "$HOME/.counterpedia/facebook-graph0/objects" \
  --producer-revision <THIS_EXTENSION_COMMIT_SHA>
```

During that bounded window, use the chosen page normally so Facebook loads the specific surface. The harness does not click or navigate for the operator.

Repeat with explicit surface labels, for example:

```text
page
page_post
event
marketplace_listing
public_group_post
```

Each run adds normalized observations to the same output directory and rebuilds `census.json` over the accumulated observation set. This allows cross-surface recurrence to emerge without creating a crawler.

## Access class

The operator must choose the descriptive access posture rather than letting the harness infer it:

```text
public_reproducible
authenticated_reproducible
session_observed
operator_only
no_longer_available
```

Default is `session_observed`.

Do not label an authenticated observation `public_reproducible` merely because the rendered page looks public.

## Hermetic tests

`test_facebook_graph_operator.py` uses no browser or network and tests endpoint restriction, ordinary-content URL acceptance, sensitive-path refusal, request parsing/session-field exclusion, object-shaped GraphQL variables, strict CDP base64-body decoding, and the exact Acquisition producer pin.

Run:

```bash
python3 tools/counterpedia-local/test_facebook_graph_operator.py
```

The recut was previously verified with the operator suite and the SESSION-OBSERVE0 kernel suite green. This pin-only follow-up changes no executable logic other than the exact expected producer SHA.

## Real evidence gate

This lane makes the operator pass executable, but a real Facebook corpus/census is not fabricated in git.

The real gate is satisfied only when operator-run output shows, from several ordinary UI surfaces, nonzero normalized GraphQL observations, the actual friendly-operation/doc-id census, actual `__typename` populations, recurring typed-ID digests across independently observed operations/surfaces if any, actual source-near JSON relationship paths, access-class breakdown, and a census digest from the pinned #226 producer.

The resulting live response bodies belong in controlled local/custody storage, not git fixtures.

## Stop condition

Do **not** authorize `FACEBOOK-GRAPH1` merely because the harness works.

GRAPH1 is justified only if the resulting real census demonstrates stable, useful Facebook structure that materially improves Counterpedia navigation or evidence discovery. If operation names, typed IDs, or relationship paths are too unstable/session-specific/noisy, record that result and stop rather than widening collection.
