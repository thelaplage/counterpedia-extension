/**
 * AUTHOR-HTTP response guard tests — client-side fail-closed allow-list.
 *
 * The guard is the extension's defense-in-depth against a localhost authoring
 * response that tries to smuggle admission/standing/publication authority, or to
 * present a draft as anything other than proposal-only. It is validated against a
 * REAL serialized handoff (captured from the actual counterpedia-authoring
 * transport) plus adversarial mutations of it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAuthoringHandoff,
  tryParseAuthoringHandoff,
  AuthoringResponseError,
} from "../src/lib/authoringResponseGuard";

const __dirname = dirname(fileURLToPath(import.meta.url));

function realHandoff(): Record<string, unknown> {
  const raw = readFileSync(
    join(__dirname, "fixtures/authoring/handoff.valid.json"),
    "utf-8",
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Deep clone so a mutation in one test never leaks into another. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe("parseAuthoringHandoff — real proposal-only handoff", () => {
  it("accepts the genuine serialized handoff and pins the frozen literals", () => {
    const handoff = parseAuthoringHandoff(realHandoff());
    expect(handoff.authority_posture).toBe("proposal_only");
    expect(handoff.producer).toBe("counterpedia-authoring");
    expect(handoff.schema_version).toBe("authoring_admission_handoff.v0.1");
    expect(handoff.draft_proposal.lifecycle).toBe("proposal");
    expect(typeof handoff.handoff_digest).toBe("string");
    expect(handoff.handoff_digest.length).toBeGreaterThan(0);
  });

  it("carries the four component payloads as opaque objects", () => {
    const handoff = parseAuthoringHandoff(realHandoff());
    for (const key of [
      "proposal_package",
      "evidence_bundle",
      "claim_map",
      "draft_proposal",
    ] as const) {
      expect(typeof handoff[key]).toBe("object");
      expect(handoff[key]).not.toBeNull();
    }
  });

  it("does not false-positive on legitimate producer metadata (source_id / capture_ref / content_digest)", () => {
    // These appear legitimately in the producer's OWN body; the guard's forbidden
    // set is about AUTHORITY collapse, not about custody of the request.
    const flat = JSON.stringify(realHandoff());
    expect(flat).toContain("source_id");
    // Yet the real handoff still parses — proving no false-positive.
    expect(() => parseAuthoringHandoff(realHandoff())).not.toThrow();
  });
});

describe("parseAuthoringHandoff — fails closed", () => {
  it("rejects a non-object", () => {
    expect(() => parseAuthoringHandoff("nope")).toThrow(AuthoringResponseError);
    expect(() => parseAuthoringHandoff(null)).toThrow(AuthoringResponseError);
    expect(() => parseAuthoringHandoff([1, 2])).toThrow(AuthoringResponseError);
  });

  it("rejects an unknown top-level key", () => {
    const bad = clone(realHandoff());
    bad["surprise"] = true;
    expect(() => parseAuthoringHandoff(bad)).toThrow(/unknown top-level field/);
  });

  it("rejects a wrong authority_posture", () => {
    const bad = clone(realHandoff());
    bad["authority_posture"] = "admitted";
    expect(() => parseAuthoringHandoff(bad)).toThrow(/authority_posture/);
  });

  it("rejects a wrong producer", () => {
    const bad = clone(realHandoff());
    bad["producer"] = "some-other-runtime";
    expect(() => parseAuthoringHandoff(bad)).toThrow(/producer/);
  });

  it("rejects a contaminated authority field at the top level (allow-list fires first)", () => {
    // A top-level authority key is not on the allow-list, so the unknown-key
    // check rejects it before the recursive authority scan even runs — either
    // way it fails closed.
    const bad = clone(realHandoff());
    bad["admitted_at"] = "2026-08-13T00:00:00Z";
    expect(() => parseAuthoringHandoff(bad)).toThrow(AuthoringResponseError);
  });

  it("rejects a contaminated authority field nested deep in a component", () => {
    const bad = clone(realHandoff());
    (bad["proposal_package"] as Record<string, unknown>)["standing"] = "granted";
    expect(() => parseAuthoringHandoff(bad)).toThrow(/authority-bearing field/);
  });

  it("rejects a nested 'published' field even inside an array", () => {
    const bad = clone(realHandoff());
    const draft = bad["draft_proposal"] as Record<string, unknown>;
    draft["section_blocks"] = [{ published: true }];
    expect(() => parseAuthoringHandoff(bad)).toThrow(/authority-bearing field/);
  });

  it("rejects a draft lifecycle promoted past the proposal-only boundary", () => {
    const bad = clone(realHandoff());
    (bad["draft_proposal"] as Record<string, unknown>)["lifecycle"] = "admitted";
    expect(() => parseAuthoringHandoff(bad)).toThrow(/proposal-only|lifecycle/);
  });

  it("rejects a nested lifecycle (draft_lifecycle) promoted to a post-boundary value", () => {
    const bad = clone(realHandoff());
    (bad["proposal_package"] as Record<string, unknown>)["draft_lifecycle"] =
      "published";
    expect(() => parseAuthoringHandoff(bad)).toThrow();
  });

  it("rejects a missing draft_proposal", () => {
    const bad = clone(realHandoff());
    delete bad["draft_proposal"];
    expect(() => parseAuthoringHandoff(bad)).toThrow(/draft_proposal/);
  });

  it("rejects a missing handoff_digest", () => {
    const bad = clone(realHandoff());
    delete bad["handoff_digest"];
    expect(() => parseAuthoringHandoff(bad)).toThrow(/handoff_digest/);
  });

  it("tryParse returns null (not throw) on contamination", () => {
    const bad = clone(realHandoff());
    bad["admission"] = { admitted: true };
    expect(tryParseAuthoringHandoff(bad)).toBeNull();
    // and still returns the parsed handoff on the clean input.
    expect(tryParseAuthoringHandoff(realHandoff())).not.toBeNull();
  });
});
