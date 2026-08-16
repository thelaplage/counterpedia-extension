import { describe, expect, it } from "vitest";
import {
  INQUIRY_ROUTE_BOUNDARY,
  InquiryRouteStoreError,
  appendSavedInquiryRoute,
  buildSavedInquiryRoute,
  parseSavedInquiryRoutes,
  type InquiryRouteStorage,
  type SavedInquiryRoute,
} from "../src/lib/inquiryRouteStore";
import type { InquiryPathSuggestion } from "../src/lib/inquiryPaths";

const path: InquiryPathSuggestion = {
  id: "record-topic:sampling-technology",
  label: "Sampling technology",
  kind: "record_topic",
  provenance: {
    domain: "Public Counterpedia",
    basis: "record_title",
    explanation: "Suggested from a matched title.",
    recordIds: ["REC-1"],
    recordTitles: ["Hip-hop production — Sampling technology"],
  },
};

class MemoryStorage implements InquiryRouteStorage {
  value: unknown = undefined;
  async get(_key: string): Promise<unknown> {
    return this.value;
  }
  async set(_key: string, value: SavedInquiryRoute[]): Promise<void> {
    this.value = value;
  }
}

describe("saved inquiry routes", () => {
  it("saves an intentional route without creating an agent or auto-inclusion rule", () => {
    const route = buildSavedInquiryRoute({
      routeId: "route-1",
      name: "Music production researcher",
      savedAt: "2026-08-16T04:00:00.000Z",
      baseQuery: "Why did hip-hop production change?",
      suggestions: [path],
      selectedPathIds: new Set([path.id]),
    });
    expect(route.paths[0]?.label).toBe("Sampling technology");
    expect(route.boundary).toEqual(INQUIRY_ROUTE_BOUNDARY);
    expect(route.boundary.agent_created).toBe("no");
    expect(route.boundary.automatic_future_inclusion).toBe("no");
    expect(route.boundary.network_egress).toBe("none");
  });

  it("requires at least one explicitly selected path", () => {
    expect(() =>
      buildSavedInquiryRoute({
        routeId: "route-1",
        name: "Empty",
        savedAt: "2026-08-16T04:00:00.000Z",
        baseQuery: "query",
        suggestions: [path],
        selectedPathIds: new Set(),
      }),
    ).toThrow(InquiryRouteStoreError);
  });

  it("fails closed rather than overwriting malformed saved route state", async () => {
    const storage = new MemoryStorage();
    storage.value = [{ schema: "other" }];
    const route = buildSavedInquiryRoute({
      routeId: "route-1",
      name: "Music",
      savedAt: "2026-08-16T04:00:00.000Z",
      baseQuery: "query",
      suggestions: [path],
      selectedPathIds: new Set([path.id]),
    });
    await expect(appendSavedInquiryRoute(storage, route)).rejects.toBeInstanceOf(
      InquiryRouteStoreError,
    );
    expect(storage.value).toEqual([{ schema: "other" }]);
    expect(() => parseSavedInquiryRoutes(storage.value)).toThrow(
      InquiryRouteStoreError,
    );
  });
});
