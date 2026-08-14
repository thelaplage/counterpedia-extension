/**
 * Draft-from-source button — no-fallback dispatch invariant (C0 CORRECTION).
 *
 * The panel's single "Draft from source" button must call ONLY
 * `draftFromHeldCapture()` (the historical action, `/v0/draft-from-source`).
 * `draftFromUrl()` (`/v0/draft-from-url`) is a separate, legitimate,
 * explicit new-observation action that must NEVER be reachable from this
 * button — not when `capture_id` is present, not when it is absent, and not
 * as a retry/fallback after the historical action refuses or fails.
 *
 * These are permanent guards pinning that invariant at the actual dispatch
 * logic panel.ts wires to the button (draftFromSourceButton.ts), mirroring
 * the captureButton.test.ts harness pattern (a fake button double + an
 * injected dependency object, no real DOM).
 */

import { describe, it, expect, vi } from "vitest";

import {
  runDraftFromSource,
  wireDraftFromSourceButton,
  type DraftFromSourceButtonLike,
} from "../src/panel/draftFromSourceButton";
import {
  createHttpAuthoringClient,
  type AuthoringClient,
  type OperatorDraftMaterial,
  type AuthoringClientResult,
} from "../src/lib/authoringClient";
import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";
import type { AuthoringRender } from "../src/lib/authoringState";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_URL = "http://127.0.0.1:9/page";

function material(): OperatorDraftMaterial {
  return {
    subjectSeed: "Portland Head Light",
    operatorObjective: "Produce a bounded proposal describing Portland Head Light.",
    candidateId: "operator-governed-source-1",
    claims: [
      {
        claim_id: "claim-operator-1",
        claim_text: "The subject is known as Portland Head Light.",
        supports: [{ evidence_refs: ["evidence:E001"] }],
        contradicts: [],
      },
    ],
    coverageRequirements: [
      { requirement_id: "req-core", label: "Core", description: "d" },
    ],
    coverageAssessments: [
      {
        requirement_id: "req-core",
        state: "sufficient_candidate_support",
        supporting_claim_ids: ["claim-operator-1"],
        conflicting_claim_ids: [],
      },
    ],
    recipe: {
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    },
    depth: "brief",
  };
}

function heldCaptureResult(): AcquisitionCaptureResult {
  return {
    tool: "capture_url",
    surface_schema: "acquisition.capture_url.v0.1",
    capture_status: "captured",
    capture_id: "cap-real-id",
    source_id: "src-real-id",
    source_locator: SOURCE_URL,
    captured_object_address: "sha256:" + "a".repeat(64),
    byte_count: 1234,
    failure_detail: null,
    capture_receipt: { exact_bytes_sha256: "sha256:" + "b".repeat(64) },
  };
}

/** A captured acquisition result WITHOUT a capture_id (the fallback trigger case). */
function noCaptureIdResult(): AcquisitionCaptureResult {
  return { ...heldCaptureResult(), capture_id: null };
}

/** Fake button double — records click listeners; click() fires them once. */
class FakeButton implements DraftFromSourceButtonLike {
  private listeners: Array<() => void> = [];
  addEventListener(type: "click", listener: () => void): void {
    if (type === "click") this.listeners.push(listener);
  }
  click(): void {
    for (const l of this.listeners) l();
  }
}

