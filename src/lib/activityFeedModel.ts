/**
 * Counterpedia activity feed model — pinned from ACT2 activity-index /
 * activity-feed-projection schema version 1.
 *
 * This file contains only type/interface definitions, pinned constants, a pure
 * projection, and validators. No runtime I/O and no code copied from the main
 * repo — it MIRRORS the ACT2 contract for cross-repo isolation, the same way
 * `cardModel.ts` mirrors the W1 record-card contract.
 *
 * What the extension consumes is the deterministic, disposable
 * `activity-index.json` artifact (schema_family `counterpedia.activity_index`,
 * schema_version 1). The index carries, per admitted PUBLIC receipt, only its
 * content-addressed identity, its profile, its event time, and its PUBLIC
 * visibility — never the receipt body. From those the extension builds a
 * client-side feed projection that mirrors ACT2's `activityFeedProjection`
 * contract.
 *
 * HARD invariants preserved here (verbatim from ACT2):
 *   - basis-descent: every feed line NAMES its receipt basis
 *     (`basis_receipt_id`) and can descend to it (`descend_ref`).
 *   - no-aggregate: NO trust / reputation / score / ranking / standing /
 *     aggregate verdict is computed or shown. The only integers are honest
 *     inspection bookkeeping, never a standing derived from activity.
 *   - absence discipline: the feed and each lane state which substrates and
 *     window they inspected; inspected-empty (`no_activity_recorded`) stays
 *     distinguishable from not-inspected.
 *   - PUBLIC-only by construction: the index carries only PUBLIC receipts, and
 *     a non-PUBLIC entry reaching the projection fails closed.
 *   - claim boundary stated on the projection surface.
 *
 * Faithfulness note: the index does not carry receipt bodies, so a feed line's
 * summary is a bounded, profile-level description of the recorded act ("what
 * class of act occurred, under a named receipt") — the full detail lives in the
 * receipt the line descends to. No per-receipt detail is fabricated from the
 * index.
 */

// ---------------------------------------------------------------------------
// Pinned index schema (the on-the-wire artifact the extension fetches)
// ---------------------------------------------------------------------------

export const PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY =
  "counterpedia.activity_index" as const;
export const PINNED_ACTIVITY_INDEX_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Pinned feed projection schema
// ---------------------------------------------------------------------------

export const PINNED_ACTIVITY_FEED_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Activity profiles (pinned closed set — ACT0 §2)
// ---------------------------------------------------------------------------

export const ACTIVITY_PROFILE_KEYS = [
  "governed_read",
  "reliance",
  "edition_drift",
  "reconsideration",
  "admission_event",
] as const;
export type ActivityProfileKey = (typeof ACTIVITY_PROFILE_KEYS)[number];

export const VALID_ACTIVITY_PROFILE_KEYS: ReadonlySet<string> = new Set(
  ACTIVITY_PROFILE_KEYS,
);

// ---------------------------------------------------------------------------
// Index shape (mirrored from ACT2 activityIndex.ts, for isolation)
// ---------------------------------------------------------------------------

export interface ActivityIndexEntry {
  /** Content-addressed receipt identity (`sha256:<hex>`). Descent basis. */
  receipt_id: string;
  profile_key: ActivityProfileKey;
  profile: string;
  /** Identity-bearing event time (ACT0 §3). */
  event_time: string;
  visibility: "PUBLIC";
}

export interface ActivityIndexInspection {
  substrates: readonly ActivityProfileKey[];
  window: string;
  /** PUBLIC receipts admitted into the index. Bookkeeping, NOT a standing. */
  receipt_count: number;
  /**
   * True when the index actually inspected its substrates. Distinguishes an
   * inspected-empty pool (receipt_count 0, inspected true) from an
   * absent/never-run index.
   */
  inspected: true;
}

export interface ActivityIndex {
  schema_family: typeof PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY;
  schema_version: typeof PINNED_ACTIVITY_INDEX_SCHEMA_VERSION;
  generated_by: string;
  boundary: string;
  inspection: ActivityIndexInspection;
  entries: readonly ActivityIndexEntry[];
}

// ---------------------------------------------------------------------------
// Feed projection shape (mirrored from ACT2 activityFeedProjection.ts)
// ---------------------------------------------------------------------------

/** The §4 feed families, in display order. */
export const ACTIVITY_FEED_LANES = [
  "record_activity",
  "source_activity",
  "recall_activity",
  "reliance",
  "reconsideration",
] as const;
export type ActivityFeedLane = (typeof ACTIVITY_FEED_LANES)[number];

