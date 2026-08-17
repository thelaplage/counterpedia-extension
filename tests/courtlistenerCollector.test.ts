import { describe, expect, it, vi } from "vitest";

import { courtListenerCollector } from "../src/collectors/courtlistener";
import { resolveCollectorObservation } from "../src/lib/collectors";

describe("CP-COURTLISTENER0", () => {
  it("extracts an exact docket id and stable canonical docket locator", () => {
    expect(
      courtListenerCollector.observe(
        new URL("https://www.courtlistener.com/docket/72379398/netlist-inc-v-micron-technology-inc/#entry-1"),
      ),
    ).toEqual({
      collector_id: "courtlistener_v0_1",
      observed_url:
        "https://www.courtlistener.com/docket/72379398/netlist-inc-v-micron-technology-inc/",
      canonical_locator: "https://www.courtlistener.com/docket/72379398/",
      source_kind: "courtlistener_docket",
      source_native_ids: { courtlistener_docket_id: "72379398" },
      resolution_status: "UNRESOLVED",
    });
  });

  it("treats the numeric id in a website opinion URL as cluster_id, not opinion_id", () => {
    expect(
      courtListenerCollector.observe(
        new URL("https://www.courtlistener.com/opinion/2812209/obergefell-v-hodges/"),
      ),
    ).toMatchObject({
      canonical_locator: "https://www.courtlistener.com/opinion/2812209/",
      source_kind: "courtlistener_opinion_cluster",
      source_native_ids: { courtlistener_cluster_id: "2812209" },
    });
  });

  it("recognizes bare courtlistener.com as the same provider", () => {
    expect(
      resolveCollectorObservation("https://courtlistener.com/docket/123/example-case/"),
    ).toMatchObject({
      collector_id: "courtlistener_v0_1",
      source_native_ids: { courtlistener_docket_id: "123" },
    });
  });

  it("does not reinterpret API, search, or help routes as docket/opinion objects", () => {
    expect(
      courtListenerCollector.observe(
        new URL("https://www.courtlistener.com/api/rest/v4/dockets/4214664/"),
      ),
    ).toBeNull();
    expect(
      courtListenerCollector.observe(new URL("https://www.courtlistener.com/?q=test")),
    ).toBeNull();
    expect(
      courtListenerCollector.observe(new URL("https://www.courtlistener.com/help/coverage/recap/")),
    ).toBeNull();
  });

  it("performs no CourtListener API enrichment or network request", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("CourtListener collector v0.1 must be URL-only");
    });
    vi.stubGlobal("fetch", fetchSpy);
    resolveCollectorObservation(
      "https://www.courtlistener.com/docket/72379398/netlist-inc-v-micron-technology-inc/",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("emits no legal merits, truth, standing, verification, admission, or publication fields", () => {
    const value = resolveCollectorObservation(
      "https://www.courtlistener.com/opinion/2812209/obergefell-v-hodges/",
    );
    expect(JSON.stringify(value)).not.toMatch(
      /"truth"|"merits"|"standing"|"verified"|"admitted"|"published"/,
    );
  });
});