/** A mock AuthoringClient recording calls to each action separately. */
function mockClient(
  heldCaptureImpl: () => Promise<AuthoringClientResult>,
): { client: AuthoringClient; draftFromUrl: ReturnType<typeof vi.fn>; draftFromHeldCapture: ReturnType<typeof vi.fn> } {
  const draftFromUrl = vi.fn(async (): Promise<AuthoringClientResult> => {
    throw new Error("draftFromUrl must never be called from the panel button");
  });
  const draftFromHeldCapture = vi.fn(heldCaptureImpl);
  return {
    client: { kind: "http", draftFromUrl, draftFromHeldCapture },
    draftFromUrl,
    draftFromHeldCapture,
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// 1. Held capture WITH a real capture_id -> exactly one call to
//    draftFromHeldCapture (the /v0/draft-from-source path), zero calls to
//    the URL-action path.
// ---------------------------------------------------------------------------

describe("draft-from-source button — held capture dispatches to the historical action only", () => {
  it("calls draftFromHeldCapture exactly once and draftFromUrl zero times", async () => {
    const { client, draftFromUrl, draftFromHeldCapture } = mockClient(async () => ({
      kind: "assembled",
      handoff: {
        handoff_digest: "sha256:" + "c".repeat(64),
        draft_proposal: { lifecycle: "draft" },
      } as unknown as import("../src/lib/authoringResponseGuard").AuthoringHandoff,
    }));
    const source = heldCaptureResult();
    const statuses: AuthoringRender[] = [];

    await runDraftFromSource({
      button: new FakeButton(),
      setStatus: (r) => statuses.push(r),
      getGovernedSource: () => source,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    expect(draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(draftFromHeldCapture).toHaveBeenCalledWith(source, material());
    expect(draftFromUrl).toHaveBeenCalledTimes(0);
    expect(statuses.some((s) => s.state === "PROPOSAL_ASSEMBLED")).toBe(true);
  });

  it("wires the click handler so a single button click issues exactly one draftFromHeldCapture call", async () => {
    const { client, draftFromUrl, draftFromHeldCapture } = mockClient(async () => ({
      kind: "assembled",
      handoff: {
        handoff_digest: "sha256:" + "d".repeat(64),
        draft_proposal: { lifecycle: "draft" },
      } as unknown as import("../src/lib/authoringResponseGuard").AuthoringHandoff,
    }));
    const source = heldCaptureResult();
    const button = new FakeButton();

    wireDraftFromSourceButton({
      button,
      setStatus: () => {},
      getGovernedSource: () => source,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    button.click();
    await flush();

    expect(draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(draftFromUrl).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// 2. A captured result WITHOUT capture_id -> the historical action refuses
//    (zero network calls, per authoringClient.ts's own guard), and
//    draftFromUrl() is NEVER invoked as a fallback. This is asserted both at
//    the mock-client dispatch level (draftFromUrl is never called) and at the
//    real HTTP client level (zero fetch calls total, to either endpoint).
// ---------------------------------------------------------------------------

describe("draft-from-source button — missing capture_id never falls back to the URL action", () => {
  it("dispatch: calls draftFromHeldCapture (which refuses), never calls draftFromUrl", async () => {
    const { client, draftFromUrl, draftFromHeldCapture } = mockClient(async () => ({
      kind: "invalid_source",
      detail: "acquisition result carries no capture_id",
    }));
    const source = noCaptureIdResult();
    const statuses: AuthoringRender[] = [];

    await runDraftFromSource({
      button: new FakeButton(),
      setStatus: (r) => statuses.push(r),
      getGovernedSource: () => source,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    expect(draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(draftFromUrl).toHaveBeenCalledTimes(0);
    // Terminal state is a refusal, not a silently-swallowed no-op.
    expect(statuses.some((s) => s.state === "DRAFT_FAILED")).toBe(true);
  });

  it("real HTTP client: zero authoring HTTP calls at all when capture_id is missing — /v0/draft-from-url is never invoked as a fallback", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("no HTTP call should ever be made in this scenario");
    });
    const client = createHttpAuthoringClient({
      config: { baseUrl: "http://127.0.0.1:9", token: "t" },
      fetchImpl: fetchImpl as unknown as Parameters<typeof createHttpAuthoringClient>[0]["fetchImpl"],
    });
    const source = noCaptureIdResult();
    const statuses: AuthoringRender[] = [];

    await runDraftFromSource({
      button: new FakeButton(),
      setStatus: (r) => statuses.push(r),
      getGovernedSource: () => source,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    // Zero calls to fetch at all — not to /v0/draft-from-source, and
    // definitely not to /v0/draft-from-url as a fallback.
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(statuses.some((s) => s.state === "DRAFT_FAILED")).toBe(true);
  });

  it("no governed source at all (capture_id absent because there is no capture) -> zero client calls, unavailable state", async () => {
    const { client, draftFromUrl, draftFromHeldCapture } = mockClient(async () => ({
      kind: "invalid_source",
      detail: "unreachable in this test",
    }));
    const statuses: AuthoringRender[] = [];

    await runDraftFromSource({
      button: new FakeButton(),
      setStatus: (r) => statuses.push(r),
      getGovernedSource: () => null,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    expect(draftFromHeldCapture).toHaveBeenCalledTimes(0);
    expect(draftFromUrl).toHaveBeenCalledTimes(0);
    expect(statuses.some((s) => s.state === "DRAFT_UNAVAILABLE")).toBe(true);
  });
});
