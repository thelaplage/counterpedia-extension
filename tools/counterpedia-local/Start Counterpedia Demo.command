#!/bin/bash
# Start Counterpedia Demo.command
#
# One-click, self-loading DEMO BOOTSTRAP (SELF-LOAD0). This performs
# operational preparation -- locate checkouts, verify required files, build
# the unpacked extension if needed, start Counterpedia Local -- and then
# SELF-LOADS the unpacked extension into a dedicated Chrome-for-Testing demo
# browser with a persistent profile, so there is no manual
# chrome://extensions / Load unpacked step. It never asks for an extension ID
# or a transport token: the extension's own pairing UI (Connect Counterpedia
# Local) handles that dynamically via POST /v0/pair.
#
# Normal repeat use is: double-click this launcher, then click "Connect
# Counterpedia Local" in the side panel of the extension that is already
# loaded in the demo browser window that opens. No rebuild happens unless
# dist/ is missing or FORCE_REBUILD=1 is set. Repeat double-clicks reuse the
# same persistent demo profile (extensions.settings warnings from Chrome
# about developer-mode extensions are expected and harmless).
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

# 2. locate configured acquisition checkout (env override, else team-beta default)
ACQ_DIR="${COUNTERPEDIA_ACQUISITION_DIR:-$HOME/Developer/repos/counterpedia-acquisition}"
ACQ_PYTHON="${COUNTERPEDIA_ACQUISITION_PYTHON:-$ACQ_DIR/.venv/bin/python}"

fail() {
  echo "error: $1" >&2
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null 2>&1 || true
  fi
  exit 1
}

echo "Counterpedia Local demo bootstrap"
echo "  extension checkout:   $EXT_ROOT"
echo "  acquisition checkout: $ACQ_DIR"
echo "  acquisition python:   $ACQ_PYTHON"

command -v "$PYTHON" >/dev/null 2>&1 || fail "Counterpedia Local needs Python 3 installed on this Mac."

# 3. verify required files
[[ -d "$ACQ_DIR" ]] || fail "Configured acquisition checkout not found at $ACQ_DIR. Set COUNTERPEDIA_ACQUISITION_DIR to the accepted checkout."
[[ -f "$ACQ_DIR/scripts/run_counterpedia_local_transport.py" ]] || fail "Acquisition checkout at $ACQ_DIR is missing scripts/run_counterpedia_local_transport.py (the frozen local-transport contract)."
[[ -f "$ACQ_PYTHON" ]] || fail "Configured acquisition Python interpreter not found at $ACQ_PYTHON. Set COUNTERPEDIA_ACQUISITION_PYTHON to an interpreter with acquisition installed."

cd "$EXT_ROOT"
DIST_DIR="$EXT_ROOT/dist"
DIST_MANIFEST="$DIST_DIR/manifest.json"

# 4. build authoring-dev unpacked extension, only if missing/forced/keyless.
# A plain `vite build` (via the closeBundle static-asset copy) overwrites
# dist/manifest.json with the KEYLESS production manifest, which would give the
# self-loaded extension a NON-stable id. So we rebuild not just when the manifest
# is absent, but whenever it lacks the pinned `key` — otherwise the stable-id
# guarantee (and thus deterministic pairing) silently breaks.
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
# team-beta key from macOS Keychain. Never printed.
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

# 5. resolve the self-loading demo browser BEFORE starting anything else, so
#    a missing Chrome-for-Testing/Chromium install fails fast and clearly
#    instead of after the supervisor is already up.
echo "Resolving demo browser…"
DEMO_BROWSER_OUT="$("$PYTHON" "$HERE/demo_browser.py" resolve 2>&1)" || fail "$DEMO_BROWSER_OUT"
DEMO_BROWSER="$DEMO_BROWSER_OUT"
echo "  $DEMO_BROWSER"

# 6. start Counterpedia Local (operator build: pairing + capture + recovery +
#    operator-snapshot) in the background -- NOT with --open, since the
#    demo browser (not the user's default browser) will open the status page.
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

# 7. wait boundedly for Counterpedia Local's companion port to accept
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

# 8. launch the demo browser: self-loads the unpacked extension via
#    --load-extension into a PERSISTENT DEDICATED profile so repeat
#    double-clicks are resilient (extension present + same stable id every
#    launch, thanks to the manifest "key"). No --enable-automation / no
#    automation infobar.
#
#    The browser opens onto a NEUTRAL, self-contained instructions tab (a
#    data: URL -- no new host_permissions or web_accessible_resources
#    needed) rather than Counterpedia Local's own loopback status page.
#    Opening directly onto the status page made it the panel's default
#    "Source", so the very first "Capture this source" click looked broken
#    (the real acquisition backend correctly SSRF-refuses a loopback
#    source). The panel's "Open local status" button still reaches the
#    status page whenever it's actually wanted.
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

# 9. record supervisor-owned pids + a live-command signature for each, so a
#    later "Reset Counterpedia Demo.command" can stop exactly these two
#    processes (never a foreign one that happens to reuse a pid number) and
#    clear only this run's own ephemeral demo profile. Best-effort: a failure
#    here must not fail the demo start, it only means reset won't find a
#    tracked session and will report nothing to stop.
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$PYTHON" "$HERE/reset_demo.py" record-session \
  "$LOCAL_PID" "counterpedia_local_operator.py" \
  "$DEMO_BROWSER_PID" "user-data-dir=$DEMO_PROFILE_DIR" \
  "$DEMO_PROFILE_DIR" "$STARTED_AT" >/dev/null 2>&1 || true

echo
echo "Counterpedia Local demo is running:"
echo "  Counterpedia Local pid: $LOCAL_PID  (log: $LOCAL_LOG_DIR/companion.log)"
echo "  Demo browser pid:       $DEMO_BROWSER_PID  (log: $LOCAL_LOG_DIR/demo-browser.log)"
echo "  Demo profile:           $DEMO_PROFILE_DIR"
echo
echo "In the demo browser window:"
echo "  1. Open a source page (any http/https site you want to capture)."
echo "  2. Click the Counterpedia toolbar icon on that page — this opens the"
echo "     side panel AND grants access to the current tab (activeTab). Opening"
echo "     the panel this way is required for \"Capture this source\" to work."
echo "  3. Click \"Connect Counterpedia Local\" (once)."
echo "  4. Click \"Capture this source\", then \"Check browser recovery\"."
echo "No extension ID, token, or DevTools setup is required."
echo
echo "Run \"python3 $HERE/preflight.py\" any time for a bounded pitch-readiness"
echo "check, or double-click \"Reset Counterpedia Demo.command\" to stop this"
echo "session's own processes and clear its own demo profile before a re-run."
