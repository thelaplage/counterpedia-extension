/**
 * BrowserPageCapture v0.1
 *
 * Observation artifact type and normalization for explicit user-initiated
 * page capture. This is NOT an HTTP response capture and NOT evidence that
 * the rendered content is true.
 *
 * Normalization is a pure function: no Chrome APIs, fully unit-testable.
 */

import type { RawPageData } from "../capture/captureScript";

// ---------------------------------------------------------------------------
// Size bounds
// ---------------------------------------------------------------------------

export const BOUNDS = {
  TITLE: 500,
  URL: 2048,
  META_DESCRIPTION: 500,
  SELECTED_TEXT: 5_000,
  MAIN_TEXT: 50_000,
  RENDERED_TEXT: 50_000,
  JSON_LD_ITEMS: 10,
  JSON_LD_ITEM_CHARS: 10_000,
  LANGUAGE: 35,       // BCP 47 max
} as const;

// ---------------------------------------------------------------------------
// BrowserPageCapture type
// ---------------------------------------------------------------------------

export interface BrowserPageCapture {
  /** Artifact type discriminator — always "BrowserPageCapture". */
  artifact_type: "BrowserPageCapture";
  /** Spec version for this schema. */
  spec_version: "v0.1";

  // URLs
  /** URL reported by Chrome for the tab at capture time (may differ from current_url on redirect). */
  requested_url: string;
  /** document.URL at the moment of capture. */
  current_url: string;
  /** <link rel="canonical"> href, or null if absent. */
  canonical_url: string | null;

  // Metadata
  document_title: string;
  /** html[lang] value, or null if absent. */
  document_language: string | null;
  /** <meta name="description"> content, or null if absent. */
  meta_description: string | null;

  // Structured data
  /** Parsed JSON-LD objects from <script type="application/ld+json"> blocks. */
  json_ld: unknown[];

  // Content
  /** window.getSelection() text if any was selected, bounded to BOUNDS.SELECTED_TEXT. */
  selected_text: string | null;
  /** innerText of the first <main> or <article> element, form nodes stripped. */
  main_text: string | null;
  /** document.body innerText with form/script/style nodes stripped. */
  rendered_text: string | null;

  /** ISO 8601 timestamp supplied by the capture boundary (background service worker), not the page. */
  captured_at: string;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function stripNullBytes(s: string): string {
  return s.replace(/\0/g, "");
}

function boundStr(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const cleaned = stripNullBytes(s).trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

function boundUrl(s: string | null | undefined): string | null {
  return boundStr(s, BOUNDS.URL);
}

// ---------------------------------------------------------------------------
// JSON-LD normalization
// ---------------------------------------------------------------------------

function normalizeJsonLd(rawItems: string[]): unknown[] {
  const result: unknown[] = [];
  for (const raw of rawItems.slice(0, BOUNDS.JSON_LD_ITEMS)) {
    const cleaned = stripNullBytes(raw).trim();
    if (!cleaned) continue;
    try {
      const parsed: unknown = JSON.parse(cleaned);
      // Re-serialize to enforce the per-item char bound, then re-parse so we store
      // the actual object (not a truncated JSON string).
      const serialized = JSON.stringify(parsed);
      if (serialized.length > BOUNDS.JSON_LD_ITEM_CHARS) continue; // drop oversized items
      result.push(parsed);
    } catch {
      // Malformed JSON-LD — skip silently
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main normalization entry point
// ---------------------------------------------------------------------------

/**
 * Normalize raw page data captured from the page script into a BrowserPageCapture.
 *
 * @param raw      Raw data returned by capturePageData (injected script).
 * @param capturedAt ISO 8601 timestamp from the capture boundary — NOT from the page.
 */
export function normalizeCaptureData(raw: RawPageData, capturedAt: string): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture",
    spec_version: "v0.1",

    requested_url: boundUrl(raw.requested_url) ?? "",
    current_url: boundUrl(raw.current_url) ?? "",
    canonical_url: boundUrl(raw.canonical_url),

    document_title: boundStr(raw.document_title, BOUNDS.TITLE) ?? "",
    document_language: boundStr(raw.document_language, BOUNDS.LANGUAGE),
    meta_description: boundStr(raw.meta_description, BOUNDS.META_DESCRIPTION),

    json_ld: normalizeJsonLd(raw.json_ld_raw ?? []),

    selected_text: boundStr(raw.selected_text, BOUNDS.SELECTED_TEXT),
    main_text: boundStr(raw.main_text, BOUNDS.MAIN_TEXT),
    rendered_text: boundStr(raw.rendered_text, BOUNDS.RENDERED_TEXT),

    captured_at: capturedAt,
  };
}
