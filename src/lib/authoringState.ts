/**
 * AUTHOR-HTTP client-side draft-from-source state.
 *
 * This is the THIRD governed act's state machine, kept structurally INDEPENDENT
 * of the acquisition state machine. Acquisition proves transport + producer
 * integration and is terminally UNADMITTED; drafting composes a proposal from a
 * governed source and is terminally PROPOSAL-ONLY. Neither collapses into the
 * other, and neither ever renders admission:
 *
 *   DRAFT_UNAVAILABLE   (no acquisition result yet)
 *     -> DRAFT_READY     (a source was captured; draft is now an explicit option)
 *     -> DRAFT_PENDING   (draft-from-source in flight)
 *     -> PROPOSAL_ASSEMBLED (proposal_only handoff returned)
 *
 * A captured acquisition NEVER auto-advances to DRAFT_PENDING — the transition
 * from DRAFT_READY is an explicit operator act. This module therefore emits no
 * authority-success word (ADMITTED / PUBLISHED / VERIFIED / STANDING) as a
 * STATE LABEL, and every render carries an ever-present
 * "Admission: not performed" line.
 *
 * REAL-CONTENT-VISIBLE0: an assembled handoff may also contribute a bounded
 * human-readable preview (title + first lead paragraph) to the status line so a
 * real source-derived draft is visible in the panel. That preview is CONTENT,
 * not a state label or authority assertion. Ordinary proposal prose is not
 * censored merely because it contains words such as "approved" or "verified".
 *
 * Pure; no Chrome APIs, no DOM.
 */

import type { AuthoringHandoff } from "./authoringResponseGuard";
import type { AuthoringClientResult } from "./authoringClient";

/** The ordered draft lifecycle. PROPOSAL_ASSEMBLED is the terminal success. */
export type AuthoringState =
  | "DRAFT_UNAVAILABLE"
  | "DRAFT_READY"
  | "DRAFT_PENDING"
  | "PROPOSAL_ASSEMBLED"
  | "DRAFT_SERVICE_UNAVAILABLE"
  | "DRAFT_FAILED";

/**
 * Authority-success words this lane must NEVER render as a STATE or STATIC
 * STATUS LABEL. Proposal content is different: it may legitimately quote or
 * discuss ordinary-language uses of these words, and is always prefixed
 * "Draft preview:" while the separate proposal-only/admission-not-performed
 * lines remain present.
 */
export const FORBIDDEN_SUCCESS_STATES: ReadonlySet<string> = new Set([
  "ADMITTED",
  "PUBLISHED",
  "VERIFIED",
  "STANDING",
  "RATIFIED",
  "APPROVED",
]);

/** The invariant line every render must show, verbatim. */
export const ADMISSION_LINE = "Admission: not performed";
/** The authority line every render must show, verbatim. */
export const AUTHORITY_LINE = "authority: proposal only";
/** Content marker that keeps preview prose distinct from state language. */
export const DRAFT_PREVIEW_PREFIX = "Draft preview:";
const DRAFT_PREVIEW_MAX_CHARS = 360;

/** A UI-facing view of the draft lane — labels only, zero authority. */
export interface AuthoringRender {
  state: AuthoringState;
  /**
   * Human label for the panel. Its STATIC status prefix never contains a
   * FORBIDDEN_SUCCESS_STATE. On assembled handoffs it may append a clearly
   * marked bounded draft preview.
   */
  label: string;
  /** Always the AUTHORITY_LINE — this lane never confers standing. */
  authorityLine: string;
  /** Always the ADMISSION_LINE — a proposal is never an admission. */
  admissionLine: string;
  /** The proposal-only lifecycle when assembled ("proposal"|"draft"); else null. */
  lifecycle: string | null;
  /** The producer's handoff digest when assembled; else null. Opaque label. */
  handoffDigest: string | null;
  /** Bounded producer-draft preview when available; content only, no authority. */
  proposalPreview: string | null;
}

