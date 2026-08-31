#!/bin/bash
# Start Counterpedia Demo.command
#
# One-click, self-loading DEMO BOOTSTRAP (SELF-LOAD0). This performs
# operational preparation -- locate checkouts, verify required files, build
# the unpacked extension if needed, prepare the canonical Counterpedia reader,
# start Counterpedia Local -- and then SELF-LOADS the unpacked extension into
# a dedicated Chrome-for-Testing demo browser with a persistent profile.
#
# Normal repeat use is: double-click this launcher, open the source page you
# want to use, then click the Counterpedia toolbar icon on that page. That
# real Chrome action opens the docked side panel and grants activeTab to the
# source tab. Connect Counterpedia Local once, capture the source, mark the
# retained capture as evidence, then Draft from this source.
#
# Stable-channel daily Chrome CANNOT be used here: Chrome 152+ silently
# ignores --load-extension. This launcher only ever targets a
# Chrome-for-Testing/Chromium build (see demo_browser.py), never the user's
# default browser.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# 1. locate this extension checkout (tools/counterpedia-local/.. is repo root)
EXT_ROOT="$(cd "$HERE/../.." && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"

# 2. locate configured sibling checkouts. Acquisition keeps its established
#    default. Counterpedia is different because the proposal reader may still
#    live in a DRAFT linked worktree: an explicit override wins; otherwise
#    reader_demo.py performs fail-closed sibling/worktree discovery.
ACQ_DIR="${COUNTERPEDIA_ACQUISITION_DIR:-$HOME/Developer/repos/counterpedia-acquisition}"
ACQ_PYTHON="${COUNTERPEDIA_ACQUISITION_PYTHON:-$ACQ_DIR/.venv/bin/python}"
COUNTERPEDIA_DIR_OVERRIDE="${COUNTERPEDIA_DIR:-${COUNTERPEDIA_REPO_DIR:-}}"

# If this bootstrap itself starts the reader and a later bootstrap stage fails,
# clean up only that reader. A successful launch hands reader lifecycle to the
# existing ownership-scoped Reset Counterpedia Demo.command.
READER_STARTED_BY_THIS_RUN=0
BOOTSTRAP_SUCCEEDED=0
cleanup_failed_bootstrap() {
  local status=$?
  if [[ "$BOOTSTRAP_SUCCEEDED" != "1" && "$READER_STARTED_BY_THIS_RUN" == "1" ]]; then
    "$PYTHON" "$HERE/reader_demo.py" reset >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup_failed_bootstrap EXIT

fail() {
  echo "error: $1" >&2
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null 2>&1 || true
  fi
  exit 1
}

echo "Counterpedia Local demo bootstrap"
echo "  extension checkout:    $EXT_ROOT"
echo "  acquisition checkout:  $ACQ_DIR"
echo "  acquisition python:    $ACQ_PYTHON"
if [[ -n "$COUNTERPEDIA_DIR_OVERRIDE" ]]; then
  echo "  Counterpedia checkout: $COUNTERPEDIA_DIR_OVERRIDE (explicit)"
else
  echo "  Counterpedia checkout: auto-discover sibling / linked reader worktree"
fi

command -v "$PYTHON" >/dev/null 2>&1 || fail "Counterpedia Local needs Python 3 installed on this Mac."

# 3. verify acquisition requirements. Reader checkout validation is delegated
#    to reader_demo.py so this launcher never redefines that route contract.
[[ -d "$ACQ_DIR" ]] || fail "Configured acquisition checkout not found at $ACQ_DIR. Set COUNTERPEDIA_ACQUISITION_DIR to the accepted checkout."
[[ -f "$ACQ_DIR/scripts/run_counterpedia_local_transport.py" ]] || fail "Acquisition checkout at $ACQ_DIR is missing scripts/run_counterpedia_local_transport.py (the frozen local-transport contract)."
[[ -f "$ACQ_PYTHON" ]] || fail "Configured acquisition Python interpreter not found at $ACQ_PYTHON. Set COUNTERPEDIA_ACQUISITION_PYTHON to an interpreter with acquisition installed."

cd "$EXT_ROOT"
DIST_DIR="$EXT_ROOT/dist"
DIST_MANIFEST="$DIST_DIR/manifest.json"

# 4. build authoring-dev unpacked extension, only if missing/forced/keyless.
# A plain `vite build` can overwrite dist/manifest.json with the KEYLESS
# production manifest, which would give the self-loaded extension a non-stable
# id. Rebuild whenever the pinned key is absent.
dist_manifest_has_key() {
  [[ -f "$DIST_MANIFEST" ]] || return 1
  "$PYTHON" - "$DIST_MANIFEST" <<'PY' 2>/dev/null
import json, sys
try:
    m = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if m.get("key") else 1)
PY
}
if [[ "${FORCE_REBUILD:-0}" == "1" ]] || ! dist_manifest_has_key; then
  echo "Building unpacked extension (authoring-dev)…"
  command -v npm >/dev/null 2>&1 || fail "Counterpedia Local demo bootstrap needs npm installed on this Mac."
  npm run build:authoring-dev
  dist_manifest_has_key || fail "Built dist/manifest.json is missing the pinned extension key — stable id cannot be guaranteed."
