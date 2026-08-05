/**
 * Card schema tests.
 * Validates the pinned W1 card schema version and validation logic.
 */

import { describe, it, expect } from "vitest";
import {
  PINNED_CARD_SCHEMA_VERSION,
  validateCardModel,
  type CounterpediaRecordCardModel,
} from "../src/lib/cardModel";

const validCard: CounterpediaRecordCardModel = {
  schema_version: 1,
  record_id: "garp-example-001",
  record_url: "/records/garp-example-001",
  title: "Example Governed Record",
  subtitle: "A test record",
  corpus_posture: "governed_public_record",
  corpus_posture_label: "Governed Public Record",
  edition: "2024-01-01",
  supported_proposition: "The example proposition holds.",
  source_count: 2,
  top_source_labels: ["Source A", "Source B"],
  why_not_summary: null,
  refusal_count: 0,
  has_changes: false,
  change_count: 1,
  verification_posture: "none",
  verification_tokens: [],
};

describe("PINNED_CARD_SCHEMA_VERSION", () => {
  it("equals 1", () => {
    expect(PINNED_CARD_SCHEMA_VERSION).toBe(1);
  });
});

describe("validateCardModel", () => {
  it("accepts a valid card model", () => {
    expect(() => validateCardModel(validCard)).not.toThrow();
    const result = validateCardModel(validCard);
    expect(result.record_id).toBe("garp-example-001");
  });

  it("fails validation when record_id is missing", () => {
    const bad = { ...validCard, record_id: "" };
    expect(() => validateCardModel(bad)).toThrow(/record_id/);
  });

  it("fails validation when record_id is not a string", () => {
    const bad = { ...validCard, record_id: 42 };
    expect(() => validateCardModel(bad)).toThrow(/record_id/);
  });

  it("fails validation when schema_version is wrong", () => {
    const bad = { ...validCard, schema_version: 2 };
    expect(() => validateCardModel(bad)).toThrow(/schema_version/);
  });

  it("fails validation when title is missing", () => {
    const bad = { ...validCard, title: "" };
    expect(() => validateCardModel(bad)).toThrow(/title/);
  });

  it("fails validation when corpus_posture is invalid", () => {
    const bad = { ...validCard, corpus_posture: "totally_made_up" };
    expect(() => validateCardModel(bad)).toThrow(/corpus_posture/);
  });

  it("fails validation when input is null", () => {
    expect(() => validateCardModel(null)).toThrow();
  });

  it("fails validation when input is not an object", () => {
    expect(() => validateCardModel("not an object")).toThrow();
  });

  it("accepts all valid corpus_posture values", () => {
    const postures = [
      "governed_public_record",
      "republished_counterpose",
      "synthetic_demonstration",
      "historical_demonstration",
      "classification_unavailable",
    ] as const;

    for (const posture of postures) {
      const card = { ...validCard, corpus_posture: posture };
      expect(() => validateCardModel(card)).not.toThrow();
    }
  });
});
