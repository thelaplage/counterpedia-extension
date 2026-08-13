/**
 * EXT-ACQ1 — strict client for counterpedia-acquisition ACQ1 HTTP v0.1.
 *
 * This module moves NO authority. It sends the exact BrowserPageCapture produced
 * by the existing explicit capture gesture to the local acquisition transport and
 * validates the returned CaptureUrlResult as producer facts.
 *
 * Permanent boundaries:
 * - BrowserPageCapture remains an OBSERVATION; this client never turns rendered
 *   browser text into source bytes.
 * - A returned acquisition.capture.v0.1 CaptureReceipt is an ACQUISITION receipt,
 *   not an SRS receipt, verification result, admission decision, or publication.
 * - No token is defined in source. The caller supplies a per-browser-session token
 *   (the panel stores it in chrome.storage.session, not persisted local storage).
 * - Only plain-http LOOPBACK endpoints are accepted. No redirects, cookies, or
 *   credentials are permitted.
 * - Unknown/future response fields fail closed. We do not "best effort" a producer
 *   result whose contract we do not understand.
 */

import type { BrowserPageCapture } from "./browserPageCapture";

export const ACQ1_DEFAULT_ENDPOINT = "http://127.0.0.1:8787";
export const ACQ1_OBSERVATION_PATH = "/v0/browser-observation";
export const ACQ1_TOKEN_HEADER = "X-Counterpedia-Transport-Token";
export const ACQ1_TOKEN_SESSION_KEY = "counterpedia.acq1.transport_token.v0.1";
export const ACQ1_HTTP_TIMEOUT_MS = 35_000;

export const ACQ1_TOOL = "acquisition.capture_url" as const;
export const ACQ1_SURFACE_SCHEMA = "acquisition.mcp_surface.v0.1" as const;
export const ACQ1_CAPTURE_SCHEMA = "acquisition.capture.v0.1" as const;

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

export interface AcquisitionHttpMetadata {
  readonly status_code: number;
  readonly content_type: string | null;
  readonly content_length: number | null;
  readonly last_modified: string | null;
  readonly etag: string | null;
  readonly final_url: string | null;
}

export interface AcquisitionCaptureReceipt {
  readonly capture_id: string;
  readonly source_id: string;
  readonly source_locator: string;
  readonly captured_at: string;
  readonly http_metadata: AcquisitionHttpMetadata | null;
  readonly exact_bytes_sha256: string;
  readonly byte_count: number;
  readonly schema_version: typeof ACQ1_CAPTURE_SCHEMA;
}

interface CaptureUrlResultBase {
  readonly tool: typeof ACQ1_TOOL;
  readonly surface_schema: typeof ACQ1_SURFACE_SCHEMA;
  readonly source_id: string;
  readonly source_locator: string;
}

export interface CaptureUrlCapturedResult extends CaptureUrlResultBase {
  readonly capture_status: "captured";
  readonly capture_receipt: AcquisitionCaptureReceipt;
  readonly capture_id: string;
  readonly captured_object_address: string;
  readonly byte_count: number;
  readonly failure_detail: null;
}

export interface CaptureUrlFailedResult extends CaptureUrlResultBase {
  readonly capture_status: "capture_failed";
  readonly capture_receipt: null;
  readonly capture_id: null;
  readonly captured_object_address: null;
  readonly byte_count: null;
  readonly failure_detail: string;
}

export type CaptureUrlResult = CaptureUrlCapturedResult | CaptureUrlFailedResult;

export type AcquisitionTransportFailureCode =
  | "not_configured"
  | "unsafe_endpoint"
  | "invalid_token"
  | "timeout"
  | "network_error"
  | "http_error"
  | "invalid_response";

export class AcquisitionTransportError extends Error {
  constructor(
    public readonly code: AcquisitionTransportFailureCode,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "AcquisitionTransportError";
  }
}

export interface AcquisitionFetchOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface SessionStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  what: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    throw new AcquisitionTransportError(
      "invalid_response",
      `${what} has an unknown or missing field`,
    );
  }
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AcquisitionTransportError("invalid_response", `${what} must be a non-empty string`);
  }
  return value;
}

function requireNullableString(value: unknown, what: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AcquisitionTransportError("invalid_response", `${what} must be string or null`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new AcquisitionTransportError(
      "invalid_response",
      `${what} must be a non-negative integer`,
    );
  }
  return value as number;
}

function requireNullableNonNegativeInteger(value: unknown, what: string): number | null {
  if (value === null) return null;
  return requireNonNegativeInteger(value, what);
}

