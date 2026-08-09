/**
 * BrowserPageCapture v0.1 — normalization unit tests.
 *
 * Pure function tests only (no Chrome APIs, no DOM).
 * capturePageData (the injected script) is structurally verified separately
 * since it requires a browser DOM environment.
 */

import { describe, it, expect } from "vitest";
import { normalizeCaptureData, BOUNDS } from "../src/lib/browserPageCapture";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";
import type { RawPageData } from "../src/capture/captureScript";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_TS = "2026-08-08T12:00:00.000Z";

const FULL_RAW: RawPageData = {
  requested_url: "https://example.com/article?q=test",
  current_url: "https://example.com/article?q=test",
  canonical_url: "https://example.com/article",
  document_title: "Example Article",
  document_language: "en-US",
  meta_description: "An example meta description.",
  json_ld_raw: [
    JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "name": "Example Article" }),
  ],
  selected_text: "This is selected text.",
  main_text: "The main article content goes here.",
  rendered_text: "Full page rendered text.",
};

const MINIMAL_RAW: RawPageData = {
  requested_url: "https://example.com/",
  current_url: "https://example.com/",
  canonical_url: null,
  document_title: "",
  document_language: null,
  meta_description: null,
  json_ld_raw: [],
  selected_text: null,
  main_text: null,
  rendered_text: null,
};

// ---------------------------------------------------------------------------
// Authority fields
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — authority fields", () => {
  it("sets artifact_type to BrowserPageCapture", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.artifact_type).toBe("BrowserPageCapture");
  });

  it("sets spec_version to v0.1", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.spec_version).toBe("v0.1");
  });

  it("passes captured_at through unchanged", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.captured_at).toBe(FIXED_TS);
  });

  it("does not derive captured_at from page data", () => {
    const result1 = normalizeCaptureData(FULL_RAW, "2026-01-01T00:00:00.000Z");
    const result2 = normalizeCaptureData(FULL_RAW, "2026-06-15T09:30:00.000Z");
    expect(result1.captured_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result2.captured_at).toBe("2026-06-15T09:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// URL fields
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — URL fields", () => {
  it("preserves requested_url", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.requested_url).toBe("https://example.com/article?q=test");
  });

  it("preserves current_url", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.current_url).toBe("https://example.com/article?q=test");
  });

  it("preserves canonical_url when present", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.canonical_url).toBe("https://example.com/article");
  });

  it("produces null canonical_url when absent", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.canonical_url).toBeNull();
  });

  it("truncates URLs exceeding BOUNDS.URL", () => {
    const longUrl = "https://example.com/" + "a".repeat(BOUNDS.URL + 100);
    const raw: RawPageData = { ...FULL_RAW, requested_url: longUrl };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.requested_url.length).toBe(BOUNDS.URL);
  });

  it("converts empty canonical_url to null", () => {
    const raw: RawPageData = { ...FULL_RAW, canonical_url: "" };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.canonical_url).toBeNull();
  });

  it("converts whitespace-only canonical_url to null", () => {
    const raw: RawPageData = { ...FULL_RAW, canonical_url: "   " };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.canonical_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Metadata fields
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — metadata", () => {
  it("preserves document_title", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.document_title).toBe("Example Article");
  });

  it("converts empty title to empty string (not null)", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.document_title).toBe("");
  });

  it("truncates title exceeding BOUNDS.TITLE", () => {
    const raw: RawPageData = { ...FULL_RAW, document_title: "T".repeat(BOUNDS.TITLE + 50) };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.document_title.length).toBe(BOUNDS.TITLE);
  });

  it("preserves document_language", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.document_language).toBe("en-US");
  });

  it("produces null document_language when absent", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.document_language).toBeNull();
  });

  it("preserves meta_description", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.meta_description).toBe("An example meta description.");
  });

  it("produces null meta_description when absent", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.meta_description).toBeNull();
  });

  it("truncates meta_description exceeding BOUNDS.META_DESCRIPTION", () => {
    const raw: RawPageData = { ...FULL_RAW, meta_description: "D".repeat(BOUNDS.META_DESCRIPTION + 100) };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.meta_description).not.toBeNull();
    expect(result.meta_description!.length).toBe(BOUNDS.META_DESCRIPTION);
  });
});

// ---------------------------------------------------------------------------
// Content fields
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — content fields", () => {
  it("preserves selected_text", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.selected_text).toBe("This is selected text.");
  });

  it("produces null selected_text when absent", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.selected_text).toBeNull();
  });

  it("truncates selected_text exceeding BOUNDS.SELECTED_TEXT", () => {
    const raw: RawPageData = { ...FULL_RAW, selected_text: "S".repeat(BOUNDS.SELECTED_TEXT + 500) };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.selected_text!.length).toBe(BOUNDS.SELECTED_TEXT);
  });

  it("preserves main_text", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.main_text).toBe("The main article content goes here.");
  });

  it("produces null main_text when absent", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.main_text).toBeNull();
  });

  it("truncates main_text exceeding BOUNDS.MAIN_TEXT", () => {
    const raw: RawPageData = { ...FULL_RAW, main_text: "M".repeat(BOUNDS.MAIN_TEXT + 1000) };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.main_text!.length).toBe(BOUNDS.MAIN_TEXT);
  });

  it("preserves rendered_text", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(result.rendered_text).toBe("Full page rendered text.");
  });

  it("produces null rendered_text when absent", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.rendered_text).toBeNull();
  });

  it("truncates rendered_text exceeding BOUNDS.RENDERED_TEXT", () => {
    const raw: RawPageData = { ...FULL_RAW, rendered_text: "R".repeat(BOUNDS.RENDERED_TEXT + 1000) };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.rendered_text!.length).toBe(BOUNDS.RENDERED_TEXT);
  });
});

