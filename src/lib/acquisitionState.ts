/**
 * ACQ1-HTTP client-side acquisition state.
 *
 * The single source of truth for how a browser capture progresses once it is
 * handed to the localhost acquisition producer:
 *
 *   CAPTURED -> ACQUISITION_PENDING -> RECEIPT_AVAILABLE -> UNADMITTED
 *
 * The terminal product posture is UNADMITTED. A successful acquisition proves
 * transport + producer integration ONLY; it is NOT admission, standing,
 * publication, verification, or support. This module therefore structurally
 * refuses to emit any of those four success words — acquisition success can never
 * flip a capture into an admitted/verified/published/supported state.
 *
 * Pure; no Chrome APIs, no DOM. The panel maps these states onto its existing
 * Source-Workbench postures (a RECEIPT_AVAILABLE state corresponds to the
 * existing ReceiptPosture "available"); it must not route them through the
 * demo-only ADMITTED/PROPOSED surface.
 */

import type { AcquisitionCaptureResult } from "./acquisitionResponseGuard";
import type { AcquisitionClientResult } from "./acquisitionClient";

/** The ordered acquisition lifecycle. UNADMITTED is terminal for both outcomes. */
export type AcquisitionState =
  | "CAPTURED"
  | "ACQUISITION_PENDING"
  | "RECEIPT_AVAILABLE"
  | "UNADMITTED"
  | "ACQUISITION_UNAVAILABLE"
  | "ACQUISITION_FAILED";

/**
 * Success words this lane must NEVER render as a state. Acquisition success does
 * not produce any of these; asserting on this set guards against regressions.
 */
export const FORBIDDEN_SUCCESS_STATES: ReadonlySet<string> = new Set([
  "ADMITTED",
  "VERIFIED",
  "PUBLISHED",
  "SUPPORTED",
]);

/** A UI-facing view of the acquisition result — labels only, zero authority. */
export interface AcquisitionRender {
  state: AcquisitionState;
  /** Human label for the panel. Never one of the FORBIDDEN_SUCCESS_STATES. */
  label: string;
  /** Anchored/extractive anchor is structurally unavailable in the capture lane. */
  anchorState: "UNAVAILABLE";
  /** The content address, when a capture succeeded; null otherwise. */
  capturedObjectAddress: string | null;
}

function assertNotSuccessWord(label: string): void {
  if (FORBIDDEN_SUCCESS_STATES.has(label.toUpperCase())) {
    // Defensive: a programming error, never reachable from the mappings below.
    throw new Error(
      `acquisition state must not render success word '${label}'`,
    );
  }
}

/** Map a guarded capture result to its terminal render. Never admits. */
export function renderAcquisitionResult(
  result: AcquisitionCaptureResult,
): AcquisitionRender {
  if (result.capture_status === "captured") {
    const render: AcquisitionRender = {
      state: "UNADMITTED",
      label: "Captured — UNADMITTED",
      anchorState: "UNAVAILABLE",
      capturedObjectAddress: result.captured_object_address,
    };
    assertNotSuccessWord(render.label);
    return render;
  }
  // capture_failed: an honestly-reported producer failure. Still not admitted.
  return {
    state: "ACQUISITION_FAILED",
    label: "Acquisition failed",
    anchorState: "UNAVAILABLE",
    capturedObjectAddress: null,
  };
}

/** Render for the honest "no acquisition service configured" case. */
export function renderNotConfigured(): AcquisitionRender {
  return {
    state: "ACQUISITION_UNAVAILABLE",
    label: "Acquisition service not configured",
    anchorState: "UNAVAILABLE",
    capturedObjectAddress: null,
  };
}

/** Render for a transport-level error (server unreachable / non-200 framing). */
export function renderTransportError(): AcquisitionRender {
  return {
    state: "ACQUISITION_UNAVAILABLE",
    label: "Acquisition transport unavailable",
    anchorState: "UNAVAILABLE",
    capturedObjectAddress: null,
  };
}

/** The in-flight render shown between submit and the producer's response. */
export function renderAcquisitionPending(): AcquisitionRender {
  return {
    state: "ACQUISITION_PENDING",
    label: "Sending to acquisition…",
    anchorState: "UNAVAILABLE",
    capturedObjectAddress: null,
  };
}

/**
 * Map an acquisition client result to its terminal render for the panel.
 *
 * Returns `null` for the not-configured case: acquisition is an opt-in dev
 * capability, so an unconfigured extension stays silent (no status shown) rather
 * than nagging on every capture. All other outcomes render, and none admits.
 */
export function renderAcquisitionClientResult(
  result: AcquisitionClientResult,
): AcquisitionRender | null {
  switch (result.kind) {
    case "not_configured":
      return null;
    case "captured":
    case "capture_failed":
      return renderAcquisitionResult(result.result);
    case "transport_error":
      return renderTransportError();
  }
}
