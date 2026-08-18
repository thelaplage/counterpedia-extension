import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("../tools/counterpedia-local/counterpedia_local.py", import.meta.url),
  "utf8",
);

describe("Counterpedia Local Wikipedia harvest proxy", () => {
  it("routes only through the merged ACQ-WIKI0 console producer", () => {
    expect(SOURCE).toContain('"counterpedia-wikipedia-harvest"');
    expect(SOURCE).toContain('if self.path == "/v0/wikipedia-harvest"');
    expect(SOURCE).toContain('payload.get("schema_version") != "acquisition.wikipedia_reference_manifest.v0.1"');
    expect(SOURCE).not.toContain("action=query");
    expect(SOURCE).not.toContain("/w/api.php");
  });

  it("requires the currently paired extension origin before producer execution", () => {
    expect(SOURCE).toContain("if not self.supervisor.is_paired_extension(origin_id):");
    expect(SOURCE).toContain('"paired_extension_origin_required"');
  });

  it("pins discovery-only negative authority assertions at the proxy boundary", () => {
    expect(SOURCE).toContain('boundary.get("wikipedia_support_inferred") is not False');
    expect(SOURCE).toContain('boundary.get("capture_receipts_emitted") is not False');
    expect(SOURCE).toContain('boundary.get("governed_declaration_bound") is not False');
    expect(SOURCE).toContain('boundary.get("srs_binding_state") != "unbound_discovery"');
  });
});
