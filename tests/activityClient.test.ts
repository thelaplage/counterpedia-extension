/**
 * Activity client tests.
 *
 * Covers fetch + session cache, credentials:"omit" privacy discipline,
 * rate-limit / HTTP error handling, and fail-closed schema-version validation.
 * Chrome storage and fetch are mocked in-memory (node env).
 */

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY,
  PINNED_ACTIVITY_INDEX_SCHEMA_VERSION,
} from "../src/lib/activityFeedModel";
import { getActivityFeed, clearActivityCache } from "../src/lib/activityClient";

// ---------------------------------------------------------------------------
// Vendored J1 artifact — exact bytes from the merged Counterpedia PR #230.
//   source repo:   thelaplage/counterpedia
//   source commit: d512f1edb17042a964e5c3d2ec8e07913bcc82bd
//   source path:   public/counterpedia/activity-index.json
// ---------------------------------------------------------------------------

const J1_FIXTURE_RAW = readFileSync(
  new URL("./vendor/counterpedia_j1_activity_index_v0_1.json", import.meta.url),
  "utf8",
);
const PINNED_J1_FIXTURE_SHA256 =
  "81313f01a91153ba2b01bc8edb8b422bc9e96073044ba333daa917d050144125";

const j1IndexJson = JSON.parse(J1_FIXTURE_RAW) as unknown;
// Derived removal case: same inspection scope, entries cleared.
const j1EmptyIndexJson = {
  ...(j1IndexJson as Record<string, unknown>),
  inspection: {
    ...((j1IndexJson as Record<string, unknown>)["inspection"] as Record<string, unknown>),
    receipt_count: 0,
  },
  entries: [],
};
const J1_RECEIPT_ID = (
  (j1IndexJson as Record<string, unknown>)["entries"] as Array<Record<string, unknown>>
)[0]!["receipt_id"] as string;

// ---------------------------------------------------------------------------
// In-memory chrome mock
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

const emptyIndexJson = {
  schema_family: PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY,
  schema_version: PINNED_ACTIVITY_INDEX_SCHEMA_VERSION,
  generated_by: "counterpedia-activity-index-exporter",
  boundary: "Deterministic, disposable index over admitted PUBLIC receipts.",
  inspection: {
    substrates: [
      "governed_read",
      "reliance",
      "edition_drift",
      "reconsideration",
      "admission_event",
    ],
    window: "unbounded",
    receipt_count: 0,
    inspected: true,
  },
  entries: [],
};

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  sessionStore = makeStore();
  syncStore = makeStore();
  (globalThis as any).chrome = {
    storage: { session: sessionStore, sync: syncStore },
  };
});

afterEach(async () => {
  await clearActivityCache();
  vi.restoreAllMocks();
  delete (globalThis as any).fetch;
});

describe("getActivityFeed — fetch + cache", () => {
  it("fetches the activity index with credentials omitted and no-store", async () => {
    const fetchMock = vi.fn(async () => okResponse(emptyIndexJson));
    (globalThis as any).fetch = fetchMock;

    const feed = await getActivityFeed();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.garpedia.org/counterpedia/activity-index.json");
    expect(opts.credentials).toBe("omit");
    expect(opts.cache).toBe("no-store");
    // Honest-empty
    expect(feed.is_empty).toBe(true);
  });

  it("writes the index into chrome.storage.session and serves the cache on next call", async () => {
    const fetchMock = vi.fn(async () => okResponse(emptyIndexJson));
    (globalThis as any).fetch = fetchMock;

    await getActivityFeed();
    expect(sessionStore.set).toHaveBeenCalled();

    // Clear only the in-memory layer by re-importing state via a fresh feed
    // call; the session cache should now answer without a second fetch.
    await getActivityFeed();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the cache is cleared", async () => {
    const fetchMock = vi.fn(async () => okResponse(emptyIndexJson));
    (globalThis as any).fetch = fetchMock;

    await getActivityFeed();
    await clearActivityCache();
    await getActivityFeed();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getActivityFeed — error handling", () => {
  it("throws a rate_limited error on HTTP 429", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    await expect(getActivityFeed()).rejects.toMatchObject({ name: "rate_limited" });
  });

  it("throws on other HTTP errors", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(getActivityFeed()).rejects.toThrow(/HTTP 503/);
  });
});

describe("getActivityFeed — J1 golden test (genuine PR #230 index)", () => {
  it("raw fixture SHA-256 matches pinned provenance (thelaplage/counterpedia@d512f1e:public/counterpedia/activity-index.json)", () => {
    const actual = createHash("sha256").update(J1_FIXTURE_RAW).digest("hex");
    expect(actual).toBe(PINNED_J1_FIXTURE_SHA256);
  });

  it("genuine J1 index → governed_read line appears in recall_activity lane", async () => {
    (globalThis as any).fetch = vi.fn(async () => okResponse(j1IndexJson));

    const feed = await getActivityFeed();
    expect(feed.is_empty).toBe(false);
    const recall = feed.lanes.find((l) => l.lane === "recall_activity")!;
    expect(recall.lines).toHaveLength(1);
    const line = recall.lines[0]!;
    expect(line.basis_receipt_id).toBe(J1_RECEIPT_ID);
    expect(line.profile_key).toBe("governed_read");
    expect(line.descend_ref).toContain(J1_RECEIPT_ID);
  });

  it("inspected-empty J1 (entries removed) → is_empty true, honest empty state", async () => {
    (globalThis as any).fetch = vi.fn(async () => okResponse(j1EmptyIndexJson));

    const feed = await getActivityFeed();
    expect(feed.is_empty).toBe(true);
    expect(feed.inspection.inspected).toBe(true);
    expect(feed.inspection.receipts_inspected).toBe(0);
  });
});

describe("getActivityFeed — fail closed on schema mismatch", () => {
  it("rejects a wrong schema_version and does NOT cache it", async () => {
    const badIndex = { ...emptyIndexJson, schema_version: 2 };
    const fetchMock = vi.fn(async () => okResponse(badIndex));
    (globalThis as any).fetch = fetchMock;

    await expect(getActivityFeed()).rejects.toThrow(/schema_version/);
    // Fail-closed: nothing poisoned the session cache.
    expect(sessionStore.set).not.toHaveBeenCalled();
  });

  it("rejects a wrong schema_family", async () => {
    const badIndex = { ...emptyIndexJson, schema_family: "counterpedia.not_this" };
    (globalThis as any).fetch = vi.fn(async () => okResponse(badIndex));
    await expect(getActivityFeed()).rejects.toThrow(/schema_family/);
  });
});
