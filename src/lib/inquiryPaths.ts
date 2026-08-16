/**
 * CHECK-PATHS0 — deterministic inquiry-path suggestions from the structure the
 * current Counterpedia search projection actually exposes.
 *
 * This is intentionally not an ontology service and not model inference. Every
 * suggestion carries the exact current-record basis that caused it to exist.
 * Future Countergraph / FSKN / specialist-domain providers can implement the
 * same consumer shape without changing the UI contract.
 */

import type { SearchResult } from "../types";

export type InquiryPathKind = "structural" | "record_topic" | "source_path";
export type InquiryPathBasis =
  | "result_structure"
  | "record_title"
  | "source_label";

export interface InquiryPathProvenance {
  domain: "Public Counterpedia";
  basis: InquiryPathBasis;
  explanation: string;
  recordIds: string[];
  recordTitles: string[];
}

export interface InquiryPathSuggestion {
  id: string;
  label: string;
  kind: InquiryPathKind;
  provenance: InquiryPathProvenance;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "in", "into", "is", "it", "of", "on", "or", "that", "the", "their", "this",
  "to", "was", "were", "with", "without", "record", "records", "counterpedia",
]);

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 72) || "path";
}

function boundedLabel(value: string): string | null {
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "");
  if (cleaned.length < 3 || cleaned.length > 72) return null;
  return cleaned;
}

function queryTerms(query: string): Set<string> {
  return new Set(normalize(query).split(" ").filter(Boolean));
}

function isOnlyQueryTerms(label: string, query: Set<string>): boolean {
  const terms = normalize(label)
    .split(" ")
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
  return terms.length > 0 && terms.every((term) => query.has(term));
}

function titleSegments(title: string): string[] {
  const raw = title
    .split(/\s+[—–-]\s+|[:|/()]/g)
    .map((part) => boundedLabel(part))
    .filter((part): part is string => part !== null);

  if (raw.length > 1) return raw;
  const whole = boundedLabel(title);
  if (!whole) return [];
  const wordCount = normalize(whole).split(" ").filter(Boolean).length;
  return wordCount <= 5 ? [whole] : [];
}

function exactRecordBasis(
  results: SearchResult[],
  recordIds: Set<string>,
): Pick<InquiryPathProvenance, "recordIds" | "recordTitles"> {
  const matching = results.filter((result) => recordIds.has(result.record_id));
  return {
    recordIds: matching.map((result) => result.record_id),
    recordTitles: matching.map((result) => result.title),
  };
}

function addStructuralPaths(
  out: InquiryPathSuggestion[],
  results: SearchResult[],
): void {
  const definitions: Array<{
    key: string;
    label: string;
    explanation: string;
    matches: (result: SearchResult) => boolean;
  }> = [
    {
      key: "sources",
      label: "Sources",
      explanation: "Matched records expose source material for this Check.",
      matches: (result) => result.source_count > 0,
    },
    {
      key: "why-not",
      label: "Why not?",
      explanation: "Matched records preserve a refusal or Why-not explanation.",
      matches: (result) =>
        result.why_not_summary !== null || result.refusal_count > 0,
    },
    {
      key: "what-changed",
      label: "What changed?",
      explanation: "Matched records carry recorded change history.",
      matches: (result) => result.has_changes,
    },
    {
      key: "verification",
      label: "Verification",
      explanation: "Matched records expose a verification receipt or report surface.",
      matches: (result) => result.verification_posture !== "none",
    },
  ];

  for (const definition of definitions) {
    const ids = new Set(
      results.filter(definition.matches).map((result) => result.record_id),
    );
    if (ids.size === 0) continue;
    const basis = exactRecordBasis(results, ids);
    out.push({
      id: `structural:${definition.key}`,
      label: definition.label,
      kind: "structural",
      provenance: {
        domain: "Public Counterpedia",
        basis: "result_structure",
        explanation: definition.explanation,
        ...basis,
      },
    });
  }
}

function addRecordTopicPaths(
  out: InquiryPathSuggestion[],
  query: string,
  results: SearchResult[],
  limit: number,
): void {
  const querySet = queryTerms(query);
  const byLabel = new Map<string, { label: string; ids: Set<string> }>();

  for (const result of results) {
    const fields = [result.title, result.subtitle ?? ""];
    for (const field of fields) {
      for (const segment of titleSegments(field)) {
        const key = normalize(segment);
        if (!key || isOnlyQueryTerms(segment, querySet)) continue;
        const meaningful = key
          .split(" ")
          .filter((term) => term.length > 2 && !STOPWORDS.has(term));
        if (meaningful.length === 0) continue;
        const existing = byLabel.get(key) ?? { label: segment, ids: new Set<string>() };
        existing.ids.add(result.record_id);
        byLabel.set(key, existing);
      }
    }
  }

  const candidates = [...byLabel.values()]
    .sort((a, b) => b.ids.size - a.ids.size || a.label.localeCompare(b.label))
    .slice(0, limit);

  for (const candidate of candidates) {
    const basis = exactRecordBasis(results, candidate.ids);
    out.push({
      id: `record-topic:${slug(candidate.label)}`,
      label: candidate.label,
      kind: "record_topic",
      provenance: {
        domain: "Public Counterpedia",
        basis: "record_title",
        explanation:
          "Suggested from a bounded title/subtitle segment in the current matched record set.",
        ...basis,
      },
    });
  }
}

function addSourcePaths(
  out: InquiryPathSuggestion[],
  results: SearchResult[],
  limit: number,
): void {
  const byLabel = new Map<string, { label: string; ids: Set<string> }>();
  for (const result of results) {
    for (const sourceLabel of result.top_source_labels) {
      const label = boundedLabel(sourceLabel);
      if (!label) continue;
      const key = normalize(label);
      const existing = byLabel.get(key) ?? { label, ids: new Set<string>() };
      existing.ids.add(result.record_id);
      byLabel.set(key, existing);
    }
  }

  const candidates = [...byLabel.values()]
    .sort((a, b) => b.ids.size - a.ids.size || a.label.localeCompare(b.label))
    .slice(0, limit);

  for (const candidate of candidates) {
    const basis = exactRecordBasis(results, candidate.ids);
    out.push({
      id: `source-path:${slug(candidate.label)}`,
      label: candidate.label,
      kind: "source_path",
      provenance: {
        domain: "Public Counterpedia",
        basis: "source_label",
        explanation:
          "Suggested because this source label appears in the current matched record set.",
        ...basis,
      },
    });
  }
}

export function suggestInquiryPaths(
  query: string,
  results: SearchResult[],
): InquiryPathSuggestion[] {
  if (results.length === 0) return [];

  const out: InquiryPathSuggestion[] = [];
  addStructuralPaths(out, results);
  addRecordTopicPaths(out, query, results, 6);
  addSourcePaths(out, results, 4);

  const seen = new Set<string>();
  return out.filter((path) => {
    const key = `${path.kind}:${normalize(path.label)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function visibleRecordIdsForPaths(
  results: SearchResult[],
  suggestions: InquiryPathSuggestion[],
  selectedPathIds: ReadonlySet<string>,
): Set<string> {
  if (selectedPathIds.size === 0) {
    return new Set(results.map((result) => result.record_id));
  }

  const visible = new Set<string>();
  for (const suggestion of suggestions) {
    if (!selectedPathIds.has(suggestion.id)) continue;
    for (const recordId of suggestion.provenance.recordIds) {
      visible.add(recordId);
    }
  }
  return visible;
}
