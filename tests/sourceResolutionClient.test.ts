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

function index(): SourceResolutionIndex {
  return {
    schema_version: "counterpedia.source_resolution_index.v0.1",
    generated_from: "public_source_registry",
    entries: [
      {
        canonical_source_ref: "PUBLIC-SRC-HEPPNER-DOC27",
        source_id: "PUBLIC-SRC-HEPPNER-DOC27",
        corpus_presence: "historical_retired",
        identity_keys: [
          {
            key_kind: "canonical_source_ref",
            value: "PUBLIC-SRC-HEPPNER-DOC27",
          },
          {
            key_kind: "canonical_locator",
            value:
              "https://www.courtlistener.com/docket/71872024/united-states-v-heppner/",
          },
          {
            key_kind: "native_id",
            scheme: "courtlistener_docket_id",
            value: "71872024",
          },
        ],
      },
    ],
  };
}

function courtListenerObservation() {
  return {
    collector_id: "courtlistener_v0_1",
    observed_url:
      "https://www.courtlistener.com/docket/71872024/united-states-v-heppner/",
    // Collector intentionally normalizes the browsing locator to an id-root;
    // the registered historical alias retains the full governed docket URL.
    canonical_locator: "https://www.courtlistener.com/docket/71872024/",
    source_kind: "courtlistener_docket",
    source_native_ids: { courtlistener_docket_id: "71872024" },
    resolution_status: "UNRESOLVED" as const,
  };
}

describe("CP-CORPUS-RESOLVER-CLIENT0", () => {
  it("strictly parses the bounded public source-resolution schema", () => {
    expect(parseSourceResolutionIndex(index())).toEqual(index());
    expect(() =>
      parseSourceResolutionIndex({ ...index(), standing: "ADMITTED" }),
    ).toThrow("source_resolution_index:authority_field_forbidden:standing");
    expect(() =>
      parseSourceResolutionIndex({ ...index(), extra: true }),
    ).toThrow("source_resolution_index:unknown_field:extra");
  });

  it("prefers exact registered site-native identity before locator fallback", () => {
    const resolved = resolveObservationAgainstIndex(index(), courtListenerObservation());
    expect(resolved).toEqual({
      ...courtListenerObservation(),
      resolution_status: "MATCHED",
      canonical_source_ref: "PUBLIC-SRC-HEPPNER-DOC27",
      corpus_presence: "historical_retired",
    });
    expect(JSON.stringify(resolved)).not.toContain("standing");
  });

  it("marks a real index miss only after a valid index was available", () => {
    expect(
      resolveObservationAgainstIndex(index(), {
        collector_id: "generic_web_v0_1",
        observed_url: "https://example.test/not-in-corpus",
        source_kind: "web_page",
        source_native_ids: {},
        resolution_status: "UNRESOLVED",
      }),
    ).toMatchObject({ resolution_status: "UNMATCHED" });
  });

  it("surfaces a cross-source native-key collision as AMBIGUOUS", () => {
    const ambiguous: SourceResolutionIndex = {
      ...index(),
      entries: [
        ...index().entries,
        {
          canonical_source_ref: "SRC-OTHER",
          source_id: "SRC-OTHER",
          corpus_presence: "current",
          identity_keys: [
            { key_kind: "canonical_source_ref", value: "SRC-OTHER" },
            {
              key_kind: "native_id",
              scheme: "courtlistener_docket_id",
              value: "71872024",
            },
          ],
        },
      ],
    };
    expect(
      resolveObservationAgainstIndex(ambiguous, courtListenerObservation()),
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
      courtListenerObservation(),
      fetchSpy as FetchLike,
    );
    const second = await resolveObservationWithPublicIndex(
      storage,
      courtListenerObservation(),
      fetchSpy as FetchLike,
    );

    expect(first).toMatchObject({ resolution_status: "MATCHED" });
    expect(second).toMatchObject({ resolution_status: "MATCHED" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(SOURCE_RESOLUTION_INDEX_URL);
    expect(JSON.stringify(fetchSpy.mock.calls[0])).not.toContain(
      "united-states-v-heppner",
    );
    expect(storage.state[SOURCE_RESOLUTION_CACHE_KEY]).toEqual(index());
  });

  it("leaves the Encounter UNRESOLVED when the fixed index is unavailable", async () => {
    const storage = new MemorySessionStorage();
    const fetchFailure: FetchLike = async () => {
      throw new Error("offline");
    };
    const observation = courtListenerObservation();
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
          corpus_presence: "current_and_admitted",
        },
      ],
    };
    await expect(loadSourceResolutionIndex(storage)).rejects.toThrow(
      "corpus_presence:invalid",
    );
  });
});
