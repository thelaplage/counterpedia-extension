#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  osascript -e 'display dialog "Counterpedia Local needs Python 3 installed on this Mac." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi

cd "$HERE"
exec "$PYTHON" counterpedia_local.py --open
