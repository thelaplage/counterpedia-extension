/**
 * EXT-CHECK-CONSUMER0 (R7) — the FROZEN vocabulary this consumer is allowed
 * to depend on.
 *
 * Source of truth (owner-declared, `AUTHORITY_MOVEMENT=0`):
 *   `thelaplage/counterpedia-audit` `docs/CHECK_ENGINE_RESULT_CONTRACT_FROZEN0.md`
 *   @ `e8534529` and `docs/CHECK_OWNERSHIP_RECON1.md`.
 *
 * This module is a bag of CONSTANTS AND STRUCTURAL TYPES, mirrored verbatim
 * from the producer repos this lane consumes:
 *   - `thelaplage/counterpedia` `lib/counterpedia/check/checkReceipt.ts`
 *     (`CHECK_RESULT_STATES`, citation `CheckReceipt` v0.1 — closed
 *     `check_kind: "citation_check"`, unchanged here).
 *   - `thelaplage/counterpedia` `lib/counterpedia/check/checkAttempt.ts`
 *     (`CHECK_ATTEMPT_SCHEMA`, `CHECK_ATTEMPT_DIMENSIONS`,
 *     `CheckAttemptDimensionState`, `CheckAttemptPresentation` — the actual
 *     response shape of the canonical `POST /api/check/new` funnel).
 *   - `thelaplage/counterpedia` `lib/counterpedia/check/assessmentReceipt.ts`
 *     (`ASSESSMENT_RECEIPT_SCHEMA`, `SUPPORT_STATES` — the disjoint
 *     `SupportState` vocabulary, and `AssessmentReceiptFields`).
 *   - `thelaplage/counterpedia-audit` `AuditBundle` (`schema_version:
 *     "counterpedia.audit_bundle.v0.2"`), as consumed by
 *     `thelaplage/counterpedia`'s
 *     `lib/counterpedia/check/pitchAssessmentConsumer.ts` (R4,
 *     `CHECK-WEB-CANONICAL-CONSUMER0`, #1124).
 *
 * NOTHING in this module computes a result, infers support, or maps one
 * vocabulary onto another. It only names the shapes this consumer is
 * permitted to read.
 *
 * `CheckResultState` (established / not_established / not_evaluated) and
 * `SupportState` (supported / partial / unsupported / indeterminate /
 * not_evaluated) remain two disjoint vocabularies here exactly as frozen —
 * no mapping is defined between them anywhere in this repo.
 */

// ---------------------------------------------------------------------------
// CheckReceipt v0.1 (citation_check) — result vocabulary only. Unchanged.
// ---------------------------------------------------------------------------

export const CHECK_RESULT_STATES = ["established", "not_established", "not_evaluated"] as const;
export type CheckResultState = (typeof CHECK_RESULT_STATES)[number];

export const CHECK_RECEIPT_SCHEMA = "counterpedia.check.receipt.v0_1" as const;

// ---------------------------------------------------------------------------
// CheckAttempt v0.1 — the actual response shape of `POST /api/check/new`,
// the live canonical CHECK API this consumer's URL-driven path calls.
// A CheckAttempt is explicitly NOT a CheckReceipt (see checkAttempt.ts's
// header in the producer repo): `receipt_issued` is a fixed `false` literal.
// ---------------------------------------------------------------------------

export const CHECK_ATTEMPT_SCHEMA = "counterpedia.check.attempt.v0_1" as const;

export const CHECK_ATTEMPT_DIMENSION_STATES = ["established", "not_evaluated"] as const;
export type CheckAttemptDimensionState = (typeof CHECK_ATTEMPT_DIMENSION_STATES)[number];

export const CHECK_ATTEMPT_DIMENSIONS = [
  "source_capture",
  "currentness",
  "quote_integrity",
  "proposition_support",
  "citation_resolution",
] as const;
export type CheckAttemptDimensionName = (typeof CHECK_ATTEMPT_DIMENSIONS)[number];

export interface CheckAttemptDimension {
  readonly dimension: CheckAttemptDimensionName;
  readonly state: CheckAttemptDimensionState;
  readonly reason_code: string | null;
}

