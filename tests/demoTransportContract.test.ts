/**
 * Demo transport contract — anti-drift guard against the frozen D2-B golden.
 *
 * The two vendored fixtures are the SINGLE SOURCE OF TRUTH for the
 * GET /session response (`DemoSessionResponse`) that the demo orchestrator
 * emits. They are consumed BYTE-FOR-BYTE so the extension's transport types
 * can never silently drift from the producer contract.
 *
 * Vendored bytes — exact copies from the Counterpedia repo:
 *   source repo:   thelaplage/counterpedia
 *   source commit: 67a5940 (feat/demo2-d2b-demo-orchestrator-v0-1, D2-B freeze)
 *   source paths:  tests/fixtures/demo2/demo-session-response.admission-eligible.json
 *                  tests/fixtures/demo2/demo-session-response.evidence-complete.json
 *
 * If the extension renames or drops a field the transport reads, the exhaustive
 * `Record<keyof DemoSessionSummary, true>` below stops compiling OR the presence
 * assertion against the golden bytes fails loudly — that is the drift alarm.
 */

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { describe, it, expect } from "vitest";
import type { DemoSessionSummary } from "../src/lib/demoTransport";

// ---------------------------------------------------------------------------
// Vendored golden bytes + pinned provenance (matches the counterpedia originals)
// ---------------------------------------------------------------------------

const ADMISSION_ELIGIBLE_RAW = readFileSync(
  new URL("./fixtures/demo2/demo-session-response.admission-eligible.json", import.meta.url),
  "utf8",
);
const EVIDENCE_COMPLETE_RAW = readFileSync(
  new URL("./fixtures/demo2/demo-session-response.evidence-complete.json", import.meta.url),
  "utf8",
);

// Byte-for-byte digests of thelaplage/counterpedia@67a5940 originals.
const PINNED_ADMISSION_ELIGIBLE_SHA256 =
  "4e92866765d6960c9f8ff968132c222024af8e42d0e6a770d22045a6cf2a3d40";
const PINNED_EVIDENCE_COMPLETE_SHA256 =
  "23c6298af93802bd606ad30720a5108932253e1f8cfa200b995cadfb7bee29da";

// Parsed through the extension's actual transport type — no re-typed contract.
const admissionEligible = JSON.parse(ADMISSION_ELIGIBLE_RAW) as unknown as DemoSessionSummary;
const evidenceComplete = JSON.parse(EVIDENCE_COMPLETE_RAW) as unknown as DemoSessionSummary;

// Raw records for exact-name / alias inspection.
const admissionEligibleRaw = JSON.parse(ADMISSION_ELIGIBLE_RAW) as Record<string, unknown>;
const evidenceCompleteRaw = JSON.parse(EVIDENCE_COMPLETE_RAW) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Anti-drift hinge: exhaustive over every field DemoSessionSummary declares.
//
// Adding a field to DemoSessionSummary forces a new entry here (tsc: missing
// property). Renaming one forces a rename here. Either way the field name must
// then exist in the frozen golden bytes below or the presence assertions fail.
// ---------------------------------------------------------------------------

const TRANSPORT_FIELDS: Record<keyof DemoSessionSummary, true> = {
  state: true,
  browserCaptureDigest: true,
  httpCaptureDigest: true,
  proposalSummary: true,
  proposalReady: true,
  admissionEligible: true,
  admitted: true,
  publicationDigest: true,
  evidenceComplete: true,
  sessionId: true,
};
const REQUIRED_TRANSPORT_FIELDS = Object.keys(TRANSPORT_FIELDS) as ReadonlyArray<
  keyof DemoSessionSummary
>;

// Contract fields the evidence-complete vector additionally carries. Not on the
// current transport type, but frozen by D2-B — the extension must be able to
// rely on their exact names when it grows to read them.
const EVIDENCE_COMPLETE_EXTRA_FIELDS = ["admittedComposition", "evidenceData"] as const;

