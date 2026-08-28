#!/usr/bin/env python3
"""Hermetic unit tests for Counterpedia Local's COUNTERPEDIA-LOCAL-DEMO0 repair.

Covers: the primary repair (start_acquisition now launches the FROZEN
run_counterpedia_local_transport.py seam, never run_acquisition_http.py),
runtime discovery via COUNTERPEDIA_ACQUISITION_DIR / COUNTERPEDIA_ACQUISITION_PYTHON,
the atomic pairing transaction, the foreign-process guard, capability-based
readiness (never bare TCP/200), and the durable-store-survives-reconnect
invariant.

This suite spawns a small FAKE local acquisition transport (written to a
temp "acquisition checkout" per test) that implements exactly the FROZEN
GET /healthz contract (status + capabilities) plus a toy durable capture
store -- it does NOT import or modify anything under
/private/tmp/cplocalacq0 (the real, frozen A checkout), consistent with
"bind to it by env/path only."

Run: python3 tools/counterpedia-local/test_counterpedia_local.py -v
"""
from __future__ import annotations

import http.client
import json
import os
import stat
import sys
import tempfile
import textwrap
import threading
import time
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import counterpedia_local as cl  # noqa: E402

FAKE_TRANSPORT_SRC = textwrap.dedent(
    """
    import http.server, json, os, signal, sys, threading

    HOST = os.environ.get("CP_ACQUISITION_HTTP_HOST", "127.0.0.1")
    PORT = int(os.environ.get("CP_ACQUISITION_HTTP_PORT", "8787"))
    ORIGIN = os.environ.get("CP_ACQUISITION_ALLOWED_ORIGIN", "")
    TOKEN = os.environ.get("CP_ACQUISITION_TRANSPORT_TOKEN", "")
    STORE_ROOT = os.environ.get("CP_ACQUISITION_HTTP_STORE_ROOT")
    MODE = os.environ.get("FAKE_ACQ_MODE", "ready")

    if not ORIGIN or not TOKEN:
        print("error: missing required config", file=sys.stderr)
        sys.exit(2)
    if MODE == "crash":
        print("error: simulated construction failure", file=sys.stderr)
        sys.exit(2)

    CAPS = {
        "ready": {"browser_observation": True, "recovery_assessment": True},
        "no_capabilities": {"browser_observation": False, "recovery_assessment": False},
        "browser_only": {"browser_observation": True, "recovery_assessment": False},
    }.get(MODE, {"browser_observation": True, "recovery_assessment": True})

    store_file = os.path.join(STORE_ROOT, "fake_captures.json") if STORE_ROOT else None
    captures = []
    if store_file and os.path.exists(store_file):
        with open(store_file) as fh:
            captures = json.load(fh)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/healthz":
                self._json(
                    200,
                    {"status": "ok", "transport_schema": "fake.local_transport.v0", "capabilities": CAPS},
                )
                return
            if self.path == "/v0/captures":
                self._json(200, {"captures": captures})
                return
            self._json(404, {"error": "not_found"})

        def do_POST(self):
            if self.path == "/v0/browser-observation":
                length = int(self.headers.get("Content-Length", "0"))
                self.rfile.read(length)
                captures.append({"capture_id": "cap-%d" % (len(captures) + 1)})
                if store_file:
                    os.makedirs(STORE_ROOT, exist_ok=True)
                    with open(store_file, "w") as fh:
                        json.dump(captures, fh)
                self._json(200, {"captures": captures})
                return
            self._json(404, {"error": "not_found"})

    server = http.server.HTTPServer((HOST, PORT), Handler)

    def _shutdown(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)
    print("fake acquisition transport ready", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    """
)

EXTENSION_ID = "a" * 32


def write_fake_acquisition_checkout(root: Path) -> Path:
    """Writes a temp checkout with scripts/run_counterpedia_local_transport.py.

    Mirrors ONLY the file layout the FROZEN contract cares about -- this is
    not a copy of, and does not touch, the real accepted A checkout.
    """
    scripts = root / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    launcher = scripts / "run_counterpedia_local_transport.py"
    launcher.write_text(FAKE_TRANSPORT_SRC, encoding="utf-8")
    launcher.chmod(launcher.stat().st_mode | stat.S_IEXEC)
    return launcher


