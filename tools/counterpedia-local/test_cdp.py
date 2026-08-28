#!/usr/bin/env python3
"""Unit tests for the pure/stdlib-only framing logic in cdp.py.

Does not open a real socket or browser -- exercises the WebSocket frame
encode/decode round-trip and the handshake accept-key computation directly,
which is what a real CDP session depends on being byte-correct.

Run: python3 tools/counterpedia-local/test_cdp.py -v
"""
from __future__ import annotations

import base64
import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdp  # noqa: E402


class _FakeConn(cdp.CDPConnection):
    """A CDPConnection with no real socket -- just enough state for framing tests."""

    def __init__(self) -> None:  # noqa: super-init-not-called -- intentional, no socket
        self._next_id = 1
        self._pending_events = []
        self._leftover = b""


class FrameRoundTripTests(unittest.TestCase):
    def test_small_frame_round_trips(self) -> None:
        conn = _FakeConn()
        payload = b'{"id": 1, "method": "Target.getTargets"}'
        # Build the exact bytes _send_frame would put on the wire, then feed
        # them back through the (unmasked, server->client) read path.
        header = bytearray()
        header.append(0x80 | 0x1)
        header.append(len(payload))  # < 126, no mask bit (server frames are unmasked)
        wire = bytes(header) + payload
        conn._leftover = wire
        opcode, decoded = conn._read_frame(timeout=1.0)
        self.assertEqual(opcode, 0x1)
        self.assertEqual(decoded, payload)

    def test_extended_length_16bit_frame_round_trips(self) -> None:
        conn = _FakeConn()
        payload = b"x" * 300  # > 125, triggers the 16-bit extended length path
        header = bytearray()
        header.append(0x80 | 0x1)
        header.append(126)
        header += len(payload).to_bytes(2, "big")
        wire = bytes(header) + payload
        conn._leftover = wire
        opcode, decoded = conn._read_frame(timeout=1.0)
        self.assertEqual(opcode, 0x1)
        self.assertEqual(decoded, payload)

    def test_fragmented_message_reassembles(self) -> None:
        conn = _FakeConn()
        part1, part2 = b'{"id": 1,', b' "result": {}}'
        frame1 = bytes([0x1, len(part1)]) + part1  # FIN=0, opcode=text
        frame2 = bytes([0x80, len(part2)]) + part2  # FIN=1, opcode=continuation(0)
        conn._leftover = frame1 + frame2
        opcode, decoded = conn._read_frame(timeout=1.0)
        self.assertEqual(opcode, 0x1)
        self.assertEqual(decoded, part1 + part2)

    def test_client_frame_is_masked_and_self_consistent(self) -> None:
        # _send_frame masks; verify the masking is a reversible XOR (the
        # server-side unmask logic in _read_frame is exercised above against
        # unmasked frames, since real CDP servers do not mask -- this test
        # instead checks the client's own masking doesn't corrupt payload
        # when unmasked with the same key it wrote).
        class _Capture:
            def __init__(self) -> None:
                self.sent = b""

            def sendall(self, data: bytes) -> None:
                self.sent += data

        conn = _FakeConn()
        conn._sock = _Capture()
        payload = b'{"id": 2, "method": "Runtime.evaluate"}'
        conn._send_frame(payload)
        wire = conn._sock.sent
        self.assertEqual(wire[0], 0x80 | 0x1)
        self.assertEqual(wire[1] & 0x80, 0x80)  # MASK bit set
        length = wire[1] & 0x7F
        mask_key = wire[2:6]
        masked_payload = wire[6 : 6 + length]
        unmasked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(masked_payload))
        self.assertEqual(unmasked, payload)


class HandshakeAcceptTests(unittest.TestCase):
    def test_known_rfc6455_example_vector(self) -> None:
        # The exact worked example from RFC 6455 section 1.3.
        key = "dGhlIHNhbXBsZSBub25jZQ=="
        expected_accept = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        computed = base64.b64encode(
            hashlib.sha1((key + cdp._WS_GUID).encode("ascii")).digest()
        ).decode("ascii")
        self.assertEqual(computed, expected_accept)


class ListTargetsAndFetchWsUrlTests(unittest.TestCase):
    def test_fetch_browser_ws_url_missing_field_raises(self) -> None:
        # No real HTTP server needed: exercise the error path directly by
        # monkeypatching urlopen would require network; instead confirm the
        # function raises CDPError for a response lacking the field, via a
        # minimal fake matching urllib's context-manager protocol.
        import io
        import json as _json
        import unittest.mock as mock

        class _FakeResp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        body = _json.dumps({"Browser": "Chrome/1.0"}).encode("utf-8")
        with mock.patch("urllib.request.urlopen", return_value=_FakeResp(body)):
            with self.assertRaises(cdp.CDPError):
                cdp.fetch_browser_ws_url(9999)


if __name__ == "__main__":
    unittest.main()
