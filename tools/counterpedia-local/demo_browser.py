#!/usr/bin/env python3
"""SELF-LOAD0 demo-browser resolver + stable extension id computation.

Pure, side-effect-free (except filesystem globbing) logic, factored out so it
is independently unit-testable and importable by the launcher script and the
E2E verifier.

Resolution order for the Chrome-for-Testing / Chromium binary used to
self-load the unpacked demo extension:

1. ``COUNTERPEDIA_DEMO_BROWSER`` env var, if set, is used verbatim (after
   existence + executability checks) -- this is the explicit override path
   for CI or a non-default install location.
2. Otherwise, the newest ``~/Library/Caches/ms-playwright/chromium-*/
   chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google
   Chrome for Testing`` build present on this Mac (Playwright's Chromium
   ships a real "Google Chrome for Testing" binary that still honors
   ``--load-extension``, unlike stable-channel Chrome 152+).

If neither resolves, raises ``DemoBrowserNotFoundError`` with an actionable
message. This module intentionally never falls back to the user's daily
Chrome: stable-channel Chrome silently ignores ``--load-extension`` on this
Mac, which would otherwise look like a confusing, silent failure rather than
a clear error.
"""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

PLAYWRIGHT_CACHE_ROOT = Path.home() / "Library" / "Caches" / "ms-playwright"
CFT_RELATIVE_PATH = (
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
DEMO_BROWSER_ENV = "COUNTERPEDIA_DEMO_BROWSER"

_CHROMIUM_BUILD_RE = re.compile(r"^chromium-(\d+)$")

# Chrome's own bundled component extensions -- never a valid "our extension
# loaded" signal even though they also expose chrome-extension:// targets.
CHROME_COMPONENT_EXTENSION_IDS = frozenset(
    {
        "nmmhkkegccagdldgiimedpiccmgmieda",  # PDF viewer (stable id, varies by channel)
        "nkeimhogjdpnpccoofpliimaahmaaome",  # G+ / hangouts component (historical)
        "fignfifoniblkonapihmkfakmlgkbkcf",  # Chrome media router
        "ghbmnnjooekpmoecnnnilnnbdlolhkhi",  # Google Docs offline
    }
)


class DemoBrowserNotFoundError(RuntimeError):
    pass


def _newest_playwright_chromium_cft(cache_root: Path | None = None) -> Path | None:
    """Return the newest Chrome-for-Testing binary under the Playwright cache, if any.

    "Newest" is the highest numeric ``chromium-<BUILD>`` directory that
    actually contains the expected binary -- the build number is discovered,
    never hardcoded, per SELF-LOAD0's explicit requirement.

    ``cache_root`` defaults to the *current* value of the module-level
    ``PLAYWRIGHT_CACHE_ROOT`` at call time (not at import time), so tests can
    monkeypatch ``demo_browser.PLAYWRIGHT_CACHE_ROOT`` and have it take effect.
    """
    if cache_root is None:
        cache_root = PLAYWRIGHT_CACHE_ROOT
    if not cache_root.is_dir():
        return None
    candidates: list[tuple[int, Path]] = []
    for entry in cache_root.iterdir():
        if not entry.is_dir():
            continue
        match = _CHROMIUM_BUILD_RE.match(entry.name)
        if not match:
            continue
        binary = entry / CFT_RELATIVE_PATH
        if binary.is_file() and os.access(binary, os.X_OK):
            candidates.append((int(match.group(1)), binary))
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[0])
    return candidates[-1][1]


def resolve_demo_browser(env: dict[str, str] | None = None) -> Path:
    """Resolve the Chrome-for-Testing/Chromium binary to self-load into.

    Raises ``DemoBrowserNotFoundError`` with an actionable message if none
    can be found. Never returns a stable-channel daily-Chrome path.
    """
    env = os.environ if env is None else env
    override = env.get(DEMO_BROWSER_ENV, "").strip()
    if override:
        path = Path(override).expanduser()
        if not path.is_file():
            raise DemoBrowserNotFoundError(
                f"{DEMO_BROWSER_ENV}={override!r} does not point at a file. "
                "Set it to a Chrome-for-Testing or Chromium binary that honors "
                "--load-extension."
            )
        if not os.access(path, os.X_OK):
            raise DemoBrowserNotFoundError(
                f"{DEMO_BROWSER_ENV}={override!r} is not executable."
            )
        return path

    found = _newest_playwright_chromium_cft()
    if found is not None:
        return found

    raise DemoBrowserNotFoundError(
        "No self-loadable demo browser found. Stable-channel Chrome does not "
        "honor --load-extension and cannot be used here. Install one with "
        "either:\n"
        "  npx @puppeteer/browsers install chrome@stable\n"
        "  npx playwright install chromium\n"
        f"...or set {DEMO_BROWSER_ENV}=/path/to/Google Chrome for Testing "
        "to point at an existing install."
    )