function requireHttpUrl(value: unknown, what: string): string {
  const text = requireString(value, what);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new AcquisitionTransportError("invalid_response", `${what} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AcquisitionTransportError("invalid_response", `${what} must be http/https`);
  }
  return text;
}

function validateHttpMetadata(value: unknown): AcquisitionHttpMetadata | null {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    throw new AcquisitionTransportError("invalid_response", "capture_receipt.http_metadata must be object or null");
  }
  assertExactKeys(
    value,
    ["status_code", "content_type", "content_length", "last_modified", "etag", "final_url"],
    "capture_receipt.http_metadata",
  );
  const statusCode = requireNonNegativeInteger(value["status_code"], "http_metadata.status_code");
  if (statusCode > 999) {
    throw new AcquisitionTransportError("invalid_response", "http_metadata.status_code is out of range");
  }
  const finalUrl = requireNullableString(value["final_url"], "http_metadata.final_url");
  if (finalUrl !== null) requireHttpUrl(finalUrl, "http_metadata.final_url");
  return {
    status_code: statusCode,
    content_type: requireNullableString(value["content_type"], "http_metadata.content_type"),
    content_length: requireNullableNonNegativeInteger(
      value["content_length"],
      "http_metadata.content_length",
    ),
    last_modified: requireNullableString(value["last_modified"], "http_metadata.last_modified"),
    etag: requireNullableString(value["etag"], "http_metadata.etag"),
    final_url: finalUrl,
  };
}

function validateCaptureReceipt(value: unknown): AcquisitionCaptureReceipt {
  if (!isPlainObject(value)) {
    throw new AcquisitionTransportError("invalid_response", "capture_receipt must be an object");
  }
  assertExactKeys(
    value,
    [
      "capture_id",
      "source_id",
      "source_locator",
      "captured_at",
      "http_metadata",
      "exact_bytes_sha256",
      "byte_count",
      "schema_version",
    ],
    "capture_receipt",
  );
  if (value["schema_version"] !== ACQ1_CAPTURE_SCHEMA) {
    throw new AcquisitionTransportError("invalid_response", "unknown capture receipt schema");
  }
  const digest = requireString(value["exact_bytes_sha256"], "capture_receipt.exact_bytes_sha256");
  if (!SHA256_RE.test(digest)) {
    throw new AcquisitionTransportError("invalid_response", "capture receipt digest is malformed");
  }
  const capturedAt = requireString(value["captured_at"], "capture_receipt.captured_at");
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new AcquisitionTransportError("invalid_response", "capture_receipt.captured_at is not a parseable timestamp");
  }
  return {
    capture_id: requireString(value["capture_id"], "capture_receipt.capture_id"),
    source_id: requireString(value["source_id"], "capture_receipt.source_id"),
    source_locator: requireHttpUrl(value["source_locator"], "capture_receipt.source_locator"),
    captured_at: capturedAt,
    http_metadata: validateHttpMetadata(value["http_metadata"]),
    exact_bytes_sha256: digest,
    byte_count: requireNonNegativeInteger(value["byte_count"], "capture_receipt.byte_count"),
    schema_version: ACQ1_CAPTURE_SCHEMA,
  };
}

/** Strictly validate the existing producer CaptureUrlResult. Unknown fields fail closed. */
export function validateCaptureUrlResult(input: unknown): CaptureUrlResult {
  if (!isPlainObject(input)) {
    throw new AcquisitionTransportError("invalid_response", "CaptureUrlResult must be an object");
  }
  assertExactKeys(
    input,
    [
      "tool",
      "surface_schema",
      "capture_status",
      "capture_receipt",
      "capture_id",
      "source_id",
      "source_locator",
      "captured_object_address",
      "byte_count",
      "failure_detail",
    ],
    "CaptureUrlResult",
  );
  if (input["tool"] !== ACQ1_TOOL || input["surface_schema"] !== ACQ1_SURFACE_SCHEMA) {
    throw new AcquisitionTransportError("invalid_response", "unknown acquisition tool/surface schema");
  }

  const sourceId = requireString(input["source_id"], "source_id");
  const sourceLocator = requireHttpUrl(input["source_locator"], "source_locator");

  if (input["capture_status"] === "captured") {
    const receipt = validateCaptureReceipt(input["capture_receipt"]);
    const captureId = requireString(input["capture_id"], "capture_id");
    const address = requireString(input["captured_object_address"], "captured_object_address");
    const byteCount = requireNonNegativeInteger(input["byte_count"], "byte_count");
    if (!SHA256_RE.test(address)) {
      throw new AcquisitionTransportError("invalid_response", "captured_object_address is malformed");
    }
    if (input["failure_detail"] !== null) {
      throw new AcquisitionTransportError("invalid_response", "captured result must not carry failure_detail");
    }
    if (
      captureId !== receipt.capture_id ||
      sourceId !== receipt.source_id ||
      sourceLocator !== receipt.source_locator ||
      address !== receipt.exact_bytes_sha256 ||
      byteCount !== receipt.byte_count
    ) {
      throw new AcquisitionTransportError(
        "invalid_response",
        "CaptureUrlResult top-level fields do not match the nested CaptureReceipt",
      );
    }
    return {
      tool: ACQ1_TOOL,
      surface_schema: ACQ1_SURFACE_SCHEMA,
      capture_status: "captured",
      capture_receipt: receipt,
      capture_id: captureId,
      source_id: sourceId,
      source_locator: sourceLocator,
      captured_object_address: address,
      byte_count: byteCount,
      failure_detail: null,
    };
  }

  if (input["capture_status"] === "capture_failed") {
    if (
      input["capture_receipt"] !== null ||
      input["capture_id"] !== null ||
      input["captured_object_address"] !== null ||
      input["byte_count"] !== null
    ) {
      throw new AcquisitionTransportError(
        "invalid_response",
        "capture_failed must not fabricate receipt/digest/byte-count fields",
      );
    }
    const detail = requireString(input["failure_detail"], "failure_detail");
    return {
      tool: ACQ1_TOOL,
      surface_schema: ACQ1_SURFACE_SCHEMA,
      capture_status: "capture_failed",
      capture_receipt: null,
      capture_id: null,
      source_id: sourceId,
      source_locator: sourceLocator,
      captured_object_address: null,
      byte_count: null,
      failure_detail: detail,
    };
  }

  throw new AcquisitionTransportError("invalid_response", "unknown capture_status");
}

/** True only for an uncredentialed http:// loopback origin with no path/query/hash. */
export function isSafeAcquisitionEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return (
      url.protocol === "http:" &&
      loopback &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * POST one exact BPC1 object to ACQ1 and return the strictly validated producer result.
 * The browser owns the Origin header; callers must not forge it here.
 */
export async function acquireBrowserPageCapture(
  capture: BrowserPageCapture,
  transportToken: string,
  options: AcquisitionFetchOptions = {},
): Promise<CaptureUrlResult> {
  const endpoint = options.endpoint ?? ACQ1_DEFAULT_ENDPOINT;
  if (!isSafeAcquisitionEndpoint(endpoint)) {
    throw new AcquisitionTransportError("unsafe_endpoint", "ACQ1 endpoint is not loopback http");
  }
  if (typeof transportToken !== "string" || transportToken.length === 0) {
    throw new AcquisitionTransportError("invalid_token", "ACQ1 transport token is not configured");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ACQ1_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoint}${ACQ1_OBSERVATION_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [ACQ1_TOKEN_HEADER]: transportToken,
        },
        body: JSON.stringify({ browser_page_capture: capture }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AcquisitionTransportError("timeout", "Local acquisition request timed out");
      }
      throw new AcquisitionTransportError("network_error", "Local acquisition transport is unavailable");
    }

    if (!response.ok) {
      throw new AcquisitionTransportError(
        "http_error",
        `Local acquisition transport returned HTTP ${response.status}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AcquisitionTransportError("invalid_response", "Local acquisition returned non-JSON data");
    }
    return validateCaptureUrlResult(payload);
  } finally {
    clearTimeout(timeout);
  }
}

/** Session-only token helpers. The token is never persisted to chrome.storage.local. */
export async function loadAcquisitionTransportToken(
  storage: SessionStorageLike,
): Promise<string | null> {
  const values = await storage.get(ACQ1_TOKEN_SESSION_KEY);
  const value = values[ACQ1_TOKEN_SESSION_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function saveAcquisitionTransportToken(
  storage: SessionStorageLike,
  token: string,
): Promise<void> {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new AcquisitionTransportError("invalid_token", "Transport token must be non-empty");
  }
  await storage.set({ [ACQ1_TOKEN_SESSION_KEY]: token });
}

export async function clearAcquisitionTransportToken(
  storage: SessionStorageLike,
): Promise<void> {
  await storage.remove(ACQ1_TOKEN_SESSION_KEY);
}

/** Resolve the non-secret endpoint from the demo manifest, fail-closed otherwise. */
export function acquisitionEndpointFromManifest(manifest: Record<string, unknown>): string | null {
  if (manifest["_demo_mode"] !== true) return null;
  const endpoint = manifest["_acquisition_endpoint"];
  return typeof endpoint === "string" && isSafeAcquisitionEndpoint(endpoint) ? endpoint : null;
}
