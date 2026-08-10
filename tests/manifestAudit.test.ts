/**
 * Manifest audit tests.
 * Validates the manifest.json against MV3 security requirements.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ManifestJson {
  manifest_version: number;
  name: string;
  version: string;
  permissions?: string[];
  host_permissions?: string[];
  content_security_policy?: {
    extension_pages?: string;
    sandbox?: string;
  };
  background?: {
    service_worker?: string;
    type?: string;
  };
  action?: Record<string, unknown>;
  side_panel?: Record<string, unknown>;
}

let manifest: ManifestJson;

beforeAll(() => {
  const manifestPath = join(__dirname, "../manifest.json");
  const raw = readFileSync(manifestPath, "utf-8");
  manifest = JSON.parse(raw) as ManifestJson;
});

describe("manifest.json", () => {
  it("has manifest_version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("has a non-empty name", () => {
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it("has a version string", () => {
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  describe("content_security_policy.extension_pages", () => {
    let csp: string;

    beforeAll(() => {
      csp = manifest.content_security_policy?.extension_pages ?? "";
    });

    it("contains 'self'", () => {
      expect(csp).toContain("'self'");
    });

    it("does not contain 'unsafe-eval'", () => {
      expect(csp).not.toContain("unsafe-eval");
    });

    it("does not contain 'eval'", () => {
      expect(csp).not.toContain("'eval'");
    });

    it("does not contain 'unsafe-inline'", () => {
      expect(csp).not.toContain("unsafe-inline");
    });

    it("does not contain remote URLs in script-src", () => {
      // Check that script-src doesn't have http/https remote origins
      const scriptSrcMatch = csp.match(/script-src([^;]*)/);
      if (scriptSrcMatch) {
        expect(scriptSrcMatch[1]).not.toMatch(/https?:\/\//);
      }
    });
  });

  describe("permissions", () => {
    it("permissions array exists", () => {
      expect(Array.isArray(manifest.permissions)).toBe(true);
    });

    it("contains only the declared minimal set", () => {
      const allowedPermissions = new Set([
        "sidePanel",
        "activeTab",
        "storage",
        "contextMenus",
        "scripting",  // CAP1: required for user-gesture executeScript; no host_permissions added
      ]);
      for (const perm of manifest.permissions ?? []) {
        expect(allowedPermissions.has(perm)).toBe(true);
      }
    });

    it("does not have host_permissions with <all_urls>", () => {
      const hostPerms = manifest.host_permissions ?? [];
      expect(hostPerms).not.toContain("<all_urls>");
      expect(hostPerms).not.toContain("*://*/*");
    });

    it("has no host_permissions at all (v0.1 requirement)", () => {
      expect(manifest.host_permissions).toBeUndefined();
    });
  });

  describe("background", () => {
    it("declares a service_worker (not scripts array)", () => {
      expect(typeof manifest.background?.service_worker).toBe("string");
    });

    it("has type: module", () => {
      expect(manifest.background?.type).toBe("module");
    });
  });
});

// ---------------------------------------------------------------------------
// EXT-BROWSER1: the source-workbench lane must NOT widen the PRODUCTION manifest.
// The deep-link handoff is plain navigation (a URL), so it requires no host
// permission. This pins that the production manifest permission set is exactly
// the pre-EXT-BROWSER1 set and that the demo host permission never leaks into it.
// ---------------------------------------------------------------------------

describe("manifest.json — EXT-BROWSER1 permission byte audit", () => {
  it("permission set is EXACTLY the pre-existing minimal set (no additions)", () => {
    const EXPECTED = ["sidePanel", "activeTab", "storage", "contextMenus", "scripting"];
    expect([...(manifest.permissions ?? [])].sort()).toEqual([...EXPECTED].sort());
  });

  it("declares no host_permissions and no <all_urls> in production", () => {
    expect(manifest.host_permissions).toBeUndefined();
    const asText = JSON.stringify(manifest);
    expect(asText).not.toContain("<all_urls>");
    expect(asText).not.toContain("127.0.0.1");
    expect(asText).not.toContain("_demo_mode");
  });
});

// ---------------------------------------------------------------------------
// Demo manifest separation: the loopback host permission lives ONLY in the demo
// manifest, and the two manifests never converge.
// ---------------------------------------------------------------------------

describe("manifest.demo.json — demo separation", () => {
  let demo: ManifestJson & {
    _demo_mode?: boolean;
    _demo_endpoint?: string;
    _privacy_audit?: Record<string, unknown>;
  };

  beforeAll(() => {
    const p = join(__dirname, "../manifest.demo.json");
    demo = JSON.parse(readFileSync(p, "utf-8"));
  });

  it("is a DISTINCT file from the production manifest (different bytes)", () => {
    const prodBytes = readFileSync(join(__dirname, "../manifest.json"), "utf-8");
    const demoBytes = readFileSync(join(__dirname, "../manifest.demo.json"), "utf-8");
    expect(demoBytes).not.toBe(prodBytes);
  });

  it("scopes host_permissions to loopback only — never <all_urls>", () => {
    const hosts = demo.host_permissions ?? [];
    expect(hosts).toEqual(["http://127.0.0.1:4317/*"]);
    expect(hosts).not.toContain("<all_urls>");
    expect(hosts).not.toContain("*://*/*");
  });

  it("marks itself demo mode; production never does", () => {
    expect(demo._demo_mode).toBe(true);
    expect((manifest as unknown as Record<string, unknown>)["_demo_mode"]).toBeUndefined();
  });

  it("carries a privacy audit asserting no passive capture / no broad host", () => {
    const audit = demo._privacy_audit ?? {};
    expect(audit["passive_capture"]).toBe(false);
    expect(audit["all_urls_permission"]).toBe(false);
    expect(audit["send_requires_explicit_click"]).toBe(true);
  });
});
