/**
 * Research Context panel — presentation model (RESEARCH-CONTEXT0).
 *
 * A PURE module: no Chrome APIs, no DOM, no network. It composes THREE
 * already-computed, independently-governed inputs into one read-only
 * presentation for the side panel:
 *
 *   1. `searchResults` — the SAME SearchResult[] this extension already
 *      fetches via `counterpediaClient.search()` for the existing results
 *      state (see src/panel/panel.ts). This module adds NO new network
 *      egress: it re-reads what the panel already resolved for "is this
 *      page's URL a known Counterpedia source" and "what records cite it."
 *      (`SearchResult.source_canonical_urls` is not exposed on the shape the
 *      client returns, so matching is by presence of any result — the same
 *      signal `swState.publicMaterial` already uses in panel.ts.)
 *
 *   2. `publicSourceLink` — an optional, externally-supplied
 *      `PublicObjectLinkV01`-shaped object, pinned to the shape
 *      `resolvePublicObjectLink()` returns in thelaplage/counterpedia
 *      (`lib/counterpedia/publicObjectLink.ts`, PR #475
 *      "RESEARCH-LINK0", commit 6833d9643826c6bf1dab71e596e50d8544335310).
 *      That PR is OPEN/DRAFT/UNRATIFIED and has no public transport in this
 *      repo yet — HELD, same discipline as `sourceWorkbench.ts`'s
 *      `SourceWorkResolution`. When omitted, the panel falls back to the
 *      existing, always-safe `buildSourceDeepLink()` handoff.
 *
 *   3. `gapPacket` — an optional, externally-supplied
 *      `ResearchContextPacketV01`-shaped object, pinned to the shape
 *      `build_research_context_packet()` emits in thelaplage/countergraph
 *      (`countergraph/research_context_packet.py`, schema
 *      `countergraph.research-context-packet/v0.1`, PR #88, merged to
 *      countergraph `main` at commit bb407d3e7577c81b0abdbf5d5e28e0dc6b33a87b
 *      — composes PR #84's `ResearchGapPacket`). No public transport for
 *      this exists in this repo yet either — HELD.
 *
 * THIS MODULE DOES NO RESEARCH, NO ADMISSION, AND NO CLASSIFICATION OF THE
 * CURRENT PAGE. It never infers "this looks like an FAA document" or any
 * other heuristic — every fact it renders traces to one of the three typed,
 * validated inputs above. Absent an input, the corresponding section is
 * honestly empty ("research history not available in this browser" /
 * "no gap packet supplied"), never guessed or synthesized.
 *
 * Fail-closed: `validatePublicObjectLink` / `validateResearchContextPacket`
 * throw on any structural mismatch; callers that want a non-throwing default
 * use the `try*` variants, mirroring `sourceWorkbench.ts` /
 * `cardModel.ts` / `counterpediaClient.ts`'s existing validation discipline.
 * Digests carried in a ResearchContextPacketV01 are displayed verbatim as
 * opaque provenance — this module does not recompute them (it has no access
 * to countergraph's canonicalization profile and must not become a second
 * digest authority, per this repo's CLAUDE.md).
 */

import type { SearchResult } from "../types";
import { buildSourceDeepLink, type SourceLocator } from "./sourceWorkbench";

// ---------------------------------------------------------------------------
// PublicObjectLink (pinned, DRAFT/UNRATIFIED — see module doc)
// ---------------------------------------------------------------------------

export const PUBLIC_OBJECT_LINK_STATUSES = [
  "public_link_available",
  "no_public_route",
  "unknown_ref",
  "not_public",
] as const;
export type PublicObjectLinkStatus = (typeof PUBLIC_OBJECT_LINK_STATUSES)[number];

