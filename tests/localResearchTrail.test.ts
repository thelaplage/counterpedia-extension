import { describe, expect, it } from "vitest";
import type { SearchResult } from "../src/types";
import {
  LOCAL_RESEARCH_BOUNDARY,
  LOCAL_RESEARCH_TRAIL_SCHEMA,
  LOCAL_RESEARCH_TRAIL_STORAGE_KEY,
  LocalResearchTrailError,
  appendLocalResearchTrail,
  buildCheckTrailEntry,
  buildRecordTrailEntry,
  buildSourceTrailEntry,
  parseStoredResearchTrail,
  type LocalResearchTrailEntry,
  type LocalResearchTrailStorage,
} from "../src/lib/localResearchTrail";

const result: SearchResult = {
  record_id: "REC-1",
  record_url: "/records/REC-1",
  title: "Example record",
  corpus_posture: "admitted",
  corpus_posture_label: "Admitted record",
  edition: "REC-1@v1",
  supported_proposition: "A narrower supported proposition.",
  source_count: 2,
  top_source_labels: ["Primary source", "Independent source"],
  why_not_summary: "The broader wording is not established by the cited record.",
  refusal_count: 1,
  has_changes: true,
  change_count: 2,
  verification_posture: "receipt_present",
  verification_tokens: ["receipt"],
};

const source = {
  current_url: "https://example.com/article",
  canonical_url: "https://example.com/article",
  title: "Example article",
  observed_in_browser: true,
};

class MemoryStorage implements LocalResearchTrailStorage {
  value: unknown = undefined;

  async get(_key: string): Promise<unknown> {
    return this.value;
  }

  async set(_key: string, value: LocalResearchTrailEntry[]): Promise<void> {
    this.value = value;
  }
}

describe("local research trail", () => {
  it("keeps source residue without manufacturing memory admission or publication", () => {
    const entry = buildSourceTrailEntry({
      entryId: "entry-source-1",
      keptAt: "2026-08-15T23:00:00.000Z",
      source,
    });

    expect(entry.schema).toBe(LOCAL_RESEARCH_TRAIL_SCHEMA);
    expect(entry.kind).toBe("source");
    expect(entry.boundary).toEqual(LOCAL_RESEARCH_BOUNDARY);
    expect(entry.boundary.memory_admission).toBe("not_performed");
    expect(entry.boundary.publication).toBe("not_performed");
    expect(entry.boundary.network_egress).toBe("none");
  });

  it("keeps one selected public record as structured research, not a bookmark-only URL", () => {
    const entry = buildRecordTrailEntry({
      entryId: "entry-record-1",
      keptAt: "2026-08-15T23:01:00.000Z",
      query: "example claim",
      record: result,
      source,
    });

    expect(entry.record.record_id).toBe("REC-1");
    expect(entry.record.supported_proposition).toContain("narrower");
    expect(entry.record.why_not_summary).toContain("broader wording");
    expect(entry.record.top_source_labels).toEqual([
      "Primary source",
      "Independent source",
    ]);
    expect(entry.boundary.memory_admission).toBe("not_performed");
  });

  it("keeps a whole Check as query + structured record snapshots", () => {
    const entry = buildCheckTrailEntry({
      entryId: "entry-check-1",
      keptAt: "2026-08-15T23:02:00.000Z",
      query: "example claim",
      records: [result],
      source,
    });

    expect(entry.kind).toBe("check");
    expect(entry.records).toHaveLength(1);
    expect(entry.records[0]?.verification_posture).toBe("receipt_present");
  });

  it("appends without deleting prior research residue", async () => {
    const storage = new MemoryStorage();
    const first = buildSourceTrailEntry({
      entryId: "entry-1",
      keptAt: "2026-08-15T23:03:00.000Z",
      source,
    });
    const second = buildRecordTrailEntry({
      entryId: "entry-2",
      keptAt: "2026-08-15T23:04:00.000Z",
      query: "example claim",
      record: result,
      source,
    });

    expect(await appendLocalResearchTrail(storage, first)).toBe(1);
    expect(await appendLocalResearchTrail(storage, second)).toBe(2);
    expect(parseStoredResearchTrail(storage.value).map((item) => item.entry_id)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(LOCAL_RESEARCH_TRAIL_STORAGE_KEY).toContain("local-research-trail");
  });

  it("fails closed instead of overwriting malformed existing trail state", async () => {
    const storage = new MemoryStorage();
    storage.value = [{ schema: "not-counterpedia" }];
    const entry = buildSourceTrailEntry({
      entryId: "entry-1",
      keptAt: "2026-08-15T23:05:00.000Z",
      source,
    });

    await expect(appendLocalResearchTrail(storage, entry)).rejects.toBeInstanceOf(
      LocalResearchTrailError,
    );
    expect(storage.value).toEqual([{ schema: "not-counterpedia" }]);
  });

  it("refuses non-http source locators", () => {
    expect(() =>
      buildSourceTrailEntry({
        entryId: "entry-bad",
        keptAt: "2026-08-15T23:06:00.000Z",
        source: { ...source, current_url: "file:///private/a" },
      }),
    ).toThrow(LocalResearchTrailError);
  });
});
