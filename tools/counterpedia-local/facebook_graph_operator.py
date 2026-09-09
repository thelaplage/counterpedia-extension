#!/usr/bin/env python3
"""Bounded operator-only Facebook GraphQL observation harness.

This tool is NOT part of the shipping extension runtime. It attaches to an
already-running Chrome DevTools Protocol endpoint chosen by the operator,
observes Facebook web-client GraphQL responses for a bounded interval, and
hands each completed response directly to counterpedia-acquisition's
FACEBOOK-GRAPH0 normalizer at a pinned commit.

No login automation, cookie extraction, token extraction, GraphQL replay,
DOM capture, page-content scraping, crawler loop, or anti-bot logic exists.
Transient request variables and CDP response-body bytes are written only in a
private TemporaryDirectory for the normalization subprocess; normalized
observations and the Acquisition object store are the durable outputs.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from cdp import CDPConnection, CDPError, fetch_browser_ws_url, list_targets

FACEBOOK_GRAPH0_ACQUISITION_SHA = "61d0878c65f3c863cf623732a4d42fc2866a0d62"
FACEBOOK_GRAPHQL_HOSTS = frozenset({"www.facebook.com", "facebook.com"})
BLOCKED_FACEBOOK_PATH_PREFIXES = (
    "/messages",
    "/settings",
    "/login",
    "/checkpoint",
    "/security",
    "/privacy",
    "/accounts",
)
ACCESS_CLASSES = (
    "public_reproducible",
    "authenticated_reproducible",
    "session_observed",
    "operator_only",
    "no_longer_available",
)


class OperatorError(RuntimeError):
    pass


@dataclass(frozen=True)
class GraphQLOperation:
    request_id: str
    doc_id: str
    friendly_name: str | None
    variables: dict[str, Any]
    observed_page_url: str


def _facebook_host(host: str | None) -> bool:
    if not host:
        return False
    host = host.lower().rstrip(".")
    return host == "facebook.com" or host.endswith(".facebook.com")


def _is_facebook_graphql_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and parts.hostname in FACEBOOK_GRAPHQL_HOSTS
        and parts.path == "/api/graphql/"
    )


def _assert_operator_page_allowed(url: str) -> None:
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise OperatorError(f"invalid operator page URL: {url!r}") from exc
    if parts.scheme != "https" or not _facebook_host(parts.hostname):
        raise OperatorError("operator target must be an https://*.facebook.com page")
    path = parts.path.lower()
    if any(path == p or path.startswith(p + "/") for p in BLOCKED_FACEBOOK_PATH_PREFIXES):
        raise OperatorError(
            f"refusing sensitive Facebook path {parts.path!r}; use an ordinary content surface"
        )


def _parse_graphql_post_data(
    post_data: str,
    *,
    request_id: str,
    document_url: str,
) -> GraphQLOperation:
    parsed = parse_qs(post_data, keep_blank_values=True, strict_parsing=False)
    doc_values = parsed.get("doc_id") or []
    if len(doc_values) != 1 or not doc_values[0].strip():
        raise OperatorError("Facebook GraphQL request has no single non-empty doc_id")

    variable_values = parsed.get("variables") or []
    if len(variable_values) != 1:
        raise OperatorError("Facebook GraphQL request has no single variables payload")
    try:
        variables = json.loads(variable_values[0])
    except json.JSONDecodeError as exc:
        raise OperatorError("Facebook GraphQL variables are not valid JSON") from exc
    if not isinstance(variables, dict):
        raise OperatorError("Facebook GraphQL variables must decode to a JSON object")

    friendly_values = parsed.get("fb_api_req_friendly_name") or []
    friendly_name = (
        friendly_values[0].strip()
        if friendly_values and friendly_values[0].strip()
        else None
    )

    _assert_operator_page_allowed(document_url)
    return GraphQLOperation(
        request_id=request_id,
        doc_id=doc_values[0],
        friendly_name=friendly_name,
        variables=variables,
        observed_page_url=document_url,
    )


def _response_body_bytes(body: str, base64_encoded: bool) -> bytes:
    if base64_encoded:
        try:
            return base64.b64decode(body, validate=True)
        except Exception as exc:
            raise OperatorError(
                "CDP response body declared base64 but failed strict decode"
            ) from exc
    return body.encode("utf-8")


def _git_head(repo: Path) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise OperatorError(
            f"cannot read git HEAD for Acquisition repo {repo}: {proc.stderr.strip()}"
        )
    return proc.stdout.strip()


def _validate_acquisition_repo(repo: Path, expected_sha: str) -> None:
    actual = _git_head(repo)
    if actual != expected_sha:
        raise OperatorError(
            f"Acquisition HEAD mismatch: expected {expected_sha}, got {actual}; "
            "refresh the operator harness pin rather than running against an unreviewed producer"
        )
    if not (repo / "scripts" / "facebook_graph0.py").is_file():
        raise OperatorError("pinned Acquisition checkout lacks scripts/facebook_graph0.py")
    if not (repo / "src" / "acquisition" / "facebook_graph.py").is_file():
        raise OperatorError("pinned Acquisition checkout lacks acquisition/facebook_graph.py")


def _choose_target(cdp_port: int, target_id: str | None) -> dict[str, Any]:
    targets = [t for t in list_targets(cdp_port) if t.get("type") == "page"]
    if target_id:
        for target in targets:
            if target.get("id") == target_id:
                _assert_operator_page_allowed(str(target.get("url") or ""))
                return target
        raise OperatorError(f"target id {target_id!r} is not an allowed page target")

    matches = []
    for target in targets:
        try:
            _assert_operator_page_allowed(str(target.get("url") or ""))
        except OperatorError:
            continue
        matches.append(target)
    if len(matches) != 1:
        compact = [{"id": t.get("id"), "url": t.get("url")} for t in matches]
        raise OperatorError(
            "expected exactly one allowed Facebook page target; pass --target-id. "
            f"candidates={json.dumps(compact, ensure_ascii=False)}"
        )
    return matches[0]


def _normalize_one(
    *,
    acquisition_root: Path,
    object_store: Path,
    output_dir: Path,
    surface_class: str,
    access_class: str,
    producer_revision: str,
    operation: GraphQLOperation,
    response_bytes: bytes,
) -> Path:
    observations_dir = output_dir / "observations"
    observations_dir.mkdir(parents=True, exist_ok=True)
    safe_request_id = operation.request_id.replace(":", "_").replace("/", "_")
    out_path = observations_dir / f"{time.time_ns()}-{safe_request_id}.json"

    metadata = {
        "surface_class": surface_class,
        "observed_page_url": operation.observed_page_url,
        "graphql_endpoint": "https://www.facebook.com/api/graphql/",
        "doc_id": operation.doc_id,
        "friendly_name": operation.friendly_name,
        "variables": operation.variables,
        "access_class": access_class,
        "producer_id": "counterpedia-extension-operator-cdp",
        "producer_revision": producer_revision,
    }

    with tempfile.TemporaryDirectory(prefix="counterpedia-fbgraph0-") as tmp:
        tmp_root = Path(tmp)
        os.chmod(tmp_root, 0o700)
        metadata_path = tmp_root / "metadata.json"
        response_path = tmp_root / "response.bin"
        metadata_path.write_text(
            json.dumps(metadata, separators=(",", ":")), encoding="utf-8"
        )
        response_path.write_bytes(response_bytes)
        os.chmod(metadata_path, 0o600)
        os.chmod(response_path, 0o600)

        env = os.environ.copy()
        env["PYTHONPATH"] = str(acquisition_root / "src")
        proc = subprocess.run(
            [
                sys.executable,
                str(acquisition_root / "scripts" / "facebook_graph0.py"),
                "normalize",
                "--metadata",
                str(metadata_path),
                "--response",
                str(response_path),
                "--object-store",
                str(object_store),
                "--out",
                str(out_path),
            ],
            cwd=acquisition_root,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            out_path.unlink(missing_ok=True)
            raise OperatorError(
                "FACEBOOK-GRAPH0 normalizer rejected observed operation: "
                + (proc.stderr.strip() or proc.stdout.strip())
            )
    return out_path


def _build_census(
    *, acquisition_root: Path, object_store: Path, output_dir: Path
) -> Path:
    observations = sorted((output_dir / "observations").glob("*.json"))
    if not observations:
        raise OperatorError("no normalized observations exist; census not built")
    census_path = output_dir / "census.json"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(acquisition_root / "src")
    cmd = [
        sys.executable,
        str(acquisition_root / "scripts" / "facebook_graph0.py"),
        "census",
    ]
    for observation in observations:
        cmd.extend(["--observation", str(observation)])
    cmd.extend(
        ["--object-store", str(object_store), "--out", str(census_path)]
    )
    proc = subprocess.run(
        cmd,
        cwd=acquisition_root,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        census_path.unlink(missing_ok=True)
        raise OperatorError(
            "FACEBOOK-GRAPH0 census failed: "
            + (proc.stderr.strip() or proc.stdout.strip())
        )
    return census_path


def _drain_network_events(
    conn: CDPConnection, session_id: str
) -> list[dict[str, Any]]:
    # CDPConnection queues interleaved events while waiting for matching command
    # responses. A no-op Runtime.evaluate is therefore the bounded event pump.
    conn.call(
        "Runtime.evaluate",
        {"expression": "0", "returnByValue": True},
        session_id=session_id,
        timeout=2.0,
    )
    return [
        event
        for event in conn.drain_events()
        if event.get("sessionId") in (None, session_id)
    ]


def _capture(args: argparse.Namespace) -> int:
    acquisition_root = args.acquisition_root.resolve()
    output_dir = args.output_dir.resolve()
    object_store = args.object_store.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    object_store.mkdir(parents=True, exist_ok=True)
    _validate_acquisition_repo(acquisition_root, args.expected_acquisition_sha)

    target = _choose_target(args.cdp_port, args.target_id)
    target_id = str(target["id"])
    target_url = str(target.get("url") or "")
    _assert_operator_page_allowed(target_url)

    conn = CDPConnection(fetch_browser_ws_url(args.cdp_port))
    normalized: list[Path] = []
    matched: dict[str, GraphQLOperation] = {}
    try:
        session_id = conn.attach(target_id)
        conn.call(
            "Network.enable",
            {"maxPostDataSize": 1048576},
            session_id=session_id,
            timeout=5.0,
        )
        deadline = time.monotonic() + args.duration
        while time.monotonic() < deadline:
            for event in _drain_network_events(conn, session_id):
                method = event.get("method")
                params = event.get("params") or {}
                if method == "Network.requestWillBeSent":
                    request = params.get("request") or {}
                    if not _is_facebook_graphql_url(str(request.get("url") or "")):
                        continue
                    post_data = request.get("postData")
                    request_id = str(params.get("requestId") or "")
                    document_url = str(params.get("documentURL") or target_url)
                    if not request_id or not isinstance(post_data, str):
                        continue
                    try:
                        matched[request_id] = _parse_graphql_post_data(
                            post_data,
                            request_id=request_id,
                            document_url=document_url,
                        )
                    except OperatorError:
                        continue

                elif method == "Network.loadingFinished":
                    request_id = str(params.get("requestId") or "")
                    operation = matched.pop(request_id, None)
                    if operation is None:
                        continue
                    try:
                        body_result = conn.call(
                            "Network.getResponseBody",
                            {"requestId": request_id},
                            session_id=session_id,
                            timeout=5.0,
                        )
                        body = body_result.get("body")
                        if not isinstance(body, str):
                            continue
                        response_bytes = _response_body_bytes(
                            body, bool(body_result.get("base64Encoded"))
                        )
                        normalized.append(
                            _normalize_one(
                                acquisition_root=acquisition_root,
                                object_store=object_store,
                                output_dir=output_dir,
                                surface_class=args.surface_class,
                                access_class=args.access_class,
                                producer_revision=args.producer_revision,
                                operation=operation,
                                response_bytes=response_bytes,
                            )
                        )
                    except (CDPError, OperatorError):
                        continue
            time.sleep(args.poll_interval)
    finally:
        conn.close()

    observation_files = list((output_dir / "observations").glob("*.json"))
    census_path = (
        _build_census(
            acquisition_root=acquisition_root,
            object_store=object_store,
            output_dir=output_dir,
        )
        if observation_files
        else None
    )
    run_record = {
        "artifact_type": "FacebookGraphOperatorRun",
        "spec_version": "v0.1",
        "authority_movement": 0,
        "shipping_extension_runtime_modified": False,
        "target_id": target_id,
        "target_url": target_url,
        "surface_class": args.surface_class,
        "access_class": args.access_class,
        "duration_seconds": args.duration,
        "acquisition_sha": args.expected_acquisition_sha,
        "normalized_observation_files": [p.name for p in normalized],
        "new_observation_count": len(normalized),
        "census_file": census_path.name if census_path else None,
    }
    run_path = output_dir / f"operator-run-{time.time_ns()}.json"
    run_path.write_text(
        json.dumps(run_record, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(run_record, indent=2, sort_keys=True))
    return 0


def _list(args: argparse.Namespace) -> int:
    rows = []
    for target in list_targets(args.cdp_port):
        if target.get("type") != "page":
            continue
        url = str(target.get("url") or "")
        try:
            _assert_operator_page_allowed(url)
        except OperatorError:
            continue
        rows.append(
            {"id": target.get("id"), "url": url, "title": target.get("title")}
        )
    print(json.dumps(rows, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    ls = sub.add_parser(
        "list-targets", help="list allowed Facebook page targets on a local CDP endpoint"
    )
    ls.add_argument("--cdp-port", type=int, default=9222)
    ls.set_defaults(func=_list)

    cap = sub.add_parser(
        "capture", help="capture a bounded operator-selected Facebook UI observation window"
    )
    cap.add_argument("--cdp-port", type=int, default=9222)
    cap.add_argument("--target-id")
    cap.add_argument("--duration", type=float, default=30.0)
    cap.add_argument("--poll-interval", type=float, default=0.2)
    cap.add_argument("--surface-class", required=True)
    cap.add_argument(
        "--access-class", choices=ACCESS_CLASSES, default="session_observed"
    )
    cap.add_argument("--acquisition-root", type=Path, required=True)
    cap.add_argument(
        "--expected-acquisition-sha", default=FACEBOOK_GRAPH0_ACQUISITION_SHA
    )
    cap.add_argument("--output-dir", type=Path, required=True)
    cap.add_argument("--object-store", type=Path, required=True)
    cap.add_argument("--producer-revision", required=True)
    cap.set_defaults(func=_capture)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "duration", 1) <= 0:
        raise SystemExit("--duration must be > 0")
    if getattr(args, "poll_interval", 0.1) <= 0:
        raise SystemExit("--poll-interval must be > 0")
    try:
        return int(args.func(args))
    except (OperatorError, CDPError) as exc:
        print(f"FACEBOOK-GRAPH0 OPERATOR ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
