import { describe, expect, it, vi } from "vitest";

import type { AuthoringHandoff } from "../src/lib/authoringResponseGuard";
import {
  COUNTERPEDIA_PROPOSAL_READER_URL,
  parseProposalReaderEntry,
  projectAuthoringHandoffToReaderEntry,
  type ProposalReaderEntry,
} from "../src/lib/entryReadModelClient";

function entry(): ProposalReaderEntry {
  return {
    entryId: "proposal:1",
    title: "Proposal",
    summary: "Summary",
    posture: "proposal",
    sourceKind: "authoring_proposal",
    lifecycle: "proposal",
    leadBlocks: [
      { kind: "paragraph", text: "Lead", evidenceRefs: ["evidence:E001"] },
    ],
    articleSections: [
      {
        title: "Background",
        blocks: [],
        support: { state: "not_evaluated" },
      },
    ],
    articleClaims: [
      {
        text: "Proposed statement",
        evidenceRefs: ["evidence:E001"],
        requiresHumanReview: true,
      },
    ],
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

describe("parseProposalReaderEntry", () => {
  it("accepts the canonical proposal subset the extension consumes", () => {
    expect(parseProposalReaderEntry(entry())).toEqual(entry());
  });

  it("rejects any posture other than proposal", () => {
    expect(() => parseProposalReaderEntry({ ...entry(), posture: "admitted" })).toThrow(
      /identity\/posture/,
    );
  });

  it("rejects a non-authoring proposal source kind", () => {
    expect(() =>
      parseProposalReaderEntry({ ...entry(), sourceKind: "research_template" }),
    ).toThrow(/identity\/posture/);
  });

  it("rejects malformed support state instead of guessing", () => {
    expect(() =>
      parseProposalReaderEntry({
        ...entry(),
        articleSections: [
          { title: "X", blocks: [], support: { state: "verified" } },
        ],
      }),
    ).toThrow(/article sections/);
  });
});

describe("projectAuthoringHandoffToReaderEntry", () => {
  it("posts the exact guarded handoff once to the localhost Counterpedia projection endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ entry: entry() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const input = handoff();
    const result = await projectAuthoringHandoffToReaderEntry(input, fetchImpl);
    expect(result.posture).toBe("proposal");
    expect(result.leadBlocks?.[0]?.evidenceRefs).toEqual(["evidence:E001"]);
    expect(result.sections.provenance?.[0]?.family).toBe("authoring_proposal_handoff");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(COUNTERPEDIA_PROPOSAL_READER_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
  });

  it("fails closed on a non-2xx projection response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    await expect(projectAuthoringHandoffToReaderEntry(handoff(), fetchImpl)).rejects.toThrow(
      /HTTP 422/,
    );
  });

  it("fails closed on an invalid projection envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(projectAuthoringHandoffToReaderEntry(handoff(), fetchImpl)).rejects.toThrow(
      /invalid envelope/,
    );
  });
});
