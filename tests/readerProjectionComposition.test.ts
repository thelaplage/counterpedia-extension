import { describe, expect, it, vi } from "vitest";

import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";
import type {
  AuthoringClient,
  AuthoringClientResult,
  OperatorDraftMaterial,
} from "../src/lib/authoringClient";
import type { AuthoringHandoff } from "../src/lib/authoringResponseGuard";
import type { AuthoringRender } from "../src/lib/authoringState";
import type { ProposalReaderEntry } from "../src/lib/entryReadModelClient";
import { runDraftFromSource } from "../src/panel/draftFromSourceButton";

function source(): AcquisitionCaptureResult {
  return {
    tool: "capture_url",
    surface_schema: "acquisition.capture_url.v0.1",
    capture_status: "captured",
    capture_id: "cap-1",
    source_id: "src-1",
    source_locator: "http://127.0.0.1:9/page",
    captured_object_address: "sha256:" + "a".repeat(64),
    byte_count: 100,
    failure_detail: null,
    capture_receipt: { exact_bytes_sha256: "sha256:" + "b".repeat(64) },
  };
}

function material(): OperatorDraftMaterial {
  return {
    subjectSeed: "Fixture",
    operatorObjective: "Produce a bounded proposal.",
    candidateId: "src:operator-governed-source",
    claims: [
      {
        claim_id: "claim-1",
        claim_text: "Fixture claim",
        supports: [{ evidence_refs: ["evidence:E001"] }],
        contradicts: [],
      },
    ],
    recipe: {
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
    },
  };
}

function handoff(): AuthoringHandoff {
  return {
    schema_version: "authoring_admission_handoff.v0.1",
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: {},
    evidence_bundle: {},
    claim_map: {},
    draft_proposal: { lifecycle: "proposal" },
    handoff_digest: "sha256:handoff",
  };
}

function readerEntry(): ProposalReaderEntry {
  return {
    entryId: "proposal:1",
    title: "Canonical reader proposal",
    summary: "Summary",
    posture: "proposal",
    sourceKind: "authoring_proposal",
    lifecycle: "proposal",
    leadBlocks: [
      { kind: "paragraph", text: "Canonical lead", evidenceRefs: ["evidence:E001"] },
    ],
    articleSections: [],
    articleClaims: [],
    linkSuggestions: [],
    review: { gaps: [], openQuestions: [] },
    sections: {
      provenance: [
        {
          family: "authoring_proposal_handoff",
          detail: {
            handoff_digest: "sha256:handoff",
            evidence_basis_refs: ["evidence:E001"],
          },
        },
      ],
    },
  };
}

function client(result: AuthoringClientResult) {
  const draftFromUrl = vi.fn(async (): Promise<AuthoringClientResult> => {
    throw new Error("draftFromUrl must never be called");
  });
  const draftFromHeldCapture = vi.fn(async (): Promise<AuthoringClientResult> => result);
  const value: AuthoringClient = { kind: "http", draftFromUrl, draftFromHeldCapture };
  return { value, draftFromUrl, draftFromHeldCapture };
}

describe("post-authoring canonical reader projection", () => {
  it("projects only after one successful held-capture draft and renders canonical content", async () => {
    const assembled: AuthoringClientResult = { kind: "assembled", handoff: handoff() };
    const authoring = client(assembled);
    const projector = vi.fn(async () => readerEntry());
    const statuses: AuthoringRender[] = [];

    await runDraftFromSource({
      button: { addEventListener: () => {} },
      getGovernedSource: source,
      setStatus: (render) => statuses.push(render),
      readMaterial: material,
      getClient: async () => authoring.value,
      projectHandoff: projector,
    });

    expect(authoring.draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(authoring.draftFromUrl).toHaveBeenCalledTimes(0);
    expect(projector).toHaveBeenCalledTimes(1);
    expect(projector).toHaveBeenCalledWith(assembled.handoff);
    const terminal = statuses.at(-1)!;
    expect(terminal.state).toBe("PROPOSAL_ASSEMBLED");
    expect(terminal.proposalPreview?.title).toBe("Canonical reader proposal");
    expect(terminal.proposalPreview?.leadBlocks[0]?.evidenceRefs).toEqual(["evidence:E001"]);
    expect(terminal.proposalPreview?.handoffDigest).toBe("sha256:handoff");
    expect(terminal.proposalPreview?.evidenceBasisRefs).toEqual(["evidence:E001"]);
    expect(terminal.admissionLine).toBe("Admission: not performed");
  });

  it("projection failure preserves Authoring success and never retries/refetches", async () => {
    const assembled: AuthoringClientResult = { kind: "assembled", handoff: handoff() };
    const authoring = client(assembled);
    const projector = vi.fn(async () => {
      throw new Error("Counterpedia reader unavailable");
    });
    const statuses: AuthoringRender[] = [];

    await runDraftFromSource({
      button: { addEventListener: () => {} },
      getGovernedSource: source,
      setStatus: (render) => statuses.push(render),
      readMaterial: material,
      getClient: async () => authoring.value,
      projectHandoff: projector,
    });

    expect(authoring.draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(authoring.draftFromUrl).toHaveBeenCalledTimes(0);
    expect(projector).toHaveBeenCalledTimes(1);
    const terminal = statuses.at(-1)!;
    expect(terminal.state).toBe("PROPOSAL_ASSEMBLED");
    expect(terminal.proposalPreview).toBeNull();
    expect(terminal.label).toContain("reader projection unavailable");
    expect(terminal.admissionLine).toBe("Admission: not performed");
  });

  it("never projects a failed Authoring attempt", async () => {
    const authoring = client({
      kind: "authoring_failed",
      status: 422,
      detail: "http 422",
      refusalCode: "pipeline_refused",
    });
    const projector = vi.fn(async () => readerEntry());

    await runDraftFromSource({
      button: { addEventListener: () => {} },
      getGovernedSource: source,
      setStatus: () => {},
      readMaterial: material,
      getClient: async () => authoring.value,
      projectHandoff: projector,
    });

    expect(authoring.draftFromHeldCapture).toHaveBeenCalledTimes(1);
    expect(projector).toHaveBeenCalledTimes(0);
    expect(authoring.draftFromUrl).toHaveBeenCalledTimes(0);
  });
});
