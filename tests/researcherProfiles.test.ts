import { describe, expect, it } from "vitest";
import type { InquiryPathSuggestion } from "../src/lib/inquiryPaths";
import {
  RESEARCHER_PROFILE_BOUNDARY,
  ResearcherProfileError,
  appendResearcherProfile,
  buildResearcherProfile,
  matchResearcherProfile,
  type ResearcherProfile,
  type ResearcherProfileStorage,
} from "../src/lib/researcherProfiles";

const sampling: InquiryPathSuggestion = {
  id: "record-topic:sampling-technology",
  label: "Sampling technology",
  kind: "record_topic",
  provenance: {
    domain: "Public Counterpedia",
    basis: "record_title",
    explanation: "Matched title",
    recordIds: ["REC-1"],
    recordTitles: ["Sampling technology"],
  },
};

const labels: InquiryPathSuggestion = {
  id: "record-topic:record-label-economics",
  label: "Record-label economics",
  kind: "record_topic",
  provenance: {
    domain: "Public Counterpedia",
    basis: "record_title",
    explanation: "Matched title",
    recordIds: ["REC-2"],
    recordTitles: ["Record-label economics"],
  },
};

class MemoryStorage implements ResearcherProfileStorage {
  value: unknown = undefined;
  async get(_key: string): Promise<unknown> {
    return this.value;
  }
  async set(_key: string, value: ResearcherProfile[]): Promise<void> {
    this.value = value;
  }
}

describe("Researcher profiles", () => {
  it("turns selected paths into a named local routing profile without creating an agent", () => {
    const profile = buildResearcherProfile({
      profileId: "researcher-1",
      name: "Music Industry Researcher",
      createdAt: "2026-08-16T04:00:00.000Z",
      seedQuery: "hip-hop production",
      suggestions: [sampling, labels],
      selectedPathIds: new Set([labels.id]),
    });
    expect(profile.name).toBe("Music Industry Researcher");
    expect(profile.paths.map((path) => path.label)).toEqual([
      "Record-label economics",
    ]);
    expect(profile.boundary).toEqual(RESEARCHER_PROFILE_BOUNDARY);
    expect(profile.boundary.agent_runtime).toBe("none");
    expect(profile.boundary.tool_authority).toBe("none");
    expect(profile.boundary.automatic_activation).toBe("no");
  });

  it("matches a saved Researcher against paths available in a later Check", () => {
    const profile = buildResearcherProfile({
      profileId: "researcher-1",
      name: "Music Industry Researcher",
      createdAt: "2026-08-16T04:00:00.000Z",
      seedQuery: "hip-hop production",
      suggestions: [sampling, labels],
      selectedPathIds: new Set([sampling.id, labels.id]),
    });
    const match = matchResearcherProfile(profile, [
      { ...labels, id: "record-topic:record-label-economics-v2" },
    ]);
    expect(match.matchedPathIds).toEqual([
      "record-topic:record-label-economics-v2",
    ]);
    expect(match.missingPathLabels).toEqual(["Sampling technology"]);
  });

  it("requires an explicit non-empty path selection", () => {
    expect(() =>
      buildResearcherProfile({
        profileId: "researcher-1",
        name: "Empty",
        createdAt: "2026-08-16T04:00:00.000Z",
        seedQuery: "query",
        suggestions: [sampling],
        selectedPathIds: new Set(),
      }),
    ).toThrow(ResearcherProfileError);
  });

  it("appends profiles without overwriting prior local profiles", async () => {
    const storage = new MemoryStorage();
    const first = buildResearcherProfile({
      profileId: "r1",
      name: "Theory Researcher",
      createdAt: "2026-08-16T04:00:00.000Z",
      seedQuery: "music",
      suggestions: [sampling],
      selectedPathIds: new Set([sampling.id]),
    });
    const second = buildResearcherProfile({
      profileId: "r2",
      name: "Industry Researcher",
      createdAt: "2026-08-16T04:01:00.000Z",
      seedQuery: "music",
      suggestions: [labels],
      selectedPathIds: new Set([labels.id]),
    });
    expect(await appendResearcherProfile(storage, first)).toBe(1);
    expect(await appendResearcherProfile(storage, second)).toBe(2);
    expect((storage.value as ResearcherProfile[]).map((p) => p.name)).toEqual([
      "Theory Researcher",
      "Industry Researcher",
    ]);
  });
});
