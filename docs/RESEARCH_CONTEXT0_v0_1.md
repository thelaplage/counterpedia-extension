# RESEARCH-CONTEXT0 — in-page "this source in Counterpedia" panel v0.1

**Status:** DRAFT
**Authority movement:** 0
**Network egress:** 0 (no new egress — see below)

## Purpose

When opened on a webpage, show what Counterpedia already knows about that
page as a SOURCE, plus its open documentary gaps and local research history:

```text
THIS SOURCE IN COUNTERPEDIA

FAA directive
Counterpedia source ↗

Used by:
  Claim A ↗
  Claim B ↗

Open documentary gaps:
  Missing certification source
  Earlier edition unresolved

Research history:
  2 bounded runs
  1 held ambiguity

[Open in Counterpedia]
```

## Absolute boundary

This panel does NO research of its own, performs NO admission of any kind,
and does NOT classify/identify the current webpage by itself. Every fact it
renders traces to one of three typed, externally-supplied inputs:

1. `searchResults: SearchResult[]` — the SAME array `runSearch()` in
   `panel.ts` already fetches via `counterpediaClient.search()` for the
   existing results state. No new network call is added.
2. `publicSourceLink?: PublicObjectLinkV01` — pinned to the shape
   `resolvePublicObjectLink()` returns in `thelaplage/counterpedia`
   (`lib/counterpedia/publicObjectLink.ts`, PR #475 "RESEARCH-LINK0",
   commit `6833d9643826c6bf1dab71e596e50d8544335310`). **PR #475 is
   OPEN/DRAFT/UNRATIFIED** (verified via `gh pr view 475`); no public
   transport exists for it in this repo. HELD — omitted in the live panel.
3. `gapPacket?: ResearchContextPacketV01` — pinned to the shape
   `build_research_context_packet()` emits in `thelaplage/countergraph`
   (`countergraph/research_context_packet.py`, schema
   `countergraph.research-context-packet/v0.1`). Composes PR #84's
   `ResearchGapPacket`. **PR #88 is actually MERGED** to countergraph
   `main` at commit `bb407d3e7577c81b0abdbf5d5e28e0dc6b33a87b` (verified via
   `gh pr view 88` — this lane's dispatch instructions described it as
   "still draft"; that was stale at dispatch time). No public transport for
   it exists in *this* repo yet, so it stays HELD — omitted in the live
   panel — pending a future fetchable Countergraph artifact.

Absent an input, the corresponding section renders an honest empty/HELD
state (e.g. "Documentary-gap data is not yet wired to a live source in this
build"), never a guessed "no gaps" claim.

## What v0.1 actually wires live

- **used_by** — populated from the already-fetched `SearchResult[]`.
- **source link** — always the existing, already-tested
  `buildSourceDeepLink()` handoff (`sourceWorkbench.ts`); upgrades to
  `publicSourceLink`'s href only if a valid fixture/future-transport value is
  supplied.
- **research history** — LOCAL ONLY. Computed from two ALREADY-EXISTING
  local-only modules — `history.ts` (CP-HISTORY0 encounter ledger) and
  `researchSessions.ts` (CP-RESEARCH-SESSION0 named session groupings) — via
  exact locator string matching (`observed_url`/`canonical_locator`). No new
  storage key, no new schema, no network. See `researchContextHistory.ts`.
  "bounded_runs" = distinct local sessions that encountered this locator.
  "held_ambiguities" = local encounters of this locator whose
  `resolution_status` is `AMBIGUOUS`. This is a LOCAL, per-browser fact —
  never conflated with a Countergraph gap/finding.
- **open documentary gaps** — HELD in the live panel (see boundary above);
  fully implemented and tested against literal countergraph producer bytes.

## Known gap deliberately NOT built here

Neither `PublicObjectLink` nor a Countergraph research-context packet has a
fetchable public transport wired into this extension. This repo already has
one real "is this page's URL a known Counterpedia source" mechanism —
`sourceResolutionClient.ts`'s `resolveObservationAgainstIndex()`, matched
against a network-fetched `SourceResolutionIndex` (CP-CORPUS-RESOLVER-CLIENT0)
— but wiring that fetch into this panel is new network egress this lane was
explicitly told not to add. Composing that existing fetch path in is a
natural follow-up for a future lane, not invented here, and it must NOT be
replaced by a heuristic that classifies the page from its DOM/content.

## Storage / network

- Reads: `chrome.storage.local` only (existing keys —
  `counterpedia_encounters_v0_1`, `counterpedia_research_sessions_v0_1`).
- Writes: none.
- Network: none added. `searchResults` reuses the existing `search()` fetch
  the panel already performs for its own results state.

## Boundary

RESEARCH-CONTEXT0 does not:

- fetch, crawl, or classify the current page;
- resolve "is this a known source" itself (relies on the existing search
  results / a future externally-supplied resolution);
- judge which candidate resolves a documentary gap (renders
  `why_unresolved` verbatim; never emits "candidate X resolves this");
- recompute or verify a supplied packet's `packet_digest` (displays it as
  opaque provenance only — not a second digest authority);
- admit, publish, or verify anything.
