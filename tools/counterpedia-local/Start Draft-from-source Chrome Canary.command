#!/bin/bash
# Start Draft-from-source Chrome Canary.command
#
# Thin composition wrapper over the already-landed SELF-LOAD0 launcher.
# It adds exactly one new prerequisite for READER-CONSUMER-EXT1: the accepted
# Counterpedia checkout's canonical proposal reader route on 127.0.0.1:3000.
# Browser loading, stable extension identity, Counterpedia Local pairing,
# Acquisition, Authoring, and Chrome-for-Testing ownership remain with the
# existing Start Counterpedia Demo.command + companion implementation.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${COUNTERPEDIA_LOCAL_PYTHON:-python3}"
CP_DIR="${COUNTERPEDIA_DIR:-${COUNTERPEDIA_REPO_DIR:-$HOME/Developer/repos/counterpedia}}"

fail() {
  echo "error: $1" >&2
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null 2>&1 || true
  fi
  exit 1
}

command -v "$PYTHON" >/dev/null 2>&1 || fail "Draft-from-source Chrome canary needs Python 3."

echo "Draft-from-source Chrome canary"
echo "  Counterpedia reader checkout: $CP_DIR"
echo

echo "Starting/reusing the canonical Counterpedia proposal reader on 127.0.0.1:3000…"
"$PYTHON" "$HERE/reader_demo.py" start --counterpedia-dir "$CP_DIR" \
  || fail "Counterpedia proposal reader is not ready. See the JSON error above."

# SELF-LOAD0 remains the browser/companion authority. Do not reimplement its
# Chrome-for-Testing resolution, stable-id build, pairing, or process guards.
if ! bash "$HERE/Start Counterpedia Demo.command"; then
  echo "Base demo launcher failed; cleaning up the reader only if this wrapper owned it…" >&2
  "$PYTHON" "$HERE/reader_demo.py" reset >/dev/null 2>&1 || true
  exit 1
fi

cat <<'EOF'

Draft-from-source Chrome canary is prepared.

In the Chrome-for-Testing window:
  1. Open https://example.com/ (or another public source page).
  2. Click the Counterpedia toolbar icon ON THAT PAGE. This is the real Chrome
     action gesture: it opens the docked MV3 side panel and grants activeTab.
  3. Click “Connect Counterpedia Local” once if the panel is not already paired.
  4. Click “Capture this source”. Confirm the acquisition state is UNADMITTED.
  5. Check “Use this captured source as evidence”.
  6. Click “Draft from this source”.
  7. Canary PASS requires the REAL side panel to show all of:
       • Proposal assembled / proposal lifecycle
       • proposed title or lead content
       • evidence:E001 (or the producer’s emitted evidence handle)
       • “Proposal only — not admitted, published, verified, or standing.”
       • NO “reader projection unavailable” message

This is deliberately a human toolbar click for the final host proof. The existing
CDP harness already established that activeTab + sidePanel.open cannot be stably
manufactured through a plain extension tab without automating undocumented Chrome
toolbar internals or broadening host permissions.
EOF