export const CHECK_ATTEMPT_CAPTURE_STATUSES = [
  "invalid_url",
  "not_configured",
  "invalid_config",
  "refused",
  "transport_error",
  "capture_failed",
  "captured",
] as const;
export type CheckAttemptCaptureStatus = (typeof CHECK_ATTEMPT_CAPTURE_STATUSES)[number];

/**
 * Structural mirror of `CheckAttemptPresentation`
 * (`counterpedia/lib/counterpedia/check/checkAttempt.ts`). Carried verbatim
 * — this consumer renders these fields, it does not recompute any of them.
 */
export interface CheckAttemptPresentation {
  readonly schema: typeof CHECK_ATTEMPT_SCHEMA;
  readonly kind: "check_attempt";
  readonly requested_url: string;
  readonly submitted_quote_text: string | null;
  readonly submitted_proposition_text: string | null;
  readonly capture_status: CheckAttemptCaptureStatus;
  readonly capture_digest: string | null;
  readonly capture_byte_count: number | null;
  readonly dimensions: readonly CheckAttemptDimension[];
  readonly receipt_issued: false;
  readonly note: string;
}

// ---------------------------------------------------------------------------
// Support-Assessment Check v0.1 — disjoint SupportState vocabulary, NEVER
// mapped to CheckResultState above.
// ---------------------------------------------------------------------------

export const ASSESSMENT_RECEIPT_SCHEMA = "counterpedia.check.assessment_receipt.v0_1" as const;

export const SUPPORT_STATES = ["supported", "partial", "unsupported", "indeterminate", "not_evaluated"] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

export const ASSESSMENT_ASSESSOR_KINDS = ["deterministic_comparator", "human", "not_attributed"] as const;
export type AssessmentAssessorKind = (typeof ASSESSMENT_ASSESSOR_KINDS)[number];

export const CHECK_ATTRIBUTION_EVIDENCE_CLASSES = ["caller_declared", "operator_verified"] as const;
export type CheckAttributionEvidenceClass = (typeof CHECK_ATTRIBUTION_EVIDENCE_CLASSES)[number];

export interface CheckAttributionField {
  readonly value: string;
  readonly evidence_class: CheckAttributionEvidenceClass;
}

/** Structural mirror of `AssessmentReceiptFields` (assessmentReceipt.ts). */
export interface AssessmentReceiptFields {
  readonly assessment_check_id: string;
  readonly assessment_subject_digest: string;
  readonly check_kind: "support_assessment_check";
  readonly checked_at: string;
  readonly support_state: SupportState;
  readonly support_reason: string | null;
  readonly assessor_kind: AssessmentAssessorKind;
  readonly source_audit_id: string;
  readonly attestation_limits: readonly string[];
  readonly proposal_origin: CheckAttributionField;
  readonly automation_role: CheckAttributionField;
  readonly evaluation_basis: string;
  readonly visibility: "private" | "public";
}

export interface CommittedAssessmentReceiptRecord {
  readonly claim_id: string;
  readonly payload: AssessmentReceiptFields;
  readonly digest: string;
  readonly receipt_ref: string;
}

// ---------------------------------------------------------------------------
// AuditBundle v0.2 — structural mirror only (counterpedia-audit owns this
// schema; this consumer never computes a claim's support posture).
// ---------------------------------------------------------------------------

export const AUDIT_BUNDLE_SCHEMA = "counterpedia.audit_bundle.v0.2" as const;

export interface AuditArtifactRefLike {
  readonly ref_id: string;
  readonly digest: string | null;
}

export interface AuditClaimLike {
  readonly claim_id: string;
  readonly text: string;
  readonly support_state: SupportState;
  readonly evidence_refs: readonly string[];
  readonly rationale?: string | null;
  readonly assessor_kind?: AssessmentAssessorKind | null;
}

export interface AuditBundleLike {
  readonly schema_version: string;
  readonly audit_id: string;
  readonly claims: readonly AuditClaimLike[];
  readonly artifact_refs: readonly AuditArtifactRefLike[];
}

export const SHA256_REF_RE = /^sha256:[0-9a-f]{64}$/;
