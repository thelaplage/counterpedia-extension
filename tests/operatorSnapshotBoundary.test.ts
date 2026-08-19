import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const companion = readFileSync(
  new URL("../tools/counterpedia-local/counterpedia_local_operator.py", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.authoring-dev.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("OPERATOR-BROWSER0 boundary", () => {
  it("uses only the purpose-built pageCapture permission in team beta", () => {
    const permissions = manifest["permissions"] as string[];
    expect(permissions).toContain("pageCapture");
    expect(permissions).not.toContain("debugger");
    expect(permissions).not.toContain("webRequest");
    expect(permissions).not.toContain("webRequestBlocking");
  });

  it("delegates bytes to the distinct Acquisition snapshot producer", () => {
    expect(companion).toContain("counterpedia-ingest-operator-snapshot");
    expect(companion).toContain('/v0/operator-snapshot');
    expect(companion).toContain('producer_capture_registry_written');
    expect(companion).toContain('http_capture_receipt');
  });

  it("does not add anti-bot or debugger machinery", () => {
    expect(companion).not.toContain("captcha");
    expect(companion).not.toContain("stealth");
    expect(companion).not.toContain("chrome.debugger");
  });
});
