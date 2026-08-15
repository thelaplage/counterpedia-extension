# Draft from URL (v0.1) — the fresh-fetch authoring act

This document describes `draftFromUrl()` / `POST /v0/draft-from-url`: the
operator supplies a **governed source URL**, and the AUTHOR-HTTP producer
**re-fetches that URL live** and mints a brand-new observation. This is
**not** the same action as `draftFromHeldCapture()` / `POST
/v0/draft-from-source` — see `docs/DRAFT_FROM_SOURCE_v0_1.md` for the
historical-capture action, which performs zero live fetches.

## The three acts

| # | Act | Boundary | Terminal posture | Surface |
|---|-----|----------|------------------|---------|
| 1 | **Capture** | Browser observation (explicit click) | Browser observation — *not* evidence | `#capture-status`, Source Workbench |
| 2 | **Acquisition** | ACQ1-HTTP producer re-fetch (`127.0.0.1:8787`) | **UNADMITTED** signed receipt | `#acquisition-status` |
| 3a | **Draft from URL** | AUTHOR-HTTP fresh-fetch pipeline (`127.0.0.1:8788`, `/v0/draft-from-url`) | **proposal_only** handoff | not wired to a panel button in v0.1 — see below |

`draftFromUrl()` exists in `src/lib/authoringClient.ts` and is exercised by
unit tests, but **no reachable UI path calls it**: the `[Draft from
source]` panel button calls `draftFromHeldCapture()` exclusively (see
`src/panel/draftFromSourceButton.ts`). `draftFromUrl()` is retained as a
structurally separate, independently testable action for any future surface
that wants an explicit "capture again and draft" flow — it is not currently
reachable from the extension's UI.

```
browser BPC ──▶ ACQ1 client ──▶ real acquisition ──▶ UNADMITTED receipt
                                                          │
                          (governed source URL only)      │  ← the ONLY thing that
                                                          ▼     crosses the seam
                     AUTHOR-HTTP client ──▶ producer RE-FETCHES the URL ──▶ proposal_only handoff
```

## What crosses the seam — and what does not

The only thing that flows from act 2 into this action is the **governed
source URL** (`AcquisitionCaptureResult.source_locator`). The authoring
producer **re-fetches** that URL live and mints its own, entirely new
capture facts.

**Never copied** from the acquisition result into the `draft-from-url`
request: `capture_id`, `source_id`, `capture_receipt`,
`captured_object_address`, byte digests, or the captured bytes themselves.
This is enforced structurally: `buildDraftFromUrlRequest()` takes a **bare
URL string** as its only source input — it has no access to the producer
facts to copy. The AUTHOR-HTTP server independently rejects any such field
as `producer_owned_field` (second line of defense).

Because the producer re-fetches, the acquisition's captured bytes and the
authoring pipeline's fetched bytes are **two independent observations of
the same locator, captured at different times**. They are never claimed to
be the same bytes. This is the structural reason `draftFromUrl()` is
unsuitable for a historical-reference workflow: if the origin has since
changed or gone away, the re-fetch reflects whatever is there *now* (or
fails), never what the browser originally captured.

**Operator-supplied material** (typed by the human in the panel):
- subject
- claim text
- cited evidence handles

**Application authoring profile** (explicit, named defaults constructed by
the extension — not operator assertions):
- objective template
- candidate label
- coverage scaffold / coverage assessment
- recipe
- depth

The extension does not synthesize or alter the operator's claim text.
Application-profile scaffolding is never represented as operator-authored.

## Firewall / non-collapse rules

- **Capture must not auto-draft.**
- **Draft must not admit or publish.** Terminal state is `proposal_only`.
- **No state translation**, **no fourth authority object**, **browser
  observation ≠ acquired bytes** — see `DRAFT_FROM_SOURCE_v0_1.md`'s
  identical rules, which apply equally to this action.

## Response guard (fail-closed)

Same guard as the historical-source action — `authoringResponseGuard.ts`
refuses any response that is not exactly the authorized `proposal_only`
handoff, regardless of which of the two actions produced it.

## Non-claims

- Reaching `proposal_only` proves the authoring pipeline produced a
  coherent, digest-sealed proposal from freshly re-fetched bytes — it does
  **not** admit, publish, verify, or grant standing to anything, and it does
  **not** establish that the re-fetched bytes match what the browser
  originally observed.
