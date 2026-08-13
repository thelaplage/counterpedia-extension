import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function text(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("EXT-ACQ1 source-surface boundaries", () => {
  const html = text("../src/panel/index.html");
  const demoPanel = text("../src/panel/panel.demo.ts");
  const transport = text("../src/lib/acquisitionTransport.ts");
  const captureButton = text("../src/panel/captureButton.ts");
  const productionManifest = text("../manifest.json");

  it("names acquisition receipt, SRS nonrepresentation, and admission independently", () => {
    expect(html).toContain("Acquisition capture receipt: local token not configured");
    expect(html).toContain("SRS source-capture receipt: not represented");
    expect(html).toContain("Admission: not established");
  });

  it("never introduces a second CAPTURE_PAGE request in ACQ1 code", () => {
    expect(demoPanel).not.toContain('type: "CAPTURE_PAGE"');
    expect(transport).not.toContain('type: "CAPTURE_PAGE"');
    // The one existing capture producer remains captureButton.ts.
    expect(captureButton).toContain('sendMessage({ type: "CAPTURE_PAGE" })');
    expect(demoPanel).toContain("acquireBrowserPageCapture(capture");
  });

  it("stores the local transport token in session memory, never local storage", () => {
    expect(demoPanel).toContain("chrome.storage.session");
    expect(demoPanel).not.toContain("chrome.storage.local");
    expect(transport).toContain("ACQ1_TOKEN_SESSION_KEY");
    expect(html).toContain('type="password"');
  });

  it("keeps localhost acquisition permission out of production manifest", () => {
    expect(productionManifest).not.toContain("127.0.0.1:8787");
    expect(productionManifest).not.toContain("_acquisition_endpoint");
  });

  it("does not introduce admission/SRS authority into the transport client", () => {
    const executable = transport
      .split("export const ACQ1_DEFAULT_ENDPOINT", 2)[1]
      ?.toLowerCase() ?? "";
    // Documentation may name these as negatives; the result contracts themselves
    // must not expose authority fields or SRS objects.
    for (const forbiddenField of [
      "admission_decision",
      "standing:",
      "publishable:",
      "srs_receipt",
      "verification_result",
      "trust_score",
    ]) {
      expect(executable).not.toContain(forbiddenField);
    }
  });
});
