/**
 * ACQ1-HTTP response guard (client-side allow-list).
 *
 * The localhost acquisition server already validates its own output, but the
 * extension MUST NOT trust a response merely because it came from localhost.
 * This guard is the client-side half of the defense-in-depth: it fails closed on
 * any response that is not EXACTLY the authorized `CaptureUrlResult` projection.
 *
 * It is deliberately dumb about acquisition semantics — it carries the producer's
 * metadata-only projection and refuses anything that tries to smuggle epistemic
 * authority (admission / standing / publication / verification / ClaimSupportEdge
 * / support_type / governance_state) into the client. No Chrome APIs; pure and
 * fully unit-testable.
 */

/** The two — and only two — capture dispositions the producer emits. */
export type AcquisitionCaptureStatus = "captured" | "capture_failed";

/**
 * The authorized response projection. This mirrors the producer-owned
 * `CaptureUrlResult` contract (`thelaplage/counterpedia-acquisition` →
 * `mcp_surface.py`); the extension consumes it, it does not become a second
 * schema authority. `capture_receipt` is kept as an opaque guarded object: the
 * client never re-types or re-canonicalizes the producer's receipt.
 */
export interface AcquisitionCaptureResult {
  tool: string;
  surface_schema: string;
  capture_status: AcquisitionCaptureStatus;
  capture_id: string | null;
  source_id: string | null;
  source_locator: string | null;
  /** Content address of the fetched bytes, e.g. `sha256:<64 hex>`, or null. */
  captured_object_address: string | null;
  byte_count: number | null;
  failure_detail: string | null;
  capture_receipt: Record<string, unknown> | null;
}

/** Raised when a response is not exactly the authorized projection. */
export class AcquisitionResponseError extends Error {
  constructor(reason: string) {
    super(`acquisition response rejected: ${reason}`);
    this.name = "AcquisitionResponseError";
  }
}

/** Exactly the allowed top-level keys. Any other key fails the response closed. */
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "tool",
  "surface_schema",
  "capture_status",
  "capture_id",
  "source_id",
  "source_locator",
  "captured_object_address",
  "byte_count",
  "failure_detail",
  "capture_receipt",
]);

/**
 * Governance/authority keys that must never appear ANYWHERE in an acquisition
 * response. Their presence (at any nesting depth) marks a contaminated response
 * that is trying to promote a capture into a claim/admission/support edge.
 */
const FORBIDDEN_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "standing",
  "admitted",
  "admission",
  "admission_result",
  "admissiondecision",
  "published",
  "publication",
  "verified",
  "verification",
  "support_type",
  "governance_state",
  "claim_support_edge",
  "claimsupportedge",
  "authority",
  "authorized",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively assert no forbidden authority key appears at any depth. */
function assertNoForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new AcquisitionResponseError(
        `contaminated with authority-bearing field '${key}' at ${path}`,
      );
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function requireStringOrNull(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (v === null || typeof v === "string") return v ?? null;
  throw new AcquisitionResponseError(`field '${key}' must be string|null`);
}

/**
 * Parse and validate a raw acquisition response, failing closed.
 *
 * @throws AcquisitionResponseError on any deviation from the authorized projection.
 */
export function parseAcquisitionCaptureResult(
  raw: unknown,
): AcquisitionCaptureResult {
  if (!isPlainObject(raw)) {
    throw new AcquisitionResponseError("response is not a JSON object");
  }

  // (1) Exact allow-list: no unknown top-level keys.
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new AcquisitionResponseError(`unknown top-level field '${key}'`);
    }
  }

  // (2) No authority-bearing key anywhere (incl. inside capture_receipt).
  assertNoForbiddenKeys(raw, "$");

  // (3) Pin the capture_status enum — never trust an arbitrary status string.
  const status = raw["capture_status"];
  if (status !== "captured" && status !== "capture_failed") {
    throw new AcquisitionResponseError(
      `capture_status must be 'captured' or 'capture_failed'`,
    );
  }

  // (4) Structural field types.
  const tool = raw["tool"];
  const surfaceSchema = raw["surface_schema"];
  if (typeof tool !== "string" || typeof surfaceSchema !== "string") {
    throw new AcquisitionResponseError("tool/surface_schema must be strings");
  }
  const byteCount = raw["byte_count"];
  if (byteCount !== null && typeof byteCount !== "number") {
    throw new AcquisitionResponseError("byte_count must be number|null");
  }
  const receipt = raw["capture_receipt"];
  if (receipt !== null && !isPlainObject(receipt)) {
    throw new AcquisitionResponseError("capture_receipt must be object|null");
  }

  // (5) Cross-field honesty: a successful capture must carry a content address;
  // a failed capture must NOT masquerade as having produced one.
  const address = requireStringOrNull(raw, "captured_object_address");
  if (status === "captured" && !address) {
    throw new AcquisitionResponseError(
      "capture_status 'captured' without captured_object_address",
    );
  }
  if (status === "capture_failed" && (address !== null || receipt !== null)) {
    throw new AcquisitionResponseError(
      "capture_status 'capture_failed' must not carry a receipt/address",
    );
  }

  return {
    tool,
    surface_schema: surfaceSchema,
    capture_status: status,
    capture_id: requireStringOrNull(raw, "capture_id"),
    source_id: requireStringOrNull(raw, "source_id"),
    source_locator: requireStringOrNull(raw, "source_locator"),
    captured_object_address: address,
    byte_count: (byteCount ?? null) as number | null,
    failure_detail: requireStringOrNull(raw, "failure_detail"),
    capture_receipt: (receipt ?? null) as Record<string, unknown> | null,
  };
}

/** Non-throwing variant: returns null instead of raising. */
export function tryParseAcquisitionCaptureResult(
  raw: unknown,
): AcquisitionCaptureResult | null {
  try {
    return parseAcquisitionCaptureResult(raw);
  } catch (err) {
    if (err instanceof AcquisitionResponseError) return null;
    throw err;
  }
}
