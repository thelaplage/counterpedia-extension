import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function readText(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

// Exact byte size of the checked-in 1x1-pixel placeholder PNGs. These are
// NOT real icon assets — see tests/authoringManifest.test.ts for the fuller
// explanation. They exist only so Chrome's unpacked-extension loader (which
// requires every referenced icon file to resolve) doesn't fail on the dev
// build. Real icon assets are pending.
const PLACEHOLDER_ICON_BYTES = 68;

describe("WIKIPEDIA-E2E0 closure invariants", () => {
  it("keeps the authoring-dev manifest loadable by Chrome", () => {
    const manifest = JSON.parse(readText("manifest.authoring-dev.json")) as {
      version: string;
      icons?: Record<string, string>;
      _three_acts?: string[];
    };

    // Chrome extension versions are one to four dot-separated integer parts.
    expect(manifest.version).toMatch(/^\d+(?:\.\d+){0,3}$/);

    // TEAM-UX0 keeps an `icons` key (unlike the removal in #16/#17) because
    // Counterpedia Local's double-click launcher needs a real app icon
    // surface; the checked-in PNGs are still 1x1 placeholders pending real
    // assets, so this pins the exact placeholder byte size rather than
    // merely asserting a nonzero size (which would trivially pass without
    // proving anything about the icon content).
    expect(manifest.icons).toBeDefined();
    for (const iconPath of Object.values(manifest.icons ?? {})) {
      expect(statSync(resolve(root, iconPath)).size).toBe(
        PLACEHOLDER_ICON_BYTES,
      );
    }

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