def wait_for_port_open(port: int, timeout_s: float = 3.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if cl.port_open(port):
            return
        time.sleep(0.02)
    raise AssertionError(f"port {port} never opened")


def wait_for_port_closed(port: int, timeout_s: float = 3.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not cl.port_open(port):
            return
        time.sleep(0.02)
    raise AssertionError(f"port {port} never closed")


class LocalSupervisorTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.acq_dir = self.tmp / "acq-checkout"
        write_fake_acquisition_checkout(self.acq_dir)
        self.authoring_dir = self.tmp / "authoring-checkout"
        self.authoring_dir.mkdir(parents=True, exist_ok=True)
        self.store_root = self.tmp / "store"

        # Runtime discovery: point Counterpedia Local at the fake checkout +
        # the CURRENT interpreter (no real venv needed), per the frozen
        # contract's env-only configuration.
        self._env_patch = {
            "COUNTERPEDIA_ACQUISITION_DIR": str(self.acq_dir),
            "COUNTERPEDIA_ACQUISITION_PYTHON": sys.executable,
        }
        self._old_env = {k: os.environ.get(k) for k in self._env_patch}
        os.environ.update(self._env_patch)
        os.environ.pop("FAKE_ACQ_MODE", None)

        self.supervisor = cl.LocalSupervisor(
            acquisition_dir=self.acq_dir,
            authoring_dir=self.authoring_dir,
            store_root=self.store_root,
            acquisition_ready_timeout_s=2.0,
        )
        cl.LOG_ROOT = self.tmp / "logs"

    def tearDown(self) -> None:
        self.supervisor.stop_all()
        wait_for_port_closed(cl.ACQUISITION_PORT)
        for key, old in self._old_env.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        os.environ.pop("FAKE_ACQ_MODE", None)
        self._tmp.cleanup()

    # -- 1/2: primary repair -------------------------------------------------

    def test_launcher_path_is_the_frozen_seam_not_run_acquisition_http(self) -> None:
        launcher = cl.acquisition_transport_launcher_path(self.acq_dir)
        self.assertEqual(launcher.name, "run_counterpedia_local_transport.py")
        self.assertNotEqual(launcher.name, "run_acquisition_http.py")

    def test_pair_actually_invokes_the_fake_frozen_transport(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        result = self.supervisor.pair(EXTENSION_ID)
        self.assertEqual(result["pairing_schema"], "counterpedia.local_pairing.v0.1")
        argv = self.supervisor.acquisition.process.args  # type: ignore[union-attr]
        self.assertTrue(str(argv[0]).endswith(sys.executable.rsplit("/", 1)[-1]) or argv[0] == sys.executable)
        self.assertTrue(str(argv[1]).endswith("run_counterpedia_local_transport.py"))
        self.assertNotIn("run_acquisition_http.py", " ".join(str(a) for a in argv))

    # -- runtime discovery ----------------------------------------------------

    def test_runtime_discovery_honors_explicit_python_override(self) -> None:
        acq_python = cl.default_acquisition_python(self.acq_dir)
        self.assertEqual(str(acq_python), sys.executable)

    def test_runtime_discovery_falls_back_to_checkout_venv(self) -> None:
        del os.environ["COUNTERPEDIA_ACQUISITION_PYTHON"]
        acq_python = cl.default_acquisition_python(self.acq_dir)
        self.assertEqual(acq_python, self.acq_dir / ".venv" / "bin" / "python")

    # -- 3/4: fresh token, exact origin ---------------------------------------

    def test_pair_generates_a_fresh_token(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        first = self.supervisor.pair(EXTENSION_ID)
        second = self.supervisor.pair(EXTENSION_ID)
        self.assertNotEqual(
            first["acquisition_transport_token"], second["acquisition_transport_token"]
        )

    def test_pair_binds_exact_extension_id_to_exact_origin(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        self.supervisor.pair(EXTENSION_ID)
        self.assertEqual(self.supervisor._paired_origin, f"chrome-extension://{EXTENSION_ID}")
        self.assertTrue(self.supervisor.is_paired_extension(EXTENSION_ID))
        self.assertFalse(self.supervisor.is_paired_extension("b" * 32))

    # -- 5: no durable token storage -------------------------------------------

    def test_pair_stores_no_token_durably_in_companion_config(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        result = self.supervisor.pair(EXTENSION_ID)
        token = result["acquisition_transport_token"]
        # Nothing this supervisor writes to disk (logs, store root) may
        # contain the raw token -- it crosses only via subprocess env.
        for path in [*self.store_root.rglob("*"), *cl.LOG_ROOT.rglob("*")]:
            if path.is_file():
                self.assertNotIn(token, path.read_text(encoding="utf-8", errors="ignore"))

    # -- 7: first connect with no prior config ---------------------------------

    def test_connect_works_with_no_prior_acquisition_config(self) -> None:
        self.assertIsNone(self.supervisor._paired_extension_id)
        os.environ["FAKE_ACQ_MODE"] = "ready"
        result = self.supervisor.pair(EXTENSION_ID)
        self.assertTrue(result["acquisition_transport_token"])

    # -- 8: reconnect rotates credential cleanly -------------------------------

    def test_reconnect_rotates_credential_and_leaves_one_child(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        first = self.supervisor.pair(EXTENSION_ID)
        first_pid = self.supervisor.acquisition.process.pid  # type: ignore[union-attr]
        second = self.supervisor.pair(EXTENSION_ID)
        second_pid = self.supervisor.acquisition.process.pid  # type: ignore[union-attr]
        self.assertNotEqual(first["acquisition_transport_token"], second["acquisition_transport_token"])
        self.assertNotEqual(first_pid, second_pid)
        self.assertTrue(self.supervisor.acquisition.running())

    # -- 9/10: capability-based readiness, not bare TCP/200 --------------------

    def test_acquisition_ready_reflects_browser_observation_capability(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        self.supervisor.pair(EXTENSION_ID)
        status = self.supervisor.status()
        self.assertTrue(status["acquisition"]["ready"])
        self.assertTrue(status["recovery"]["ready"])

    def test_readiness_is_false_before_any_pairing_even_if_port_closed(self) -> None:
        status = self.supervisor.status()
        self.assertFalse(status["acquisition"]["ready"])
        self.assertFalse(status["recovery"]["ready"])
        self.assertFalse(status["paired"])

    # -- 11/16: failed/incomplete child startup never renders falsely ready ----

    def test_atomic_pairing_never_returns_token_when_capabilities_incomplete(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "browser_only"
        with self.assertRaises(RuntimeError):
            self.supervisor.pair(EXTENSION_ID)
        status = self.supervisor.status()
        self.assertFalse(status["paired"])
        self.assertFalse(status["acquisition"]["ready"])
        self.assertFalse(status["recovery"]["ready"])

    def test_failed_child_construction_becomes_visible_not_falsely_ready(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "crash"
        with self.assertRaises(RuntimeError):
            self.supervisor.pair(EXTENSION_ID)
        status = self.supervisor.status()
        self.assertFalse(status["paired"])
        self.assertFalse(status["acquisition"]["ready"])
        self.assertFalse(status["recovery"]["ready"])

    def test_failed_reconnect_clears_previously_committed_pairing(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        self.supervisor.pair(EXTENSION_ID)
        self.assertTrue(self.supervisor.status()["paired"])

        os.environ["FAKE_ACQ_MODE"] = "crash"
        with self.assertRaises(RuntimeError):
            self.supervisor.pair(EXTENSION_ID)
        status = self.supervisor.status()
        self.assertFalse(status["paired"])
        self.assertFalse(status["acquisition"]["ready"])
        self.assertFalse(status["recovery"]["ready"])

    # -- 15: no new authority/admission semantics -------------------------------

    def test_pairing_result_asserts_no_authority(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        result = self.supervisor.pair(EXTENSION_ID)
        self.assertEqual(result["authority_posture"], "transport_configuration_only")
        self.assertEqual(result["admission"], "not_performed")

    # -- 17: foreign-process guard ----------------------------------------------

    def test_foreign_process_guard_refuses_to_kill_unowned_port(self) -> None:
        foreign_dir = write_fake_acquisition_checkout(self.tmp / "foreign")
        env = dict(os.environ)
        env["FAKE_ACQ_MODE"] = "ready"
        env["CP_ACQUISITION_ALLOWED_ORIGIN"] = "chrome-extension://" + ("z" * 32)
        env["CP_ACQUISITION_TRANSPORT_TOKEN"] = "foreign-owned-token"
        env["CP_ACQUISITION_HTTP_STORE_ROOT"] = str(self.tmp / "foreign-store")
        env["CP_ACQUISITION_HTTP_HOST"] = cl.HOST
        env["CP_ACQUISITION_HTTP_PORT"] = str(cl.ACQUISITION_PORT)
        import subprocess

        foreign_proc = subprocess.Popen(
            [sys.executable, str(foreign_dir)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            wait_for_port_open(cl.ACQUISITION_PORT)
            os.environ["FAKE_ACQ_MODE"] = "ready"
            with self.assertRaises(RuntimeError) as ctx:
                self.supervisor.pair(EXTENSION_ID)
            self.assertIn("did not start", str(ctx.exception))
            status = self.supervisor.status()
            self.assertFalse(status["paired"])
            # The foreign process must still be alive -- we never killed it.
            self.assertIsNone(foreign_proc.poll())
        finally:
            foreign_proc.terminate()
            try:
                foreign_proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                foreign_proc.kill()
                foreign_proc.wait(timeout=2)
            wait_for_port_closed(cl.ACQUISITION_PORT)

    # -- 18: durable store survives reconnect ------------------------------------

    def test_durable_store_survives_reconnect_credential_rotation(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "ready"
        self.supervisor.pair(EXTENSION_ID)
        base_url = f"http://{cl.HOST}:{cl.ACQUISITION_PORT}"
        req = urllib.request.Request(base_url + "/v0/browser-observation", data=b"{}", method="POST")
        urllib.request.urlopen(req, timeout=2).read()
        held = json.loads(urllib.request.urlopen(base_url + "/v0/captures", timeout=2).read())
        self.assertEqual(len(held["captures"]), 1)

        store_root_before = self.supervisor.store_root
        second = self.supervisor.pair(EXTENSION_ID)
        self.assertEqual(self.supervisor.store_root, store_root_before)

        held_after = json.loads(urllib.request.urlopen(base_url + "/v0/captures", timeout=2).read())
        self.assertEqual(len(held_after["captures"]), 1)
        self.assertEqual(held_after["captures"], held["captures"])
        self.assertTrue(second["acquisition_transport_token"])


class HandlerHttpTestCase(unittest.TestCase):
    """Exercises the real HTTP handler (origin/extension-id validation) end to end."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.acq_dir = self.tmp / "acq-checkout"
        write_fake_acquisition_checkout(self.acq_dir)
        self._old_env = {
            k: os.environ.get(k)
            for k in ("COUNTERPEDIA_ACQUISITION_DIR", "COUNTERPEDIA_ACQUISITION_PYTHON", "FAKE_ACQ_MODE")
        }
        os.environ["COUNTERPEDIA_ACQUISITION_DIR"] = str(self.acq_dir)
        os.environ["COUNTERPEDIA_ACQUISITION_PYTHON"] = sys.executable
        os.environ["FAKE_ACQ_MODE"] = "ready"
        cl.LOG_ROOT = self.tmp / "logs"

        supervisor = cl.LocalSupervisor(
            acquisition_dir=self.acq_dir,
            authoring_dir=self.tmp / "authoring",
            store_root=self.tmp / "store",
            acquisition_ready_timeout_s=2.0,
        )
        cl.Handler.supervisor = supervisor
        self.server = ThreadingHTTPServer((cl.HOST, 0), cl.Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        cl.Handler.supervisor.stop_all()
        wait_for_port_closed(cl.ACQUISITION_PORT)
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        for key, old in self._old_env.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self._tmp.cleanup()

    def _pair(self, origin: str, extension_id: str) -> http.client.HTTPResponse:
        conn = http.client.HTTPConnection(cl.HOST, self.port, timeout=5)
        body = json.dumps({"extension_id": extension_id})
        conn.request(
            "POST",
            "/v0/pair",
            body=body,
            headers={"Content-Type": "application/json", "Origin": origin},
        )
        return conn.getresponse()

    def test_mismatched_extension_id_and_origin_is_refused(self) -> None:
        origin = "chrome-extension://" + ("a" * 32)
        resp = self._pair(origin, "b" * 32)
        self.assertEqual(resp.status, 400)
        payload = json.loads(resp.read())
        self.assertEqual(payload["error"], "invalid_pair_request")

    def test_missing_origin_is_refused(self) -> None:
        conn = http.client.HTTPConnection(cl.HOST, self.port, timeout=5)
        conn.request(
            "POST",
            "/v0/pair",
            body=json.dumps({"extension_id": EXTENSION_ID}),
            headers={"Content-Type": "application/json"},
        )
        resp = conn.getresponse()
        self.assertEqual(resp.status, 403)

    def test_exact_match_pairs_successfully_and_returns_no_extra_fields(self) -> None:
        origin = "chrome-extension://" + EXTENSION_ID
        resp = self._pair(origin, EXTENSION_ID)
        self.assertEqual(resp.status, 200)
        payload = json.loads(resp.read())
        self.assertEqual(
            set(payload),
            {
                "pairing_schema",
                "acquisition_base_url",
                "authoring_base_url",
                "acquisition_transport_token",
                "authoring_transport_token",
                "authoring_ready",
                "authority_posture",
                "admission",
            },
        )
        # No human extension-id/token fields are echoed as configuration inputs
        # -- the only identity carried is the already-validated Origin's id.
        self.assertNotIn("extension_id", payload)

    def test_failed_pair_returns_503_and_no_token(self) -> None:
        os.environ["FAKE_ACQ_MODE"] = "crash"
        origin = "chrome-extension://" + EXTENSION_ID
        resp = self._pair(origin, EXTENSION_ID)
        self.assertEqual(resp.status, 503)
        payload = json.loads(resp.read())
        self.assertNotIn("acquisition_transport_token", payload)


if __name__ == "__main__":
    unittest.main()
