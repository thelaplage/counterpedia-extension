import { describe, expect, it, vi } from "vitest";

import {
  COLLECTORS,
  assertCollectorRegistry,
  defaultCollectorSettings,
  readCollectorSettings,
  resolveCollectorObservation,
  setCollectorEnabled,
  type CollectorDefinition,
  type CollectorStorageArea,
} from "../src/lib/collectors";
import {
  recordPassiveEncounter,
  setHistoryMode,
  type LocalStorageArea,
} from "../src/lib/history";

class MemoryStorage implements LocalStorageArea, CollectorStorageArea {
  readonly state: Record<string, unknown> = {};
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const wanted = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(wanted.filter((key) => key in this.state).map((key) => [key, this.state[key]]));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.state, items);
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.state[key];
  }
}

describe("CP-COLLECTOR0", () => {
  it("rejects duplicate collector ids", () => {
    const duplicate: CollectorDefinition = { ...COLLECTORS[0] };
    expect(() => assertCollectorRegistry([COLLECTORS[0], duplicate])).toThrow(
      `collector:duplicate_id:${COLLECTORS[0].id}`,
    );
  });

  it("attributes Wikipedia article encounters to the Wikipedia collector", () => {
    expect(
      resolveCollectorObservation("https://en.wikipedia.org/wiki/Boeing_737_MAX#History"),
    ).toEqual({
      collector_id: "wikipedia_v0_1",
      observed_url: "https://en.wikipedia.org/wiki/Boeing_737_MAX",
      canonical_locator: "https://en.wikipedia.org/wiki/Boeing_737_MAX",
      source_kind: "wikipedia_page",
      source_native_ids: {
        wikipedia_language: "en",
        wikipedia_title: "Boeing 737 MAX",
      },
      resolution_status: "UNRESOLVED",
    });
  });

  it("falls back to generic History when specialized Wikipedia recognition is disabled", () => {
    const settings = defaultCollectorSettings();
    const disabled = {
      ...settings,
      enabled: { ...settings.enabled, wikipedia_v0_1: false },
    };
    expect(
      resolveCollectorObservation("https://en.wikipedia.org/wiki/Boeing_737_MAX", disabled),
    ).toMatchObject({
      collector_id: "generic_web_v0_1",
      source_kind: "web_page",
    });
  });

  it("keeps the generic collector as the binary History baseline", async () => {
    const storage = new MemoryStorage();
    await expect(setCollectorEnabled(storage, "generic_web_v0_1", false)).rejects.toThrow(
      "collector:generic_web_is_history_baseline",
    );
  });

  it("keeps collector settings local and fail-closed on unknown collector ids", async () => {
    const storage = new MemoryStorage();
    await setCollectorEnabled(storage, "wikipedia_v0_1", false);
    expect((await readCollectorSettings(storage)).enabled.wikipedia_v0_1).toBe(false);
    storage.state.counterpedia_collectors_v0_1 = {
      schema_version: "counterpedia.collector_settings.v0.1",
      enabled: { generic_web_v0_1: true, evil_collector: true },
    };
    await expect(readCollectorSettings(storage)).rejects.toThrow(
      "collector_settings:unknown_collector:evil_collector",
    );
  });

  it("still lets the top-level History OFF gate prevent the collector observation from being persisted", async () => {
    const storage = new MemoryStorage();
    const observation = resolveCollectorObservation("https://en.wikipedia.org/wiki/History");
    expect(observation).not.toBeNull();
    expect(await recordPassiveEncounter(storage, observation!)).toEqual({ recorded: false });
  });

  it("collector recognition itself performs no network request", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    resolveCollectorObservation("https://en.wikipedia.org/wiki/History");
    resolveCollectorObservation("https://example.com/page");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not smuggle authority fields into collector observations", () => {
    const observation = resolveCollectorObservation("https://en.wikipedia.org/wiki/History");
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toMatch(/"standing"|"admitted"|"verified"|"published"|"truth"/);
  });

  it("records an attributable observation only after History is explicitly ON", async () => {
    const storage = new MemoryStorage();
    await setHistoryMode(storage, "ON");
    const observation = resolveCollectorObservation("https://en.wikipedia.org/wiki/History")!;
    const result = await recordPassiveEncounter(storage, observation, {
      now: () => "2026-08-17T06:25:00.000Z",
      makeId: () => "enc-collector-1",
    });
    expect(result).toMatchObject({
      recorded: true,
      encounter: { collector_id: "wikipedia_v0_1" },
    });
  });
});
