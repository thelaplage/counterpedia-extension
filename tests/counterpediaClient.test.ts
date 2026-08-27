/**
 * counterpediaClient search-index validation + cache-behavior tests (issue #7).
 *
 * The fix is fail-closed cache validation: ONE structural validator is applied
 * to BOTH the remote fetch and the session-cache read, so a poisoned or
 * schema-drifted cache is evicted and re-fetched instead of being served.
 *
 * These tests exercise the real `search()` path — mocking chrome.storage and
 * fetch in-memory (node env), mirroring activityClient.test.ts — so they prove
 * the eviction → refetch behavior, not just the pure validator.
 *
 * The validator mirrors the producer-owned `CounterpediaSearchIndex` contract
 * (thelaplage/counterpedia → lib/counterpedia/searchIndex.ts). It does not
 * establish stricter local semantics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isValidSearchIndex,
  search,
  clearCache,
} from "../src/lib/counterpediaClient";

// Cache keys — must match the client constants.
const SESSION_CACHE_KEY = "counterpedia_search_index_v1";
const SESSION_CACHE_FETCHED_KEY = "counterpedia_search_index_fetched_at";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(record_id: string, url: string): Record<string, unknown> {
  return {
    record_id,
    title: `Title for ${record_id}`,
    corpus_posture: "classification_unavailable",
    entity_labels: [],
    claim_text_tokens: "",
    source_labels: [],
    source_canonical_urls: [url],
    refused_candidate_labels: [],
    edition: "ED-1",
    record_url: `/records/${record_id}`,
  };
}

function buildIndex(entries: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: "2026-08-05T00:00:00.000Z",
    entry_count: entries.length,
    entries,
  };
}

const CACHED_URL = "https://cached.example/x";
const FRESH_URL = "https://fresh.example/y";
const cachedIndex = buildIndex([makeEntry("CACHED-1", CACHED_URL)]);
const freshIndex = buildIndex([makeEntry("FRESH-1", FRESH_URL)]);

// ---------------------------------------------------------------------------
// Real producer fixture — bytes copied verbatim from Counterpedia output.
//   source repo:   thelaplage/counterpedia
//   source commit: d450b196725593f6824f03e64485636fbad7a444
//   source path:   public/counterpedia/search-index.json
// `claim_text_tokens` is truncated for brevity; every other field is verbatim,
// including the empty label arrays and the absent `subtitle` on CP-SIG-15.
// ---------------------------------------------------------------------------

const REAL_PRODUCER_INDEX = {
  schema_version: 1,
  generated_at: "2026-08-05T00:00:00.000Z",
  entry_count: 2,
  entries: [
    {
      record_id: "CP-SIG-15",
      title:
        "Data Sovereignty Suppression: The Rubio Cable and the Two-Front Campaign Against AI Governance",
      corpus_posture: "republished_counterpose",
      entity_labels: [],
      claim_text_tokens:
        "# Data Sovereignty Suppression: The Rubio Cable and the Two-Front Campaign Again",
      source_labels: [],
      source_canonical_urls: [],
      refused_candidate_labels: [],
      edition: "CP-SIG-15-ED-1",
      record_url: "/records/CP-SIG-15",
    },
    {
      record_id: "HEPPNER-LIFECYCLE-0001",
      title: "Heppner AI privilege ruling: governed claim lifecycle",
      subtitle:
        "A public proofcase showing initial admission and refusal, named-condition reopening, revised governed state, and separate structural recomputation.",
      corpus_posture: "governed_public_record",
      entity_labels: [],
      claim_text_tokens:
        "United States v. Heppner, document 27 was filed on 2026-02-17. This public proof",
      source_labels: ["United States v. Heppner, document 27"],
      source_canonical_urls: [
        "https://www.courtlistener.com/docket/71872024/united-states-v-heppner/",
        "https://storage.courtlistener.com/recap/gov.uscourts.nysd.652138/gov.uscourts.nysd.652138.27.0.pdf",
      ],
      refused_candidate_labels: ["candidate:heppner:universal-ai-privilege-rule"],
      edition: "HEPPNER-LIFECYCLE-EDITION-REVISED",
      record_url: "/records/HEPPNER-LIFECYCLE-0001",
    },
  ],
};

// ---------------------------------------------------------------------------
// In-memory chrome mock (node env), mirroring activityClient.test.ts
// ---------------------------------------------------------------------------

function makeStore() {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (data.has(k)) out[k] = data.get(k);
      return out;
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const k of keys) data.delete(k);
    }),
    _data: data,
  };
}

let sessionStore: ReturnType<typeof makeStore>;
let syncStore: ReturnType<typeof makeStore>;

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** Seed a fresh (unexpired) session cache entry directly. */
function seedCache(index: unknown): void {
  sessionStore._data.set(SESSION_CACHE_KEY, index);
  sessionStore._data.set(SESSION_CACHE_FETCHED_KEY, Date.now());
}

