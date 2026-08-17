import { describe, expect, it } from "vitest";
import type { InquiryPathSuggestion } from "../src/lib/inquiryPaths";
import { PUBLIC_COUNTERPEDIA_PATH_PROVIDER } from "../src/lib/pathProviderContract";
import {
  buildResearcherProfile,
  type ResearcherProfile,
} from "../src/lib/researcherProfiles";
import {
  RESEARCHER_TEACHING_BOUNDARY,
  ResearcherTeachingError,
  appendResearcherTeachingEvent,
  buildTeachingGrantEvent,
  buildTeachingUpdateEvent,
  deriveTeachingGrantStates,
  effectiveResearcherPaths,
  type ResearcherTeachingEvent,
  type ResearcherTeachingStorage,
} from "../src/lib/researcherTeaching";

const labels: InquiryPathSuggestion = {
  id: "counterpedia.public::record-topic:record-label-economics",
  label: "Record-label economics",
  kind: "record_topic",
  provenance: {
    provider: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
    domain: "Public Counterpedia",
    basis: "record_title",
    explanation: "Matched title",
    recordIds: ["REC-2"],
    recordTitles: ["Record-label economics"],
  },
};

const theory: InquiryPathSuggestion = {
  id: "counterpedia.public::record-topic:music-theory",
  label: "Music theory",
  kind: "record_topic",
  provenance: {
    provider: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
    domain: "Public Counterpedia",
    basis: "record_title",
    explanation: "Matched title",
    recordIds: ["REC-3"],
    recordTitles: ["Music theory"],
  },
};

function profile(id: string, name: string, suggestions: InquiryPathSuggestion[]): ResearcherProfile {
  return buildResearcherProfile({
    profileId: id,
    name,
    createdAt: "2026-08-16T05:00:00.000Z",
    seedQuery: "music",
    suggestions,
    selectedPathIds: new Set(suggestions.map((item) => item.id)),
  });
}

class MemoryStorage implements ResearcherTeachingStorage {
  value: unknown = undefined;
  async get(_key: string): Promise<unknown> {
    return this.value;
  }
  async set(_key: string, value: ResearcherTeachingEvent[]): Promise<void> {
    this.value = value;
  }
}

