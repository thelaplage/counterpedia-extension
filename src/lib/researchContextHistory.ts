/**
 * Research Context panel — LOCAL-ONLY research-history summary
 * (RESEARCH-CONTEXT0).
 *
 * Composes two ALREADY-EXISTING local-only modules — `history.ts`
 * (CP-HISTORY0, the browser encounter ledger) and `researchSessions.ts`
 * (CP-RESEARCH-SESSION0, named groupings of encounters) — into the
 * `bounded_runs` / `held_ambiguities` counts the panel shows under
 * "Research history". It introduces NO new storage keys, NO new schema, and
 * NO network access of any kind: everything here is a read over
 * `chrome.storage.local` via the existing `LocalStorageArea` interface.
 *
 * "bounded_runs" = distinct LOCAL_ONLY research sessions (researchSessions.ts)
 *   that contain at least one encounter matching this page's locator.
 * "held_ambiguities" = LOCAL encounters (history.ts) of this locator whose
 *   resolution_status is AMBIGUOUS — the browser's own resolver could not
 *   pick a single match. This is a LOCAL, per-browser fact; it is never
 *   conflated with a Countergraph research gap ("held ambiguity" here is a
 *   local-resolution posture, not a countergraph claim-conflict finding).
 *
 * Matching is by EXACT string equality against `observed_url` /
 * `canonical_locator` — no fuzzy joins, no cross-product identity guessing.
 * An encounter with neither field equal to the current locator's
 * `current_url` or `canonical_url` is simply not counted.
 */

import type { LocalStorageArea } from "./history";
import { readEncounterLedger } from "./history";
import { readResearchSessions } from "./researchSessions";
import type { SourceLocator } from "./sourceWorkbench";
import type { ResearchHistorySummary } from "./researchContext";

function matchesLocator(
  encounter: { observed_url: string; canonical_locator?: string },
  locator: SourceLocator,
): boolean {
  const keys = new Set(
    [locator.current_url, locator.canonical_url].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  );
  return keys.has(encounter.observed_url) || (encounter.canonical_locator !== undefined && keys.has(encounter.canonical_locator));
}

/**
 * Read `chrome.storage.local` (via the caller-supplied `LocalStorageArea`,
 * same seam `history.ts`/`researchSessions.ts` already use for testability)
 * and summarize this page's LOCAL research history. Never throws on an
 * empty/absent ledger — returns the honest zero-count summary instead.
 */
export async function summarizeLocalResearchHistory(
  storage: LocalStorageArea,
  locator: SourceLocator,
): Promise<ResearchHistorySummary> {
  const [encounters, sessions] = await Promise.all([
    readEncounterLedger(storage),
    readResearchSessions(storage),
  ]);

  const matchingEncounters = encounters.filter((e) => matchesLocator(e, locator));
  const matchingEncounterIds = new Set(matchingEncounters.map((e) => e.encounter_id));

  const bounded_runs = sessions.filter((session) =>
    session.encounter_ids.some((id) => matchingEncounterIds.has(id)),
  ).length;

  const held_ambiguities = matchingEncounters.filter(
    (e) => e.resolution_status === "AMBIGUOUS",
  ).length;

  return { bounded_runs, held_ambiguities };
}
