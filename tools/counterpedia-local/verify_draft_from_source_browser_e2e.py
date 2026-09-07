#!/usr/bin/env python3
"""DEMO-DRAFT-SOURCE0 browser-leg closure.

PR #73 proved the real four-service transaction (Acquisition -> Authoring
v0.5 -> Counterpedia reader -> extension preview) at the real-service,
real-wire-contract level, but its own honest terminal admitted ONE gap: the
"browser capture" input in `tests/draftFromSourceFourService.e2e.test.ts` is
a fixture-injected `BrowserPageCapture` object, not an actually-navigated
Chrome tab. This script closes exactly that gap and only that gap.

It reuses, unmodified:
  - the SAME sibling backend processes PR #73's own vitest four-service test
    spawns (`scripts/run_acquisition_http_test_fixture.py` from a fresh
    counterpedia-acquisition checkout; `tests/support/
    authorHttpSourceHermeticRunner.py` from this repo against a fresh
    counterpedia-authoring checkout; the real Counterpedia `npm run dev`
    reader route) -- run on the FIXED loopback ports already declared in
    `manifest.authoring-dev.json`'s host_permissions (8787 acquisition, 8788
    authoring, 3000 Counterpedia reader), instead of the vitest test's
    ephemeral free ports, so the REAL, already-built extension's declared
    host_permissions match without any manifest edit;
  - this repo's existing Chrome-for-Testing CDP harness primitives
    (`cdp.py`, `demo_browser.py`, `ProcessGuard`/`wait_for`/
    `ensure_dist_built`/`compute_expected_extension_id` from
    `verify_self_load_e2e.py`), the same primitives
    `verify_ui_click_through_e2e.py` and `verify_scanner_check_handoff_e2e.py`
    already use for real CDP-driven click-through proofs in this repo.

What is DELIBERATELY new, and why:
  - `chrome.storage.sync`/`chrome.storage.session` are written directly (via
    a real CDP `Runtime.evaluate` call in the service worker's own session --
    an ordinary chrome.storage write, not a fabricated network response) with
    the base URLs/tokens for the fixture backends above, INSTEAD OF driving
    the "Connect Counterpedia Local" pairing button. The local pairing
    companion (`counterpedia_local_operator.py` / `counterpedia_local.py`)
    launches a *live-source* Authoring process that needs a real
    `OPENAI_API_KEY`, and pairs against the *live* acquisition/authoring
    ports (8787 is shared, but authoring pairing there launches
    `counterpedia-authoring-live-source`, not the hermetic deterministic
    fixture PR #73's own gate used). Reusing the ALREADY-proven hermetic
    fixture backends (rather than switching to the live-source stack, which
    would silently widen scope and require a credential this environment may
    not have) was judged the more faithful, byte-honest continuation of PR
    #73's own proof -- this is disclosed, not hidden.
  - the fixture "source" content page is served on `127.0.0.1:8790` (the
    local-companion port already present in the manifest's
    `host_permissions`) purely as a already-declared loopback origin the
    unmodified manifest already allows the extension to read `tab.url` for
    (see `verify_ui_click_through_e2e.py`'s "PERMISSION FINDING" docstring
    for why an unpermitted origin would make `handleCapturePage` return
    `no_active_tab` even over a real CDP click). No local-companion process
    actually runs; port 8790 here is just an already-whitelisted loopback
    slot serving a static HTML fixture.

This script performs no admission, publication, or verification. It proves,
end to end, over a real Chrome-for-Testing tab: real navigation to the real
fixture source page, a real click on the real `#capture-btn`, a real fill of
the real draft-from-source form, a real click on the real
`#authoring-draft-btn`, and the real resulting `authoring-status`/preview DOM
-- with a screenshot at each step.

Usage:
  COUNTERPEDIA_ACQUISITION_DIR=~/Developer/repos/counterpedia-acquisition \
  COUNTERPEDIA_AUTHORING_DIR=~/Developer/repos/counterpedia-authoring \
  COUNTERPEDIA_AUTHORING_PYTHON=~/Developer/repos/counterpedia-authoring/.venv/bin/python \
  COUNTERPEDIA_DIR=~/Developer/repos/counterpedia \
  RUN_DIR=/tmp/demo-draft-source0-browser-run \
  python3 tools/counterpedia-local/verify_draft_from_source_browser_e2e.py
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread

HERE = Path(__file__).resolve().parent
EXT_ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import cdp  # noqa: E402
import demo_browser as db  # noqa: E402
from verify_self_load_e2e import (  # noqa: E402
    ProcessGuard,
    VerifyFailure,
    ensure_dist_built,
    log,
    wait_for,
    DIST_DIR,
)


def compute_expected_extension_id_from_dist_manifest() -> str:
    """Compute the extension id from the BUILT dist/manifest.json's own
    public "key" field -- i.e. from manifest.authoring-dev.json (copied
    verbatim into dist/ by `npm run build:authoring-dev`), not from
    verify_self_load_e2e.py's separate `.self-load-key.pem` (a different,
    gitignored SELF-LOAD demo key not required by this script). This is the
    same Chrome id-derivation algorithm `demo_browser.compute_stable_extension_id`
    implements, applied directly to the manifest's own committed public key
    (manifest.authoring-dev.json documents the expected result inline:
    `pplkafbhcmojbomkbieppifcfokpmhpn`)."""
    manifest = json.loads((DIST_DIR / "manifest.json").read_text(encoding="utf-8"))
    der = base64.b64decode(manifest["key"])
    return db.compute_stable_extension_id(der)

CDP_PORT = 9931
ACQ_PORT = 8787
AUTH_PORT = 8788
CP_PORT = 3000
SOURCE_PORT = 8790  # already host-permitted loopback slot (local-companion)

ACQ_TOKEN = "browser-e2e-acquisition-transport-token-0123456789"
AUTH_TOKEN = "browser-e2e-authoring-transport-token-0123456789"

SOURCE_FIXTURE_MARKER = "Real-navigation Portland Head Light fixture bytes for DEMO-DRAFT-SOURCE0."
# Deliberately field-free HTML -- no <title>/<h1>/<meta description>/lang
# attribute -- mirroring tests/draftFromSourceFourService.e2e.test.ts's own
# FIXTURE_BYTES exactly. counterpedia-acquisition's DeterministicHtmlBackend
# (src/acquisition/deterministic_backend.py) extracts proposal fields from
# those exact tags; a *richer* fixture page would deterministically allocate
# a second evidence handle (evidence:E002) that the operator's claim material
# below does not cover, and the real backend's completeness gate correctly
# refuses that (`completeness_refused`) -- this was reproduced once during
# this run's own development, not a defect. Keeping the fixture field-free is
# what PR #73's own vitest fixture already established as the load-bearing
# choice for this exact wire contract.
SOURCE_HTML = f"<html><body>{SOURCE_FIXTURE_MARKER}</body></html>".encode("utf-8")


def sha256_hex_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_hex_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def http_get(url: str, timeout: float = 2.0) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


class _SourceFixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence default stderr logging
        return

    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(SOURCE_HTML)))
        self.end_headers()
        self.wfile.write(SOURCE_HTML)


def start_source_fixture_server(guard: ProcessGuard) -> HTTPServer:
    server = HTTPServer(("127.0.0.1", SOURCE_PORT), _SourceFixtureHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    guard.temp_dirs  # no-op, kept for symmetry
    return server


def start_acquisition_fixture(
    guard: ProcessGuard, acquisition_dir: str, store_root: Path, expected_ext_id: str
) -> subprocess.Popen:
    env = os.environ.copy()
    env.update(
        {
            "CP_ACQUISITION_ALLOWED_ORIGIN": f"chrome-extension://{expected_ext_id}",
            "CP_ACQUISITION_TRANSPORT_TOKEN": ACQ_TOKEN,
            "CP_ACQUISITION_HTTP_HOST": "127.0.0.1",
            "CP_ACQUISITION_HTTP_PORT": str(ACQ_PORT),
            "CP_ACQUISITION_HTTP_STORE_ROOT": str(store_root),
        }
    )
    proc = guard.spawn(
        ["python3", str(Path(acquisition_dir) / "scripts" / "run_acquisition_http_test_fixture.py")],
        cwd=acquisition_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    wait_for(
        lambda: http_get(f"http://127.0.0.1:{ACQ_PORT}/healthz", timeout=0.5)[0] == 200 or None,
        20.0,
        "acquisition fixture /healthz",
    )
    return proc


def start_authoring_fixture(
    guard: ProcessGuard, authoring_dir: str, acquisition_dir: str, store_root: Path
) -> subprocess.Popen:
    env = os.environ.copy()
    env["COUNTERPEDIA_AUTHORING_DIR"] = authoring_dir
    log_path = Path(os.environ.get("RUN_DIR", tempfile.gettempdir())) / "authoring_fixture.log"
    log_handle = open(log_path, "w", encoding="utf-8")
    guard.temp_dirs  # keep symmetry; not tracked for deletion (debug artifact)
    proc = guard.spawn(
        [
            "python3",
            str(HERE / "browserDraftFromSourceHermeticRunner.py"),
            str(Path(acquisition_dir) / "src"),
            str(store_root),
            str(AUTH_PORT),
        ],
        cwd=authoring_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=log_handle,
        text=True,
        start_new_session=True,
    )

    stdout_acc = {"text": ""}

    def _bound_port():
        if proc.poll() is not None:
            raise VerifyFailure(f"authoring fixture exited early ({proc.returncode})")
        line = proc.stdout.readline() if proc.stdout else ""
        if line:
            stdout_acc["text"] += line
        if "PORT " in stdout_acc["text"]:
            return True
        return None

    wait_for(_bound_port, 20.0, "authoring fixture PORT line")
    wait_for(
        lambda: http_get(f"http://127.0.0.1:{AUTH_PORT}/healthz", timeout=0.5)[0] == 200 or None,
        15.0,
        "authoring fixture /healthz",
    )
    return proc


def start_counterpedia_dev(guard: ProcessGuard, counterpedia_dir: str) -> subprocess.Popen:
    proc = guard.spawn(
        ["npm", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", str(CP_PORT)],
        cwd=counterpedia_dir,
        env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )

    def _reachable():
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{CP_PORT}/api/counterpedia/reader/proposal",
                data=b"{}",
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=1.0)
            return True
        except urllib.error.HTTPError as exc:
            return exc.code > 0 or None
        except OSError:
            return None

    wait_for(_reachable, 45.0, "Counterpedia reader route reachable")
    return proc


def screenshot(conn: cdp.CDPConnection, session_id: str, run_dir: Path, name: str) -> Path:
    result = conn.call("Page.captureScreenshot", {"format": "png"}, session_id=session_id, timeout=15.0)
    data = base64.b64decode(result["data"])
    path = run_dir / f"{name}.png"
    path.write_bytes(data)
    log(f"screenshot: {path} ({len(data)} bytes, sha256={sha256_hex_bytes(data)[:16]}...)")
    return path


def main() -> int:
    acquisition_dir = os.environ.get("COUNTERPEDIA_ACQUISITION_DIR")
    authoring_dir = os.environ.get("COUNTERPEDIA_AUTHORING_DIR")
    counterpedia_dir = os.environ.get("COUNTERPEDIA_DIR")
    run_dir = Path(os.environ.get("RUN_DIR", tempfile.mkdtemp(prefix="demo-draft-source0-browser-")))
    run_dir.mkdir(parents=True, exist_ok=True)

    missing = [
        name
        for name, value in (
            ("COUNTERPEDIA_ACQUISITION_DIR", acquisition_dir),
            ("COUNTERPEDIA_AUTHORING_DIR", authoring_dir),
            ("COUNTERPEDIA_DIR", counterpedia_dir),
        )
        if not value
    ]
    if missing:
        print(f"error: missing required env vars: {', '.join(missing)}", file=sys.stderr)
        return 2

    guard = ProcessGuard()
    conn: cdp.CDPConnection | None = None
    packet: dict = {
        "run_started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "run_dir": str(run_dir),
        "steps": [],
    }

    try:
        ensure_dist_built()
        expected_id = compute_expected_extension_id_from_dist_manifest()
        log(f"expected extension id: {expected_id}")

        dist_manifest_digest = sha256_hex_file(DIST_DIR / "manifest.json")
        packet["extension"] = {
            "expected_id": expected_id,
            "dist_manifest_sha256": dist_manifest_digest,
            "heads": {
                "extension": subprocess.check_output(
                    ["git", "-C", str(EXT_ROOT), "rev-parse", "HEAD"], text=True
                ).strip(),
                "acquisition": subprocess.check_output(
                    ["git", "-C", acquisition_dir, "rev-parse", "HEAD"], text=True
                ).strip(),
                "authoring": subprocess.check_output(
                    ["git", "-C", authoring_dir, "rev-parse", "HEAD"], text=True
                ).strip(),
                "counterpedia": subprocess.check_output(
                    ["git", "-C", counterpedia_dir, "rev-parse", "HEAD"], text=True
                ).strip(),
            },
        }

        store_root = guard.track_dir(Path(tempfile.mkdtemp(prefix="demo-draft-source0-store-")))

        start_source_fixture_server(guard)
        log(f"source fixture page serving on http://127.0.0.1:{SOURCE_PORT}/")

        start_acquisition_fixture(guard, acquisition_dir, store_root, expected_id)
        log(f"acquisition fixture healthy on :{ACQ_PORT}")

        start_authoring_fixture(guard, authoring_dir, acquisition_dir, store_root)
        log(f"authoring fixture healthy on :{AUTH_PORT}")

        start_counterpedia_dev(guard, counterpedia_dir)
        log(f"Counterpedia reader route reachable on :{CP_PORT}")

        browser_path = db.resolve_demo_browser()
        log(f"resolved Chrome-for-Testing binary: {browser_path}")
        packet["browser"] = {"binary": str(browser_path)}

        profile_dir = guard.track_dir(Path(tempfile.mkdtemp(prefix="demo-draft-source0-profile-")))
        headless = os.environ.get("COUNTERPEDIA_VERIFY_HEADLESS", "").strip() == "1"
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
        log(f"launched Chrome-for-Testing ({'headless' if headless else 'headful'})")

        def _sw_target():
            for target in cdp.list_targets(CDP_PORT):
                if target.get("url", "") == f"chrome-extension://{expected_id}/background/service-worker.js":
                    return target["id"]
            return None

        sw_target_id = wait_for(_sw_target, 20.0, "extension service worker target")
        log(f"LOAD PROOF: service worker target present ({sw_target_id})")

        ws_url = wait_for(lambda: cdp.fetch_browser_ws_url(CDP_PORT), 10.0, "CDP browser endpoint")
        conn = cdp.CDPConnection(ws_url)
        sw_session = conn.attach(sw_target_id)

        # Configure the extension's real transport config via a real
        # chrome.storage write in the SW's own session -- see module
        # docstring for why the pairing button is not used here.
        storage_ok = conn.evaluate(
            sw_session,
            "(async () => {"
            "  await chrome.storage.sync.set({"
            f"    counterpedia_acquisition_base_url: 'http://127.0.0.1:{ACQ_PORT}',"
            f"    counterpedia_authoring_base_url: 'http://127.0.0.1:{AUTH_PORT}',"
            f"    counterpedia_authoring_token: {json.dumps(AUTH_TOKEN)}"
            "  });"
            "  await chrome.storage.session.set({"
            f"    counterpedia_acquisition_token: {json.dumps(ACQ_TOKEN)}"
            "  });"
            "  return true;"
            "})()",
            timeout=5,
        )
        if storage_ok is not True:
            raise VerifyFailure("could not write chrome.storage transport config")
        log("configured extension transport config via real chrome.storage write")

        content_url = f"http://127.0.0.1:{SOURCE_PORT}/"
        content_target_id = conn.create_target(content_url)
        content_session = conn.attach(content_target_id)

        def _content_loaded():
            state = conn.evaluate(content_session, "document.readyState", timeout=2)
            body_text = conn.evaluate(content_session, "document.body ? document.body.textContent : ''", timeout=2)
            return state == "complete" and SOURCE_FIXTURE_MARKER in (body_text or "")

        wait_for(_content_loaded, 15.0, "real navigation to the fixture source page")
        log(f"REAL NAVIGATION PROOF: Chrome navigated to {content_url}")
        packet["steps"].append({"step": "navigate", "url": content_url})
        screenshot(conn, content_session, run_dir, "01_content_before")

        panel_url = f"chrome-extension://{expected_id}/panel/index.html"
        panel_target_id = conn.create_target(panel_url)
        panel_session = conn.attach(panel_target_id)

        def _panel_loaded():
            state = conn.evaluate(panel_session, "document.readyState", timeout=2)
            has_ui = conn.evaluate(
                panel_session,
                "!!document.getElementById('capture-btn') && "
                "!!document.getElementById('authoring-draft-btn')",
                timeout=2,
            )
            return state == "complete" and has_ui

        wait_for(_panel_loaded, 15.0, "panel tab UI to load")
        log(f"panel tab loaded: {panel_url}")

        conn.evaluate(
            panel_session,
            "(() => {"
            "  window.__dbgLog = [];"
            "  const orig = window.fetch;"
            "  window.fetch = async (...args) => {"
            "    const res = await orig(...args);"
            "    const clone = res.clone();"
            "    let bodyText = '';"
            "    try { bodyText = await clone.text(); } catch (e) { bodyText = 'ERR:' + e; }"
            "    window.__dbgLog.push({url: String(args[0]), reqBody: (args[1] && args[1].body) || null, status: res.status, body: bodyText});"
            "    return res;"
            "  };"
            "  return true;"
            "})()",
            timeout=5,
        )

        # Resolve + pin the content tab active (host_permission match means
        # tab.url IS visible here -- see module docstring).
        tab_ids = wait_for(
            lambda: conn.evaluate(
                sw_session,
                "(async () => {"
                "  const tabs = await chrome.tabs.query({});"
                f"  const content = tabs.find(t => t.url === {json.dumps(content_url)});"
                "  const panel = await chrome.tabs.getCurrent ? null : null;"
                "  return content ? {contentId: content.id, contentWindowId: content.windowId} : null;"
                "})()",
                timeout=5,
            ),
            10.0,
            "chrome.tabs to resolve the content tab id",
        )
        content_tab_id = tab_ids["contentId"]

        def pin_active():
            ok = conn.evaluate(
                sw_session,
                f"(async () => {{ await chrome.tabs.update({content_tab_id}, {{active: true}}); "
                f"const t = await chrome.tabs.get({content_tab_id}); return t.active; }})()",
                timeout=5,
            )
            if ok is not True:
                raise VerifyFailure("could not pin the content tab as active")

        pin_active()
        log("TAB-TARGETING PROOF: content tab pinned active (host_permission-visible url match)")

        screenshot(conn, panel_session, run_dir, "02_panel_before_capture")

        capture_ready = conn.evaluate(
            panel_session,
            "(() => { const b = document.getElementById('capture-btn'); return !!b && !b.disabled; })()",
            timeout=5,
        )
        if capture_ready is not True:
            raise VerifyFailure("#capture-btn missing or disabled before click")

        clicked = conn.evaluate(
            panel_session,
            "(() => { document.getElementById('capture-btn').click(); return true; })()",
            timeout=5,
        )
        if clicked is not True:
            raise VerifyFailure("failed to click #capture-btn")
        log("REAL CLICK: #capture-btn")

        def _read_capture_status():
            text = conn.evaluate(
                panel_session,
                "(document.getElementById('capture-status') || {}).textContent || ''",
                timeout=2,
            )
            if text and text != "Capturing…":
                return text
            return None

        capture_status_text = wait_for(_read_capture_status, 20.0, "#capture-status to reach a terminal state")
        log(f"CAPTURE STATUS (real panel UI): {capture_status_text!r}")
        packet["steps"].append({"step": "capture_click", "capture_status": capture_status_text})
        conn.evaluate(
            panel_session,
            "(() => { const el = document.getElementById('capture-status'); "
            "if (el) el.scrollIntoView({block: 'center'}); return true; })()",
            timeout=5,
        )
        screenshot(conn, panel_session, run_dir, "03_panel_after_capture")

        if content_url not in capture_status_text:
            raise VerifyFailure(
                f"capture-status does not reference the real content page url "
                f"(no <title>, so the client falls back to current_url); got {capture_status_text!r}"
            )

        acquisition_status_text = wait_for(
            lambda: (
                conn.evaluate(
                    panel_session,
                    "(document.getElementById('acquisition-status') || {}).textContent || ''",
                    timeout=2,
                )
                or None
            ),
            20.0,
            "#acquisition-status to render a terminal result",
        )
        log(f"ACQUISITION STATUS (real backend fixture): {acquisition_status_text!r}")
        packet["steps"].append({"step": "acquisition", "acquisition_status": acquisition_status_text})

        # Fill the real draft-from-source form.
        fill_ok = conn.evaluate(
            panel_session,
            "(() => {"
            "  const subj = document.getElementById('authoring-subject');"
            "  const claim = document.getElementById('authoring-claim-text');"
            "  const evid = document.getElementById('authoring-evidence');"
            "  if (!subj || !claim || !evid) return false;"
            "  subj.value = 'Portland Head Light';"
            "  subj.dispatchEvent(new Event('input', {bubbles: true}));"
            "  claim.value = 'The subject is known as Portland Head Light.';"
            "  claim.dispatchEvent(new Event('input', {bubbles: true}));"
            "  evid.value = 'evidence:E001';"
            "  evid.dispatchEvent(new Event('input', {bubbles: true}));"
            "  return true;"
            "})()",
            timeout=5,
        )
        if fill_ok is not True:
            raise VerifyFailure("could not fill the real draft-from-source form fields")
        log("REAL FORM FILL: subject/claim/evidence fields")

        draft_ready = wait_for(
            lambda: (
                conn.evaluate(
                    panel_session,
                    "(() => { const b = document.getElementById('authoring-draft-btn'); "
                    "return !!b && !b.disabled; })()",
                    timeout=2,
                )
                or None
            ),
            10.0,
            "#authoring-draft-btn to become enabled after capture",
        )
        conn.evaluate(
            panel_session,
            "(() => { const el = document.getElementById('authoring-draft-btn'); "
            "if (el) el.scrollIntoView({block: 'center'}); return true; })()",
            timeout=5,
        )
        screenshot(conn, panel_session, run_dir, "04_panel_before_draft")

        clicked_draft = conn.evaluate(
            panel_session,
            "(() => { document.getElementById('authoring-draft-btn').click(); return true; })()",
            timeout=5,
        )
        if clicked_draft is not True:
            raise VerifyFailure("failed to click #authoring-draft-btn")
        log("REAL CLICK: #authoring-draft-btn")

        def _draft_terminal():
            text = conn.evaluate(
                panel_session,
                "(document.getElementById('authoring-status-label') || {}).textContent || ''",
                timeout=2,
            )
            if text and "Drafting" not in text and "Pending" not in text:
                return text
            return None

        draft_label_text = wait_for(_draft_terminal, 30.0, "#authoring-status-label to reach a terminal state")
        draft_digest_text = conn.evaluate(
            panel_session,
            "(document.getElementById('authoring-status-digest') || {}).textContent || ''",
            timeout=2,
        )
        draft_admission_text = conn.evaluate(
            panel_session,
            "(document.getElementById('authoring-status-admission') || {}).textContent || ''",
            timeout=2,
        )
        preview_title_text = conn.evaluate(
            panel_session,
            "(document.querySelector('.authoring-preview-title') || {}).textContent || ''",
            timeout=2,
        )
        log(f"AUTHORING STATUS (real panel UI): label={draft_label_text!r} admission={draft_admission_text!r}")
        log(f"AUTHORING DIGEST (real panel UI): {draft_digest_text!r}")
        log(f"PROPOSAL PREVIEW TITLE (real panel UI): {preview_title_text!r}")

        dbg_log = conn.evaluate(panel_session, "window.__dbgLog || []", timeout=5)
        for entry in dbg_log:
            log(
                f"DEBUG FETCH: {entry.get('url')} status={entry.get('status')} "
                f"reqBody={(entry.get('reqBody') or '')[:2000]} body={entry.get('body')[:1500]}"
            )

        packet["steps"].append(
            {
                "step": "draft_from_source_click",
                "authoring_status_label": draft_label_text,
                "authoring_status_admission": draft_admission_text,
                "authoring_status_digest": draft_digest_text,
                "proposal_preview_title": preview_title_text,
            }
        )
        conn.evaluate(
            panel_session,
            "(() => { const el = document.getElementById('authoring-status'); "
            "if (el) el.scrollIntoView({block: 'start'}); return true; })()",
            timeout=5,
        )
        screenshot(conn, panel_session, run_dir, "05_panel_after_draft")
        screenshot(conn, content_session, run_dir, "06_content_after")

        packet["run_finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        draft_succeeded = (
            "Proposal assembled" in draft_label_text
            and draft_digest_text.startswith("Handoff: sha256:")
            and "Admission: not performed" in draft_admission_text
        )
        if not draft_succeeded:
            raise VerifyFailure(
                f"real browser-driven draft-from-source click did not reach a successful, "
                f"proposal-only terminal state: label={draft_label_text!r} "
                f"digest={draft_digest_text!r} admission={draft_admission_text!r}"
            )
        packet["result"] = "PASS"

        screenshots = sorted(run_dir.glob("*.png"))
        packet["screenshots"] = [
            {"path": str(p), "sha256": sha256_hex_file(p), "bytes": p.stat().st_size} for p in screenshots
        ]

        packet_path = run_dir / "provenance_packet.json"
        packet_path.write_text(json.dumps(packet, indent=2, sort_keys=True), encoding="utf-8")
        log(f"provenance packet written: {packet_path}")

        print(json.dumps(packet, indent=2, sort_keys=True))
        return 0
    except VerifyFailure as exc:
        log(f"RESULT: FAIL -- {exc}")
        packet["result"] = "FAIL"
        packet["error"] = str(exc)
        (run_dir / "provenance_packet.json").write_text(
            json.dumps(packet, indent=2, sort_keys=True, default=str), encoding="utf-8"
        )
        return 1
    finally:
        if conn is not None:
            conn.close()
        guard.teardown()


if __name__ == "__main__":
    raise SystemExit(main())