function assertNotSuccessWord(label: string): void {
  const upper = label.toUpperCase();
  for (const word of FORBIDDEN_SUCCESS_STATES) {
    if (upper.includes(word)) {
      // Defensive: a programming error in a STATE label, never proposal prose.
      throw new Error(
        `authoring state must not render success word '${word}' (label: '${label}')`,
      );
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= DRAFT_PREVIEW_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, DRAFT_PREVIEW_MAX_CHARS - 1)}…`;
}

/**
 * Project only display text from an already-guarded draft proposal.
 *
 * This does not reinterpret evidence, support, lifecycle, or authority. The
 * response guard has already accepted the handoff; this function merely finds
 * the producer's title suggestion and first lead paragraph for inspection.
 */
export function projectDraftPreview(
  handoff: AuthoringHandoff,
): string | null {
  const draft = handoff.draft_proposal;
  const title = boundedText(draft["title_suggestion"]);

  let lead: string | null = null;
  const leadBlocks = draft["lead_blocks"];
  if (Array.isArray(leadBlocks)) {
    for (const block of leadBlocks) {
      if (!isPlainObject(block)) continue;
      lead = boundedText(block["text"]);
      if (lead) break;
    }
  }

  if (title && lead) {
    const combined = `${title} — ${lead}`;
    return combined.length <= DRAFT_PREVIEW_MAX_CHARS
      ? combined
      : `${combined.slice(0, DRAFT_PREVIEW_MAX_CHARS - 1)}…`;
  }
  return title ?? lead;
}

function make(
  state: AuthoringState,
  statusLabel: string,
  lifecycle: string | null,
  handoffDigest: string | null,
  proposalPreview: string | null = null,
): AuthoringRender {
  // Check only the runtime-owned static state label. Proposal content is
  // intentionally outside this assertion and is marked distinctly below.
  assertNotSuccessWord(statusLabel);
  return {
    state,
    label: proposalPreview
      ? `${statusLabel} — ${DRAFT_PREVIEW_PREFIX} ${proposalPreview}`
      : statusLabel,
    authorityLine: AUTHORITY_LINE,
    admissionLine: ADMISSION_LINE,
    lifecycle,
    handoffDigest,
    proposalPreview,
  };
}

/**
 * Pure availability mapping: whether the Draft action is even offered. A draft
 * requires a governed source, which only a captured acquisition provides. This
 * is the ONLY place the two lanes touch, and it is one-directional (capture
 * gates the option; it does not perform the draft).
 */
export function mapDraftAvailability(
  hasCapturedSource: boolean,
): "DRAFT_READY" | "DRAFT_UNAVAILABLE" {
  return hasCapturedSource ? "DRAFT_READY" : "DRAFT_UNAVAILABLE";
}

/** Render for "no governed source captured yet — draft not yet available". */
export function renderDraftUnavailable(): AuthoringRender {
  return make(
    "DRAFT_UNAVAILABLE",
    "Draft from source — capture a source first",
    null,
    null,
  );
}

/** Render for "a source was captured; drafting is an explicit option now". */
export function renderDraftReady(): AuthoringRender {
  return make("DRAFT_READY", "Ready to draft from the captured source", null, null);
}

/** The in-flight render shown between the explicit click and the response. */
export function renderDraftPending(): AuthoringRender {
  return make("DRAFT_PENDING", "Drafting from source…", null, null);
}

/** Terminal success render for a guarded proposal-only handoff. Never admits. */
export function renderProposalAssembled(
  handoff: AuthoringHandoff,
): AuthoringRender {
  const lifecycle = handoff.draft_proposal.lifecycle;
  return make(
    "PROPOSAL_ASSEMBLED",
    `Proposal assembled (${lifecycle}) — proposal only`,
    lifecycle,
    handoff.handoff_digest,
    projectDraftPreview(handoff),
  );
}

/** Render for the honest "no authoring service configured" case. */
export function renderDraftServiceUnavailable(): AuthoringRender {
  return make(
    "DRAFT_SERVICE_UNAVAILABLE",
    "Authoring service not configured",
    null,
    null,
  );
}

/** Render for a transport/pipeline failure. The acquisition record is intact. */
export function renderDraftFailed(): AuthoringRender {
  return make(
    "DRAFT_FAILED",
    "Draft from source failed",
    null,
    null,
  );
}

/**
 * Map an authoring client result to its terminal render for the panel.
 *
 * `not_configured` yields the honest unavailable render (drafting is an opt-in
 * dev capability). No branch admits, verifies, or publishes.
 */
export function renderAuthoringClientResult(
  result: AuthoringClientResult,
): AuthoringRender {
  switch (result.kind) {
    case "not_configured":
      return renderDraftServiceUnavailable();
    case "assembled":
      return renderProposalAssembled(result.handoff);
    case "invalid_source":
    case "authoring_failed":
      return renderDraftFailed();
  }
}
