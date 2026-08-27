/**
 * Counterpedia client for the Chrome extension.
 *
 * Fetches the public static search index and runs search locally.
 * The index is cached in chrome.storage.session for the browser session.
 *
 * Privacy:
 * - Only the normalized URL or explicitly selected text is used as query.
 * - No page content, cookies, DOM, or history is accessed here.
 * - No analytics or telemetry in v0.1.
 */

import type { SearchResult } from "../types";
import { validateCardModel, PINNED_CARD_SCHEMA_VERSION } from "./cardModel";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://www.garpedia.org";
const SEARCH_INDEX_PATH = "/counterpedia/search-index.json";
const SESSION_CACHE_KEY = "counterpedia_search_index_v1";
const SESSION_CACHE_FETCHED_KEY = "counterpedia_search_index_fetched_at";
// Re-fetch if cached data is older than 1 hour
const CACHE_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Search index types (mirrored from main repo for isolation)
// ---------------------------------------------------------------------------

interface SearchIndexEntry {
  record_id: string;
  title: string;
  subtitle?: string;
  corpus_posture: string;
  entity_labels: string[];
  claim_text_tokens: string;
  source_labels: string[];
  source_canonical_urls: string[];
  refused_candidate_labels: string[];
  edition: string;
  record_url: string;
}

interface SearchIndex {
  schema_version: 1;
  generated_at: string;
  entry_count: number;
  entries: SearchIndexEntry[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Structural validator for the search index.
 *
 * Fail-closed contract check applied to BOTH the remote fetch and the
 * session-cache read, so a poisoned or schema-drifted cache cannot be trusted
 * just because it deserializes.
 *
 * This mirrors the producer-owned `CounterpediaSearchIndex` contract
 * (`thelaplage/counterpedia` → `lib/counterpedia/searchIndex.ts`) — no more,
 * no less. It deliberately does NOT invent stricter local semantics (e.g.
 * non-empty `title`/`edition`, or `entry_count === entries.length`): the
 * extension consumes that contract, it does not become a second schema
 * authority. It DOES require the label/url fields to be arrays of strings,
 * because the scoring path calls `.toLowerCase()` on their members.
 */
export function isValidSearchIndex(data: unknown): data is SearchIndex {
  if (typeof data !== "object" || data === null) return false;
  const idx = data as Record<string, unknown>;
  if (idx["schema_version"] !== 1) return false;
  if (typeof idx["generated_at"] !== "string") return false;
  if (typeof idx["entry_count"] !== "number") return false;
  if (!Array.isArray(idx["entries"])) return false;

  return (idx["entries"] as unknown[]).every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e["record_id"] === "string" &&
      typeof e["title"] === "string" &&
      // subtitle is optional in the producer contract: absent or a string.
      (e["subtitle"] === undefined || typeof e["subtitle"] === "string") &&
      typeof e["corpus_posture"] === "string" &&
      typeof e["claim_text_tokens"] === "string" &&
      typeof e["edition"] === "string" &&
      typeof e["record_url"] === "string" &&
      isStringArray(e["entity_labels"]) &&
      isStringArray(e["source_labels"]) &&
      isStringArray(e["source_canonical_urls"]) &&
      isStringArray(e["refused_candidate_labels"])
    );
  });
}

// ---------------------------------------------------------------------------
// Corpus posture labels (pinned from W1)
// ---------------------------------------------------------------------------

const CORPUS_POSTURE_LABELS: Record<string, string> = {
  governed_public_record: "Governed Public Record",
  republished_counterpose: "Republished Counterpose",
  synthetic_demonstration: "Synthetic Demonstration",
  historical_demonstration: "Historical Demonstration",
  classification_unavailable: "Classification Unavailable",
};

// ---------------------------------------------------------------------------
// Index loading with session cache
// ---------------------------------------------------------------------------

let inMemoryIndex: SearchIndex | null = null;

