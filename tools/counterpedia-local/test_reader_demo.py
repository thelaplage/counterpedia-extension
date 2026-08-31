from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

import reader_demo


class _CanonicalRefusalHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        if self.path != reader_demo.ROUTE:
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps({"error": {"code": "proposal_projection_refused"}}).encode()
        self.send_response(422)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class _GenericHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


def _serve(handler):
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def _make_reader_route(repo: Path) -> None:
    route = repo / reader_demo.ROUTE_RELATIVE_PATH
    route.parent.mkdir(parents=True, exist_ok=True)
    route.write_text("// test reader route\n", encoding="utf-8")


class ReaderProbeTests(unittest.TestCase):
    def test_probe_accepts_only_canonical_fail_closed_route(self):
        server, thread = _serve(_CanonicalRefusalHandler)
        try:
            url = f"http://127.0.0.1:{server.server_port}{reader_demo.ROUTE}"
            self.assertTrue(reader_demo.probe_reader(url=url))
        finally:
            server.shutdown()
            thread.join(timeout=2)

    def test_probe_rejects_generic_2xx_server(self):
        server, thread = _serve(_GenericHandler)
        try:
            url = f"http://127.0.0.1:{server.server_port}{reader_demo.ROUTE}"
            self.assertFalse(reader_demo.probe_reader(url=url))
        finally:
            server.shutdown()
            thread.join(timeout=2)


class ReaderCheckoutDiscoveryTests(unittest.TestCase):
    def test_explicit_env_override_always_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            explicit = Path(tmp) / "accepted"
            with mock.patch.dict(os.environ, {"COUNTERPEDIA_DIR": str(explicit)}, clear=False):
                self.assertEqual(reader_demo.default_counterpedia_dir(Path(tmp) / "extension"), explicit)

    def test_primary_checkout_wins_when_it_contains_reader_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ext_root = root / "counterpedia-extension"
            primary = root / "counterpedia"
            _make_reader_route(primary)
            with (
                mock.patch.dict(
                    os.environ,
                    {"COUNTERPEDIA_DIR": "", "COUNTERPEDIA_REPO_DIR": ""},
                    clear=False,
                ),
                mock.patch.object(reader_demo, "_linked_worktrees") as linked,
            ):
                selected = reader_demo.default_counterpedia_dir(ext_root)
            self.assertEqual(selected, primary)
            linked.assert_not_called()

    def test_single_reader_capable_linked_worktree_is_auto_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ext_root = root / "counterpedia-extension"
            primary = root / "counterpedia"
            primary.mkdir()
            reader_worktree = root / "worktrees" / "page12-reader"
            _make_reader_route(reader_worktree)
            with (
                mock.patch.dict(
                    os.environ,
                    {"COUNTERPEDIA_DIR": "", "COUNTERPEDIA_REPO_DIR": ""},
                    clear=False,
                ),
                mock.patch.object(
                    reader_demo,
                    "_linked_worktrees",
                    return_value=[primary, reader_worktree],
                ),
            ):
                selected = reader_demo.default_counterpedia_dir(ext_root)
            self.assertEqual(selected, reader_worktree.resolve())

    def test_multiple_reader_capable_worktrees_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ext_root = root / "counterpedia-extension"
            primary = root / "counterpedia"
            primary.mkdir()
            first = root / "worktrees" / "reader-a"
            second = root / "worktrees" / "reader-b"
            _make_reader_route(first)
            _make_reader_route(second)
            with (
                mock.patch.dict(
                    os.environ,
                    {"COUNTERPEDIA_DIR": "", "COUNTERPEDIA_REPO_DIR": ""},
                    clear=False,
                ),
                mock.patch.object(
                    reader_demo,
                    "_linked_worktrees",
                    return_value=[primary, first, second],
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "multiple Counterpedia worktrees"):
                    reader_demo.default_counterpedia_dir(ext_root)


class ReaderResetTests(unittest.TestCase):
    def test_reset_stops_only_matching_owned_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reader.json"
            reader_demo._write_state(4321, "expected-reader-command", Path(tmp), path=state_path)
            with (
                mock.patch.object(
                    reader_demo.reset_demo,
                    "get_live_commands",
                    return_value={4321: "node expected-reader-command"},
                ),
                mock.patch.object(reader_demo.reset_demo, "stop_owned_process") as stop,
            ):
                result = reader_demo.reset_reader(state_path)
            self.assertTrue(result["stopped"])
            stop.assert_called_once_with(4321)
            self.assertFalse(state_path.exists())

    def test_reset_refuses_foreign_pid_and_preserves_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "reader.json"
            reader_demo._write_state(4321, "expected-reader-command", Path(tmp), path=state_path)
            with (
                mock.patch.object(
                    reader_demo.reset_demo,
                    "get_live_commands",
                    return_value={4321: "totally unrelated process"},
                ),
                mock.patch.object(reader_demo.reset_demo, "stop_owned_process") as stop,
            ):
                result = reader_demo.reset_reader(state_path)
            self.assertEqual(result["status"], "foreign_signature_mismatch")
            self.assertFalse(result["stopped"])
            stop.assert_not_called()
            self.assertTrue(state_path.exists())


if __name__ == "__main__":
    unittest.main()
