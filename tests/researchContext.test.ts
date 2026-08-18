/**
 * Research Context panel presentation model — RESEARCH-CONTEXT0 invariants.
 *
 * Guards:
 *  - "used_by" is drawn ONLY from already-fetched SearchResult[] — no new
 *    network egress, no new classification.
 *  - PublicObjectLinkV01 / ResearchContextPacketV01 validation is fail-closed:
 *    malformed/mismatched-schema input never renders as if it were valid.
 *  - open_gaps are rendered verbatim from the supplied packet and never
 *    include a "candidate resolves this" judgment (this module doesn't even
 *    have access to `structural_reduction_condition` beyond passthrough).
 *  - Absent inputs render an honest, distinguishable HELD/empty state, not a
 *    silently-defaulted "no gaps" claim.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SearchResult } from "../src/types";
import {
  buildResearchContextPresentation,
  validatePublicObjectLink,
  tryValidatePublicObjectLink,
  validateResearchContextPacket,
  tryValidateResearchContextPacket,
  NO_PUBLIC_RECORD_COPY,
  RESEARCH_CONTEXT_PACKET_SCHEMA,
} from "../src/lib/researchContext";
import type { SourceLocator } from "../src/lib/sourceWorkbench";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/research-context/${name}`, import.meta.url), "utf8"),
  );
}

const LOCATOR: SourceLocator = {
  current_url: "https://example.org/reuters",
  canonical_url: "https://example.org/reuters",
  title: "Reuters wire item",
};

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    record_id: "record:heppner",
    record_url: "https://www.garpedia.org/counterpedia/records/heppner",
    title: "Heppner retirement",
    corpus_posture: "governed_public_record",
    corpus_posture_label: "Governed Public Record",
    edition: "2026-01",
    supported_proposition: "Heppner retired in 2026",
    source_count: 1,
    top_source_labels: ["Reuters"],
    why_not_summary: null,
    refusal_count: 0,
    has_changes: false,
    change_count: 1,
    verification_posture: "none",
    verification_tokens: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PublicObjectLinkV01 validation
// ---------------------------------------------------------------------------

describe("PublicObjectLinkV01 validation (pinned counterpedia PR #475 shape)", () => {
  it("accepts a public_link_available fixture with a same-origin href", () => {
    const link = validatePublicObjectLink(fixture("public_object_link.available.json"));
    expect(link.public_status).toBe("public_link_available");
    expect(link.href).toBe("/sources/faa-directive-2026-01");
  });

  it("accepts not_public / unknown_ref with no href", () => {
    expect(validatePublicObjectLink(fixture("public_object_link.not_public.json")).href).toBeUndefined();
    expect(validatePublicObjectLink(fixture("public_object_link.unknown_ref.json")).href).toBeUndefined();
  });

  it("fails closed on an external (non-same-origin) href for public_link_available", () => {
    expect(() => validatePublicObjectLink(fixture("public_object_link.malformed.json"))).toThrow();
    expect(tryValidatePublicObjectLink(fixture("public_object_link.malformed.json"))).toBeNull();
  });

  it("fails closed on an unrecognized public_status", () => {
    expect(tryValidatePublicObjectLink({ public_status: "definitely_public" })).toBeNull();
  });

  it("fails closed on a non-object", () => {
    expect(tryValidatePublicObjectLink("not-an-object")).toBeNull();
    expect(tryValidatePublicObjectLink(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ResearchContextPacketV01 validation — literal pinned countergraph bytes
// ---------------------------------------------------------------------------

describe("ResearchContextPacketV01 validation (pinned countergraph PR #88 shape, literal producer bytes)", () => {
  it("accepts the literal missing_primary_source producer packet", () => {
    const packet = validateResearchContextPacket(
      fixture("research_context_packet.missing_primary_source.json"),
    );
    expect(packet.schema).toBe(RESEARCH_CONTEXT_PACKET_SCHEMA);
    expect(packet.question_ref).toBe("q:heppner-retirement");
    expect(packet.gap_context).toHaveLength(2);
    expect(packet.gap_context.map((g) => g.type).sort()).toEqual([
      "missing_primary_source",
      "secondary_only_dependency",
    ]);
    // Rendered verbatim — never a candidate judgment.
    for (const item of packet.gap_context) {
      expect(item.why_unresolved).not.toMatch(/resolves this gap/i);
    }
  });

  it("accepts the literal complete_neighborhood producer packet with zero gaps", () => {
    const packet = validateResearchContextPacket(
      fixture("research_context_packet.complete_neighborhood.json"),
    );
    expect(packet.gap_context).toEqual([]);
    expect(packet.gap_item_counts_by_type).toEqual({});
  });

  it("fails closed on a schema-version mismatch", () => {
    expect(() =>
      validateResearchContextPacket(fixture("research_context_packet.invalid_schema.json")),
    ).toThrow();
    expect(tryValidateResearchContextPacket(fixture("research_context_packet.invalid_schema.json"))).toBeNull();
  });

  it("fails closed on a missing required field", () => {
    const broken = fixture("research_context_packet.missing_primary_source.json") as Record<string, unknown>;
    const { packet_digest: _drop, ...rest } = broken;
    expect(tryValidateResearchContextPacket(rest)).toBeNull();
  });

  it("fails closed on a malformed gap_context item", () => {
    const broken = fixture("research_context_packet.missing_primary_source.json") as any;
    const mutated = {
      ...broken,
      gap_context: [{ ...broken.gap_context[0], why_unresolved: 12345 }],
    };
    expect(tryValidateResearchContextPacket(mutated)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildResearchContextPresentation — composition
// ---------------------------------------------------------------------------

describe("no public record for the source (sparse corpus)", () => {
  it("presents the sparse-corpus notice and no used_by", () => {
    const p = buildResearchContextPresentation({ locator: LOCATOR, searchResults: [] });
    expect(p.in_corpus).toBe(false);
    expect(p.source_title).toBeNull();
    expect(p.used_by).toEqual([]);
    expect(p.no_public_record_copy).toBe(NO_PUBLIC_RECORD_COPY);
    // The deep link handoff always exists, even sparse-corpus.
    expect(p.source_deep_link_url).toContain("intent=continue_source");
  });
});

describe("known source with used_by claims (from already-fetched search results)", () => {
  it("lists used_by entries and clears the sparse-corpus notice", () => {
    const results = [
      searchResult({ record_id: "record:heppner", title: "Heppner retirement" }),
      searchResult({ record_id: "record:heppner-2", title: "Heppner succession" }),
    ];
    const p = buildResearchContextPresentation({ locator: LOCATOR, searchResults: results });
    expect(p.in_corpus).toBe(true);
    expect(p.source_title).toBe("Heppner retirement");
    expect(p.no_public_record_copy).toBeNull();
    expect(p.used_by).toEqual([
      { record_id: "record:heppner", title: "Heppner retirement", record_url: results[0]!.record_url },
      { record_id: "record:heppner-2", title: "Heppner succession", record_url: results[1]!.record_url },
    ]);
  });

  it("caps used_by at 10 entries", () => {
    const results = Array.from({ length: 25 }, (_, i) =>
      searchResult({ record_id: `record:${i}`, title: `Record ${i}` }),
    );
    const p = buildResearchContextPresentation({ locator: LOCATOR, searchResults: results });
    expect(p.used_by).toHaveLength(10);
  });
});

describe("public source link — HELD by default, fixture-driven when supplied", () => {
  it("is null when publicSourceLink is omitted (HELD, matches sourceWorkbench precedent)", () => {
    const p = buildResearchContextPresentation({ locator: LOCATOR, searchResults: [] });
    expect(p.public_source_link_url).toBeNull();
  });

  it("resolves to an absolute URL when a valid public_link_available fixture is supplied", () => {
    const p = buildResearchContextPresentation({
      locator: LOCATOR,
      searchResults: [],
      publicSourceLink: fixture("public_object_link.available.json"),
    });
    expect(p.public_source_link_url).toBe(
      "https://www.garpedia.org/sources/faa-directive-2026-01",
    );
  });

  it("stays null when the supplied publicSourceLink is not_public/unknown_ref/malformed", () => {
    for (const name of [
      "public_object_link.not_public.json",
      "public_object_link.unknown_ref.json",
      "public_object_link.malformed.json",
    ]) {
      const p = buildResearchContextPresentation({
        locator: LOCATOR,
        searchResults: [],
        publicSourceLink: fixture(name),
      });
      expect(p.public_source_link_url).toBeNull();
    }
  });
});

describe("open documentary gaps — HELD by default, verbatim when a packet is supplied", () => {
  it("distinguishes 'no packet supplied' from 'packet supplied, zero gaps'", () => {
    const held = buildResearchContextPresentation({ locator: LOCATOR, searchResults: [] });
    expect(held.gap_packet_supplied).toBe(false);
    expect(held.open_gaps).toEqual([]);

    const zeroGaps = buildResearchContextPresentation({
      locator: LOCATOR,
      searchResults: [],
      gapPacket: fixture("research_context_packet.complete_neighborhood.json"),
    });
    expect(zeroGaps.gap_packet_supplied).toBe(true);
    expect(zeroGaps.open_gaps).toEqual([]);
  });

  it("renders gap items verbatim from a real countergraph-produced packet", () => {
    const p = buildResearchContextPresentation({
      locator: LOCATOR,
      searchResults: [],
      gapPacket: fixture("research_context_packet.missing_primary_source.json"),
    });
    expect(p.gap_packet_supplied).toBe(true);
    expect(p.open_gaps).toHaveLength(2);
    expect(p.open_gaps[0]).toMatchObject({
      type: "missing_primary_source",
    });
    expect(p.open_gaps[0]!.why_unresolved).toContain("claim 'claim:heppner-retirement-date'");
  });

  it("falls back to HELD (empty) when the supplied packet is malformed, never throwing", () => {
    const p = buildResearchContextPresentation({
      locator: LOCATOR,
      searchResults: [],
      gapPacket: fixture("research_context_packet.invalid_schema.json"),
    });
    expect(p.gap_packet_supplied).toBe(false);
    expect(p.open_gaps).toEqual([]);
  });
});

describe("research history — passthrough only, this module computes nothing itself", () => {
  it("is null when not supplied", () => {
    const p = buildResearchContextPresentation({ locator: LOCATOR, searchResults: [] });
    expect(p.research_history).toBeNull();
  });

  it("passes through a supplied summary verbatim", () => {
    const p = buildResearchContextPresentation({
      locator: LOCATOR,
      searchResults: [],
      researchHistory: { bounded_runs: 2, held_ambiguities: 1 },
    });
    expect(p.research_history).toEqual({ bounded_runs: 2, held_ambiguities: 1 });
  });
});
