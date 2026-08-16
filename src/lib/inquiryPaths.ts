/**
 * CHECK-PATHS0 — attributable inquiry-path suggestions.
 *
 * Public Counterpedia is the only live provider in this stack, but the consumer
 * contract is provider-neutral so My Knowledge, Countergraph, organizations,
 * FSKN domains, Researcher profiles, and agent-proposed routes can later
 * contribute without becoming one blended recommendation authority.
 */

import type { SearchResult } from "../types";
import {
  PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
  providerScopedPathId,
  type InquiryPathProvider,
  type InquiryPathProviderRef,
} from "./pathProviderContract";

export type { InquiryPathProviderRef } from "./pathProviderContract";
export { PUBLIC_COUNTERPEDIA_PATH_PROVIDER } from "./pathProviderContract";

export type InquiryPathKind = "structural" | "record_topic" | "source_path";
export type InquiryPathBasis =
  | "result_structure"
  | "record_title"
  | "source_label"
  | "graph_relation"
  | "local_history"
  | "foreign_projection"
  | "researcher_profile"
  | "agent_proposal";

export interface InquiryPathProvenance {
  /** Canonical provider identity. */
  provider: InquiryPathProviderRef;
  /** Compatibility/display mirror of provider.label; never an authority field. */
  domain: string;
  basis: InquiryPathBasis;
  explanation: string;
  /** Current-result anchors when a suggestion is grounded in this Check. */
  recordIds: string[];
  recordTitles: string[];
}

export interface InquiryPathSuggestion {
  /** Provider-scoped opaque id after aggregation. */
  id: string;
  label: string;
  kind: InquiryPathKind;
  provenance: InquiryPathProvenance;
}

export interface InquiryPathProviderContext {
  query: string;
  results: SearchResult[];
}

export type CounterpediaInquiryPathProvider = InquiryPathProvider<
  InquiryPathProviderContext,
  InquiryPathSuggestion
>;

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
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "");
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

function publicProvenance(input: {
  basis: InquiryPathBasis;
  explanation: string;
  recordIds: string[];
  recordTitles: string[];
}): InquiryPathProvenance {
  return {
    provider: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
    domain: PUBLIC_COUNTERPEDIA_PATH_PROVIDER.label,
    ...input,
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
      provenance: publicProvenance({
        basis: "result_structure",
        explanation: definition.explanation,
        ...basis,
      }),
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
        const existing = byLabel.get(key) ?? {
          label: segment,
          ids: new Set<string>(),
        };
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
      provenance: publicProvenance({
        basis: "record_title",
        explanation:
          "Suggested from a bounded title/subtitle segment in the current matched record set.",
        ...basis,
      }),
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
      const existing = byLabel.get(key) ?? {
        label,
        ids: new Set<string>(),
      };
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
      provenance: publicProvenance({
        basis: "source_label",
        explanation:
          "Suggested because this source label appears in the current matched record set.",
        ...basis,
      }),
    });
  }
}

function suggestPublicCounterpediaPaths(
  context: InquiryPathProviderContext,
): InquiryPathSuggestion[] {
  if (context.results.length === 0) return [];
  const out: InquiryPathSuggestion[] = [];
  addStructuralPaths(out, context.results);
  addRecordTopicPaths(out, context.query, context.results, 6);
  addSourcePaths(out, context.results, 4);
  return out;
}

export const publicCounterpediaInquiryPathProvider: CounterpediaInquiryPathProvider = {
  ref: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
  suggest: suggestPublicCounterpediaPaths,
};

/**
 * Aggregate attributable provider outputs without allowing an implementation to
 * spoof another provider's identity. The registered provider ref overwrites any
 * provider/domain value returned in the suggestion payload.
 *
 * Same-label paths from different providers intentionally remain distinct.
 */
export function suggestInquiryPathsWithProviders(
  query: string,
  results: SearchResult[],
  providers: CounterpediaInquiryPathProvider[],
): InquiryPathSuggestion[] {
  const context: InquiryPathProviderContext = { query, results };
  const out: InquiryPathSuggestion[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    for (const proposed of provider.suggest(context)) {
      const id = providerScopedPathId(provider.ref, proposed.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        ...proposed,
        id,
        provenance: {
          ...proposed.provenance,
          provider: provider.ref,
          domain: provider.ref.label,
        },
      });
    }
  }
  return out;
}

export function suggestInquiryPaths(
  query: string,
  results: SearchResult[],
): InquiryPathSuggestion[] {
  return suggestInquiryPathsWithProviders(query, results, [
    publicCounterpediaInquiryPathProvider,
  ]);
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
