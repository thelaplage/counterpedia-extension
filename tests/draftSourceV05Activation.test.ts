import { describe, expect, it } from "vitest";

import {
  buildDraftFromSourceRequest,
  buildDraftFromUrlRequest,
  type OperatorDraftMaterial,
} from "../src/lib/authoringClient";
import {
  AuthoringResponseError,
  parseAuthoringHandoff,
} from "../src/lib/authoringResponseGuard";

const SOURCE_URL = "https://example.test/retained-source";
const CAPTURE_REF = "cap_held_v05_activation";

function operatorStandardMaterial(): OperatorDraftMaterial {
  return {
    subjectSeed: "Example subject",
    operatorObjective: "Produce a bounded proposal describing Example subject.",
    candidateId: "src:operator-governed-source",
    claims: [
      {
        claim_id: "claim-core",
        claim_text: "A bounded operator-authored claim.",
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

function v05Handoff(): Record<string, unknown> {
  return {
    schema_version: "authoring_admission_handoff.v0.5",
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: {
      schema_version: "authoring_proposal_package.v0.3",
      draft_lifecycle: "proposal",
    },
    evidence_bundle: { schema_version: "evidence_bundle.v0.1" },
    claim_map: { schema_version: "claim_map.v0.1" },
    draft_proposal: {
      schema_version: "draft_entry_proposal.v0.3",
      lifecycle: "proposal",
      section_blocks: [
        {
          section_label: "Background",
          role: "background",
          blocks: [],
        },
      ],
    },
    draft_completeness_binding: {
      schema_version: "draft_completeness_binding.v0.2",
      content_unit_coverages: [],
      proposition_claim_bindings: [],
      content_unit_exemptions: [],
    },
    handoff_digest: "sha256:" + "a".repeat(64),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("EXT-DRAFT-SOURCE-V05-ACTIVATE0 — request projection", () => {
  it("upgrades the exact shipped operator-standard source profile to explicit v0.2 placement", () => {
    const request = buildDraftFromSourceRequest(
      SOURCE_URL,
      CAPTURE_REF,
      operatorStandardMaterial(),
    );

    expect(request.recipe).toEqual({
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.2.0",
      desired_sections: [
        { section_label: "Background", role: "background" },
      ],
    });
    expect(request.recipe).not.toHaveProperty("desired_section_vocabulary");
    expect(request.capture_ref).toBe(CAPTURE_REF);
  });

  it("keeps the URL action label-only even for the same application profile", () => {
    const request = buildDraftFromUrlRequest(SOURCE_URL, operatorStandardMaterial());
    expect(request.recipe).toEqual({
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    });
    expect(request.recipe).not.toHaveProperty("desired_sections");
  });

  it("does not infer role for an arbitrary recipe merely because its title says Background", () => {
    const material = operatorStandardMaterial();
    material.recipe = {
      ...material.recipe,
      recipe_id: "some-other-profile",
    };

    const request = buildDraftFromSourceRequest(SOURCE_URL, CAPTURE_REF, material);
    expect(request.recipe).toEqual({
      recipe_id: "some-other-profile",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    });
    expect(request.recipe).not.toHaveProperty("desired_sections");
  });

  it("passes an explicitly role-bearing caller recipe without deriving or changing its editorial title", () => {
    const material = operatorStandardMaterial();
    material.recipe = {
      recipe_id: "explicit-role-profile",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.2.0",
      desired_sections: [
        { section_label: "What happened next", role: "timeline" },
      ],
    };

    const request = buildDraftFromSourceRequest(SOURCE_URL, CAPTURE_REF, material);
    expect(request.recipe).toEqual({
      recipe_id: "explicit-role-profile",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.2.0",
      desired_sections: [
        { section_label: "What happened next", role: "timeline" },
      ],
    });
  });
});

describe("EXT-DRAFT-SOURCE-V05-ACTIVATE0 — handoff guard", () => {
  it("accepts v0.5 and preserves the materialized completeness object losslessly", () => {
    const raw = v05Handoff();
    const parsed = parseAuthoringHandoff(raw);
    expect(parsed.schema_version).toBe("authoring_admission_handoff.v0.5");
    expect(parsed.authority_posture).toBe("proposal_only");
    expect(parsed.draft_completeness_binding).toEqual(
      raw["draft_completeness_binding"],
    );
    const sectionBlocks = parsed.draft_proposal["section_blocks"] as Array<Record<string, unknown>>;
    expect(sectionBlocks[0]?.["role"]).toBe("background");
  });

  it("requires the completeness object on v0.5", () => {
    const bad = clone(v05Handoff());
    delete bad["draft_completeness_binding"];
    expect(() => parseAuthoringHandoff(bad)).toThrow(AuthoringResponseError);
    expect(() => parseAuthoringHandoff(bad)).toThrow(/draft_completeness_binding/);
  });

  it("does not widen older handoff versions to accept the v0.5-only field", () => {
    const bad = clone(v05Handoff());
    bad["schema_version"] = "authoring_admission_handoff.v0.1";
    expect(() => parseAuthoringHandoff(bad)).toThrow(/unknown top-level field 'draft_completeness_binding'/);
  });

  it("still rejects authority contamination nested inside the opaque completeness artifact", () => {
    const bad = clone(v05Handoff());
    (bad["draft_completeness_binding"] as Record<string, unknown>)["standing"] = "granted";
    expect(() => parseAuthoringHandoff(bad)).toThrow(/authority-bearing field 'standing'/);
  });

  it("does not treat completeness as support/admission/verification state", () => {
    const parsed = parseAuthoringHandoff(v05Handoff());
    const flat = JSON.stringify(parsed);
    expect(flat).not.toContain('"admission_status"');
    expect(flat).not.toContain('"standing"');
    expect(flat).not.toContain('"verified"');
    expect(flat).not.toContain('"authenticity"');
  });
});
