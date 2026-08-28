#!/bin/bash
# Start Counterpedia Demo.command
#
# One-click DEMO BOOTSTRAP. This performs ONLY operational preparation --
# locate checkouts, verify required files, build the unpacked extension if
# needed, start Counterpedia Local, and open its status page. It never asks
# for an extension ID or a transport token: the extension's own pairing UI
# (Connect Counterpedia Local) handles that dynamically via POST /v0/pair.
#
# Normal repeat use is: double-click this launcher, then click "Connect
# Counterpedia Local" in the already-loaded unpacked extension's side panel.
# No rebuild happens unless dist/ is missing or FORCE_REBUILD=1 is set.
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

# 4. build authoring-dev unpacked extension, only if missing or forced
if [[ ! -f "$DIST_MANIFEST" || "${FORCE_REBUILD:-0}" == "1" ]]; then
  echo "Building unpacked extension (authoring-dev)…"
  command -v npm >/dev/null 2>&1 || fail "Counterpedia Local demo bootstrap needs npm installed on this Mac."
  npm run build:authoring-dev
else
  echo "Unpacked extension already built at $DIST_DIR (set FORCE_REBUILD=1 to rebuild)."
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

# 5. start Counterpedia Local (operator build: pairing + capture + recovery +
#    operator-snapshot); 6. --open opens its status page
cd "$HERE"
echo "Starting Counterpedia Local…"
echo
echo "Unpacked extension path (load this in chrome://extensions if not already loaded):"
echo "  $DIST_DIR"
echo

# 7. print/show the unpacked extension path, then hand off to the supervisor.
exec "$PYTHON" counterpedia_local_operator.py --open
