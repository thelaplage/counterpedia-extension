import { afterEach, describe, expect, it, vi } from "vitest";

import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";
import {
  clearGovernedSourceSelection,
  getSelectedGovernedSource,
  selectGovernedSource,
} from "../src/lib/governedSourceSelection";
import type {
  AuthoringClient,
  AuthoringClientResult,
  OperatorDraftMaterial,
} from "../src/lib/authoringClient";
import {
  runDraftFromSource,
  wireDraftFromSourceButton,
  type DraftFromSourceButtonLike,
} from "../src/panel/draftFromSourceButton";
import type { AuthoringRender } from "../src/lib/authoringState";

const SOURCE_URL = "https://example.org/reference";

function captured(): AcquisitionCaptureResult {
  return {
    tool: "acquisition.capture_url",
    surface_schema: "acquisition.mcp_surface.v0.1",
    capture_status: "captured",
    capture_id: "cap_wiki_reference_1",
    source_id: "src_wiki_reference_1",
    source_locator: SOURCE_URL,
    captured_object_address: "sha256:" + "a".repeat(64),
    byte_count: 321,
    failure_detail: null,
    capture_receipt: {
      capture_id: "cap_wiki_reference_1",
      source_id: "src_wiki_reference_1",
      source_locator: SOURCE_URL,
      exact_bytes_sha256: "sha256:" + "a".repeat(64),
      byte_count: 321,
    },
  };
}

function material(): OperatorDraftMaterial {
  return {
    subjectSeed: "Example subject",
    operatorObjective: "Draft only from the selected historical source.",
    candidateId: "src:operator-governed-source",
    claims: [
      {
        claim_id: "claim-1",
        claim_text: "Operator-authored claim.",
        supports: [{ evidence_refs: ["evidence:E001"] }],
        contradicts: [],
      },
    ],
    coverageRequirements: [],
    coverageAssessments: [],
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

class FakeButton implements DraftFromSourceButtonLike {
  disabled = true;
  private listeners: Array<() => void> = [];

  addEventListener(type: "click", listener: () => void): void {
    if (type === "click") this.listeners.push(listener);
  }

  click(): void {
    if (this.disabled) return;
    for (const listener of this.listeners) listener();
  }
}

afterEach(() => {
  clearGovernedSourceSelection();
});

describe("governed source selection", () => {
  it("accepts only the real captured acquisition projection with receipt continuity", () => {
    const result = captured();
    expect(selectGovernedSource(result)).toBe(result);
    expect(getSelectedGovernedSource()).toBe(result);

    expect(() =>
      selectGovernedSource({ ...result, capture_status: "capture_failed" }),
    ).toThrow(/only captured results are selectable/);
    expect(() =>
      selectGovernedSource({ ...result, capture_id: "cap_other" }),
    ).toThrow(/capture_receipt\.capture_id must match capture_id/);
    expect(() =>
      selectGovernedSource({ ...result, source_locator: "https:\/\/example.org\/other" }),
    ).toThrow(/capture_receipt\.source_locator must match source_locator/);
    expect(() =>
      selectGovernedSource({ ...result, tool: "acquisition.process_source" }),
    ).toThrow(/tool must be acquisition\.capture_url/);
  });

  it("selection alone only makes the existing draft button ready; it does not draft", () => {
    const button = new FakeButton();
    const statuses: AuthoringRender[] = [];
    const draftFromHeldCapture = vi.fn();
    const draftFromUrl = vi.fn();

    wireDraftFromSourceButton({
      button,
      setStatus: (render) => statuses.push(render),
      getGovernedSource: () => null,
      readMaterial: () => material(),
      getClient: async () => ({
        kind: "http",
        draftFromHeldCapture,
        draftFromUrl,
      } as unknown as AuthoringClient),
    });

    selectGovernedSource(captured());

    expect(button.disabled).toBe(false);
    expect(statuses.some((status) => status.state === "DRAFT_READY")).toBe(true);
    expect(draftFromHeldCapture).toHaveBeenCalledTimes(0);
    expect(draftFromUrl).toHaveBeenCalledTimes(0);
  });

  it("uses the selected Wikipedia capture only through draftFromHeldCapture, never draftFromUrl", async () => {
    const source = captured();
    selectGovernedSource(source);

    const draftFromUrl = vi.fn(async () => {
      throw new Error("URL draft path must not be called");
    });
    const draftFromHeldCapture = vi.fn(
      async (): Promise<AuthoringClientResult> => ({
        kind: "invalid_source",
        detail: "bounded fixture refusal",
      }),
    );
    const client: AuthoringClient = {
      kind: "http",
      draftFromUrl,
      draftFromHeldCapture,
    };

    await runDraftFromSource({
      button: new FakeButton(),
      setStatus: () => {},
      getGovernedSource: () => null,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    expect(draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(draftFromHeldCapture).toHaveBeenCalledWith(source, material());
    expect(draftFromUrl).toHaveBeenCalledTimes(0);
  });

  it("keeps an active-page governed capture primary over the shared historical selection", async () => {
    const selected = captured();
    selectGovernedSource(selected);
    const activePage = {
      ...captured(),
      capture_id: "cap_active_page",
      source_locator: "https://example.org/active",
      capture_receipt: {
        ...captured().capture_receipt,
        capture_id: "cap_active_page",
        source_locator: "https://example.org/active",
      },
    };

    const draftFromHeldCapture = vi.fn(
      async (): Promise<AuthoringClientResult> => ({
        kind: "invalid_source",
        detail: "bounded fixture refusal",
      }),
    );
    const client: AuthoringClient = {
      kind: "http",
      draftFromUrl: vi.fn(),
      draftFromHeldCapture,
    };

    await runDraftFromSource({
      button: new FakeButton(),
      setStatus: () => {},
      getGovernedSource: () => activePage,
      readMaterial: () => material(),
      getClient: async () => client,
    });

    expect(draftFromHeldCapture).toHaveBeenCalledWith(activePage, material());
  });
});
