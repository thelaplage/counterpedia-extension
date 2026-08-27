/**
 * ACQ1-HTTP navigation-generation guard — hostile invalidation tests.
 *
 * Invariant under test:
 *
 *     result may project  IFF  request-context-at-completion === current-page-context
 *
 * An acquisition request initiated for browser page A must NEVER populate visible
 * acquisition state (status line or the draft-gating governed source) after the
 * extension context has moved to page B, been CLEARed, or been superseded by a
 * newer capture. These tests drive the SAME pure runner + generation primitive
 * the panel uses (src/lib/acquisitionNavGuard.ts, wired in src/panel/panel.ts) —
 * no DOM, no Chrome.
 */

import { describe, it, expect } from "vitest";
import {
  createPageContextGeneration,
  runGuardedAcquisition,
} from "../src/lib/acquisitionNavGuard";
import type { AcquisitionRender } from "../src/lib/acquisitionState";
import type { AcquisitionClientResult } from "../src/lib/acquisitionClient";
import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";

// ---------------------------------------------------------------------------
// Fixtures — a page-A "captured" result and a page-B "captured" result, each
// carrying distinct capture facts so cross-projection is detectable.
// ---------------------------------------------------------------------------

const CAPTURED_A: AcquisitionCaptureResult = {
  tool: "browser_capture",
  surface_schema: "counterpedia.browser.v1",
  capture_status: "captured",
  capture_id: "cap:A-111",
  source_id: "src:A",
  source_locator: "https://example.com/page-A",
  captured_object_address: "sha256:aaaa1111",
  byte_count: 111,
  failure_detail: null,
  capture_receipt: null,
};

const CAPTURED_B: AcquisitionCaptureResult = {
  tool: "browser_capture",
  surface_schema: "counterpedia.browser.v1",
  capture_status: "captured",
  capture_id: "cap:B-222",
  source_id: "src:B",
  source_locator: "https://example.com/page-B",
  captured_object_address: "sha256:bbbb2222",
  byte_count: 222,
  failure_detail: null,
  capture_receipt: null,
};

const FAILED_A: AcquisitionCaptureResult = {
  tool: "browser_capture",
  surface_schema: "counterpedia.browser.v1",
  capture_status: "capture_failed",
  capture_id: null,
  source_id: "src:A",
  source_locator: "https://example.com/page-A",
  captured_object_address: null,
  byte_count: null,
  failure_detail: "producer failure",
  capture_receipt: null,
};

const resultCaptured = (r: AcquisitionCaptureResult): AcquisitionClientResult => ({
  kind: "captured",
  result: r,
});
const resultFailed = (r: AcquisitionCaptureResult): AcquisitionClientResult => ({
  kind: "capture_failed",
  result: r,
});

/** A capture() that resolves only when we tell it to — models an in-flight req. */
function deferredCapture(result: AcquisitionClientResult): {
  capture: () => Promise<AcquisitionClientResult>;
  resolve: () => void;
} {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    capture: async () => {
      await gate;
      return result;
    },
    resolve: release,
  };
}

/** Records status + governed-source writes, exactly like the panel's setters. */
function makeSink() {
  const statusWrites: Array<AcquisitionRender | null> = [];
  const sourceWrites: Array<AcquisitionCaptureResult | null> = [];
  return {
    statusWrites,
    sourceWrites,
    setStatus: (r: AcquisitionRender | null) => statusWrites.push(r),
    setGovernedSource: (r: AcquisitionCaptureResult | null) => sourceWrites.push(r),
    /** Everything ever projected as a status/source, flattened for assertions. */
    projectedText(): string {
      return JSON.stringify({ statusWrites, sourceWrites });
    },
  };
}

/** Assert NONE of page A's identifying facts appear anywhere projected. */
function assertNoLeakOfA(sink: ReturnType<typeof makeSink>): void {
  const blob = sink.projectedText();
  expect(blob).not.toContain(CAPTURED_A.capture_id);
  expect(blob).not.toContain(CAPTURED_A.source_locator);
  expect(blob).not.toContain(CAPTURED_A.captured_object_address);
  // No governed source from A was ever set (draft option never gated by A).
  expect(sink.sourceWrites).not.toContain(CAPTURED_A);
}

// ---------------------------------------------------------------------------
// Hostile 1: navigate A → B before A's response returns; A must not project.
// ---------------------------------------------------------------------------