async function getBaseUrl(): Promise<string> {
  try {
    const result = await chrome.storage.sync.get(["counterpedia_base_url"]);
    return (result["counterpedia_base_url"] as string) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function loadSearchIndex(): Promise<SearchIndex> {
  // 1. In-memory cache (fastest)
  if (inMemoryIndex !== null) return inMemoryIndex;

  // 2. Session storage cache
  try {
    const cached = await chrome.storage.session.get([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
    const fetchedAt = cached[SESSION_CACHE_FETCHED_KEY] as number | undefined;
    const cachedData = cached[SESSION_CACHE_KEY] as unknown;
    if (cachedData && fetchedAt && Date.now() - fetchedAt < CACHE_TTL_MS) {
      // Fail closed: a cached blob that no longer matches the pinned contract
      // is discarded, not trusted. Drop the poisoned entry and re-fetch.
      if (isValidSearchIndex(cachedData)) {
        inMemoryIndex = cachedData;
        return inMemoryIndex;
      }
      try {
        await chrome.storage.session.remove([
          SESSION_CACHE_KEY,
          SESSION_CACHE_FETCHED_KEY,
        ]);
      } catch {
        // Non-fatal — fall through to fetch regardless
      }
    }
  } catch {
    // Session storage unavailable — fall through to fetch
  }

  // 3. Fetch from remote
  const baseUrl = await getBaseUrl();
  const url = `${baseUrl}${SEARCH_INDEX_PATH}`;
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 429) {
      const err = new Error("rate_limited");
      err.name = "rate_limited";
      throw err;
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;

  // Fail closed on schema mismatch (same contract as the cache read).
  if (!isValidSearchIndex(data)) {
    throw new Error("Invalid search index schema");
  }

  inMemoryIndex = data;

  // Store in session cache
  try {
    await chrome.storage.session.set({
      [SESSION_CACHE_KEY]: data,
      [SESSION_CACHE_FETCHED_KEY]: Date.now(),
    });
  } catch {
    // Non-fatal — session storage write failure
  }

  return inMemoryIndex;
}

// ---------------------------------------------------------------------------
// Local search logic
// ---------------------------------------------------------------------------

/**
 * Score an entry against a query string.
 * Returns 0 if no match, > 0 if matched (higher = better).
 */
function scoreEntry(entry: SearchIndexEntry, queryLower: string): number {
  let score = 0;

  // Exact URL match in source_canonical_urls
  if (entry.source_canonical_urls.some((u) => u.toLowerCase() === queryLower)) {
    score += 100;
  }

  // URL contains query or query contains URL
  if (
    entry.source_canonical_urls.some(
      (u) =>
        u.toLowerCase().includes(queryLower) ||
        queryLower.includes(u.toLowerCase()),
    )
  ) {
    score += 50;
  }

  // Title match
  if (entry.title.toLowerCase().includes(queryLower)) {
    score += 20;
  }

  // Entity label match
  if (entry.entity_labels.some((l) => l.toLowerCase().includes(queryLower))) {
    score += 15;
  }

  // Claim text match
  if (entry.claim_text_tokens.toLowerCase().includes(queryLower)) {
    score += 10;
  }

  // Source label match
  if (entry.source_labels.some((l) => l.toLowerCase().includes(queryLower))) {
    score += 5;
  }

  return score;
}

function entryToSearchResult(entry: SearchIndexEntry): SearchResult {
  const refusalCount = entry.refused_candidate_labels.length;
  const postureLabel =
    CORPUS_POSTURE_LABELS[entry.corpus_posture] ?? entry.corpus_posture;

  const cardLike = {
    schema_version: PINNED_CARD_SCHEMA_VERSION,
    record_id: entry.record_id,
    record_url: entry.record_url,
    title: entry.title,
    subtitle: entry.subtitle,
    corpus_posture: entry.corpus_posture as SearchResult["corpus_posture"],
    corpus_posture_label: postureLabel,
    edition: entry.edition,
    supported_proposition: entry.claim_text_tokens
      ? (entry.claim_text_tokens.split(/[.!?]/)[0]?.trim() ?? null)
      : null,
    source_count: entry.source_labels.length,
    top_source_labels: entry.source_labels.slice(0, 3),
    why_not_summary:
      refusalCount > 0
        ? `${refusalCount} alternative interpretation${refusalCount === 1 ? "" : "s"} not adopted`
        : null,
    refusal_count: refusalCount,
    has_changes: false,
    change_count: 1,
    verification_posture: "none" as const,
    verification_tokens: [],
  };

  // Validate the card model shape (throws if invalid)
  validateCardModel(cardLike);

  return cardLike;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search Counterpedia for records matching the given query.
 *
 * @param query - A normalized URL or selected text (max 300 chars).
 * @returns A ranked list of matching SearchResult objects.
 * @throws Error with name "rate_limited" if the remote returns 429.
 * @throws Error if the remote is unavailable.
 */
export async function search(query: string): Promise<SearchResult[]> {
  const index = await loadSearchIndex();
  const queryLower = query.toLowerCase().trim();

  if (!queryLower) return [];

  const scored: Array<{ entry: SearchIndexEntry; score: number }> = [];
  for (const entry of index.entries) {
    const score = scoreEntry(entry, queryLower);
    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  // Sort by score descending, limit to top 20
  scored.sort((a, b) => b.score - a.score);
  const topEntries = scored.slice(0, 20).map((s) => s.entry);

  return topEntries.map(entryToSearchResult);
}

/**
 * Clear the in-memory and session-storage cache.
 * Used for testing or manual refresh.
 */
export async function clearCache(): Promise<void> {
  inMemoryIndex = null;
  try {
    await chrome.storage.session.remove([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
  } catch {
    // Non-fatal
  }
}
