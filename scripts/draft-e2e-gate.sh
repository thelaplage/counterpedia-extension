#!/usr/bin/env bash
# DRAFT-E2E-HARNESS0 — one-command release gate for the browser -> acquisition ->
# authoring "draft from source" loop (tests/draftFromSource.e2e.test.ts).
#
# WHY THIS EXISTS: run bare, that E2E is `describe.skip` unless BOTH sibling
# repos are co-located AND the authoring interpreter carries the authoring
# project's declared optional `mcp` extra. A plain `vitest run` therefore turns
# "environment unavailable" into an apparent green. This gate instead:
#   * FAILS LOUDLY (non-zero) when the sibling repos / dependency environment
#     are unavailable, instead of silently skipping;
#   * consumes the AUTHORING project's OWN declared `mcp` pin (read from its
#     pyproject) rather than a version duplicated here or whatever `mcp`
#     happens to be on PATH;
#   * reports the exact extension / acquisition / authoring heads used.
#
# Ordinary `npm test` still runs the E2E in its normal (skippable) mode; only
# THIS command sets CP_DRAFT_E2E_REQUIRE=1 to demand a real run.
#
# Usage:
#   scripts/draft-e2e-gate.sh                       # release gate (fails if env missing)
#   COUNTERPEDIA_ACQUISITION_DIR=... \
#   COUNTERPEDIA_AUTHORING_DIR=...   scripts/draft-e2e-gate.sh
set -euo pipefail

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACQ_DIR="${COUNTERPEDIA_ACQUISITION_DIR:-$(cd "$EXT_DIR/../counterpedia-acquisition" 2>/dev/null && pwd || true)}"
AUTH_DIR="${COUNTERPEDIA_AUTHORING_DIR:-$(cd "$EXT_DIR/../counterpedia-authoring" 2>/dev/null && pwd || true)}"

fail() { echo "DRAFT-E2E-GATE: FAIL — $*" >&2; exit 1; }

# --- sibling repos present and complete ---
[ -n "${ACQ_DIR:-}" ] && [ -f "$ACQ_DIR/scripts/run_acquisition_http_test_fixture.py" ] \
  || fail "counterpedia-acquisition unavailable/incomplete (set COUNTERPEDIA_ACQUISITION_DIR to a checkout containing scripts/run_acquisition_http_test_fixture.py)"
[ -n "${AUTH_DIR:-}" ] && [ -f "$AUTH_DIR/src/counterpedia_authoring/http_transport.py" ] \
  || fail "counterpedia-authoring unavailable/incomplete (set COUNTERPEDIA_AUTHORING_DIR to a checkout containing src/counterpedia_authoring/http_transport.py)"

# --- authoring interpreter (the E2E spawns bare `python3` for both servers) ---
AUTH_PY="${COUNTERPEDIA_AUTHORING_PYTHON:-$AUTH_DIR/.venv/bin/python}"
[ -x "$AUTH_PY" ] || fail "authoring interpreter not found at $AUTH_PY (create the authoring venv, or set COUNTERPEDIA_AUTHORING_PYTHON)"

# --- read the AUTHORITATIVE mcp pin from authoring pyproject (no local duplicate) ---
MCP_REQ="$("$AUTH_PY" - "$AUTH_DIR/pyproject.toml" <<'PY'
import sys, tomllib
data = tomllib.load(open(sys.argv[1], "rb"))
extra = data.get("project", {}).get("optional-dependencies", {}).get("mcp") or []
print(extra[0] if extra else "")
PY
)"
[ -n "$MCP_REQ" ] || fail "authoring pyproject declares no [mcp] optional extra to consume"
echo "DRAFT-E2E-GATE: authoritative authoring mcp extra = $MCP_REQ"

# --- ensure that exact pin is importable in the authoring interpreter ---
if ! "$AUTH_PY" - "$MCP_REQ" <<'PY'
import sys, importlib.metadata as md
name, _, want = sys.argv[1].partition("==")
try:
    have = md.version(name.strip())
except Exception:
    sys.exit(1)
sys.exit(0 if (not want or have == want.strip()) else 1)
PY
then
  echo "DRAFT-E2E-GATE: installing $MCP_REQ into $AUTH_PY (authoring's declared extra)"
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "$AUTH_PY" "$MCP_REQ" >&2
  else
    "$AUTH_PY" -m pip install "$MCP_REQ" >&2
  fi
fi

# --- report exact heads used by this gate ---
head_of() { git -C "$1" rev-parse --short HEAD 2>/dev/null || echo "??"; }
echo "DRAFT-E2E-GATE heads: extension=$(head_of "$EXT_DIR") acquisition=$(head_of "$ACQ_DIR") authoring=$(head_of "$AUTH_DIR")"

# --- run the gate in REQUIRE mode (the test throws, not skips, if unresolved) ---
export COUNTERPEDIA_ACQUISITION_DIR="$ACQ_DIR"
export COUNTERPEDIA_AUTHORING_DIR="$AUTH_DIR"
export CP_DRAFT_E2E_REQUIRE=1
export PATH="$(dirname "$AUTH_PY"):$PATH"

cd "$EXT_DIR"
echo "DRAFT-E2E-GATE: running tests/draftFromSource.e2e.test.ts (require mode)"
exec npx vitest run tests/draftFromSource.e2e.test.ts "$@"
