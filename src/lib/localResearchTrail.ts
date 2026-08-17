/**
 * Local research trail for Counterpedia Check.
 *
 * This is deliberately NOT Amnesiac memory and NOT an admission surface.
 * It preserves the user's explicit KEEP acts in chrome.storage.local so the
 * research residue survives the current panel session without crossing a
 * network boundary.
 *
 * Invariants:
 *   checked != remembered
 *   kept research != admitted agent memory
 *   local retention != publication
 */

import type { SearchResult } from "../types";

export const LOCAL_RESEARCH_TRAIL_STORAGE_KEY =
  "counterpedia.local-research-trail.v0_1";

export const LOCAL_RESEARCH_TRAIL_SCHEMA =
  "counterpedia.local-research-trail-entry.v0_1" as const;

export const LOCAL_RESEARCH_BOUNDARY = {
  retention: "local_research_trail",
  memory_admission: "not_performed",
  publication: "not_performed",
  network_egress: "none",
} as const;

export type LocalResearchTrailKind = "source" | "record" | "check";

export interface LocalSourceSnapshot {
  current_url: string;
  canonical_url: string | null;
  title: string | null;
  observed_in_browser: boolean;
}

export interface LocalRecordSnapshot {
  record_id: string;
  record_url: string;
  title: string;
  corpus_posture: string;
  corpus_posture_label: string;
  edition: string;
  supported_proposition: string | null;
  top_source_labels: string[];
  why_not_summary: string | null;
  refusal_count: number;
  has_changes: boolean;
  change_count: number;
  verification_posture: SearchResult["verification_posture"];
}

interface LocalResearchTrailBase {
  schema: typeof LOCAL_RESEARCH_TRAIL_SCHEMA;
  entry_id: string;
  kind: LocalResearchTrailKind;
  kept_at: string;
  boundary: typeof LOCAL_RESEARCH_BOUNDARY;
}

export interface LocalSourceTrailEntry extends LocalResearchTrailBase {
  kind: "source";
  source: LocalSourceSnapshot;
}

export interface LocalRecordTrailEntry extends LocalResearchTrailBase {
  kind: "record";
  query: string;
  record: LocalRecordSnapshot;
  source: LocalSourceSnapshot | null;
}

export interface LocalCheckTrailEntry extends LocalResearchTrailBase {
  kind: "check";
  query: string;
  records: LocalRecordSnapshot[];
  source: LocalSourceSnapshot | null;
}

export type LocalResearchTrailEntry =
  | LocalSourceTrailEntry
  | LocalRecordTrailEntry
  | LocalCheckTrailEntry;

export interface LocalResearchTrailStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: LocalResearchTrailEntry[]): Promise<void>;
}

export class LocalResearchTrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalResearchTrailError";
  }
}

function requireBoundedText(
  value: string,
  field: string,
  max: number,
): string {
  if (value.length === 0 || value.length > max) {
    throw new LocalResearchTrailError(`${field}_invalid`);
  }
  return value;
}

function boundedNullableText(
  value: string | null,
  field: string,
  max: number,
): string | null {
  if (value === null) return null;
  return requireBoundedText(value, field, max);
}

function requireHttpUrl(value: string, field: string): string {
  requireBoundedText(value, field, 4096);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new LocalResearchTrailError(`${field}_invalid`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LocalResearchTrailError(`${field}_invalid`);
  }
  return value;
}

function validateEntryIdentity(entryId: string, keptAt: string): void {
  requireBoundedText(entryId, "entry_id", 128);
  requireBoundedText(keptAt, "kept_at", 64);
  if (Number.isNaN(Date.parse(keptAt))) {
    throw new LocalResearchTrailError("kept_at_invalid");
  }
}

export function snapshotSource(source: LocalSourceSnapshot): LocalSourceSnapshot {
  return {
    current_url: requireHttpUrl(source.current_url, "current_url"),
    canonical_url:
      source.canonical_url === null
        ? null
        : requireHttpUrl(source.canonical_url, "canonical_url"),
    title: boundedNullableText(source.title, "source_title", 512),
    observed_in_browser: source.observed_in_browser,
  };
}

