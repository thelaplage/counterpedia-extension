import { describe, expect, it, vi } from "vitest";

import {
  SOURCE_RESOLUTION_CACHE_KEY,
  SOURCE_RESOLUTION_INDEX_URL,
  loadSourceResolutionIndex,
  parseSourceResolutionIndex,
  resolveObservationAgainstIndex,
  resolveObservationWithPublicIndex,
  type FetchLike,
  type SessionStorageArea,
  type SourceResolutionIndex,
} from "../src/lib/sourceResolutionClient";

class MemorySessionStorage implements SessionStorageArea {
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

const NO_S01_LOCATOR =
  "https://storage.courtlistener.com/recap/gov.uscourts.nysd.612697/gov.uscourts.nysd.612697.1.0_1.pdf";
const NO_S03_LOCATOR =
  "https://storage.courtlistener.com/recap/gov.uscourts.nysd.612697/gov.uscourts.nysd.612697.514.0_1.pdf";
const NO_S02_LOCATOR = "https://openai.com/index/openai-and-journalism/";

function index(): SourceResolutionIndex {
  return {
    schema_version: "counterpedia.source_resolution_index.v0.1",
    generated_from: "known_source_material",
    entries: [
      {
        canonical_source_ref: "src_593dff9213322bf9a2b28de9bb7c2a8e",
        source_id: "src_593dff9213322bf9a2b28de9bb7c2a8e",
        corpus_presence: "governed_capture",
        identity_keys: [
          {
            key_kind: "canonical_source_ref",
            value: "src_593dff9213322bf9a2b28de9bb7c2a8e",
          },
          { key_kind: "canonical_locator", value: NO_S03_LOCATOR },
          {
            key_kind: "capture_hash",
            value:
              "sha256:1944d092241e9891baa8136be8463ce30bf3c7fd6a285697cb6f8c1dce592587",
          },
        ],
      },
      {
        canonical_source_ref: "src_619a0013128462ad7a01a2cec82b4529",
        source_id: "src_619a0013128462ad7a01a2cec82b4529",
        corpus_presence: "governed_capture",
        identity_keys: [
          {
            key_kind: "canonical_source_ref",
            value: "src_619a0013128462ad7a01a2cec82b4529",
          },
          { key_kind: "canonical_locator", value: NO_S01_LOCATOR },
          {
            key_kind: "capture_hash",
            value:
              "sha256:5eb30edbdedf0af0ec0c66e8e85a4fca3446610817dd0511fce9f7241572ea53",
          },
        ],
      },
    ],
  };
}

function noS01Observation() {
  return {
    collector_id: "generic_web_v0_1",
    observed_url: NO_S01_LOCATOR,
    canonical_locator: NO_S01_LOCATOR,
    source_kind: "web_page",
    source_native_ids: {},
    resolution_status: "UNRESOLVED" as const,
  };
}

describe("CP-CORPUS-RESOLVER-CLIENT0", () => {
  it("strictly parses the bounded known-source schema", () => {
    expect(parseSourceResolutionIndex(index())).toEqual(index());
    expect(() =>
      parseSourceResolutionIndex({ ...index(), standing: "ADMITTED" }),
    ).toThrow("source_resolution_index:authority_field_forbidden:standing");
    expect(() =>
      parseSourceResolutionIndex({ ...index(), extra: true }),
    ).toThrow("source_resolution_index:unknown_field:extra");
  });

  it("resolves NYT/OpenAI NO-S01 as an exact governed-capture HIT", () => {
    const resolved = resolveObservationAgainstIndex(index(), noS01Observation());
    expect(resolved).toEqual({
      ...noS01Observation(),
      resolution_status: "MATCHED",
      canonical_source_ref: "src_619a0013128462ad7a01a2cec82b4529",
      corpus_presence: "governed_capture",
    });
    expect(JSON.stringify(resolved)).not.toContain("standing");
  });

  it("resolves NYT/OpenAI NO-S03 as an exact governed-capture HIT", () => {
    expect(
      resolveObservationAgainstIndex(index(), {
        collector_id: "generic_web_v0_1",
        observed_url: NO_S03_LOCATOR,
        canonical_locator: NO_S03_LOCATOR,
        source_kind: "web_page",
        source_native_ids: {},
        resolution_status: "UNRESOLVED",
      }),
    ).toMatchObject({
      resolution_status: "MATCHED",
      canonical_source_ref: "src_593dff9213322bf9a2b28de9bb7c2a8e",
      corpus_presence: "governed_capture",
    });
  });

  it("keeps NYT/OpenAI NO-S02 as a real corpus miss because no governed capture exists", () => {
    expect(
      resolveObservationAgainstIndex(index(), {
        collector_id: "generic_web_v0_1",
        observed_url: NO_S02_LOCATOR,
        canonical_locator: NO_S02_LOCATOR,
        source_kind: "web_page",
        source_native_ids: {},
        resolution_status: "UNRESOLVED",
      }),
    ).toMatchObject({ resolution_status: "UNMATCHED" });
  });

  it("still surfaces a cross-source exact-key collision as AMBIGUOUS", () => {
    const ambiguous: SourceResolutionIndex = {
      ...index(),
      entries: [
        ...index().entries,
        {
          canonical_source_ref: "SRC-OTHER",
          source_id: "SRC-OTHER",
          corpus_presence: "public_current",
          identity_keys: [
            { key_kind: "canonical_source_ref", value: "SRC-OTHER" },
            { key_kind: "canonical_locator", value: NO_S01_LOCATOR },
          ],
        },
      ],
    };
    expect(
      resolveObservationAgainstIndex(ambiguous, noS01Observation()),
    ).toMatchObject({ resolution_status: "AMBIGUOUS" });
  });

  it("fetches only the fixed public index URL, never the encountered URL, and caches by session", async () => {
    const storage = new MemorySessionStorage();
    const fetchSpy = vi.fn(async (input: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => index(),
      input,
      init,
    }));

    const first = await resolveObservationWithPublicIndex(
      storage,
      noS01Observation(),
      fetchSpy as FetchLike,
    );
    const second = await resolveObservationWithPublicIndex(
      storage,
      noS01Observation(),
      fetchSpy as FetchLike,
    );

    expect(first).toMatchObject({
      resolution_status: "MATCHED",
      corpus_presence: "governed_capture",
    });
    expect(second).toMatchObject({ resolution_status: "MATCHED" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    if (firstCall === undefined) throw new Error("expected fetch to have been called");
    expect(firstCall[0]).toBe(SOURCE_RESOLUTION_INDEX_URL);
    expect(JSON.stringify(firstCall)).not.toContain("gov.uscourts.nysd.612697");
    expect(storage.state[SOURCE_RESOLUTION_CACHE_KEY]).toEqual(index());
  });

  it("leaves the Encounter UNRESOLVED when the fixed index is unavailable", async () => {
    const storage = new MemorySessionStorage();
    const fetchFailure: FetchLike = async () => {
      throw new Error("offline");
    };
    const observation = noS01Observation();
    expect(
      await resolveObservationWithPublicIndex(storage, observation, fetchFailure),
    ).toEqual(observation);
  });

  it("refuses malformed cached bytes instead of trusting them", async () => {
    const storage = new MemorySessionStorage();
    storage.state[SOURCE_RESOLUTION_CACHE_KEY] = {
      ...index(),
      entries: [
        {
          ...index().entries[0],
          corpus_presence: "captured_and_admitted",
        },
      ],
    };
    await expect(loadSourceResolutionIndex(storage)).rejects.toThrow(
      "corpus_presence:invalid",
    );
  });
});