export interface PublicObjectLinkV01 {
  readonly public_status: PublicObjectLinkStatus;
  readonly href?: string;
  readonly label?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same-origin-path check, mirrored from sourceWorkbench.ts's ref safety rule. */
function isSameOriginPath(ref: string | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("/") && !ref.startsWith("//");
}

/**
 * Validate a parsed value as a PublicObjectLinkV01. Fails CLOSED (throws) on
 * any schema mismatch. `href` is required and must be a same-origin path
 * when `public_status === "public_link_available"` — an external href is
 * never trusted as a Counterpedia source link, mirroring the same rule
 * `sourceWorkbench.ts` applies to `workbench_ref`/`receipt_ref`.
 */
export function validatePublicObjectLink(input: unknown): PublicObjectLinkV01 {
  if (!isPlainObject(input)) {
    throw new Error("PublicObjectLinkV01: input must be an object");
  }
  const status = input["public_status"];
  if (!(PUBLIC_OBJECT_LINK_STATUSES as readonly string[]).includes(status as string)) {
    throw new Error(`PublicObjectLinkV01: unrecognized public_status ${JSON.stringify(status)}`);
  }
  if (input["href"] !== undefined && typeof input["href"] !== "string") {
    throw new Error("PublicObjectLinkV01: href must be a string when present");
  }
  if (input["label"] !== undefined && typeof input["label"] !== "string") {
    throw new Error("PublicObjectLinkV01: label must be a string when present");
  }
  if (status === "public_link_available" && !isSameOriginPath(input["href"] as string | undefined)) {
    throw new Error(
      "PublicObjectLinkV01: public_link_available requires a same-origin href (cannot trust an external link as a Counterpedia source link)",
    );
  }
  return input as unknown as PublicObjectLinkV01;
}

export function tryValidatePublicObjectLink(input: unknown): PublicObjectLinkV01 | null {
  try {
    return validatePublicObjectLink(input);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ResearchContextPacket (pinned, merged upstream — see module doc)
// ---------------------------------------------------------------------------

export const RESEARCH_CONTEXT_PACKET_SCHEMA = "countergraph.research-context-packet/v0.1" as const;

export interface ResearchGapContextItemV01 {
  readonly gap_item_ref: string;
  readonly type: string;
  readonly affected_refs: readonly string[];
  readonly why_unresolved: string;
  readonly structural_reduction_condition: string;
  readonly non_reducing_examples: readonly string[];
}

export interface ResearchContextPacketV01 {
  readonly schema: typeof RESEARCH_CONTEXT_PACKET_SCHEMA;
  readonly question_ref: string;
  readonly snapshot_digest: string;
  readonly gap_packet_digest: string | null;
  readonly gap_context: readonly ResearchGapContextItemV01[];
  readonly gap_item_counts_by_type: Readonly<Record<string, number>>;
  readonly packet_digest: string;
}

const REQUIRED_PACKET_KEYS = [
  "schema",
  "question_ref",
  "snapshot_digest",
  "gap_context",
  "gap_item_counts_by_type",
  "packet_digest",
] as const;

const REQUIRED_GAP_ITEM_KEYS = [
  "gap_item_ref",
  "type",
  "affected_refs",
  "why_unresolved",
  "structural_reduction_condition",
  "non_reducing_examples",
] as const;

/**
 * Validate a parsed value as a ResearchContextPacketV01. Fails CLOSED on any
 * missing required field or schema mismatch. Deliberately permissive of
 * *extra* top-level fields (`content_trust`, `evidence_neighborhood`,
 * `non_claims` are real fields on the countergraph producer's output — see
 * fixtures — this module just doesn't require every one of them to render
 * the panel) but strict about the fields it reads and renders.
 */
export function validateResearchContextPacket(input: unknown): ResearchContextPacketV01 {
  if (!isPlainObject(input)) {
    throw new Error("ResearchContextPacketV01: input must be an object");
  }
  for (const key of REQUIRED_PACKET_KEYS) {
    if (!(key in input)) {
      throw new Error(`ResearchContextPacketV01: missing required field ${key}`);
    }
  }
  if (input["schema"] !== RESEARCH_CONTEXT_PACKET_SCHEMA) {
    throw new Error(
      `ResearchContextPacketV01: schema must be ${JSON.stringify(RESEARCH_CONTEXT_PACKET_SCHEMA)}, got ${JSON.stringify(input["schema"])}`,
    );
  }
  if (typeof input["question_ref"] !== "string" || input["question_ref"].length === 0) {
    throw new Error("ResearchContextPacketV01: question_ref must be a non-empty string");
  }
  if (typeof input["snapshot_digest"] !== "string") {
    throw new Error("ResearchContextPacketV01: snapshot_digest must be a string");
  }
  if (input["gap_packet_digest"] !== null && typeof input["gap_packet_digest"] !== "string") {
    throw new Error("ResearchContextPacketV01: gap_packet_digest must be a string or null");
  }
  if (typeof input["packet_digest"] !== "string") {
    throw new Error("ResearchContextPacketV01: packet_digest must be a string");
  }
  if (!Array.isArray(input["gap_context"])) {
    throw new Error("ResearchContextPacketV01: gap_context must be an array");
  }
  const gap_context = input["gap_context"].map((raw, index) =>
    validateGapContextItem(raw, index),
  );
  const counts = input["gap_item_counts_by_type"];
  if (!isPlainObject(counts)) {
    throw new Error("ResearchContextPacketV01: gap_item_counts_by_type must be an object");
  }
  for (const [type, count] of Object.entries(counts)) {
    if (typeof count !== "number" || count < 0) {
      throw new Error(`ResearchContextPacketV01: gap_item_counts_by_type[${type}] must be a non-negative number`);
    }
  }

  return {
    schema: RESEARCH_CONTEXT_PACKET_SCHEMA,
    question_ref: input["question_ref"],
    snapshot_digest: input["snapshot_digest"],
    gap_packet_digest: input["gap_packet_digest"] as string | null,
    gap_context,
    gap_item_counts_by_type: counts as Record<string, number>,
    packet_digest: input["packet_digest"],
  };
}

function validateGapContextItem(raw: unknown, index: number): ResearchGapContextItemV01 {
  if (!isPlainObject(raw)) {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}] must be an object`);
  }
  for (const key of REQUIRED_GAP_ITEM_KEYS) {
    if (!(key in raw)) {
      throw new Error(`ResearchContextPacketV01: gap_context[${index}] missing field ${key}`);
    }
  }
  if (typeof raw["gap_item_ref"] !== "string" || raw["gap_item_ref"].length === 0) {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}].gap_item_ref must be a non-empty string`);
  }
  if (typeof raw["type"] !== "string" || raw["type"].length === 0) {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}].type must be a non-empty string`);
  }
  if (!Array.isArray(raw["affected_refs"]) || !raw["affected_refs"].every((r) => typeof r === "string")) {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}].affected_refs must be a string array`);
  }
  if (typeof raw["why_unresolved"] !== "string" || raw["why_unresolved"].length === 0) {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}].why_unresolved must be a non-empty string`);
  }
  if (typeof raw["structural_reduction_condition"] !== "string") {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}].structural_reduction_condition must be a string`);
  }
  if (
    !Array.isArray(raw["non_reducing_examples"]) ||
    !raw["non_reducing_examples"].every((r) => typeof r === "string")
  ) {
    throw new Error(`ResearchContextPacketV01: gap_context[${index}].non_reducing_examples must be a string array`);
  }
  return {
    gap_item_ref: raw["gap_item_ref"],
    type: raw["type"],
    affected_refs: raw["affected_refs"],
    why_unresolved: raw["why_unresolved"],
    structural_reduction_condition: raw["structural_reduction_condition"],
    non_reducing_examples: raw["non_reducing_examples"],
  };
}

