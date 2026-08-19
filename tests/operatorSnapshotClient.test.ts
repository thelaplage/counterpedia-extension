import { describe, expect, it } from "vitest";

import { parseOperatorSnapshotIngestResult } from "../src/lib/operatorSnapshotClient";

const RECEIPT = {
  snapshot_id: "opsnap_0123456789abcdef0123456789abcdef",
  expected_source_locator: "https://example.org/source",
  current_locator: "https://example.org/source",
  captured_at: "2026-08-19T19:00:00Z",
  media_type: "multipart/related" as const,
  exact_bytes_sha256: "sha256:" + "a".repeat(64),
  byte_count: 123,
  route: "operator_browser_snapshot" as const,
  schema_version: "acquisition.operator_browser_snapshot.v0.1" as const,
};

function validResult() {
  return {
    tool: "acquisition.ingest_operator_browser_snapshot",
    result_schema: "acquisition.operator_browser_snapshot_ingest_result.v0.1",
    status: "snapshot_ingested",
    snapshot_ref: RECEIPT.snapshot_id,
    captured_object_address: RECEIPT.exact_bytes_sha256,
    byte_count: RECEIPT.byte_count,
    expected_source_locator: RECEIPT.expected_source_locator,
    current_locator: RECEIPT.current_locator,
    locator_continuity: "exact",
    producer_capture_registry_written: false,
    operator_snapshot_receipt: { ...RECEIPT },
    boundary: {
      network_access: "not_performed",
      http_capture_receipt: "not_emitted",
      verification: "not_performed",
      admission: "not_performed",
      standing: "not_performed",
      publication: "not_performed",
    },
  };
}

describe("OPERATOR-BROWSER0 producer result guard", () => {
  it("accepts the exact distinct snapshot receipt contract", () => {
    const parsed = parseOperatorSnapshotIngestResult(validResult());
    expect(parsed.snapshot_ref).toBe(RECEIPT.snapshot_id);
    expect(parsed.producer_capture_registry_written).toBe(false);
  });

  it("accepts locator drift only as explicit drift", () => {
    const value = validResult();
    value.current_locator = "https://example.org/new";
    value.locator_continuity = "drift";
    value.operator_snapshot_receipt.current_locator = "https://example.org/new";
    const parsed = parseOperatorSnapshotIngestResult(value);
    expect(parsed.locator_continuity).toBe("drift");
    expect(parsed.expected_source_locator).not.toBe(parsed.current_locator);
  });

  it("refuses a fake strict CaptureReceipt registration", () => {
    const value = validResult();
    value.producer_capture_registry_written = true;
    expect(() => parseOperatorSnapshotIngestResult(value)).toThrow(/strict capture registry/i);
  });

  it("refuses result/receipt identity disagreement", () => {
    const value = validResult();
    value.operator_snapshot_receipt.snapshot_id = "opsnap_ffffffffffffffffffffffffffffffff";
    expect(() => parseOperatorSnapshotIngestResult(value)).toThrow(/identity mismatch/i);
  });

  it("fails closed on unknown fields", () => {
    const value = { ...validResult(), admitted: true };
    expect(() => parseOperatorSnapshotIngestResult(value)).toThrow(/unknown or missing fields/i);
  });
});
