# CLAUDE.md
> Status: agent guidance only; non-normative. Repository contracts, cited authorities, and admitted artifacts control where they differ.

## Repository lifecycle
ACTIVE

## Ecosystem rule
One authority per contract family. If another repository owns a contract, profile, schema, verifier, semantic rule, or custody invariant, consume or pin that authority. Do not recreate a convenient local dialect.

## Cross-repository evidence rule
A green local test suite does not prove interoperability. Where this repository consumes another repository's artifact, tests should use literal output from the real producer at a pinned commit whenever practical, preserving original bytes and provenance. Tests that explicitly claim interoperability with a real producer MUST preserve that producer's literal bytes.

## Repository role
counterpedia-extension is a public client-side consumer (Chrome side panel). It fetches Counterpedia's public static contracts (search index, activity index) and presents them. It consumes Counterpedia contracts; it is not a second schema authority.

## Authority boundary
AUTHORITATIVE FOR:
- Client-side presentation and its own pinned schema-version validation of consumed artifacts

NOT AUTHORITATIVE FOR:
- Counterpedia contract definitions (owned by counterpedia)
- Custody, admission, verification, SRS serialization

## Upstream authorities
- Public contracts / static indexes -> counterpedia (pin schema version; mirrors should be generated mechanically from the owner, not hand-authored)

## Downstream consumers
- (end users) — the panel surface

## Critical invariants
- schema validation on BOTH network fetch AND cache read; fail closed on version mismatch
- basis-descent per line; NO aggregate scan; inspected-empty != not-inspected
- PUBLIC-only by construction
- reachable != supported

## Repository-specific red lines
- Do NOT capture page content, DOM, cookies, or history; `credentials: "omit"`; no telemetry.
- Do NOT become a second Counterpedia schema authority — consume/pin the owner's contract.
- No new host permission unless the artifact origin genuinely requires it.

## Required validation
- `npm run build` (vite) green ; test suite green ; MV3 manifest valid

## Related repositories
- counterpedia — public contract owner (upstream)
- arcs-srs / arcs-verify — SRS shape / verification (referenced, not re-implemented)
