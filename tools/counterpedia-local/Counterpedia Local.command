#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"
KEYCHAIN_SERVICE="counterpedia-openai-api-key"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  osascript -e 'display dialog "Counterpedia Local needs Python 3 installed on this Mac." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi

# Finder-launched apps/commands do not inherit a developer shell's API-key
# environment. Prefer an already-configured environment value, otherwise read
# the team-beta key from macOS Keychain. The value is never printed.
if [[ -z "${OPENAI_API_KEY:-}" ]] && command -v security >/dev/null 2>&1; then
  KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
  if [[ -n "$KEY" ]]; then
    export OPENAI_API_KEY="$KEY"
  fi
  unset KEY
fi

cd "$HERE"
exec "$PYTHON" counterpedia_local_operator.py --open
