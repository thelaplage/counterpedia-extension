/**
 * RECOVERY-BIND0 response guard (client-side allow-list).
 *
 * The localhost `/v0/recovery-assessment` server validates its own output, but the
 * extension MUST NOT trust a response merely because it came from localhost. This
 * is the client-side half of the defense-in-depth: it fails closed on any response
 * that is not EXACTLY the authorized `acquisition.capture_recovery_surface.v0.1`
 * projection, and refuses any authority/admission/standing/publication field at any
 * depth. Recovery is an OBSERVATION about a captured artifact — never source
 * validity, truth, authority, or admission. No Chrome APIs; pure and unit-testable.
 */

export type RecoveryAssessmentStatus =
  | "assessed"
  | "held_capture_not_found"
  | "held_capture_invalid";

export type RecoveryOutcome =
  | "RECOVERED"
  | "STILL_NOT_OBSERVED"
  | "AMBIGUOUS"
  | "NOT_ELIGIBLE";

/** The recovery observation. Opaque-ish: we pin the fields we render/decide on. */
export interface RecoveryObservation {
  schema_version: string;
  baseline_capture_ref: string;
  baseline_exact_bytes_sha256: string;
  baseline_content_posture: string;
  eligibility: string;
  browser_observation_sha256: string;
  browser_comparison: string;
  recovery_outcome: RecoveryOutcome;
  [k: string]: unknown;
}

export interface RecoveryAssessmentResult {
  tool: string;
  surface_schema: string;
  assessment_status: RecoveryAssessmentStatus;
  capture_ref: string;
  baseline_capture_receipt: Record<string, unknown> | null;
  recovery_observation: RecoveryObservation | null;
  failure_detail: string | null;
}

export class RecoveryResponseError extends Error {
  constructor(reason: string) {
    super(`recovery response rejected: ${reason}`);
    this.name = "RecoveryResponseError";
  }
}

const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "tool",
  "surface_schema",
  "assessment_status",
  "capture_ref",
  "baseline_capture_receipt",
  "recovery_observation",
  "failure_detail",
]);

const FORBIDDEN_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "standing",
  "admitted",
  "admission",
  "admission_result",
  "published",
  "publication",
  "verified",
  "verification",
  "support_type",
  "governance_state",
  "claim_support_edge",
  "authority",
  "authorized",
  "source_equivalence",
]);

const _STATUSES: ReadonlySet<string> = new Set([
  "assessed",
  "held_capture_not_found",
  "held_capture_invalid",
]);
const _OUTCOMES: ReadonlySet<string> = new Set([
  "RECOVERED",
  "STILL_NOT_OBSERVED",
  "AMBIGUOUS",
  "NOT_ELIGIBLE",
]);
const _SHA256 = /^sha256:[0-9a-f]{64}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertNoForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new RecoveryResponseError(
        `contaminated with authority-bearing field '${key}' at ${path}`,
      );
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new RecoveryResponseError(`field '${key}' must be a string`);
  return v;
}

/** Parse and validate a raw recovery-assessment response, failing closed. */
export function parseRecoveryAssessmentResult(raw: unknown): RecoveryAssessmentResult {
  if (!isPlainObject(raw)) throw new RecoveryResponseError("response is not a JSON object");

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new RecoveryResponseError(`unknown top-level field '${key}'`);
    }
  }
  assertNoForbiddenKeys(raw, "$");

  const status = raw["assessment_status"];
  if (typeof status !== "string" || !_STATUSES.has(status)) {
    throw new RecoveryResponseError("assessment_status is not one of the pinned values");
  }
  const tool = requireString(raw, "tool");
  const surfaceSchema = requireString(raw, "surface_schema");
  const captureRef = requireString(raw, "capture_ref");

  const failureDetailRaw = raw["failure_detail"];
  if (failureDetailRaw !== null && typeof failureDetailRaw !== "string") {
    throw new RecoveryResponseError("failure_detail must be string|null");
  }

  const receipt = raw["baseline_capture_receipt"];
  if (receipt !== null && !isPlainObject(receipt)) {
    throw new RecoveryResponseError("baseline_capture_receipt must be object|null");
  }

  const obsRaw = raw["recovery_observation"];
  let observation: RecoveryObservation | null = null;

  if (status === "assessed") {
    if (!isPlainObject(obsRaw)) {
      throw new RecoveryResponseError("assessed response must carry a recovery_observation object");
    }
    const outcome = obsRaw["recovery_outcome"];
    if (typeof outcome !== "string" || !_OUTCOMES.has(outcome)) {
      throw new RecoveryResponseError("recovery_outcome is not one of the pinned values");
    }
    const digest = obsRaw["browser_observation_sha256"];
    if (typeof digest !== "string" || !_SHA256.test(digest)) {
      throw new RecoveryResponseError("browser_observation_sha256 is not a valid sha256 digest");
    }
    const baselineDigest = obsRaw["baseline_exact_bytes_sha256"];
    if (typeof baselineDigest !== "string" || !_SHA256.test(baselineDigest)) {
      throw new RecoveryResponseError("baseline_exact_bytes_sha256 is not a valid sha256 digest");
    }
    observation = {
      schema_version: requireString(obsRaw, "schema_version"),
      baseline_capture_ref: requireString(obsRaw, "baseline_capture_ref"),
      baseline_exact_bytes_sha256: baselineDigest,
      baseline_content_posture: requireString(obsRaw, "baseline_content_posture"),
      eligibility: requireString(obsRaw, "eligibility"),
      browser_observation_sha256: digest,
      browser_comparison: requireString(obsRaw, "browser_comparison"),
      recovery_outcome: outcome as RecoveryOutcome,
      ...obsRaw,
      recovery_outcome_pinned: outcome,
    } as RecoveryObservation;
  } else if (obsRaw !== null) {
    throw new RecoveryResponseError(
      `non-assessed status '${status}' must not carry a recovery_observation`,
    );
  }

  return {
    tool,
    surface_schema: surfaceSchema,
    assessment_status: status as RecoveryAssessmentStatus,
    capture_ref: captureRef,
    baseline_capture_receipt: (receipt ?? null) as Record<string, unknown> | null,
    recovery_observation: observation,
    failure_detail: (failureDetailRaw ?? null) as string | null,
  };
}

export function tryParseRecoveryAssessmentResult(raw: unknown): RecoveryAssessmentResult | null {
  try {
    return parseRecoveryAssessmentResult(raw);
  } catch (err) {
    if (err instanceof RecoveryResponseError) return null;
    throw err;
  }
}
