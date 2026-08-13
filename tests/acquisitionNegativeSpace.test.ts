/**
 * Negative-space audit for the ACQ1-HTTP extension client (lane firewall).
 *
 * Proves the acquisition client/guard/state modules neither import nor expose any
 * governance-lane machinery (admission / ClaimSupportEdge promotion / publication
 * / support_type / governance_state), and that the transport token is confined to
 * the transport client.
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

import * as clientMod from "../src/lib/acquisitionClient";
import * as guardMod from "../src/lib/acquisitionResponseGuard";
import * as stateMod from "../src/lib/acquisitionState";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../src/lib");

const MODULE_FILES = [
  "acquisitionClient.ts",
  "acquisitionResponseGuard.ts",
  "acquisitionState.ts",
];

const FORBIDDEN_IMPORT_SUBSTRINGS = [
  "admission",
  "governance",
  "claim_support",
  "claimsupportedge",
  "promotion",
  "publish",
];

const FORBIDDEN_EXPORT_SUBSTRINGS = [
  "admit",
  "promote",
  "publish",
  "verif",
  "standing",
  "support_type",
  "governance",
  "claimsupportedge",
  "admission",
];

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]!);
  return specs;
}

describe("acquisition modules import no governance-lane module", () => {
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

describe("acquisition modules expose no governance-lane symbol", () => {
  it.each([
    ["acquisitionClient", clientMod],
    ["acquisitionResponseGuard", guardMod],
    ["acquisitionState", stateMod],
  ] as const)("%s exports are metadata-only", (_name, mod) => {
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
    for (const file of ["acquisitionResponseGuard.ts", "acquisitionState.ts"]) {
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
