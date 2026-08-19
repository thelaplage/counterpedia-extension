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
      // The DOCKET regex's `(\d+)` group is only present when it matched, but
      // TS types capture groups as `string | undefined`; narrow explicitly so
      // `source_native_ids` stays `Record<string, string>`.
      if (docketId === undefined) return null;
      // Typed as Record<string, string> so the two observe() branches don't
      // union-widen into cross `?: undefined` keys that break the
      // PassiveEncounterObservation index signature.
      const source_native_ids: Record<string, string> = {
        courtlistener_docket_id: docketId,
      };
      return {
        collector_id: "courtlistener_v0_1",
        observed_url: observedUrl(url),
        canonical_locator: `https://www.courtlistener.com/docket/${docketId}/`,
        source_kind: "courtlistener_docket",
        source_native_ids,
        resolution_status: "UNRESOLVED",
      };
    }

    const opinion = url.pathname.match(OPINION_CLUSTER);
    if (opinion) {
      const clusterId = opinion[1];
      if (clusterId === undefined) return null;
      // CourtListener's case-law website opinion URL uses cluster_id, not
      // opinion_id. Keep that distinction explicit for later API enrichment.
      // Typed as Record<string, string> for the same reason as the docket branch.
      const source_native_ids: Record<string, string> = {
        courtlistener_cluster_id: clusterId,
      };
      return {
        collector_id: "courtlistener_v0_1",
        observed_url: observedUrl(url),
        canonical_locator: `https://www.courtlistener.com/opinion/${clusterId}/`,
        source_kind: "courtlistener_opinion_cluster",
        source_native_ids,
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