else
  echo "Unpacked extension already built at $DIST_DIR with pinned key (set FORCE_REBUILD=1 to rebuild)."
fi

# Finder-launched processes do not inherit a developer shell's API-key
# environment. Prefer an already-configured value, otherwise read the
# team-beta key from macOS Keychain. Never print it.
KEYCHAIN_SERVICE="counterpedia-openai-api-key"
if [[ -z "${OPENAI_API_KEY:-}" ]] && command -v security >/dev/null 2>&1; then
  KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
  if [[ -n "$KEY" ]]; then
    export OPENAI_API_KEY="$KEY"
  fi
  unset KEY
fi

export COUNTERPEDIA_ACQUISITION_DIR="$ACQ_DIR"
export COUNTERPEDIA_ACQUISITION_PYTHON="$ACQ_PYTHON"
if [[ -n "$COUNTERPEDIA_DIR_OVERRIDE" ]]; then
  export COUNTERPEDIA_DIR="$COUNTERPEDIA_DIR_OVERRIDE"
  export COUNTERPEDIA_REPO_DIR="$COUNTERPEDIA_DIR_OVERRIDE"
fi

# 5. resolve the self-loading demo browser BEFORE starting anything else, so
#    a missing Chrome-for-Testing/Chromium install fails fast.
echo "Resolving demo browser…"
DEMO_BROWSER_OUT="$("$PYTHON" "$HERE/demo_browser.py" resolve 2>&1)" || fail "$DEMO_BROWSER_OUT"
DEMO_BROWSER="$DEMO_BROWSER_OUT"
echo "  $DEMO_BROWSER"

# 6. prepare the canonical reader route introduced by READER-CONSUMER-EXT1.
#    The helper accepts only the exact fail-closed proposal route contract;
#    a generic/foreign service on :3000 is refused, never killed or replaced.
echo "Preparing canonical Counterpedia proposal reader…"
READER_START_ARGS=(start)
if [[ -n "$COUNTERPEDIA_DIR_OVERRIDE" ]]; then
  READER_START_ARGS+=(--counterpedia-dir "$COUNTERPEDIA_DIR_OVERRIDE")
fi
READER_START_OUT="$("$PYTHON" "$HERE/reader_demo.py" "${READER_START_ARGS[@]}" 2>&1)" || fail "$READER_START_OUT"
echo "$READER_START_OUT"
READER_STARTED_BY_THIS_RUN="$(printf '%s' "$READER_START_OUT" | "$PYTHON" -c 'import json,sys; p=json.load(sys.stdin); print("1" if p.get("status") == "started" else "0")' 2>/dev/null)" \
  || fail "Counterpedia reader started but its ownership result could not be parsed."

# 7. start Counterpedia Local (operator build: pairing + capture + recovery +
#    authoring when configured) in the background -- NOT with --open, since
#    the demo browser below owns the visible host.
cd "$HERE"
echo "Starting Counterpedia Local…"
echo
echo "Unpacked extension path (self-loaded into the demo browser below):"
echo "  $DIST_DIR"
echo

