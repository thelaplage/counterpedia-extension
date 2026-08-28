/**
 * RECOVERY-BIND0 UI render — labels only, ZERO authority.
 *
 * Maps a guarded recovery-assessment result onto descriptive facts for the panel.
 * It never renders "verified" / "trusted" / "authoritative" / "admitted" / "true",
 * and it NEVER auto-enables Draft-from-source (recovery is an observation, not an
 * admission). Pure; no Chrome APIs, no DOM.
 */
import type {
  RecoveryAssessmentResult,
  RecoveryAssessmentStatus,
  RecoveryOutcome,
} from "./recoveryResponseGuard";

export const FORBIDDEN_RECOVERY_WORDS: ReadonlySet<string> = new Set([
  "VERIFIED",
  "TRUSTED",
  "AUTHORITATIVE",
  "ADMITTED",
  "TRUE",
]);

export interface RecoveryRender {
  status: RecoveryAssessmentStatus;
  outcome: RecoveryOutcome | null;
  label: string;
  initialCaptureLine: string;
  recoveryLine: string;
  httpArtifactDigest: string | null;
  browserObservationDigest: string | null;
  /** Recovery NEVER auto-enables Draft-from-source. Structural constant. */
  readonly autoDraftFromSource: false;
}

function assertNoAuthorityWord(label: string): void {
  const upper = label.toUpperCase();
  for (const w of FORBIDDEN_RECOVERY_WORDS) {
    if (upper.includes(w)) throw new Error(`recovery render must not use authority word '${w}'`);
  }
}

const _OUTCOME_LABEL: Record<RecoveryOutcome, string> = {
  RECOVERED: "RECOVERED",
  STILL_NOT_OBSERVED: "Substantive payload still not observed",
  AMBIGUOUS: "Ambiguous",
  NOT_ELIGIBLE: "Not eligible for browser recovery",
};

export function renderRecovery(result: RecoveryAssessmentResult): RecoveryRender {
  if (result.assessment_status !== "assessed" || result.recovery_observation === null) {
    const label =
      result.assessment_status === "held_capture_not_found"
        ? "Held capture not found"
        : "Held capture invalid";
    assertNoAuthorityWord(label);
    return {
      status: result.assessment_status,
      outcome: null,
      label,
      initialCaptureLine: label,
      recoveryLine: "—",
      httpArtifactDigest: null,
      browserObservationDigest: null,
      autoDraftFromSource: false,
    };
  }

  const obs = result.recovery_observation;
  const observed = obs.recovery_outcome === "RECOVERED";
  const initialCaptureLine = observed
    ? "Substantive payload not observed"
    : "Substantive payload not observed";
  const recoveryLine = _OUTCOME_LABEL[obs.recovery_outcome];
  assertNoAuthorityWord(recoveryLine);
  return {
    status: "assessed",
    outcome: obs.recovery_outcome,
    label: recoveryLine,
    initialCaptureLine,
    recoveryLine,
    httpArtifactDigest: obs.baseline_exact_bytes_sha256,
    browserObservationDigest: obs.browser_observation_sha256,
    autoDraftFromSource: false,
  };
}