export function snapshotRecord(result: SearchResult): LocalRecordSnapshot {
  return {
    record_id: requireBoundedText(result.record_id, "record_id", 512),
    record_url: requireBoundedText(result.record_url, "record_url", 4096),
    title: requireBoundedText(result.title, "record_title", 512),
    corpus_posture: requireBoundedText(
      result.corpus_posture,
      "corpus_posture",
      128,
    ),
    corpus_posture_label: requireBoundedText(
      result.corpus_posture_label,
      "corpus_posture_label",
      256,
    ),
    edition: requireBoundedText(result.edition, "edition", 512),
    supported_proposition: boundedNullableText(
      result.supported_proposition,
      "supported_proposition",
      8000,
    ),
    top_source_labels: result.top_source_labels.map((label) =>
      requireBoundedText(label, "source_label", 512),
    ),
    why_not_summary: boundedNullableText(
      result.why_not_summary,
      "why_not_summary",
      8000,
    ),
    refusal_count: result.refusal_count,
    has_changes: result.has_changes,
    change_count: result.change_count,
    verification_posture: result.verification_posture,
  };
}

export function buildSourceTrailEntry(input: {
  entryId: string;
  keptAt: string;
  source: LocalSourceSnapshot;
}): LocalSourceTrailEntry {
  validateEntryIdentity(input.entryId, input.keptAt);
  return {
    schema: LOCAL_RESEARCH_TRAIL_SCHEMA,
    entry_id: input.entryId,
    kind: "source",
    kept_at: input.keptAt,
    boundary: LOCAL_RESEARCH_BOUNDARY,
    source: snapshotSource(input.source),
  };
}

export function buildRecordTrailEntry(input: {
  entryId: string;
  keptAt: string;
  query: string;
  record: SearchResult;
  source?: LocalSourceSnapshot | null;
}): LocalRecordTrailEntry {
  validateEntryIdentity(input.entryId, input.keptAt);
  return {
    schema: LOCAL_RESEARCH_TRAIL_SCHEMA,
    entry_id: input.entryId,
    kind: "record",
    kept_at: input.keptAt,
    boundary: LOCAL_RESEARCH_BOUNDARY,
    query: requireBoundedText(input.query, "query", 8192),
    record: snapshotRecord(input.record),
    source: input.source ? snapshotSource(input.source) : null,
  };
}

export function buildCheckTrailEntry(input: {
  entryId: string;
  keptAt: string;
  query: string;
  records: SearchResult[];
  source?: LocalSourceSnapshot | null;
}): LocalCheckTrailEntry {
  validateEntryIdentity(input.entryId, input.keptAt);
  if (input.records.length === 0) {
    throw new LocalResearchTrailError("check_records_empty");
  }
  return {
    schema: LOCAL_RESEARCH_TRAIL_SCHEMA,
    entry_id: input.entryId,
    kind: "check",
    kept_at: input.keptAt,
    boundary: LOCAL_RESEARCH_BOUNDARY,
    query: requireBoundedText(input.query, "query", 8192),
    records: input.records.map(snapshotRecord),
    source: input.source ? snapshotSource(input.source) : null,
  };
}

function isStoredEntry(value: unknown): value is LocalResearchTrailEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item["schema"] !== LOCAL_RESEARCH_TRAIL_SCHEMA) return false;
  if (typeof item["entry_id"] !== "string") return false;
  if (typeof item["kept_at"] !== "string") return false;
  if (!(["source", "record", "check"] as unknown[]).includes(item["kind"])) {
    return false;
  }
  const boundary = item["boundary"];
  if (!boundary || typeof boundary !== "object" || Array.isArray(boundary)) {
    return false;
  }
  const b = boundary as Record<string, unknown>;
  return (
    b["retention"] === LOCAL_RESEARCH_BOUNDARY.retention &&
    b["memory_admission"] === LOCAL_RESEARCH_BOUNDARY.memory_admission &&
    b["publication"] === LOCAL_RESEARCH_BOUNDARY.publication &&
    b["network_egress"] === LOCAL_RESEARCH_BOUNDARY.network_egress
  );
}

export function parseStoredResearchTrail(
  value: unknown,
): LocalResearchTrailEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isStoredEntry)) {
    throw new LocalResearchTrailError("storage_corrupt");
  }
  return value as LocalResearchTrailEntry[];
}

export async function appendLocalResearchTrail(
  storage: LocalResearchTrailStorage,
  entry: LocalResearchTrailEntry,
): Promise<number> {
  const current = parseStoredResearchTrail(
    await storage.get(LOCAL_RESEARCH_TRAIL_STORAGE_KEY),
  );
  const next = [...current, entry];
  await storage.set(LOCAL_RESEARCH_TRAIL_STORAGE_KEY, next);
  return next.length;
}

export function chromeLocalResearchTrailStorage(): LocalResearchTrailStorage {
  return {
    async get(key: string): Promise<unknown> {
      const result = await chrome.storage.local.get(key);
      return result[key];
    },
    async set(key: string, value: LocalResearchTrailEntry[]): Promise<void> {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}
