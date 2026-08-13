/**
 * Acquisition state tests — success never flips to admitted/verified/published/
 * supported, and the terminal posture of a successful capture is UNADMITTED.
 */

import { describe, it, expect } from "vitest";
import {
  renderAcquisitionResult,
  renderNotConfigured,
  renderTransportError,
  FORBIDDEN_SUCCESS_STATES,
} from "../src/lib/acquisitionState";
import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";

const captured: AcquisitionCaptureResult = {
  tool: "acquisition.capture_url",
  surface_schema: "acquisition.mcp_surface.v0.1",
  capture_status: "captured",
  capture_id: "cap-1",
  source_id: "sha256:s",
  source_locator: "http://127.0.0.1:9/page",
  captured_object_address: "sha256:" + "a".repeat(64),
  byte_count: 10,
  failure_detail: null,
  capture_receipt: { exact_bytes_sha256: "sha256:" + "a".repeat(64) },
};

const failed: AcquisitionCaptureResult = {
  ...captured,
  capture_status: "capture_failed",
  capture_id: null,
  captured_object_address: null,
  byte_count: null,
  failure_detail: "fetch failed",
  capture_receipt: null,
};

describe("terminal posture", () => {
  it("a successful capture is UNADMITTED with the content address surfaced", () => {
    const r = renderAcquisitionResult(captured);
    expect(r.state).toBe("UNADMITTED");
    expect(r.capturedObjectAddress).toBe("sha256:" + "a".repeat(64));
    expect(r.anchorState).toBe("UNAVAILABLE");
  });

  it("a producer capture_failed renders ACQUISITION_FAILED, not admitted", () => {
    const r = renderAcquisitionResult(failed);
    expect(r.state).toBe("ACQUISITION_FAILED");
    expect(r.capturedObjectAddress).toBeNull();
  });

  it("not-configured and transport-error render as unavailable", () => {
    expect(renderNotConfigured().state).toBe("ACQUISITION_UNAVAILABLE");
    expect(renderTransportError().state).toBe("ACQUISITION_UNAVAILABLE");
  });
});

describe("success words are never rendered", () => {
  it("no render label is one of ADMITTED/VERIFIED/PUBLISHED/SUPPORTED", () => {
    const renders = [
      renderAcquisitionResult(captured),
      renderAcquisitionResult(failed),
      renderNotConfigured(),
      renderTransportError(),
    ];
    for (const render of renders) {
      expect(FORBIDDEN_SUCCESS_STATES.has(render.label.toUpperCase())).toBe(
        false,
      );
      expect(FORBIDDEN_SUCCESS_STATES.has(render.state)).toBe(false);
    }
  });

  it("anchor is always UNAVAILABLE (capture lane has no anchor production)", () => {
    expect(renderAcquisitionResult(captured).anchorState).toBe("UNAVAILABLE");
  });
});
