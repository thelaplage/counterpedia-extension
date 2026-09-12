#!/usr/bin/env python3
"""Bounded operator-only Facebook GraphQL observation harness.

This tool is NOT part of the shipping extension runtime. It is a thin,
Facebook-specific adapter over SESSION-OBSERVE0 (session_observe0.py): the
bounded CDP attach/observe/pump loop, the closed no-headers ``RequestView``
matcher contract, and the strict base64-aware response-body decode all live
in the generic kernel now. This module owns exactly the Facebook-specific
policy layered on top of that kernel: recognizing a Facebook GraphQL request
(matcher), the sensitive-path denylist + host allowlist (target validator),
the GraphQL doc_id/variables parser, the access-class vocabulary, and the
Acquisition FACEBOOK-GRAPH0 subprocess/normalizer handoff (the kernel's
``sink``).

No login automation, cookie extraction, token extraction, GraphQL replay,
DOM capture, page-content scraping, crawler loop, or anti-bot logic exists.
Transient request variables and CDP response-body bytes are written only in a
private TemporaryDirectory for the normalization subprocess; normalized
observations and the Acquisition object store are the durable outputs.
"""
from __future__ import annotations

import argparse
import dataclasses
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

from cdp import CDPError

# session_observe0 is a sibling module in this same directory, not an
# installed package -- make sure this directory is importable regardless of
# how this file itself was loaded (direct script run, pytest, or
# importlib.util.spec_from_file_location as the hermetic test does).
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import session_observe0

FACEBOOK_GRAPH0_ACQUISITION_SHA = "c5e5d18bfac3ec0b12f36e7a52c1298a3845cdbb"
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
    """Thin operator-error-typed wrapper over the kernel's strict decoder.

    The actual base64-aware decode logic lives in
    ``session_observe0.response_body_bytes`` (SESSION-OBSERVE0 kernel); this
    wrapper only translates that kernel's ``SessionObserveError`` into this
    module's ``OperatorError`` so existing operator callers/tests keep a
    single, stable exception type.
    """
    try:
        return session_observe0.response_body_bytes(body, base64_encoded)
    except session_observe0.SessionObserveError as exc:
        raise OperatorError(str(exc)) from exc


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
    targets = session_observe0.list_page_targets(cdp_port)
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


def _facebook_graphql_matcher() -> session_observe0.RequestMatcher:
    """The Facebook-owned request classifier handed to the kernel.

    Receives only the kernel's closed ``RequestView`` (method/url/post_data/
    has_post_data -- structurally no headers/cookies). Recognizes a Facebook
    GraphQL request by URL, then defers to ``_parse_graphql_post_data`` for
    the doc_id/variables/friendly_name extraction and the sensitive-page
    denylist check. The returned descriptor is a plain dict (the kernel
    carries it through opaquely) so the observed exchange can be turned back
    into a :class:`GraphQLOperation` in the sink below.
    """

    def matcher(
        request: session_observe0.RequestView, request_id: str, document_url: str
    ) -> dict[str, Any] | None:
        if not _is_facebook_graphql_url(request.url):
            return None
        if request.post_data is None:
            return None
        try:
            operation = _parse_graphql_post_data(
                request.post_data,
                request_id=request_id,
                document_url=document_url,
            )
        except OperatorError:
            return None
        return dataclasses.asdict(operation)

    return matcher


def _facebook_normalize_sink(
    *,
    acquisition_root: Path,
    object_store: Path,
    output_dir: Path,
    surface_class: str,
    access_class: str,
    producer_revision: str,
    normalized: list[Path],
) -> session_observe0.ExchangeSink:
    """The Acquisition FACEBOOK-GRAPH0 handoff, as the kernel's ``sink``.

    A normalizer rejection for one observed exchange is swallowed here (not
    re-raised) to preserve the original harness's per-exchange behavior: one
    bad observation must not abort the rest of the bounded observation
    window. Response bytes arrive already strictly base64-decoded by the
    kernel; this sink does no CDP or byte-decoding work of its own.
    """

    def sink(exchange: session_observe0.ObservedExchange) -> None:
        operation = GraphQLOperation(**exchange.match)
        try:
            normalized.append(
                _normalize_one(
                    acquisition_root=acquisition_root,
                    object_store=object_store,
                    output_dir=output_dir,
                    surface_class=surface_class,
                    access_class=access_class,
                    producer_revision=producer_revision,
                    operation=operation,
                    response_bytes=exchange.response_bytes,
                )
            )
        except OperatorError:
            pass

    return sink


def _capture(args: argparse.Namespace) -> int:
    acquisition_root = args.acquisition_root.resolve()
    output_dir = args.output_dir.resolve()
    object_store = args.object_store.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    object_store.mkdir(parents=True, exist_ok=True)
    _validate_acquisition_repo(acquisition_root, args.expected_acquisition_sha)

    target = _choose_target(args.cdp_port, args.target_id)
    target_id = str(target["id"])
    _assert_operator_page_allowed(str(target.get("url") or ""))

    normalized: list[Path] = []
    summary = session_observe0.capture(
        cdp_port=args.cdp_port,
        target_id=target_id,
        duration=args.duration,
        matcher=_facebook_graphql_matcher(),
        sink=_facebook_normalize_sink(
            acquisition_root=acquisition_root,
            object_store=object_store,
            output_dir=output_dir,
            surface_class=args.surface_class,
            access_class=args.access_class,
            producer_revision=args.producer_revision,
            normalized=normalized,
        ),
        poll_interval=args.poll_interval,
        target_validator=_assert_operator_page_allowed,
    )

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
        "target_url": summary.target_url,
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
    for target in session_observe0.list_page_targets(args.cdp_port):
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
    except (OperatorError, CDPError, session_observe0.SessionObserveError) as exc:
        print(f"FACEBOOK-GRAPH0 OPERATOR ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
