import type { CollectorDefinition } from "../lib/collectors";

const DOCKET = /^\/docket\/(\d+)(?:\/[^/?#]+)?\/?$/;
const OPINION_CLUSTER = /^\/opinion\/(\d+)(?:\/[^/?#]+)?\/?$/;

export const courtListenerCollector: CollectorDefinition = {
  id: "courtlistener_v0_1",
  label: "CourtListener",
  priority: 200,
  optional_origins: ["https://www.courtlistener.com/*", "https://courtlistener.com/*"],
  default_enabled: true,
  observe(url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== "courtlistener.com" && host !== "www.courtlistener.com") return null;

    const docket = url.pathname.match(DOCKET);
    if (docket) {
      const docketId = docket[1];
      return {
        collector_id: "courtlistener_v0_1",
        observed_url: observedUrl(url),
        canonical_locator: `https://www.courtlistener.com/docket/${docketId}/`,
        source_kind: "courtlistener_docket",
        source_native_ids: { courtlistener_docket_id: docketId },
        resolution_status: "UNRESOLVED",
      };
    }

    const opinion = url.pathname.match(OPINION_CLUSTER);
    if (opinion) {
      const clusterId = opinion[1];
      return {
        collector_id: "courtlistener_v0_1",
        observed_url: observedUrl(url),
        canonical_locator: `https://www.courtlistener.com/opinion/${clusterId}/`,
        source_kind: "courtlistener_opinion_cluster",
        // CourtListener's case-law website opinion URL uses cluster_id, not
        // opinion_id. Keep that distinction explicit for later API enrichment.
        source_native_ids: { courtlistener_cluster_id: clusterId },
        resolution_status: "UNRESOLVED",
      };
    }

    return null;
  },
};

function observedUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = "";
  return copy.toString();
}
