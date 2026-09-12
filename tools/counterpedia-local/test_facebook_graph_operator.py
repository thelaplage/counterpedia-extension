#!/usr/bin/env python3
"""Hermetic pure-function tests for facebook_graph_operator.py.

No browser, network, Facebook session, or Acquisition checkout is used.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).parent


class _StubCDPConnection:
    pass


class _StubCDPError(RuntimeError):
    pass


stub = type(sys)("cdp")
stub.CDPConnection = _StubCDPConnection
stub.CDPError = _StubCDPError
stub.fetch_browser_ws_url = lambda port: "ws://127.0.0.1/"
stub.list_targets = lambda port: []
sys.modules["cdp"] = stub

spec = importlib.util.spec_from_file_location(
    "facebook_graph_operator", HERE / "facebook_graph_operator.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
assert spec.loader is not None
spec.loader.exec_module(module)


class FacebookGraphOperatorPureTests(unittest.TestCase):
    def test_graphql_url_is_exact_and_https(self) -> None:
        self.assertTrue(
            module._is_facebook_graphql_url(
                "https://www.facebook.com/api/graphql/"
            )
        )
        self.assertTrue(
            module._is_facebook_graphql_url("https://facebook.com/api/graphql/")
        )
        self.assertFalse(
            module._is_facebook_graphql_url("http://www.facebook.com/api/graphql/")
        )
        self.assertFalse(
            module._is_facebook_graphql_url("https://m.facebook.com/api/graphql/")
        )
        self.assertFalse(
            module._is_facebook_graphql_url("https://www.facebook.com/api/graphql")
        )

    def test_operator_page_allows_content_surface_and_blocks_sensitive_paths(self) -> None:
        module._assert_operator_page_allowed("https://www.facebook.com/Meta/")
        module._assert_operator_page_allowed(
            "https://www.facebook.com/groups/example/"
        )
        with self.assertRaises(module.OperatorError):
            module._assert_operator_page_allowed(
                "https://www.facebook.com/messages/t/123"
            )
        with self.assertRaises(module.OperatorError):
            module._assert_operator_page_allowed("https://example.com/")

    def test_request_parser_does_not_carry_session_fields(self) -> None:
        post_data = (
            "doc_id=12345&"
            "fb_api_req_friendly_name=CometFeedStoryQuery&"
            "variables=%7B%22id%22%3A%22abc%22%2C%22count%22%3A10%7D&"
            "fb_dtsg=SESSION_SECRET&lsd=SESSION_SECRET_2"
        )
        operation = module._parse_graphql_post_data(
            post_data,
            request_id="req-1",
            document_url="https://www.facebook.com/Meta/posts/1",
        )
        self.assertEqual(operation.doc_id, "12345")
        self.assertEqual(operation.friendly_name, "CometFeedStoryQuery")
        self.assertEqual(operation.variables, {"id": "abc", "count": 10})
        self.assertNotIn("SESSION_SECRET", repr(operation))
        self.assertNotIn("SESSION_SECRET_2", repr(operation))

    def test_request_parser_rejects_non_object_variables(self) -> None:
        with self.assertRaises(module.OperatorError):
            module._parse_graphql_post_data(
                "doc_id=1&variables=%5B1%2C2%5D",
                request_id="r",
                document_url="https://www.facebook.com/Meta/",
            )

    def test_response_body_bytes_are_strict(self) -> None:
        self.assertEqual(
            module._response_body_bytes('{"ok":true}', False), b'{"ok":true}'
        )
        self.assertEqual(module._response_body_bytes("e30=", True), b"{}")
        with self.assertRaises(module.OperatorError):
            module._response_body_bytes("%%%", True)

    def test_acquisition_pin_is_exact(self) -> None:
        self.assertEqual(
            module.FACEBOOK_GRAPH0_ACQUISITION_SHA,
            "c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb",
        )


if __name__ == "__main__":
    unittest.main()