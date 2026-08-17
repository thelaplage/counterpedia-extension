import { describe, expect, it, vi } from "vitest";

import {
  CORPUS_MISS_LEDGER_KEY,
  ENCOUNTER_LEDGER_KEY,
  ENCOUNTER_SCHEMA,
  HISTORY_MODE_KEY,
  clearCounterpediaHistory,
  observationFromTopLevelUrl,
  readCorpusMissLedger,
  readEncounterLedger,
  readHistoryMode,
  recordPassiveEncounter,
  setHistoryMode,
  type LocalStorageArea,
} from "../src/lib/history";

class MemoryStorage implements LocalStorageArea {
  readonly state: Record<string, unknown> = {};
  readonly writes: Record<string, unknown>[] = [];
  readonly removes: (string | string[])[] = [];

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requested.filter((key) => key in this.state).map((key) => [key, this.state[key]]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes.push(items);
    Object.assign(this.state, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    this.removes.push(keys);
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.state[key];
  }
}

const OBS = {
  collector_id: "generic_web_v0_1",
  observed_url: "https://en.wikipedia.org/wiki/History",
  source_kind: "web_page",
  source_native_ids: {},
} as const;

const FIXED = {
  now: () => "2026-08-17T06:00:00.000Z",
  makeId: () => "encounter-001",
};

describe("CP-HISTORY0", () => {
  it("defaults to OFF on first install and performs zero passive writes", async () => {
    const storage = new MemoryStorage();
    expect(await readHistoryMode(storage)).toBe("OFF");
    expect(await recordPassiveEncounter(storage, OBS, FIXED)).toEqual({ recorded: false });
    expect(storage.writes).toEqual([]);
    expect(await readEncounterLedger(storage)).toEqual([]);
    expect(await readCorpusMissLedger(storage)).toEqual([]);
  });

  it("records exactly one local encounter for one passive observation while ON", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    const result = await recordPassiveEncounter(storage, OBS, FIXED);
    expect(result).toMatchObject({
      recorded: true,
      encounter: {
        schema_version: ENCOUNTER_SCHEMA,
        encounter_id: "encounter-001",
        resolution_status: "UNRESOLVED",
      },
    });
    expect(await readEncounterLedger(storage)).toHaveLength(1);
    expect(storage.state[CORPUS_MISS_LEDGER_KEY]).toBeUndefined();
  });

  it("turning History OFF stops future writes without deleting earlier encounters", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    await recordPassiveEncounter(storage, OBS, FIXED);
    await setHistoryMode(storage, "OFF");
    await recordPassiveEncounter(
      storage,
      { ...OBS, observed_url: "https://example.com/after-off" },
      { ...FIXED, makeId: () => "encounter-002" },
    );
    expect(await readHistoryMode(storage)).toBe("OFF");
    expect(await readEncounterLedger(storage)).toHaveLength(1);
  });

  it("Clear History removes content but preserves the ON/OFF preference", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    await recordPassiveEncounter(storage, OBS, FIXED);
    await clearCounterpediaHistory(storage);
    expect(await readHistoryMode(storage)).toBe("ON");
    expect(await readEncounterLedger(storage)).toEqual([]);
    expect(await readCorpusMissLedger(storage)).toEqual([]);
    expect(storage.state[HISTORY_MODE_KEY]).toBe("ON");
  });

  it("fails closed on malformed ledger state instead of overwriting it", async () => {
    const storage = new MemoryStorage();
    storage.state[HISTORY_MODE_KEY] = "ON";
    storage.state[ENCOUNTER_LEDGER_KEY] = [{ garbage: true }];
    await expect(recordPassiveEncounter(storage, OBS, FIXED)).rejects.toThrow();
    expect(storage.state[ENCOUNTER_LEDGER_KEY]).toEqual([{ garbage: true }]);
  });

  it("rejects injected authority fields in persisted Encounter data", async () => {
    const storage = new MemoryStorage();
    storage.state[ENCOUNTER_LEDGER_KEY] = [
      {
        schema_version: ENCOUNTER_SCHEMA,
        encounter_id: "encounter-evil",
        occurred_at: "2026-08-17T06:00:00.000Z",
        collector_id: "generic_web_v0_1",
        observed_url: "https://example.com/",
        source_kind: "web_page",
        source_native_ids: {},
        resolution_status: "UNRESOLVED",
        admitted: true,
      },
    ];
    await expect(readEncounterLedger(storage)).rejects.toThrow(
      "history_encounter:authority_field_forbidden:admitted",
    );
  });

  it("aggregates UNMATCHED demand locally and never upgrades its reporting posture", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    await recordPassiveEncounter(
      storage,
      { ...OBS, resolution_status: "UNMATCHED" },
      FIXED,
    );
    await recordPassiveEncounter(
      storage,
      { ...OBS, resolution_status: "UNMATCHED" },
      {
        now: () => "2026-08-17T06:01:00.000Z",
        makeId: () => "encounter-002",
      },
    );
    expect(await readCorpusMissLedger(storage)).toEqual([
      expect.objectContaining({
        encounter_count: 2,
        resolution_status: "UNMATCHED",
        reporting_status: "LOCAL_ONLY",
      }),
    ]);
  });

  it("normalizes only top-level http(s) observations and strips fragments", () => {
    expect(observationFromTopLevelUrl("chrome://extensions")).toBeNull();
    expect(observationFromTopLevelUrl("file:///tmp/a.pdf")).toBeNull();
    expect(observationFromTopLevelUrl("https://example.com/a#fragment")).toMatchObject({
      observed_url: "https://example.com/a",
      resolution_status: "UNRESOLVED",
    });
  });

  it("does not require or invoke fetch to persist local History", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    await recordPassiveEncounter(storage, OBS, FIXED);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
