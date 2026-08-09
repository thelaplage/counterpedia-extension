/**
 * Activity client tests.
 *
 * Covers fetch + session cache, credentials:"omit" privacy discipline,
 * rate-limit / HTTP error handling, and fail-closed schema-version validation.
 * Chrome storage and fetch are mocked in-memory (node env).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY,
  PINNED_ACTIVITY_INDEX_SCHEMA_VERSION,
} from "../src/lib/activityFeedModel";
import { getActivityFeed, clearActivityCache } from "../src/lib/activityClient";

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

// ---------------------------------------------------------------------------
// J1 golden test — genuine Counterpedia activity-index.json (PR #230)
// ---------------------------------------------------------------------------

const J1_RECEIPT_ID =
  "sha256:e43967191a87d06ba35de54e3a918cded748861df55c9307f6d7aab4789d8ae5";

const j1IndexJson = {
  schema_family: PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY,
  schema_version: PINNED_ACTIVITY_INDEX_SCHEMA_VERSION,
  generated_by: "counterpedia-activity-index-exporter",
  boundary:
    "Deterministic, disposable index over admitted PUBLIC srs.activity.* receipts. Rebuildable from the receipts alone; not a source of truth, not a database, and not an aggregate, score, or reputation over activity. Each entry addresses one receipt by its content-addressed identity. An empty index states which substrates and window it inspected.",
  inspection: {
    substrates: [
      "governed_read",
      "reliance",
      "edition_drift",
      "reconsideration",
      "admission_event",
    ],
    window: "unbounded",
    receipt_count: 1,
    inspected: true,
  },
  entries: [
    {
      receipt_id: J1_RECEIPT_ID,
      profile_key: "governed_read",
      profile: "srs.activity.governed_read.v0.1",
      event_time: "2026-08-09T00:00:00Z",
      visibility: "PUBLIC",
    },
  ],
};

// J1 with entries removed — tests honest inspected-empty removal path.
const j1EmptyIndexJson = {
  ...j1IndexJson,
  inspection: { ...j1IndexJson.inspection, receipt_count: 0 },
  entries: [],
};

describe("getActivityFeed — J1 golden test (genuine PR #230 index)", () => {
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
