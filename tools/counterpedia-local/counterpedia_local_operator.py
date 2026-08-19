#!/usr/bin/env python3
"""Counterpedia Local OPERATOR-BROWSER0 additive wrapper.

Extends the existing team-beta local companion with exactly one explicit
operator-snapshot endpoint. All existing pairing/acquisition/authoring behavior is
inherited from counterpedia_local unchanged.

The endpoint accepts bounded MHTML bytes from the paired extension after an
explicit operator click and delegates storage/receipt creation to the producer-owned
`counterpedia-ingest-operator-snapshot` command. It performs no network fetch and
never fabricates a strict CaptureReceipt.
"""
from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import threading
from http.server import ThreadingHTTPServer
from typing import Any

import counterpedia_local as base

MAX_OPERATOR_SNAPSHOT_BYTES = 25 * 1024 * 1024
MAX_OPERATOR_REQUEST_BYTES = 36 * 1024 * 1024
MAX_OPERATOR_RESULT_BYTES = 1_000_000
_OPERATOR_RESULT_KEYS = {
    "tool",
    "result_schema",
    "status",
    "snapshot_ref",
    "captured_object_address",
    "byte_count",
    "expected_source_locator",
    "current_locator",
    "locator_continuity",
    "producer_capture_registry_written",
    "operator_snapshot_receipt",
    "boundary",
}


