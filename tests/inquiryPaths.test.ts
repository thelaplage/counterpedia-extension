import { describe, expect, it } from "vitest";
import type { SearchResult } from "../src/types";
import {
  PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
  suggestInquiryPaths,
  suggestInquiryPathsWithProviders,
  visibleRecordIdsForPaths,
  type CounterpediaInquiryPathProvider,
  type InquiryPathSuggestion,
} from "../src/lib/inquiryPaths";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    record_id: "REC-1",
    record_url: "/records/REC-1",
    title: "Hip-hop production — Sampling technology",
    subtitle: "Drum machines and samplers",
    corpus_posture: "admitted",
    corpus_posture_label: "Admitted record",
    edition: "REC-1@v1",
    supported_proposition: "Sampling workflows changed production technique.",
    source_count: 2,
    top_source_labels: ["Interview archive"],
    why_not_summary: "The stronger universal formulation is not supported.",
    refusal_count: 1,
    has_changes: true,
    change_count: 2,
    verification_posture: "receipt_present",
    verification_tokens: ["receipt"],
    ...overrides,
  };
}

describe("inquiry paths", () => {
  it("suggests structural paths only when current result structure supports them", () => {
    const paths = suggestInquiryPaths("hip-hop production", [result()]);
    const labels = paths.map((path) => path.label);
    expect(labels).toContain("Sources");
    expect(labels).toContain("Why not?");
    expect(labels).toContain("What changed?");
    expect(labels).toContain("Verification");
  });

  it("suggests bounded record-topic paths with exact public provenance", () => {
    const paths = suggestInquiryPaths("hip-hop production", [result()]);
    const sampling = paths.find((path) => path.label === "Sampling technology");
    expect(sampling?.kind).toBe("record_topic");
    expect(sampling?.provenance.provider).toEqual(
      PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
    );
    expect(sampling?.provenance.domain).toBe("Public Counterpedia");
    expect(sampling?.provenance.recordIds).toEqual(["REC-1"]);
    expect(sampling?.provenance.basis).toBe("record_title");
  });

  it("surfaces source-label paths without treating the source as standing", () => {
    const paths = suggestInquiryPaths("hip-hop production", [result()]);
    const source = paths.find((path) => path.label === "Interview archive");
    expect(source?.kind).toBe("source_path");
    expect(source?.provenance.basis).toBe("source_label");
  });

  it("keeps identical labels from different providers distinct and binds attribution to the registered provider", () => {
    const proposed: InquiryPathSuggestion = {
      id: "regional-radio",
      label: "Regional radio",
      kind: "record_topic",
      provenance: {
        provider: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
        domain: "spoofed public label",
        basis: "foreign_projection",
        explanation: "Foreign provider proposes a developed branch.",
        recordIds: ["REC-1"],
        recordTitles: ["Regional radio"],
      },
    };
    const foreignA: CounterpediaInquiryPathProvider = {
      ref: {
        id: "jazz.commons",
        label: "Jazz Discography Commons",
        kind: "federated_domain",
      },
      suggest: () => [proposed],
    };
    const foreignB: CounterpediaInquiryPathProvider = {
      ref: {
        id: "my.knowledge",
        label: "My Knowledge",
        kind: "local_knowledge",
      },
      suggest: () => [proposed],
    };
    const paths = suggestInquiryPathsWithProviders(
      "radio",
      [result()],
      [foreignA, foreignB],
    );
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.provenance.provider.id)).toEqual([
      "jazz.commons",
      "my.knowledge",
    ]);
    expect(paths.map((path) => path.provenance.domain)).toEqual([
      "Jazz Discography Commons",
      "My Knowledge",
    ]);
    expect(new Set(paths.map((path) => path.id)).size).toBe(2);
  });

  it("selecting multiple paths broadens the local path view by union", () => {
    const first = result();
    const second = result({
      record_id: "REC-2",
      title: "Record-label economics — Distribution contracts",
      subtitle: "",
      top_source_labels: ["Industry filing"],
      why_not_summary: null,
      refusal_count: 0,
      has_changes: false,
      change_count: 0,
      verification_posture: "none",
      verification_tokens: [],
    });
    const results = [first, second];
    const paths = suggestInquiryPaths("music production", results);
    const sampling = paths.find((path) => path.label === "Sampling technology");
    const contracts = paths.find((path) => path.label === "Distribution contracts");
    expect(sampling).toBeTruthy();
    expect(contracts).toBeTruthy();
    const visible = visibleRecordIdsForPaths(
      results,
      paths,
      new Set([sampling!.id, contracts!.id]),
    );
    expect([...visible].sort()).toEqual(["REC-1", "REC-2"]);
  });

  it("no selected path leaves the whole matched result set visible", () => {
    const results = [
      result(),
      result({ record_id: "REC-2", title: "Regional radio" }),
    ];
    const paths = suggestInquiryPaths("hip-hop", results);
    expect([...visibleRecordIdsForPaths(results, paths, new Set())].sort()).toEqual([
      "REC-1",
      "REC-2",
    ]);
  });
});
