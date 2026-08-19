import { LOCAL_COMPANION_BASE_URL } from "./localCompanionClient";

const INGEST_PATH = "/v0/operator-snapshot";
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_REF_RE = /^opsnap_[0-9a-f]{32}$/;

export interface OperatorSnapshotIngestRequest {
  readonly snapshot_base64: string;
  readonly current_url: string;
  readonly expected_url: string | null;
  readonly captured_at: string;
  readonly media_type: "multipart/related";
}

export interface OperatorSnapshotReceiptProjection {
  readonly snapshot_id: string;
  readonly expected_source_locator: string | null;
  readonly current_locator: string;
  readonly captured_at: string;
  readonly media_type: "multipart/related";
  readonly exact_bytes_sha256: string;
  readonly byte_count: number;
  readonly route: "operator_browser_snapshot";
  readonly schema_version: "acquisition.operator_browser_snapshot.v0.1";
}

export interface OperatorSnapshotIngestResult {
  readonly tool: "acquisition.ingest_operator_browser_snapshot";
  readonly result_schema: "acquisition.operator_browser_snapshot_ingest_result.v0.1";
  readonly status: "snapshot_ingested";
  readonly snapshot_ref: string;
  readonly captured_object_address: string;
  readonly byte_count: number;
  readonly expected_source_locator: string | null;
  readonly current_locator: string;
  readonly locator_continuity: "exact" | "drift" | "not_supplied";
  readonly producer_capture_registry_written: false;
  readonly operator_snapshot_receipt: OperatorSnapshotReceiptProjection;
  readonly boundary: {
    readonly network_access: "not_performed";
    readonly http_capture_receipt: "not_emitted";
    readonly verification: "not_performed";
    readonly admission: "not_performed";
    readonly standing: "not_performed";
    readonly publication: "not_performed";
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, i) => key === wanted[i]);
}

export function parseOperatorSnapshotIngestResult(raw: unknown): OperatorSnapshotIngestResult {
  if (!isRecord(raw)) throw new Error("operator snapshot result must be an object");
  if (!exactKeys(raw, [
    "tool",
    "result_schema",
    "status",
    "snapshot_ref",
    "captured_object_address",
    "byte_count",
    "expected_source_locator",
    "current_locator",
    "locator_continuity",
    "producer_capture_registry_written",
    "operator_snapshot_receipt",
    "boundary",
  ])) {
    throw new Error("operator snapshot result has unknown or missing fields");
  }
  if (raw["tool"] !== "acquisition.ingest_operator_browser_snapshot") {
    throw new Error("unexpected operator snapshot producer tool");
  }
  if (raw["result_schema"] !== "acquisition.operator_browser_snapshot_ingest_result.v0.1") {
    throw new Error("unexpected operator snapshot result schema");
  }
  if (raw["status"] !== "snapshot_ingested") throw new Error("operator snapshot was not ingested");
  if (typeof raw["snapshot_ref"] !== "string" || !SNAPSHOT_REF_RE.test(raw["snapshot_ref"])) {
    throw new Error("invalid operator snapshot ref");
  }
  if (
    typeof raw["captured_object_address"] !== "string" ||
    !SHA256_RE.test(raw["captured_object_address"])
  ) {
    throw new Error("invalid operator snapshot content address");
  }
  if (!Number.isInteger(raw["byte_count"]) || (raw["byte_count"] as number) <= 0) {
    throw new Error("invalid operator snapshot byte count");
  }
  if (raw["producer_capture_registry_written"] !== false) {
    throw new Error("operator snapshot result wrote or claimed strict capture registry authority");
  }
  if (!isRecord(raw["operator_snapshot_receipt"])) {
    throw new Error("operator snapshot result omitted receipt");
  }
  const receipt = raw["operator_snapshot_receipt"];
  if (!exactKeys(receipt, [
    "snapshot_id",
    "expected_source_locator",
    "current_locator",
    "captured_at",
    "media_type",
    "exact_bytes_sha256",
    "byte_count",
    "route",
    "schema_version",
  ])) {
    throw new Error("operator snapshot receipt has unknown or missing fields");
  }
  if (receipt["snapshot_id"] !== raw["snapshot_ref"] || receipt["exact_bytes_sha256"] !== raw["captured_object_address"] || receipt["byte_count"] !== raw["byte_count"] || receipt["expected_source_locator"] !== raw["expected_source_locator"] || receipt["current_locator"] !== raw["current_locator"]) {
    throw new Error("operator snapshot result/receipt identity mismatch");
  }
  if (receipt["route"] !== "operator_browser_snapshot" || receipt["schema_version"] !== "acquisition.operator_browser_snapshot.v0.1" || receipt["media_type"] !== "multipart/related") {
    throw new Error("unexpected operator snapshot receipt contract");
  }
  if (!isRecord(raw["boundary"]) || !exactKeys(raw["boundary"], [
    "network_access",
    "http_capture_receipt",
    "verification",
    "admission",
    "standing",
    "publication",
  ])) {
    throw new Error("operator snapshot result boundary is malformed");
  }
  const boundary = raw["boundary"];
  if (
    boundary["network_access"] !== "not_performed" ||
    boundary["http_capture_receipt"] !== "not_emitted" ||
    boundary["verification"] !== "not_performed" ||
    boundary["admission"] !== "not_performed" ||
    boundary["standing"] !== "not_performed" ||
    boundary["publication"] !== "not_performed"
  ) {
    throw new Error("operator snapshot producer crossed its authority boundary");
  }
  if (!(["exact", "drift", "not_supplied"] as const).includes(raw["locator_continuity"] as never)) {
    throw new Error("invalid locator continuity");
  }
  return raw as unknown as OperatorSnapshotIngestResult;
}

export async function ingestOperatorSnapshot(
  request: OperatorSnapshotIngestRequest,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OperatorSnapshotIngestResult> {
  const response = await fetchImpl(LOCAL_COMPANION_BASE_URL + INGEST_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`operator snapshot ingest failed (HTTP ${response.status})`);
  }
  const result = parseOperatorSnapshotIngestResult((await response.json()) as unknown);
  if (result.current_locator !== request.current_url || result.expected_source_locator !== request.expected_url) {
    throw new Error("operator snapshot producer returned mismatched locator provenance");
  }
  return result;
}
