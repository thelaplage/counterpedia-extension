#!/bin/bash
# Reset Counterpedia Demo.command
#
# Bounded, ownership-scoped reset for the pitch appliance. Stops ONLY the
# Counterpedia Local + demo-browser processes THIS supervisor's own
# "Start Counterpedia Demo.command" launcher spawned (tracked by pid + a
# live-command signature recorded at launch), clears its own ephemeral demo
# browser profile, and leaves the retained acquisition capture-registry
# (~/.counterpedia/acquisition) untouched.
#
# It NEVER kills a process whose live command no longer matches the
# signature recorded at launch (foreign-process guard) and NEVER deletes
# retained custody bytes unless COUNTERPEDIA_DEMO_PURGE_CUSTODY=1 is set
# explicitly before running this.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"

command -v "$PYTHON" >/dev/null 2>&1 || {
  echo "error: Counterpedia Local needs Python 3 installed on this Mac." >&2
  exit 1
}

cd "$HERE"
ARGS=(reset)
if [[ "${COUNTERPEDIA_DEMO_PURGE_CUSTODY:-0}" == "1" ]]; then
  echo "COUNTERPEDIA_DEMO_PURGE_CUSTODY=1 set: this run will ALSO delete the"
  echo "retained acquisition capture-registry (~/.counterpedia/acquisition)."
  ARGS+=(--purge-custody)
fi

"$PYTHON" reset_demo.py "${ARGS[@]}"

echo
echo "Reset complete. Double-click \"Start Counterpedia Demo.command\" to start a fresh demo session."
