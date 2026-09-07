/**
 * EXT-CHECK-CONSUMER0 (R7) — independent recompute of an already-minted
 * `AssessmentReceipt` (`counterpedia.check.assessment_receipt.v0_1`) digest.
 *
 * Ports (does not reinvent) the exact canonical-payload assembly
 * `thelaplage/counterpedia`'s `lib/counterpedia/check/assessmentReceipt.ts`
 * uses in `computeAssessmentReceiptDigest`/`assessmentReceiptCanonicalPayload`:
 * spread the receipt fields, overwrite `schema` last (so an untrusted-JSON
 * ingress path can never shadow the canonical discriminator), sort
 * `attestation_limits` (the one array field whose element order the
 * canonicalizer does not itself resort). This module MINTS NOTHING — it
 * only recomputes a digest FROM an already-produced payload and reports
 * whether it matches the digest that payload claims for itself. It never
 * calls anything named `buildAssessmentReceipt*`.
 */

import { canonicalJson, sha256Digest } from "./canonicalDigest";
import { ASSESSMENT_RECEIPT_SCHEMA, type AssessmentReceiptFields } from "./checkResultContract";

function assessmentReceiptCanonicalPayload(fields: AssessmentReceiptFields): Record<string, unknown> {
  return {
    ...fields,
    schema: ASSESSMENT_RECEIPT_SCHEMA,
    attestation_limits: [...fields.attestation_limits].sort(),
  };
}

/** Independently recomputes an AssessmentReceipt digest from its own payload bytes. */
export async function recomputeAssessmentReceiptDigest(fields: AssessmentReceiptFields): Promise<string> {
  return sha256Digest(canonicalJson(assessmentReceiptCanonicalPayload(fields)));
}

export class AssessmentReceiptRecomputeMismatchError extends Error {
  constructor(
    message: string,
    readonly claimedDigest: string,
    readonly recomputedDigest: string,
  ) {
    super(message);
    this.name = "AssessmentReceiptRecomputeMismatchError";
  }
}

/**
 * Recomputes and compares against `claimedDigest`. Throws (fail-closed) on
 * mismatch rather than returning a boolean a caller could accidentally
 * ignore.
 */
export async function assertAssessmentReceiptDigestVerified(
  fields: AssessmentReceiptFields,
  claimedDigest: string,
): Promise<void> {
  const recomputed = await recomputeAssessmentReceiptDigest(fields);
  if (recomputed !== claimedDigest) {
    throw new AssessmentReceiptRecomputeMismatchError(
      `EXT-CHECK-CONSUMER0: assessment receipt digest mismatch — claimed ${claimedDigest}, recomputed ${recomputed}. Refusing to treat as resolved.`,
      claimedDigest,
      recomputed,
    );
  }
}
