import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PANEL = readFileSync(
  new URL("../src/panel/wikipediaFrontierCapture.ts", import.meta.url),
  "utf8",
);
const BUTTON = readFileSync(
  new URL("../src/panel/draftFromSourceButton.ts", import.meta.url),
  "utf8",
);

describe("Wikipedia captured-source -> authoring boundary", () => {
  it("Wikipedia capture only persists/selects a governed source; it never invokes authoring", () => {
    expect(PANEL).toContain('makeButton("Use for Draft from source")');
    expect(PANEL).toContain("persistGovernedSourceSelection(chrome.storage.local, result)");
    expect(PANEL).toContain("selectGovernedSource(result)");
    expect(PANEL).toContain("restoreGovernedSourceSelection(chrome.storage.local)");
    expect(PANEL).not.toContain("draftFromHeldCapture(");
    expect(PANEL).not.toContain("draftFromUrl(");
    expect(PANEL).not.toContain("/v0/draft-from-source");
    expect(PANEL).not.toContain("/v0/draft-from-url");
  });

  it("the existing single draft button remains held-capture-only with zero URL fallback", () => {
    expect(BUTTON).toContain("client.draftFromHeldCapture(");
    expect(BUTTON).not.toContain("client.draftFromUrl(");
    expect(BUTTON).toContain("getSelectedGovernedSource()");
    expect(BUTTON).toContain("subscribeGovernedSourceSelection(");
  });
});
