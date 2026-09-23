#!/bin/bash
# Start Counterpedia Demo.command
#
# One-click, self-loading DEMO BOOTSTRAP (SELF-LOAD0). This performs
# operational preparation -- locate checkouts, verify required files, build
# the unpacked extension from THIS checkout, prepare the canonical Counterpedia
# reader, start Counterpedia Local -- and then SELF-LOADS the unpacked extension
# into a dedicated Chrome-for-Testing demo browser with a persistent profile.
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
#
# DEMO-RUNTIME-HARDENING0 keeps this launcher fail-closed and boring:
# - dist is rebuilt from the checkout on every start (no stale key-bearing dist);
# - a pre-existing :8790 listener is refused, never reused or killed;
# - readiness belongs to the process THIS launcher spawned, not any old healthz;
# - the local-demo DAGR adapter/evidence directory are provisioned explicitly;
# - the selected Authoring checkout must expose the current v0.5 source path.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# 1. locate this extension checkout (tools/counterpedia-local/.. is repo root)
EXT_ROOT="$(cd "$HERE/../.." && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"

# 2. locate configured sibling checkouts. Acquisition keeps its established
#    default. Counterpedia proposal-reader discovery remains owned by
#    reader_demo.py unless an explicit override is supplied. Authoring's existing
#    default order is made explicit here so the launcher can validate and print
#    the exact checkout before Local starts it.
ACQ_DIR="${COUNTERPEDIA_ACQUISITION_DIR:-$HOME/Developer/repos/counterpedia-acquisition}"
ACQ_PYTHON="${COUNTERPEDIA_ACQUISITION_PYTHON:-$ACQ_DIR/.venv/bin/python}"
COUNTERPEDIA_DIR_OVERRIDE="${COUNTERPEDIA_DIR:-${COUNTERPEDIA_REPO_DIR:-}}"
if [[ -n "${COUNTERPEDIA_AUTHORING_DIR:-}" ]]; then
  AUTHORING_DIR="$COUNTERPEDIA_AUTHORING_DIR"
elif [[ -d "$HOME/Developer/worktrees/counterpedia-authoring-live-source" ]]; then
  AUTHORING_DIR="$HOME/Developer/worktrees/counterpedia-authoring-live-source"
else
  AUTHORING_DIR="$HOME/Developer/repos/counterpedia-authoring"
fi

