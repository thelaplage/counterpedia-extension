/**
 * Activity feed model tests.
 *
 * Validates the pinned ACT2 activity-index / activity-feed schema versions, the
 * index → feed projection, and the HARD invariants: basis-descent, no-aggregate,
 * and absence discipline (inspected-empty distinct from not-inspected).
 */

import { describe, it, expect } from "vitest";
import {
  PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY,
  PINNED_ACTIVITY_INDEX_SCHEMA_VERSION,
  PINNED_ACTIVITY_FEED_SCHEMA_VERSION,
  validateActivityIndex,
  validateActivityFeed,
  projectIndexToFeed,
  ACTIVITY_FEED_LANES,
  type ActivityIndex,
  type ActivityFeedProjection,
} from "../src/lib/activityFeedModel";

// The honest inspected-empty index, byte-shaped like the committed artifact.
const emptyIndex: ActivityIndex = {
  schema_family: PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY,
  schema_version: PINNED_ACTIVITY_INDEX_SCHEMA_VERSION,
  generated_by: "counterpedia-activity-index-exporter",
  boundary:
    "Deterministic, disposable index over admitted PUBLIC srs.activity.* receipts.",
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

// A populated index with two synthetic PUBLIC entries — exercises the
// projection path (fixtures for testing, never rendered as real activity).
const populatedIndex: ActivityIndex = {
  ...emptyIndex,
  inspection: { ...emptyIndex.inspection, receipt_count: 2 },
  entries: [
    {
      receipt_id: "sha256:aaa111",
      profile_key: "admission_event",
      profile: "srs.activity.admission_event.v0.1",
      event_time: "2026-08-01T00:00:00Z",
      visibility: "PUBLIC",
    },
    {
      receipt_id: "sha256:bbb222",
      profile_key: "governed_read",
      profile: "srs.activity.governed_read.v0.1",
      event_time: "2026-08-02T00:00:00Z",
      visibility: "PUBLIC",
    },
  ],
};

describe("pinned schema versions", () => {
  it("index schema family/version match the ACT2 contract", () => {
    expect(PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY).toBe("counterpedia.activity_index");
    expect(PINNED_ACTIVITY_INDEX_SCHEMA_VERSION).toBe(1);
  });

  it("feed schema version is pinned to 1", () => {
    expect(PINNED_ACTIVITY_FEED_SCHEMA_VERSION).toBe(1);
  });
});

describe("validateActivityIndex", () => {
  it("accepts the honest empty index", () => {
    expect(() => validateActivityIndex(emptyIndex)).not.toThrow();
  });

  it("fails closed on schema_family mismatch", () => {
    const bad = { ...emptyIndex, schema_family: "counterpedia.something_else" };
    expect(() => validateActivityIndex(bad)).toThrow(/schema_family/);
  });

  it("fails closed on schema_version mismatch", () => {
    const bad = { ...emptyIndex, schema_version: 2 };
    expect(() => validateActivityIndex(bad)).toThrow(/schema_version/);
  });

  it("rejects an index that does not state its inspected scope", () => {
    const bad = {
      ...emptyIndex,
      inspection: { ...emptyIndex.inspection, substrates: [] },
    };
    expect(() => validateActivityIndex(bad)).toThrow(/substrates/);
  });

  it("rejects a non-PUBLIC entry (PUBLIC-only by construction)", () => {
    const bad = {
      ...populatedIndex,
      entries: [
        { ...populatedIndex.entries[0], visibility: "PRIVATE_ORG" },
        populatedIndex.entries[1],
      ],
    };
    expect(() => validateActivityIndex(bad)).toThrow(/PUBLIC/);
  });

  it("rejects an unknown profile_key", () => {
    const bad = {
      ...populatedIndex,
      entries: [{ ...populatedIndex.entries[0], profile_key: "made_up" }],
    };
    expect(() => validateActivityIndex(bad)).toThrow(/profile_key/);
  });
});

describe("projectIndexToFeed — inspected-empty state", () => {
  const feed = projectIndexToFeed(emptyIndex);

  it("produces all five feed lanes", () => {
    expect(feed.lanes.map((l) => l.lane)).toEqual([...ACTIVITY_FEED_LANES]);
  });

  it("is honest-empty and states which substrates it inspected", () => {
    expect(feed.is_empty).toBe(true);
    expect(feed.inspection.substrates.length).toBeGreaterThan(0);
    expect(feed.inspection.window).toBe("unbounded");
    expect(feed.inspection.receipts_inspected).toBe(0);
    expect(feed.inspection.inspected).toBe(true);
  });

  it("marks every empty lane inspected-empty (no_activity_recorded), NOT not-inspected", () => {
    for (const lane of feed.lanes) {
      expect(lane.lines.length).toBe(0);
      expect(lane.inspected).toBe(true);
      expect(lane.empty_reason).toBe("no_activity_recorded");
    }
  });

  it("states the claim boundary and no-aggregate notice on the surface", () => {
    expect(feed.claim_boundary).toMatch(/not a ledger of truth/i);
    expect(feed.no_aggregate_notice).toMatch(/no-aggregate/i);
  });
});

describe("projectIndexToFeed — populated, basis-descent preserved", () => {
  const feed = projectIndexToFeed(populatedIndex);

  it("routes each profile into its lane", () => {
    const recall = feed.lanes.find((l) => l.lane === "recall_activity")!;
    const record = feed.lanes.find((l) => l.lane === "record_activity")!;
    expect(recall.lines).toHaveLength(1);
    expect(record.lines).toHaveLength(1);
  });

  it("gives every line a basis_receipt_id AND a descend_ref that reaches it", () => {
    const lines = feed.lanes.flatMap((l) => l.lines);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.basis_receipt_id.length).toBeGreaterThan(0);
      expect(line.descend_ref).toContain(line.basis_receipt_id);
      expect(line.descend_ref).toContain("/counterpedia/activity-index.json#");
    }
  });

  it("reports the source substrates were inspected", () => {
    expect(feed.is_empty).toBe(false);
    expect(feed.inspection.receipts_inspected).toBe(2);
  });
});

