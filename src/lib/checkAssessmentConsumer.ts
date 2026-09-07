/**
 * EXT-CHECK-CONSUMER0 (R7) — external-consumer read model over a canonical
 * `counterpedia.audit_bundle.v0.2` (`AuditBundle`) + its already-minted
 * `counterpedia.check.assessment_receipt.v0_1` records.
 *
 * This is the extension-side sibling of
 * `thelaplage/counterpedia`'s `lib/counterpedia/check/pitchAssessmentConsumer.ts`
 * (R4, `CHECK-WEB-CANONICAL-CONSUMER0`, #1124) — same discipline, ported
 * independently (a different repo/runtime, not a copy-paste import, since
 * this extension cannot import Next.js application code):
 *
 *   - carries `support_state` VERBATIM from the bundle's own claims; never
 *     computes, infers, or maps a support posture;
 *   - resolves each claim's `evidence_refs` to the bundle's own
 *     `artifact_refs` digests by pure structural lookup;
 *   - matches an already-minted receipt to a claim by
 *     `assessment_check_id` and INDEPENDENTLY RECOMPUTES that receipt's
 *     digest (`assessmentReceiptRecompute.ts`) before treating it as
 *     resolved. This module never calls `buildAssessmentReceipt*` — it
 *     MINTS NOTHING;
 *   - never maps `SupportState` to `CheckResultState` or vice versa;
 *   - fails closed on malformed bundle shape, a dangling evidence ref, or a
 *     receipt digest mismatch — never a best-effort render of unrecognized
 *     shape.
 *
 * A claim with no matching, digest-verified receipt is reported as
 * `receipt: { kind: "absent", reason }` — not an error. This module never
 * fabricates a receipt to fill that gap.
 */

import { assertAssessmentReceiptDigestVerified } from "./assessmentReceiptRecompute";
import {
  AUDIT_BUNDLE_SCHEMA,
  type AssessmentAssessorKind,
  type AuditBundleLike,
  type CommittedAssessmentReceiptRecord,
  type SupportState,
} from "./checkResultContract";

export class CheckAssessmentConsumerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckAssessmentConsumerError";
  }
}

export interface ClaimEvidenceEntryReadModel {
  readonly ref_id: string;
  readonly digest: string | null;
}

export type ClaimReceiptReadModel =
  | {
      readonly kind: "present";
      readonly receipt_ref: string;
      readonly receipt_digest: string;
      readonly checked_at: string;
      readonly assessor_kind: AssessmentAssessorKind;
      readonly evaluation_basis: string;
      readonly attestation_limits: readonly string[];
    }
  | {
      readonly kind: "absent";
      readonly reason: string;
    }
  | {
      readonly kind: "digest_mismatch";
      readonly reason: string;
    };

export interface CheckAssessmentClaimReadModel {
  readonly claim_id: string;
  readonly text: string;
  readonly support_state: SupportState;
  readonly support_reason: string | null;
  readonly evidence: readonly ClaimEvidenceEntryReadModel[];
  readonly receipt: ClaimReceiptReadModel;
}

export interface CheckAssessmentReadModel {
  readonly audit_id: string;
  readonly schema_version: string;
  readonly claims: readonly CheckAssessmentClaimReadModel[];
}