# If this bootstrap itself starts a child and a later bootstrap stage fails,
# clean up only children this run actually spawned. A successful launch hands
# lifecycle to the existing ownership-scoped Reset Counterpedia Demo.command.
READER_STARTED_BY_THIS_RUN=0
BOOTSTRAP_SUCCEEDED=0
LOCAL_PID=""
DEMO_BROWSER_PID=""
cleanup_failed_bootstrap() {
  local status=$?
  if [[ "$BOOTSTRAP_SUCCEEDED" != "1" ]]; then
    if [[ -n "$DEMO_BROWSER_PID" ]] && kill -0 "$DEMO_BROWSER_PID" 2>/dev/null; then
      kill -TERM "$DEMO_BROWSER_PID" 2>/dev/null || true
    fi
    if [[ -n "$LOCAL_PID" ]] && kill -0 "$LOCAL_PID" 2>/dev/null; then
      kill -TERM "$LOCAL_PID" 2>/dev/null || true
      wait "$LOCAL_PID" 2>/dev/null || true
    fi
    if [[ "$READER_STARTED_BY_THIS_RUN" == "1" ]]; then
      "$PYTHON" "$HERE/reader_demo.py" reset >/dev/null 2>&1 || true
    fi
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

port_accepting() {
  "$PYTHON" - "$1" <<'PY' >/dev/null 2>&1
import socket, sys
port = int(sys.argv[1])
try:
    with socket.create_connection(("127.0.0.1", port), timeout=0.25):
        pass
except OSError:
    raise SystemExit(1)
raise SystemExit(0)
PY
}

checkout_head() {
  local repo="$1"
  if command -v git >/dev/null 2>&1 && git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$repo" rev-parse HEAD 2>/dev/null || true
  fi
}

echo "Counterpedia Local demo bootstrap"
echo "  extension checkout:    $EXT_ROOT"
echo "  acquisition checkout:  $ACQ_DIR"
echo "  acquisition python:    $ACQ_PYTHON"
echo "  authoring checkout:    $AUTHORING_DIR"
if [[ -n "$COUNTERPEDIA_DIR_OVERRIDE" ]]; then
  echo "  Counterpedia checkout: $COUNTERPEDIA_DIR_OVERRIDE (explicit)"
else
  echo "  Counterpedia checkout: auto-discover canonical sibling / linked reader worktree"
fi
EXT_HEAD="$(checkout_head "$EXT_ROOT")"
AUTHORING_HEAD="$(checkout_head "$AUTHORING_DIR")"
[[ -z "$EXT_HEAD" ]] || echo "  extension source head: $EXT_HEAD"
[[ -z "$AUTHORING_HEAD" ]] || echo "  authoring source head: $AUTHORING_HEAD"

command -v "$PYTHON" >/dev/null 2>&1 || fail "Counterpedia Local needs Python 3 installed on this Mac."

# 3. verify dependency requirements before mutating runtime state. Generic
#    Acquisition MCP remains fail-closed; this LOCAL-DEMO launcher explicitly
#    chooses the already-reviewed local-demo DAGR adapter instead of weakening
#    that generic boundary.
[[ -d "$ACQ_DIR" ]] || fail "Configured acquisition checkout not found at $ACQ_DIR. Set COUNTERPEDIA_ACQUISITION_DIR to the accepted checkout."
[[ -f "$ACQ_DIR/scripts/run_counterpedia_local_transport.py" ]] || fail "Acquisition checkout at $ACQ_DIR is missing scripts/run_counterpedia_local_transport.py (the frozen local-transport contract)."
[[ -f "$ACQ_PYTHON" ]] || fail "Configured acquisition Python interpreter not found at $ACQ_PYTHON. Set COUNTERPEDIA_ACQUISITION_PYTHON to an interpreter with acquisition installed."
[[ -d "$AUTHORING_DIR" ]] || fail "Configured Authoring checkout not found at $AUTHORING_DIR. Set COUNTERPEDIA_AUTHORING_DIR to the accepted checkout."
[[ -x "$AUTHORING_DIR/.venv/bin/counterpedia-authoring-live-source" ]] || fail "Authoring checkout at $AUTHORING_DIR is missing .venv/bin/counterpedia-authoring-live-source."
[[ -f "$AUTHORING_DIR/src/counterpedia_authoring/draft_source_v05.py" ]] || fail "Authoring checkout at $AUTHORING_DIR lacks the v0.5 historical Draft-from-source path. Point COUNTERPEDIA_AUTHORING_DIR at the accepted current Authoring checkout."

# Canonical demo requires the v0.5 response guard that accepts the producer's
# optional claim_support_assessment_set opaquely. Refuse an older extension
# checkout before building a deceptively healthy-looking demo.
[[ -f "$EXT_ROOT/src/lib/authoringResponseGuard.ts" ]] || fail "Extension checkout is missing src/lib/authoringResponseGuard.ts."
grep -q 'claim_support_assessment_set' "$EXT_ROOT/src/lib/authoringResponseGuard.ts" \
  || fail "This extension checkout predates EXT-AUTHORING-V05-GUARD1. Use the accepted current demo source; refusing to build an incompatible Draft-from-source client."

# :8790 is Counterpedia Local's owned companion port. Never let an old/foreign
# process satisfy this run's health check. Refuse before reader/build startup;
# Reset can stop only a previously tracked Counterpedia Local process.
if port_accepting 8790; then
  fail "127.0.0.1:8790 is already in use. Run 'Reset Counterpedia Demo.command' for a tracked demo or inspect the port owner; this launcher will not reuse or kill it."
fi

cd "$EXT_ROOT"
DIST_DIR="$EXT_ROOT/dist"
DIST_MANIFEST="$DIST_DIR/manifest.json"

# 4. ALWAYS build authoring-dev from the checkout being launched. A key-bearing
#    dist proves only stable extension identity; it does NOT prove its JS matches
#    current source bytes. The build is intentionally cheap and removes that
#    entire stale-artifact state from the one-click path.
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
echo "Building unpacked extension (authoring-dev) from current checkout…"
command -v npm >/dev/null 2>&1 || fail "Counterpedia Local demo bootstrap needs npm installed on this Mac."
npm run build:authoring-dev
dist_manifest_has_key || fail "Built dist/manifest.json is missing the pinned extension key — stable id cannot be guaranteed."
grep -Rqs --include='*.js' 'claim_support_assessment_set' "$DIST_DIR" \
  || fail "Built extension does not contain the required v0.5 Authoring response guard; refusing stale/incompatible dist."

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
export COUNTERPEDIA_AUTHORING_DIR="$AUTHORING_DIR"
if [[ -n "$COUNTERPEDIA_DIR_OVERRIDE" ]]; then
  export COUNTERPEDIA_DIR="$COUNTERPEDIA_DIR_OVERRIDE"
  export COUNTERPEDIA_REPO_DIR="$COUNTERPEDIA_DIR_OVERRIDE"
fi

# LOCAL-DEMO-ONLY governance wiring. Respect explicit operator overrides, but
# otherwise use the canonical factory that admits only the held-capture demo
# operation. The generic MCP server still has no default adapter of its own.
export COUNTERPEDIA_ACQUISITION_DAGR_ADAPTER_FACTORY="${COUNTERPEDIA_ACQUISITION_DAGR_ADAPTER_FACTORY:-dagr_mcp_local_demo.counterpedia_acquisition:build_adapter}"
export COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR="${COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR:-$HOME/.counterpedia/local/dagr-evidence/live-authoring-accept0}"
mkdir -p "$COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR"
chmod 700 "$COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR" 2>/dev/null || true

# Authoring is optional when no model key exists. If it WILL be started, prove
# the DAGR adapter and SDK binding now rather than letting Draft fail later.
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  DAGR_PROBE_OUT="$("$ACQ_PYTHON" - <<'PY' 2>&1
import importlib
import os

selector = os.environ.get("COUNTERPEDIA_ACQUISITION_DAGR_ADAPTER_FACTORY", "")
if ":" not in selector:
    raise RuntimeError("DAGR adapter selector must be MODULE:CALLABLE")
module_name, callable_name = selector.split(":", 1)
module = importlib.import_module(module_name)
factory = getattr(module, callable_name)
if not callable(factory):
    raise RuntimeError("configured DAGR adapter factory is not callable")
from dagr_mcp_sdk_binding.adapter import SdkLifecycleAdapter  # noqa: F401
print("ready")
PY
)" || fail "Authoring is configured but the local-demo DAGR binding is unavailable: $DAGR_PROBE_OUT"
  [[ "$DAGR_PROBE_OUT" == "ready" ]] || fail "Unexpected local-demo DAGR preflight result."
  echo "Local-demo DAGR binding: ready"
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

# 8. wait boundedly for THIS Counterpedia Local process to become ready. The
#    child-liveness check deliberately precedes healthz, and is repeated after
#    healthz succeeds, so an old/foreign :8790 responder can never make a dead
#    newly-spawned child look healthy.
echo "Waiting for Counterpedia Local (pid $LOCAL_PID) to become ready…"
READY=0
for _ in $(seq 1 40); do
  if ! kill -0 "$LOCAL_PID" 2>/dev/null; then
    fail "Counterpedia Local exited before becoming ready. See $LOCAL_LOG_DIR/companion.log"
  fi
  if curl -fsS "http://127.0.0.1:8790/healthz" >/dev/null 2>&1; then
    if ! kill -0 "$LOCAL_PID" 2>/dev/null; then
      fail "Counterpedia Local exited while readiness was being established. See $LOCAL_LOG_DIR/companion.log"
    fi
    READY=1
    break
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
echo "  DAGR evidence:          $COUNTERPEDIA_LOCAL_DEMO_EVIDENCE_DIR"
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
