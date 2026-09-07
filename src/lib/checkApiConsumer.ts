/**
 * EXT-CHECK-CONSUMER0 (R7) — external CHECK consumer over the CANONICAL
 * Counterpedia CHECK API.
 *
 * Contract: explicit user input -> `POST {checkBaseUrl}/api/check/new`
 * (`thelaplage/counterpedia` `app/api/check/new/route.ts`) -> render the
 * canonical `CheckAttemptPresentation` response. This module:
 *
 *   - issues EXACTLY ONE network request per invocation, the one POST to
 *     `/api/check/new` with only the caller-supplied `url` /
 *     `quote_text` / `proposition_text` fields — no second fetch, no
 *     capture, no scanner harvest, no local storage write, no draft/keep
 *     side effect of any kind (see `tests/checkApiConsumer.test.ts`'s
 *     request/effect assertions);
 *   - contains NO evaluator: it never computes `capture_status` or a
 *     dimension's `state`/`reason_code` itself — those are read verbatim
 *     off the parsed response body;
 *   - performs no `SupportState`<->`CheckResultState` conversion — this
 *     path never touches `SupportState` at all;
 *   - fails closed on an unrecognized response `schema`, an unrecognized
 *     `capture_status`, or an unrecognized dimension `state`/`dimension`
 *     name — it never renders a best-effort guess for a shape it does not
 *     recognize;
 *   - reuses the SAME destination rules as the existing "Open in
 *     Counterpedia CHECK" navigation handoff (`checkHandoff.ts`): HTTPS or
 *     an explicit loopback HTTP override, never fabricates a local Check.
 */

import {
  CHECK_ATTEMPT_CAPTURE_STATUSES,
  CHECK_ATTEMPT_DIMENSIONS,
  CHECK_ATTEMPT_DIMENSION_STATES,
  CHECK_ATTEMPT_SCHEMA,
  type CheckAttemptCaptureStatus,
  type CheckAttemptDimension,
  type CheckAttemptPresentation,
} from "./checkResultContract";

export const DEFAULT_CHECK_API_BASE_URL = "https://counterpedia.vercel.app";

export class CheckApiConsumerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckApiConsumerError";
  }
}