describe("nav guard — stale cross-navigation response is dropped", () => {
  it("page-A response arriving after navigation to page B does NOT project", async () => {
    const gen = createPageContextGeneration();
    const sink = makeSink();
    const { capture, resolve } = deferredCapture(resultCaptured(CAPTURED_A));

    // Page A starts capture (request generation = N).
    const token = gen.invalidate();
    const run = runGuardedAcquisition({
      token,
      currentGeneration: () => gen.current(),
      capture,
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    // Navigation to page B (generation = N+1) BEFORE A's response returns.
    gen.invalidate();

    // Page-A response now returns.
    resolve();
    const outcome = await run;

    expect(outcome.projected).toBe(false);
    expect(outcome.governedSource).toBeNull();
    assertNoLeakOfA(sink);
    // Critically: no success/captured render was written after navigation.
    expect(sink.statusWrites).not.toContainEqual(
      expect.objectContaining({ state: "UNADMITTED" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Hostile 2: ordinary same-page capture still succeeds.
// ---------------------------------------------------------------------------

describe("nav guard — ordinary same-page capture still projects", () => {
  it("projects the captured result and gates the draft governed source", async () => {
    const gen = createPageContextGeneration();
    const sink = makeSink();

    const token = gen.invalidate();
    const outcome = await runGuardedAcquisition({
      token,
      currentGeneration: () => gen.current(),
      capture: async () => resultCaptured(CAPTURED_A),
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    expect(outcome.projected).toBe(true);
    expect(outcome.governedSource).toBe(CAPTURED_A);
    expect(sink.sourceWrites).toContain(CAPTURED_A);
    expect(sink.statusWrites).toContainEqual(
      expect.objectContaining({ state: "UNADMITTED" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Hostile 3: digest-equality behavior unchanged. The guard passes the guarded
// result through untouched; the projected captured_object_address is byte-equal.
// ---------------------------------------------------------------------------

describe("nav guard — digest/address behavior unchanged on the success path", () => {
  it("projects the exact captured_object_address without mutation", async () => {
    const gen = createPageContextGeneration();
    const sink = makeSink();

    const token = gen.invalidate();
    const outcome = await runGuardedAcquisition({
      token,
      currentGeneration: () => gen.current(),
      capture: async () => resultCaptured(CAPTURED_A),
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    // Identity + byte-equality of the address that flows to the UI/draft lane.
    expect(outcome.governedSource).toBe(CAPTURED_A);
    expect(outcome.governedSource?.captured_object_address).toBe(
      "sha256:aaaa1111",
    );
    const uNADMITTED = sink.statusWrites.find((r) => r?.state === "UNADMITTED");
    expect(uNADMITTED?.capturedObjectAddress).toBe("sha256:aaaa1111");
  });
});

// ---------------------------------------------------------------------------
// Hostile 4: a stale failed/refused response cannot overwrite newer state.
// ---------------------------------------------------------------------------

describe("nav guard — stale failure cannot overwrite newer state", () => {
  it("a page-A failure arriving after page-B is dropped, not projected", async () => {
    const gen = createPageContextGeneration();
    const sink = makeSink();
    const { capture, resolve } = deferredCapture(resultFailed(FAILED_A));

    const token = gen.invalidate();
    const run = runGuardedAcquisition({
      token,
      currentGeneration: () => gen.current(),
      capture,
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    // Context moves on (navigation / newer capture).
    gen.invalidate();
    resolve();
    const outcome = await run;

    expect(outcome.projected).toBe(false);
    // No ACQUISITION_FAILED status and no governed-source withdrawal were
    // written after the context moved on — newer state is left intact.
    expect(sink.statusWrites).not.toContainEqual(
      expect.objectContaining({ state: "ACQUISITION_FAILED" }),
    );
    expect(sink.sourceWrites).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hostile 5: CLEAR invalidates an in-flight result.
// ---------------------------------------------------------------------------

describe("nav guard — CLEAR invalidates in-flight acquisition", () => {
  it("a response arriving after CLEAR does not project", async () => {
    const gen = createPageContextGeneration();
    const sink = makeSink();
    const { capture, resolve } = deferredCapture(resultCaptured(CAPTURED_A));

    const token = gen.invalidate();
    const run = runGuardedAcquisition({
      token,
      currentGeneration: () => gen.current(),
      capture,
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    // CLEAR bumps the same generation counter (as the panel's CLEAR handler does).
    gen.invalidate();
    resolve();
    const outcome = await run;

    expect(outcome.projected).toBe(false);
    assertNoLeakOfA(sink);
  });
});

// ---------------------------------------------------------------------------
// Hostile 6: two overlapping captures — only the latest context may project.
// ---------------------------------------------------------------------------

describe("nav guard — overlapping captures, only the latest projects", () => {
  it("drops the earlier in-flight capture and projects only the newer one", async () => {
    const gen = createPageContextGeneration();
    const sink = makeSink();

    const a = deferredCapture(resultCaptured(CAPTURED_A));
    const b = deferredCapture(resultCaptured(CAPTURED_B));

    // Capture A starts (token N).
    const tokenA = gen.invalidate();
    const runA = runGuardedAcquisition({
      token: tokenA,
      currentGeneration: () => gen.current(),
      capture: a.capture,
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    // Capture B starts before A returns (token N+1 — supersedes A).
    const tokenB = gen.invalidate();
    const runB = runGuardedAcquisition({
      token: tokenB,
      currentGeneration: () => gen.current(),
      capture: b.capture,
      setStatus: sink.setStatus,
      setGovernedSource: sink.setGovernedSource,
    });

    // A returns first (out of order), then B.
    a.resolve();
    const outcomeA = await runA;
    b.resolve();
    const outcomeB = await runB;

    expect(outcomeA.projected).toBe(false);
    expect(outcomeB.projected).toBe(true);
    expect(outcomeB.governedSource).toBe(CAPTURED_B);

    // Only B's facts were ever set as a governed source; A never leaked.
    expect(sink.sourceWrites).toContain(CAPTURED_B);
    assertNoLeakOfA(sink);
  });
});

// ---------------------------------------------------------------------------
// Generation primitive — monotonic, single counter (no parallel lifecycle).
// ---------------------------------------------------------------------------

describe("page-context generation primitive", () => {
  it("is monotonic and returns the advanced value from invalidate()", () => {
    const gen = createPageContextGeneration();
    expect(gen.current()).toBe(0);
    expect(gen.invalidate()).toBe(1);
    expect(gen.current()).toBe(1);
    expect(gen.invalidate()).toBe(2);
    expect(gen.invalidate()).toBe(3);
    expect(gen.current()).toBe(3);
  });
});
