/**
 * AUTHOR-HTTP client-side draft-from-source state.
 *
 * This is the THIRD governed act's state machine, kept structurally INDEPENDENT
 * of the acquisition state machine. Acquisition proves transport + producer
 * integration and is terminally UNADMITTED; drafting composes a proposal from a
 * governed source and is terminally PROPOSAL-ONLY. Neither collapses into the
 * other, and neither ever renders admission.
 *
 * Proposal CONTENT shown by this state now comes only from Counterpedia's
 * canonical EntryReadModel projection. The Authoring handoff remains the source
 * of terminal lifecycle/digest status, but this module does not independently
 * project its draft fields into product reader semantics.
 *
 * Pure; no Chrome APIs, no DOM.
 */

import type { AuthoringHandoff } from "./authoringResponseGuard";
import type { AuthoringClientResult } from "./authoringClient";
import type { ProposalReaderEntry } from "./entryReadModelClient";
import {
  buildAuthoringProposalPreview,
  type ProposalPreview,
} from "./authoringProposalPreview";

export type AuthoringState =
  | "DRAFT_UNAVAILABLE"
  | "DRAFT_READY"
  | "DRAFT_PENDING"
  | "PROPOSAL_ASSEMBLED"
  | "DRAFT_SERVICE_UNAVAILABLE"
  | "DRAFT_FAILED";

export const FORBIDDEN_SUCCESS_STATES: ReadonlySet<string> = new Set([
  "ADMITTED",
  "PUBLISHED",
  "VERIFIED",
  "STANDING",
  "RATIFIED",
  "APPROVED",
]);

export const ADMISSION_LINE = "Admission: not performed";
export const AUTHORITY_LINE = "authority: proposal only";

export interface AuthoringRender {
  state: AuthoringState;
  label: string;
  authorityLine: string;
  admissionLine: string;
  lifecycle: string | null;
  handoffDigest: string | null;
  /** Compact extension layout derived from canonical Counterpedia EntryReadModel. */
  proposalPreview: ProposalPreview | null;
  refusalCode: string | null;
}

function assertNotSuccessWord(label: string): void {
  const upper = label.toUpperCase();
  for (const word of FORBIDDEN_SUCCESS_STATES) {
    if (upper.includes(word)) {
      throw new Error(
        `authoring state must not render success word '${word}' (label: '${label}')`,
      );
    }
  }
}

function make(
  state: AuthoringState,
  label: string,
  lifecycle: string | null,
  handoffDigest: string | null,
  refusalCode: string | null = null,
  proposalPreview: ProposalPreview | null = null,
): AuthoringRender {
  assertNotSuccessWord(label);
  return {
    state,
    label,
    authorityLine: AUTHORITY_LINE,
    admissionLine: ADMISSION_LINE,
    lifecycle,
    handoffDigest,
    proposalPreview,
    refusalCode,
  };
}

export function mapDraftAvailability(
  hasCapturedSource: boolean,
): "DRAFT_READY" | "DRAFT_UNAVAILABLE" {
  return hasCapturedSource ? "DRAFT_READY" : "DRAFT_UNAVAILABLE";
}

export function renderDraftUnavailable(): AuthoringRender {
  return make(
    "DRAFT_UNAVAILABLE",
    "Draft from source — capture a source first",
    null,
    null,
  );
}

export function renderDraftReady(): AuthoringRender {
  return make("DRAFT_READY", "Ready to draft from the captured source", null, null);
}

export function renderDraftPending(): AuthoringRender {
  return make("DRAFT_PENDING", "Drafting from source…", null, null);
}

/**
 * Terminal success render for a guarded proposal-only handoff. Reader content
 * is present only when Counterpedia's canonical projection was also obtained.
 * Failure to obtain that projection never rewrites Authoring success into a
 * draft failure; it is disclosed as a reader-projection availability problem.
 */
export function renderProposalAssembled(
  handoff: AuthoringHandoff,
  readerEntry: ProposalReaderEntry | null = null,
  readerProjectionUnavailable = false,
): AuthoringRender {
  const lifecycle = handoff.draft_proposal.lifecycle;
  const label = readerProjectionUnavailable
    ? `Proposal assembled (${lifecycle}) — reader projection unavailable`
    : `Proposal assembled (${lifecycle}) — proposal only`;
  return make(
    "PROPOSAL_ASSEMBLED",
    label,
    lifecycle,
    handoff.handoff_digest,
    null,
    readerEntry ? buildAuthoringProposalPreview(readerEntry) : null,
  );
}

export function renderDraftServiceUnavailable(): AuthoringRender {
  return make(
    "DRAFT_SERVICE_UNAVAILABLE",
    "Authoring service not configured",
    null,
    null,
  );
}

const REFUSAL_CODE_LABELS: Readonly<Record<string, string>> = {
  source_basis_unresolved: "Draft from source refused: historical source unresolved",
  pipeline_refused: "Draft from source refused: pipeline refused",
};

export function renderDraftFailed(refusalCode: string | null = null): AuthoringRender {
  const label = refusalCode
    ? (REFUSAL_CODE_LABELS[refusalCode] ?? "Draft from source refused")
    : "Draft from source failed";
  return make("DRAFT_FAILED", label, null, null, refusalCode);
}

export function renderAuthoringClientResult(
  result: AuthoringClientResult,
  readerEntry: ProposalReaderEntry | null = null,
  readerProjectionUnavailable = false,
): AuthoringRender {
  switch (result.kind) {
    case "not_configured":
      return renderDraftServiceUnavailable();
    case "assembled":
      return renderProposalAssembled(
        result.handoff,
        readerEntry,
        readerProjectionUnavailable,
      );
    case "invalid_source":
      return renderDraftFailed();
    case "authoring_failed":
      return renderDraftFailed(result.refusalCode);
  }
}
