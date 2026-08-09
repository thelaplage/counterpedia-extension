/**
 * BrowserPageCapture v0.1 — producer contract anti-drift tests.
 *
 * Proves:
 *   1.  normalizeCaptureData produces the committed golden object.
 *   2.  captureBytes(real_capture) is byte-for-byte equal to golden.json.
 *   3.  captureDigest(real_capture) equals the committed SHA-256 pin.
 *   4.  The golden artifact satisfies the producer-owned v0.1 schema.
 *   5.  Wrong artifact_type fails schema validation.
 *   6.  Wrong spec_version fails schema validation.
 *   7.  Missing required field fails schema validation.
 *   8.  Unexpected extra field fails schema validation.
 *   9.  Existing BOUNDS remain represented correctly in the schema.
 *  10.  One-click/exact-object transport invariant: captureBytes is deterministic.
 *
 * No JSON Schema validator library is added — the validator below is scoped
 * to exactly the keywords used in browser-page-capture.v0.1.schema.json.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeCaptureData, BOUNDS } from "../src/lib/browserPageCapture";
import type { RawPageData } from "../src/capture/captureScript";
import { captureBytes, captureDigest } from "../src/lib/captureDigest";
import schemaRaw from "../schemas/browser-page-capture.v0.1.schema.json";

// ---------------------------------------------------------------------------
// Minimal JSON Schema validator — handles the keywords used in the BPC schema:
//   type (string | string[]), const, required, additionalProperties: false,
//   maxLength, maxItems, properties.
// Reads from the actual schema JSON file so schema edits break these tests.
// ---------------------------------------------------------------------------

type SchemaNode = {
  type?: string | string[];
  const?: unknown;
  maxLength?: number;
  maxItems?: number;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode | boolean;
};

function validateNode(schema: SchemaNode, data: unknown, path: string): string[] {
  const errors: string[] = [];

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual =
      data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
    if (!types.includes(actual)) {
      errors.push(
        `${path}: expected type [${types.join("|")}], got "${actual}"`,
      );
      return errors;
    }
  }

  if ("const" in schema && data !== schema.const) {
    errors.push(
      `${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`,
    );
  }

  if (
    typeof data === "string" &&
    schema.maxLength !== undefined &&
    data.length > schema.maxLength
  ) {
    errors.push(
      `${path}: length ${data.length} exceeds maxLength ${schema.maxLength}`,
    );
  }

  if (
    Array.isArray(data) &&
    schema.maxItems !== undefined &&
    data.length > schema.maxItems
  ) {
    errors.push(
      `${path}: array length ${data.length} exceeds maxItems ${schema.maxItems}`,
    );
  }

  if (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data)
  ) {
    const obj = data as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push(`${path}: missing required "${key}"`);
        }
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: additional property "${key}" is not allowed`);
        }
      }
    }

    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in obj) {
          errors.push(...validateNode(sub, obj[k], `${path}.${k}`));
        }
      }
    }
  }

  return errors;
}

type ValidationResult = { valid: boolean; errors: string[] };

function validateSchema(data: unknown): ValidationResult {
  const errors = validateNode(schemaRaw as unknown as SchemaNode, data, "root");
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Golden fixture setup
// ---------------------------------------------------------------------------

const _dir = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(_dir, "fixtures/browser-page-capture/v0.1/golden.json");
const SHA256_PATH = join(_dir, "fixtures/browser-page-capture/v0.1/golden.sha256");

// golden.json stores the exact captureBytes() output — no trailing newline.
const GOLDEN_BYTES = readFileSync(GOLDEN_PATH, "utf8");
const GOLDEN_SHA256 = readFileSync(SHA256_PATH, "utf8").trim();

// Dedicated RawPageData fixture for the golden.
// Exercises: canonical/requested/current URLs, title, language, JSON-LD,
// main_text, rendered_text; nullable fields: meta_description, selected_text.
const GOLDEN_RAW: RawPageData = {
  requested_url: "https://example.com/article?ref=nav",
  current_url: "https://example.com/article",
  canonical_url: "https://example.com/article",
  document_title: "Contract Golden Example",
  document_language: "en",
  meta_description: null,
  json_ld_raw: [
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "Contract Golden Example",
    }),
  ],
  selected_text: null,
  main_text: "Main article body content for the golden fixture.",
  rendered_text: "Rendered body text including navigation and footer.",
};
const GOLDEN_TS = "2026-08-08T12:00:00.000Z";

// ---------------------------------------------------------------------------
// 1–3: Golden object, transport bytes, digest pin
// ---------------------------------------------------------------------------

describe("BrowserPageCapture v0.1 — golden object and transport bytes", () => {
  it("normalizeCaptureData produces the committed golden object", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    expect(real).toEqual(JSON.parse(GOLDEN_BYTES) as unknown);
  });

  it("captureBytes(real_capture) is byte-for-byte equal to golden.json", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    expect(captureBytes(real)).toBe(GOLDEN_BYTES);
  });

  it("captureDigest(real_capture) equals the committed SHA-256 pin", async () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    expect(await captureDigest(real)).toBe(GOLDEN_SHA256);
  });
});

// ---------------------------------------------------------------------------
// 4–8: Schema conformance and rejection
// ---------------------------------------------------------------------------

describe("BrowserPageCapture v0.1 — schema conformance", () => {
  it("golden artifact satisfies the producer-owned v0.1 schema", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const result = validateSchema(real as unknown);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("wrong artifact_type fails schema validation", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const bad = { ...real as unknown as Record<string, unknown>, artifact_type: "WrongType" };
    expect(validateSchema(bad).valid).toBe(false);
  });

  it("wrong spec_version fails schema validation", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const bad = { ...real as unknown as Record<string, unknown>, spec_version: "v9.9" };
    expect(validateSchema(bad).valid).toBe(false);
  });

  it("missing required field fails schema validation", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS) as unknown as Record<string, unknown>;
    const withoutArtifactType = Object.fromEntries(
      Object.entries(real).filter(([k]) => k !== "artifact_type"),
    );
    expect(validateSchema(withoutArtifactType).valid).toBe(false);
  });

  it("unexpected extra field fails schema validation", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const bad = { ...real as unknown as Record<string, unknown>, unexpected_extra: "not allowed" };
    expect(validateSchema(bad).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9: BOUNDS represented in the schema
// ---------------------------------------------------------------------------

describe("BrowserPageCapture v0.1 — schema BOUNDS", () => {
  it("document_title: at BOUNDS.TITLE is valid, one over is invalid", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const atBound = { ...real as unknown as Record<string, unknown>, document_title: "T".repeat(BOUNDS.TITLE) };
    expect(validateSchema(atBound).valid).toBe(true);
    const overBound = { ...real as unknown as Record<string, unknown>, document_title: "T".repeat(BOUNDS.TITLE + 1) };
    expect(validateSchema(overBound).valid).toBe(false);
  });

  it("requested_url: at BOUNDS.URL is valid, one over is invalid", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const atBound = { ...real as unknown as Record<string, unknown>, requested_url: "a".repeat(BOUNDS.URL) };
    expect(validateSchema(atBound).valid).toBe(true);
    const overBound = { ...real as unknown as Record<string, unknown>, requested_url: "a".repeat(BOUNDS.URL + 1) };
    expect(validateSchema(overBound).valid).toBe(false);
  });

  it("meta_description: at BOUNDS.META_DESCRIPTION is valid, one over is invalid", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const atBound = { ...real as unknown as Record<string, unknown>, meta_description: "D".repeat(BOUNDS.META_DESCRIPTION) };
    expect(validateSchema(atBound).valid).toBe(true);
    const overBound = { ...real as unknown as Record<string, unknown>, meta_description: "D".repeat(BOUNDS.META_DESCRIPTION + 1) };
    expect(validateSchema(overBound).valid).toBe(false);
  });

  it("json_ld: at BOUNDS.JSON_LD_ITEMS is valid, one over is invalid", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const atBound = {
      ...real as unknown as Record<string, unknown>,
      json_ld: Array.from({ length: BOUNDS.JSON_LD_ITEMS }, () => ({})),
    };
    expect(validateSchema(atBound).valid).toBe(true);
    const overBound = {
      ...real as unknown as Record<string, unknown>,
      json_ld: Array.from({ length: BOUNDS.JSON_LD_ITEMS + 1 }, () => ({})),
    };
    expect(validateSchema(overBound).valid).toBe(false);
  });

  it("selected_text: at BOUNDS.SELECTED_TEXT is valid, one over is invalid", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const atBound = { ...real as unknown as Record<string, unknown>, selected_text: "S".repeat(BOUNDS.SELECTED_TEXT) };
    expect(validateSchema(atBound).valid).toBe(true);
    const overBound = { ...real as unknown as Record<string, unknown>, selected_text: "S".repeat(BOUNDS.SELECTED_TEXT + 1) };
    expect(validateSchema(overBound).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10: One-click/exact-object transport invariant
// ---------------------------------------------------------------------------

describe("BrowserPageCapture v0.1 — one-click/exact-object transport invariant", () => {
  it("captureBytes is deterministic: same capture object produces identical bytes", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    expect(captureBytes(real)).toBe(captureBytes(real));
  });

  it("captureBytes does not mutate the capture object", () => {
    const real = normalizeCaptureData(GOLDEN_RAW, GOLDEN_TS);
    const before = JSON.stringify(real);
    captureBytes(real);
    expect(JSON.stringify(real)).toBe(before);
  });
});
