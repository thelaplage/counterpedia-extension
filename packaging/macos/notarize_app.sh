#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 '/path/to/Counterpedia Local.app'" >&2
  exit 64
fi
APP="$1"
PROFILE="${COUNTERPEDIA_NOTARY_KEYCHAIN_PROFILE:-}"
if [[ -z "$PROFILE" ]]; then
  echo "COUNTERPEDIA_NOTARY_KEYCHAIN_PROFILE is required" >&2
  exit 64
fi
if [[ ! -d "$APP" ]]; then
  echo "app bundle not found: $APP" >&2
  exit 66
fi

codesign --verify --deep --strict --verbose=4 "$APP"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ZIP="$TMP/Counterpedia-Local.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=4 "$APP"
echo "COUNTERPEDIA_MACOS_NOTARIZATION=PASS"
