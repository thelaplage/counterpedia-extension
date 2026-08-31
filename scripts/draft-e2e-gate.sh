#!/usr/bin/env bash
# READER-CONSUMER-EXT1 / DRAFT-E2E-HARNESS1 — one-command release gate for:
# browser -> acquisition -> held-capture authoring -> Counterpedia reader projection.
#
# Ordinary `npm test` may skip cross-repo execution when sibling checkouts are
# unavailable. THIS command never turns an unavailable environment into green.
# It requires the exact Acquisition, Authoring, and Counterpedia checkouts and
# reports every head used.
#
# Usage:
#   scripts/draft-e2e-gate.sh
#   COUNTERPEDIA_ACQUISITION_DIR=... \
#   COUNTERPEDIA_AUTHORING_DIR=... \
#   COUNTERPEDIA_DIR=... scripts/draft-e2e-gate.sh
set -euo pipefail

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACQ_DIR="${COUNTERPEDIA_ACQUISITION_DIR:-$(cd "$EXT_DIR/../counterpedia-acquisition" 2>/dev/null && pwd || true)}"
AUTH_DIR="${COUNTERPEDIA_AUTHORING_DIR:-$(cd "$EXT_DIR/../counterpedia-authoring" 2>/dev/null && pwd || true)}"
CP_DIR="${COUNTERPEDIA_DIR:-$(cd "$EXT_DIR/../counterpedia" 2>/dev/null && pwd || true)}"

fail() { echo "DRAFT-E2E-GATE: FAIL — $*" >&2; exit 1; }

[ -n "${ACQ_DIR:-}" ] && [ -f "$ACQ_DIR/scripts/run_acquisition_http_test_fixture.py" ] \
  || fail "counterpedia-acquisition unavailable/incomplete (set COUNTERPEDIA_ACQUISITION_DIR)"
[ -n "${AUTH_DIR:-}" ] && [ -f "$AUTH_DIR/src/counterpedia_authoring/http_transport.py" ] \
  || fail "counterpedia-authoring unavailable/incomplete (set COUNTERPEDIA_AUTHORING_DIR)"
[ -n "${CP_DIR:-}" ] && [ -f "$CP_DIR/app/api/counterpedia/reader/proposal/route.ts" ] \
  || fail "Counterpedia WEB1 checkout unavailable/incomplete (set COUNTERPEDIA_DIR to a checkout containing app/api/counterpedia/reader/proposal/route.ts)"
[ -f "$CP_DIR/package.json" ] || fail "Counterpedia checkout has no package.json"
[ -d "$CP_DIR/node_modules" ] || fail "Counterpedia dependencies unavailable at $CP_DIR/node_modules (install the checkout before running the release gate)"

# --- authoring interpreter (the E2E spawns bare `python3` for producer services) ---
AUTH_PY="${COUNTERPEDIA_AUTHORING_PYTHON:-$AUTH_DIR/.venv/bin/python}"
[ -x "$AUTH_PY" ] || fail "authoring interpreter not found at $AUTH_PY (create the authoring venv, or set COUNTERPEDIA_AUTHORING_PYTHON)"

# --- consume the AUTHORITATIVE mcp pin from authoring pyproject ---
MCP_REQ="$("$AUTH_PY" - "$AUTH_DIR/pyproject.toml" <<'PY'
import sys, tomllib
data = tomllib.load(open(sys.argv[1], "rb"))
extra = data.get("project", {}).get("optional-dependencies", {}).get("mcp") or []
print(extra[0] if extra else "")
PY
)"
[ -n "$MCP_REQ" ] || fail "authoring pyproject declares no [mcp] optional extra to consume"
echo "DRAFT-E2E-GATE: authoritative authoring mcp extra = $MCP_REQ"

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

head_of() { git -C "$1" rev-parse HEAD 2>/dev/null || echo "??"; }
echo "DRAFT-E2E-GATE heads:"
echo "  extension=$(head_of "$EXT_DIR")"
echo "  acquisition=$(head_of "$ACQ_DIR")"
echo "  authoring=$(head_of "$AUTH_DIR")"
echo "  counterpedia=$(head_of "$CP_DIR")"

export COUNTERPEDIA_ACQUISITION_DIR="$ACQ_DIR"
export COUNTERPEDIA_AUTHORING_DIR="$AUTH_DIR"
export COUNTERPEDIA_DIR="$CP_DIR"
export CP_DRAFT_E2E_REQUIRE=1
export CP_READER_E2E_REQUIRE=1
export PATH="$(dirname "$AUTH_PY"):$PATH"

cd "$EXT_DIR"
echo "DRAFT-E2E-GATE: running real acquisition -> authoring -> Counterpedia reader projection gate"
exec npx vitest run tests/draftFromSource.e2e.test.ts "$@"
