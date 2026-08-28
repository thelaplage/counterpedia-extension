/**
 * EXT-RECOVERY0-PANEL-WIRE1 — the "Check browser recovery" action wiring.
 * Offline; DOM/chrome-free (runRecoveryCheck is pure, injected deps).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi } from "vitest";

import { runRecoveryCheck, type RecoveryButtonDeps } from "../src/panel/recoveryButton";
import type { CaptureResponse } from "../src/panel/captureButton";
import { parseRecoveryAssessmentResult } from "../src/lib/recoveryResponseGuard";
import type { RecoveryClientResult } from "../src/lib/recoveryClient";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";
import type { RecoveryRender } from "../src/lib/recoveryRender";

const SHA = "sha256:" + "a".repeat(64);
const SHB = "sha256:" + "b".repeat(64);

function bpc(): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture", spec_version: "v0.1",
    requested_url: "https://ex.test/a", current_url: "https://ex.test/a",
    canonical_url: "https://ex.test/a", document_title: "T", document_language: "en",
    meta_description: null, json_ld: [], selected_text: "",
    main_text: "rendered", rendered_text: "", captured_at: "2026-08-18T00:00:00.000Z",
  } as BrowserPageCapture;
}
function okCapture(): CaptureResponse { return { type: "PAGE_CAPTURE_RESULT", capture: bpc() }; }

function assessedResult(outcome: string): RecoveryClientResult {
  const obs = {
    schema_version: "acquisition.capture_recovery.v0.1", baseline_capture_ref: "cap_1",
    baseline_exact_bytes_sha256: SHA, baseline_content_posture: outcome === "NOT_ELIGIBLE" ? "CONTENTFUL" : "LIKELY_LOADER",
    eligibility: outcome === "NOT_ELIGIBLE" ? "NOT_ELIGIBLE" : "ELIGIBLE", eligibility_reasons: [],
    browser_requested_url: "https://ex.test/a", browser_current_url: "https://ex.test/a",
    browser_canonical_url: "https://ex.test/a", browser_observation_sha256: SHB,
    browser_comparison: outcome === "RECOVERED" ? "SUBSTANTIALLY_MORE_CONTENT_RENDERED" : "SIMILAR_CONTENT",
    baseline_visible_word_count: 5, browser_visible_word_count: 800, recovery_outcome: outcome,
    signals: [], classifier: { id: "counterpedia.capture-quality", version: "0.1.3" },
    recovery_policy_version: "capture_recovery.v0.1",
  };
  return { kind: "assessed", result: parseRecoveryAssessmentResult({
    tool: "acquisition.assess_browser_recovery", surface_schema: "acquisition.capture_recovery_surface.v0.1",
    assessment_status: "assessed", capture_ref: "cap_1",
    baseline_capture_receipt: { capture_id: "cap_1" }, recovery_observation: obs, failure_detail: null }) };
}
function statusResult(status: string): RecoveryClientResult {
  return { kind: "assessed", result: parseRecoveryAssessmentResult({
    tool: "acquisition.assess_browser_recovery", surface_schema: "acquisition.capture_recovery_surface.v0.1",
    assessment_status: status, capture_ref: "cap_1",
    baseline_capture_receipt: null, recovery_observation: null, failure_detail: "x" }) };
}

function gen(start = 0) {
  let g = start;
  return { current: () => g, invalidate: () => ++g, bump: () => ++g };
}

function harness(over: Partial<RecoveryButtonDeps> = {}) {
  const renders: (RecoveryRender | null)[] = [];
  const texts: string[] = [];
  const assessRecovery = vi.fn(async (_ref: string, _b: BrowserPageCapture) => assessedResult("RECOVERED"));
  const requestBrowserCapture = vi.fn(async (_m: { type: "CAPTURE_PAGE" }) => okCapture() as CaptureResponse | undefined);
  const deps: RecoveryButtonDeps = {
    button: { disabled: false, addEventListener: () => {} },
    getCaptureRef: () => "cap_1",
    requestBrowserCapture,
    assessRecovery,
    generation: gen(0),
    setRecoveryStatus: (r) => renders.push(r),
    setStatusText: (t) => texts.push(t),
    ...over,
  };
  return { deps, renders, texts, assessRecovery, requestBrowserCapture };
}

describe("recovery panel wiring", () => {
  it("1: no capture_ref -> no CAPTURE_PAGE and no recovery client call", async () => {
    const h = harness({ getCaptureRef: () => null });
    await runRecoveryCheck(h.deps);
    expect(h.requestBrowserCapture).not.toHaveBeenCalled();
    expect(h.assessRecovery).not.toHaveBeenCalled();
  });
  it("2/3: with a held capture, click obtains a fresh BPC via CAPTURE_PAGE", async () => {
    const h = harness();
    await runRecoveryCheck(h.deps);
    expect(h.requestBrowserCapture).toHaveBeenCalledWith({ type: "CAPTURE_PAGE" });
  });
  it("4: exact capture_ref forwarded unchanged", async () => {
    const h = harness({ getCaptureRef: () => "cap_exact_123" });
    await runRecoveryCheck(h.deps);
    expect(h.assessRecovery).toHaveBeenCalledWith("cap_exact_123", expect.objectContaining({ artifact_type: "BrowserPageCapture" }));
  });
  it("5: RECOVERED renders both digest namespaces distinctly", async () => {
    const h = harness({ assessRecovery: vi.fn(async () => assessedResult("RECOVERED")) });
    await runRecoveryCheck(h.deps);
    const r = h.renders.at(-1)!;
    expect(r.outcome).toBe("RECOVERED");
    expect(r.httpArtifactDigest).toBe(SHA);
    expect(r.browserObservationDigest).toBe(SHB);
    expect(r.httpArtifactDigest).not.toBe(r.browserObservationDigest);
  });
  it.each(["STILL_NOT_OBSERVED", "AMBIGUOUS", "NOT_ELIGIBLE"])("6-8: %s renders", async (outcome) => {
    const h = harness({ assessRecovery: vi.fn(async () => assessedResult(outcome)) });
    await runRecoveryCheck(h.deps);
    expect(h.renders.at(-1)!.outcome).toBe(outcome);
  });
  it.each([["held_capture_not_found", "Held capture not found"], ["held_capture_invalid", "Held capture invalid"]])(
    "9-10: %s renders explicit state", async (status, label) => {
      const h = harness({ assessRecovery: vi.fn(async () => statusResult(status)) });
      await runRecoveryCheck(h.deps);
      expect(h.renders.at(-1)!.label).toBe(label);
    });
  it("11: browser capture failure -> no recovery HTTP call", async () => {
    const h = harness({ requestBrowserCapture: vi.fn(async () => ({ type: "PAGE_CAPTURE_ERROR", reason: "restricted" } as CaptureResponse)) });
    await runRecoveryCheck(h.deps);
    expect(h.assessRecovery).not.toHaveBeenCalled();
  });
  it("12/14: navigation/CLEAR while BPC in flight -> dropped, no recovery call", async () => {
    const g = gen(0);
    const h = harness({ generation: g, requestBrowserCapture: vi.fn(async () => { g.bump(); return okCapture(); }) });
    await runRecoveryCheck(h.deps);
    expect(h.assessRecovery).not.toHaveBeenCalled();
    expect(h.renders.length).toBe(0);
  });
  it("13: navigation while recovery HTTP in flight -> dropped", async () => {
    const g = gen(0);
    const h = harness({ generation: g, assessRecovery: vi.fn(async () => { g.bump(); return assessedResult("RECOVERED"); }) });
    await runRecoveryCheck(h.deps);
    expect(h.renders.length).toBe(0);
  });
  it("15: a newer recovery supersedes an older in-flight one", async () => {
    const g = gen(0);
    // older run: its token becomes stale once a newer run invalidates.
    const older = harness({ generation: g, assessRecovery: vi.fn(async () => { g.invalidate(); return assessedResult("RECOVERED"); }) });
    await runRecoveryCheck(older.deps);
    expect(older.renders.length).toBe(0); // dropped: superseded
  });
  it("16: a stale failure cannot overwrite (is dropped)", async () => {
    const g = gen(0);
    const h = harness({ generation: g, assessRecovery: vi.fn(async () => { g.bump(); return { kind: "transport_error", status: 500, detail: "x" } as RecoveryClientResult; }) });
    await runRecoveryCheck(h.deps);
    expect(h.renders.length).toBe(0);
  });
  it("17: recovery never mutates the held capture_ref (read-only getter)", async () => {
    const holder = { ref: "cap_1" as string | null };
    const h = harness({ getCaptureRef: () => holder.ref });
    await runRecoveryCheck(h.deps);
    expect(holder.ref).toBe("cap_1"); // unchanged
  });
  it("18/21: render never auto-drafts and uses no authority language", async () => {
    const h = harness();
    await runRecoveryCheck(h.deps);
    const r = h.renders.at(-1)!;
    expect(r.autoDraftFromSource).toBe(false);
    for (const w of ["verified", "authoritative", "trusted", "admitted"]) {
      expect(r.recoveryLine.toLowerCase()).not.toContain(w);
    }
  });
});

describe("recovery panel lane hygiene", () => {
  const root = join(__dirname, "..");
  const src = readFileSync(join(root, "src", "panel", "recoveryButton.ts"), "utf8");
  it("19: no chrome.pageCapture / MHTML / operator-snapshot route", () => {
    expect(src).not.toMatch(/chrome\.pageCapture|saveAsMHTML|captureVisibleTab|operatorSnapshotClient|OperatorBrowserSnapshot/);
  });
  it("20: adds no new extension permissions", () => {
    expect(src).not.toMatch(/host_permissions|permissions\s*:/);
  });
  it("18b: never references Draft-from-source / authoring / capture_url / process_source", () => {
    expect(src).not.toMatch(/draftFromSource|draftFromUrl|process_source|capture_url|authoring/i);
  });
});
