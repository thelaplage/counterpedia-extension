# COUNTERPEDIA-DEMO-KIT0

DRAFT / DO NOT MERGE

Packaging-only lane for a distributable Counterpedia Demo Kit. This lane must consume existing product/runtime seams and must not reimplement acquisition, authoring, CHECK, reader, admission, verification, publication, standing, or source semantics.

## Product goal

A teammate or invited evaluator on macOS should be able to receive one bundle, perform one bounded installation, then launch a dedicated Counterpedia demo browser and Counterpedia Terminal without knowing repository topology, localhost ports, extension IDs, transport tokens, virtualenv commands, or git branches.

Canonical human journey:

```text
Start Counterpedia Demo
  -> dedicated Chrome-for-Testing profile
  -> browse an ordinary source (Wikipedia is the canonical walkthrough)
  -> Counterpedia scanner/matches
  -> Capture this source
  -> retained Acquisition custody / visible UNADMITTED boundary
  -> optional Draft from source / proposal-only Authoring handoff
  -> optional explicit Open in Counterpedia CHECK / Run Check
  -> inspect the same demo family in Counterpedia Terminal
```

## Ownership / non-reimplementation

- Browser scanner/client: `counterpedia-extension` current main.
- Local supervision/pairing: existing `tools/counterpedia-local` implementation.
- Source custody: `counterpedia-acquisition`.
- Draft proposal: `counterpedia-authoring`.
- CHECK + canonical reader surfaces: `counterpedia` / producer-owned contracts.
- Terminal presentation: `counterpedia-console`.

The kit owns only packaging, dependency discovery, bounded install/launch/reset, version/pin reporting, and demo walkthrough documentation.

## Current overlap classification at lane cut

- Existing easy launcher / Counterpedia Local supervisor: **ALREADY_IMPLEMENTED** — wrap, never duplicate.
- Extension canonical browser journey proof lanes #76/#77: **COMPOSABLE / PROOF-OWNED** — do not inherit GREEN and do not transplant product bytes.
- Facebook Graph operator lane #78: **DISJOINT / OPERATOR-ONLY** — excluded from ordinary kit.
- Signed/notarized all-in-one external-machine packaging seam: **VACANT**.

## v0.1 acceptance

1. A deterministic build step creates one self-contained demo-kit directory/zip from explicitly supplied current sibling checkouts.
2. Bundle contains no `.git`, worktrees, source-control credentials, model keys, transport tokens, user capture stores, or operator logs.
3. Bundle carries a machine-readable component manifest with exact source commit SHAs and bundle digest inputs.
4. A single Finder-launchable entry point starts the already-existing Counterpedia Local supervisor, dedicated demo browser, and Terminal; no ordinary-use Terminal commands are required.
5. A single reset entry point stops only processes/profile state started by the kit.
6. Preflight fails closed on missing runtime/interpreter/browser prerequisites or malformed bundle layout.
7. Wikipedia walkthrough is documented as a canonical demo path, not a source-specific semantic mode.
8. CHECK remains an explicit separate epistemic act; scanner observation/capture never silently runs CHECK.
9. Capture remains UNADMITTED until a real authority says otherwise; Draft remains proposal-only.
10. Packaging tests are hermetic and do not claim the current four-service browser transaction is GREEN. Current exact-head browser proof remains separately owned by #77.

`AUTHORITY_MOVEMENT=0`
`ADMISSION_EFFECT=none`
`STANDING_EFFECT=none`
`MERGE_AUTHORIZATION=NONE`
