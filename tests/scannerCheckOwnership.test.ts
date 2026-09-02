import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("SCANNER-CHECK-CONVERGENCE1-A", () => {
  it("mounts the canonical CHECK handoff but not the extension-owned Check-result anatomy", () => {
    const entry = source("src/panel/entry.ts");

    expect(entry).toContain('import { initCheckHandoff } from "./checkHandoff"');
    expect(entry).toContain("void initCheckHandoff();");
    expect(entry).not.toContain("initCheckAnatomy");
  });

  it("keeps the handoff navigation-only and free of a second CHECK engine", () => {
    const handoff = [
      source("src/lib/checkHandoff.ts"),
      source("src/panel/checkHandoff.ts"),
    ].join("\n");

    expect(handoff).not.toMatch(/\bfetch\s*\(/);
    expect(handoff).not.toMatch(/\bCheckReceipt\b/);
    expect(handoff).not.toMatch(/\bCheckAttempt\b/);
    expect(handoff).not.toMatch(/\bevaluateExactQuote\b/);
    expect(handoff).not.toMatch(/\bquoteIntegrity\b/);
    expect(handoff).not.toMatch(/\bsupportEvaluator\b/);
    expect(handoff).toContain("/check/new");
  });

  it("preserves the old anatomy module as dormant code rather than deleting governed record fields", () => {
    const anatomy = source("src/panel/checkAnatomy.ts");
    expect(anatomy).toContain("projectRecordAnatomy");
    expect(anatomy).toContain("Best supported formulation");
  });
});
