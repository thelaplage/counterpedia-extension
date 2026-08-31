#!/bin/bash
# Reset Draft-from-source Chrome Canary.command
#
# Composes the existing ownership-scoped demo reset with reader_demo.py's
# separate ownership record. A pre-existing compatible Counterpedia reader
# reused by the canary is never tracked and therefore never stopped here.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"

command -v "$PYTHON" >/dev/null 2>&1 || {
  echo "error: Draft-from-source Chrome canary reset needs Python 3." >&2
  exit 1
}

# Reset the established SELF-LOAD0 demo first. Its reset retains custody bytes
# unless the existing COUNTERPEDIA_DEMO_PURGE_CUSTODY opt-in is explicitly set.
bash "$HERE/Reset Counterpedia Demo.command"

echo
echo "Resetting Counterpedia reader only if this canary launcher owned it…"
"$PYTHON" "$HERE/reader_demo.py" reset

echo
echo "Draft-from-source Chrome canary reset complete."
