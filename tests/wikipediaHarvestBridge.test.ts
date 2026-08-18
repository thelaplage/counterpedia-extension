import { describe, expect, it } from "vitest";

import type { SourceResolutionIndex } from "../src/lib/sourceResolutionClient";
import {
  buildWikipediaReferenceFrontier,
  classifyWikipediaReferenceUrls,
  harvestWikipediaReferences,
  parseWikipediaReferenceManifest,
  WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA,
} from "../src/lib/wikipediaHarvestBridge";

function reference(
  ordinal: number,
  sourceUrl: string | null,
  title = "Example source",
) {
  return {
    ordinal,
    reference_locator: `ref:${String(ordinal).padStart(4, "0")}`,
    char_start: (ordinal - 1) * 100,
    char_end: (ordinal - 1) * 100 + 50,
    ref_name: null,
    definition_locator: null,
    occurrence_markup_sha256: `sha256:${String(ordinal).padStart(64, "0")}`,
    parse_state: sourceUrl ? "structured" : "unparsed",
    template_type: sourceUrl ? "cite web" : null,
    title: sourceUrl ? title : null,
    publisher: null,
    work: null,
    date: null,
    access_date: null,
    authors: [],
    source_url: sourceUrl,
    archive_url: null,
    doi: null,
    pmid: null,
    isbn: null,
    discovery_relation: "discovered_via",
    support_state: "not_inferred",
    capture_state: "not_attempted",
    srs_receipt_state: "not_emitted",
  };
}

function validManifest() {
  const references = [
    reference(1, "https://example.com/known"),
    reference(2, "https://example.com/new"),
    reference(3, null),
  ];
  return {
    schema_version: "acquisition.wikipedia_reference_manifest.v0.1",
    harvested_at: "2026-08-18T07:00:00Z",
    page: {
      wiki_host: "en.wikipedia.org",
      page_id: 123,
      title: "Example",
      revision_id: 456,
      revision_timestamp: "2026-08-18T06:59:00Z",
      mediawiki_sha1: "a".repeat(40),
      wikitext_utf8_sha256: `sha256:${"b".repeat(64)}`,
      canonical_url: "https://en.wikipedia.org/wiki/Example",
      role: "reference_discovery_only",
    },
    references,
    unique_source_urls: [
      "https://example.com/known",
      "https://example.com/new",
    ],
    counts: {
      reference_occurrences: 3,
      parsed_occurrences: 2,
      capture_eligible_occurrences: 2,
      unique_source_urls: 2,
    },
    boundary: {
      article_prose_copied: false,
      wikipedia_support_inferred: false,
      capture_receipts_emitted: false,
      srs_receipts_emitted: false,
      governed_declaration_bound: false,
      srs_binding_state: "unbound_discovery",
    },
  };
}

function sourceIndex(): SourceResolutionIndex {
  return {
    schema_version: "counterpedia.source_resolution_index.v0.1",
    generated_from: "known_source_material",
    entries: [
      {
        canonical_source_ref: "source:known",
        source_id: "source:known",
        corpus_presence: "governed_capture",
        identity_keys: [
          {
            key_kind: "canonical_source_ref",
            value: "source:known",
          },
          {
            key_kind: "canonical_locator",
            value: "https://example.com/known",
          },
        ],
      },
    ],
  };
}

function fetchReturning(payload: unknown, capture: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.url = String(input);
    capture.init = init;
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
}

describe("WIKI-HARVEST-BRIDGE0", () => {
  it("accepts the exact ACQ-WIKI0 discovery manifest and preserves its boundary", () => {
    const parsed = parseWikipediaReferenceManifest(validManifest());
    expect(parsed.page.revision_id).toBe(456);
    expect(parsed.unique_source_urls).toEqual([
      "https://example.com/known",
      "https://example.com/new",
    ]);
    expect(parsed.boundary.wikipedia_support_inferred).toBe(false);
    expect(parsed.boundary.capture_receipts_emitted).toBe(false);
  });

  it("fails closed if the producer response widens into authority", () => {
    expect(() =>
      parseWikipediaReferenceManifest({
        ...validManifest(),
        standing: "canonical",
      }),
    ).toThrow(/authority_field_forbidden|unknown_or_missing_field/);

    expect(() =>
      parseWikipediaReferenceManifest({
        ...validManifest(),
        boundary: {
          ...validManifest().boundary,
          wikipedia_support_inferred: true,
        },
      }),
    ).toThrow(/boundary_crossed/);
  });

  it("posts only the explicit Wikipedia page to the fixed paired loopback endpoint", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const parsed = await harvestWikipediaReferences(
      "https://en.wikipedia.org/wiki/Example#History",
      fetchReturning(validManifest(), capture),
    );

    expect(parsed.page.revision_id).toBe(456);
    expect(capture.url).toBe("http://127.0.0.1:8790/v0/wikipedia-harvest");
    expect(capture.init?.method).toBe("POST");
    expect(JSON.parse(String(capture.init?.body))).toEqual({
      page: "https://en.wikipedia.org/wiki/Example#History",
    });
  });

  it("rejects non-Wikipedia harvest requests before network I/O", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("must not run");
    }) as typeof fetch;

    await expect(
      harvestWikipediaReferences("https://example.com/report", fetchImpl),
    ).rejects.toThrow(/not_wikipedia/);
    expect(called).toBe(false);
  });

  it("classifies exact known presence separately from new discovery", () => {
    const manifest = parseWikipediaReferenceManifest(validManifest());
    const classified = classifyWikipediaReferenceUrls(manifest, sourceIndex());

    expect(classified).toEqual([
      {
        url: "https://example.com/known",
        status: "KNOWN",
        canonical_source_ref: "source:known",
        corpus_presence: "governed_capture",
      },
      {
        url: "https://example.com/new",
        status: "NEW",
      },
    ]);
  });

  it("does not convert source-index unavailability into false novelty", () => {
    const manifest = parseWikipediaReferenceManifest(validManifest());
    expect(classifyWikipediaReferenceUrls(manifest, null)).toEqual([
      { url: "https://example.com/known", status: "UNRESOLVED" },
      { url: "https://example.com/new", status: "UNRESOLVED" },
    ]);
  });

  it("freezes a local selected frontier without pretending capture or admission", () => {
    const manifest = parseWikipediaReferenceManifest(validManifest());
    const classified = classifyWikipediaReferenceUrls(manifest, sourceIndex());
    const frontier = buildWikipediaReferenceFrontier(
      manifest,
      classified.filter((source) => source.status === "NEW"),
      () => "2026-08-18T07:05:00Z",
    );

    expect(frontier.schema_version).toBe(WIKIPEDIA_REFERENCE_FRONTIER_SCHEMA);
    expect(frontier.selected_sources).toEqual([
      { url: "https://example.com/new", status: "NEW" },
    ]);
    expect(frontier.authority_posture).toBe("discovery_only");
    expect(frontier.acquisition_state).toBe("not_attempted");
    expect(frontier.admission).toBe("not_performed");
  });
});
