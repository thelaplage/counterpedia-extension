"""
Test-only MCP stdio entry point for the extension's draft-from-source
(held-capture) E2E.

This is NOT part of counterpedia-acquisition and does not modify that repo.
It is spawned by the authoring producer's own real
``McpStdioAcquisitionToolTransport`` (counterpedia-authoring's
``acquisition/tool_client.py``) to resolve a historical ``capture_ref`` with
ZERO live network I/O, exactly the way a real deployment would spawn
``counterpedia-acquisition-mcp`` -- except this script builds the real
``AcquisitionMcpSurface`` directly (bypassing ``mcp_cli.py``'s CLI, whose
``--observer`` flag only offers ``none`` / ``openai``) so it can use the
SAME deterministic, offline, no-network model observer
(``DeterministicHtmlBackend`` + ``LlmModelObserver``) that
counterpedia-acquisition's OWN hermetic held-capture test suite uses --
see that repo's ``tests/test_http_transport_held_capture.py``,
``_deterministic_held_surface()``. Every class imported below is real,
unmodified production code from the acquisition checkout; only the choice
of observer backend (deterministic instead of a live LLM) makes this
hermetic.

The object store + capture registry are FILESYSTEM-backed, rooted at the
SAME ``store_root`` the real ACQ1 HTTP server was launched with
(``CP_ACQUISITION_HTTP_STORE_ROOT``) -- so a capture registered via a real
``POST /v0/browser-observation`` in that (separate) process is genuinely
resolvable here, in a THIRD, independently-spawned process, by
``capture_ref`` alone.

Usage: python acquisitionMcpStdioEntry.py <acquisition_src_dir> <store_root>
Serves over MCP stdio forever (this is exactly what a real deployment's
``counterpedia-acquisition-mcp`` stdio subprocess does).
"""

from __future__ import annotations

import asyncio
import os
import sys


def main() -> None:
    if len(sys.argv) < 3:
        print(
            "usage: acquisitionMcpStdioEntry.py <acquisition_src_dir> <store_root>",
            file=sys.stderr,
        )
        raise SystemExit(2)
    acquisition_src_dir = sys.argv[1]
    store_root = sys.argv[2]
    sys.path.insert(0, acquisition_src_dir)

    from acquisition.capture_registry import FilesystemCaptureReceiptRegistry
    from acquisition.deterministic_backend import DeterministicHtmlBackend
    from acquisition.fs_store import FilesystemObjectStore
    from acquisition.http_transport import CAPTURE_REGISTRY_DIR
    from acquisition.mcp_server import run_stdio
    from acquisition.mcp_surface import AcquisitionMcpSurface
    from acquisition.model_observer import LlmModelObserver

    store = FilesystemObjectStore(store_root)
    registry = FilesystemCaptureReceiptRegistry(
        os.path.join(store_root, CAPTURE_REGISTRY_DIR)
    )
    observer = LlmModelObserver(
        backend=DeterministicHtmlBackend(),
        observer_id="extension.e2e.held_capture.v0.1",
        observer_version="0.1.0",
    )
    surface = AcquisitionMcpSurface(store, observer=observer, capture_registry=registry)
    asyncio.run(run_stdio(surface))


if __name__ == "__main__":
    main()
