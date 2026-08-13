# Draft from source (v0.1) — the third governed act

This lane composes the already-proven **ACQ1 acquisition boundary** with the
already-proven **AUTHOR-HTTP authoring boundary** into a single, visible flow in
the Counterpedia extension — while keeping **three separate governed acts**
structurally distinct. It is a **seam**: composition of existing outputs and
inputs. It introduces **no fourth authority object** bridging the two.

## The three acts

| # | Act | Boundary | Terminal posture | Surface |
|---|-----|----------|------------------|---------|
| 1 | **Capture** | Browser observation (explicit click) | Browser observation — *not* evidence | `#capture-status`, Source Workbench |
| 2 | **Acquisition** | ACQ1-HTTP producer re-fetch (`127.0.0.1:8787`) | **UNADMITTED** signed receipt | `#acquisition-status` |
| 3 | **Draft from source** | AUTHOR-HTTP pipeline (`127.0.0.1:8788`) | **proposal_only** handoff | `#authoring-status` |

Each act is a distinct decision with its own state machine. The UI may **explain**
how they relate; it must never **collapse** them.

```
browser BPC ──▶ ACQ1 client ──▶ real acquisition ──▶ UNADMITTED receipt
                                                          │
                          (governed source URL only)      │  ← the ONLY thing that
                                                          ▼     crosses the seam
                     AUTHOR-HTTP client ──▶ real pipeline ──▶ proposal_only handoff
```

## What crosses the seam — and what does not

The only thing that flows from act 2 into act 3 is the **governed source URL**
(`AcquisitionCaptureResult.source_locator`). The authoring producer **re-fetches**
that URL and mints its own facts.

**Never copied** from the acquisition result into the authoring request:
`capture_id`, `source_id`, `capture_receipt`, `captured_object_address`, byte
digests, or the captured bytes themselves. This is enforced structurally: the
request builder (`buildDraftFromSourceRequest`) takes a **bare URL string** as its
only source input — it has no access to the producer facts to copy. The AUTHOR-HTTP
server independently rejects any such field as `producer_owned_field` (second line
of defense).

Operator claim material (claims, coverage, recipe) is passed **verbatim**. The
client never invents, infers, or completes a claim. Claims cite the deterministic
`evidence:E001…` handles the source yields.

## Firewall / non-collapse rules

These are enforced in code and tested; they are the point of the lane.

- **Capture must not auto-draft.** The Draft button is `disabled` until an
  acquisition returns `captured`. The capture→draft edge is a one-directional
  *availability* gate, not an action.
- **Draft must not admit or publish.** The terminal state is `proposal_only`.
  There is no admission endpoint and no admission call, ever. Every render shows
  `Admission: not performed` and `authority: proposal only`.
- **No state translation.** None of these collapses is permitted:
  capture-succeeded → source-admitted; receipt-exists → source-verified;
  proposal-generated → draft-admitted; `proposal_only` → unadmitted;
  draft/proposal → PROPOSED.
- **No fourth authority object.** The seam is composition of the existing
  acquisition output and the existing authoring input — nothing new bridges them.
- **Browser observation ≠ acquired bytes.** The authoring producer re-fetches the
  URL; the extension never claims the ACQ1 bytes were reused.

## Response guard (fail-closed)

`authoringResponseGuard.ts` refuses any localhost response that is not exactly the
authorized `proposal_only` handoff:

- exact top-level allow-list (unknown key → reject);
- `authority_posture === "proposal_only"` and `producer === "counterpedia-authoring"`;
- `draft_proposal.lifecycle ∈ {proposal, draft}`, and every lifecycle-bearing key
  at any depth must be proposal-only;
- any admission / standing / publication / verification / ratification key at any
  depth → reject.

## Independence of the state machines

`authoringState.ts` is independent of `acquisitionState.ts` (verified by the
negative-space audit). The only coupling is a **type-only** reference to the
guarded `AcquisitionCaptureResult`, whose URL the client reads.

## Non-claims

- Reaching `proposal_only` proves the authoring pipeline produced a coherent,
  digest-sealed proposal — it does **not** admit, publish, verify, or grant
  standing to anything.
- A successful acquisition proves transport + producer integration and a signed
  receipt — it does **not** establish that the page's claims are true, nor that
  the source is admitted.
- This lane performs **no** admission and exposes **no** admit control.

## Dev build

`npm run build:authoring-dev` uses `manifest.authoring-dev.json`, which grants the
two loopback host permissions the three-act flow needs (`8787` acquisition, `8788`
authoring) and nothing else. Production (`manifest.json`) and the demo manifest are
untouched. Configure the authoring endpoint + transport token in
`chrome.storage.sync` under `counterpedia_authoring_base_url` /
`counterpedia_authoring_token`.

## Proof

`tests/draftFromSource.e2e.test.ts` stands up the **real** ACQ1 acquisition server
and the **real** AUTHOR-HTTP transport as separate processes over a deterministic
fixture source, and drives the real extension code path end-to-end. It asserts the
three acts stay distinct, no producer fact crosses the seam, the terminal posture
is `proposal_only`, and `ADMISSION CALLS = 0`. If either repo checkout is
unresolved the suite **skips loudly** rather than passing hollow.