// ---------------------------------------------------------------------------
// Null byte sanitization
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — null byte sanitization", () => {
  it("strips null bytes from document_title", () => {
    const raw: RawPageData = { ...FULL_RAW, document_title: "Hello\0World" };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.document_title).toBe("HelloWorld");
    expect(result.document_title).not.toContain("\0");
  });

  it("strips null bytes from meta_description", () => {
    const raw: RawPageData = { ...FULL_RAW, meta_description: "Desc\0ription" };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.meta_description).toBe("Desc​ription".replace("​", ""));
    expect(result.meta_description).not.toContain("\0");
  });

  it("strips null bytes from selected_text", () => {
    const raw: RawPageData = { ...FULL_RAW, selected_text: "Se\0lected" };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.selected_text).not.toContain("\0");
  });

  it("strips null bytes from rendered_text", () => {
    const raw: RawPageData = { ...FULL_RAW, rendered_text: "Body\0Text" };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.rendered_text).not.toContain("\0");
  });

  it("reduces a string of only null bytes to null", () => {
    const raw: RawPageData = { ...FULL_RAW, meta_description: "\0\0\0" };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.meta_description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// JSON-LD normalization
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — JSON-LD", () => {
  it("parses valid JSON-LD", () => {
    const article = { "@context": "https://schema.org", "@type": "Article", "name": "Test" };
    const raw: RawPageData = { ...MINIMAL_RAW, json_ld_raw: [JSON.stringify(article)] };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.json_ld).toHaveLength(1);
    expect((result.json_ld[0] as Record<string, unknown>)["@type"]).toBe("Article");
  });

  it("silently drops malformed JSON-LD", () => {
    const raw: RawPageData = { ...MINIMAL_RAW, json_ld_raw: ["not json", "{ also bad"] };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.json_ld).toHaveLength(0);
  });

  it("mixes valid and invalid JSON-LD, keeping only valid", () => {
    const valid = JSON.stringify({ "@type": "WebPage" });
    const raw: RawPageData = { ...MINIMAL_RAW, json_ld_raw: ["bad json", valid, "{broken"] };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.json_ld).toHaveLength(1);
  });

  it("bounds item count to BOUNDS.JSON_LD_ITEMS", () => {
    const items = Array.from({ length: BOUNDS.JSON_LD_ITEMS + 5 }, (_, i) =>
      JSON.stringify({ "@type": "Thing", id: i }),
    );
    const raw: RawPageData = { ...MINIMAL_RAW, json_ld_raw: items };
    const result = normalizeCaptureData(raw, FIXED_TS);
    expect(result.json_ld.length).toBeLessThanOrEqual(BOUNDS.JSON_LD_ITEMS);
  });

  it("drops items whose serialized form exceeds BOUNDS.JSON_LD_ITEM_CHARS", () => {
    const oversized = JSON.stringify({ data: "x".repeat(BOUNDS.JSON_LD_ITEM_CHARS + 100) });
    const normal = JSON.stringify({ "@type": "Article" });
    const raw: RawPageData = { ...MINIMAL_RAW, json_ld_raw: [oversized, normal] };
    const result = normalizeCaptureData(raw, FIXED_TS);
    // Only the normal item should survive
    expect(result.json_ld).toHaveLength(1);
  });

  it("returns empty array when json_ld_raw is empty", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(result.json_ld).toEqual([]);
  });

  it("strips null bytes from JSON-LD text before parsing", () => {
    const raw: RawPageData = { ...MINIMAL_RAW, json_ld_raw: ["\0"] };
    const result = normalizeCaptureData(raw, FIXED_TS);
    // "\0" stripped becomes "" — empty, should be dropped
    expect(result.json_ld).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("normalizeCaptureData — output shape", () => {
  it("returns all required fields", () => {
    const result: BrowserPageCapture = normalizeCaptureData(FULL_RAW, FIXED_TS);
    const requiredKeys: (keyof BrowserPageCapture)[] = [
      "artifact_type",
      "spec_version",
      "requested_url",
      "current_url",
      "canonical_url",
      "document_title",
      "document_language",
      "meta_description",
      "json_ld",
      "selected_text",
      "main_text",
      "rendered_text",
      "captured_at",
    ];
    for (const key of requiredKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  it("json_ld is always an array", () => {
    const result = normalizeCaptureData(MINIMAL_RAW, FIXED_TS);
    expect(Array.isArray(result.json_ld)).toBe(true);
  });

  it("captured_at is a string", () => {
    const result = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(typeof result.captured_at).toBe("string");
  });

  it("is deterministic for identical inputs", () => {
    const r1 = normalizeCaptureData(FULL_RAW, FIXED_TS);
    const r2 = normalizeCaptureData(FULL_RAW, FIXED_TS);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
