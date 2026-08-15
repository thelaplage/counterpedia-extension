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
 * success word (ADMITTED / PUBLISHED / VERIFIED / STANDING) as a state, and
 * every render carries an ever-present "Admission: not performed" line.
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
 * Success words this lane must NEVER render as a state or label. A proposal is
 * not any of these; asserting on this set guards against a regression that would
 * collapse proposal_only into an authority posture. "ADMITTED-anything" is
 * covered by substring containment, not exact match.
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

/** A UI-facing view of the draft lane — labels only, zero authority. */
export interface AuthoringRender {
  state: AuthoringState;
  /** Human label for the panel. Never one of the FORBIDDEN_SUCCESS_STATES. */
  label: string;
  /** Always the AUTHORITY_LINE — this lane never confers standing. */
  authorityLine: string;
  /** Always the ADMISSION_LINE — a proposal is never an admission. */
  admissionLine: string;
  /** The proposal-only lifecycle when assembled ("proposal"|"draft"); else null. */
  lifecycle: string | null;
  /** The producer's handoff digest when assembled; else null. Opaque label. */
  handoffDigest: string | null;
  /**
   * The bounded server refusal code (e.g. "source_basis_unresolved") when the
   * terminal state was reached via a non-2xx authoring response that carried
   * one; else null. C0-REFUSAL-DETAIL-RECON0: this is surfaced so an operator
   * can tell a "historical source unresolved" refusal apart from a generic
   * pipeline refusal — it is never synthesized from unbounded server prose.
   */
  refusalCode: string | null;
}

function assertNotSuccessWord(label: string): void {
  const upper = label.toUpperCase();
  for (const word of FORBIDDEN_SUCCESS_STATES) {
    if (upper.includes(word)) {
      // Defensive: a programming error, never reachable from the mappings below.
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
): AuthoringRender {
  assertNotSuccessWord(label);
  return {
    state,
    label,
    authorityLine: AUTHORITY_LINE,
    admissionLine: ADMISSION_LINE,
    lifecycle,
    handoffDigest,
    refusalCode,
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

/**
 * Known refusal-code -> operator label mapping. Deliberately NOT exhaustive and
 * NOT a second closed vocabulary of backend codes — `parseRefusalCode()` already
 * bounds the shape/grammar of `refusalCode` before it reaches here. This map only
 * gives the operator-meaningful codes a distinct, human-readable label; any other
 * validly-bounded-but-unmapped code renders the generic refusal label below
 * rather than being interpolated into prose (a server-controlled refusal code is
 * never embedded directly in operator-visible text, even once it's passed the
 * bounded shape/grammar check).
 */
const REFUSAL_CODE_LABELS: Readonly<Record<string, string>> = {
  source_basis_unresolved: "Draft from source refused: historical source unresolved",
  pipeline_refused: "Draft from source refused: pipeline refused",
};

/**
 * Render for a transport/pipeline failure. The acquisition record is intact.
 *
 * When the server returned a bounded refusal code, the label distinguishes it
 * from a generic failure (C0-REFUSAL-DETAIL-RECON0) — e.g. a
 * `source_basis_unresolved` refusal reads differently from a bare
 * `pipeline_refused`/unknown failure, so an operator isn't left guessing which
 * situation they're in. `refusalCode` is null for client-side refusals
 * (`invalid_source`) that never reached the network.
 */
export function renderDraftFailed(refusalCode: string | null = null): AuthoringRender {
  const label = refusalCode
    ? (REFUSAL_CODE_LABELS[refusalCode] ?? "Draft from source refused")
    : "Draft from source failed";
  return make("DRAFT_FAILED", label, null, null, refusalCode);
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
      return renderDraftFailed();
    case "authoring_failed":
      return renderDraftFailed(result.refusalCode);
  }
}
