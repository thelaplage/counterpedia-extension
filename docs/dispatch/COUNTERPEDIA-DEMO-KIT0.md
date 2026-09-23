# COUNTERPEDIA-DEMO-KIT0

DRAFT / DO NOT MERGE

Packaging-only lane for a distributable Counterpedia Demo Kit. This lane must consume existing product/runtime seams and must not reimplement acquisition, authoring, DAGR, CHECK, reader, admission, verification, publication, standing, or source semantics.

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
  -> optional Draft from source
     -> DAGR-governed held-capture execution
     -> proposal-only Authoring handoff
     -> Counterpedia admission NOT performed
  -> optional explicit Open in Counterpedia CHECK / Run Check
  -> inspect the same demo family in Counterpedia Terminal
```

## Ownership / non-reimplementation

- Browser scanner/client: `counterpedia-extension` current main.
- Local supervision/pairing: existing `tools/counterpedia-local` implementation.
- Source custody: `counterpedia-acquisition`.
- Draft proposal: `counterpedia-authoring`.
- Governed execution + SRS receipts for the retained-capture tool: `dagr-mcp`, consuming `dagr-sdk`.
- CHECK + canonical reader surfaces: `counterpedia` / producer-owned contracts.
- Terminal presentation: `counterpedia-console`.

The kit owns only packaging, dependency discovery, bounded install/launch/reset, version/pin reporting, and demo walkthrough documentation. It does not gain DAGR authority by carrying DAGR source code; it merely supplies the exact operator-selected local-demo runtime required by the existing governed Acquisition path.

## Seven exact source components

Every built kit carries and pins clean tracked snapshots of:

1. `counterpedia-extension`
2. `counterpedia-acquisition`
3. `counterpedia-authoring`
4. `dagr-sdk`
5. `dagr-mcp`
6. `counterpedia`
7. `counterpedia-console`

The installer installs the bundled `dagr-sdk` then bundled `dagr-mcp[official-sdk]` into Acquisition's own venv. The local-demo DAGR factory and SDK lifecycle binding must import from those bundled source roots. Hidden developer worktrees and GitHub VCS dependency fetches are not an accepted runtime dependency.

## Current overlap classification

- Existing easy launcher / Counterpedia Local supervisor: **ALREADY_IMPLEMENTED** — wrap, never duplicate.
- #81 DEMO-RUNTIME-HARDENING0: **COMPOSABLE / RUNTIME-OWNED** — this packaging lane supplies DAGR source/runtime inputs and explicit env; it does not rewrite launcher ownership/readiness semantics.
- #76/#77 canonical browser journey proof: **COMPOSABLE / PROOF-OWNED** — do not inherit GREEN and do not transplant product bytes.
- Facebook Graph lanes #78/#80: **DISJOINT / OPERATOR-ONLY** — excluded from ordinary kit.
- DAGR top-level offline dependency repair #95: **REQUIRED UPSTREAM PACKAGING DEPENDENCY** for no-GitHub/offline installation; this lane must pin an accepted `dagr-mcp` source containing that repair before external recipient certification.

## v0.1 acceptance

1. A deterministic build step creates one self-contained demo-kit directory/zip from explicitly supplied current sibling checkouts.
2. Bundle contains no `.git`, worktrees, source-control credentials, model keys, transport tokens, user capture stores, or operator logs.
3. Bundle carries a machine-readable component manifest with exact source commit SHAs and bundle digest inputs for all seven components.
4. The exact bundled `dagr-sdk` and `dagr-mcp` sources install into Acquisition's runtime without requiring a GitHub clone for the DAGR package edge.
5. Installer fails closed unless `dagr_mcp_local_demo.counterpedia_acquisition:build_adapter`, `dagr_mcp_sdk_binding.adapter`, and `dagr_sdk` resolve from the bundled source roots.
6. Start explicitly selects only the reviewed local-demo DAGR adapter and creates a durable local evidence directory; generic Acquisition MCP remains fail-closed outside this bundle composition.
7. Check reports DAGR binding readiness separately from Local, reader, and Terminal readiness.
8. A single Finder-launchable entry point starts the already-existing Counterpedia Local supervisor, dedicated demo browser, and Terminal; no ordinary-use Terminal commands are required.
9. A single reset entry point stops only processes/profile state started by the kit.
10. Preflight fails closed on missing runtime/interpreter/browser prerequisites or malformed bundle layout.
11. Wikipedia walkthrough is documented as a canonical demo path, not a source-specific semantic mode.
12. CHECK remains an explicit separate epistemic act; scanner observation/capture never silently runs CHECK.
13. Capture remains UNADMITTED until a real authority says otherwise; DAGR execution admission is not Counterpedia content admission; Draft remains proposal-only.
14. Packaging tests are hermetic and do not claim the current browser transaction or clean-recipient transaction is GREEN. Current exact-head browser proof remains separately owned by #77/#81 proof records.

`AUTHORITY_MOVEMENT=0`
`ADMISSION_EFFECT=none`
`STANDING_EFFECT=none`
`MERGE_AUTHORIZATION=NONE`
