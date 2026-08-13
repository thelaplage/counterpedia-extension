/**
 * Acquisition-dev manifest separation.
 *
 * The localhost acquisition host permission (127.0.0.1:8787) lives ONLY in the
 * dedicated acquisition-dev manifest. Production stays clean (the locked
 * manifestAudit tests require manifest.json to carry no host_permissions and no
 * 127.0.0.1), and the demo manifest stays exactly its 4317 permission.
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
  _acquisition_dev?: boolean;
  _privacy_audit?: Record<string, unknown>;
}

let acq: Manifest;

beforeAll(() => {
  acq = JSON.parse(
    readFileSync(join(__dirname, "../manifest.acquisition-dev.json"), "utf-8"),
  ) as Manifest;
});

describe("manifest.acquisition-dev.json", () => {
  it("scopes host_permissions to the loopback acquisition port only", () => {
    expect(acq.host_permissions).toEqual(["http://127.0.0.1:8787/*"]);
    expect(acq.host_permissions).not.toContain("<all_urls>");
    expect(acq.host_permissions).not.toContain("*://*/*");
  });

  it("keeps the same minimal permission set as production", () => {
    expect([...(acq.permissions ?? [])].sort()).toEqual(
      ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"].sort(),
    );
  });

  it("marks itself acquisition-dev; production never does", () => {
    expect(acq._acquisition_dev).toBe(true);
    const prod = JSON.parse(
      readFileSync(join(__dirname, "../manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(prod["_acquisition_dev"]).toBeUndefined();
  });

  it("carries a privacy audit: no passive capture, no broad host, token is transport-auth only", () => {
    const audit = acq._privacy_audit ?? {};
    expect(audit["passive_capture"]).toBe(false);
    expect(audit["all_urls_permission"]).toBe(false);
    expect(audit["transport_token_is_transport_auth_only"]).toBe(true);
  });

  it("does not leak the acquisition host into the production manifest", () => {
    const prodText = readFileSync(
      join(__dirname, "../manifest.json"),
      "utf-8",
    );
    expect(prodText).not.toContain("8787");
    expect(prodText).not.toContain("127.0.0.1");
  });

  it("is distinct from both the production and demo manifests", () => {
    const acqText = readFileSync(
      join(__dirname, "../manifest.acquisition-dev.json"),
      "utf-8",
    );
    const prodText = readFileSync(join(__dirname, "../manifest.json"), "utf-8");
    const demoText = readFileSync(
      join(__dirname, "../manifest.demo.json"),
      "utf-8",
    );
    expect(acqText).not.toBe(prodText);
    expect(acqText).not.toBe(demoText);
  });
});