/**
 * Which lane each profile projects into. `edition_drift` renders under record
 * activity alongside admission events. No profile maps to `source_activity` in
 * v0.1 — that lane is DECLARED and inspected but populated by no profile, so it
 * renders the honest inspected-empty state rather than fabricating events.
 */
const PROFILE_LANE: Record<ActivityProfileKey, ActivityFeedLane> = {
  admission_event: "record_activity",
  edition_drift: "record_activity",
  governed_read: "recall_activity",
  reliance: "reliance",
  reconsideration: "reconsideration",
};

const LANE_TITLE: Record<ActivityFeedLane, string> = {
  record_activity: "Record activity",
  source_activity: "Source activity",
  recall_activity: "Recall activity",
  reliance: "Reliance",
  reconsideration: "Reconsideration",
};

/**
 * Bounded, profile-level description of the recorded act. Descriptive, never
 * evaluative and never an aggregate. The full per-receipt detail lives in the
 * receipt the line descends to; the index does not carry it.
 */
const PROFILE_SUMMARY: Record<ActivityProfileKey, string> = {
  governed_read: "Governed read recorded",
  reliance: "Reliance declared",
  edition_drift: "Edition drift recorded",
  reconsideration: "Reconsideration recorded",
  admission_event: "Admission event recorded",
};

export interface ActivityFeedLine {
  /** The receipt this line stands on. Descent target. */
  basis_receipt_id: string;
  /** A resolvable descent ref to the underlying receipt. */
  descend_ref: string;
  profile: string;
  profile_key: ActivityProfileKey;
  lane: ActivityFeedLane;
  event_time: string;
  /** Neutral, bounded one-line description of the recorded act. */
  summary: string;
}

export type LaneEmptyReason = "no_activity_recorded" | "not_inspected";

export interface ActivityFeedLaneProjection {
  lane: ActivityFeedLane;
  title: string;
  /** Whether this lane's substrate was inspected. */
  inspected: boolean;
  /** Present only when the lane holds no lines: WHY it is empty. */
  empty_reason?: LaneEmptyReason;
  lines: readonly ActivityFeedLine[];
}

export interface ActivityFeedInspection {
  substrates: readonly ActivityProfileKey[];
  window: string;
  /** Count of PUBLIC receipts inspected. Bookkeeping, NOT a standing/score. */
  receipts_inspected: number;
  /** True when the substrates were actually inspected (vs. never run). */
  inspected: boolean;
}

export interface ActivityFeedProjection {
  schema_version: typeof PINNED_ACTIVITY_FEED_SCHEMA_VERSION;
  /** Claim boundary, rendered on the surface (ACT0 §4). */
  claim_boundary: string;
  /** Explicit no-aggregate notice (C6 / ACT0 §3). */
  no_aggregate_notice: string;
  inspection: ActivityFeedInspection;
  lanes: readonly ActivityFeedLaneProjection[];
  /** True when no lane holds any line. */
  is_empty: boolean;
}

export const ACTIVITY_FEED_CLAIM_BOUNDARY =
  "This feed is a read-only projection over admitted PUBLIC activity receipts. " +
  "Each line records that an act occurred under stated custody and names the " +
  "receipt it stands on; it asserts nothing about the truth of any content the " +
  "act touched. The feed is not a ledger of truth.";

export const ACTIVITY_FEED_NO_AGGREGATE_NOTICE =
  "No trust score, reputation, ranking, or aggregate verdict is derived from " +
  "this activity (C6 no-aggregate). Counts shown are inspection bookkeeping " +
  "only, never a standing.";

/**
 * The path fragment the extension descends to for a receipt id. Mirrors the
 * ACT2 projection's default descent base (the disposable index artifact is the
 * public descent target for a receipt id).
 */
export const ACTIVITY_DESCEND_BASE = "/counterpedia/activity-index.json" as const;

/**
 * Substring denylist for the no-aggregate invariant. If any key anywhere in a
 * projection matches one of these, the projection is rejected fail-closed — the
 * extension must never surface a derived standing, score, or ranking.
 */
const AGGREGATE_KEY_DENYLIST = [
  "score",
  "trust",
  "reputation",
  "ranking",
  "rank",
  "rating",
  "standing",
  "aggregate",
  "verdict",
  "average",
  "total_trust",
];

/**
 * Exact keys that are permitted despite matching a denylist substring. These
 * are the surface's own honest disclosures (e.g. the no-aggregate notice
 * literally names "aggregate"), never a derived standing.
 */