function assertBundleShapeValid(bundle: AuditBundleLike): void {
  if (bundle === null || typeof bundle !== "object") {
    throw new CheckAssessmentConsumerError("EXT-CHECK-CONSUMER0: bundle is not an object.");
  }
  if (bundle.schema_version !== AUDIT_BUNDLE_SCHEMA) {
    throw new CheckAssessmentConsumerError(
      `EXT-CHECK-CONSUMER0: unrecognized bundle.schema_version ${JSON.stringify(
        bundle.schema_version,
      )}; expected ${JSON.stringify(AUDIT_BUNDLE_SCHEMA)}. Refusing to render.`,
    );
  }
  if (typeof bundle.audit_id !== "string" || bundle.audit_id.length === 0) {
    throw new CheckAssessmentConsumerError("EXT-CHECK-CONSUMER0: bundle.audit_id must be a non-empty string.");
  }
  if (!Array.isArray(bundle.claims)) {
    throw new CheckAssessmentConsumerError("EXT-CHECK-CONSUMER0: bundle.claims must be an array.");
  }
  if (!Array.isArray(bundle.artifact_refs)) {
    throw new CheckAssessmentConsumerError("EXT-CHECK-CONSUMER0: bundle.artifact_refs must be an array.");
  }
  for (const claim of bundle.claims) {
    if (
      typeof claim.claim_id !== "string" ||
      claim.claim_id.length === 0 ||
      typeof claim.text !== "string" ||
      typeof claim.support_state !== "string" ||
      !Array.isArray(claim.evidence_refs)
    ) {
      throw new CheckAssessmentConsumerError(
        "EXT-CHECK-CONSUMER0: a bundle claim is missing required fields (claim_id/text/support_state/evidence_refs).",
      );
    }
  }
}

function resolveEvidence(bundle: AuditBundleLike, refIds: readonly string[]): ClaimEvidenceEntryReadModel[] {
  const byRefId = new Map(bundle.artifact_refs.map((a) => [a.ref_id, a]));
  return refIds.map((refId) => {
    const artifact = byRefId.get(refId);
    if (artifact === undefined) {
      throw new CheckAssessmentConsumerError(
        `EXT-CHECK-CONSUMER0: evidence ref_id "${refId}" is not present in bundle.artifact_refs.`,
      );
    }
    return { ref_id: refId, digest: artifact.digest };
  });
}

async function resolveReceipt(
  bundle: AuditBundleLike,
  claimId: string,
  receipts: readonly CommittedAssessmentReceiptRecord[],
): Promise<ClaimReceiptReadModel> {
  const expectedCheckId = `assessment-check:${bundle.audit_id}:${claimId}`;
  const record = receipts.find((r) => r.payload.assessment_check_id === expectedCheckId);
  if (record === undefined) {
    return { kind: "absent", reason: "no_committed_receipt_for_this_claim" };
  }

  try {
    await assertAssessmentReceiptDigestVerified(record.payload, record.digest);
  } catch (err) {
    // Fail closed for THIS claim's receipt (never render it as resolved),
    // but this is a distinct, explicit refusal state — never silently
    // demoted to "absent" (an absent receipt and a tampered one are not the
    // same fact).
    return {
      kind: "digest_mismatch",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    kind: "present",
    receipt_ref: record.receipt_ref,
    receipt_digest: record.digest,
    checked_at: record.payload.checked_at,
    assessor_kind: record.payload.assessor_kind,
    evaluation_basis: record.payload.evaluation_basis,
    attestation_limits: record.payload.attestation_limits,
  };
}

/**
 * Builds the extension-side read model for one canonical AuditBundle + its
 * committed AssessmentReceipt records. Fails closed on any structural
 * defect; computes no support posture and mints no receipt.
 */
export async function buildCheckAssessmentReadModel(
  bundle: AuditBundleLike,
  receipts: readonly CommittedAssessmentReceiptRecord[],
): Promise<CheckAssessmentReadModel> {
  assertBundleShapeValid(bundle);

  const claims: CheckAssessmentClaimReadModel[] = [];
  for (const claim of bundle.claims) {
    claims.push({
      claim_id: claim.claim_id,
      text: claim.text,
      support_state: claim.support_state,
      support_reason: claim.support_state === "supported" ? null : (claim.rationale ?? null),
      evidence: resolveEvidence(bundle, claim.evidence_refs),
      receipt: await resolveReceipt(bundle, claim.claim_id, receipts),
    });
  }

  return {
    audit_id: bundle.audit_id,
    schema_version: AUDIT_BUNDLE_SCHEMA,
    claims,
  };
}
