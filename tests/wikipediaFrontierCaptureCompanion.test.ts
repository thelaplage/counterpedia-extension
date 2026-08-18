import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("../tools/counterpedia-local/counterpedia_local.py", import.meta.url),
  "utf8",
);

describe("Counterpedia Local explicit discovered-source capture", () => {
  it("delegates to the producer-owned URL capture command, never fake BPC", () => {
    expect(SOURCE).toContain('"counterpedia-capture-url"');
    expect(SOURCE).toContain('if self.path == "/v0/capture-url"');
    expect(SOURCE).toContain('payload.get("tool") != "acquisition.capture_url"');
    expect(SOURCE).toContain(
      'payload.get("surface_schema") != "acquisition.mcp_surface.v0.1"',
    );
    expect(SOURCE).not.toContain('"browser_page_capture": {"requested_url"');
  });

  it("requires the currently paired extension origin before capture execution", () => {
    const route = SOURCE.slice(SOURCE.indexOf('if self.path == "/v0/capture-url"'));
    expect(route).toContain("if not self.supervisor.is_paired_extension(origin_id):");
    expect(route).toContain('"paired_extension_origin_required"');
  });

  it("fails closed on producer authority or capture identity widening", () => {
    expect(SOURCE).toContain("contains_forbidden_authority(payload)");
    expect(SOURCE).toContain('payload.get("source_locator") != url');
    expect(SOURCE).toContain('payload.get("capture_id") != receipt.get("capture_id")');
    expect(SOURCE).toContain('receipt.get("source_locator") != url');
    expect(SOURCE).toContain('capture_failed producer result carried a receipt/address');
  });
});
