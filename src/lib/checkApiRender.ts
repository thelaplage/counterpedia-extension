/**
 * EXT-CHECK-CONSUMER0 (R7) — pure projection from a `checkApiConsumer`
 * outcome to the fields the panel renders.
 *
 * Kept separate from DOM wiring (`panel/checkConsumer.ts`) so the semantic
 * equality this lane must prove (rendered fields === the canonical API
 * response's own fields, byte-for-byte, never recomputed/reworded into a
 * different value) is directly unit-testable without a DOM.
 *
 * This module renders; it computes nothing. Every value below is read
 * verbatim off `CheckApiConsumerOutcome`/`CheckAttemptPresentation`.
 */

import type { CheckApiConsumerOutcome } from "./checkApiConsumer";
import type { CheckAttemptDimension } from "./checkResultContract";

export interface CheckApiRenderDimensionField {
  readonly dimension: CheckAttemptDimension["dimension"];
  readonly state: CheckAttemptDimension["state"];
  readonly reason_code: CheckAttemptDimension["reason_code"];
}

export type CheckApiRenderFields =
  | {
      readonly kind: "presentation";
      readonly schema: string;
      readonly requested_url: string;
      readonly capture_status: string;
      readonly capture_digest: string | null;
      readonly capture_byte_count: number | null;
      readonly dimensions: readonly CheckApiRenderDimensionField[];
      readonly receipt_issued: false;
      readonly note: string;
    }
  | { readonly kind: "unbound"; readonly detail: string }
  | { readonly kind: "unrecognized_response"; readonly detail: string }
  | { readonly kind: "local_transport_error"; readonly detail: string };

/**
 * Projects a `CheckApiConsumerOutcome` to the exact set of fields the panel
 * displays. For the `presentation` case every field is copied verbatim from
 * `outcome.presentation` — no renaming, no recomputation, no rounding.
 */
export function projectCheckApiOutcomeToRenderFields(outcome: CheckApiConsumerOutcome): CheckApiRenderFields {
  if (outcome.kind === "presentation") {
    const p = outcome.presentation;
    return {
      kind: "presentation",
      schema: p.schema,
      requested_url: p.requested_url,
      capture_status: p.capture_status,
      capture_digest: p.capture_digest,
      capture_byte_count: p.capture_byte_count,
      dimensions: p.dimensions.map((d) => ({ dimension: d.dimension, state: d.state, reason_code: d.reason_code })),
      receipt_issued: p.receipt_issued,
      note: p.note,
    };
  }
  if (outcome.kind === "unbound") {
    return { kind: "unbound", detail: outcome.detail };
  }
  if (outcome.kind === "unrecognized_response") {
    return { kind: "unrecognized_response", detail: outcome.detail };
  }
  return { kind: "local_transport_error", detail: outcome.detail };
}
