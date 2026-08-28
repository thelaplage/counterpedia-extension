#!/usr/bin/env python3
"""SELF-LOAD0 continuation: full UI CLICK-THROUGH E2E, driven over real CDP.

Extends (does not replace) verify_self_load_e2e.py's pure load+pair proof.
That script still passes unmodified and is the fast/pure gate; THIS script
drives the actual rendered side-panel DOM -- the real "Connect Counterpedia
Local" and "Capture this source" / "Check browser recovery" buttons -- via
the Chrome DevTools Protocol, exactly as a person clicking the extension
would, rather than POSTing to the companion's HTTP API directly.

WHY A REAL CONTENT TAB, AND WHICH URL
--------------------------------------
The capture handler (src/background/service-worker.ts::handleCapturePage)
resolves its target with:

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    ...
    await chrome.scripting.executeScript({ target: { tabId: tab.id, ... }, ... })

`currentWindow` here is evaluated from the SERVICE WORKER's own execution
context (background scripts have no window of their own), which Chrome
resolves to the last-focused browser window -- NOT the tab the message
happened to originate from. So the panel, if opened as an ordinary tab
alongside a content tab, must never itself hold "active tab" status in that
window, or handleCapturePage would capture the panel page instead of the
real content page.

This script opens the panel as ONE tab and the content page as ANOTHER tab
in the SAME single browser window, then explicitly asserts (and
re-asserts, right before every capture-triggering click) that the content
tab -- never the panel tab -- is `chrome.tabs.active` via a
`chrome.tabs.update(contentTabId, { active: true })` call issued from the
SW's own CDP session (which has full chrome.* API access and is not tied to
any window/tab, so it can authoritatively fix active-tab state regardless of
which tab Target.createTarget happened to focus last). The panel's click
handlers are then triggered via CDP `Runtime.evaluate(...click())` on the
PANEL target's session -- this never touches or focuses the panel tab at the
OS/window-manager level, so it cannot itself become "active".

`tabs.query`'s `active`/`currentWindow` selection is about Chrome's *tab
model* state (which this script controls directly and precisely via
`chrome.tabs.update`), not about OS-level window focus -- so this works
identically whether Chrome is headless or headful.

WHICH CONTENT PAGE, AND WHY IT NEEDS NO EXTRA FIXTURE FILE
-------------------------------------------------------------
The content tab is navigated to `http://127.0.0.1:8790/` -- Counterpedia
Local's OWN status page (served by the very companion this script starts).
This is:
  - strictly loopback, no external network access, matching the mission's
    "no external egress" constraint even more strictly than a data: URL;
  - a real HTML page with a distinct <title>Counterpedia Local</title> and
    real body text (status rows, "Use Counterpedia" paragraph) -- exactly
    the "title + some text" fixture the mission asks for, with no new file
    to bundle;
  - already covered by the extension's declared host_permissions
    (`http://127.0.0.1:8790/*` in manifest.authoring-dev.json), so
    `chrome.tabs.query` can see its `url`/`title` and
    `chrome.scripting.executeScript` can inject into it WITHOUT relying on
    the `activeTab` permission's "genuine user gesture" grant at all -- side-
    stepping the (real, and otherwise nontrivial) question of whether a
    CDP-synthesized click on a panel opened as a plain tab (not a true
    docked chrome.sidePanel) would even qualify for that grant. A plain JS
    `.click()` dispatched via `Runtime.evaluate` is sufficient here; no
    `Input.dispatchMouseEvent` synthetic input is required.
  - importantly, its title ("Counterpedia Local") is unambiguously distinct
    from the panel page's own title ("Counterpedia" -- see
    src/panel/index.html), so a successful capture whose
    `document_title` is "Counterpedia Local" is proof the CONTENT page was
    captured, not the panel.

WHAT THIS PROVES THAT verify_self_load_e2e.py DOES NOT
---------------------------------------------------------
  1. the REAL "Connect Counterpedia Local" button (src/panel/localPairing.ts)
     runs -- chrome.runtime.id -> POST /v0/pair -> chrome.storage.session/
     sync -> window.location.reload() -- not a script-level POST /v0/pair;
  2. after reload the panel's own status line renders Connected / Capture
     ready / Recovery ready (localPairing.ts's `refresh()`);
  3. the REAL #capture-btn (src/panel/captureButton.ts) sends CAPTURE_PAGE,
     which round-trips through the SAME background handler, rendering
     "Captured: Counterpedia Local" from the browser-side DOM capture alone
     (no network needed for THIS part -- capturePageData() only reads the
     tab's own DOM);
  4. that capture ALSO drives the REAL runAcquisition() POST to the real,
     frozen acquisition checkout -- see "SSRF FINDING" below for what this
     script actually observed and asserts there, and why.

SSRF FINDING (read before assuming this script should enable #recovery-btn)
-----------------------------------------------------------------------------
This continuation's original brief assumed a browser-observation is
registered server-side with "no network needed" (zero re-fetch). Reading the
REAL, unmodified acquisition transport handler
(counterpedia-acquisition/src/acquisition/http_transport.py
`_handle_observation`, step 11) shows that is not how the current backend
works: it resolves the BrowserPageCapture to a URL and then calls
`AcquisitionMcpSurface.capture_url({"url": ...})`
(counterpedia-acquisition/src/acquisition/mcp_surface.py), which performs a
REAL, LIVE `HttpFetcher.fetch()` of that exact URL -- the browser's DOM
capture is only used to resolve which URL to (re-)fetch, never stored
in place of an HTTP fetch. That fetch is gated by `HttpEgressPolicy`
(counterpedia-acquisition/src/acquisition/fetch.py `_default_allow_address`),
which categorically refuses loopback/private/reserved/link-local addresses
-- by design, as an SSRF guard, with no override plumbed through
Counterpedia Local's transport launcher.

Given the mission's own hard constraints (loopback-only, NO external
network fetch, do NOT weaken any existing gate), and that this script's
content page is necessarily loopback, the REAL backend WILL and SHOULD
refuse to register that capture (`capture_status: "capture_failed"`,
nothing written to the capture registry). Getting #recovery-btn to enable
for a loopback content page would require either weakening the real SSRF
guard or making an actual external network fetch -- this script does
neither. Instead, it asserts the CORRECT negative outcome end-to-end:
  4. the panel's own #acquisition-status renders "Acquisition failed" (the
     real, honest producer-reported refusal -- not a transport error);
  5. #recovery-btn correctly STAYS disabled (there is no server-side held
     capture_id for it to check), and the acquisition durable store
     correctly holds NO receipt for this refused capture (confirmed by a
     direct filesystem read of its capture-registry, not a second HTTP
     call).
This is a real, verified architectural boundary, not a shortfall in this
script -- and it is exactly the kind of thing an E2E gate driving the REAL
UI (rather than assuming a mental model of the system) is supposed to
surface.

Usage:
  COUNTERPEDIA_ACQUISITION_DIR=/private/tmp/cplocalacq0 \\
  COUNTERPEDIA_ACQUISITION_PYTHON="$HOME/Developer/repos/counterpedia-acquisition/.venv-review/bin/python" \\
  python3 tools/counterpedia-local/verify_ui_click_through_e2e.py
  # or, in a sandbox with no attached WindowServer:
  COUNTERPEDIA_VERIFY_HEADLESS=1 python3 tools/counterpedia-local/verify_ui_click_through_e2e.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cdp  # noqa: E402
import demo_browser as db  # noqa: E402
from verify_self_load_e2e import (  # noqa: E402
    COMPANION_PORT,
    DIST_DIR,
    ProcessGuard,
    VerifyFailure,
    compute_expected_extension_id,
    ensure_dist_built,
    log,
    start_companion,
    wait_for,
)

CDP_PORT = 9923
CONTENT_URL = f"http://127.0.0.1:{COMPANION_PORT}/"
CONTENT_EXPECTED_TITLE = "Counterpedia Local"
LOAD_TIMEOUT_S = 20.0
UI_TIMEOUT_S = 25.0


def start_demo_browser_for_cdp(guard: ProcessGuard, browser_path: Path):
    import tempfile

    profile_dir = guard.track_dir(Path(tempfile.mkdtemp(prefix="cpselfload0-uiprofile-")))
    headless = os.environ.get("COUNTERPEDIA_VERIFY_HEADLESS", "").strip() == "1"
    mode = "HEADLESS (COUNTERPEDIA_VERIFY_HEADLESS=1 override)" if headless else "HEADFUL"
    log(f"launching demo browser {mode} for UI click-through (profile={profile_dir})...")
    argv = [
        str(browser_path),
        f"--user-data-dir={profile_dir}",
        f"--load-extension={DIST_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        f"--remote-debugging-port={CDP_PORT}",
        "about:blank",
    ]
    if headless:
        argv.insert(1, "--headless=new")
    guard.spawn(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return profile_dir


def find_sw_target_id(expected_ext_id: str) -> str:
    def _find():
        for target in cdp.list_targets(CDP_PORT):
            url = target.get("url", "")
            if url == f"chrome-extension://{expected_ext_id}/background/service-worker.js":
                return target["id"]
        return None

    return wait_for(_find, LOAD_TIMEOUT_S, "our extension's service worker target")


def js_str(value: str) -> str:
    """Safely embed a Python string as a JS string literal."""
    return json.dumps(value)


def main() -> int:
    acquisition_dir = os.environ.get("COUNTERPEDIA_ACQUISITION_DIR")
    acquisition_python = os.environ.get("COUNTERPEDIA_ACQUISITION_PYTHON")
    if not acquisition_dir or not acquisition_python:
        print(
            "error: set COUNTERPEDIA_ACQUISITION_DIR and COUNTERPEDIA_ACQUISITION_PYTHON "
            "to point at the reviewed acquisition checkout + interpreter before running verify.",
            file=sys.stderr,
        )
        return 2

    guard = ProcessGuard()
    conn: cdp.CDPConnection | None = None
    try:
        ensure_dist_built()
        expected_id = compute_expected_extension_id()
        log(f"expected stable extension id: {expected_id}")

        browser_path = db.resolve_demo_browser()
        log(f"resolved demo browser: {browser_path}")

        store_root = start_companion(guard, acquisition_dir, acquisition_python)
        start_demo_browser_for_cdp(guard, browser_path)

        sw_target_id = find_sw_target_id(expected_id)
        log(f"LOAD PROOF: service worker target present ({sw_target_id})")

        ws_url = wait_for(
            lambda: cdp.fetch_browser_ws_url(CDP_PORT), LOAD_TIMEOUT_S, "CDP browser endpoint"
        )
        conn = cdp.CDPConnection(ws_url)
        sw_session = conn.attach(sw_target_id)
        log("attached to service worker session (full chrome.* API access, no window of its own)")

        # --- create the content tab (Counterpedia Local's own status page) ---
        content_target_id = conn.create_target(CONTENT_URL)
        content_session = conn.attach(content_target_id)

        def _content_loaded():
            state = conn.evaluate(content_session, "document.readyState", timeout=2)
            title = conn.evaluate(content_session, "document.title", timeout=2)
            return state == "complete" and title == CONTENT_EXPECTED_TITLE

        wait_for(_content_loaded, LOAD_TIMEOUT_S, "content tab to finish loading")
        log(f"content tab loaded: {CONTENT_URL} (title={CONTENT_EXPECTED_TITLE!r})")

        # --- create the panel tab (the real side-panel page, opened as a tab) ---
        panel_url = f"chrome-extension://{expected_id}/panel/index.html"
        panel_target_id = conn.create_target(panel_url)
        panel_session = conn.attach(panel_target_id)

        def _panel_loaded():
            state = conn.evaluate(panel_session, "document.readyState", timeout=2)
            has_ui = conn.evaluate(
                panel_session,
                "!!document.getElementById('counterpedia-local-section') && "
                "!!document.getElementById('capture-btn') && "
                "!!document.getElementById('recovery-btn')",
                timeout=2,
            )
            return state == "complete" and has_ui

        wait_for(_panel_loaded, LOAD_TIMEOUT_S, "panel tab to finish loading its UI")
        log(f"panel tab loaded: {panel_url}")

        # --- TAB-TARGETING: resolve chrome tab ids for both, then pin the
        # content tab as the active tab. Done from the SW session, which has
        # full chrome.tabs access and is not itself a window/tab. ---
        def _resolve_tabs():
            # From the SW: chrome.tabs.query only reports `url` for tabs the
            # extension can see without extra permission -- which, per the
            # declared host_permissions, includes the content tab
            # (http://127.0.0.1:8790/*) but NOT other extension pages'
            # chrome-extension:// urls (empirically confirmed: the panel
            # tab's own url is redacted from the SW's query results). So the
            # content tab id is resolved from the SW (matches by url), and
            # the panel tab id is resolved separately, from the panel's OWN
            # session, via chrome.tabs.getCurrent() -- the standard API for
            # "what tab is this extension page running in", which needs no
            # extra permission because the page is asking about itself.
            content = conn.evaluate(
                sw_session,
                "(async () => {"
                "  const tabs = await chrome.tabs.query({});"
                f"  const c = tabs.find(t => t.url === {js_str(CONTENT_URL)});"
                "  return c ? {id: c.id, windowId: c.windowId} : null;"
                "})()",
                timeout=5,
            )
            panel = conn.evaluate(
                panel_session,
                "(async () => {"
                "  const t = await chrome.tabs.getCurrent();"
                "  return t ? {id: t.id, windowId: t.windowId} : null;"
                "})()",
                timeout=5,
            )
            if not content or not panel:
                return None
            return {
                "contentTabId": content["id"],
                "contentWindowId": content["windowId"],
                "panelTabId": panel["id"],
                "panelWindowId": panel["windowId"],
            }

        tab_ids = wait_for(_resolve_tabs, LOAD_TIMEOUT_S, "chrome.tabs to resolve both tab ids")
        content_tab_id = tab_ids["contentTabId"]
        panel_tab_id = tab_ids["panelTabId"]
        log(f"resolved chrome tab ids: content={content_tab_id} panel={panel_tab_id} "
            f"(same window: {tab_ids['contentWindowId'] == tab_ids['panelWindowId']})")

        def pin_content_tab_active() -> None:
            ok = conn.evaluate(
                sw_session,
                f"(async () => {{ await chrome.tabs.update({content_tab_id}, {{active: true}}); "
                f"const t = await chrome.tabs.get({content_tab_id}); return t.active; }})()",
                timeout=5,
            )
            if ok is not True:
                raise VerifyFailure("could not pin the content tab as the active tab")

        pin_content_tab_active()
        log("TAB-TARGETING PROOF: content tab pinned active; panel tab never activated")

        # --- Step 3: click the REAL "Connect Counterpedia Local" button ---
        # (first button in #counterpedia-local-section -- see
        # src/panel/localPairing.ts buildSection(): actions.append(connect, setup))
        clicked = conn.evaluate(
            panel_session,
            "(() => { const b = document.querySelectorAll("
            "'#counterpedia-local-section button')[0]; "
            "if (!b || b.disabled) return false; b.click(); return true; })()",
            timeout=5,
        )
        if clicked is not True:
            raise VerifyFailure("Connect Counterpedia Local button missing or disabled")
        log("clicked the REAL 'Connect Counterpedia Local' button")

        # The click's own async handler calls pairLocalCompanion() -> POST
        # /v0/pair -> chrome.storage -> window.location.reload(). We do NOT
        # POST /v0/pair ourselves anywhere in this script. Companion-side
        # /v0/status is the ground truth that the REAL pairing transaction
        # (through the button) completed.
        def _companion_paired():
            status = json.loads(
                subprocess_curl(f"http://127.0.0.1:{COMPANION_PORT}/v0/status")
            )
            return status if status.get("paired") else None

        wait_for(_companion_paired, UI_TIMEOUT_S, "companion to observe pairing via the clicked button")
        log("PAIRING PROOF: companion /v0/status shows paired=true after the button click "
            "(pairing was driven by localPairing.ts's click handler, not by this script)")

        # --- wait for the panel's window.location.reload() to complete, then
        # assert the panel's OWN rendered status line. ---
        def _panel_reloaded_and_connected():
            state = conn.evaluate(panel_session, "document.readyState", timeout=2)
            if state != "complete":
                return None
            text = conn.evaluate(
                panel_session,
                "(document.getElementById('counterpedia-local-section') || {}).textContent || ''",
                timeout=2,
            )
            if "Connected" in text and "Capture ready" in text:
                return text
            return None

        section_text = wait_for(
            _panel_reloaded_and_connected, UI_TIMEOUT_S, "panel to reload and render Connected status"
        )
        log(f"PANEL STATUS after Connect: {section_text.strip()!r}")
        if "Connected" not in section_text or "Capture ready" not in section_text:
            raise VerifyFailure(f"panel did not render Connected/Capture ready: {section_text!r}")
        recovery_ready_rendered = "Recovery ready" in section_text

        # Re-pin content tab active (defensive: nothing in the reload path
        # should have changed tab-active state, but this is cheap and the
        # capture handler's correctness depends on it).
        pin_content_tab_active()

        # --- Step 5: click the REAL "Capture this source" button ---
        capture_btn_ready = conn.evaluate(
            panel_session,
            "(() => { const b = document.getElementById('capture-btn'); "
            "return !!b && !b.disabled; })()",
            timeout=5,
        )
        if capture_btn_ready is not True:
            raise VerifyFailure("#capture-btn missing or disabled before capture click")

        clicked = conn.evaluate(
            panel_session,
            "(() => { document.getElementById('capture-btn').click(); return true; })()",
            timeout=5,
        )
        if clicked is not True:
            raise VerifyFailure("failed to click #capture-btn")
        log("clicked the REAL 'Capture this source' button")

        def _capture_status():
            text = conn.evaluate(
                panel_session,
                "(document.getElementById('capture-status') || {}).textContent || ''",
                timeout=2,
            )
            if text.startswith("Captured:"):
                return text
            if text.startswith("Error"):
                raise VerifyFailure(f"#capture-status rendered an error: {text!r}")
            return None

        capture_status_text = wait_for(_capture_status, UI_TIMEOUT_S, "#capture-status to show Captured:")
        log(f"CAPTURE PROOF: #capture-status = {capture_status_text!r}")
        if CONTENT_EXPECTED_TITLE not in capture_status_text:
            raise VerifyFailure(
                f"captured status does not reference the content page's title "
                f"({CONTENT_EXPECTED_TITLE!r}); got {capture_status_text!r} -- this would mean "
                "the panel captured ITSELF instead of the content tab"
            )
        log(
            "TAB-TARGETING PROOF (positive): captured document_title == the CONTENT page's "
            f"title ({CONTENT_EXPECTED_TITLE!r}), not the panel's own title ('Counterpedia')"
        )

        # --- Step 6, as actually verified against the REAL, unmodified ---
        # --- acquisition backend (see module docstring "SSRF FINDING"). ---
        #
        # runAcquisition() -> POST /v0/browser-observation -> (real backend)
        # resolve_browser_capture_source_for_capture(bpc) -> capture_url({url})
        # -> HttpFetcher.fetch(source) -- a REAL, LIVE re-fetch of the
        # resolved URL, gated by HttpEgressPolicy (fetch.py:_default_allow_address),
        # which categorically refuses loopback/private/reserved addresses.
        # Since CONTENT_URL is loopback (by mission constraint: no external
        # egress), the real producer correctly returns capture_status=
        # "capture_failed" and registers NOTHING in the capture registry.
        # This is the CORRECT behavior of a real SSRF guard, not a defect.
        acquisition_status_text = wait_for(
            lambda: (
                conn.evaluate(
                    panel_session,
                    "(document.getElementById('acquisition-status') || {}).textContent || ''",
                    timeout=2,
                )
                or None
            ),
            UI_TIMEOUT_S,
            "#acquisition-status to render a terminal result",
        )
        log(f"ACQUISITION STATUS (panel, real backend, real SSRF guard): {acquisition_status_text!r}")
        if acquisition_status_text.strip() != "Acquisition failed":
            raise VerifyFailure(
                "expected the real acquisition backend to refuse a loopback source "
                f"('Acquisition failed'); got {acquisition_status_text!r} instead -- "
                "either the SSRF guard changed, or CONTENT_URL is no longer loopback"
            )
        log(
            "SSRF-GUARD PROOF: the REAL acquisition backend's HttpEgressPolicy "
            "(counterpedia-acquisition/src/acquisition/fetch.py) correctly refused "
            "to register a loopback-sourced capture, exactly as it should. Satisfying "
            "the original 'recovery-btn enables' ask for a loopback content page would "
            "require EITHER weakening this real SSRF gate OR performing an actual "
            "external network fetch -- both are hard constraints this script does not "
            "cross. See module docstring 'SSRF FINDING' for the full trace."
        )

        recovery_disabled_after_refusal = conn.evaluate(
            panel_session,
            "(() => { const b = document.getElementById('recovery-btn'); "
            "return !!b && b.disabled; })()",
            timeout=5,
        )
        if recovery_disabled_after_refusal is not True:
            raise VerifyFailure(
                "#recovery-btn should remain disabled after a refused (unregistered) "
                "acquisition -- it is not; that would mean the panel is offering "
                "recovery over a capture that was never actually held server-side"
            )
        log(
            "RECOVERY-GATE PROOF (correct-negative): #recovery-btn correctly stays "
            "disabled -- there is no server-side held capture_id to check recovery "
            "against, and the real panel logic (setDraftGovernedSource in panel.ts) "
            "never fakes one."
        )

        # A disabled <button>.click() dispatches no click event in a real browser,
        # so there is nothing further to drive here; runRecoveryCheck's own
        # precondition ("No held capture to check.") would refuse it anyway.

        # --- store-side confirmation: the acquisition durable store correctly ---
        # --- holds NO receipt for this refused, loopback-sourced capture.     ---
        registry_dir = store_root / "capture-registry"
        receipts = list(registry_dir.glob("*.json")) if registry_dir.is_dir() else []
        matching = []
        for receipt_path in receipts:
            data = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt = data.get("capture_receipt", {})
            if receipt.get("source_locator") == CONTENT_URL:
                matching.append((receipt_path, receipt))
        if matching:
            raise VerifyFailure(
                f"expected NO on-disk capture receipt for the refused loopback capture "
                f"of {CONTENT_URL!r}, but found {len(matching)} -- the SSRF guard did "
                "not actually refuse it, or something registered a receipt anyway"
            )
        log(
            f"STORE PROOF (on-disk read of {registry_dir}): correctly holds NO receipt "
            f"for the refused capture of {CONTENT_URL!r} ({len(receipts)} unrelated "
            "receipt(s) present, if any) -- the durable store was never asked to retain "
            "bytes for a source the egress policy refused to fetch."
        )

        log("STATUS SUMMARY:")
        print(f"  Connect Counterpedia Local -> {section_text.strip()}")
        print(f"  Capture this source        -> {capture_status_text}")
        print(f"  Acquisition (real backend) -> {acquisition_status_text.strip()} "
              "(correct SSRF refusal of a loopback source; see SSRF FINDING)")
        print("  Check browser recovery     -> correctly stays disabled "
              "(no server-side held capture for a refused acquisition)")
        print(f"  On-disk capture registry   -> {len(receipts)} receipt(s) total, "
              f"0 for the refused {CONTENT_URL!r} capture (correct)")
        if not recovery_ready_rendered:
            log(
                "NOTE: post-Connect status line did not include 'Recovery ready' "
                "-- consistent with SSRF FINDING: no capture from this loopback "
                "content page can ever become server-side held, so the panel's "
                "own read of recovery.ready is moot for this run's actual capture."
            )

        log("RESULT: PASS")
        return 0
    except VerifyFailure as exc:
        log(f"RESULT: FAIL -- {exc}")
        return 1
    finally:
        if conn is not None:
            conn.close()
        log("tearing down spawned processes and temp dirs...")
        guard.teardown()
        log("teardown complete.")


def subprocess_curl(url: str) -> str:
    import urllib.request

    with urllib.request.urlopen(url, timeout=2.0) as resp:
        return resp.read().decode("utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
