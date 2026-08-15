# Draft from source (v0.1) — the historical-capture authoring act

This lane composes the already-proven **ACQ1 acquisition boundary** with the
already-proven **AUTHOR-HTTP authoring boundary** into a single, visible flow
in the Counterpedia extension — while keeping **three separate governed
acts** structurally distinct. It is a **seam**: composition of existing
outputs and inputs. It introduces **no fourth authority object** bridging
the two.

`draftFromHeldCapture()` / `POST /v0/draft-from-source` is the action behind
the panel's `[Draft from source]` button (`src/panel/draftFromSourceButton.ts`).
It is **not** the same action as `draftFromUrl()` / `POST /v0/draft-from-url`
— see `docs/DRAFT_FROM_URL_v0_1.md` for that fresh-fetch action, which is
retained in the client but not reachable from the panel UI.

## The three acts

| # | Act | Boundary | Terminal posture | Surface |
|---|-----|----------|------------------|---------|
| 1 | **Capture** | Browser observation (explicit click) | Browser observation — *not* evidence | `#capture-status`, Source Workbench |
| 2 | **Acquisition** | ACQ1-HTTP producer re-fetch (`127.0.0.1:8787`) | **UNADMITTED** signed receipt | `#acquisition-status` |
| 3 | **Draft from source** | AUTHOR-HTTP held-capture pipeline (`127.0.0.1:8788`, `/v0/draft-from-source`) | **proposal_only** handoff | `#authoring-status` |

Each act is a distinct decision with its own state machine. The UI may
**explain** how they relate; it must never **collapse** them.

```
browser BPC ──▶ ACQ1 client ──▶ real acquisition ──▶ UNADMITTED receipt
                                    │            │
                       (capture_id │            │ (source_locator, as a
                     forwarded as  │            │  continuity constraint —
                      capture_ref) │            │  NOT a fetch instruction)
                                    ▼            ▼
                     AUTHOR-HTTP client ──▶ real held-capture pipeline
                                                  │
                              reprocesses the ALREADY-HELD bytes; performs
                              ZERO live network fetch of any kind
                                                  ▼
                                       proposal_only handoff
```

## The two crossovers — and what does not cross

Unlike `draftFromUrl()` (which takes only a bare URL and structurally cannot
copy any producer fact), `draftFromHeldCapture()` reads **two** fields off
the acquisition result and forwards them:

- **`source_locator`** → sent as `candidates[0].url`, the operator-authorized
  **continuity constraint** the backend binds its plan against. It is
  **never a fetch instruction** for this action — the backend performs no
  network I/O under any outcome.
- **`capture_id`** → sent as `capture_ref`, the **one deliberate, narrow**
  custody exception. It identifies which already-retained historical capture
  the producer must reprocess. This is the only producer-owned field this
  action is allowed to forward.

**Still never copied**, exactly as with `draftFromUrl()`: `source_id`,
`capture_receipt`, `captured_object_address`, byte digests, or the captured
bytes themselves. `buildDraftFromSourceRequest()` has no access to those
fields — it only ever reads `source_locator` and `capture_id` off the
acquisition result. The AUTHOR-HTTP server independently rejects any other
producer-owned field as `producer_owned_field` (second line of defense),
with `capture_ref` as the sole, explicitly-exempted top-level exception.

The authoring service owns no held-capture capability itself: it delegates
`capture_ref` + the `source_locator` continuity constraint through its
injected `held_capture_client`. The **acquisition producer** is the one that
resolves `capture_ref` against the producer-owned `CaptureReceipt` registry
and retained object store, then creates the new held-processing observation
by **reprocessing the exact retained bytes from the original capture** — it
does not, and structurally cannot, re-fetch the URL. Authoring never owns or
reconstructs that registry/custody record; producer-owned custody stays
producer-owned. If the original origin has since changed or gone away
entirely, this action is unaffected: it never touches the network.
`capture_ref` unresolved, or resolved to bytes whose own locator disagrees
with the operator-authorized `source_locator`, fails closed
(`source_basis_unresolved`, 422) — it never falls back to a live fetch of
any kind.

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
Claims cite the deterministic `evidence:E001…` handles the held-capture
reprocessing yields.