def compute_stable_extension_id(spki_der: bytes) -> str:
    """Compute Chrome's deterministic extension id from a DER-encoded SPKI public key.

    Chrome's algorithm: take the first 16 bytes of SHA-256(DER SPKI pubkey),
    hex-encode them (32 hex chars), then map each hex digit 0-9a-f to the
    letters a-p (i.e. digit + 'a').
    """
    digest_hex = hashlib.sha256(spki_der).hexdigest()[:32]
    return "".join(chr(ord("a") + int(ch, 16)) for ch in digest_hex)


def compute_stable_extension_id_from_pem(pem_bytes: bytes) -> str:
    """Compute the stable extension id directly from a PEM-encoded RSA key.

    Accepts either a public key PEM (``-----BEGIN PUBLIC KEY-----``) or a
    private key PEM, in which case the public key is derived via
    ``cryptography`` if available, else by shelling out to ``openssl``
    (avoids adding a hard runtime dependency for a demo-only tool).
    """
    text = pem_bytes.decode("ascii", errors="strict")
    if "BEGIN PUBLIC KEY" in text:
        der = _pem_to_der(pem_bytes)
        return compute_stable_extension_id(der)

    # Private key PEM: derive the public key's DER SPKI bytes.
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.serialization import load_pem_private_key

        private_key = load_pem_private_key(pem_bytes, password=None)
        der = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return compute_stable_extension_id(der)
    except ImportError:
        pass

    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".pem") as priv_tmp:
        priv_tmp.write(pem_bytes)
        priv_tmp.flush()
        der = subprocess.run(
            ["openssl", "rsa", "-in", priv_tmp.name, "-pubout", "-outform", "DER"],
            check=True,
            capture_output=True,
        ).stdout
    return compute_stable_extension_id(der)


def build_instructions_data_url(status_page_url: str) -> str:
    """Build a self-contained ``data:`` URL for the demo browser's opening tab.

    SELF-LOAD0 polish (FIX 1): the demo browser must NOT open onto
    ``status_page_url`` (Counterpedia Local's own loopback status page).
    Doing so made that loopback URL the panel's default "Source", so the
    very first "Capture this source" click looked broken (the real
    acquisition backend's SSRF guard correctly refuses to register a
    loopback-sourced capture -- see verify_ui_click_through_e2e.py's SSRF
    FINDING). This builds a small, self-contained instructions page instead
    -- explicitly NOT a page the user is meant to capture -- telling them to
    navigate the tab to their actual source page first.

    A ``data:`` URL needs no new ``host_permissions`` or
    ``web_accessible_resources`` entry (the extension never talks to this
    tab at all -- it isn't declared reachable and nothing here calls into
    the extension), which is the simplest option that avoids broadening the
    manifest for a one-shot instructional tab.

    Pure string-building; no filesystem/network access, so it is directly
    unit-testable.
    """
    import html
    import urllib.parse

    safe_status_url = html.escape(status_page_url, quote=True)
    body = f"""<!doctype html>
<meta charset="utf-8">
<title>Counterpedia demo</title>
<style>
body{{font:15px system-ui,-apple-system,sans-serif;max-width:640px;margin:64px auto;padding:0 20px;color:#17211f}}
h1{{margin-bottom:8px}}
.note{{color:#a13c32;font-weight:600;margin:0 0 20px}}
ol{{padding-left:20px}}
li{{margin:10px 0}}
a{{color:#177245}}
</style>
<h1>Counterpedia demo is ready</h1>
<p class="note">This tab is instructions only &mdash; it is NOT a source to capture.</p>
<ol>
<li>Navigate <strong>this tab</strong> to the source page you want to capture (any real http/https site).</li>
<li>Click the <strong>Counterpedia</strong> toolbar icon on that page &mdash; this opens the side panel and grants it access to the current tab.</li>
<li>In the panel, click <strong>Connect Counterpedia Local</strong> (once).</li>
<li>Click <strong>Capture this source</strong>, then <strong>Check browser recovery</strong>.</li>
</ol>
<p>Counterpedia Local's own status page (dependency/health, not a capture source) stays reachable any time from the panel's <strong>Open local status</strong> button, or directly at <a href="{safe_status_url}">{safe_status_url}</a>.</p>
"""
    return "data:text/html," + urllib.parse.quote(body)


def _pem_to_der(pem_bytes: bytes) -> bytes:
    import base64

    text = pem_bytes.decode("ascii")
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and "BEGIN" not in line and "END" not in line
    ]
    return base64.b64decode("".join(lines))


def _main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("resolve", help="print the resolved demo browser binary path")
    id_parser = sub.add_parser("id", help="print the deterministic extension id for a PEM key")
    id_parser.add_argument("pem_path", type=Path)
    instructions_parser = sub.add_parser(
        "instructions-url", help="print the neutral data: URL the demo browser should open onto"
    )
    instructions_parser.add_argument(
        "status_page_url", help="Counterpedia Local's own status page URL, linked from the instructions"
    )

    args = parser.parse_args(argv)
    if args.command == "resolve":
        try:
            print(resolve_demo_browser())
        except DemoBrowserNotFoundError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        return 0
    if args.command == "id":
        pem_bytes = args.pem_path.read_bytes()
        print(compute_stable_extension_id_from_pem(pem_bytes))
        return 0
    if args.command == "instructions-url":
        print(build_instructions_data_url(args.status_page_url))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(_main())
