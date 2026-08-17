/**
 * CHECK-RESULT0 — pure projection helpers for the evidentiary anatomy already
 * present in Counterpedia search results.
 *
 * This layer does not infer truth, support, or overstatement beyond the fields
 * supplied by the existing public search projection. It only makes those
 * fields legible to the consumer UI.
 */

import type { SearchResult } from "../types";

export interface RecordAnatomyProjection {
  recordId: string;
  supportedFormulation: string | null;
  whyNot: string | null;
  sourceLabels: string[];
  sourceCount: number;
  changeCount: number;
  hasChanges: boolean;
  verificationPosture: SearchResult["verification_posture"];
  verificationTokens: string[];
}

export interface CheckAnatomySummary {
  recordsChecked: number;
  supportedFormulations: number;
  whyNotAvailable: number;
  changedRecords: number;
  verificationAvailable: number;
  sourceLabelsVisible: number;
}

export function projectRecordAnatomy(
  result: SearchResult,
): RecordAnatomyProjection {
  return {
    recordId: result.record_id,
    supportedFormulation: result.supported_proposition,
    whyNot: result.why_not_summary,
    sourceLabels: [...result.top_source_labels],
    sourceCount: result.source_count,
    changeCount: result.change_count,
    hasChanges: result.has_changes,
    verificationPosture: result.verification_posture,
    verificationTokens: [...result.verification_tokens],
  };
}

export function projectCheckAnatomy(
  results: SearchResult[],
): CheckAnatomySummary {
  return {
    recordsChecked: results.length,
    supportedFormulations: results.filter(
      (result) => result.supported_proposition !== null,
    ).length,
    whyNotAvailable: results.filter(
      (result) =>
        result.why_not_summary !== null || result.refusal_count > 0,
    ).length,
    changedRecords: results.filter((result) => result.has_changes).length,
    verificationAvailable: results.filter(
      (result) => result.verification_posture !== "none",
    ).length,
    sourceLabelsVisible: results.reduce(
      (count, result) => count + result.top_source_labels.length,
      0,
    ),
  };
}

export function verificationPostureLabel(
  posture: SearchResult["verification_posture"],
): string {
  switch (posture) {
    case "receipt_present":
      return "Verification receipt available";
    case "reports_present":
      return "Verification reports available";
    case "none":
      return "No verification surface in this result";
  }
}
