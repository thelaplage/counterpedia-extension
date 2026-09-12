#!/usr/bin/env python3
"""Hermetic tests for session_observe0.py.

No browser, network, or real CDP endpoint is used. The bounded capture loop
is exercised end-to-end against a fake connection with a scripted event
queue and an injected clock/sleeper, so the control flow (target selection,
matching, response retrieval, sink dispatch, bounded termination) is proven
without any real socket.

Run: python3 tools/counterpedia-local/test_session_observe0.py -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import session_observe0 as kernel  # noqa: E402


class _FakeConnection:
    """Stands in for cdp.CDPConnection.

    ``call`` returns canned results keyed by method; ``Runtime.evaluate``
    (the event pump) additionally advances a step counter so tests can
    script exactly which events "arrive" on which pump tick.
    """

    def __init__(self, script: list[list[dict[str, Any]]], call_results: dict[str, Any]):
        self._script = script
        self._call_results = call_results
        self._step = 0
        self.closed = False
        self.attached_target: str | None = None

    def attach(self, target_id: str, timeout: float = 10.0) -> str:
        self.attached_target = target_id
        return "session-1"

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        session_id: str | None = None,
        timeout: float = 10.0,
    ) -> dict[str, Any]:
        if method == "Runtime.evaluate":
            return {}
        if method == "Network.enable":
            return {}
        if method == "Network.getResponseBody":
            request_id = (params or {}).get("requestId")
            result = self._call_results.get(request_id)
            if result is None:
                raise kernel.CDPError(f"no scripted response body for {request_id}")
            return result
        raise AssertionError(f"unexpected CDP call: {method}")

    def drain_events(self) -> list[dict[str, Any]]:
        if self._step >= len(self._script):
            return []
        events = self._script[self._step]
        self._step += 1
        return events

    def close(self) -> None:
        self.closed = True


def _request_will_be_sent(request_id: str, url: str, document_url: str) -> dict[str, Any]:
    return {
        "method": "Network.requestWillBeSent",
        "params": {
            "requestId": request_id,
            "documentURL": document_url,
            "request": {"url": url, "method": "GET"},
        },
    }


def _loading_finished(request_id: str) -> dict[str, Any]:
    return {"method": "Network.loadingFinished", "params": {"requestId": request_id}}


def _make_clock(steps: list[float]) -> Any:
    state = {"i": 0}

    def clock() -> float:
        i = min(state["i"], len(steps) - 1)
        state["i"] += 1
        return steps[i]

    return clock


class CaptureLoopTests(unittest.TestCase):
    def test_matched_request_is_observed_and_sunk(self) -> None:
        conn = _FakeConnection(
            script=[
                [
                    _request_will_be_sent("r1", "https://example.test/api/x", "https://example.test/"),
                    _loading_finished("r1"),
                ],
                [],
            ],
            call_results={"r1": {"body": '{"ok":true}', "base64Encoded": False}},
        )
        sunk: list[kernel.ObservedExchange] = []

        def matcher(request: dict[str, Any], request_id: str, document_url: str):
            if "/api/" in request["url"]:
                return {"path": "/api/x"}
            return None

        summary = kernel.capture(
            cdp_port=9222,
            target_id="t1",
            duration=1.0,
            matcher=matcher,
            sink=sunk.append,
            connect=lambda ws_url: conn,
            list_targets_fn=lambda port: [{"id": "t1", "type": "page", "url": "https://example.test/"}],
            fetch_ws_url=lambda port: "ws://fake/",
            clock=_make_clock([0.0, 0.0, 2.0]),
            sleeper=lambda s: None,
        )

        self.assertEqual(summary.matched_request_count, 1)
        self.assertEqual(summary.observed_exchange_count, 1)
        self.assertEqual(summary.target_url, "https://example.test/")
        self.assertEqual(summary.authority_movement, 0)
        self.assertTrue(conn.closed)
        self.assertEqual(len(sunk), 1)
        self.assertEqual(sunk[0].match, {"path": "/api/x"})
        self.assertEqual(sunk[0].response_bytes, b'{"ok":true}')
        self.assertEqual(sunk[0].observed_page_url, "https://example.test/")

    def test_unmatched_request_never_reaches_sink(self) -> None:
        conn = _FakeConnection(
            script=[
                [
                    _request_will_be_sent("r1", "https://example.test/tracking.gif", "https://example.test/"),
                    _loading_finished("r1"),
                ],
                [],
            ],
            call_results={},
        )
        sunk: list[kernel.ObservedExchange] = []

        summary = kernel.capture(
            cdp_port=9222,
            target_id="t1",
            duration=1.0,
            matcher=lambda request, request_id, document_url: None,
            sink=sunk.append,
            connect=lambda ws_url: conn,
            list_targets_fn=lambda port: [{"id": "t1", "type": "page", "url": "https://example.test/"}],
            fetch_ws_url=lambda port: "ws://fake/",
            clock=_make_clock([0.0, 0.0, 2.0]),
            sleeper=lambda s: None,
        )

        self.assertEqual(summary.matched_request_count, 0)
        self.assertEqual(summary.observed_exchange_count, 0)
        self.assertEqual(sunk, [])

    def test_matcher_exception_is_treated_as_no_match(self) -> None:
        conn = _FakeConnection(
            script=[
                [
                    _request_will_be_sent("r1", "https://example.test/x", "https://example.test/"),
                    _loading_finished("r1"),
                ],
                [],
            ],
            call_results={},
        )
        sunk: list[kernel.ObservedExchange] = []

        def raising_matcher(request: dict[str, Any], request_id: str, document_url: str):
            raise ValueError("adapter bug")

        summary = kernel.capture(
            cdp_port=9222,
            target_id="t1",
            duration=1.0,
            matcher=raising_matcher,
            sink=sunk.append,
            connect=lambda ws_url: conn,
            list_targets_fn=lambda port: [{"id": "t1", "type": "page", "url": "https://example.test/"}],
            fetch_ws_url=lambda port: "ws://fake/",
            clock=_make_clock([0.0, 0.0, 2.0]),
            sleeper=lambda s: None,
        )
        self.assertEqual(summary.matched_request_count, 0)
        self.assertEqual(sunk, [])

    def test_base64_response_body_is_decoded(self) -> None:
        conn = _FakeConnection(
            script=[
                [
                    _request_will_be_sent("r1", "https://example.test/api/x", "https://example.test/"),
                    _loading_finished("r1"),
                ],
                [],
            ],
            call_results={"r1": {"body": "e30=", "base64Encoded": True}},
        )
        sunk: list[kernel.ObservedExchange] = []

        summary = kernel.capture(
            cdp_port=9222,
            target_id="t1",
            duration=1.0,
            matcher=lambda request, request_id, document_url: {"m": True},
            sink=sunk.append,
            connect=lambda ws_url: conn,
            list_targets_fn=lambda port: [{"id": "t1", "type": "page", "url": "https://example.test/"}],
            fetch_ws_url=lambda port: "ws://fake/",
            clock=_make_clock([0.0, 0.0, 2.0]),
            sleeper=lambda s: None,
        )
        self.assertEqual(summary.observed_exchange_count, 1)
        self.assertEqual(sunk[0].response_bytes, b"{}")
        self.assertTrue(sunk[0].response_base64_encoded)

    def test_target_validator_can_refuse_the_selected_target(self) -> None:
        conn = _FakeConnection(script=[[]], call_results={})

        def refuse_everything(target_url: str) -> None:
            raise kernel.SessionObserveError(f"refused: {target_url}")

        with self.assertRaises(kernel.SessionObserveError):
            kernel.capture(
                cdp_port=9222,
                target_id="t1",
                duration=1.0,
                matcher=lambda request, request_id, document_url: None,
                sink=lambda exchange: None,
                target_validator=refuse_everything,
                connect=lambda ws_url: conn,
                list_targets_fn=lambda port: [{"id": "t1", "type": "page", "url": "https://sensitive.test/"}],
                fetch_ws_url=lambda port: "ws://fake/",
                clock=_make_clock([0.0]),
                sleeper=lambda s: None,
            )
        # Refused before ever attaching -- no CDP session was opened.
        self.assertIsNone(conn.attached_target)

    def test_unknown_target_id_is_refused(self) -> None:
        with self.assertRaises(kernel.SessionObserveError):
            kernel.capture(
                cdp_port=9222,
                target_id="does-not-exist",
                duration=1.0,
                matcher=lambda request, request_id, document_url: None,
                sink=lambda exchange: None,
                connect=lambda ws_url: (_ for _ in ()).throw(AssertionError("should not connect")),
                list_targets_fn=lambda port: [{"id": "t1", "type": "page", "url": "https://example.test/"}],
                fetch_ws_url=lambda port: "ws://fake/",
                clock=_make_clock([0.0]),
                sleeper=lambda s: None,
            )

    def test_empty_target_id_is_refused_without_any_lookup(self) -> None:
        with self.assertRaises(kernel.SessionObserveError):
            kernel.capture(
                cdp_port=9222,
                target_id="",
                duration=1.0,
                matcher=lambda request, request_id, document_url: None,
                sink=lambda exchange: None,
                list_targets_fn=lambda port: (_ for _ in ()).throw(
                    AssertionError("should not list targets")
                ),
                clock=_make_clock([0.0]),
                sleeper=lambda s: None,
            )

    def test_non_positive_duration_is_refused(self) -> None:
        with self.assertRaises(kernel.SessionObserveError):
            kernel.capture(
                cdp_port=9222,
                target_id="t1",
                duration=0.0,
                matcher=lambda request, request_id, document_url: None,
                sink=lambda exchange: None,
            )

    def test_non_positive_poll_interval_is_refused(self) -> None:
        with self.assertRaises(kernel.SessionObserveError):
            kernel.capture(
                cdp_port=9222,
                target_id="t1",
                duration=1.0,
                poll_interval=0.0,
                matcher=lambda request, request_id, document_url: None,
                sink=lambda exchange: None,
            )


class PureHelperTests(unittest.TestCase):
    def test_response_body_bytes_plain(self) -> None:
        self.assertEqual(
            kernel.response_body_bytes('{"ok":true}', False), b'{"ok":true}'
        )

    def test_response_body_bytes_base64(self) -> None:
        self.assertEqual(kernel.response_body_bytes("e30=", True), b"{}")

    def test_response_body_bytes_strict_base64_rejects_garbage(self) -> None:
        with self.assertRaises(kernel.SessionObserveError):
            kernel.response_body_bytes("%%%", True)

    def test_list_page_targets_filters_non_page_types(self) -> None:
        rows = kernel.list_page_targets(
            9222,
            list_targets_fn=lambda port: [
                {"id": "a", "type": "page", "url": "https://a.test/"},
                {"id": "b", "type": "service_worker", "url": "https://b.test/sw.js"},
                {"id": "c", "type": "page", "url": "https://c.test/"},
            ],
        )
        self.assertEqual([r["id"] for r in rows], ["a", "c"])


if __name__ == "__main__":
    unittest.main()