describe("validateActivityFeed — invariants", () => {
  const goodFeed = projectIndexToFeed(populatedIndex);

  it("accepts a well-formed projection", () => {
    expect(() => validateActivityFeed(goodFeed)).not.toThrow();
  });

  it("fails closed on feed schema_version mismatch", () => {
    const bad = { ...goodFeed, schema_version: 2 };
    expect(() => validateActivityFeed(bad)).toThrow(/schema_version/);
  });

  it("rejects a line that lost its basis-descent", () => {
    const bad: ActivityFeedProjection = JSON.parse(JSON.stringify(goodFeed));
    const lane = bad.lanes.find((l) => l.lines.length > 0)!;
    (lane.lines as any)[0].descend_ref = "/somewhere/else";
    expect(() => validateActivityFeed(bad)).toThrow(/basis/i);
  });

  it("rejects a line with an empty basis_receipt_id", () => {
    const bad: ActivityFeedProjection = JSON.parse(JSON.stringify(goodFeed));
    const lane = bad.lanes.find((l) => l.lines.length > 0)!;
    (lane.lines as any)[0].basis_receipt_id = "";
    expect(() => validateActivityFeed(bad)).toThrow(/basis_receipt_id/);
  });

  it("rejects a projection that leaks an aggregate/score/reputation key (no-aggregate)", () => {
    const bad: any = JSON.parse(JSON.stringify(goodFeed));
    bad.inspection.trust_score = 0.9;
    expect(() => validateActivityFeed(bad)).toThrow(/no-aggregate/i);
  });

  it("rejects a per-line reputation/standing key (no-aggregate, deep)", () => {
    const bad: any = JSON.parse(JSON.stringify(goodFeed));
    const lane = bad.lanes.find((l: any) => l.lines.length > 0)!;
    lane.lines[0].reputation = 5;
    expect(() => validateActivityFeed(bad)).toThrow(/no-aggregate/i);
  });

  it("rejects an empty lane that omits its empty_reason (absence discipline)", () => {
    const bad: any = JSON.parse(JSON.stringify(projectIndexToFeed(emptyIndex)));
    delete bad.lanes[0].empty_reason;
    expect(() => validateActivityFeed(bad)).toThrow(/empty_reason/);
  });
});
