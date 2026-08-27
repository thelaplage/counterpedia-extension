/**
 * ACQ1-HTTP navigation-generation guard.
 *
 * The acquisition producer call is asynchronous: a request initiated for browser
 * page A can resolve AFTER the extension has already moved to page B (a real
 * navigation / TAB_CHANGED), been CLEARed, or had a newer capture start. Without
 * a guard, that stale page-A response would populate page B's visible acquisition
 * state — projecting A's capture_id / source_locator / digest address / success
 * status onto a source it does not describe.
 *
 * This module adds the NARROWEST possible invalidation primitive: a single
 * monotonic page-context generation counter, plus a pure runner that projects an
 * acquisition result IFF the context that initiated it is still current at
 * completion:
 *
 *     result may project  IFF  token === currentGeneration()
 *
 * It introduces NO parallel lifecycle. The panel bumps the same one counter at
 * the page-context boundaries it already owns (navigation, restricted page,
 * CLEAR) and at the start of each acquisition run, so a later navigation/clear or
 * a newer overlapping capture strictly supersedes any earlier in-flight request.
 * A superseded result is DROPPED: it neither writes the status line nor sets a
 * governed source, and it can never overwrite newer state.
 *
 * Pure; no Chrome APIs, no DOM.
 */

import {
  renderAcquisitionPending,
  renderAcquisitionClientResult,
  type AcquisitionRender,
} from "./acquisitionState";
import type { AcquisitionClientResult } from "./acquisitionClient";
import type { AcquisitionCaptureResult } from "./acquisitionResponseGuard";

/**
 * A monotonic page-context generation. `invalidate()` advances it (returning the
 * new value); `current()` reads it. There is exactly ONE of these per panel — it
 * is not a per-request lifecycle, only a version stamp on the page context the
 * panel already tracks.
 */
export interface PageContextGeneration {
  current(): number;
  /** Advance the generation, superseding any earlier in-flight request. */
  invalidate(): number;
}

export function createPageContextGeneration(initial = 0): PageContextGeneration {
  let generation = initial;
  return {
    current: () => generation,
    invalidate: () => ++generation,
  };
}

/** Outcome of a guarded acquisition run. */
export interface GuardedAcquisitionOutcome {
  /** True when the result was current and therefore projected; false when it was
   * a stale cross-navigation response and was dropped. */
  readonly projected: boolean;
  /** The render that was projected, or null when dropped / silent. */
  readonly render: AcquisitionRender | null;
  /** The governed source that was set, or null when dropped / not captured. */
  readonly governedSource: AcquisitionCaptureResult | null;
}

export interface GuardedAcquisitionDeps {
  /** The page-context generation this run belongs to (snapshot at run start). */
  readonly token: number;
  /** Reads the live page-context generation at any moment. */
  readonly currentGeneration: () => number;
  /** Performs the already-configured acquisition request. */
  readonly capture: () => Promise<AcquisitionClientResult>;
  /** Writes the acquisition status line (null clears it). */
  readonly setStatus: (render: AcquisitionRender | null) => void;
  /** Sets / withdraws the governed source that gates the draft option. */
  readonly setGovernedSource: (result: AcquisitionCaptureResult | null) => void;
}

/**
 * Run a configured acquisition, projecting its result IFF the page context that
 * initiated it is still current at completion.
 *
 * When the initiating context is superseded before the producer responds
 * (navigation to page B, CLEAR, or a newer overlapping capture), the response is
 * DROPPED: neither the status line nor the governed source is touched, so page B
 * never inherits page A's capture facts or success status, and a stale (including
 * failed/refused) response can never overwrite newer state.
 */
export async function runGuardedAcquisition(
  deps: GuardedAcquisitionDeps,
): Promise<GuardedAcquisitionOutcome> {
  // Show the pending line only while the initiating context is still current.
  if (deps.currentGeneration() === deps.token) {
    deps.setStatus(renderAcquisitionPending());
  }

  const result = await deps.capture();

  // Invalidation gate: the initiating page context must still be current.
  if (deps.currentGeneration() !== deps.token) {
    return { projected: false, render: null, governedSource: null };
  }

  const render = renderAcquisitionClientResult(result);
  const governedSource = result.kind === "captured" ? result.result : null;
  deps.setStatus(render);
  deps.setGovernedSource(governedSource);
  return { projected: true, render, governedSource };
}