const AGGREGATE_KEY_ALLOWLIST: ReadonlySet<string> = new Set([
  "no_aggregate_notice",
]);

// ---------------------------------------------------------------------------
// Index validation — fail closed on schema mismatch
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed value as an `ActivityIndex`. Fails CLOSED on any
 * schema_family / schema_version mismatch (no coercion, no "best effort"),
 * mirroring the pinned-schema discipline of `validateCardModel`.
 */
export function validateActivityIndex(input: unknown): ActivityIndex {
  if (!isPlainObject(input)) {
    throw new Error("ActivityIndex: input must be an object");
  }

  if (input["schema_family"] !== PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY) {
    throw new Error(
      `ActivityIndex: schema_family must be ${JSON.stringify(PINNED_ACTIVITY_INDEX_SCHEMA_FAMILY)}, got ${JSON.stringify(input["schema_family"])}`,
    );
  }

  if (input["schema_version"] !== PINNED_ACTIVITY_INDEX_SCHEMA_VERSION) {
    throw new Error(
      `ActivityIndex: schema_version must be ${PINNED_ACTIVITY_INDEX_SCHEMA_VERSION}, got ${JSON.stringify(input["schema_version"])}`,
    );
  }

  const inspection = input["inspection"];
  if (!isPlainObject(inspection)) {
    throw new Error("ActivityIndex: inspection must be an object");
  }
  if (inspection["inspected"] !== true) {
    throw new Error(
      "ActivityIndex: inspection.inspected must be true (an index is always an inspected projection)",
    );
  }
  if (!Array.isArray(inspection["substrates"]) || inspection["substrates"].length === 0) {
    throw new Error(
      "ActivityIndex: inspection.substrates must be a non-empty array (an empty index must still state its scope)",
    );
  }
  if (typeof inspection["window"] !== "string" || inspection["window"].length === 0) {
    throw new Error("ActivityIndex: inspection.window must be a non-empty string");
  }
  if (typeof inspection["receipt_count"] !== "number") {
    throw new Error("ActivityIndex: inspection.receipt_count must be a number");
  }

  const entries = input["entries"];
  if (!Array.isArray(entries)) {
    throw new Error("ActivityIndex: entries must be an array");
  }
  for (const entry of entries) {
    validateActivityIndexEntry(entry);
  }

  return input as unknown as ActivityIndex;
}

function validateActivityIndexEntry(input: unknown): ActivityIndexEntry {
  if (!isPlainObject(input)) {
    throw new Error("ActivityIndexEntry: entry must be an object");
  }
  if (typeof input["receipt_id"] !== "string" || input["receipt_id"].length === 0) {
    throw new Error("ActivityIndexEntry: receipt_id must be a non-empty string");
  }
  if (!VALID_ACTIVITY_PROFILE_KEYS.has(input["profile_key"] as string)) {
    throw new Error(
      `ActivityIndexEntry: profile_key must be one of ${[...VALID_ACTIVITY_PROFILE_KEYS].join(", ")}, got ${JSON.stringify(input["profile_key"])}`,
    );
  }
  if (typeof input["profile"] !== "string" || input["profile"].length === 0) {
    throw new Error("ActivityIndexEntry: profile must be a non-empty string");
  }
  if (typeof input["event_time"] !== "string" || input["event_time"].length === 0) {
    throw new Error("ActivityIndexEntry: event_time must be a non-empty string");
  }
  // PUBLIC-only by construction: a non-PUBLIC entry reaching the public
  // projection is a contract breach and fails closed.
  if (input["visibility"] !== "PUBLIC") {
    throw new Error(
      `ActivityIndexEntry: visibility must be "PUBLIC" (the index carries PUBLIC receipts only), got ${JSON.stringify(input["visibility"])}`,
    );
  }
  return input as unknown as ActivityIndexEntry;
}

// ---------------------------------------------------------------------------
// Projection — index entries → feed, mirroring ACT2 buildActivityFeedProjection
// ---------------------------------------------------------------------------

function compareLines(a: ActivityFeedLine, b: ActivityFeedLine): number {
  if (a.event_time < b.event_time) return -1;
  if (a.event_time > b.event_time) return 1;
  if (a.basis_receipt_id < b.basis_receipt_id) return -1;
  if (a.basis_receipt_id > b.basis_receipt_id) return 1;
  return 0;
}

/**
 * Project a validated `ActivityIndex` into the client feed projection. Pure and
 * deterministic. Every line names its basis and descends to it; no aggregate is
 * derived; each lane states whether it was inspected and, when empty, why.
 */
