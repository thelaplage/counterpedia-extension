# SESSION-OBSERVE0 v0.1 — generic bounded browser/session observation kernel

**Status:** DRAFT / DO NOT MERGE · `AUTHORITY_MOVEMENT=0` · operator tooling only

## Purpose

`tools/counterpedia-local/session_observe0.py` extracts the genuinely
generic part of the existing FACEBOOK-GRAPH0-OPERATOR harness (open PR
#78, `feat/facebook-graph0-operator`): attach to one operator-selected
CDP target and watch its already-in-flight network traffic for a bounded
duration, handing each matched request/response pair to a caller-supplied
sink.

This is not a new capability. #78 already builds and hermetically tests
this control flow end to end; this lane's job is only to separate the part
of #78 that is inherently about *any* site (bounded CDP observation) from
the part that is inherently about *Facebook* (GraphQL endpoint/doc_id/
variables parsing, sensitive-path denylist, Facebook access-class vocabulary,
the Acquisition FACEBOOK-GRAPH0 normalizer handoff). Facebook does not stop
existing — it becomes one possible adapter over this kernel, not the
contract itself.

## What was extracted (generic, lives in the kernel)

- CDP target attach + bounded-duration `Network.enable` observation loop,
  reusing the existing `tools/counterpedia-local/cdp.py` transport primitive
  as-is (composed, not duplicated);
- the request/response pairing state machine
  (`Network.requestWillBeSent` → pending → `Network.loadingFinished` →
  `Network.getResponseBody`);
- strict CDP response-body decoding (base64-aware, fails closed on bad
  base64 rather than silently returning empty/garbage bytes);
- an operator-selected-target-only contract: `target_id` is a required
  argument, resolved by exact CDP target id lookup — the kernel never
  infers a target from an allowlist or a "the one open tab that matches"
  heuristic, unlike #78's `_choose_target`, so it cannot encode any
  site-specific notion of "an allowed page" itself;
- a closed, explicit-field **credential boundary** at the matcher
  interface: `RequestMatcher(request: RequestView, request_id, document_url)
  -> dict | None`. `RequestView` is a frozen dataclass with exactly four
  fields — `method`, `url`, `post_data`, `has_post_data` — built
  field-by-field from the raw CDP `request` object by the kernel's one
  `_request_view()` function. It has **no `headers` field**, so it cannot
  carry `Authorization` / `Cookie` / `Set-Cookie` / API-key-style headers
  to a matcher, structurally, not by filtering. `post_data` **is** exposed
  (a matcher needs the body to classify e.g. a GraphQL operation, and #78's
  own matcher needs its POST body); rejecting a sensitive body shape is
  adapter-owned policy, never the kernel's;
- a separate `TargetValidator(target_url) -> None` hook (raises to refuse)
  — an adapter's own target-acceptance policy (e.g. a host allowlist or
  sensitive-path denylist), applied once before attaching; the kernel ships
  with none;
- a `SessionObservationSummary` with `authority_movement` pinned at `0` as
  a structural fact of the dataclass, not a value someone can set.

## What was deliberately NOT generalized

These remain adapter-specific by construction — attempting to generalize
them would either reintroduce a hidden Facebook-shaped contract or cross a
line this mission is explicitly forbidden from crossing:

- **request matching semantics** — GraphQL endpoint detection, `doc_id`/
  `variables`/`fb_api_req_friendly_name` parsing, and discarding
  `fb_dtsg`/`lsd` are Facebook's `RequestMatcher` implementation, not the
  kernel's. A different adapter (a different host's REST/GraphQL/whatever
  shape) supplies a different matcher; the kernel's `capture()` never
  changes.
- **target-acceptance policy** — the `BLOCKED_FACEBOOK_PATH_PREFIXES`
  denylist (`/messages`, `/settings`, `/login`, `/checkpoint`, `/security`,
  `/privacy`, `/accounts`) and the `*.facebook.com` host check are Facebook
  policy, expressed as a `TargetValidator`. The kernel has no opinion on
  what a sensitive path looks like for any given site.
- **downstream persistence/normalization** — #78's `_normalize_one` /
  `_build_census` (temp-dir writes, subprocess handoff to the pinned
  Acquisition FACEBOOK-GRAPH0 normalizer, census construction) are the
  "owner-defined downstream producer" the mission explicitly reserves.
  `session_observe0.capture()`'s `sink` callback receives an
  `ObservedExchange` in memory for exactly one call and never writes
  response bytes anywhere itself. What happens next — and whether it is
  Facebook's normalizer, some other producer, or nothing — is entirely
  outside this module.
