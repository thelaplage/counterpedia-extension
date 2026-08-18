/**
 * Research Context panel — LOCAL-ONLY research-history composition
 * (RESEARCH-CONTEXT0). Guards that bounded_runs / held_ambiguities are
 * computed strictly from the two ALREADY-EXISTING local modules
 * (history.ts, researchSessions.ts) via exact locator matching, with no new
 * storage schema and no network.
 */

import { describe, expect, it } from "vitest";
import {
  recordPassiveEncounter,
  setHistoryMode,
  type LocalStorageArea,
  type PassiveEncounterObservation,
} from "../src/lib/history";
import { startResearchSession, appendEncounterToResearchSession } from "../src/lib/researchSessions";
import { summarizeLocalResearchHistory } from "../src/lib/researchContextHistory";
import type { SourceLocator } from "../src/lib/sourceWorkbench";

class MemoryStorage implements LocalStorageArea {
  readonly state: Record<string, unknown> = {};
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const wanted = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      wanted.filter((key) => key in this.state).map((key) => [key, this.state[key]]),
    );
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.state, items);
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.state[key];
  }
}

const LOCATOR: SourceLocator = {
  current_url: "https://example.org/reuters",
  canonical_url: "https://example.org/reuters",
  title: "Reuters wire item",
};

const OTHER_LOCATOR: SourceLocator = {
  current_url: "https://example.org/other-page",
  canonical_url: null,
  title: null,
};

function observation(overrides: Partial<PassiveEncounterObservation> = {}): PassiveEncounterObservation {
  const resolution_status = overrides.resolution_status ?? "MATCHED";
  const base: PassiveEncounterObservation = {
    collector_id: "test",
    observed_url: LOCATOR.current_url,
    canonical_locator: LOCATOR.canonical_url ?? undefined,
    source_kind: "webpage",
    resolution_status,
    // Only a MATCHED encounter is permitted to carry canonical_source_ref /
    // corpus_presence (history.ts:parseEncounter fails closed otherwise).
    ...(resolution_status === "MATCHED"
      ? { canonical_source_ref: "source:reuters-2026-01-01", corpus_presence: "public_current" as const }
      : {}),
  };
  return { ...base, ...overrides };
}

describe("summarizeLocalResearchHistory", () => {
  it("returns zero counts on an empty ledger", async () => {
    const storage = new MemoryStorage();
    const summary = await summarizeLocalResearchHistory(storage, LOCATOR);
    expect(summary).toEqual({ bounded_runs: 0, held_ambiguities: 0 });
  });

  it("counts distinct sessions that encountered this locator as bounded_runs", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");

    const rec1 = await recordPassiveEncounter(storage, observation(), {
      now: () => "2026-08-01T00:00:00.000Z",
      makeId: () => "enc-1",
    });
    const rec2 = await recordPassiveEncounter(storage, observation(), {
      now: () => "2026-08-02T00:00:00.000Z",
      makeId: () => "enc-2",
    });
    // Unrelated encounter of a DIFFERENT locator — must not be counted.
    await recordPassiveEncounter(storage, observation({ observed_url: OTHER_LOCATOR.current_url }), {
      now: () => "2026-08-03T00:00:00.000Z",
      makeId: () => "enc-other",
    });
    if (!rec1.recorded || !rec2.recorded) throw new Error("setup: expected recordings");

    const sessionA = await startResearchSession(storage, "Session A", {
      now: () => "2026-08-01T00:00:00.000Z",
      makeId: () => "session-a",
    });
    await appendEncounterToResearchSession(storage, sessionA.session_ref, rec1.encounter.encounter_id);
    await appendEncounterToResearchSession(storage, sessionA.session_ref, "enc-other");

    const summary = await summarizeLocalResearchHistory(storage, LOCATOR);
    expect(summary.bounded_runs).toBe(1);
  });

  it("counts two distinct sessions as two bounded_runs", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    const rec1 = await recordPassiveEncounter(storage, observation(), {
      now: () => "2026-08-01T00:00:00.000Z",
      makeId: () => "enc-1",
    });
    if (!rec1.recorded) throw new Error("setup");

    const sessionA = await startResearchSession(storage, "Session A", {
      now: () => "2026-08-01T00:00:00.000Z",
      makeId: () => "session-a",
    });
    await appendEncounterToResearchSession(storage, sessionA.session_ref, rec1.encounter.encounter_id);
    // Session A must be STOPPED before a second can be started.
    const { stopResearchSession } = await import("../src/lib/researchSessions");
    await stopResearchSession(storage, { now: () => "2026-08-01T01:00:00.000Z" });

    const sessionB = await startResearchSession(storage, "Session B", {
      now: () => "2026-08-02T00:00:00.000Z",
      makeId: () => "session-b",
    });
    await appendEncounterToResearchSession(storage, sessionB.session_ref, rec1.encounter.encounter_id);

    const summary = await summarizeLocalResearchHistory(storage, LOCATOR);
    expect(summary.bounded_runs).toBe(2);
  });

  it("counts AMBIGUOUS-resolution encounters of this locator as held_ambiguities", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    await recordPassiveEncounter(storage, observation({ resolution_status: "AMBIGUOUS" }), {
      now: () => "2026-08-01T00:00:00.000Z",
      makeId: () => "enc-1",
    });
    await recordPassiveEncounter(storage, observation({ resolution_status: "MATCHED" }), {
      now: () => "2026-08-02T00:00:00.000Z",
      makeId: () => "enc-2",
    });
    // AMBIGUOUS but for a different locator — must not be counted.
    await recordPassiveEncounter(
      storage,
      observation({
        observed_url: OTHER_LOCATOR.current_url,
        canonical_locator: undefined,
        resolution_status: "AMBIGUOUS",
      }),
      { now: () => "2026-08-03T00:00:00.000Z", makeId: () => "enc-3" },
    );

    const summary = await summarizeLocalResearchHistory(storage, LOCATOR);
    expect(summary.held_ambiguities).toBe(1);
  });

  it("matches by canonical_locator when observed_url differs (e.g. tracking params stripped)", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    await recordPassiveEncounter(
      storage,
      observation({
        observed_url: `${LOCATOR.current_url}?utm_source=twitter`,
        canonical_locator: LOCATOR.current_url,
        resolution_status: "AMBIGUOUS",
      }),
      { now: () => "2026-08-01T00:00:00.000Z", makeId: () => "enc-1" },
    );
    const summary = await summarizeLocalResearchHistory(storage, LOCATOR);
    expect(summary.held_ambiguities).toBe(1);
  });

  it("returns zero counts when History mode is OFF (no ledger writes occurred)", async () => {
    const storage = new MemoryStorage();
    // History mode left at default (OFF) — recordPassiveEncounter is a no-op.
    const result = await recordPassiveEncounter(storage, observation(), {
      now: () => "2026-08-01T00:00:00.000Z",
      makeId: () => "enc-1",
    });
    expect(result.recorded).toBe(false);
    const summary = await summarizeLocalResearchHistory(storage, LOCATOR);
    expect(summary).toEqual({ bounded_runs: 0, held_ambiguities: 0 });
  });
});
