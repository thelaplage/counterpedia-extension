/**
 * Client-side response-guard tests (defense-in-depth: the extension does not
 * trust a response merely because it came from localhost).
 *
 * Covers HTTP-03 (authority-field injection rejected) and HTTP-04 (contaminated
 * server response rejected) from the client side.
 */

import { describe, it, expect } from "vitest";
import {
  parseAcquisitionCaptureResult,
  tryParseAcquisitionCaptureResult,
  AcquisitionResponseError,
} from "../src/lib/acquisitionResponseGuard";

const CAPTURED = {
  tool: "acquisition.capture_url",
  surface_schema: "acquisition.mcp_surface.v0.1",
  capture_status: "captured",
  capture_id: "capture-123",
  source_id: "sha256:aaa",
  source_locator: "http://127.0.0.1:9/page",
  captured_object_address: "sha256:" + "a".repeat(64),
  byte_count: 57,
  failure_detail: null,
  capture_receipt: { exact_bytes_sha256: "sha256:" + "a".repeat(64) },
};

const FAILED = {
  tool: "acquisition.capture_url",
  surface_schema: "acquisition.mcp_surface.v0.1",
  capture_status: "capture_failed",
  capture_id: null,
  source_id: "sha256:bbb",
  source_locator: "http://127.0.0.1:9/notfound",
  captured_object_address: null,
  byte_count: null,
  failure_detail: "fetch failed: 404",
  capture_receipt: null,
};

describe("parseAcquisitionCaptureResult — happy paths", () => {
  it("accepts a valid captured projection", () => {
    const r = parseAcquisitionCaptureResult(CAPTURED);
    expect(r.capture_status).toBe("captured");
    expect(r.captured_object_address).toBe("sha256:" + "a".repeat(64));
  });

  it("accepts a valid capture_failed projection", () => {
    const r = parseAcquisitionCaptureResult(FAILED);
    expect(r.capture_status).toBe("capture_failed");
    expect(r.captured_object_address).toBeNull();
    expect(r.capture_receipt).toBeNull();
  });
});

describe("HTTP-03/04 — contamination is rejected", () => {
  it("rejects an unknown top-level field", () => {
    expect(() =>
      parseAcquisitionCaptureResult({ ...CAPTURED, extra_field: 1 }),
    ).toThrow(AcquisitionResponseError);
  });

  it.each([
    "standing",
    "admitted",
    "admission_result",
    "published",
    "verified",
    "support_type",
    "governance_state",
    "claim_support_edge",
    "authority",
  ])("rejects authority-bearing top-level key %s", (key) => {
    expect(() =>
      parseAcquisitionCaptureResult({ ...CAPTURED, [key]: true }),
    ).toThrow(AcquisitionResponseError);
  });

  it("rejects an authority key nested inside capture_receipt", () => {
    const contaminated = {
      ...CAPTURED,
      capture_receipt: {
        exact_bytes_sha256: "sha256:" + "a".repeat(64),
        governance_state: "admitted",
      },
    };
    expect(() => parseAcquisitionCaptureResult(contaminated)).toThrow(
      /authority-bearing field 'governance_state'/,
    );
  });

  it("rejects an authority key nested deep in an array", () => {
    const contaminated = {
      ...CAPTURED,
      capture_receipt: { items: [{ ok: 1 }, { claim_support_edge: "x" }] },
    };
    expect(() => parseAcquisitionCaptureResult(contaminated)).toThrow(
      AcquisitionResponseError,
    );
  });
});

describe("status/field integrity", () => {
  it("rejects an arbitrary capture_status", () => {
    expect(() =>
      parseAcquisitionCaptureResult({ ...CAPTURED, capture_status: "admitted" }),
    ).toThrow(/capture_status/);
  });

  it("rejects captured without a content address", () => {
    expect(() =>
      parseAcquisitionCaptureResult({
        ...CAPTURED,
        captured_object_address: null,
      }),
    ).toThrow(/without captured_object_address/);
  });

  it("rejects capture_failed that smuggles an address", () => {
    expect(() =>
      parseAcquisitionCaptureResult({
        ...FAILED,
        captured_object_address: "sha256:" + "c".repeat(64),
      }),
    ).toThrow(/must not carry a receipt\/address/);
  });

  it("rejects a non-object response", () => {
    expect(() => parseAcquisitionCaptureResult("nope")).toThrow(
      AcquisitionResponseError,
    );
  });
});

describe("tryParse variant", () => {
  it("returns null instead of throwing on a bad response", () => {
    expect(tryParseAcquisitionCaptureResult({ bad: true })).toBeNull();
  });

  it("returns the parsed result on a good response", () => {
    expect(tryParseAcquisitionCaptureResult(CAPTURED)?.capture_status).toBe(
      "captured",
    );
  });
});
