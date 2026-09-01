#!/bin/bash
# Reset Counterpedia Demo.command
#
# Bounded, ownership-scoped reset for the pitch appliance. Stops ONLY the
# Counterpedia Local + demo-browser processes tracked by reset_demo.py and,
# when present, the canonical Counterpedia reader process tracked separately
# by reader_demo.py. Every stop is guarded by the live-command signature that
# was recorded at launch time.
#
# It NEVER kills a process whose live command no longer matches the recorded
# signature and NEVER deletes retained acquisition custody bytes unless
# COUNTERPEDIA_DEMO_PURGE_CUSTODY=1 is set explicitly before running this.
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

# Stop the demo-browser + Counterpedia Local processes owned by the established
# SELF-LOAD0 launcher first.
"$PYTHON" reset_demo.py "${ARGS[@]}"

# Then stop only a canonical reader that reader_demo.py itself started. A
# compatible reader that pre-existed the demo has no state file and is left
# alone. A pid/signature mismatch returns 2 and remains untouched/inspectable.
READER_RESET_RC=0
"$PYTHON" reader_demo.py reset || READER_RESET_RC=$?

if [[ "$READER_RESET_RC" == "2" ]]; then
  echo "note: Counterpedia reader reset REFUSED because the tracked pid no longer"
  echo "matches the launch-time command signature. The process was not touched." >&2
elif [[ "$READER_RESET_RC" != "0" ]]; then
  echo "error: Counterpedia reader reset failed (exit $READER_RESET_RC)." >&2
  exit "$READER_RESET_RC"
fi

echo
echo "Reset complete. Double-click \"Start Counterpedia Demo.command\" to start a fresh demo session."
