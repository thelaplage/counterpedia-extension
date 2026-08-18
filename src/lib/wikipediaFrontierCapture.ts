import {
  parseAcquisitionCaptureResult,
  type AcquisitionCaptureResult,
} from "./acquisitionResponseGuard";
import { LOCAL_COMPANION_BASE_URL } from "./localCompanionClient";
import {
  WIKIPEDIA_REFERENCE_FRONTIER_KEY,
  WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA,
  type WikipediaReferenceFrontierV01,
} from "./wikipediaHarvestBridge";

export const WIKIPEDIA_CAPTURE_PATH = "/v0/capture-url";
export const WIKIPEDIA_CAPTURE_RUNS_KEY = "counterpedia_wikipedia_capture_runs_v0_1";
export const WIKIPEDIA_CAPTURE_RUN_SCHEMA = "counterpedia.wikipedia_capture_run.v0.1" as const;

const MAX_FRONTIER_SOURCES = 250;
const MAX_CAPTURE_RUNS = 200;

export interface WikipediaCaptureAttemptV01 {
  readonly url: string;
  readonly capture_status: "captured" | "capture_failed";
  readonly capture_id: string | null;
  readonly source_id: string | null;
  readonly source_locator: string | null;
  readonly captured_object_address: string | null;
  readonly byte_count: number | null;
  readonly failure_detail: string | null;
}

export interface WikipediaCaptureRunV01 {
  readonly schema_version: typeof WIKIPEDIA_CAPTURE_RUN_SCHEMA;
  readonly run_id: string;
  readonly created_at: string;
  readonly page: WikipediaReferenceFrontierV01["page"];
  readonly attempts: readonly WikipediaCaptureAttemptV01[];
  readonly authority_posture: "capture_receipt_projection_only";
  readonly admission: "not_performed";
}

interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function httpUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_384) {
    throw new Error(`${label}:url`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}:url`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label}:url_scheme`);
  }
  return value;
}

function positiveInt(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${label}:integer`);
  return value as number;
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 128 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}:timestamp`);
  }
  return value;
}

export function parseWikipediaReferenceFrontier(raw: unknown): WikipediaReferenceFrontierV01 {
  if (!isRecord(raw)) throw new Error("wikipedia_frontier:expected_object");
  if (
    !exactKeys(raw, [
      "schema_version",
      "created_at",
      "page",
      "selected_sources",
      "authority_posture",
      "acquisition_state",
      "admission",
    ])
  ) {
    throw new Error("wikipedia_frontier:unknown_or_missing_field");
  }
  if (raw.schema_version !== WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA) {
    throw new Error("wikipedia_frontier:schema");
  }
  if (raw.authority_posture !== "discovery_only") throw new Error("wikipedia_frontier:authority");
  if (raw.acquisition_state !== "not_attempted") throw new Error("wikipedia_frontier:acquisition_state");
  if (raw.admission !== "not_performed") throw new Error("wikipedia_frontier:admission");

  if (!isRecord(raw.page) || !exactKeys(raw.page, ["wiki_host", "title", "revision_id", "canonical_url"])) {
    throw new Error("wikipedia_frontier:page");
  }
  const wikiHost = raw.page.wiki_host;
  const title = raw.page.title;
  if (typeof wikiHost !== "string" || !/^[a-z0-9-]+\.wikipedia\.org$/i.test(wikiHost)) {
    throw new Error("wikipedia_frontier:page:wiki_host");
  }
  if (typeof title !== "string" || title.length < 1 || title.length > 2048) {
    throw new Error("wikipedia_frontier:page:title");
  }
  const page = {
    wiki_host: wikiHost.toLowerCase(),
    title,
    revision_id: positiveInt(raw.page.revision_id, "wikipedia_frontier:page:revision_id"),
    canonical_url: httpUrl(raw.page.canonical_url, "wikipedia_frontier:page:canonical_url"),
  };

  if (!Array.isArray(raw.selected_sources) || raw.selected_sources.length > MAX_FRONTIER_SOURCES) {
    throw new Error("wikipedia_frontier:selected_sources");
  }
  const seen = new Set<string>();
  const selected_sources = raw.selected_sources.map((item, index) => {
    if (!isRecord(item) || !exactKeys(item, ["url", "status"])) {
      throw new Error(`wikipedia_frontier:selected_source:${index}:shape`);
    }
    const url = httpUrl(item.url, `wikipedia_frontier:selected_source:${index}:url`);
    if (item.status !== "NEW") {
      throw new Error(`wikipedia_frontier:selected_source:${index}:status`);
    }
    if (seen.has(url)) throw new Error("wikipedia_frontier:duplicate_selected_url");
    seen.add(url);
    return { url, status: "NEW" as const };
  });

  return {
    schema_version: WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA,
    created_at: isoTimestamp(raw.created_at, "wikipedia_frontier:created_at"),
    page,
    selected_sources,
    authority_posture: "discovery_only",
    acquisition_state: "not_attempted",
    admission: "not_performed",
  };
}

