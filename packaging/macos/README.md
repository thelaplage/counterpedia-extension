# Counterpedia Local macOS app — MACOS-APP0

This lane packages the existing **Counterpedia Local** supervisor plus the exact
Acquisition and Authoring runtime entrypoints it already consumes into a native
macOS `.app` distribution boundary.

It is packaging only. It moves **zero authority** and creates no new acquisition,
authoring, admission, verification, publication, standing, receipt, or corpus
semantics.

## Scope

The app bundles these existing runtime surfaces:

- Counterpedia Local operator supervisor;
- `counterpedia-acquisition` supervised local transport;
- `counterpedia-acquisition-mcp`;
- `counterpedia-wikipedia-harvest`;
- `counterpedia-ingest-operator-snapshot`;
- `counterpedia-authoring-live-source`;
- the exact `dagr-sdk` + `dagr-mcp` local-demo execution-governance binding already used by the stacked Demo Kit lane.

The browser extension remains a separate Chrome distribution surface. MACOS-APP0
does not add Chrome host permissions, auto-install an extension, or widen browser
capture permissions.

## Why the runtime layout looks like a checkout

The reviewed Local contract currently resolves child commands at checkout-style
paths. Rather than rewrite that supervisor while the Demo Kit lane owns the broad
runtime surface, MACOS-APP0 embeds signed standalone helpers under an internal
`Contents/Helpers/runtime/.../.venv/bin/` layout. `Contents/Helpers` is used because the embedded helpers are executable code, not resource data.

The file named `counterpedia-acquisition/.venv/bin/python` is deliberately a
**single-purpose signed adapter**, not a general Python interpreter. It accepts
only the exact existing `scripts/run_counterpedia_local_transport.py` path and
then delegates to `acquisition.local_transport_launcher.main()`. Any other argv is
refused. The exact provenance script is copied into the bundle and must be present.

This preserves the Local launch contract without shipping a relocatability-fragile
virtualenv or teaching Local a second runtime dialect.

## Build

Requirements on the build Mac:

- Python 3.12+
- Xcode command-line signing tools
- clean local checkouts of `counterpedia-extension`, `counterpedia-acquisition`,
  and `counterpedia-authoring`, plus the exact `dagr-sdk` and `dagr-mcp` source checkouts used for the build

The builder creates an isolated temporary build venv and installs the pinned
`PyInstaller==6.22.3` there. A system/global PyInstaller install is neither
required nor consumed. PyInstaller is build machinery only; it is not a runtime
authority.

Every source checkout is fail-closed against an explicit 40-character expected
commit SHA. A clean checkout at the wrong commit is refused with
`SOURCE_PIN_MISMATCH`; the manifest therefore records only the caller-supplied
release pinset that was actually proven at build time.

Local/ad-hoc build:

```bash
python3 packaging/macos/build_app.py \
  --acquisition-dir ~/Developer/repos/counterpedia-acquisition \
  --authoring-dir ~/Developer/repos/counterpedia-authoring \
  --dagr-sdk-dir ~/Developer/repos/dagr-sdk \
  --dagr-mcp-dir ~/Developer/repos/dagr-mcp \
  --expected-extension-sha "$EXT_SHA" \
  --expected-acquisition-sha "$ACQ_SHA" \
  --expected-authoring-sha "$AUTH_SHA" \
  --expected-dagr-sdk-sha "$SDK_SHA" \
  --expected-dagr-mcp-sha "$MCP_SHA" \
  --output-dir ./dist-macos
```

Developer ID build:

```bash
COUNTERPEDIA_CODESIGN_IDENTITY='Developer ID Application: Example Corp (TEAMID)' \
python3 packaging/macos/build_app.py \
  --acquisition-dir ~/Developer/repos/counterpedia-acquisition \
  --authoring-dir ~/Developer/repos/counterpedia-authoring \
  --dagr-sdk-dir ~/Developer/repos/dagr-sdk \
  --dagr-mcp-dir ~/Developer/repos/dagr-mcp \
  --expected-extension-sha "$EXT_SHA" \
  --expected-acquisition-sha "$ACQ_SHA" \
  --expected-authoring-sha "$AUTH_SHA" \
  --expected-dagr-sdk-sha "$SDK_SHA" \
  --expected-dagr-mcp-sha "$MCP_SHA" \
  --output-dir ./dist-macos
```

The bundle manifest records the five exact source HEADs and SHA-256 digests of
all packaged helper executables.

## Notarization

Store `notarytool` credentials in the macOS Keychain under a profile name, then:

```bash
COUNTERPEDIA_NOTARY_KEYCHAIN_PROFILE=counterpedia-notary \
  packaging/macos/notarize_app.sh 'dist-macos/Counterpedia Local.app'
```

The script verifies the signature, submits a ZIP with `xcrun notarytool`, staples
the returned ticket, validates the staple, and runs Gatekeeper assessment.

Apple requires Developer ID signing, Hardened Runtime, and a secure timestamp for
software submitted for notarization. The signed build path passes the Developer ID
identity to PyInstaller for each frozen helper and the app. After the helpers are embedded under `Contents/Helpers`, the builder re-signs only the top-level app seal (without `codesign --deep`); recursive `--deep` is used for verification only.

## Current hold / stacking

MACOS-APP0 is intentionally stacked on the current Demo Kit owner lane rather than
competing with it. A green package build does **not** clear any existing physical
product-certification or Authoring hold, and does not authorize merge of the Demo
Kit owner lane.

## Non-claims

- packaging success does not prove browser capture works on a recipient Mac;
- code signing does not confer Counterpedia authority;
- notarization is malware/signature screening, not semantic verification;
- possession of the local transport token remains transport authentication only;
- Authoring remains proposal-only and may be unavailable when no drafting key is configured; DAGR governance of the held-capture tool is not Counterpedia corpus admission.
