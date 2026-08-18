import { LOCAL_COMPANION_BASE_URL } from "./localCompanionClient";
import type { CorpusPresence } from "./history";
import {
  resolveObservationAgainstIndex,
  type SourceResolutionIndex,
} from "./sourceResolutionClient";

export const WIKIPEDIA_HARVEST_PATH = "/v0/wikipedia-harvest";
export const WIKIPEDIA_REFERENCE_FRONTIER_KEY =
  "counterpedia_wikipedia_reference_frontier_v0_1";
export const WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA =
  "counterpedia.wikipedia_reference_frontier.v0.1" as const;

const MANIFEST_SCHEMA = "acquisition.wikipedia_reference_manifest.v0.1" as const;
const MAX_REFERENCES = 20_000;
const MAX_UNIQUE_URLS = 20_000;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;

export interface WikipediaReferencePage {
  readonly wiki_host: string;
  readonly page_id: number;
  readonly title: string;
  readonly revision_id: number;
  readonly revision_timestamp: string;
  readonly mediawiki_sha1: string | null;
  readonly wikitext_utf8_sha256: string;
  readonly canonical_url: string;
  readonly role: "reference_discovery_only";
}

export type WikipediaReferenceParseState =
  | "structured"
  | "url_only"
  | "identifier_only"
  | "unparsed"
  | "unresolved_named_ref";

export interface WikipediaReferenceOccurrence {
  readonly ordinal: number;
  readonly reference_locator: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly ref_name: string | null;
  readonly definition_locator: string | null;
  readonly occurrence_markup_sha256: string;
  readonly parse_state: WikipediaReferenceParseState;
  readonly template_type: string | null;
  readonly title: string | null;
  readonly publisher: string | null;
  readonly work: string | null;
  readonly date: string | null;
  readonly access_date: string | null;
  readonly authors: readonly string[];
  readonly source_url: string | null;
  readonly archive_url: string | null;
  readonly doi: string | null;
  readonly pmid: string | null;
  readonly isbn: string | null;
  readonly discovery_relation: "discovered_via";
  readonly support_state: "not_inferred";
  readonly capture_state: "not_attempted";
  readonly srs_receipt_state: "not_emitted";
}

export interface WikipediaReferenceManifest {
  readonly schema_version: typeof MANIFEST_SCHEMA;
  readonly harvested_at: string;
  readonly page: WikipediaReferencePage;
  readonly references: readonly WikipediaReferenceOccurrence[];
  readonly unique_source_urls: readonly string[];
  readonly counts: {
    readonly reference_occurrences: number;
    readonly parsed_occurrences: number;
    readonly capture_eligible_occurrences: number;
    readonly unique_source_urls: number;
  };
  readonly boundary: {
    readonly article_prose_copied: false;
    readonly wikipedia_support_inferred: false;
    readonly capture_receipts_emitted: false;
    readonly srs_receipts_emitted: false;
    readonly governed_declaration_bound: false;
    readonly srs_binding_state: "unbound_discovery";
  };
}

export type WikipediaReferenceResolutionStatus =
  | "KNOWN"
  | "NEW"
  | "AMBIGUOUS"
  | "UNRESOLVED";

export interface ClassifiedWikipediaSource {
  readonly url: string;
  readonly status: WikipediaReferenceResolutionStatus;
  readonly canonical_source_ref?: string;
  readonly corpus_presence?: CorpusPresence;
}

export interface WikipediaReferenceFrontierV01 {
  readonly schema_version: typeof WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA;
  readonly created_at: string;
  readonly page: {
    readonly wiki_host: string;
    readonly title: string;
    readonly revision_id: number;
    readonly canonical_url: string;
  };
  readonly selected_sources: readonly ClassifiedWikipediaSource[];
  readonly authority_posture: "discovery_only";
  readonly acquisition_state: "not_attempted";
  readonly admission: "not_performed";
}

interface StorageAreaLike {
  set(items: Record<string, unknown>): Promise<void>;
}

