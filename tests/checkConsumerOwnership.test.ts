import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function gitBlobShaAtMain(path: string): string {
  return execFileSync("git", ["rev-parse", `origin/main:${path}`], { cwd: process.cwd() }).toString().trim();
}

function gitBlobShaOfWorkingFile(path: string): string {
  return execFileSync("git", ["hash-object", path], { cwd: process.cwd() }).toString().trim();
}

/**
 * EXT-CHECK-CONSUMER0 (R7) ownership boundary.
 *
 * Extends the existing SCANNER-CHECK-CONVERGENCE1 ownership-test pattern
 * (`tests/scannerCheckOwnership.test.ts`) to the new consumer surface: this
 * lane adds an in-panel CHECK CONSUMER, not a second CHECK evaluator, and it
 * does not touch the existing "Open in Counterpedia CHECK" navigation
 * handoff (#67, `checkHandoff.ts`) at all.
 */
describe("EXT-CHECK-CONSUMER0 ownership: consumer, not a second evaluator; #67 handoff untouched", () => {
  it("keeps checkHandoff.ts (lib + panel) byte-identical to origin/main — #67 is untouched by this lane", () => {
    expect(gitBlobShaOfWorkingFile("src/lib/checkHandoff.ts")).toBe(gitBlobShaAtMain("src/lib/checkHandoff.ts"));
    expect(gitBlobShaOfWorkingFile("src/panel/checkHandoff.ts")).toBe(gitBlobShaAtMain("src/panel/checkHandoff.ts"));
  });

  it("the new API consumer performs no scanner/acquisition harvesting or local persistence — read-only invoke+render only", () => {
    const apiConsumer = source("src/lib/checkApiConsumer.ts");
    const assessmentConsumer = source("src/lib/checkAssessmentConsumer.ts");
    for (const text of [apiConsumer, assessmentConsumer]) {
      expect(text).not.toMatch(/chrome\.storage\.(local|session)\.set/);
      expect(text).not.toMatch(/\bcaptureCitationSource\b/);
      expect(text).not.toMatch(/\battemptUrlCheckCapture\b/);
      expect(text).not.toMatch(/\bacquisitionCaptureBridge\b/);
      expect(text).not.toMatch(/\bacquisitionCaptureHttpExecutionPort\b/);
    }
  });

  it("the assessment recompute/consumer path never mints a receipt (no buildAssessmentReceipt* call) — it MINTS NOTHING", () => {
    const recompute = source("src/lib/assessmentReceiptRecompute.ts");
    const consumer = source("src/lib/checkAssessmentConsumer.ts");
    for (const text of [recompute, consumer]) {
      // Docstrings may reference the producer's mint function BY NAME to
      // explain what this module deliberately does not do; what must never
      // appear is an actual CALL to it.
      expect(text).not.toMatch(/\bbuildAssessmentReceipt\s*\(/);
      expect(text).not.toMatch(/\bbuildAssessmentReceiptFromAuditClaim\s*\(/);
    }
  });

  it("carries SupportState and CheckResultState as disjoint vocabularies — no mapping table anywhere in the new consumer surface", () => {
    const files = [
      "src/lib/checkResultContract.ts",
      "src/lib/checkApiConsumer.ts",
      "src/lib/checkApiRender.ts",
      "src/lib/checkAssessmentConsumer.ts",
      "src/lib/assessmentReceiptRecompute.ts",
      "src/panel/checkConsumer.ts",
    ].map(source);
    for (const text of files) {
      // No function/constant purporting to convert one vocabulary into the other.
      expect(text).not.toMatch(/supportStateTo(CheckResultState|Established|NotEstablished)/i);
      expect(text).not.toMatch(/checkResultStateToSupportState/i);
      expect(text).not.toMatch(/mapSupportState/i);
    }
  });

  it("the consumer surface imports no evaluator/oracle/comparator module from a producer repo", () => {
    const files = [
      "src/lib/checkApiConsumer.ts",
      "src/lib/checkAssessmentConsumer.ts",
      "src/lib/assessmentReceiptRecompute.ts",
      "src/panel/checkConsumer.ts",
    ].map(source);
    for (const text of files) {
      expect(text).not.toMatch(/assessment_oracle/);
      expect(text).not.toMatch(/wave1_assessment/);
      expect(text).not.toMatch(/\bassessor\.py\b/);
      expect(text).not.toMatch(/from ["']\.\.\/\.\.\/counterpedia/); // no cross-repo relative import
    }
  });

  it("entry.ts wires the new consumer additively alongside (not instead of) the existing handoff", () => {
    const entry = source("src/panel/entry.ts");
    expect(entry).toContain('import { initCheckHandoff } from "./checkHandoff"');
    expect(entry).toContain("void initCheckHandoff();");
    expect(entry).toContain('import { initCheckConsumer } from "./checkConsumer"');
    expect(entry).toContain("initCheckConsumer();");
  });

  it("keeps the canonical Open in Counterpedia CHECK handoff string present and reachable", () => {
    const panelHandoff = source("src/panel/checkHandoff.ts");
    expect(panelHandoff).toContain("Open in Counterpedia CHECK");
  });

  it("the new in-panel surface mounts alongside (never replaces) the existing handoff surface id", () => {
    const panelConsumer = source("src/panel/checkConsumer.ts");
    expect(panelConsumer).toContain('"counterpedia-check-handoff"');
    expect(panelConsumer).not.toContain('document.getElementById("counterpedia-check-handoff").remove');
  });
});