export interface CheckApiConsumerInput {
  readonly url: string;
  readonly quoteText?: string | null;
  readonly propositionText?: string | null;
  readonly checkBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * A successful, schema-recognized round trip. `httpStatus` is carried for
 * transparency (the canonical API uses distinct HTTP codes to distinguish a
 * governed refusal from an outage — see `route.ts`'s own docstring) but this
 * consumer does not branch product behavior on it beyond what
 * `presentation.capture_status` already says.
 */
export interface CheckApiConsumerResult {
  readonly kind: "presentation";
  readonly httpStatus: number;
  readonly presentation: CheckAttemptPresentation;
}

/**
 * The canonical hosted runtime is not deployed/bound for this destination.
 * Rendered honestly — never fabricated as a local Check result.
 */
export interface CheckApiConsumerUnbound {
  readonly kind: "unbound";
  readonly httpStatus: number;
  readonly detail: string;
}

/** Fail-closed refusal: the response did not match any shape this consumer recognizes. */
export interface CheckApiConsumerUnrecognized {
  readonly kind: "unrecognized_response";
  readonly detail: string;
}

/** The request itself could not be made (network failure, DNS, etc.) — distinct from a server-reported outage. */
export interface CheckApiConsumerLocalTransportError {
  readonly kind: "local_transport_error";
  readonly detail: string;
}

export type CheckApiConsumerOutcome =
  | CheckApiConsumerResult
  | CheckApiConsumerUnbound
  | CheckApiConsumerUnrecognized
  | CheckApiConsumerLocalTransportError;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/** Same discipline as checkHandoff.ts's assertAllowedCheckBase — HTTPS or explicit loopback dev override only. */
export function assertAllowedCheckApiBase(url: URL): void {
  if (url.username || url.password) {
    throw new CheckApiConsumerError("EXT-CHECK-CONSUMER0: Counterpedia Check base URL must not contain credentials");
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new CheckApiConsumerError("EXT-CHECK-CONSUMER0: Counterpedia Check base URL must be HTTPS or loopback HTTP");
}

function assertCheckableUrl(url: URL): void {
  if (url.username || url.password) {
    throw new CheckApiConsumerError("EXT-CHECK-CONSUMER0: source URL must not contain credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CheckApiConsumerError("EXT-CHECK-CONSUMER0: source URL must be HTTP(S)");
  }
}

function isKnownCaptureStatus(value: unknown): value is CheckAttemptCaptureStatus {
  return typeof value === "string" && (CHECK_ATTEMPT_CAPTURE_STATUSES as readonly string[]).includes(value);
}

function isKnownDimension(value: unknown): value is CheckAttemptDimension {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d["dimension"] === "string" &&
    (CHECK_ATTEMPT_DIMENSIONS as readonly string[]).includes(d["dimension"]) &&
    typeof d["state"] === "string" &&
    (CHECK_ATTEMPT_DIMENSION_STATES as readonly string[]).includes(d["state"]) &&
    (d["reason_code"] === null || typeof d["reason_code"] === "string")
  );
}

/**
 * Structural validator for `CheckAttemptPresentation`. Fails closed (returns
 * `false`) on ANY unrecognized `schema`, unrecognized `capture_status`, or
 * unrecognized dimension shape/state — never renders a best-effort guess for
 * a version-incompatible or malformed body.
 */
export function isRecognizedCheckAttemptPresentation(data: unknown): data is CheckAttemptPresentation {
  if (typeof data !== "object" || data === null) return false;
  const p = data as Record<string, unknown>;
  if (p["schema"] !== CHECK_ATTEMPT_SCHEMA) return false;
  if (p["kind"] !== "check_attempt") return false;
  if (typeof p["requested_url"] !== "string") return false;
  if (p["submitted_quote_text"] !== null && typeof p["submitted_quote_text"] !== "string") return false;
  if (p["submitted_proposition_text"] !== null && typeof p["submitted_proposition_text"] !== "string") return false;
  if (!isKnownCaptureStatus(p["capture_status"])) return false;
  if (p["capture_digest"] !== null && typeof p["capture_digest"] !== "string") return false;
  if (p["capture_byte_count"] !== null && typeof p["capture_byte_count"] !== "number") return false;
  if (!Array.isArray(p["dimensions"]) || !p["dimensions"].every(isKnownDimension)) return false;
  if (p["receipt_issued"] !== false) return false;
  if (typeof p["note"] !== "string") return false;
  return true;
}

/**
 * Calls the canonical CHECK API for a caller-supplied URL and returns the
 * parsed `CheckAttemptPresentation`, or an honest not-recognized/unbound/
 * transport-error outcome. Issues exactly one `fetch` call.
 */
export async function checkViaCanonicalApi(input: CheckApiConsumerInput): Promise<CheckApiConsumerOutcome> {
  const source = new URL(input.url);
  assertCheckableUrl(source);

  const base = new URL(input.checkBaseUrl ?? DEFAULT_CHECK_API_BASE_URL);
  assertAllowedCheckApiBase(base);

  const endpoint = new URL("/api/check/new", base);
  const doFetch = input.fetchImpl ?? fetch;

  const body = {
    url: source.toString(),
    quote_text: input.quoteText ?? null,
    proposition_text: input.propositionText ?? null,
  };

  let response: Response;
  try {
    response = await doFetch(endpoint.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      kind: "local_transport_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    return {
      kind: "unrecognized_response",
      detail: `response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const presentationCandidate = record["presentation"];

  if (response.status === 503) {
    const status = typeof record["status"] === "string" ? record["status"] : "unknown";
    return {
      kind: "unbound",
      httpStatus: response.status,
      detail:
        typeof record["detail"] === "string"
          ? record["detail"]
          : `canonical CHECK API reported ${status} (hosted runtime not bound for this destination)`,
    };
  }

  if (!isRecognizedCheckAttemptPresentation(presentationCandidate)) {
    return {
      kind: "unrecognized_response",
      detail: `response.presentation did not match a recognized ${CHECK_ATTEMPT_SCHEMA} shape; refusing to render.`,
    };
  }

  return { kind: "presentation", httpStatus: response.status, presentation: presentationCandidate };
}
