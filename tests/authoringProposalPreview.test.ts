import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAuthoringProposalPreview } from "../src/lib/authoringProposalPreview";
import { renderProposalAssembled, renderDraftReady } from "../src/lib/authoringState";
import type { AuthoringHandoff } from "../src/lib/authoringResponseGuard";

function richHandoff(): AuthoringHandoff {
  return {
    schema_version: "authoring_admission_handoff.v0.1",
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: { package_id: "pkg-1" },
    evidence_bundle: { bundle_id: "bundle-1" },
    claim_map: { claim_map_id: "claims-1" },
    draft_proposal: {
      schema_version: "draft_entry_proposal.v0.2",
      proposal_id: "proposal-1",
      title_suggestion: "A proposed title",
      lifecycle: "proposal",
      output_profile: "counterpedia.standard.v1",
      lead_blocks: [
        {
          kind: "paragraph",
          text: "Lead text from the producer.",
          evidence_refs: ["evidence:E001"],
        },
      ],
      section_blocks: [
        {
          section_label: "Background",
          is_supported: true,
          blocks: [
            {
              kind: "list",
              items: ["First item", "Second item"],
              evidence_refs: ["evidence:E002"],
            },
          ],
          unsupported_reason: null,
        },
      ],
      proposition_records: [
        {
          proposition_id: "prop:one",
          claim_text: "A bounded proposition.",
          evidence_refs: ["evidence:E001", "evidence:E002"],
          requires_human_review: true,
        },
      ],
      evidence_basis_refs: ["evidence:E001", "evidence:E002"],
      unsupported_slots: [
        { slot_label: "Dates", reason: "No retained evidence for a date." },
      ],
      open_questions: ["Which date should a reviewer verify?"],
    },
    handoff_digest: "sha256:handoff",
  };
}

describe("DRAFT-FROM-SOURCE-PREVIEW0 projection", () => {
  it("projects the useful proposal content without becoming a second authoring contract", () => {
    const preview = buildAuthoringProposalPreview(richHandoff());
    expect(preview.title).toBe("A proposed title");
    expect(preview.lifecycle).toBe("proposal");
    expect(preview.schemaVersion).toBe("draft_entry_proposal.v0.2");
    expect(preview.proposalId).toBe("proposal-1");
    expect(preview.leadBlocks[0]?.text).toBe("Lead text from the producer.");
    expect(preview.sections[0]?.label).toBe("Background");
    expect(preview.sections[0]?.blocks[0]?.items).toEqual([
      "First item",
      "Second item",
    ]);
    expect(preview.propositions[0]).toMatchObject({
      id: "prop:one",
      claimText: "A bounded proposition.",
      evidenceRefs: ["evidence:E001", "evidence:E002"],
      requiresHumanReview: true,
    });
    expect(preview.evidenceBasisRefs).toEqual([
      "evidence:E001",
      "evidence:E002",
    ]);
    expect(preview.unsupportedSlots).toEqual([
      { label: "Dates", reason: "No retained evidence for a date." },
    ]);
    expect(preview.openQuestions).toEqual([
      "Which date should a reviewer verify?",
    ]);
  });

  it("treats missing optional presentation fields as absent rather than fabricating them", () => {
    const h = richHandoff();
    h.draft_proposal = { lifecycle: "proposal" };
    const preview = buildAuthoringProposalPreview(h);
    expect(preview.title).toBeNull();
    expect(preview.leadBlocks).toEqual([]);
    expect(preview.sections).toEqual([]);
    expect(preview.propositions).toEqual([]);
    expect(preview.evidenceBasisRefs).toEqual([]);
    expect(preview.unsupportedSlots).toEqual([]);
    expect(preview.openQuestions).toEqual([]);
  });

  it("does not project package/claim-map/evidence-bundle metadata as draft claims", () => {
    const preview = buildAuthoringProposalPreview(richHandoff());
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("package_id");
    expect(serialized).not.toContain("claim_map_id");
    expect(serialized).not.toContain("bundle_id");
    expect(serialized).not.toContain("standing");
    expect(serialized).not.toContain("admitted");
  });

  it("attaches the preview only to PROPOSAL_ASSEMBLED", () => {
    const assembled = renderProposalAssembled(richHandoff());
    expect(assembled.state).toBe("PROPOSAL_ASSEMBLED");
    expect(assembled.proposalPreview?.title).toBe("A proposed title");
    expect(assembled.admissionLine).toBe("Admission: not performed");
    expect(assembled.authorityLine).toBe("authority: proposal only");

    const ready = renderDraftReady();
    expect(ready.proposalPreview).toBeNull();
  });
});

describe("side-panel rendering safety", () => {
  it("renders producer proposal text with textContent/created nodes, not preview innerHTML", () => {
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
