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
