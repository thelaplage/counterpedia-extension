import type {
  ProposalReaderContentBlock,
  ProposalReaderEntry,
} from "./entryReadModelClient";

/**
 * Extension-owned LAYOUT projection of Counterpedia's canonical proposal
 * EntryReadModel. Semantic mapping from Authoring artifacts is owned by
 * Counterpedia and happens before this module receives anything.
 */
export interface ProposalPreviewBlock {
  readonly kind: "paragraph" | "list" | "other";
  readonly text: string | null;
  readonly items: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ProposalPreviewSection {
  readonly label: string;
  readonly supported: boolean | null;
  readonly blocks: readonly ProposalPreviewBlock[];
  readonly unsupportedReason: string | null;
}

export interface ProposalPreviewProposition {
  readonly id: string | null;
  readonly claimText: string;
  readonly evidenceRefs: readonly string[];
  readonly requiresHumanReview: boolean | null;
}

export interface ProposalPreview {
  readonly title: string | null;
  readonly lifecycle: "proposal" | "draft";
  readonly schemaVersion: string | null;
  readonly proposalId: string | null;
  readonly outputProfile: string | null;
  readonly handoffDigest: string;
  readonly leadBlocks: readonly ProposalPreviewBlock[];
  readonly sections: readonly ProposalPreviewSection[];
  readonly propositions: readonly ProposalPreviewProposition[];
  readonly evidenceBasisRefs: readonly string[];
  readonly openQuestions: readonly string[];
  readonly unsupportedSlots: readonly { label: string; reason: string }[];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function panelBlock(block: ProposalReaderContentBlock): ProposalPreviewBlock {
  return {
    kind: block.kind,
    text: block.text ?? null,
    items: block.items ?? [],
    evidenceRefs: block.evidenceRefs,
  };
}

function authoringProvenance(entry: ProposalReaderEntry): Readonly<Record<string, unknown>> {
  const record = entry.sections.provenance?.find(
    (candidate) => candidate.family === "authoring_proposal",
  );
  return record?.detail ?? {};
}

/**
 * Build the compact side-panel layout from the canonical Counterpedia read
 * model. This function may omit reader fields for compact layout, but it does
 * not reinterpret Authoring artifacts or determine evidence/support semantics.
 */
export function buildAuthoringProposalPreview(
  entry: ProposalReaderEntry,
): ProposalPreview {
  const provenance = authoringProvenance(entry);
  return {
    title: entry.title || null,
    lifecycle: entry.lifecycle ?? "proposal",
    schemaVersion: optionalString(provenance["draft_schema_version"]),
    proposalId: optionalString(provenance["proposal_id"]) ?? entry.entryId,
    outputProfile: optionalString(provenance["output_profile"]),
    handoffDigest: optionalString(provenance["handoff_digest"]) ?? "projection:unavailable",
    leadBlocks: (entry.leadBlocks ?? []).map(panelBlock),
    sections: (entry.articleSections ?? []).map((section) => ({
      label: section.title,
      supported:
        section.support.state === "supported"
          ? true
          : section.support.state === "unsupported"
            ? false
            : null,
      blocks: section.blocks.map(panelBlock),
      unsupportedReason:
        section.support.state === "unsupported" ? section.support.reason : null,
    })),
    propositions: (entry.articleClaims ?? []).map((claim) => ({
      id: claim.id ?? null,
      claimText: claim.text,
      evidenceRefs: claim.evidenceRefs,
      requiresHumanReview: claim.requiresHumanReview ?? null,
    })),
    evidenceBasisRefs: stringArray(provenance["evidence_basis_refs"]),
    openQuestions: entry.review?.openQuestions ?? [],
    unsupportedSlots: (entry.review?.gaps ?? []).map((gap) => ({
      label: gap.label,
      reason: gap.reason,
    })),
  };
}
