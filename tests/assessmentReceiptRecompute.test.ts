import { describe, expect, it } from "vitest";

import {
  AssessmentReceiptRecomputeMismatchError,
  assertAssessmentReceiptDigestVerified,
  recomputeAssessmentReceiptDigest,
} from "../src/lib/assessmentReceiptRecompute";
import { loadWave1PitchAssessmentReceiptsFixture } from "./fixtures/assessmentReceipt/wave1PitchAssessmentReceiptsFixture";

/**
 * EXT-CHECK-CONSUMER0 (R7), acceptance item 5: independently dereference/
 * recompute the assessment receipt digest from this consumer's own side,
 * reusing the published recompute pattern (sorted-key canonical JSON +
 * SHA-256, "sha256:<hex>") rather than inventing a dialect.
 */
describe("assessmentReceiptRecompute: independent digest recompute", () => {
  const receipts = loadWave1PitchAssessmentReceiptsFixture();

  it("recomputes the EXACT already-committed digest for every fixture receipt", async () => {
    expect(receipts.length).toBeGreaterThan(0);
    for (const record of receipts) {
      const recomputed = await recomputeAssessmentReceiptDigest(record.payload);
      expect(recomputed).toBe(record.digest);
    }
  });

  it("assertAssessmentReceiptDigestVerified resolves silently on a genuine match", async () => {
    const record = receipts[0]!;
    await expect(assertAssessmentReceiptDigestVerified(record.payload, record.digest)).resolves.toBeUndefined();
  });

  it("fails closed (throws) when the claimed digest does not match the recomputed one", async () => {
    const record = receipts[0]!;
    await expect(assertAssessmentReceiptDigestVerified(record.payload, "sha256:" + "0".repeat(64))).rejects.toBeInstanceOf(
      AssessmentReceiptRecomputeMismatchError,
    );
  });

  it("fails closed when the payload itself is tampered with after minting", async () => {
    const record = receipts[0]!;
    const tampered = { ...record.payload, support_reason: "a different reason than what was minted" };
    const recomputed = await recomputeAssessmentReceiptDigest(tampered);
    expect(recomputed).not.toBe(record.digest);
  });
});