beforeEach(() => {
  sessionStore = makeStore();
  syncStore = makeStore();
  (globalThis as any).chrome = {
    storage: { session: sessionStore, sync: syncStore },
  };
});

afterEach(async () => {
  await clearCache();
  vi.restoreAllMocks();
  delete (globalThis as any).fetch;
});

// ---------------------------------------------------------------------------
// Validator — mirrors the producer contract, no stricter
// ---------------------------------------------------------------------------

describe("isValidSearchIndex", () => {
  it("accepts a well-formed index", () => {
    expect(isValidSearchIndex(cachedIndex)).toBe(true);
  });

  it("accepts the real producer fixture (interop)", () => {
    expect(isValidSearchIndex(REAL_PRODUCER_INDEX)).toBe(true);
  });

  it("accepts an index with zero entries", () => {
    expect(isValidSearchIndex(buildIndex([]))).toBe(true);
  });

  it("accepts entries with empty label/url arrays (producer emits these)", () => {
    const e = makeEntry("X", CACHED_URL);
    e["source_canonical_urls"] = [];
    expect(isValidSearchIndex(buildIndex([e]))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isValidSearchIndex(null)).toBe(false);
    expect(isValidSearchIndex(undefined)).toBe(false);
    expect(isValidSearchIndex("index")).toBe(false);
    expect(isValidSearchIndex(42)).toBe(false);
  });

  it("rejects a drifted schema_version", () => {
    expect(isValidSearchIndex({ ...cachedIndex, schema_version: 2 })).toBe(false);
    expect(isValidSearchIndex({ ...cachedIndex, schema_version: "1" })).toBe(false);
  });

  it("rejects a missing/mistyped generated_at", () => {
    const { generated_at: _drop, ...noGen } = cachedIndex;
    expect(isValidSearchIndex(noGen)).toBe(false);
    expect(isValidSearchIndex({ ...cachedIndex, generated_at: 123 })).toBe(false);
  });

  it("rejects a missing/mistyped entry_count", () => {
    const { entry_count: _drop, ...noCount } = cachedIndex;
    expect(isValidSearchIndex(noCount)).toBe(false);
    expect(isValidSearchIndex({ ...cachedIndex, entry_count: "2" })).toBe(false);
  });

  it("rejects when entries is not an array", () => {
    expect(isValidSearchIndex({ ...cachedIndex, entries: {} })).toBe(false);
    expect(isValidSearchIndex({ ...cachedIndex, entries: undefined })).toBe(false);
  });

  it("rejects an entry missing a required string field", () => {
    const e = makeEntry("X", CACHED_URL);
    delete e["record_url"];
    expect(isValidSearchIndex(buildIndex([e]))).toBe(false);
  });

  it("rejects a non-string subtitle but accepts an absent one", () => {
    const withSub = makeEntry("X", CACHED_URL);
    withSub["subtitle"] = "fine";
    expect(isValidSearchIndex(buildIndex([withSub]))).toBe(true);

    const badSub = makeEntry("Y", CACHED_URL);
    badSub["subtitle"] = 42;
    expect(isValidSearchIndex(buildIndex([badSub]))).toBe(false);
  });

  it("rejects a label/url array containing a non-string member", () => {
    const e = makeEntry("X", CACHED_URL);
    e["source_canonical_urls"] = ["https://ok", 123];
    expect(isValidSearchIndex(buildIndex([e]))).toBe(false);
  });

  it("does NOT impose stricter-than-contract rules (empty title/edition ok)", () => {
    const e = makeEntry("X", CACHED_URL);
    e["title"] = "";
    e["edition"] = "";
    // Producer type declares these as `string`, not `non-empty string`.
    expect(isValidSearchIndex(buildIndex([e]))).toBe(true);
  });

  it("does NOT require entry_count === entries.length", () => {
    const idx = buildIndex([makeEntry("X", CACHED_URL)]);
    idx["entry_count"] = 99;
    expect(isValidSearchIndex(idx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search() — fail-closed cache behavior (the issue #7 regression surface)
// ---------------------------------------------------------------------------

describe("search() cache behavior", () => {
  it("1. serves a valid, fresh cache without any network fetch", async () => {
    const fetchMock = vi.fn(async () => okResponse(freshIndex));
    (globalThis as any).fetch = fetchMock;
    seedCache(cachedIndex);

    const results = await search(CACHED_URL);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results.map((r) => r.record_id)).toEqual(["CACHED-1"]);
  });

  it("2. evicts a schema_version-mismatched cache, then refetches fresh", async () => {
    const fetchMock = vi.fn(async () => okResponse(freshIndex));
    (globalThis as any).fetch = fetchMock;
    seedCache({ ...cachedIndex, schema_version: 2 });

    const results = await search(FRESH_URL);

    expect(sessionStore.remove).toHaveBeenCalledWith([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.record_id)).toEqual(["FRESH-1"]);
  });

  it("3. evicts a cache whose entries are malformed, then refetches", async () => {
    const fetchMock = vi.fn(async () => okResponse(freshIndex));
    (globalThis as any).fetch = fetchMock;
    seedCache({ ...cachedIndex, entries: "nope" });

    const results = await search(FRESH_URL);

    expect(sessionStore.remove).toHaveBeenCalledWith([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.record_id)).toEqual(["FRESH-1"]);
  });

  it("4. rejects a contract-invalid entry (non-string url member) before scoring", async () => {
    const fetchMock = vi.fn(async () => okResponse(freshIndex));
    (globalThis as any).fetch = fetchMock;
    const poisoned = buildIndex([
      { ...makeEntry("BAD-1", CACHED_URL), source_canonical_urls: [123] },
    ]);
    seedCache(poisoned);

    // Must not throw from a `.toLowerCase()` on a non-string member.
    const results = await search(FRESH_URL);

    expect(sessionStore.remove).toHaveBeenCalledWith([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.record_id)).toEqual(["FRESH-1"]);
  });

  it("5. never serves an invalid cache as fallback when the remote is unavailable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    (globalThis as any).fetch = fetchMock;
    seedCache({ ...cachedIndex, schema_version: 2 });

    await expect(search(CACHED_URL)).rejects.toThrow(/network down/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("6. throws on an invalid fetched index and does not cache it", async () => {
    const fetchMock = vi.fn(async () => okResponse({ ...cachedIndex, schema_version: 2 }));
    (globalThis as any).fetch = fetchMock;

    await expect(search(FRESH_URL)).rejects.toThrow(/schema/i);
    expect(sessionStore.set).not.toHaveBeenCalled();
  });

  it("7. caches a valid fetched index (both keys) for the session", async () => {
    const fetchMock = vi.fn(async () => okResponse(freshIndex));
    (globalThis as any).fetch = fetchMock;

    await search(FRESH_URL);

    expect(sessionStore.set).toHaveBeenCalledTimes(1);
    const written = sessionStore.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      [SESSION_CACHE_KEY, SESSION_CACHE_FETCHED_KEY].sort(),
    );
  });
});
