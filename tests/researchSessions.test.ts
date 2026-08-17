import { describe, expect, it } from "vitest";

import {
  ACTIVE_RESEARCH_SESSION_KEY,
  RESEARCH_SESSIONS_KEY,
  appendEncounterToResearchSession,
  deleteResearchSession,
  readActiveResearchSessionRef,
  readResearchSessions,
  startResearchSession,
  stopResearchSession,
  type ResearchSessionV01,
} from "../src/lib/researchSessions";
import {
  readEncounterLedger,
  recordPassiveEncounter,
  setHistoryMode,
  type LocalStorageArea,
} from "../src/lib/history";

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

const START = {
  now: () => "2026-08-17T06:30:00.000Z",
  makeId: () => "boeing-session",
};

function observation(session_ref?: string) {
  return {
    collector_id: "wikipedia_v0_1",
    observed_url: "https://en.wikipedia.org/wiki/Boeing_737_MAX",
    canonical_locator: "https://en.wikipedia.org/wiki/Boeing_737_MAX",
    source_kind: "wikipedia_page",
    source_native_ids: {
      wikipedia_language: "en",
      wikipedia_title: "Boeing 737 MAX",
    },
    resolution_status: "UNRESOLVED" as const,
    ...(session_ref ? { session_ref } : {}),
  };
}

describe("CP-RESEARCH-SESSION0", () => {
  it("starts one explicit local session and normalizes its user-supplied name", async () => {
    const storage = new MemoryStorage();
    const session = await startResearchSession(
      storage,
      "  Boeing   737 MAX certification  ",
      START,
    );
    expect(session).toEqual({
      schema_version: "counterpedia.research_session.v0.1",
      session_ref: "research-session:boeing-session",
      name: "Boeing 737 MAX certification",
      started_at: "2026-08-17T06:30:00.000Z",
      encounter_ids: [],
      retention: "LOCAL_ONLY",
    });
    expect(await readActiveResearchSessionRef(storage)).toBe(session.session_ref);
    await expect(
      startResearchSession(storage, "second", {
        now: () => "2026-08-17T06:31:00.000Z",
        makeId: () => "second",
      }),
    ).rejects.toThrow("research_session:already_active");
  });

  it("stores encounter refs instead of duplicating page/source bodies", async () => {
    const storage = new MemoryStorage();
    const session = await startResearchSession(storage, "Boeing", START);
    await appendEncounterToResearchSession(storage, session.session_ref, "encounter-001");
    await appendEncounterToResearchSession(storage, session.session_ref, "encounter-001");
    const [saved] = await readResearchSessions(storage);
    expect(saved.encounter_ids).toEqual(["encounter-001"]);
    expect(JSON.stringify(saved)).not.toContain("wikipedia.org");
  });

  it("binds an Encounter to the active session only when History is ON", async () => {
    const storage = new MemoryStorage();
    const session = await startResearchSession(storage, "Boeing", START);

    // Active session by itself does not override OFF-by-default History.
    const offResult = await recordPassiveEncounter(storage, observation(session.session_ref), {
      now: () => "2026-08-17T06:31:00.000Z",
      makeId: () => "enc-off",
    });
    expect(offResult).toEqual({ recorded: false });
    expect(await readEncounterLedger(storage)).toEqual([]);

    await setHistoryMode(storage, "ON");
    const onResult = await recordPassiveEncounter(storage, observation(session.session_ref), {
      now: () => "2026-08-17T06:32:00.000Z",
      makeId: () => "enc-on",
    });
    expect(onResult).toMatchObject({
      recorded: true,
      encounter: { encounter_id: "enc-on", session_ref: session.session_ref },
    });
    if (onResult.recorded) {
      await appendEncounterToResearchSession(
        storage,
        session.session_ref,
        onResult.encounter.encounter_id,
      );
    }
    expect((await readResearchSessions())[0]);
  });

  it("stops the session explicitly and preserves its encounter references", async () => {
    const storage = new MemoryStorage();
    const session = await startResearchSession(storage, "Boeing", START);
    await appendEncounterToResearchSession(storage, session.session_ref, "encounter-001");
    const stopped = await stopResearchSession(storage, {
      now: () => "2026-08-17T06:40:00.000Z",
    });
    expect(stopped).toMatchObject({
      session_ref: session.session_ref,
      stopped_at: "2026-08-17T06:40:00.000Z",
      encounter_ids: ["encounter-001"],
    });
    expect(await readActiveResearchSessionRef(storage)).toBeUndefined();
    expect(storage.state[ACTIVE_RESEARCH_SESSION_KEY]).toBeUndefined();
  });

  it("requires stop before deleting an active session and deletion touches session state only", async () => {
    const storage = new MemoryStorage();
    const session = await startResearchSession(storage, "Boeing", START);
    storage.state.unrelated_canonical_corpus_data = { must_survive: true };
    await expect(deleteResearchSession(storage, session.session_ref)).rejects.toThrow(
      "research_session:stop_before_delete",
    );
    await stopResearchSession(storage, { now: () => "2026-08-17T06:40:00.000Z" });
    await deleteResearchSession(storage, session.session_ref);
    expect(await readResearchSessions(storage)).toEqual([]);
    expect(storage.state.unrelated_canonical_corpus_data).toEqual({ must_survive: true });
  });

  it("fails closed on malformed local session state", async () => {
    const storage = new MemoryStorage();
    storage.state[RESEARCH_SESSIONS_KEY] = [
      {
        schema_version: "counterpedia.research_session.v0.1",
        session_ref: "research-session:bad",
        name: "Bad",
        started_at: "2026-08-17T06:30:00.000Z",
        encounter_ids: [],
        retention: "LOCAL_ONLY",
        admitted: true,
      } satisfies Partial<ResearchSessionV01> & { admitted: boolean },
    ];
    await expect(readResearchSessions(storage)).rejects.toThrow(
      "research_session:unknown_field:admitted",
    );
  });
});
