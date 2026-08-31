/** AUTHOR-HTTP draft state — non-collapse + canonical reader composition. */
import { describe, it, expect } from "vitest";

import {
  mapDraftAvailability,
  renderDraftUnavailable,
  renderDraftReady,
  renderDraftPending,
  renderProposalAssembled,
  renderDraftServiceUnavailable,
  renderDraftFailed,
  renderAuthoringClientResult,
  FORBIDDEN_SUCCESS_STATES,
  ADMISSION_LINE,
  AUTHORITY_LINE,
  type AuthoringRender,
} from "../src/lib/authoringState";
import type { AuthoringHandoff } from "../src/lib/authoringResponseGuard";
import type { ProposalReaderEntry } from "../src/lib/entryReadModelClient";

function handoff(lifecycle: "proposal" | "draft"): AuthoringHandoff {
  return {
    schema_version: "authoring_admission_handoff.v0.1",
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: {},
    evidence_bundle: {},
    claim_map: {},
    draft_proposal: { lifecycle },
    handoff_digest: "sha256:abc123",
  };
}

function readerEntry(lifecycle: "proposal" | "draft" = "proposal"): ProposalReaderEntry {
  return {
    entryId: "proposal:reader",
    title: "Canonical proposal",
    summary: "Canonical summary",
    posture: "proposal",
    sourceKind: "authoring_proposal",
    lifecycle,
    leadBlocks: [{ kind: "paragraph", text: "Lead", evidenceRefs: ["evidence:E001"] }],
    articleSections: [],
    articleClaims: [],
    linkSuggestions: [],
    review: { gaps: [], openQuestions: [] },
    sections: {
      provenance: [
        {
          family: "authoring_proposal",
          detail: { handoff_digest: "sha256:abc123", proposal_id: "proposal:reader" },
        },
      ],
    },
  };
}

const ALL: AuthoringRender[] = [
  renderDraftUnavailable(),
  renderDraftReady(),
  renderDraftPending(),
  renderProposalAssembled(handoff("proposal")),
  renderProposalAssembled(handoff("draft")),
  renderDraftServiceUnavailable(),
  renderDraftFailed(),
];

describe("mapDraftAvailability", () => {
  it("capture gates the option one-directionally", () => {
    expect(mapDraftAvailability(false)).toBe("DRAFT_UNAVAILABLE");
    expect(mapDraftAvailability(true)).toBe("DRAFT_READY");
  });
});

describe("every render — admission + authority discipline", () => {
  it("always carries the non-admission and proposal-only lines", () => {
    for (const r of ALL) {
      expect(r.admissionLine).toBe(ADMISSION_LINE);
      expect(r.authorityLine).toBe(AUTHORITY_LINE);
    }
  });

  it("never renders a forbidden success word in state or label", () => {
    for (const r of ALL) {
      const upperState = r.state.toUpperCase();
      const upperLabel = r.label.toUpperCase();
      for (const word of FORBIDDEN_SUCCESS_STATES) {
        expect(upperState.includes(word)).toBe(false);
        expect(upperLabel.includes(word)).toBe(false);
      }
    }
  });
});

describe("renderProposalAssembled", () => {
  it("preserves Authoring terminal status without fabricating reader content", () => {
    const r = renderProposalAssembled(handoff("proposal"));
    expect(r.state).toBe("PROPOSAL_ASSEMBLED");
    expect(r.lifecycle).toBe("proposal");
    expect(r.handoffDigest).toBe("sha256:abc123");
    expect(r.proposalPreview).toBeNull();
    expect(r.label.toLowerCase()).toContain("proposal only");
  });

  it("renders content only from the canonical Counterpedia reader model", () => {
    const r = renderProposalAssembled(handoff("draft"), readerEntry("draft"));
    expect(r.lifecycle).toBe("draft");
    expect(r.proposalPreview?.title).toBe("Canonical proposal");
    expect(r.proposalPreview?.leadBlocks[0]?.evidenceRefs).toEqual(["evidence:E001"]);
  });

  it("keeps PROPOSAL_ASSEMBLED when the separate reader projection is unavailable", () => {
    const r = renderProposalAssembled(handoff("proposal"), null, true);
    expect(r.state).toBe("PROPOSAL_ASSEMBLED");
    expect(r.proposalPreview).toBeNull();
    expect(r.label).toContain("reader projection unavailable");
    expect(r.admissionLine).toBe("Admission: not performed");
  });
});

describe("renderAuthoringClientResult", () => {
  it("not_configured => service unavailable", () => {
    const r = renderAuthoringClientResult({ kind: "not_configured" });
    expect(r.state).toBe("DRAFT_SERVICE_UNAVAILABLE");
  });

  it("assembled accepts an optional canonical reader entry", () => {
    const result = { kind: "assembled" as const, handoff: handoff("proposal") };
    expect(renderAuthoringClientResult(result).proposalPreview).toBeNull();
    expect(renderAuthoringClientResult(result, readerEntry()).proposalPreview?.title).toBe(
      "Canonical proposal",
    );
  });

  it("authoring failures preserve bounded refusal labels", () => {
    const source = renderAuthoringClientResult({
      kind: "authoring_failed",
      status: 422,
      detail: "http 422",
      refusalCode: "source_basis_unresolved",
    });
    expect(source.state).toBe("DRAFT_FAILED");
    expect(source.label).toBe("Draft from source refused: historical source unresolved");

    const pipeline = renderAuthoringClientResult({
      kind: "authoring_failed",
      status: 422,
      detail: "http 422",
      refusalCode: "pipeline_refused",
    });
    expect(pipeline.label).toBe("Draft from source refused: pipeline refused");
  });

  it("unknown bounded refusal code is never interpolated into visible prose", () => {
    const r = renderAuthoringClientResult({
      kind: "authoring_failed",
      status: 422,
      detail: "http 422",
      refusalCode: "held_capture_requires_single_candidate",
    });
    expect(r.label).toBe("Draft from source refused");
    expect(r.label).not.toContain("held_capture_requires_single_candidate");
  });
});