// Aliases the frozen contract must NEVER introduce at the top level.
const FORBIDDEN_TOP_LEVEL_ALIASES = ["digest", "sessionState", "proposalId"] as const;

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe("demo2 golden fixtures — vendored byte-for-byte from counterpedia@67a5940", () => {
  it("admission-eligible raw SHA-256 matches the pinned original", () => {
    const actual = createHash("sha256").update(ADMISSION_ELIGIBLE_RAW).digest("hex");
    expect(actual).toBe(PINNED_ADMISSION_ELIGIBLE_SHA256);
  });

  it("evidence-complete raw SHA-256 matches the pinned original", () => {
    const actual = createHash("sha256").update(EVIDENCE_COMPLETE_RAW).digest("hex");
    expect(actual).toBe(PINNED_EVIDENCE_COMPLETE_SHA256);
  });
});

// ---------------------------------------------------------------------------
// Anti-drift: every field the transport reads is present under its EXACT name
// ---------------------------------------------------------------------------

describe("DemoSessionSummary ↔ golden bytes — no drift, no aliases", () => {
  for (const [label, raw] of [
    ["admission-eligible", admissionEligibleRaw] as const,
    ["evidence-complete", evidenceCompleteRaw] as const,
  ]) {
    it(`${label}: every transport field is present under the exact frozen name`, () => {
      for (const field of REQUIRED_TRANSPORT_FIELDS) {
        expect(
          hasKey(raw, field),
          `golden ${label} is missing transport field "${field}" (drift/rename?)`,
        ).toBe(true);
      }
    });

    it(`${label}: no forbidden top-level aliases (digest / sessionState / proposalId)`, () => {
      for (const alias of FORBIDDEN_TOP_LEVEL_ALIASES) {
        expect(
          hasKey(raw, alias),
          `golden ${label} introduced forbidden top-level alias "${alias}"`,
        ).toBe(false);
      }
    });
  }

  it("evidence-complete additionally carries admittedComposition + evidenceData", () => {
    for (const field of EVIDENCE_COMPLETE_EXTRA_FIELDS) {
      expect(
        hasKey(evidenceCompleteRaw, field),
        `golden evidence-complete is missing "${field}"`,
      ).toBe(true);
      expect(evidenceCompleteRaw[field], `"${field}" must be populated on the evidence vector`)
        .not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The parsed values are actually reachable through the transport type
// ---------------------------------------------------------------------------

describe("DemoSessionSummary — reads the frozen values", () => {
  it("admission-eligible vector: expected lifecycle flags", () => {
    expect(admissionEligible.state).toBe("ADMISSION_ELIGIBLE");
    expect(admissionEligible.proposalReady).toBe(true);
    expect(admissionEligible.admissionEligible).toBe(true);
    expect(admissionEligible.admitted).toBe(false);
    expect(admissionEligible.evidenceComplete).toBe(false);
    expect(admissionEligible.publicationDigest).toBeNull();
    expect(admissionEligible.sessionId).toBe("00000000-demo2-d2b-fixture-000000000000");
    expect(admissionEligible.browserCaptureDigest).toMatch(/^sha256:/);
    expect(admissionEligible.httpCaptureDigest).toMatch(/^sha256:/);
    // proposalSummary is present under the frozen name (D2-B emits an object).
    expect(hasKey(admissionEligibleRaw, "proposalSummary")).toBe(true);
  });

  it("evidence-complete vector: expected lifecycle flags", () => {
    expect(evidenceComplete.state).toBe("EVIDENCE_COMPLETE");
    expect(evidenceComplete.admitted).toBe(true);
    expect(evidenceComplete.evidenceComplete).toBe(true);
    expect(evidenceComplete.publicationDigest).toMatch(/^sha256:/);
    expect(evidenceComplete.sessionId).toBe("00000000-demo2-d2b-fixture-000000000000");
  });
});