describe("Researcher teaching", () => {
  it("teaches a selected subset without merging or copying knowledge stores", () => {
    const music = profile("music", "Music Researcher", [labels, theory]);
    const business = profile("business", "Business Researcher", [theory]);
    const event = buildTeachingGrantEvent({
      eventId: "event-1",
      grantId: "grant-1",
      eventAt: "2026-08-16T05:01:00.000Z",
      source: music,
      target: business,
      pathIds: new Set([labels.id]),
      tags: ["recording industry", "Rights"],
    });

    expect(event.paths.map((path) => path.label)).toEqual(["Record-label economics"]);
    expect(event.tags).toEqual(["recording industry", "Rights"]);
    expect(event.boundary).toEqual(RESEARCHER_TEACHING_BOUNDARY);
    expect(event.boundary.knowledge_copy).toBe("none");
    expect(event.boundary.history_merge).toBe("none");
    expect(music.paths).toHaveLength(2);
    expect(business.paths).toHaveLength(1);
  });

  it("resolves taught paths as an effective overlay while preserving provider identity", () => {
    const music = profile("music", "Music Researcher", [labels]);
    const business = profile("business", "Business Researcher", [theory]);
    const grant = buildTeachingGrantEvent({
      eventId: "event-1",
      grantId: "grant-1",
      eventAt: "2026-08-16T05:01:00.000Z",
      source: music,
      target: business,
      pathIds: new Set([labels.id]),
    });
    const paths = effectiveResearcherPaths(business, [grant]);
    expect(paths.map((path) => path.label)).toEqual(["Music theory", "Record-label economics"]);
    expect(paths[1]?.provider_id).toBe("counterpedia.public");
    expect(business.paths.map((path) => path.label)).toEqual(["Music theory"]);
  });

  it("retags by appending metadata history rather than rewriting the grant event", () => {
    const music = profile("music", "Music Researcher", [labels]);
    const business = profile("business", "Business Researcher", [theory]);
    const grant = buildTeachingGrantEvent({
      eventId: "event-1",
      grantId: "grant-1",
      eventAt: "2026-08-16T05:01:00.000Z",
      source: music,
      target: business,
      pathIds: new Set([labels.id]),
      tags: ["recording industry"],
    });
    const state = deriveTeachingGrantStates([grant])[0]!;
    const retag = buildTeachingUpdateEvent({
      eventId: "event-2",
      eventAt: "2026-08-16T05:02:00.000Z",
      grant: state,
      action: "retag",
      tags: ["rights", "catalog finance"],
    });
    const next = deriveTeachingGrantStates([grant, retag])[0]!;
    expect(grant.tags).toEqual(["recording industry"]);
    expect(retag.supersedes_event_id).toBe("event-1");
    expect(next.tags).toEqual(["rights", "catalog finance"]);
    expect(next.active).toBe(true);
  });

  it("revocation stops future resolution while preserving the historical grant", () => {
    const music = profile("music", "Music Researcher", [labels]);
    const business = profile("business", "Business Researcher", [theory]);
    const grant = buildTeachingGrantEvent({
      eventId: "event-1",
      grantId: "grant-1",
      eventAt: "2026-08-16T05:01:00.000Z",
      source: music,
      target: business,
      pathIds: new Set([labels.id]),
    });
    const revoke = buildTeachingUpdateEvent({
      eventId: "event-2",
      eventAt: "2026-08-16T05:02:00.000Z",
      grant: deriveTeachingGrantStates([grant])[0]!,
      action: "revoke",
    });
    expect(deriveTeachingGrantStates([grant, revoke])[0]?.active).toBe(false);
    expect(effectiveResearcherPaths(business, [grant, revoke]).map((path) => path.label)).toEqual(["Music theory"]);
    expect(grant.paths[0]?.label).toBe("Record-label economics");
  });

  it("refuses self-teaching and history discontinuity", () => {
    const music = profile("music", "Music Researcher", [labels]);
    expect(() =>
      buildTeachingGrantEvent({
        eventId: "event-1",
        grantId: "grant-1",
        eventAt: "2026-08-16T05:01:00.000Z",
        source: music,
        target: music,
        pathIds: new Set([labels.id]),
      }),
    ).toThrow(ResearcherTeachingError);

    const business = profile("business", "Business Researcher", [theory]);
    const grant = buildTeachingGrantEvent({
      eventId: "event-1",
      grantId: "grant-1",
      eventAt: "2026-08-16T05:01:00.000Z",
      source: music,
      target: business,
      pathIds: new Set([labels.id]),
    });
    const bad: ResearcherTeachingEvent = {
      ...buildTeachingUpdateEvent({
        eventId: "event-2",
        eventAt: "2026-08-16T05:02:00.000Z",
        grant: deriveTeachingGrantStates([grant])[0]!,
        action: "retag",
        tags: ["rights"],
      }),
      supersedes_event_id: "wrong-event",
    };
    expect(() => deriveTeachingGrantStates([grant, bad])).toThrow(ResearcherTeachingError);
  });

  it("append validates the whole event history before writing", async () => {
    const storage = new MemoryStorage();
    const music = profile("music", "Music Researcher", [labels]);
    const business = profile("business", "Business Researcher", [theory]);
    const grant = buildTeachingGrantEvent({
      eventId: "event-1",
      grantId: "grant-1",
      eventAt: "2026-08-16T05:01:00.000Z",
      source: music,
      target: business,
      pathIds: new Set([labels.id]),
    });
    expect(await appendResearcherTeachingEvent(storage, grant)).toBe(1);
    expect((storage.value as ResearcherTeachingEvent[])[0]?.grant_id).toBe("grant-1");
  });
});
