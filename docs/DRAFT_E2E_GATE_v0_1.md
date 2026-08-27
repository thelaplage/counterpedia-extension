# DRAFT-E2E-HARNESS0 — reproducible draft-from-source release gate (v0.1)

The browser → acquisition → authoring "draft from source" loop is proven by
`tests/draftFromSource.e2e.test.ts`, a real three-process test (ACQ1 acquisition
fixture server + real authoring `/v0/draft-from-source` `DraftFromSourceService`
+ real acquisition MCP-stdio subprocess).

## The problem this fixes

Run bare, that E2E is `describe.skip` unless **both** sibling repos are
co-located **and** the authoring interpreter carries the authoring project's
declared optional `mcp` extra. A plain `vitest run` therefore silently converts
"environment unavailable" into an apparent green — and separately, whichever
`mcp` happens to be on `PATH` can be the wrong version (a newer `mcp` changes
the SDK API the acquisition MCP server is written against, so the loop refuses).

## The gate

```bash
npm run e2e:draft-gate
# or: bash scripts/draft-e2e-gate.sh
```

This command:

1. **Fails loudly** (non-zero) if either sibling repo is unavailable/incomplete,
   instead of skipping. It also sets `CP_DRAFT_E2E_REQUIRE=1`, which makes the
   test itself throw rather than `describe.skip` when the environment is missing.
2. **Consumes the authoring project's own declared `mcp` pin** — it reads the
   requirement from `counterpedia-authoring`'s `pyproject.toml`
   (`[project.optional-dependencies].mcp`) and installs exactly that into the
   authoring interpreter if absent. The version is never duplicated here.
3. **Reports the exact heads** of all three repos used
   (`extension` / `acquisition` / `authoring`).

Ordinary `npm test` leaves `CP_DRAFT_E2E_REQUIRE` unset, so the expensive
cross-repo fixture still skips there — only this command demands a real run.

## Configuration

Resolution defaults to the sibling-checkout layout; override with env:

| Variable | Meaning | Default |
|---|---|---|
| `COUNTERPEDIA_ACQUISITION_DIR` | acquisition checkout | `../counterpedia-acquisition` |
| `COUNTERPEDIA_AUTHORING_DIR` | authoring checkout | `../counterpedia-authoring` |
| `COUNTERPEDIA_AUTHORING_PYTHON` | interpreter that runs the authoring + acquisition servers (the E2E spawns bare `python3`) | `$COUNTERPEDIA_AUTHORING_DIR/.venv/bin/python` |

The chosen interpreter must be able to import both repos' third-party deps
(the acquisition and authoring source is reached via `PYTHONPATH`, not install);
the authoring venv is a superset (`pydantic` + `httpx` + `jsonschema` + `rfc8785`
+ the `mcp` extra) and is the natural choice.

## Expected result

`Test Files 1 passed (1) / Tests 7 passed (7)` — the full loop:
capture → UNADMITTED → explicit draft-from-source → `assembled` `proposal_only`
handoff, plus the adversarial gates (injection 400, contaminated-response guard
rejection, authoring-failure leaves the acquisition record intact, repeated
drafting non-mutating, missing-artifact client refusal).
