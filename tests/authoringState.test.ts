/**
 * AUTHOR-HTTP draft-from-source state tests — non-collapse + admission discipline.
 *
 * Proves the third-act state machine (a) is independent of acquisition, (b)
 * never renders an authority success word, and (c) ALWAYS shows
 * "Admission: not performed", regardless of outcome.
 */

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

const ALL: AuthoringRender[] = [
  renderDraftUnavailable(),
  renderDraftReady(),
  renderDraftPending(),
  renderProposalAssembled(handoff("proposal")),
  renderProposalAssembled(handoff("draft")),
  renderDraftServiceUnavailable(),
  renderDraftFailed(),
];

describe("mapDraftAvailability — capture gates the option, one-directionally", () => {
  it("no captured source => DRAFT_UNAVAILABLE", () => {
    expect(mapDraftAvailability(false)).toBe("DRAFT_UNAVAILABLE");
  });
  it("captured source => DRAFT_READY (an option, not a performed draft)", () => {
    expect(mapDraftAvailability(true)).toBe("DRAFT_READY");
  });
});

describe("every render — admission + authority discipline", () => {
  it("ALWAYS shows 'Admission: not performed'", () => {
    for (const r of ALL) {
      expect(r.admissionLine).toBe(ADMISSION_LINE);
      expect(r.admissionLine).toBe("Admission: not performed");
    }
  });

  it("ALWAYS shows 'authority: proposal only'", () => {
    for (const r of ALL) {
      expect(r.authorityLine).toBe(AUTHORITY_LINE);
      expect(r.authorityLine).toBe("authority: proposal only");
    }
  });

  it("NEVER renders a forbidden success word in state or label", () => {
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

describe("renderProposalAssembled — terminal proposal_only", () => {
  it("surfaces the proposal lifecycle + handoff digest, never admission", () => {
    const r = renderProposalAssembled(handoff("proposal"));
    expect(r.state).toBe("PROPOSAL_ASSEMBLED");
    expect(r.lifecycle).toBe("proposal");
    expect(r.handoffDigest).toBe("sha256:abc123");
    expect(r.label.toLowerCase()).toContain("proposal only");
  });

  it("accepts the 'draft' lifecycle too", () => {
    const r = renderProposalAssembled(handoff("draft"));
    expect(r.lifecycle).toBe("draft");
  });
});

describe("renderAuthoringClientResult — mapping never admits", () => {
  it("not_configured => service unavailable (silent opt-in)", () => {
    const r = renderAuthoringClientResult({ kind: "not_configured" });
    expect(r.state).toBe("DRAFT_SERVICE_UNAVAILABLE");
    expect(r.admissionLine).toBe(ADMISSION_LINE);
  });

  it("assembled => proposal assembled", () => {
    const r = renderAuthoringClientResult({
      kind: "assembled",
      handoff: handoff("proposal"),
    });
    expect(r.state).toBe("PROPOSAL_ASSEMBLED");
    expect(r.lifecycle).toBe("proposal");
  });

  it("authoring_failed => draft failed (acquisition record intact, no authority)", () => {
    const r = renderAuthoringClientResult({
      kind: "authoring_failed",
      status: 422,
      detail: "pipeline_refused",
    });
    expect(r.state).toBe("DRAFT_FAILED");
    expect(r.lifecycle).toBeNull();
  });

  it("invalid_source => draft failed", () => {
    const r = renderAuthoringClientResult({
      kind: "invalid_source",
      detail: "no url",
    });
    expect(r.state).toBe("DRAFT_FAILED");
  });
});