export function tryValidateResearchContextPacket(input: unknown): ResearchContextPacketV01 | null {
  try {
    return validateResearchContextPacket(input);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Used by" — record labels, drawn ONLY from already-fetched SearchResult[]
// ---------------------------------------------------------------------------

export interface UsedByEntry {
  readonly record_id: string;
  readonly title: string;
  readonly record_url: string;
}

const MAX_USED_BY_ENTRIES = 10;

function usedByFromSearchResults(searchResults: readonly SearchResult[]): readonly UsedByEntry[] {
  return searchResults.slice(0, MAX_USED_BY_ENTRIES).map((r) => ({
    record_id: r.record_id,
    title: r.title,
    record_url: r.record_url,
  }));
}

// ---------------------------------------------------------------------------
// Open documentary gaps — rendered verbatim, never resolved / judged
// ---------------------------------------------------------------------------

export interface OpenGapEntry {
  readonly gap_item_ref: string;
  readonly type: string;
  readonly why_unresolved: string;
}

const MAX_OPEN_GAPS = 20;

function openGapsFromPacket(packet: ResearchContextPacketV01 | null): readonly OpenGapEntry[] {
  if (!packet) return [];
  return packet.gap_context.slice(0, MAX_OPEN_GAPS).map((item) => ({
    gap_item_ref: item.gap_item_ref,
    type: item.type,
    why_unresolved: item.why_unresolved,
  }));
}

// ---------------------------------------------------------------------------
// Research history — LOCAL-ONLY summary (see researchContextHistory.ts)
// ---------------------------------------------------------------------------

export interface ResearchHistorySummary {
  /** Count of distinct LOCAL_ONLY research sessions that encountered this locator. */
  readonly bounded_runs: number;
  /** Count of LOCAL encounters of this locator whose resolution was AMBIGUOUS. */
  readonly held_ambiguities: number;
}

// ---------------------------------------------------------------------------
// Composite presentation
// ---------------------------------------------------------------------------

export interface ResearchContextPresentation {
  readonly locator: SourceLocator;
  /** Whether ANY existing search result matched this page (reuses the exact
   *  signal panel.ts already computes for swState.publicMaterial — no new
   *  classification is performed here). */
  readonly in_corpus: boolean;
  /** Best-match record title, present only when in_corpus. */
  readonly source_title: string | null;
  /** Always-safe deep link (existing capability, never HELD). */
  readonly source_deep_link_url: string;
  /** Direct source link — only when a valid PublicObjectLinkV01 was supplied
   *  and resolved to public_link_available; null while HELD. */
  readonly public_source_link_url: string | null;
  readonly used_by: readonly UsedByEntry[];
  readonly open_gaps: readonly OpenGapEntry[];
  /** null when no gap packet was supplied at all (HELD) — distinct from an
   *  empty array, which means a packet WAS supplied and reported zero gaps. */
  readonly gap_packet_supplied: boolean;
  readonly research_history: ResearchHistorySummary | null;
  readonly no_public_record_copy: string | null;
}

export const NO_PUBLIC_RECORD_COPY =
  "Counterpedia does not have a public record for this source yet.";

export interface ResearchContextInput {
  readonly locator: SourceLocator;
  readonly searchResults: readonly SearchResult[];
  /** DRAFT/UNRATIFIED, HELD by default — see module doc. */
  readonly publicSourceLink?: unknown;
  /** HELD by default — see module doc. */
  readonly gapPacket?: unknown;
  readonly researchHistory?: ResearchHistorySummary;
  readonly baseUrl?: string;
}

/**
 * Build the Research Context presentation. Pure function of its inputs —
 * never performs a lookup, a fetch, or a classification decision itself.
 */
export function buildResearchContextPresentation(
  input: ResearchContextInput,
): ResearchContextPresentation {
  const in_corpus = input.searchResults.length > 0;
  const source_title = in_corpus ? (input.searchResults[0]?.title ?? null) : null;

  const publicLink =
    input.publicSourceLink === undefined ? null : tryValidatePublicObjectLink(input.publicSourceLink);
  const public_source_link_url =
    publicLink && publicLink.public_status === "public_link_available" && publicLink.href
      ? new URL(publicLink.href, input.baseUrl ?? "https://www.garpedia.org").toString()
      : null;

  const gapPacket =
    input.gapPacket === undefined ? null : tryValidateResearchContextPacket(input.gapPacket);

  return {
    locator: input.locator,
    in_corpus,
    source_title,
    source_deep_link_url: buildSourceDeepLink(input.locator, input.baseUrl),
    public_source_link_url,
    used_by: usedByFromSearchResults(input.searchResults),
    open_gaps: openGapsFromPacket(gapPacket),
    gap_packet_supplied: gapPacket !== null,
    research_history: input.researchHistory ?? null,
    no_public_record_copy: in_corpus ? null : NO_PUBLIC_RECORD_COPY,
  };
}
