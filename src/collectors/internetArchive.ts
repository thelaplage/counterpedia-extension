import type { CollectorDefinition } from "../lib/collectors";

const ITEM = /^\/details\/([^/]+)(?:\/.*)?$/;
const WAYBACK = /^\/web\/([^/]+)\/(https?:\/\/.*)$/;

export const internetArchiveCollector: CollectorDefinition = {
  id: "internet_archive_v0_1",
  label: "Internet Archive",
  priority: 200,
  optional_origins: ["https://archive.org/*", "https://www.archive.org/*"],
  default_enabled: true,
  observe(url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== "archive.org" && host !== "www.archive.org") return null;
    const match = url.pathname.match(ITEM);
    if (!match) return null;

    const rawIdentifier = match[1];
    if (rawIdentifier === undefined) return null;
    let identifier: string;
    try {
      identifier = decodeURIComponent(rawIdentifier);
    } catch {
      return null;
    }
    if (!identifier || identifier.length > 512) return null;

    return {
      collector_id: "internet_archive_v0_1",
      observed_url: withoutHash(url),
      canonical_locator: `https://archive.org/details/${encodeURIComponent(identifier)}`,
      source_kind: "internet_archive_item",
      source_native_ids: { internet_archive_id: identifier },
      resolution_status: "UNRESOLVED",
    };
  },
};

export const waybackCollector: CollectorDefinition = {
  id: "wayback_v0_1",
  label: "Wayback Machine",
  priority: 210,
  optional_origins: ["https://web.archive.org/*"],
  default_enabled: true,
  observe(url) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.toLowerCase() !== "web.archive.org") return null;
    const match = url.pathname.match(WAYBACK);
    if (!match) return null;

    const captureToken = match[1];
    if (captureToken === undefined) return null;
    const timestamp = captureToken.match(/^(\d{4,14})/)?.[1];
    if (!timestamp) return null;

    // In a Wayback URL, the archived target query string is parsed by URL as
    // the outer web.archive.org query. Reattach it before parsing the original
    // target or `https://example.test/?a=1` would collapse to `/`.
    const originalRaw = `${match[2]}${url.search}`;
    let original: URL;
    try {
      original = new URL(originalRaw);
    } catch {
      return null;
    }
    if (original.protocol !== "http:" && original.protocol !== "https:") return null;
    original.hash = "";
    const originalLocator = original.toString();
    if (originalLocator.length > 1024) return null;

    return {
      collector_id: "wayback_v0_1",
      observed_url: withoutHash(url),
      canonical_locator: `https://web.archive.org/web/${captureToken}/${originalLocator}`,
      source_kind: "wayback_snapshot",
      source_native_ids: {
        wayback_timestamp: timestamp,
        wayback_original_locator: originalLocator,
      },
      resolution_status: "UNRESOLVED",
    };
  },
};

function withoutHash(url: URL): string {
  const copy = new URL(url.toString());
  copy.hash = "";
  return copy.toString();
}
