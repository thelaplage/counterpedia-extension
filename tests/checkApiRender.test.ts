import { describe, expect, it } from "vitest";

import { projectCheckApiOutcomeToRenderFields } from "../src/lib/checkApiRender";
import { CHECK_ATTEMPT_SCHEMA } from "../src/lib/checkResultContract";
import type { CheckApiConsumerOutcome } from "../src/lib/checkApiConsumer";

const PRESENTATION = {
  schema: CHECK_ATTEMPT_SCHEMA,
  kind: "check_attempt" as const,
  requested_url: "https://example.com/report",
  submitted_quote_text: "an exact quote",
  submitted_proposition_text: null,
  capture_status: "captured" as const,
  capture_digest: "sha256:" + "b".repeat(64),
  capture_byte_count: 2048,
  dimensions: [
    { dimension: "source_capture" as const, state: "established" as const, reason_code: null },
    { dimension: "currentness" as const, state: "not_evaluated" as const, reason_code: "CURRENT_BYTES_UNAVAILABLE" },
  ],
  receipt_issued: false as const,
  note: "CAPTURE ATTEMPTED — RECEIPT NOT ISSUED",
};

/**
 * EXT-CHECK-CONSUMER0 (R7), acceptance item 7: the panel's rendered surface
 * may look different from the web UI, but the underlying SEMANTIC field
 * values must be byte-equal to the canonical API's own response fields —
 * never reworded, rounded, or recomputed.
 */
describe("checkApiRender: rendered fields are byte-equal to the canonical API response", () => {
  it("copies every presentation field verbatim, with no renaming/rounding/recomputation", () => {
    const outcome: CheckApiConsumerOutcome = { kind: "presentation", httpStatus: 200, presentation: PRESENTATION };
    const fields = projectCheckApiOutcomeToRenderFields(outcome);

    expect(fields.kind).toBe("presentation");
    if (fields.kind !== "presentation") throw new Error("unreachable");

    expect(fields.schema).toBe(PRESENTATION.schema);
    expect(fields.requested_url).toBe(PRESENTATION.requested_url);
    expect(fields.capture_status).toBe(PRESENTATION.capture_status);
    expect(fields.capture_digest).toBe(PRESENTATION.capture_digest);
    expect(fields.capture_byte_count).toBe(PRESENTATION.capture_byte_count);
    expect(fields.receipt_issued).toBe(PRESENTATION.receipt_issued);
    expect(fields.note).toBe(PRESENTATION.note);
    expect(fields.dimensions).toEqual(PRESENTATION.dimensions);

    // Full round-trip: every rendered field, taken together, equals the
    // subset of API-response fields it was projected from.
    expect({
      schema: fields.schema,
      requested_url: fields.requested_url,
      capture_status: fields.capture_status,
      capture_digest: fields.capture_digest,
      capture_byte_count: fields.capture_byte_count,
      dimensions: fields.dimensions,
      receipt_issued: fields.receipt_issued,
      note: fields.note,
    }).toEqual({
      schema: PRESENTATION.schema,
      requested_url: PRESENTATION.requested_url,
      capture_status: PRESENTATION.capture_status,
      capture_digest: PRESENTATION.capture_digest,
      capture_byte_count: PRESENTATION.capture_byte_count,
      dimensions: PRESENTATION.dimensions,
      receipt_issued: PRESENTATION.receipt_issued,
      note: PRESENTATION.note,
    });
  });

  it("carries the unbound detail verbatim", () => {
    const outcome: CheckApiConsumerOutcome = { kind: "unbound", httpStatus: 503, detail: "hosted runtime not bound" };
    expect(projectCheckApiOutcomeToRenderFields(outcome)).toEqual({ kind: "unbound", detail: "hosted runtime not bound" });
  });

  it("carries the unrecognized-response detail verbatim (fail-closed rendering, not a guess)", () => {
    const outcome: CheckApiConsumerOutcome = { kind: "unrecognized_response", detail: "schema mismatch" };
    expect(projectCheckApiOutcomeToRenderFields(outcome)).toEqual({ kind: "unrecognized_response", detail: "schema mismatch" });
  });

  it("carries the local transport error detail verbatim", () => {
    const outcome: CheckApiConsumerOutcome = { kind: "local_transport_error", detail: "network down" };
    expect(projectCheckApiOutcomeToRenderFields(outcome)).toEqual({ kind: "local_transport_error", detail: "network down" });
  });
});
