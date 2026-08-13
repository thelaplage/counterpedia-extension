/**
 * Negative-space audit for the AUTHOR-HTTP extension modules (lane firewall).
 *
 * Proves the authoring client/guard/state modules neither import nor expose any
 * admission/publication/standing machinery, and — critically for the seam — that
 * they do NOT import the acquisition state module (the two state machines are
 * kept independent; the only allowed shared type is the guarded
 * AcquisitionCaptureResult, whose URL the client reads).
 *
 * NB: the response guard legitimately contains the forbidden *strings* as data
 * (its FORBIDDEN_AUTHORITY_KEYS list is how it REJECTS contamination), so a raw
 * text scan would false-positive. This audit inspects import specifiers and the
 * modules' actual runtime export names instead.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as clientMod from "../src/lib/authoringClient";
import * as guardMod from "../src/lib/authoringResponseGuard";
import * as stateMod from "../src/lib/authoringState";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../src/lib");

const MODULE_FILES = [
  "authoringClient.ts",
  "authoringResponseGuard.ts",
  "authoringState.ts",
];

const FORBIDDEN_IMPORT_SUBSTRINGS = [
  "admission",
  "governance",
  "claim_support",
  "claimsupportedge",
  "promotion",
  "publish",
];

// NB: "admit" (the capability verb) is forbidden, but NOT the bare noun
// "admission": this lane deliberately exposes the anti-admission label constant
// `ADMISSION_LINE` (value: "Admission: not performed"). A blunt "admission"
// substring ban would false-positive on the very constant that keeps the lane
// honest, so we ban the ACT ("admit"/"promote"/"publish"/…), not the disclaimer.
const FORBIDDEN_EXPORT_SUBSTRINGS = [
  "admit",
  "promote",
  "publish",
  "verif",
  "standing",
  "ratif",
  "support_type",
  "governance",
  "claimsupportedge",
];

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]!);
  return specs;
}

describe("authoring modules import no governance-lane module", () => {
  it.each(MODULE_FILES)("%s imports nothing governance-lane", (file) => {
    const source = readFileSync(join(LIB, file), "utf-8");
    for (const spec of importSpecifiers(source)) {
      const lower = spec.toLowerCase();
      for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
        expect(lower.includes(forbidden)).toBe(false);
      }
    }
  });
});

describe("authoring state machine is independent of acquisition state", () => {
  it("no authoring module imports acquisitionState", () => {
    for (const file of MODULE_FILES) {
      const source = readFileSync(join(LIB, file), "utf-8");
      for (const spec of importSpecifiers(source)) {
        expect(spec).not.toContain("acquisitionState");
      }
    }
  });

  it("the client's ONLY acquisition coupling is the guarded result TYPE (a type-only import)", () => {
    const source = readFileSync(join(LIB, "authoringClient.ts"), "utf-8");
    // It references the acquisition RESULT type for the source URL, and does so
    // as a type-only import (erased at runtime) — never the acquisition client
    // or its transport.
    expect(source).toContain("import type { AcquisitionCaptureResult }");
    expect(source).not.toContain("acquisitionClient");
    expect(source).not.toContain("acquisitionState");
  });
});

describe("authoring modules expose no governance-lane symbol", () => {
  it.each([
    ["authoringClient", clientMod],
    ["authoringResponseGuard", guardMod],
    ["authoringState", stateMod],
  ] as const)("%s exports are proposal-only / metadata-only", (_name, mod) => {
    for (const key of Object.keys(mod)) {
      const lower = key.toLowerCase();
      for (const forbidden of FORBIDDEN_EXPORT_SUBSTRINGS) {
        expect(lower.includes(forbidden)).toBe(false);
      }
    }
  });
});

describe("transport token is confined to the transport client", () => {
  it("guard and state modules never reference a token", () => {
    for (const file of ["authoringResponseGuard.ts", "authoringState.ts"]) {
      const source = readFileSync(join(LIB, file), "utf-8").toLowerCase();
      expect(source.includes("token")).toBe(false);
    }
  });

  it("the token header lives only in the client", () => {
    expect(clientMod.TRANSPORT_TOKEN_HEADER).toBe(
      "X-Counterpedia-Transport-Token",
    );
    expect("TRANSPORT_TOKEN_HEADER" in guardMod).toBe(false);
    expect("TRANSPORT_TOKEN_HEADER" in stateMod).toBe(false);
  });
});
