import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function readText(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("WIKIPEDIA-E2E0 closure invariants", () => {
  it("keeps the authoring-dev manifest loadable by Chrome", () => {
    const manifest = JSON.parse(readText("manifest.authoring-dev.json")) as {
      version: string;
      icons?: Record<string, string>;
      _three_acts?: string[];
    };

    // Chrome extension versions are one to four dot-separated integer parts.
    expect(manifest.version).toMatch(/^\d+(?:\.\d+){0,3}$/);

    // Final #16 deliberately solved Chrome loadability by eliminating the
    // broken icon references rather than supplying placeholder assets;
    // tests/authoringManifest.test.ts pins the same invariant.
    expect(manifest.icons).toBeUndefined();

    expect(manifest._three_acts?.join("\n")).toContain(
      "reprocess retained historical capture",
    );
  });

  it("tells the operator that Draft from source reuses retained bytes", () => {
    const panel = readText("src/panel/index.html");

    expect(panel).toContain("retained historical capture");
    expect(panel).toContain("does <strong>not</strong> fetch the source URL again");
    expect(panel).not.toContain(
      "The authoring producer re-fetches the source URL; this does not reuse the acquisition bytes.",
    );
  });

  it("keeps the ACQ transport secret session-only", () => {
    const client = readText("src/lib/acquisitionClient.ts");

    expect(client).toContain(
      'chrome.storage.session.get(["counterpedia_acquisition_token"])',
    );
    expect(client).toContain(
      'chrome.storage.sync.get(["counterpedia_acquisition_base_url"])',
    );
    expect(client).not.toContain(
      'chrome.storage.sync.get([\n      "counterpedia_acquisition_base_url",\n      "counterpedia_acquisition_token",',
    );
  });

  it("keeps the dedicated authoring-dev build target", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["build:authoring-dev"]).toBe(
      "npm run build && cp manifest.authoring-dev.json dist/manifest.json",
    );
  });
});