export function projectIndexToFeed(index: ActivityIndex): ActivityFeedProjection {
  const linesByLane = new Map<ActivityFeedLane, ActivityFeedLine[]>();
  for (const lane of ACTIVITY_FEED_LANES) linesByLane.set(lane, []);

  for (const entry of index.entries) {
    if (entry.visibility !== "PUBLIC") {
      throw new Error(
        `projectIndexToFeed: non-PUBLIC entry reached the public feed (visibility=${entry.visibility})`,
      );
    }
    const lane = PROFILE_LANE[entry.profile_key];
    linesByLane.get(lane)!.push({
      basis_receipt_id: entry.receipt_id,
      descend_ref: `${ACTIVITY_DESCEND_BASE}#${entry.receipt_id}`,
      profile: entry.profile,
      profile_key: entry.profile_key,
      lane,
      event_time: entry.event_time,
      summary: PROFILE_SUMMARY[entry.profile_key],
    });
  }

  const lanes: ActivityFeedLaneProjection[] = ACTIVITY_FEED_LANES.map((lane) => {
    const lines = linesByLane.get(lane)!;
    lines.sort(compareLines);
    const projection: ActivityFeedLaneProjection = {
      lane,
      title: LANE_TITLE[lane],
      inspected: true,
      lines,
    };
    if (lines.length === 0) {
      // Inspected but empty: this lane recorded no PUBLIC activity — the
      // no-activity-recorded state, explicitly distinct from not-inspected.
      projection.empty_reason = "no_activity_recorded";
    }
    return projection;
  });

  // Report the full declared substrate set the index inspected, so an empty
  // feed reads as "inspected, recorded nothing", never "did not look".
  const substrates =
    index.inspection.substrates.length > 0
      ? [...index.inspection.substrates]
      : [...ACTIVITY_PROFILE_KEYS];

  const feed: ActivityFeedProjection = {
    schema_version: PINNED_ACTIVITY_FEED_SCHEMA_VERSION,
    claim_boundary: ACTIVITY_FEED_CLAIM_BOUNDARY,
    no_aggregate_notice: ACTIVITY_FEED_NO_AGGREGATE_NOTICE,
    inspection: {
      substrates,
      window: index.inspection.window,
      receipts_inspected: index.inspection.receipt_count,
      inspected: index.inspection.inspected,
    },
    lanes,
    is_empty: lanes.every((l) => l.lines.length === 0),
  };

  // Enforce the model invariants before handing the projection to the UI.
  return validateActivityFeed(feed);
}

// ---------------------------------------------------------------------------
// Feed validation — enforce the HARD invariants (basis-descent, no-aggregate,
// absence discipline). Throws on any breach.
// ---------------------------------------------------------------------------

function assertNoAggregateKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoAggregateKeys(v, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const lowerKey = key.toLowerCase();
      if (!AGGREGATE_KEY_ALLOWLIST.has(key)) {
        for (const banned of AGGREGATE_KEY_DENYLIST) {
          if (lowerKey.includes(banned)) {
            throw new Error(
              `ActivityFeedProjection: no-aggregate invariant violated — key ${JSON.stringify(key)} at ${path} matches banned aggregate term ${JSON.stringify(banned)}`,
            );
          }
        }
      }
      assertNoAggregateKeys(value[key], `${path}.${key}`);
    }
  }
}

/**
 * Validate a feed projection against the pinned schema version and the HARD
 * invariants. Throws (fail-closed) on any breach so the UI never renders a feed
 * that has lost basis-descent, leaked an aggregate, or muddled absence.
 */
