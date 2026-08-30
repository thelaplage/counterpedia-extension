import type { AuthoringHandoff } from "./authoringResponseGuard";

/**
 * Consumer-only preview over an already-guarded AuthoringAdmissionHandoff.
 *
 * This module does NOT define authoring contract semantics. It reads only a
 * small presentation subset from the producer-owned DraftEntryProposal payload
 * after authoringResponseGuard has already enforced proposal-only posture and
 * rejected authority-bearing contamination.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function previewBlock(value: unknown): ProposalPreviewBlock | null {
  if (!isRecord(value)) return null;
  const kindRaw = value["kind"];
  const kind =
    kindRaw === "paragraph"
      ? "paragraph"
      : kindRaw === "list"
        ? "list"
        : "other";
  return {
    kind,
    text: optionalString(value["text"]),
    items: stringArray(value["items"]),
    evidenceRefs: stringArray(value["evidence_refs"]),
  };
}

function previewBlocks(value: unknown): ProposalPreviewBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(previewBlock)
    .filter((item): item is ProposalPreviewBlock => item !== null);
}

function previewSection(value: unknown): ProposalPreviewSection | null {
  if (!isRecord(value)) return null;
  const label = optionalString(value["section_label"]);
  if (!label) return null;
  const supportedRaw = value["is_supported"];
  return {
    label,
    supported: typeof supportedRaw === "boolean" ? supportedRaw : null,
    blocks: previewBlocks(value["blocks"]),
    unsupportedReason: optionalString(value["unsupported_reason"]),
  };
}

function previewProposition(value: unknown): ProposalPreviewProposition | null {
  if (!isRecord(value)) return null;
  const claimText = optionalString(value["claim_text"]);
  if (!claimText) return null;
  const reviewRaw = value["requires_human_review"];
  return {
    id: optionalString(value["proposition_id"]),
    claimText,
    evidenceRefs: stringArray(value["evidence_refs"]),
    requiresHumanReview:
      typeof reviewRaw === "boolean" ? reviewRaw : null,
  };
}

function previewUnsupportedSlot(
  value: unknown,
): { label: string; reason: string } | null {
  if (!isRecord(value)) return null;
  const label = optionalString(value["slot_label"]);
  const reason = optionalString(value["reason"]);
  return label && reason ? { label, reason } : null;
}

/** Build a bounded, read-only side-panel projection from the guarded handoff. */
export function buildAuthoringProposalPreview(
  handoff: AuthoringHandoff,
): ProposalPreview {
  const draft = handoff.draft_proposal;
  return {
    title: optionalString(draft["title_suggestion"]),
    lifecycle: draft.lifecycle,
    schemaVersion: optionalString(draft["schema_version"]),
    proposalId: optionalString(draft["proposal_id"]),
    outputProfile: optionalString(draft["output_profile"]),
    handoffDigest: handoff.handoff_digest,
    leadBlocks: previewBlocks(draft["lead_blocks"]),
    sections: Array.isArray(draft["section_blocks"])
      ? draft["section_blocks"]
          .map(previewSection)
          .filter((item): item is ProposalPreviewSection => item !== null)
      : [],
    propositions: Array.isArray(draft["proposition_records"])
      ? draft["proposition_records"]
          .map(previewProposition)
          .filter((item): item is ProposalPreviewProposition => item !== null)
      : [],
    evidenceBasisRefs: stringArray(draft["evidence_basis_refs"]),
    openQuestions: stringArray(draft["open_questions"]),
    unsupportedSlots: Array.isArray(draft["unsupported_slots"])
      ? draft["unsupported_slots"]
          .map(previewUnsupportedSlot)
          .filter(
            (item): item is { label: string; reason: string } => item !== null,
          )
      : [],
  };
}