export async function readWikipediaReferenceFrontier(
  storage: StorageAreaLike,
): Promise<WikipediaReferenceFrontierV01 | null> {
  const raw = (await storage.get(WIKIPEDIA_REFERENCE_FRONTIER_KEY))[WIKIPEDIA_REFERENCE_FRONTIER_KEY];
  return raw === undefined ? null : parseWikipediaReferenceFrontier(raw);
}

export async function captureWikipediaFrontierUrl(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AcquisitionCaptureResult> {
  const sourceUrl = httpUrl(url, "wikipedia_capture:url");
  const response = await fetchImpl(LOCAL_COMPANION_BASE_URL + WIKIPEDIA_CAPTURE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    body: JSON.stringify({ url: sourceUrl }),
  });
  if (!response.ok) throw new Error(`wikipedia_capture:http_${response.status}`);
  const result = parseAcquisitionCaptureResult((await response.json()) as unknown);
  if (result.tool !== "acquisition.capture_url") throw new Error("wikipedia_capture:producer_tool");
  if (result.surface_schema !== "acquisition.mcp_surface.v0.1") {
    throw new Error("wikipedia_capture:producer_schema");
  }
  if (result.source_locator !== sourceUrl) {
    throw new Error("wikipedia_capture:source_locator_mismatch");
  }
  return result;
}

export function buildWikipediaCaptureRun(
  frontier: WikipediaReferenceFrontierV01,
  results: readonly AcquisitionCaptureResult[],
  options: { readonly now?: () => string; readonly makeId?: () => string } = {},
): WikipediaCaptureRunV01 {
  const allowed = new Set(frontier.selected_sources.map((source) => source.url));
  const attempts = results.map((result) => {
    if (!result.source_locator || !allowed.has(result.source_locator)) {
      throw new Error("wikipedia_capture_run:result_outside_frontier");
    }
    return {
      url: result.source_locator,
      capture_status: result.capture_status,
      capture_id: result.capture_id,
      source_id: result.source_id,
      source_locator: result.source_locator,
      captured_object_address: result.captured_object_address,
      byte_count: result.byte_count,
      failure_detail: result.failure_detail,
    } satisfies WikipediaCaptureAttemptV01;
  });
  return {
    schema_version: WIKIPEDIA_CAPTURE_RUN_SCHEMA,
    run_id: (options.makeId ?? (() => crypto.randomUUID()))(),
    created_at: isoTimestamp(
      (options.now ?? (() => new Date().toISOString()))(),
      "wikipedia_capture_run:created_at",
    ),
    page: frontier.page,
    attempts,
    authority_posture: "capture_receipt_projection_only",
    admission: "not_performed",
  };
}

export async function persistWikipediaCaptureRun(
  storage: StorageAreaLike,
  run: WikipediaCaptureRunV01,
): Promise<void> {
  const raw = (await storage.get(WIKIPEDIA_CAPTURE_RUNS_KEY))[WIKIPEDIA_CAPTURE_RUNS_KEY];
  const existing = raw === undefined ? [] : raw;
  if (!Array.isArray(existing) || existing.length > MAX_CAPTURE_RUNS) {
    throw new Error("wikipedia_capture_runs:invalid_container");
  }
  const next = [...existing, run];
  if (next.length > MAX_CAPTURE_RUNS) next.splice(0, next.length - MAX_CAPTURE_RUNS);
  await storage.set({ [WIKIPEDIA_CAPTURE_RUNS_KEY]: next });
}
