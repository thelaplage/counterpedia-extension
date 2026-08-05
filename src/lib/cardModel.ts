/**
 * Counterpedia Record Card model — pinned from W1 schema version 1.
 * Update when main repo releases schema version 2.
 *
 * This file contains only type/interface definitions, no runtime code
 * from the main repo.
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const PINNED_CARD_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// CorpusPosture (pinned set)
// ---------------------------------------------------------------------------

export type CorpusPosture =
  | "governed_public_record"
  | "republished_counterpose"
  | "synthetic_demonstration"
  | "historical_demonstration"
  | "classification_unavailable";

export const VALID_CORPUS_POSTURES: ReadonlySet<string> = new Set([
  "governed_public_record",
  "republished_counterpose",
  "synthetic_demonstration",
  "historical_demonstration",
  "classification_unavailable",
]);

// ---------------------------------------------------------------------------
// VerificationToken
// ---------------------------------------------------------------------------

export type VerificationToken =
  | "true"
  | "false"
  | "not_evaluated"
  | "artifact_unavailable";

// ---------------------------------------------------------------------------
// CounterpediaRecordCardModel
// ---------------------------------------------------------------------------

export interface CounterpediaRecordCardModel {
  schema_version: typeof PINNED_CARD_SCHEMA_VERSION;
  record_id: string;
  record_url: string; // always "/records/{record_id}"
  title: string;
  subtitle?: string;
  corpus_posture: CorpusPosture;
  corpus_posture_label: string;
  edition: string;
  supported_proposition: string | null;
  source_count: number;
  top_source_labels: string[];
  why_not_summary: string | null;
  refusal_count: number;
  has_changes: boolean;
  change_count: number;
  verification_posture: "receipt_present" | "reports_present" | "none";
  verification_tokens: VerificationToken[];
}

// ---------------------------------------------------------------------------
// validateCardModel
// ---------------------------------------------------------------------------

export function validateCardModel(input: unknown): CounterpediaRecordCardModel {
  if (typeof input !== "object" || input === null) {
    throw new Error("CounterpediaRecordCardModel: input must be an object");
  }

  const obj = input as Record<string, unknown>;

  if (obj["schema_version"] !== PINNED_CARD_SCHEMA_VERSION) {
    throw new Error(
      `CounterpediaRecordCardModel: schema_version must be ${PINNED_CARD_SCHEMA_VERSION}, got ${JSON.stringify(obj["schema_version"])}`,
    );
  }

  if (typeof obj["record_id"] !== "string" || obj["record_id"].length === 0) {
    throw new Error(
      "CounterpediaRecordCardModel: record_id must be a non-empty string",
    );
  }

  if (typeof obj["record_url"] !== "string") {
    throw new Error("CounterpediaRecordCardModel: record_url must be a string");
  }

  if (typeof obj["title"] !== "string" || obj["title"].length === 0) {
    throw new Error(
      "CounterpediaRecordCardModel: title must be a non-empty string",
    );
  }

  if (
    obj["corpus_posture"] === undefined ||
    !VALID_CORPUS_POSTURES.has(obj["corpus_posture"] as string)
  ) {
    throw new Error(
      `CounterpediaRecordCardModel: corpus_posture must be one of ${[...VALID_CORPUS_POSTURES].join(", ")}, got ${JSON.stringify(obj["corpus_posture"])}`,
    );
  }

  return obj as unknown as CounterpediaRecordCardModel;
}
