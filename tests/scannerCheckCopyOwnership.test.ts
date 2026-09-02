import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("SCANNER-CHECK-CONVERGENCE1-B copy ownership", () => {
  it("never presents ordinary scanner matches as a completed local Check", () => {
    const inquiryPathsPanel = source("src/panel/inquiryPaths.ts");
    const inquiryPathsLib = source("src/lib/inquiryPaths.ts");
    const inquiryTrace = source("src/panel/inquiryTrace.ts");
    const researcherProfiles = source("src/panel/researcherProfiles.ts");

    expect(inquiryPathsPanel).toContain(
      "Choose how you want to explore these matches.",
    );
    expect(inquiryPathsPanel).not.toMatch(/explore this Check/);

    expect(inquiryPathsLib).toContain(
      "Matched records expose source material for this inquiry.",
    );
    expect(inquiryPathsLib).not.toMatch(/for this Check/);

    expect(inquiryTrace).toContain("Inquiry opened with");
    expect(inquiryTrace).not.toMatch(/\bCheck opened with\b/);

    expect(researcherProfiles).not.toMatch(/this Check/);
    expect(researcherProfiles).not.toMatch(/current Check/);
    expect(researcherProfiles).toContain("Use for this inquiry");
  });

  it("never labels browser recovery as a Check", () => {
    const html = source("src/panel/index.html");
    const recoveryButton = source("src/panel/recoveryButton.ts");
    const panel = source("src/panel/panel.ts");

    expect(html).toContain("Assess browser recovery");
    expect(html).not.toMatch(/Check browser recovery/);

    expect(recoveryButton).toContain("Assessing browser recovery…");
    expect(recoveryButton).not.toMatch(/Checking browser recovery/);
    expect(recoveryButton).not.toMatch(/"Check browser recovery"/);

    expect(panel).not.toMatch(/"Check browser recovery"/);
  });

  it("keeps PATHS and Researcher local routing free of canonical CHECK execution claims", () => {
    const inquiryPathsPanel = source("src/panel/inquiryPaths.ts");
    const inquiryPathsLib = source("src/lib/inquiryPaths.ts");
    const researcherProfiles = source("src/panel/researcherProfiles.ts");
    const researcherTeaching = source("src/panel/researcherTeaching.ts");

    for (const text of [
      inquiryPathsPanel,
      inquiryPathsLib,
      researcherProfiles,
      researcherTeaching,
    ]) {
      expect(text).not.toMatch(/\bCheckReceipt\b/);
      expect(text).not.toMatch(/\bCheckAttempt\b/);
      expect(text).not.toMatch(/\brun(s)?\s+Check\b/i);
      expect(text).not.toMatch(/\/check\/new/);
    }
  });

  it("keeps the canonical Open in Counterpedia CHECK handoff string present", () => {
    const html = source("src/panel/checkHandoff.ts");
    expect(html).toContain("Open in Counterpedia CHECK");
  });

  it("keeps scanner composition free of a local CHECK execution implementation", () => {
    const entry = source("src/panel/entry.ts");
    const directionalActionsPanel = source("src/panel/directionalActions.ts");
    const directionalActionsLib = source("src/lib/directionalActions.ts");

    // Lane A already unmounts the extension-owned Check-result anatomy; this
    // lane confirms the copy-only surfaces do not reintroduce a second CHECK
    // engine and that the only clickable directional action is KEEP.
    expect(entry).not.toContain("initCheckAnatomy");
    expect(directionalActionsPanel).not.toMatch(/\bfetch\s*\(/);
    expect(directionalActionsPanel).not.toMatch(/\bCheckReceipt\b/);
    expect(directionalActionsPanel).not.toMatch(/\bCheckAttempt\b/);
    expect(directionalActionsLib).not.toMatch(/\bCheckReceipt\b/);
    expect(directionalActionsLib).not.toMatch(/\bCheckAttempt\b/);
  });
});
