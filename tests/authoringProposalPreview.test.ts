import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAuthoringProposalPreview } from "../src/lib/authoringProposalPreview";
import { renderProposalAssembled, renderDraftReady } from "../src/lib/authoringState";
import type { AuthoringHandoff } from "../src/lib/authoringResponseGuard";
import type { ProposalReaderEntry } from "../src/lib/entryReadModelClient";

function handoff(lifecycle: "proposal" | "draft" = "proposal"): AuthoringHandoff {
  return {
    schema_version: "authoring_admission_handoff.v0.1",
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: {},
    evidence_bundle: {},
    claim_map: {},
    draft_proposal: { lifecycle },
    handoff_digest: "sha256:handoff",
  };
}

function richEntry(): ProposalReaderEntry {
  return {
    entryId: "proposal-1",
    title: "A proposed title",
    summary: "Lead text from the producer.",
    posture: "proposal",
    sourceKind: "authoring_proposal",
    lifecycle: "proposal",
    leadBlocks: [
      {
        kind: "paragraph",
        text: "Lead text from the producer.",
        evidenceRefs: ["evidence:E001"],
      },
    ],
    articleSections: [
      {
        title: "Background",
        support: { state: "supported" },
        blocks: [
          {
            kind: "list",
            items: ["First item", "Second item"],
            evidenceRefs: ["evidence:E002"],
          },
        ],
      },
    ],
    articleClaims: [
      {
        id: "prop:one",
        text: "A bounded proposition.",
        evidenceRefs: ["evidence:E001", "evidence:E002"],
        requiresHumanReview: true,
      },
    ],
    linkSuggestions: [],
    review: {
      gaps: [{ label: "Dates", reason: "No retained evidence for a date." }],
      openQuestions: ["Which date should a reviewer verify?"],
    },
    sections: {
      provenance: [
        {
          family: "authoring_proposal",
          detail: {
            draft_schema_version: "draft_entry_proposal.v0.2",
            proposal_id: "proposal-1",
            output_profile: "counterpedia.standard.v1",
            handoff_digest: "sha256:handoff",
            evidence_basis_refs: ["evidence:E001", "evidence:E002"],
          },
        },
      ],
    },
  };
}

describe("READER-CONSUMER-EXT1 layout projection", () => {
  it("projects the canonical Counterpedia read model into the compact panel layout", () => {
    const preview = buildAuthoringProposalPreview(richEntry());
    expect(preview.title).toBe("A proposed title");
    expect(preview.lifecycle).toBe("proposal");
    expect(preview.schemaVersion).toBe("draft_entry_proposal.v0.2");
    expect(preview.proposalId).toBe("proposal-1");
    expect(preview.leadBlocks[0]?.text).toBe("Lead text from the producer.");
    expect(preview.sections[0]?.label).toBe("Background");
    expect(preview.sections[0]?.blocks[0]?.items).toEqual(["First item", "Second item"]);
    expect(preview.propositions[0]).toMatchObject({
      id: "prop:one",
      claimText: "A bounded proposition.",
      evidenceRefs: ["evidence:E001", "evidence:E002"],
      requiresHumanReview: true,
    });
    expect(preview.evidenceBasisRefs).toEqual(["evidence:E001", "evidence:E002"]);
    expect(preview.unsupportedSlots).toEqual([
      { label: "Dates", reason: "No retained evidence for a date." },
    ]);
    expect(preview.openQuestions).toEqual(["Which date should a reviewer verify?"]);
  });

  it("does not inspect raw Authoring draft fields in the layout projector", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/authoringProposalPreview.ts"),
      "utf8",
    );
    expect(source).not.toContain("AuthoringHandoff");
    expect(source).not.toContain("draft_proposal");
    expect(source).not.toContain("lead_blocks");
    expect(source).not.toContain("proposition_records");
  });

  it("attaches content preview only when a canonical reader entry is supplied", () => {
    const withoutReader = renderProposalAssembled(handoff());
    expect(withoutReader.state).toBe("PROPOSAL_ASSEMBLED");
    expect(withoutReader.proposalPreview).toBeNull();

    const assembled = renderProposalAssembled(handoff(), richEntry());
    expect(assembled.state).toBe("PROPOSAL_ASSEMBLED");
    expect(assembled.proposalPreview?.title).toBe("A proposed title");
    expect(assembled.admissionLine).toBe("Admission: not performed");
    expect(assembled.authorityLine).toBe("authority: proposal only");

    const ready = renderDraftReady();
    expect(ready.proposalPreview).toBeNull();
  });
});

describe("side-panel rendering safety", () => {
  it("renders proposal text with textContent/created nodes, not preview innerHTML", () => {
    const source = readFileSync(join(process.cwd(), "src/panel/panel.ts"), "utf8");
    const start = source.indexOf("function ensureAuthoringProposalPreviewContainer");
    const end = source.indexOf("function setAuthoringStatus", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const previewRenderer = source.slice(start, end);
    expect(previewRenderer).toContain("textContent");
    expect(previewRenderer).toContain("replaceChildren()");
    expect(previewRenderer).not.toContain("innerHTML");
  });

  it("keeps the explicit non-authority boundary visible in the preview renderer", () => {
    const source = readFileSync(join(process.cwd(), "src/panel/panel.ts"), "utf8");
    expect(source).toContain(
      "Proposal only — not admitted, published, verified, or standing.",
    );
  });
});