- **access-class vocabulary** (`public_reproducible` /
  `authenticated_reproducible` / `session_observed` / `operator_only` /
  `no_longer_available`) — a labeling scheme for evidence strength that
  belongs to the evidence-pack layer (#80), not to the observation kernel.
- **the evidence-pack / census / crosswalk orchestration in #80** —
  untouched, out of scope, and not a dependency of this kernel.
- **CDP transport itself** — already generic and already exists as
  `tools/counterpedia-local/cdp.py`; composed here via plain function
  parameters (`connect`, `list_targets_fn`, `fetch_ws_url`), not
  reimplemented.

## Contract shape

```python
def capture(
    *,
    cdp_port: int,
    target_id: str,           # required: operator-selected, never inferred
    duration: float,          # required: bounded window, > 0
    matcher: RequestMatcher,  # adapter-supplied, host-specific
    sink: ExchangeSink,       # owner-defined downstream producer hook
    poll_interval: float = 0.2,
    target_validator: TargetValidator | None = None,
    # + test seams (connect/list_targets_fn/fetch_ws_url/clock/sleeper)
) -> SessionObservationSummary: ...
```

`ObservedExchange` carries `request_id`, `observed_page_url`, the matcher's
opaque `match` descriptor, and the exact CDP-observed `response_bytes` (plus
whether CDP marked them base64-encoded). The evidence-strength caveat #78
documents applies unchanged here: these are the response body bytes CDP's
`Network.getResponseBody` returned, not a wire/packet capture claim.

## Illustrative adapter sketch (not shipped, not #78's code)

This is intentionally a sketch in prose/pseudocode, not a file added to
this lane — writing a real Facebook adapter is #78's job, and #78 remains
untouched here:

```python
def facebook_graphql_matcher(request: RequestView, request_id, document_url):
    if not is_facebook_graphql_url(request.url):
        return None
    return parse_doc_id_and_variables(request.post_data)  # drops fb_dtsg/lsd

def facebook_target_validator(target_url):
    if not is_allowed_facebook_surface(target_url):
        raise session_observe0.SessionObserveError("refused")

summary = session_observe0.capture(
    cdp_port=9222,
    target_id=operator_chosen_target_id,
    duration=30.0,
    matcher=facebook_graphql_matcher,
    target_validator=facebook_target_validator,
    sink=lambda exchange: hand_off_to_pinned_facebook_graph0_normalizer(exchange),
)
```

A second, unrelated site would supply a different `matcher` and
`target_validator` and reuse the same `capture()` — proving the kernel
carries no Facebook-shaped assumption.

## Explicit negative space (unconditional, by construction)

`session_observe0.py` has no code for and no hook that enables:

- exposing headers, cookies, `chrome.storage`, browser profile data, or any
  other credential/token material to an adapter's matcher — the matcher's
  entire view of a request is the closed `RequestView` dataclass
  (`method`/`url`/`post_data`/`has_post_data`), which structurally has no
  headers field; POST bodies are the one exception and are exposed
  deliberately (see above), with adapter-owned sensitive-body rejection as
  the adapter's responsibility, not this kernel's;
- DOM/page-content/screenshot/text extraction;
- navigation, clicking, form submission, replay, or crawling — the kernel
  only watches network events already produced by operator-driven browsing;
- authority/admission/CHECK/standing/verification/publication semantics of
  any kind;
- inferring or auto-selecting a target on the operator's behalf;
- persisting observed response bytes itself.

## Relationship to open work

- **#78 FACEBOOK-GRAPH0-OPERATOR** — specimen this was extracted from;
  untouched by this lane; remains the canonical Facebook adapter path and
  is free to be rewritten on top of this kernel later as a separate,
  owner-gated act. Not attempted here.
- **#80 FACEBOOK-EVIDENCE-PACK0** — downstream orchestration over #78's
  output shape; untouched, disjoint from this kernel.
- **OBSERVATION-CONVERGENCE0** (sibling read-only lane) — if that lane's
  findings show an existing owner abstraction already covers this ground,
  that supersedes this extraction; this lane composes with `cdp.py` (the
  one abstraction it found already existed) and introduces no other new
  transport primitive.

## Tests

`tools/counterpedia-local/test_session_observe0.py` — hermetic, no
browser/network/socket. A fake `CDPConnection` stand-in with a scripted
event queue and an injected clock/sleeper exercises the full bounded
capture loop (matched-and-observed, unmatched-ignored, matcher-exception
isolation, base64 decoding, target-validator refusal, unknown-target
refusal, non-positive duration/poll-interval refusal) plus the pure
`response_body_bytes` / `list_page_targets` helpers.

Run:

```bash
python3 tools/counterpedia-local/test_session_observe0.py -v
```

Result at construction time: **14 tests passed** (includes a hostile test
proving credential-shaped headers on the raw CDP request never reach the
matcher — see the credential boundary section above).