const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "harvested_at",
  "page",
  "references",
  "unique_source_urls",
  "counts",
  "boundary",
]);
const PAGE_KEYS = new Set([
  "wiki_host",
  "page_id",
  "title",
  "revision_id",
  "revision_timestamp",
  "mediawiki_sha1",
  "wikitext_utf8_sha256",
  "canonical_url",
  "role",
]);
const REFERENCE_KEYS = new Set([
  "ordinal",
  "reference_locator",
  "char_start",
  "char_end",
  "ref_name",
  "definition_locator",
  "occurrence_markup_sha256",
  "parse_state",
  "template_type",
  "title",
  "publisher",
  "work",
  "date",
  "access_date",
  "authors",
  "source_url",
  "archive_url",
  "doi",
  "pmid",
  "isbn",
  "discovery_relation",
  "support_state",
  "capture_state",
  "srs_receipt_state",
]);
const COUNT_KEYS = new Set([
  "reference_occurrences",
  "parsed_occurrences",
  "capture_eligible_occurrences",
  "unique_source_urls",
]);
const BOUNDARY_KEYS = new Set([
  "article_prose_copied",
  "wikipedia_support_inferred",
  "capture_receipts_emitted",
  "srs_receipts_emitted",
  "governed_declaration_bound",
  "srs_binding_state",
]);
const AUTHORITY_KEYS = new Set([
  "truth",
  "standing",
  "verified",
  "verification",
  "admitted",
  "admission",
  "published",
  "publication",
  "supported_by",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictObject(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}:expected_object`);
  const keys = Object.keys(value);
  if (keys.length !== allowed.size) throw new Error(`${label}:unknown_or_missing_field`);
  for (const key of keys) {
    if (AUTHORITY_KEYS.has(key)) throw new Error(`${label}:authority_field_forbidden:${key}`);
    if (!allowed.has(key)) throw new Error(`${label}:unknown_or_missing_field`);
  }
  return value;
}

function requiredString(value: unknown, label: string, max = 4096): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new Error(`${label}:string`);
  }
  return value;
}

function nullableString(value: unknown, label: string, max = 4096): string | null {
  if (value === null) return null;
  return requiredString(value, label, max);
}

function nonnegativeInt(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label}:integer`);
  return value as number;
}