class OperatorLocalSupervisor(base.LocalSupervisor):
    def dependency_status(self) -> dict[str, Any]:
        status = super().dependency_status()
        cli = self.acquisition_dir / ".venv" / "bin" / "counterpedia-ingest-operator-snapshot"
        status["operator_snapshot_ingest_cli_present"] = cli.is_file()
        return status

    def ingest_operator_snapshot(self, data: dict[str, Any]) -> dict[str, Any]:
        expected_keys = {
            "snapshot_base64",
            "current_url",
            "expected_url",
            "captured_at",
            "media_type",
        }
        if set(data) != expected_keys:
            raise ValueError("operator snapshot request has unknown or missing fields")

        encoded = data.get("snapshot_base64")
        current_url = data.get("current_url")
        expected_url = data.get("expected_url")
        captured_at = data.get("captured_at")
        media_type = data.get("media_type")
        if not isinstance(encoded, str) or not encoded:
            raise ValueError("snapshot_base64 must be a non-empty string")
        if not isinstance(current_url, str) or not current_url:
            raise ValueError("current_url must be a non-empty string")
        if expected_url is not None and not isinstance(expected_url, str):
            raise ValueError("expected_url must be a string or null")
        if not isinstance(captured_at, str) or not captured_at:
            raise ValueError("captured_at must be a non-empty ISO timestamp string")
        if media_type != "multipart/related":
            raise ValueError("operator snapshot media_type must be multipart/related")

        try:
            snapshot_bytes = base64.b64decode(encoded, validate=True)
        except (ValueError, base64.binascii.Error) as exc:
            raise ValueError("snapshot_base64 is invalid") from exc
        if not snapshot_bytes or len(snapshot_bytes) > MAX_OPERATOR_SNAPSHOT_BYTES:
            raise ValueError("operator snapshot byte size refused")

        cli = self.acquisition_dir / ".venv" / "bin" / "counterpedia-ingest-operator-snapshot"
        if not cli.is_file():
            raise RuntimeError("operator snapshot ingest producer is not installed")

        command = [
            str(cli),
            "--store-root",
            str(self.store_root),
            "--current-url",
            current_url,
            "--captured-at",
            captured_at,
        ]
        if expected_url is not None:
            command.extend(["--expected-url", expected_url])

        try:
            completed = subprocess.run(
                command,
                cwd=self.acquisition_dir,
                env=os.environ.copy(),
                input=snapshot_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=45,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("operator snapshot ingest timed out") from exc
        except OSError as exc:
            raise RuntimeError("operator snapshot ingest producer could not start") from exc

        if completed.returncode != 0:
            raise RuntimeError("operator snapshot ingest producer failed")
        if not completed.stdout or len(completed.stdout) > MAX_OPERATOR_RESULT_BYTES:
            raise RuntimeError("operator snapshot ingest output size refused")
        try:
            payload = json.loads(completed.stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("operator snapshot ingest producer returned invalid JSON") from exc
        if not isinstance(payload, dict) or set(payload) != _OPERATOR_RESULT_KEYS:
            raise RuntimeError("operator snapshot ingest producer returned an unexpected shape")
        if payload.get("tool") != "acquisition.ingest_operator_browser_snapshot":
            raise RuntimeError("operator snapshot ingest producer returned an unexpected tool")
        if payload.get("result_schema") != "acquisition.operator_browser_snapshot_ingest_result.v0.1":
            raise RuntimeError("operator snapshot ingest producer returned an unexpected schema")
        if payload.get("status") != "snapshot_ingested":
            raise RuntimeError("operator snapshot ingest producer did not report snapshot_ingested")
        if payload.get("producer_capture_registry_written") is not False:
            raise RuntimeError("operator snapshot ingest crossed strict CaptureReceipt boundary")
        if payload.get("current_locator") != current_url:
            raise RuntimeError("operator snapshot ingest returned mismatched current locator")
        if payload.get("expected_source_locator") != expected_url:
            raise RuntimeError("operator snapshot ingest returned mismatched expected locator")

        receipt = payload.get("operator_snapshot_receipt")
        if not isinstance(receipt, dict):
            raise RuntimeError("operator snapshot ingest omitted its receipt")
        if receipt.get("snapshot_id") != payload.get("snapshot_ref"):
            raise RuntimeError("operator snapshot result has mismatched snapshot identity")
        if receipt.get("exact_bytes_sha256") != payload.get("captured_object_address"):
            raise RuntimeError("operator snapshot result has mismatched content address")
        if receipt.get("current_locator") != current_url or receipt.get("expected_source_locator") != expected_url:
            raise RuntimeError("operator snapshot receipt has mismatched locator provenance")
        if receipt.get("route") != "operator_browser_snapshot":
            raise RuntimeError("operator snapshot receipt has unexpected route")

        boundary = payload.get("boundary")
        if not isinstance(boundary, dict):
            raise RuntimeError("operator snapshot result omitted boundary")
        if boundary.get("network_access") != "not_performed" or boundary.get("http_capture_receipt") != "not_emitted":
            raise RuntimeError("operator snapshot producer crossed transport/capture boundary")
        for key in ("verification", "admission", "standing", "publication"):
            if boundary.get(key) != "not_performed":
                raise RuntimeError(f"operator snapshot producer crossed {key} boundary")
        return payload


class OperatorHandler(base.Handler):
    supervisor: OperatorLocalSupervisor

    def read_operator_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length < 2 or length > MAX_OPERATOR_REQUEST_BYTES:
            raise ValueError("operator snapshot request body size refused")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("operator snapshot request is invalid JSON") from exc
        if not isinstance(data, dict):
            raise ValueError("operator snapshot request must be a JSON object")
        return data

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v0/operator-snapshot":
            super().do_POST()
            return

        origin_id = self.extension_origin_id()
        if not self.supervisor.is_paired_extension(origin_id):
            self.send_json(403, {"error": "paired_extension_origin_required"})
            return
        try:
            result = self.supervisor.ingest_operator_snapshot(self.read_operator_json())
        except ValueError as exc:
            self.send_json(400, {"error": "invalid_operator_snapshot_request", "detail": str(exc)})
            return
        except RuntimeError as exc:
            self.send_json(503, {"error": "operator_snapshot_ingest_failed", "detail": str(exc)})
            return
        self.send_json(200, result)


def main(argv: list[str] | None = None) -> int:
    args = base.build_parser().parse_args(argv)
    if args.port != base.COMPANION_PORT:
        print(f"Counterpedia Local v0.1 requires port {base.COMPANION_PORT}", file=base.sys.stderr)
        return 2

    supervisor = OperatorLocalSupervisor(
        acquisition_dir=args.acquisition_dir.expanduser(),
        authoring_dir=args.authoring_dir.expanduser(),
        store_root=args.store_root.expanduser(),
    )
    OperatorHandler.supervisor = supervisor
    server = ThreadingHTTPServer((base.HOST, args.port), OperatorHandler)

    def shutdown(_signum: int, _frame: Any) -> None:
        supervisor.stop_all()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    print(f"Counterpedia Local listening on http://{base.HOST}:{args.port}", flush=True)
    print("Authority posture: TRANSPORT SUPERVISOR ONLY; operator snapshots are capture-only", flush=True)
    if args.open:
        threading.Timer(0.25, lambda: base.webbrowser.open(f"http://{base.HOST}:{args.port}/")).start()

    try:
        server.serve_forever()
    finally:
        supervisor.stop_all()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
