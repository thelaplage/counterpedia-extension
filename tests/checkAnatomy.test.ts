import { describe, expect, it } from "vitest";
import type { SearchResult } from "../src/types";
import {
  projectCheckAnatomy,
  projectRecordAnatomy,
  verificationPostureLabel,
} from "../src/lib/checkAnatomy";

const base: SearchResult = {
  record_id: "REC-1",
  record_url: "/records/REC-1",
  title: "Example record",
  corpus_posture: "admitted",
  corpus_posture_label: "Admitted record",
  edition: "REC-1@v1",
  supported_proposition: "The investigation ended without charges.",
  source_count: 2,
  top_source_labels: ["Agency notice", "Court filing"],
  why_not_summary: "The record does not contain an affirmative finding clearing the conduct.",
  refusal_count: 1,
  has_changes: true,
  change_count: 2,
  verification_posture: "receipt_present",
  verification_tokens: ["receipt"],
};

describe("Check result anatomy", () => {
  it("projects only fields already carried by the public result", () => {
    const p = projectRecordAnatomy(base);
    expect(p.supportedFormulation).toContain("without charges");
    expect(p.whyNot).toContain("does not contain");
    expect(p.changeCount).toBe(2);
    expect(p.sourceLabels).toEqual(["Agency notice", "Court filing"]);
    expect(p.verificationPosture).toBe("receipt_present");
  });

  it("summarizes useful structure even when every matched result is supported", () => {
    const second: SearchResult = {
      ...base,
      record_id: "REC-2",
      supported_proposition: "A second supported formulation.",
      why_not_summary: null,
      refusal_count: 0,
      has_changes: false,
      change_count: 0,
      verification_posture: "reports_present",
      verification_tokens: ["report"],
    };
    expect(projectCheckAnatomy([base, second])).toEqual({
      recordsChecked: 2,
      supportedFormulations: 2,
      whyNotAvailable: 1,
      changedRecords: 1,
      verificationAvailable: 2,
      sourceLabelsVisible: 4,
    });
  });

  it("does not turn absent verification into a positive claim", () => {
    expect(verificationPostureLabel("none")).toBe(
      "No verification surface in this result",
    );
  });
});