function positiveInt(value: unknown, label: string): number {
  const parsed = nonnegativeInt(value, label);
  if (parsed < 1) throw new Error(`${label}:positive`);
  return parsed;
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

function nullableHttpUrl(value: unknown, label: string): string | null {
  return value === null ? null : httpUrl(value, label);
}

function isoTimestamp(value: unknown, label: string): string {
  const raw = requiredString(value, label, 128);
  if (!Number.isFinite(Date.parse(raw))) throw new Error(`${label}:timestamp`);
  return raw;
}

function stringArray(value: unknown, label: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label}:array`);
  return value.map((item, index) => requiredString(item, `${label}:${index}`, 4096));
}

function parsePage(value: unknown): WikipediaReferencePage {
  const page = strictObject(value, PAGE_KEYS, "wikipedia_harvest:page");
  const host = requiredString(page.wiki_host, "wikipedia_harvest:page:wiki_host", 255).toLowerCase();
  if (!/^[a-z0-9-]+\.wikipedia\.org$/.test(host)) {
    throw new Error("wikipedia_harvest:page:wiki_host");
  }
  const sha1 = page.mediawiki_sha1;
  if (sha1 !== null && (typeof sha1 !== "string" || !SHA1_RE.test(sha1))) {
    throw new Error("wikipedia_harvest:page:mediawiki_sha1");
  }
  const wikitextDigest = requiredString(
    page.wikitext_utf8_sha256,
    "wikipedia_harvest:page:wikitext_utf8_sha256",
    72,
  );
  if (!SHA256_RE.test(wikitextDigest)) {
    throw new Error("wikipedia_harvest:page:wikitext_utf8_sha256");
  }
  if (page.role !== "reference_discovery_only") {
    throw new Error("wikipedia_harvest:page:role");
  }
  const canonicalUrl = httpUrl(page.canonical_url, "wikipedia_harvest:page:canonical_url");
  if (new URL(canonicalUrl).hostname.toLowerCase() !== host) {
    throw new Error("wikipedia_harvest:page:canonical_host_mismatch");
  }
  return {
    wiki_host: host,
    page_id: positiveInt(page.page_id, "wikipedia_harvest:page:page_id"),
    title: requiredString(page.title, "wikipedia_harvest:page:title", 2048),
    revision_id: positiveInt(page.revision_id, "wikipedia_harvest:page:revision_id"),
    revision_timestamp: isoTimestamp(
      page.revision_timestamp,
      "wikipedia_harvest:page:revision_timestamp",
    ),
    mediawiki_sha1: sha1 as string | null,
    wikitext_utf8_sha256: wikitextDigest,
    canonical_url: canonicalUrl,
    role: "reference_discovery_only",
  };
}

function parseReference(value: unknown, index: number): WikipediaReferenceOccurrence {
  const label = `wikipedia_harvest:reference:${index}`;
  const ref = strictObject(value, REFERENCE_KEYS, label);
  const parseState = ref.parse_state;
  if (
    parseState !== "structured" &&
    parseState !== "url_only" &&
    parseState !== "identifier_only" &&
    parseState !== "unparsed" &&
    parseState !== "unresolved_named_ref"
  ) {
    throw new Error(`${label}:parse_state`);
  }
  if (ref.discovery_relation !== "discovered_via") throw new Error(`${label}:discovery_relation`);
  if (ref.support_state !== "not_inferred") throw new Error(`${label}:support_state`);
  if (ref.capture_state !== "not_attempted") throw new Error(`${label}:capture_state`);
  if (ref.srs_receipt_state !== "not_emitted") throw new Error(`${label}:srs_receipt_state`);
  const digest = requiredString(ref.occurrence_markup_sha256, `${label}:occurrence_markup_sha256`, 72);
  if (!SHA256_RE.test(digest)) throw new Error(`${label}:occurrence_markup_sha256`);
  const start = nonnegativeInt(ref.char_start, `${label}:char_start`);
  const end = positiveInt(ref.char_end, `${label}:char_end`);
  if (end <= start) throw new Error(`${label}:char_range`);

  return {
    ordinal: positiveInt(ref.ordinal, `${label}:ordinal`),
    reference_locator: requiredString(ref.reference_locator, `${label}:reference_locator`, 64),
    char_start: start,
    char_end: end,
    ref_name: nullableString(ref.ref_name, `${label}:ref_name`, 1024),
    definition_locator: nullableString(ref.definition_locator, `${label}:definition_locator`, 64),
    occurrence_markup_sha256: digest,
    parse_state: parseState,
    template_type: nullableString(ref.template_type, `${label}:template_type`, 256),
    title: nullableString(ref.title, `${label}:title`, 4096),
    publisher: nullableString(ref.publisher, `${label}:publisher`, 2048),
    work: nullableString(ref.work, `${label}:work`, 2048),
    date: nullableString(ref.date, `${label}:date`, 256),
    access_date: nullableString(ref.access_date, `${label}:access_date`, 256),
    authors: stringArray(ref.authors, `${label}:authors`, 100),
    source_url: nullableHttpUrl(ref.source_url, `${label}:source_url`),
    archive_url: nullableHttpUrl(ref.archive_url, `${label}:archive_url`),
    doi: nullableString(ref.doi, `${label}:doi`, 1024),
    pmid: nullableString(ref.pmid, `${label}:pmid`, 1024),
    isbn: nullableString(ref.isbn, `${label}:isbn`, 1024),
    discovery_relation: "discovered_via",
    support_state: "not_inferred",
    capture_state: "not_attempted",
    srs_receipt_state: "not_emitted",
  };
}

export function parseWikipediaReferenceManifest(raw: unknown): WikipediaReferenceManifest {
  const root = strictObject(raw, TOP_LEVEL_KEYS, "wikipedia_harvest");
  if (root.schema_version !== MANIFEST_SCHEMA) throw new Error("wikipedia_harvest:schema_version");
  const referencesRaw = root.references;
  if (!Array.isArray(referencesRaw) || referencesRaw.length > MAX_REFERENCES) {
    throw new Error("wikipedia_harvest:references");
  }
  const references = referencesRaw.map(parseReference);

  const uniqueRaw = root.unique_source_urls;
  if (!Array.isArray(uniqueRaw) || uniqueRaw.length > MAX_UNIQUE_URLS) {
    throw new Error("wikipedia_harvest:unique_source_urls");
  }
  const uniqueSourceUrls = uniqueRaw.map((value, index) =>
    httpUrl(value, `wikipedia_harvest:unique_source_urls:${index}`),
  );
  if (new Set(uniqueSourceUrls).size !== uniqueSourceUrls.length) {
    throw new Error("wikipedia_harvest:unique_source_urls:duplicate");
  }

  const firstSeen: string[] = [];
  for (const ref of references) {
    if (ref.source_url && !firstSeen.includes(ref.source_url)) firstSeen.push(ref.source_url);
  }
  if (
    firstSeen.length !== uniqueSourceUrls.length ||
    firstSeen.some((url, index) => url !== uniqueSourceUrls[index])
  ) {
    throw new Error("wikipedia_harvest:unique_source_urls:not_first_seen_projection");
  }

  const countsRaw = strictObject(root.counts, COUNT_KEYS, "wikipedia_harvest:counts");
  const counts = {
    reference_occurrences: nonnegativeInt(
      countsRaw.reference_occurrences,
      "wikipedia_harvest:counts:reference_occurrences",
    ),
    parsed_occurrences: nonnegativeInt(
      countsRaw.parsed_occurrences,
      "wikipedia_harvest:counts:parsed_occurrences",
    ),
    capture_eligible_occurrences: nonnegativeInt(
      countsRaw.capture_eligible_occurrences,
      "wikipedia_harvest:counts:capture_eligible_occurrences",
    ),
    unique_source_urls: nonnegativeInt(
      countsRaw.unique_source_urls,
      "wikipedia_harvest:counts:unique_source_urls",
    ),
  };
  const parsedCount = references.filter(
    (ref) => ref.parse_state !== "unparsed" && ref.parse_state !== "unresolved_named_ref",
  ).length;
  const eligibleCount = references.filter((ref) => ref.source_url !== null).length;
  if (
    counts.reference_occurrences !== references.length ||
    counts.parsed_occurrences !== parsedCount ||
    counts.capture_eligible_occurrences !== eligibleCount ||
    counts.unique_source_urls !== uniqueSourceUrls.length
  ) {
    throw new Error("wikipedia_harvest:counts:mismatch");
  }

  const boundaryRaw = strictObject(root.boundary, BOUNDARY_KEYS, "wikipedia_harvest:boundary");
  if (
    boundaryRaw.article_prose_copied !== false ||
    boundaryRaw.wikipedia_support_inferred !== false ||
    boundaryRaw.capture_receipts_emitted !== false ||
    boundaryRaw.srs_receipts_emitted !== false ||
    boundaryRaw.governed_declaration_bound !== false ||
    boundaryRaw.srs_binding_state !== "unbound_discovery"
  ) {
    throw new Error("wikipedia_harvest:boundary_crossed");
  }

  return {
    schema_version: MANIFEST_SCHEMA,
    harvested_at: isoTimestamp(root.harvested_at, "wikipedia_harvest:harvested_at"),
    page: parsePage(root.page),
    references,
    unique_source_urls: uniqueSourceUrls,
    counts,
    boundary: {
      article_prose_copied: false,
      wikipedia_support_inferred: false,
      capture_receipts_emitted: false,
      srs_receipts_emitted: false,
      governed_declaration_bound: false,
      srs_binding_state: "unbound_discovery",
    },
  };
}

export async function harvestWikipediaReferences(
  page: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<WikipediaReferenceManifest> {
  const parsed = httpUrl(page, "wikipedia_harvest:request:page");
  if (!/^[a-z0-9-]+\.wikipedia\.org$/i.test(new URL(parsed).hostname)) {
    throw new Error("wikipedia_harvest:request:not_wikipedia");
  }
  const response = await fetchImpl(LOCAL_COMPANION_BASE_URL + WIKIPEDIA_HARVEST_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    body: JSON.stringify({ page: parsed }),
  });
  if (!response.ok) throw new Error(`wikipedia_harvest:http_${response.status}`);
  return parseWikipediaReferenceManifest((await response.json()) as unknown);
}

export function classifyWikipediaReferenceUrls(
  manifest: WikipediaReferenceManifest,
  index: SourceResolutionIndex | null,
): ClassifiedWikipediaSource[] {
  if (!index) {
    return manifest.unique_source_urls.map((url) => ({ url, status: "UNRESOLVED" }));
  }
  return manifest.unique_source_urls.map((url) => {
    const resolved = resolveObservationAgainstIndex(index, {
      collector_id: "wikipedia_reference_harvest_v0_1",
      observed_url: url,
      canonical_locator: url,
      source_kind: "web_page",
      source_native_ids: {},
      resolution_status: "UNRESOLVED",
    });
    if (resolved.resolution_status === "MATCHED") {
      return {
        url,
        status: "KNOWN" as const,
        canonical_source_ref: resolved.canonical_source_ref,
        corpus_presence: resolved.corpus_presence,
      };
    }
    if (resolved.resolution_status === "AMBIGUOUS") {
      return { url, status: "AMBIGUOUS" as const };
    }
    if (resolved.resolution_status === "UNMATCHED") {
      return { url, status: "NEW" as const };
    }
    return { url, status: "UNRESOLVED" as const };
  });
}

export function buildWikipediaReferenceFrontier(
  manifest: WikipediaReferenceManifest,
  selectedSources: readonly ClassifiedWikipediaSource[],
  now: () => string = () => new Date().toISOString(),
): WikipediaReferenceFrontierV01 {
  const allowed = new Set(manifest.unique_source_urls);
  const seen = new Set<string>();
  const selected = selectedSources.map((source) => {
    if (!allowed.has(source.url)) throw new Error("wikipedia_frontier:selected_url_not_in_manifest");
    if (seen.has(source.url)) throw new Error("wikipedia_frontier:duplicate_selected_url");
    seen.add(source.url);
    return { ...source };
  });
  return {
    schema_version: WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA,
    created_at: isoTimestamp(now(), "wikipedia_frontier:created_at"),
    page: {
      wiki_host: manifest.page.wiki_host,
      title: manifest.page.title,
      revision_id: manifest.page.revision_id,
      canonical_url: manifest.page.canonical_url,
    },
    selected_sources: selected,
    authority_posture: "discovery_only",
    acquisition_state: "not_attempted",
    admission: "not_performed",
  };
}

export async function persistWikipediaReferenceFrontier(
  storage: StorageAreaLike,
  frontier: WikipediaReferenceFrontierV01,
): Promise<void> {
  await storage.set({ [WIKIPEDIA_REFERENCE_FRONTIER_KEY]: frontier });
}
