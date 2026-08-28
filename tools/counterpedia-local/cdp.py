#!/usr/bin/env python3
"""Minimal, dependency-free Chrome DevTools Protocol (CDP) WebSocket client.

Stdlib-only (socket + base64 + hashlib + json) so SELF-LOAD0's UI
click-through verify does not need a third-party websocket package installed
on the Mac running the demo. Implements exactly what the verify needs:

  - the RFC 6455 client handshake + basic text-frame framing (including
    fragmented messages), masked as required for client-to-server frames;
  - a synchronous ``call(method, params, session_id)`` that sends a command
    and blocks (bounded) for its matching ``id`` response, queuing any
    interleaved CDP events so they are not lost;
  - ``Target.*`` / ``Runtime.evaluate`` / ``Input.dispatchMouseEvent``
    convenience wrappers used by the verify flow.

Not a general-purpose CDP client: no binary frames, no permessage-deflate,
no auto-reconnect. Sufficient for one bounded local automation session
against a Chrome-for-Testing instance this same process spawned.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import time
import urllib.request
from typing import Any
from urllib.parse import urlsplit

_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class CDPError(RuntimeError):
    pass


class CDPTimeout(CDPError):
    pass


def fetch_browser_ws_url(cdp_port: int, timeout: float = 5.0) -> str:
    """GET /json/version and return the browser-level webSocketDebuggerUrl."""
    with urllib.request.urlopen(
        f"http://127.0.0.1:{cdp_port}/json/version", timeout=timeout
    ) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    url = data.get("webSocketDebuggerUrl")
    if not isinstance(url, str) or not url:
        raise CDPError("no webSocketDebuggerUrl in /json/version response")
    return url


def list_targets(cdp_port: int, timeout: float = 5.0) -> list[dict[str, Any]]:
    with urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json", timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, list):
        raise CDPError("unexpected /json response shape")
    return data


class CDPConnection:
    """One WebSocket connection to a browser-level CDP endpoint.

    Uses the "flattened" session protocol: after ``Target.attachToTarget``
    with ``flatten=true``, all subsequent per-target commands are sent on
    this SAME connection with a top-level ``sessionId`` field, rather than
    opening a separate WebSocket per target.
    """

    def __init__(self, ws_url: str, connect_timeout: float = 10.0) -> None:
        self._next_id = 1
        self._pending_events: list[dict[str, Any]] = []
        self._leftover = b""
        self._sock = self._connect(ws_url, connect_timeout)

    # -- handshake -----------------------------------------------------

    def _connect(self, ws_url: str, connect_timeout: float) -> socket.socket:
        parts = urlsplit(ws_url)
        host = parts.hostname or "127.0.0.1"
        port = parts.port or 80
        path = parts.path or "/"
        if parts.query:
            path += f"?{parts.query}"

        sock = socket.create_connection((host, port), timeout=connect_timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        sock.sendall(request.encode("ascii"))

        response = b""
        sock.settimeout(connect_timeout)
        while b"\r\n\r\n" not in response:
            chunk = sock.recv(4096)
            if not chunk:
                raise CDPError("CDP handshake connection closed before headers completed")
            response += chunk
        header_blob, _, rest = response.partition(b"\r\n\r\n")
        status_line = header_blob.split(b"\r\n", 1)[0]
        if b"101" not in status_line:
            raise CDPError(f"CDP handshake refused: {status_line!r}")

        expected_accept = base64.b64encode(
            hashlib.sha1((key + _WS_GUID).encode("ascii")).digest()
        ).decode("ascii")
        headers = {}
        for line in header_blob.split(b"\r\n")[1:]:
            if b":" not in line:
                continue
            k, _, v = line.partition(b":")
            headers[k.strip().lower()] = v.strip()
        accept = headers.get(b"sec-websocket-accept", b"").decode("ascii")
        if accept != expected_accept:
            raise CDPError("CDP handshake Sec-WebSocket-Accept mismatch")

        # Any bytes after the header blob are the start of the first frame.
        sock.settimeout(None)
        self._leftover = rest
        return sock

    # -- framing ---------------------------------------------------------

    def _read_exact(self, n: int, deadline: float) -> bytes:
        buf = bytearray(self._leftover[:n])
        self._leftover = self._leftover[n:]
        while len(buf) < n:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CDPTimeout("timed out reading CDP frame")
            self._sock.settimeout(remaining)
            chunk = self._sock.recv(n - len(buf))
            if not chunk:
                raise CDPError("CDP connection closed unexpectedly")
            buf.extend(chunk)
        return bytes(buf)

    def _read_frame(self, timeout: float) -> tuple[int, bytes]:
        deadline = time.monotonic() + timeout
        header = self._read_exact(2, deadline)
        fin = (header[0] & 0x80) != 0
        opcode = header[0] & 0x0F
        masked = (header[1] & 0x80) != 0
        length = header[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._read_exact(2, deadline))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read_exact(8, deadline))[0]
        mask_key = self._read_exact(4, deadline) if masked else b""
        payload = self._read_exact(length, deadline)
        if masked:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        if not fin:
            _, rest = self._read_frame(deadline - time.monotonic())
            payload += rest
        return opcode, payload

    def _send_frame(self, payload: bytes, opcode: int = 0x1) -> None:
        mask_key = os.urandom(4)
        masked_payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        length = len(payload)
        header = bytearray()
        header.append(0x80 | opcode)  # FIN + opcode
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        header += mask_key
        self._sock.sendall(bytes(header) + masked_payload)

    # -- CDP protocol ------------------------------------------------------

    def send(self, method: str, params: dict[str, Any] | None = None, session_id: str | None = None) -> int:
        msg_id = self._next_id
        self._next_id += 1
        payload: dict[str, Any] = {"id": msg_id, "method": method, "params": params or {}}
        if session_id:
            payload["sessionId"] = session_id
        self._send_frame(json.dumps(payload).encode("utf-8"))
        return msg_id

    def _recv_message(self, timeout: float) -> dict[str, Any]:
        opcode, payload = self._read_frame(timeout)
        if opcode == 0x8:  # close
            raise CDPError("CDP connection closed by peer")
        if opcode not in (0x1, 0x0):
            raise CDPError(f"unexpected CDP websocket opcode {opcode}")
        return json.loads(payload.decode("utf-8"))

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        session_id: str | None = None,
        timeout: float = 10.0,
    ) -> dict[str, Any]:
        """Send a command and block for ITS matching response, queuing events."""
        msg_id = self.send(method, params, session_id)
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CDPTimeout(f"timed out waiting for response to {method} (id={msg_id})")
            msg = self._recv_message(remaining)
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise CDPError(f"{method} failed: {msg['error']}")
                return msg.get("result", {})
            # Not our response (an event, or a response to a different in-flight
            # call) -- queue it for anyone polling events, and keep waiting.
            self._pending_events.append(msg)

    def drain_events(self, method_filter: str | None = None) -> list[dict[str, Any]]:
        """Return and clear queued events (optionally filtered by method)."""
        events, self._pending_events = self._pending_events, []
        if method_filter is None:
            return events
        keep = [e for e in events if e.get("method") != method_filter]
        matched = [e for e in events if e.get("method") == method_filter]
        self._pending_events = keep
        return matched

    def close(self) -> None:
        try:
            self._send_frame(b"", opcode=0x8)
        except OSError:
            pass
        try:
            self._sock.close()
        except OSError:
            pass

    # -- convenience wrappers ---------------------------------------------

    def attach(self, target_id: str, timeout: float = 10.0) -> str:
        result = self.call(
            "Target.attachToTarget",
            {"targetId": target_id, "flatten": True},
            timeout=timeout,
        )
        session_id = result.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            raise CDPError(f"Target.attachToTarget returned no sessionId for {target_id}")
        # Runtime.enable ensures a default execution context actually exists
        # before the caller's first Runtime.evaluate (a target created a
        # moment ago may not have one yet). Page.enable only exists on
        # page-like targets (not service workers), so it is best-effort.
        self.call("Runtime.enable", {}, session_id=session_id, timeout=timeout)
        try:
            self.call("Page.enable", {}, session_id=session_id, timeout=timeout)
        except CDPError:
            pass
        return session_id

    def create_target(self, url: str, timeout: float = 10.0) -> str:
        result = self.call("Target.createTarget", {"url": url}, timeout=timeout)
        target_id = result.get("targetId")
        if not isinstance(target_id, str) or not target_id:
            raise CDPError("Target.createTarget returned no targetId")
        return target_id

    def evaluate(
        self,
        session_id: str,
        expression: str,
        *,
        await_promise: bool = True,
        timeout: float = 15.0,
    ) -> Any:
        """Evaluate JS in a target's session; returns the (JSON-serializable) value.

        Raises CDPError if the expression throws or produces a JS exception.
        """
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": True,
            },
            session_id=session_id,
            timeout=timeout,
        )
        if result.get("exceptionDetails"):
            raise CDPError(f"JS exception: {result['exceptionDetails']}")
        return result.get("result", {}).get("value")
