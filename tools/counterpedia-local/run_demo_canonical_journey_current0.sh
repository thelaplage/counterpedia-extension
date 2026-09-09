#!/usr/bin/env bash
set -euo pipefail

# DEMO-CANONICAL-JOURNEY-CURRENT0
# Exact-head local launcher for Transaction A.
#
# This wrapper is intentionally non-mutating with respect to sibling repos:
# it fetches, verifies that each supplied checkout is clean and exactly on
# origin/main, records the exact heads, and then launches the real-browser
# harness from this execution branch. It does not merge, admit, publish, or
# alter standing.

EXT_ROOT="$(git rev-parse --show-toplevel)"
ACQ_DIR="${COUNTERPEDIA_ACQUISITION_DIR:-$HOME/Developer/repos/counterpedia-acquisition}"
AUTH_DIR="${COUNTERPEDIA_AUTHORING_DIR:-$HOME/Developer/repos/counterpedia-authoring}"
CP_DIR="${COUNTERPEDIA_DIR:-$HOME/Developer/repos/counterpedia}"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 2
}

require_repo() {
  local label="$1" dir="$2"
  [[ -d "$dir/.git" || -f "$dir/.git" ]] || fail "$label checkout missing: $dir"
}

require_clean() {
  local label="$1" dir="$2"
  [[ -z "$(git -C "$dir" status --porcelain)" ]] || fail "$label checkout is not clean: $dir"
}

require_current_main() {
  local label="$1" dir="$2"
  git -C "$dir" fetch origin --quiet
  local head remote
  head="$(git -C "$dir" rev-parse HEAD)"
  remote="$(git -C "$dir" rev-parse origin/main)"
  [[ "$head" == "$remote" ]] || fail "$label HEAD is not current origin/main ($head != $remote)"
  printf '%s=%s\n' "$label" "$head"
}

require_repo extension "$EXT_ROOT"
require_repo acquisition "$ACQ_DIR"
require_repo authoring "$AUTH_DIR"
require_repo counterpedia "$CP_DIR"

require_clean extension "$EXT_ROOT"
require_clean acquisition "$ACQ_DIR"
require_clean authoring "$AUTH_DIR"
require_clean counterpedia "$CP_DIR"

# Refresh extension main, but do NOT move this execution branch.
git -C "$EXT_ROOT" fetch origin --quiet
EXT_HEAD="$(git -C "$EXT_ROOT" rev-parse HEAD)"
EXT_MAIN="$(git -C "$EXT_ROOT" rev-parse origin/main)"
EXT_BRANCH="$(git -C "$EXT_ROOT" branch --show-current)"

[[ "$EXT_BRANCH" == "exec/demo-canonical-journey-current0" ]] \
  || fail "extension must be on exec/demo-canonical-journey-current0 (got '$EXT_BRANCH')"

# This is the fail-closed drift guard: if main advanced after the execution
# branch was cut, origin/main is no longer an ancestor of HEAD and we stop for
# overlap review instead of silently testing stale product bytes.
git -C "$EXT_ROOT" merge-base --is-ancestor "$EXT_MAIN" "$EXT_HEAD" \
  || fail "extension main moved beyond this execution branch; recut/review before running"

ACQ_HEAD="$(require_current_main acquisition "$ACQ_DIR" | cut -d= -f2)"
AUTH_HEAD="$(require_current_main authoring "$AUTH_DIR" | cut -d= -f2)"
CP_HEAD="$(require_current_main counterpedia "$CP_DIR" | cut -d= -f2)"

RUN_DIR="${RUN_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/demo-canonical-journey-current0.XXXXXX")}" 
mkdir -p "$RUN_DIR"

cat > "$RUN_DIR/execution_heads.json" <<JSON
{
  "extension_execution_head": "$EXT_HEAD",
  "extension_origin_main": "$EXT_MAIN",
  "acquisition_main": "$ACQ_HEAD",
  "authoring_main": "$AUTH_HEAD",
  "counterpedia_main": "$CP_HEAD",
  "authority_movement": 0,
  "admission_effect": "none",
  "standing_effect": "none"
}
JSON

printf 'Execution heads:\n'
cat "$RUN_DIR/execution_heads.json"
printf '\nRun directory: %s\n' "$RUN_DIR"

export COUNTERPEDIA_ACQUISITION_DIR="$ACQ_DIR"
export COUNTERPEDIA_AUTHORING_DIR="$AUTH_DIR"
export COUNTERPEDIA_DIR="$CP_DIR"
export RUN_DIR

python3 "$EXT_ROOT/tools/counterpedia-local/verify_draft_from_source_browser_e2e.py"

[[ -f "$RUN_DIR/provenance_packet.json" ]] || fail "browser harness returned without provenance_packet.json"

python3 - "$RUN_DIR/provenance_packet.json" "$RUN_DIR/execution_heads.json" <<'PY'
import json, sys
from pathlib import Path

packet = json.loads(Path(sys.argv[1]).read_text())
heads = json.loads(Path(sys.argv[2]).read_text())
if packet.get("result") != "PASS":
    raise SystemExit("FAIL: provenance packet result is not PASS")
actual = packet.get("extension", {}).get("heads", {})
expected = {
    "extension": heads["extension_execution_head"],
    "acquisition": heads["acquisition_main"],
    "authoring": heads["authoring_main"],
    "counterpedia": heads["counterpedia_main"],
}
if actual != expected:
    raise SystemExit(f"FAIL: provenance head mismatch: actual={actual!r} expected={expected!r}")
print("TRANSACTION_A_CURRENT_HEADS_PASS")
print("AUTHORITY_MOVEMENT=0")
print("ADMISSION_EFFECT=none")
print("STANDING_EFFECT=none")
PY

printf '\nTransaction A fresh artifacts remain outside git at:\n  %s\n' "$RUN_DIR"
printf 'Do not copy/commit them blindly; sanitize machine-local paths and independently rehash retained bytes first.\n'
printf '\nTransaction B is intentionally separate. After owner review of A, run the landed CHECK handoff harness from the same current extension checkout:\n'
printf '  python3 tools/counterpedia-local/verify_scanner_check_handoff_e2e.py\n'
