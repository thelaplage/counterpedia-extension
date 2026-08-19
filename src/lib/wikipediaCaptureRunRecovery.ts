import {
  WIKIPEDIA_CAPTURE_RUNS_KEY,
  WIKIPEDIA_CAPTURE_RUN_SCHEMA,
  type WikipediaCaptureAttemptV01,
  type WikipediaCaptureRunV01,
} from "./wikipediaFrontierCapture";

const MAX_CAPTURE_RUNS = 200;
const MAX_ATTEMPTS = 250;

export interface WikipediaCaptureRunRecoveryStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new Error(`${label}:string`);
  }
  return value;
}

function stringOrNull(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  return requiredString(value, label, max);
}

function httpUrl(value: unknown, label: string): string {
  const raw = requiredString(value, label, 16_384);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label}:url`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label}:url_scheme`);
  }
  return raw;
}

function nonnegativeIntOrNull(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label}:integer_or_null`);
  }
  return value as number;
}

function positiveInt(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label}:positive_integer`);
  }
  return value as number;
}

function isoTimestamp(value: unknown, label: string): string {
  const raw = requiredString(value, label, 128);
  if (!Number.isFinite(Date.parse(raw))) throw new Error(`${label}:timestamp`);
  return raw;
}

function parseAttempt(raw: unknown, index: number): WikipediaCaptureAttemptV01 {
  const label = `wikipedia_capture_recovery:attempt:${index}`;
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      "url",
      "capture_status",
      "capture_id",
      "source_id",
      "source_locator",
      "captured_object_address",
      "byte_count",
      "failure_detail",
    ])
  ) {
    throw new Error(`${label}:shape`);
  }
  if (raw.capture_status !== "captured" && raw.capture_status !== "capture_failed") {
    throw new Error(`${label}:status`);
  }
  const url = httpUrl(raw.url, `${label}:url`);
  const sourceLocator = stringOrNull(raw.source_locator, `${label}:source_locator`, 16_384);
  if (sourceLocator !== url) throw new Error(`${label}:source_locator_mismatch`);
  const address = stringOrNull(
    raw.captured_object_address,
    `${label}:captured_object_address`,
    256,
  );
  if (raw.capture_status === "captured" && address === null) {
    throw new Error(`${label}:captured_without_address`);
  }
  if (raw.capture_status === "capture_failed" && address !== null) {
    throw new Error(`${label}:failed_with_address`);
  }
  return {
    url,
    capture_status: raw.capture_status,
    capture_id: stringOrNull(raw.capture_id, `${label}:capture_id`, 512),
    source_id: stringOrNull(raw.source_id, `${label}:source_id`, 512),
    source_locator: sourceLocator,
    captured_object_address: address,
    byte_count: nonnegativeIntOrNull(raw.byte_count, `${label}:byte_count`),
    failure_detail: stringOrNull(raw.failure_detail, `${label}:failure_detail`, 4096),
  };
}

export function parseWikipediaCaptureRunForRecovery(raw: unknown): WikipediaCaptureRunV01 {
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      "schema_version",
      "run_id",
      "created_at",
      "page",
      "attempts",
      "authority_posture",
      "admission",
    ])
  ) {
    throw new Error("wikipedia_capture_recovery:run_shape");
  }
  if (raw.schema_version !== WIKIPEDIA_CAPTURE_RUN_SCHEMA) {
    throw new Error("wikipedia_capture_recovery:schema");
  }
  if (raw.authority_posture !== "capture_receipt_projection_only") {
    throw new Error("wikipedia_capture_recovery:authority");
  }
  if (raw.admission !== "not_performed") {
    throw new Error("wikipedia_capture_recovery:admission");
  }
  if (!Array.isArray(raw.attempts) || raw.attempts.length > MAX_ATTEMPTS) {
    throw new Error("wikipedia_capture_recovery:attempts");
  }
  if (
    !isRecord(raw.page) ||
    !exactKeys(raw.page, ["wiki_host", "title", "revision_id", "canonical_url"])
  ) {
    throw new Error("wikipedia_capture_recovery:page_shape");
  }
  const wikiHost = requiredString(raw.page.wiki_host, "wikipedia_capture_recovery:wiki_host", 255);
  if (!/^[a-z0-9-]+\.wikipedia\.org$/i.test(wikiHost)) {
    throw new Error("wikipedia_capture_recovery:wiki_host");
  }
  const title = requiredString(raw.page.title, "wikipedia_capture_recovery:title", 2048);
  const canonicalUrl = httpUrl(raw.page.canonical_url, "wikipedia_capture_recovery:canonical_url");
  if (new URL(canonicalUrl).hostname.toLowerCase() !== wikiHost.toLowerCase()) {
    throw new Error("wikipedia_capture_recovery:canonical_host_mismatch");
  }

  return {
    schema_version: WIKIPEDIA_CAPTURE_RUN_SCHEMA,
    run_id: requiredString(raw.run_id, "wikipedia_capture_recovery:run_id", 160),
    created_at: isoTimestamp(raw.created_at, "wikipedia_capture_recovery:created_at"),
    page: {
      wiki_host: wikiHost.toLowerCase(),
      title,
      revision_id: positiveInt(raw.page.revision_id, "wikipedia_capture_recovery:revision_id"),
      canonical_url: canonicalUrl,
    },
    attempts: raw.attempts.map(parseAttempt),
    authority_posture: "capture_receipt_projection_only",
    admission: "not_performed",
  };
}

export async function readWikipediaCaptureRunsForRecovery(
  storage: WikipediaCaptureRunRecoveryStorage,
): Promise<WikipediaCaptureRunV01[]> {
  const raw = (await storage.get(WIKIPEDIA_CAPTURE_RUNS_KEY))[WIKIPEDIA_CAPTURE_RUNS_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CAPTURE_RUNS) {
    throw new Error("wikipedia_capture_recovery:invalid_container");
  }
  return raw.map(parseWikipediaCaptureRunForRecovery);
}
