/**
 * RECOVERY-BIND0 (EXT) — response guard, client, generation guard, render.
 * Offline; no network, no browser, no Chrome APIs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  parseRecoveryAssessmentResult,
  RecoveryResponseError,
  type RecoveryOutcome,
} from "../src/lib/recoveryResponseGuard";
import { createHttpRecoveryClient } from "../src/lib/recoveryClient";
import { renderRecovery } from "../src/lib/recoveryRender";
import { runGuardedRecovery } from "../src/lib/recoveryNavGuard";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";

const SHA = "sha256:" + "a".repeat(64);
const SHB = "sha256:" + "b".repeat(64);

function bpc(): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture", spec_version: "v0.1",
    requested_url: "https://ex.test/a", current_url: "https://ex.test/a",
    canonical_url: "https://ex.test/a", document_title: "T", document_language: "en",
    meta_description: null, json_ld: [], selected_text: "",
    main_text: "rendered text", rendered_text: "", captured_at: "2026-08-18T00:00:00.000Z",
  } as BrowserPageCapture;
}

function assessed(outcome: RecoveryOutcome): Record<string, unknown> {
  const observation =
    outcome === "NOT_ELIGIBLE"
      ? {
          schema_version: "acquisition.capture_recovery.v0.1",
          baseline_capture_ref: "cap_1", baseline_exact_bytes_sha256: SHA,
          baseline_content_posture: "CONTENTFUL", eligibility: "NOT_ELIGIBLE",
          eligibility_reasons: ["baseline already has substantive payload"],
          browser_requested_url: "https://ex.test/a", browser_current_url: "https://ex.test/a",
          browser_canonical_url: "https://ex.test/a", browser_observation_sha256: SHB,
          browser_comparison: "NOT_EVALUATED", baseline_visible_word_count: 400,
          browser_visible_word_count: 0, recovery_outcome: "NOT_ELIGIBLE",
          signals: [], classifier: { id: "counterpedia.capture-quality", version: "0.1.3" },
          recovery_policy_version: "capture_recovery.v0.1",
        }
      : {
          schema_version: "acquisition.capture_recovery.v0.1",
          baseline_capture_ref: "cap_1", baseline_exact_bytes_sha256: SHA,
          baseline_content_posture: "LIKELY_LOADER", eligibility: "ELIGIBLE",
          eligibility_reasons: ["baseline posture LIKELY_LOADER is auto-recovery eligible"],
          browser_requested_url: "https://ex.test/a", browser_current_url: "https://ex.test/a",
          browser_canonical_url: "https://ex.test/a", browser_observation_sha256: SHB,
          browser_comparison: outcome === "RECOVERED" ? "SUBSTANTIALLY_MORE_CONTENT_RENDERED" : "SIMILAR_CONTENT",
          baseline_visible_word_count: 5, browser_visible_word_count: 800,
          recovery_outcome: outcome, signals: [],
          classifier: { id: "counterpedia.capture-quality", version: "0.1.3" },
          recovery_policy_version: "capture_recovery.v0.1",
        };
  return {
    tool: "acquisition.assess_browser_recovery",
    surface_schema: "acquisition.capture_recovery_surface.v0.1",
    assessment_status: "assessed", capture_ref: "cap_1",
    baseline_capture_receipt: { capture_id: "cap_1", exact_bytes_sha256: SHA },
    recovery_observation: observation, failure_detail: null,
  };
}

function statusOnly(status: string): Record<string, unknown> {
  return {
    tool: "acquisition.assess_browser_recovery",
    surface_schema: "acquisition.capture_recovery_surface.v0.1",
    assessment_status: status, capture_ref: "cap_1",
    baseline_capture_receipt: null, recovery_observation: null, failure_detail: "x",
  };
}

const CONFIG = { baseUrl: "http://127.0.0.1:8787", token: "tok" };
function okFetch(payload: unknown) {
  return async () => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;
}

describe("RECOVERY-BIND0 (ext)", () => {
  // 1
  it("strict validator parses a valid assessed RECOVERED", () => {
    const r = parseRecoveryAssessmentResult(assessed("RECOVERED"));
    expect(r.assessment_status).toBe("assessed");
    expect(r.recovery_observation?.recovery_outcome).toBe("RECOVERED");
  });
  // 2
  it("unknown response fields fail closed", () => {
    const bad = { ...assessed("RECOVERED"), sneaky: 1 };
    expect(() => parseRecoveryAssessmentResult(bad)).toThrow(RecoveryResponseError);
  });
  // 3
  it("malformed observation digest fails closed", () => {
    const bad = assessed("RECOVERED");
    (bad.recovery_observation as Record<string, unknown>).browser_observation_sha256 = "not-a-digest";
    expect(() => parseRecoveryAssessmentResult(bad)).toThrow(/browser_observation_sha256/);
  });
  // 4-7
  it.each(["RECOVERED", "STILL_NOT_OBSERVED", "AMBIGUOUS", "NOT_ELIGIBLE"] as RecoveryOutcome[])(
    "assessed %s renders correctly", (outcome) => {
      const render = renderRecovery(parseRecoveryAssessmentResult(assessed(outcome)));
      expect(render.outcome).toBe(outcome);
      expect(render.autoDraftFromSource).toBe(false);
      if (outcome === "RECOVERED") {
        expect(render.recoveryLine).toBe("RECOVERED");
        expect(render.browserObservationDigest).toBe(SHB);
        expect(render.httpArtifactDigest).toBe(SHA);
      }
    },
  );
  // 8
  it("held_capture_not_found stays explicit", () => {
    const r = parseRecoveryAssessmentResult(statusOnly("held_capture_not_found"));
    expect(r.assessment_status).toBe("held_capture_not_found");
    expect(renderRecovery(r).label).toBe("Held capture not found");
  });
  // 9
  it("held_capture_invalid stays explicit", () => {
    const r = parseRecoveryAssessmentResult(statusOnly("held_capture_invalid"));
    expect(r.assessment_status).toBe("held_capture_invalid");
    expect(renderRecovery(r).label).toBe("Held capture invalid");
  });
  // 10
  it("no recovery call without an existing capture_ref", async () => {
    const client = createHttpRecoveryClient(CONFIG, { fetchImpl: okFetch(assessed("RECOVERED")) as unknown as typeof fetch });
    expect(await client.assessRecovery("", bpc())).toEqual({ kind: "no_capture_ref" });
  });
  // 11
  it("reuses the explicit BPC producer artifact in the request envelope", async () => {
    let sentBody: unknown = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => assessed("RECOVERED") } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = createHttpRecoveryClient(CONFIG, { fetchImpl });
    const out = await client.assessRecovery("cap_1", bpc());
    expect(out.kind).toBe("assessed");
    expect((sentBody as Record<string, unknown>).capture_ref).toBe("cap_1");
    const bpcSent = (sentBody as { browser_page_capture: { artifact_type: string } }).browser_page_capture;
    expect(bpcSent.artifact_type).toBe("BrowserPageCapture");
  });
  // 12 / 13 navigation or CLEAR during request drops stale (same one counter bumps)
  it.each([[1, 2], [1, 5]])("stale generation (%i vs %i) drops the recovery result", async (token, live) => {
    let set = false;
    const out = await runGuardedRecovery({
      token, currentGeneration: () => live,
      assess: async () => ({ kind: "assessed", result: parseRecoveryAssessmentResult(assessed("RECOVERED")) }),
      setRecoveryStatus: () => { set = true; },
    });
    expect(out.projected).toBe(false);
    expect(out.render).toBeNull();
    expect(set).toBe(false);
  });
  // 14 newer supersedes older
  it("a current-generation recovery projects", async () => {
    let rendered: unknown = null;
    const out = await runGuardedRecovery({
      token: 7, currentGeneration: () => 7,
      assess: async () => ({ kind: "assessed", result: parseRecoveryAssessmentResult(assessed("RECOVERED")) }),
      setRecoveryStatus: (r) => { rendered = r; },
    });
    expect(out.projected).toBe(true);
    expect(out.render?.outcome).toBe("RECOVERED");
    expect(rendered).not.toBeNull();
  });
  // 15 stale failure cannot overwrite newer success
  it("a stale failed recovery is dropped (cannot overwrite newer state)", async () => {
    let set = false;
    const out = await runGuardedRecovery({
      token: 1, currentGeneration: () => 3,
      assess: async () => ({ kind: "transport_error", status: 500, detail: "boom" }),
      setRecoveryStatus: () => { set = true; },
    });
    expect(out.projected).toBe(false);
    expect(set).toBe(false);
  });
  // 16 recovery never auto-triggers Draft-from-source
  it.each(["RECOVERED", "STILL_NOT_OBSERVED", "AMBIGUOUS", "NOT_ELIGIBLE"] as RecoveryOutcome[])(
    "recovery never auto-enables Draft-from-source (%s)", (outcome) => {
      expect(renderRecovery(parseRecoveryAssessmentResult(assessed(outcome))).autoDraftFromSource).toBe(false);
    },
  );
  // 20 no authority movement
  it("rejects authority-bearing fields anywhere (AUTHORITY_MOVEMENT=0)", () => {
    const bad = assessed("RECOVERED");
    (bad.recovery_observation as Record<string, unknown>).admission = "yes";
    expect(() => parseRecoveryAssessmentResult(bad)).toThrow(/authority-bearing/);
  });
});

// 17-19 repo-integrity checks on the recovery lane + manifest
describe("RECOVERY-BIND0 (ext) lane hygiene", () => {
  const root = join(__dirname, "..");
  const laneFiles = ["recoveryResponseGuard.ts", "recoveryClient.ts", "recoveryRender.ts", "recoveryNavGuard.ts"]
    .map((f) => readFileSync(join(root, "src", "lib", f), "utf8")).join("\n");

  it("17: adds no new host permissions (manifest unchanged by this lane)", () => {
    const m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    // this lane must not have widened permissions; recovery reuses loopback fetch only.
    expect(Array.isArray(m.host_permissions ?? [])).toBe(true);
    expect(laneFiles).not.toMatch(/host_permissions|permissions\s*:/);
  });
  it("18: no pageCapture / MHTML / operator-snapshot use in the recovery lane", () => {
    expect(laneFiles).not.toMatch(/chrome\.pageCapture|saveAsMHTML|captureVisibleTab|MHTML|operatorSnapshot|OperatorBrowserSnapshot/i);
  });
  it("19: no browser automation / cookie / credential access in the recovery lane", () => {
    expect(laneFiles).not.toMatch(/chrome\.cookies|document\.cookie|credentials|puppeteer|playwright|webdriver|chrome\.debugger/i);
  });
});
