import { describe, expect, it, vi } from "vitest";

import {
  internetArchiveCollector,
  waybackCollector,
} from "../src/collectors/internetArchive";
import { resolveCollectorObservation } from "../src/lib/collectors";

describe("CP-ARCHIVE0", () => {
  it("extracts Internet Archive item identity without treating deeper item paths as new items", () => {
    expect(
      internetArchiveCollector.observe(
        new URL("https://archive.org/details/example_item/page/n1/mode/2up#page=3"),
      ),
    ).toEqual({
      collector_id: "internet_archive_v0_1",
      observed_url: "https://archive.org/details/example_item/page/n1/mode/2up",
      canonical_locator: "https://archive.org/details/example_item",
      source_kind: "internet_archive_item",
      source_native_ids: { internet_archive_id: "example_item" },
      resolution_status: "UNRESOLVED",
    });
  });

  it("preserves the original target URL and Wayback timestamp as separate native identity facts", () => {
    expect(
      waybackCollector.observe(
        new URL(
          "https://web.archive.org/web/20240102030405/https://example.com/path?a=1#fragment",
        ),
      ),
    ).toEqual({
      collector_id: "wayback_v0_1",
      observed_url:
        "https://web.archive.org/web/20240102030405/https://example.com/path?a=1",
      canonical_locator:
        "https://web.archive.org/web/20240102030405/https://example.com/path?a=1",
      source_kind: "wayback_snapshot",
      source_native_ids: {
        wayback_timestamp: "20240102030405",
        wayback_original_locator: "https://example.com/path?a=1",
      },
      resolution_status: "UNRESOLVED",
    });
  });

  it("retains Wayback replay modifiers while extracting the leading timestamp", () => {
    const observation = waybackCollector.observe(
      new URL("https://web.archive.org/web/20240102030405id_/https://example.com/a"),
    );
    expect(observation).toMatchObject({
      canonical_locator:
        "https://web.archive.org/web/20240102030405id_/https://example.com/a",
      source_native_ids: {
        wayback_timestamp: "20240102030405",
        wayback_original_locator: "https://example.com/a",
      },
    });
  });

  it("fails closed on malformed or non-http archived targets", () => {
    expect(
      waybackCollector.observe(
        new URL("https://web.archive.org/web/not-a-time/https://example.com/"),
      ),
    ).toBeNull();
    expect(
      waybackCollector.observe(
        new URL("https://web.archive.org/web/20240102030405/file:///tmp/private"),
      ),
    ).toBeNull();
  });

  it("lets the registry select Wayback ahead of generic Web", () => {
    expect(
      resolveCollectorObservation(
        "https://web.archive.org/web/20240102030405/https://example.com/",
      ),
    ).toMatchObject({ collector_id: "wayback_v0_1", source_kind: "wayback_snapshot" });
  });

  it("performs no recursive item download and no Save Page Now request", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Archive collector v0.1 must be URL-only");
    });
    vi.stubGlobal("fetch", fetchSpy);
    resolveCollectorObservation("https://archive.org/details/example_item");
    resolveCollectorObservation(
      "https://web.archive.org/web/20240102030405/https://example.com/",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not infer same-byte identity or authority from an archive location", () => {
    const serialized = JSON.stringify(
      resolveCollectorObservation("https://archive.org/details/example_item"),
    );
    expect(serialized).not.toMatch(
      /sha256|same_bytes|"truth"|"standing"|"verified"|"admitted"|"published"/,
    );
  });
});