LOCAL_LOG_DIR="$HOME/.counterpedia/local/logs"
mkdir -p "$LOCAL_LOG_DIR"
nohup "$PYTHON" counterpedia_local_operator.py >>"$LOCAL_LOG_DIR/companion.log" 2>&1 &
LOCAL_PID=$!
disown "$LOCAL_PID" 2>/dev/null || true

# 8. wait boundedly for Counterpedia Local's companion port to accept
#    connections before pointing the demo browser at it.
echo "Waiting for Counterpedia Local (pid $LOCAL_PID) to become ready…"
READY=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:8790/healthz" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$LOCAL_PID" 2>/dev/null; then
    fail "Counterpedia Local exited before becoming ready. See $LOCAL_LOG_DIR/companion.log"
  fi
  sleep 0.25
done
[[ "$READY" == "1" ]] || fail "Counterpedia Local did not become ready within 10s. See $LOCAL_LOG_DIR/companion.log"

# 9. launch the demo browser: self-loads the unpacked extension via
#    --load-extension into a persistent dedicated profile. The browser opens
#    onto a neutral instructions page so the first source capture is not the
#    loopback status page (which acquisition correctly SSRF-refuses).
DEMO_PROFILE_DIR="$HOME/Library/Application Support/CounterpediaLocal/demo-profile"
mkdir -p "$DEMO_PROFILE_DIR"

INSTRUCTIONS_URL_OUT="$("$PYTHON" "$HERE/demo_browser.py" instructions-url "http://127.0.0.1:8790/" 2>&1)" \
  || fail "$INSTRUCTIONS_URL_OUT"
INSTRUCTIONS_URL="$INSTRUCTIONS_URL_OUT"

echo "Launching demo browser with the self-loaded extension…"
nohup "$DEMO_BROWSER" \
  --user-data-dir="$DEMO_PROFILE_DIR" \
  --load-extension="$DIST_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$INSTRUCTIONS_URL" \
  >>"$LOCAL_LOG_DIR/demo-browser.log" 2>&1 &
DEMO_BROWSER_PID=$!
disown "$DEMO_BROWSER_PID" 2>/dev/null || true

# 10. record supervisor-owned Local + browser pids. Reader ownership remains
#     separately bound by reader_demo.py's exact live-command state file.
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$PYTHON" "$HERE/reset_demo.py" record-session \
  "$LOCAL_PID" "counterpedia_local_operator.py" \
  "$DEMO_BROWSER_PID" "user-data-dir=$DEMO_PROFILE_DIR" \
  "$DEMO_PROFILE_DIR" "$STARTED_AT" >/dev/null 2>&1 || true

BOOTSTRAP_SUCCEEDED=1

echo
echo "Counterpedia Local demo is running:"
echo "  Counterpedia reader:    http://127.0.0.1:3000/api/counterpedia/reader/proposal"
echo "  Counterpedia Local pid: $LOCAL_PID  (log: $LOCAL_LOG_DIR/companion.log)"
echo "  Demo browser pid:       $DEMO_BROWSER_PID  (log: $LOCAL_LOG_DIR/demo-browser.log)"
echo "  Demo profile:           $DEMO_PROFILE_DIR"
echo
echo "In the demo browser window:"
echo "  1. Open a PUBLIC source page (for example https://example.com/)."
echo "  2. Click the REAL Counterpedia toolbar icon on that page — this opens the"
echo "     docked side panel AND grants access to the current tab (activeTab)."
echo "  3. Click \"Connect Counterpedia Local\" (once)."
echo "  4. Click \"Capture this source\" and confirm the capture remains UNADMITTED."
echo "  5. Select \"Use this captured source as evidence\"."
echo "  6. Click \"Draft from this source\"."
echo "  7. Canary PASS: proposal content/evidence renders; proposal-only /"
echo "     non-admission boundary remains visible; no \"reader projection unavailable\"."
echo "No extension ID, token, DevTools setup, or second browser harness is required."
echo
echo "Run \"python3 $HERE/supervisor.py --skip-network-artifacts\" for readiness,"
echo "or double-click \"Reset Counterpedia Demo.command\" to stop only this"
echo "session's owned processes and clear its ephemeral demo profile."
