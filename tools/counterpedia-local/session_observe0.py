#!/usr/bin/env python3
"""SESSION-OBSERVE0: generic bounded browser/session observation kernel.

This module is the extraction of the genuinely generic parts of the
FACEBOOK-GRAPH0-OPERATOR harness (see docs/SESSION_OBSERVE0_KERNEL_V0_1.md):
attach to an operator-selected CDP target, watch already-in-flight network
traffic for a bounded duration, and hand each matched request/response pair
to an owner-supplied sink. Everything host-specific (which requests count as
"a match", what URLs/paths are refused as targets, what happens to the
observed bytes afterwards) is supplied by the caller as a plain callable, not
hardcoded here.

What this kernel deliberately does NOT do, by construction:

- it never reads cookies, auth headers, storage, or any credential/token
  material -- it only sees the fields CDP's Network domain already exposes
  for a request/response (URL, post body, response body, status);
- it never extracts DOM/page content -- there is no Runtime.evaluate against
  page state and no Page.* content capture beyond the one no-op event-pump
  call inherited from the existing cdp.CDPConnection primitive;
- it never navigates, clicks, replays, or crawls -- the operator drives the
  page; this kernel is a passive bounded-duration observer of one
  operator-selected target;
- it carries no authority/admission/CHECK semantics -- it has no concept of
  disposition, standing, verification, or publication; a "match" is an
  opaque descriptor the caller's own matcher returns, and the kernel never
  interprets it;
- it never persists observed response bytes itself -- bytes are handed to
  the caller's ``sink`` in memory for exactly one call and then dropped;
  what a downstream producer does with them (write, normalize, discard) is
  entirely the caller's decision, made outside this module.

AUTHORITY_MOVEMENT = 0. Not part of the shipping extension runtime.
"""
from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from cdp import CDPConnection, CDPError, fetch_browser_ws_url, list_targets


class SessionObserveError(RuntimeError):
    pass


class RequestMatcher(Protocol):
    """Adapter-supplied, host-specific request classifier.

    Called once per ``Network.requestWillBeSent`` event for the observed
    target. Given the CDP ``request`` object, the CDP ``requestId``, and the
    request's ``documentURL``, return an opaque, JSON-serializable descriptor
    dict if this request is one the caller wants to observe the response
    for, or ``None`` to ignore it. The kernel never inspects the descriptor's
    contents -- it is carried through unchanged to the matching
    ``ObservedExchange``.
    """

    def __call__(
        self, request: dict[str, Any], request_id: str, document_url: str
    ) -> dict[str, Any] | None: ...


class TargetValidator(Protocol):
    """Adapter-supplied, host-specific target-acceptance policy.

    Called once, with the resolved target's URL, before attaching. Raise
    ``SessionObserveError`` (or let any exception propagate) to refuse the
    target. The kernel itself applies no host allowlist or sensitive-path
    denylist -- an adapter observing a specific site supplies its own.
    """

    def __call__(self, target_url: str) -> None: ...


@dataclass(frozen=True)
class ObservedExchange:
    """One matched request paired with its observed response bytes.

    ``response_bytes`` are exactly what CDP's ``Network.getResponseBody``
    returned for this request (base64-decoded if CDP marked it as such).
    This is the CDP-observed response body, not a claim about raw wire
    bytes; see docs/SESSION_OBSERVE0_KERNEL_V0_1.md for the precise
    evidence-strength language inherited from the specimen this was
    extracted from.
    """

    request_id: str
    observed_page_url: str
    match: dict[str, Any]
    response_bytes: bytes
    response_base64_encoded: bool


ExchangeSink = Callable[[ObservedExchange], None]


@dataclass(frozen=True)
class SessionObservationSummary:
    target_id: str
    target_url: str
    duration_seconds: float
    matched_request_count: int
    observed_exchange_count: int
    authority_movement: int = field(default=0, init=False)


def response_body_bytes(body: str, base64_encoded: bool) -> bytes:
    if base64_encoded:
        try:
            return base64.b64decode(body, validate=True)
        except Exception as exc:  # noqa: BLE001 -- normalize to one error type
            raise SessionObserveError(
                "CDP response body declared base64 but failed strict decode"
            ) from exc
    return body.encode("utf-8")


def list_page_targets(
    cdp_port: int, *, list_targets_fn: Callable[[int], list[dict[str, Any]]] = list_targets
) -> list[dict[str, Any]]:
    """All CDP page-type targets, unfiltered.

    Deliberately carries no host allowlist -- callers that need one (as the
    Facebook-specific harness this was extracted from does) apply it on top
    of this, or via ``target_validator`` in :func:`capture`.
    """
    return [t for t in list_targets_fn(cdp_port) if t.get("type") == "page"]


