/**
 * Draft-from-source dev manifest separation.
 *
 * The authoring loopback host permission (127.0.0.1:8788) lives ONLY in the
 * dedicated draft-from-source dev manifest, alongside the acquisition loopback
 * (127.0.0.1:8787) it depends on — a draft is a third act over an
 * already-captured source, so the dev build needs both loopbacks. Production
 * stays clean (the locked manifestAudit tests require manifest.json to carry no
 * host_permissions and no 127.0.0.1), and the demo / acquisition-dev manifests
 * are untouched.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Manifest {
  name: string;
  version: string;
  host_permissions?: string[];
  permissions?: string[];
  icons?: Record<string, string>;
  _authoring_dev?: boolean;
  _acquisition_dev?: boolean;
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
  it("uses a Chrome-valid numeric version and does not reference empty icon placeholders", () => {
    expect(auth.version).toMatch(/^\d+(?:\.\d+){0,3}$/);
    expect(auth.icons).toBeUndefined();
  });

  it("scopes host_permissions to the two loopback ports only", () => {
    expect(auth.host_permissions).toEqual([
      "http://127.0.0.1:8787/*",
      "http://127.0.0.1:8788/*",
    ]);
    expect(auth.host_permissions).not.toContain("<all_urls>");
    expect(auth.host_permissions).not.toContain("*://*/*");
  });

  it("declares the authoring loopback (8788), the third-act endpoint", () => {
    expect(auth.host_permissions).toContain("http://127.0.0.1:8788/*");
  });

  it("keeps the same minimal permission set as production", () => {
    expect([...(auth.permissions ?? [])].sort()).toEqual(
      ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"].sort(),
    );
  });

  it("marks itself authoring-dev; production never does", () => {
    expect(auth._authoring_dev).toBe(true);
    const prod = JSON.parse(read("manifest.json")) as Record<string, unknown>;
    expect(prod["_authoring_dev"]).toBeUndefined();
  });

  it("carries a privacy audit: draft requires a separate explicit click and never admits", () => {
    const audit = auth._privacy_audit ?? {};
    expect(audit["passive_capture"]).toBe(false);
    expect(audit["all_urls_permission"]).toBe(false);
    expect(audit["draft_requires_separate_explicit_click"]).toBe(true);
    expect(audit["draft_is_proposal_only_never_admission"]).toBe(true);
    expect(audit["transport_token_is_transport_auth_only"]).toBe(true);
  });

  it("does not leak the authoring host into the production manifest", () => {
    const prodText = read("manifest.json");
    expect(prodText).not.toContain("8788");
    expect(prodText).not.toContain("127.0.0.1");
  });

  it("is distinct from the production, demo, and acquisition-dev manifests", () => {
    const authText = read("manifest.authoring-dev.json");
    expect(authText).not.toBe(read("manifest.json"));
    expect(authText).not.toBe(read("manifest.demo.json"));
    expect(authText).not.toBe(read("manifest.acquisition-dev.json"));
  });
});

describe("locked sibling manifests remain untouched", () => {
  it("production manifest still carries NO host_permissions and no loopback", () => {
    const prod = JSON.parse(read("manifest.json")) as Manifest;
    expect(prod.host_permissions).toBeUndefined();
    const text = read("manifest.json");
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("_authoring_dev");
    expect(text).not.toContain("_demo_mode");
  });

  it("acquisition-dev manifest still scopes to 8787 only (unchanged)", () => {
    const acq = JSON.parse(read("manifest.acquisition-dev.json")) as Manifest;
    expect(acq.host_permissions).toEqual(["http://127.0.0.1:8787/*"]);
    expect(acq.host_permissions).not.toContain("http://127.0.0.1:8788/*");
  });

  it("demo manifest still scopes to 4317 only (unchanged)", () => {
    const demo = JSON.parse(read("manifest.demo.json")) as Manifest;
    expect(demo.host_permissions).toEqual(["http://127.0.0.1:4317/*"]);
  });
});
