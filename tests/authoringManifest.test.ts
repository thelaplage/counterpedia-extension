/** Draft-from-source dev manifest separation + canonical reader projection. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_ICON_BYTES = 68;
const __dirname = dirname(fileURLToPath(import.meta.url));

interface Manifest {
  name: string;
  version: string;
  host_permissions?: string[];
  permissions?: string[];
  icons?: Record<string, string>;
  _authoring_dev?: boolean;
  _acquisition_dev?: boolean;
  _counterpedia_reader_dev?: boolean;
  _counterpedia_reader_endpoint?: string;
  _privacy_audit?: Record<string, unknown>;
}

function read(name: string): string {
  return readFileSync(join(__dirname, "..", name), "utf-8");
}

let auth: Manifest;

beforeAll(() => {
  auth = JSON.parse(read("manifest.authoring-dev.json")) as Manifest;
});

describe("manifest.authoring-dev.json", () => {
  it("uses a Chrome-valid numeric version", () => {
    expect(auth.version).toMatch(/^\d+(?:\.\d+){0,3}$/);
  });

  it("references the known placeholder icon files", () => {
    expect(auth.icons).toBeDefined();
    const icons = auth.icons ?? {};
    expect(Object.keys(icons).sort()).toEqual(["128", "16", "48"]);
    for (const iconPath of Object.values(icons)) {
      expect(statSync(join(__dirname, "..", iconPath)).size).toBe(PLACEHOLDER_ICON_BYTES);
    }
  });

  it("scopes host_permissions to exactly four loopback services", () => {
    expect(auth.host_permissions).toEqual([
      "http://127.0.0.1:8787/*",
      "http://127.0.0.1:8788/*",
      "http://127.0.0.1:8790/*",
      "http://127.0.0.1:3000/*",
    ]);
    expect(auth.host_permissions).not.toContain("<all_urls>");
    expect(auth.host_permissions).not.toContain("*://*/*");
  });

  it("declares the Counterpedia reader projection only in the authoring-dev profile", () => {
    expect(auth._counterpedia_reader_dev).toBe(true);
    expect(auth._counterpedia_reader_endpoint).toBe(
      "http://127.0.0.1:3000/api/counterpedia/reader/proposal",
    );
    const prodText = read("manifest.json");
    expect(prodText).not.toContain("3000");
    expect(prodText).not.toContain("_counterpedia_reader_dev");
  });

  it("keeps production's minimal permission set plus only pageCapture", () => {
    const PRODUCTION_PERMISSIONS = [
      "activeTab",
      "contextMenus",
      "scripting",
      "sidePanel",
      "storage",
    ];
    expect([...(auth.permissions ?? [])].sort()).toEqual(
      [...PRODUCTION_PERMISSIONS, "pageCapture"].sort(),
    );
    const prod = JSON.parse(read("manifest.json")) as Manifest;
    expect(prod.permissions ?? []).not.toContain("pageCapture");
  });

  it("pins the explicit-click/non-authority privacy posture", () => {
    const audit = auth._privacy_audit ?? {};
    expect(audit["passive_capture"]).toBe(false);
    expect(audit["all_urls_permission"]).toBe(false);
    expect(audit["draft_requires_separate_explicit_click"]).toBe(true);
    expect(audit["draft_is_proposal_only_never_admission"]).toBe(true);
    expect(audit["reader_projection_is_post_authoring_only"]).toBe(true);
    expect(audit["counterpedia_reader_host_permission"]).toBe(
      "http://127.0.0.1:3000/* only",
    );
  });

  it("does not leak any dev loopback into production", () => {
    const prodText = read("manifest.json");
    expect(prodText).not.toContain("127.0.0.1");
    expect(prodText).not.toContain("8788");
    expect(prodText).not.toContain("3000");
  });

  it("is distinct from production, demo, and acquisition-dev manifests", () => {
    const authText = read("manifest.authoring-dev.json");
    expect(authText).not.toBe(read("manifest.json"));
    expect(authText).not.toBe(read("manifest.demo.json"));
    expect(authText).not.toBe(read("manifest.acquisition-dev.json"));
  });
});

describe("locked sibling manifests remain untouched", () => {
  it("production manifest still carries no host_permissions or loopback", () => {
    const prod = JSON.parse(read("manifest.json")) as Manifest;
    expect(prod.host_permissions).toBeUndefined();
    const text = read("manifest.json");
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("_authoring_dev");
    expect(text).not.toContain("_counterpedia_reader_dev");
  });

  it("acquisition-dev manifest still scopes to 8787 only", () => {
    const acq = JSON.parse(read("manifest.acquisition-dev.json")) as Manifest;
    expect(acq.host_permissions).toEqual(["http://127.0.0.1:8787/*"]);
  });

  it("demo manifest still scopes to 4317 only", () => {
    const demo = JSON.parse(read("manifest.demo.json")) as Manifest;
    expect(demo.host_permissions).toEqual(["http://127.0.0.1:4317/*"]);
  });
});