## Firewall / non-collapse rules

These are enforced in code and tested; they are the point of the lane.

- **Capture must not auto-draft.** The Draft button is `disabled` until an
  acquisition returns `captured`. The capture→draft edge is a one-directional
  *availability* gate, not an action.
- **Draft must not admit or publish.** The terminal state is `proposal_only`.
  There is no admission endpoint and no admission call, ever. Every render
  shows `Admission: not performed` and `authority: proposal only`.
- **No state translation.** None of these collapses is permitted:
  capture-succeeded → source-admitted; receipt-exists → source-verified;
  proposal-generated → draft-admitted; `proposal_only` → unadmitted;
  draft/proposal → PROPOSED.
- **No fourth authority object.** The seam is composition of the existing
  acquisition output and the existing authoring input — nothing new bridges
  them.
- **Zero live fetch.** This action performs no network I/O under any
  outcome — success or failure. There is no reachable path from
  `draftFromHeldCapture()` / `/v0/draft-from-source` to `draftFromUrl()` /
  `/v0/draft-from-url`, and no fallback from one to the other in either
  direction.

## Response guard (fail-closed)

`authoringResponseGuard.ts` refuses any localhost response that is not
exactly the authorized `proposal_only` handoff:

- exact top-level allow-list (unknown key → reject);
- `authority_posture === "proposal_only"` and `producer === "counterpedia-authoring"`;
- `draft_proposal.lifecycle ∈ {proposal, draft}`, and every lifecycle-bearing key
  at any depth must be proposal-only;
- any admission / standing / publication / verification / ratification key at any
  depth → reject.

## Independence of the state machines

`authoringState.ts` is independent of `acquisitionState.ts` (verified by the
negative-space audit). The only coupling is a **type-only** reference to the
guarded `AcquisitionCaptureResult`, whose `source_locator` and `capture_id`
this action's client reads.

## Non-claims

- Reaching `proposal_only` proves the authoring pipeline reprocessed the
  held capture into a coherent, digest-sealed proposal — it does **not**
  admit, publish, verify, or grant standing to anything.
- A successful acquisition proves transport + producer integration and a
  signed receipt — it does **not** establish that the page's claims are
  true, nor that the source is admitted.
- This lane performs **no** admission and exposes **no** admit control.

## Dev build

`npm run build:authoring-dev` uses `manifest.authoring-dev.json`, which grants the
two loopback host permissions the three-act flow needs (`8787` acquisition, `8788`
authoring) and nothing else. Production (`manifest.json`) and the demo manifest are
untouched. Configure the authoring endpoint + transport token in
`chrome.storage.sync` under `counterpedia_authoring_base_url` /
`counterpedia_authoring_token`.

## Proof

`tests/draftFromSource.e2e.test.ts` stands up the **real** ACQ1 acquisition
server (filesystem-backed capture registry), the **real** AUTHOR-HTTP
transport wired for `/v0/draft-from-source` (`source_deps`, backed by a real
`held_capture_client` that resolves the historical capture over an MCP stdio
subprocess talking to the SAME on-disk registry — no fixture stand-in for
the held-capture resolution step), and a deterministic fixture source. It
drives the real extension code path end-to-end: capture → held-capture
draft. It asserts the three acts stay distinct, only the two named fields
cross the seam, the terminal posture is `proposal_only`, and
`ADMISSION CALLS = 0`. It also asserts `draftFromUrl()` /
`/v0/draft-from-url` is never invoked anywhere in the run. If either repo
checkout is unresolved the suite **skips loudly** rather than passing
hollow — see the test file's own header for the current pass/skip status
and exact launcher wiring.
