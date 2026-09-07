import { describe, expect, it } from "vitest";

import { buildCheckAssessmentReadModel, CheckAssessmentConsumerError } from "../src/lib/checkAssessmentConsumer";
import type { AuditBundleLike, CommittedAssessmentReceiptRecord } from "../src/lib/checkResultContract";
import { loadWave1PitchAuditBundleFixture } from "./fixtures/assessmentReceipt/wave1PitchAuditBundleFixture";
import { loadWave1PitchAssessmentReceiptsFixture } from "./fixtures/assessmentReceipt/wave1PitchAssessmentReceiptsFixture";

/**
 * EXT-CHECK-CONSUMER0 (R7): proves this extension-side adapter is a
 * CONSUMER, not a second evaluator, over the SAME committed fixture bytes
 * `thelaplage/counterpedia`'s `pitchAssessmentConsumer.test.ts` (R4, #1124)
 * exercises. Same assertions, ported independently — this is the item-8
 * "same underlying CHECK result from identical bytes" proof: both consumers
 * project 2 supported / 1 not_evaluated from the SAME `wave1PitchAuditBundle.json`
 * (git blob `e9f35aec1a195ed343304819d5eb1bb884aeeb4b`, byte-identical to
 * `counterpedia`'s copy) and the SAME receipts fixture (git blob
 * `19cb3804f020fc955e6184f2ccc8ca9eeaf1238c`).
 */
describe("checkAssessmentConsumer: external CONSUMER adapter over the same fixture bytes as counterpedia's R4 consumer", () => {
  const bundle = loadWave1PitchAuditBundleFixture();
  const receipts = loadWave1PitchAssessmentReceiptsFixture();

  it("parses the genuine bundle + committed receipts into a read model with 2 supported / 1 not_evaluated", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    expect(model.audit_id).toBe(bundle.audit_id);
    expect(model.claims).toHaveLength(3);
    const states = model.claims.map((c) => c.support_state);
    expect(states.filter((s) => s === "supported")).toHaveLength(2);
    expect(states.filter((s) => s === "not_evaluated")).toHaveLength(1);
  });

  it("carries support_state VERBATIM from the producer — never recomputed or mapped", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    for (const claim of model.claims) {
      const source = bundle.claims.find((c) => c.claim_id === claim.claim_id);
      expect(source).toBeDefined();
      expect(claim.support_state).toBe(source!.support_state);
    }
  });

  it("never emits a CheckResultState value (established/not_established) anywhere in support_state — the two vocabularies stay disjoint", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    for (const claim of model.claims) {
      expect(claim.support_state).not.toBe("established");
      expect(claim.support_state).not.toBe("not_established");
    }
  });

  it("resolves evidence refs to the bundle's own artifact digests, verbatim, including a genuine null digest", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    const attribution = model.claims.find((c) => c.claim_id === "obs-wave1-assessment0-attribution-usreports0");
    expect(attribution).toBeDefined();
    expect(attribution!.evidence.some((e) => e.digest === null)).toBe(true);
  });

  it("attaches a digest-verified receipt for each mintable claim (rfc0 not_evaluated, edgar0 supported)", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    for (const claimId of ["obs-wave1-assessment0-supersession-rfc0", "obs-wave1-assessment0-falsepremise-edgar0"]) {
      const claim = model.claims.find((c) => c.claim_id === claimId);
      expect(claim).toBeDefined();
      expect(claim!.receipt.kind).toBe("present");
    }
  });

  it("independently recomputes each present receipt's digest and it matches the committed digest exactly", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    for (const claim of model.claims) {
      if (claim.receipt.kind === "present") {
        const committed = receipts.find((r) => r.claim_id === claim.claim_id);
        expect(committed).toBeDefined();
        expect(claim.receipt.receipt_digest).toBe(committed!.digest);
        expect(claim.receipt.receipt_ref).toBe(committed!.receipt_ref);
      }
    }
  });

  it("honestly reports NO receipt for the null-digest attribution claim — does not fabricate one", async () => {
    const model = await buildCheckAssessmentReadModel(bundle, receipts);
    const attribution = model.claims.find((c) => c.claim_id === "obs-wave1-assessment0-attribution-usreports0");
    expect(attribution!.receipt.kind).toBe("absent");
    if (attribution!.receipt.kind === "absent") {
      expect(attribution!.receipt.reason).toBe("no_committed_receipt_for_this_claim");
    }
  });

  it("fails closed on a bundle with the wrong/unrecognized schema_version", async () => {
    const malformed = { ...bundle, schema_version: "counterpedia.audit_bundle.v0.1" } as unknown as AuditBundleLike;
    await expect(buildCheckAssessmentReadModel(malformed, receipts)).rejects.toThrow(CheckAssessmentConsumerError);
  });

  it("fails closed when a claim references an evidence ref_id absent from artifact_refs", async () => {
    const malformed: AuditBundleLike = {
      ...bundle,
      claims: [{ ...bundle.claims[0]!, evidence_refs: ["does-not-exist:primary-evidence:99"] }],
    };
    await expect(buildCheckAssessmentReadModel(malformed, receipts)).rejects.toThrow(CheckAssessmentConsumerError);
  });

  it("reports (never throws past) a digest_mismatch when a committed receipt is tampered with", async () => {
    const tampered: CommittedAssessmentReceiptRecord[] = receipts.map((r) =>
      r.claim_id === "obs-wave1-assessment0-falsepremise-edgar0"
        ? { ...r, payload: { ...r.payload, support_state: "unsupported" as const, support_reason: "tampered" } }
        : r,
    );
    const model = await buildCheckAssessmentReadModel(bundle, tampered);
    const claim = model.claims.find((c) => c.claim_id === "obs-wave1-assessment0-falsepremise-edgar0");
    expect(claim!.receipt.kind).toBe("digest_mismatch");
  });

  it("fails closed on a bundle missing required top-level fields", async () => {
    const malformed = { ...bundle, audit_id: "" } as unknown as AuditBundleLike;
    await expect(buildCheckAssessmentReadModel(malformed, receipts)).rejects.toThrow(CheckAssessmentConsumerError);
  });
});