export function validateActivityFeed(input: unknown): ActivityFeedProjection {
  if (!isPlainObject(input)) {
    throw new Error("ActivityFeedProjection: input must be an object");
  }

  if (input["schema_version"] !== PINNED_ACTIVITY_FEED_SCHEMA_VERSION) {
    throw new Error(
      `ActivityFeedProjection: schema_version must be ${PINNED_ACTIVITY_FEED_SCHEMA_VERSION}, got ${JSON.stringify(input["schema_version"])}`,
    );
  }

  if (typeof input["claim_boundary"] !== "string" || input["claim_boundary"].length === 0) {
    throw new Error(
      "ActivityFeedProjection: claim_boundary must be a non-empty string (claim boundary must be stated on the surface)",
    );
  }
  if (typeof input["no_aggregate_notice"] !== "string" || input["no_aggregate_notice"].length === 0) {
    throw new Error(
      "ActivityFeedProjection: no_aggregate_notice must be a non-empty string",
    );
  }

  const inspection = input["inspection"];
  if (!isPlainObject(inspection)) {
    throw new Error("ActivityFeedProjection: inspection must be an object");
  }
  if (!Array.isArray(inspection["substrates"]) || inspection["substrates"].length === 0) {
    throw new Error(
      "ActivityFeedProjection: inspection.substrates must be non-empty (an empty feed must state which substrates it inspected)",
    );
  }
  if (typeof inspection["window"] !== "string" || inspection["window"].length === 0) {
    throw new Error("ActivityFeedProjection: inspection.window must be a non-empty string");
  }
  if (typeof inspection["receipts_inspected"] !== "number") {
    throw new Error("ActivityFeedProjection: inspection.receipts_inspected must be a number");
  }
  if (typeof inspection["inspected"] !== "boolean") {
    throw new Error("ActivityFeedProjection: inspection.inspected must be a boolean");
  }

  const lanes = input["lanes"];
  if (!Array.isArray(lanes)) {
    throw new Error("ActivityFeedProjection: lanes must be an array");
  }
  for (const lane of lanes) {
    validateFeedLane(lane);
  }

  if (typeof input["is_empty"] !== "boolean") {
    throw new Error("ActivityFeedProjection: is_empty must be a boolean");
  }

  // no-aggregate invariant: no derived standing/score/reputation anywhere.
  assertNoAggregateKeys(input, "projection");

  return input as unknown as ActivityFeedProjection;
}

function validateFeedLane(input: unknown): void {
  if (!isPlainObject(input)) {
    throw new Error("ActivityFeedLaneProjection: lane must be an object");
  }
  if (!(ACTIVITY_FEED_LANES as readonly string[]).includes(input["lane"] as string)) {
    throw new Error(
      `ActivityFeedLaneProjection: lane must be one of ${ACTIVITY_FEED_LANES.join(", ")}, got ${JSON.stringify(input["lane"])}`,
    );
  }
  if (typeof input["title"] !== "string" || input["title"].length === 0) {
    throw new Error("ActivityFeedLaneProjection: title must be a non-empty string");
  }
  if (typeof input["inspected"] !== "boolean") {
    throw new Error("ActivityFeedLaneProjection: inspected must be a boolean (absence discipline)");
  }
  const lines = input["lines"];
  if (!Array.isArray(lines)) {
    throw new Error("ActivityFeedLaneProjection: lines must be an array");
  }
  if (lines.length === 0) {
    // Absence discipline: an empty lane MUST state why it is empty, and the
    // reason must distinguish inspected-empty from not-inspected.
    const reason = input["empty_reason"];
    if (reason !== "no_activity_recorded" && reason !== "not_inspected") {
      throw new Error(
        "ActivityFeedLaneProjection: an empty lane must carry empty_reason of no_activity_recorded | not_inspected (absence discipline)",
      );
    }
  }
  for (const line of lines) {
    validateFeedLine(line);
  }
}

function validateFeedLine(input: unknown): void {
  if (!isPlainObject(input)) {
    throw new Error("ActivityFeedLine: line must be an object");
  }
  // basis-descent: every line names its receipt basis and descends to it.
  if (typeof input["basis_receipt_id"] !== "string" || input["basis_receipt_id"].length === 0) {
    throw new Error(
      "ActivityFeedLine: basis_receipt_id must be a non-empty string (basis-descent: every line names its receipt basis)",
    );
  }
  if (typeof input["descend_ref"] !== "string" || input["descend_ref"].length === 0) {
    throw new Error(
      "ActivityFeedLine: descend_ref must be a non-empty string (basis-descent: every line can descend to its receipt)",
    );
  }
  if (!(input["descend_ref"] as string).includes(input["basis_receipt_id"] as string)) {
    throw new Error(
      "ActivityFeedLine: descend_ref must resolve to its basis_receipt_id (basis-descent must actually reach the basis)",
    );
  }
  if (!VALID_ACTIVITY_PROFILE_KEYS.has(input["profile_key"] as string)) {
    throw new Error(
      `ActivityFeedLine: profile_key must be one of ${[...VALID_ACTIVITY_PROFILE_KEYS].join(", ")}, got ${JSON.stringify(input["profile_key"])}`,
    );
  }
  if (typeof input["summary"] !== "string" || input["summary"].length === 0) {
    throw new Error("ActivityFeedLine: summary must be a non-empty string");
  }
  if (typeof input["event_time"] !== "string" || input["event_time"].length === 0) {
    throw new Error("ActivityFeedLine: event_time must be a non-empty string");
  }
}