def _select_target(
    cdp_port: int,
    target_id: str,
    *,
    list_targets_fn: Callable[[int], list[dict[str, Any]]],
) -> dict[str, Any]:
    for target in list_targets_fn(cdp_port):
        if target.get("id") == target_id:
            return target
    raise SessionObserveError(
        f"target id {target_id!r} not found among current CDP targets; "
        "session-observe0 only observes an operator-selected, currently-open target"
    )


def _drain_network_events(
    conn: CDPConnection, session_id: str
) -> list[dict[str, Any]]:
    # CDPConnection queues interleaved events while waiting for a matching
    # command response, so a no-op Runtime.evaluate is the bounded pump that
    # forces any buffered Network.* events to surface.
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


def capture(
    *,
    cdp_port: int,
    target_id: str,
    duration: float,
    matcher: RequestMatcher,
    sink: ExchangeSink,
    poll_interval: float = 0.2,
    target_validator: TargetValidator | None = None,
    connect: Callable[[str], CDPConnection] = CDPConnection,
    list_targets_fn: Callable[[int], list[dict[str, Any]]] = list_targets,
    fetch_ws_url: Callable[[int], str] = fetch_browser_ws_url,
    clock: Callable[[], float] = time.monotonic,
    sleeper: Callable[[float], None] = time.sleep,
) -> SessionObservationSummary:
    """Observe one operator-selected CDP target for a bounded duration.

    ``target_id`` is required and not inferred: session-observe0 never picks
    a target on the operator's behalf. ``matcher`` and ``target_validator``
    are the only host-specific hooks; everything else here is transport
    plumbing shared across any adapter.

    The optional ``connect`` / ``list_targets_fn`` / ``fetch_ws_url`` /
    ``clock`` / ``sleeper`` parameters exist so hermetic tests can exercise
    the full bounded-loop control flow without a real browser; callers do
    not need to supply them.
    """
    if duration <= 0:
        raise SessionObserveError("duration must be > 0")
    if poll_interval <= 0:
        raise SessionObserveError("poll_interval must be > 0")
    if not target_id:
        raise SessionObserveError(
            "target_id is required: session-observe0 only observes an "
            "explicitly operator-selected target"
        )

    target = _select_target(cdp_port, target_id, list_targets_fn=list_targets_fn)
    target_url = str(target.get("url") or "")
    if target_validator is not None:
        target_validator(target_url)

    conn = connect(fetch_ws_url(cdp_port))
    pending: dict[str, dict[str, Any]] = {}
    matched_total = 0
    observed_total = 0
    try:
        session_id = conn.attach(target_id)
        conn.call(
            "Network.enable",
            {"maxPostDataSize": 1048576},
            session_id=session_id,
            timeout=5.0,
        )
        deadline = clock() + duration
        while clock() < deadline:
            for event in _drain_network_events(conn, session_id):
                method = event.get("method")
                params = event.get("params") or {}

                if method == "Network.requestWillBeSent":
                    request = params.get("request") or {}
                    request_id = str(params.get("requestId") or "")
                    document_url = str(params.get("documentURL") or target_url)
                    if not request_id:
                        continue
                    try:
                        match = matcher(request, request_id, document_url)
                    except Exception:  # noqa: BLE001 -- an adapter matcher
                        # error refuses this one request, not the whole run.
                        continue
                    if match is None:
                        continue
                    matched_total += 1
                    pending[request_id] = {
                        "match": match,
                        "document_url": document_url,
                    }

                elif method == "Network.loadingFinished":
                    request_id = str(params.get("requestId") or "")
                    entry = pending.pop(request_id, None)
                    if entry is None:
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
                        base64_encoded = bool(body_result.get("base64Encoded"))
                        response_bytes = response_body_bytes(body, base64_encoded)
                    except (CDPError, SessionObserveError):
                        continue
                    sink(
                        ObservedExchange(
                            request_id=request_id,
                            observed_page_url=str(entry["document_url"]),
                            match=dict(entry["match"]),
                            response_bytes=response_bytes,
                            response_base64_encoded=base64_encoded,
                        )
                    )
                    observed_total += 1
            sleeper(poll_interval)
    finally:
        conn.close()

    return SessionObservationSummary(
        target_id=target_id,
        target_url=target_url,
        duration_seconds=duration,
        matched_request_count=matched_total,
        observed_exchange_count=observed_total,
    )
