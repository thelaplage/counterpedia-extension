#!/usr/bin/env bash
# READER-CONSUMER-EXT1 / EXT-DRAFT-SOURCE-V05-ACTIVATE0 — one-command release gate for:
# browser -> acquisition -> held-capture authoring -> exact fresh handoff ->
# Counterpedia reader projection -> extension compact preview.
#
# It retains the mature three-process custody/non-refetch negatives and the
# direct Counterpedia HTTP contamination-refusal proof, and now also refuses
# to run the v0.5 literal transaction against sibling checkouts that do not
# contain the required Authoring finalizer / Counterpedia role-carry seams.
#
# Ordinary `npm test` may skip cross-repo execution when sibling checkouts are
# unavailable. THIS command never turns an unavailable or wrong-stack
# environment into green.
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
  || fail "Counterpedia reader checkout unavailable/incomplete (set COUNTERPEDIA_DIR)"
[ -f "$CP_DIR/package.json" ] || fail "Counterpedia checkout has no package.json"
[ -f "$CP_DIR/lib/counterpedia/__fixtures__/authoringHandoff.evidenceE001.json" ] \
  || fail "Counterpedia checkout lacks the committed evidence:E001 Authoring handoff fixture"
[ -d "$CP_DIR/node_modules" ] || fail "Counterpedia dependencies unavailable at $CP_DIR/node_modules"

# v0.5 capability preflight. These are structural capability checks, not
# version-string guesses. A checkout that can only execute the legacy loop must
# never make the new v0.5 same-run transaction look green.
[ -f "$AUTH_DIR/src/counterpedia_authoring/draft_source_v05.py" ] \
  || fail "Authoring checkout lacks DRAFT-SOURCE-V05-FINALIZE0 (draft_source_v05.py)"
[ -f "$AUTH_DIR/src/counterpedia_authoring/completeness_binder.py" ] \
  || fail "Authoring checkout lacks COMPLETENESS-BINDER0"
[ -f "$AUTH_DIR/src/counterpedia_authoring/composer/initial_content_unit_identity.py" ] \
  || fail "Authoring checkout lacks COMPOSER-CONTENT-UNIT-ID0"
[ -f "$CP_DIR/lib/counterpedia/authoringSectionRoleCarry.test.ts" ] \
  || fail "Counterpedia checkout lacks canonical READER-SECTION-ROLE-CARRY0 seam"

grep -q 'section\.role' "$CP_DIR/lib/counterpedia/authoringProposalToEntryReadModel.ts" \
  || fail "Counterpedia adapter does not visibly carry producer section.role"
grep -q 'draft_completeness_binding' "$AUTH_DIR/src/counterpedia_authoring/draft_source_v05.py" \
  || fail "Authoring v0.5 finalizer does not visibly bind draft_completeness_binding"

AUTH_PY="${COUNTERPEDIA_AUTHORING_PYTHON:-$AUTH_DIR/.venv/bin/python}"
[ -x "$AUTH_PY" ] || fail "authoring interpreter not found at $AUTH_PY"

MCP_REQ="$("$AUTH_PY" - "$AUTH_DIR/pyproject.toml" <<'PY'
import sys, tomllib
data = tomllib.load(open(sys.argv[1], "rb"))
extra = data.get("project", {}).get("optional-dependencies", {}).get("mcp") or []
print(extra[0] if extra else "")
PY
)"
[ -n "$MCP_REQ" ] || fail "authoring pyproject declares no [mcp] optional extra"
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
  echo "DRAFT-E2E-GATE: installing $MCP_REQ into $AUTH_PY"
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "$AUTH_PY" "$MCP_REQ" >&2
  else
    "$AUTH_PY" -m pip install "$MCP_REQ" >&2
  fi
fi

head_of() { git -C "$1" rev-parse HEAD 2>/dev/null || echo "??"; }
EXT_HEAD="$(head_of "$EXT_DIR")"
ACQ_HEAD="$(head_of "$ACQ_DIR")"
AUTH_HEAD="$(head_of "$AUTH_DIR")"
CP_HEAD="$(head_of "$CP_DIR")"
echo "DRAFT-E2E-GATE heads:"
echo "  extension=$EXT_HEAD"
echo "  acquisition=$ACQ_HEAD"
echo "  authoring=$AUTH_HEAD"
echo "  counterpedia=$CP_HEAD"

# Optional exact-pin mode. Set one or more EXPECTED_*_HEAD values when the gate
# is being used as landing evidence. This intentionally allows later reconciled
# heads to run by default while making a recorded exact-head proof impossible to
# perform accidentally against the wrong worktree.
assert_head() {
  local label="$1" actual="$2" expected="$3"
  [ -z "$expected" ] || [ "$actual" = "$expected" ] \
    || fail "$label head mismatch: expected $expected, observed $actual"
}
assert_head "extension" "$EXT_HEAD" "${COUNTERPEDIA_EXTENSION_EXPECTED_HEAD:-}"
assert_head "acquisition" "$ACQ_HEAD" "${COUNTERPEDIA_ACQUISITION_EXPECTED_HEAD:-}"
assert_head "authoring" "$AUTH_HEAD" "${COUNTERPEDIA_AUTHORING_EXPECTED_HEAD:-}"
assert_head "counterpedia" "$CP_HEAD" "${COUNTERPEDIA_EXPECTED_HEAD:-}"

export COUNTERPEDIA_ACQUISITION_DIR="$ACQ_DIR"
export COUNTERPEDIA_AUTHORING_DIR="$AUTH_DIR"
export COUNTERPEDIA_DIR="$CP_DIR"
export CP_DRAFT_E2E_REQUIRE=1
export CP_READER_E2E_REQUIRE=1
export PATH="$(dirname "$AUTH_PY"):$PATH"

cd "$EXT_DIR"
echo "DRAFT-E2E-GATE 1/3: mature acquisition -> held-capture authoring custody/non-refetch suite"
npx vitest run tests/draftFromSource.e2e.test.ts "$@"

echo "DRAFT-E2E-GATE 2/3: real Counterpedia HTTP projection/refusal suite"
npx vitest run tests/entryReadModelHttp.e2e.test.ts "$@"

echo "DRAFT-E2E-GATE 3/3: literal same-run legacy + v0.5 exact-handoff four-service loop"
exec npx vitest run tests/draftFromSourceFourService.e2e.test.ts "$@"
