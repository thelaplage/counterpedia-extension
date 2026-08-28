/**
 * RECOVERY-BIND0 navigation-generation guard.
 *
 * Recovery has the SAME stale-response hazard as acquisition (#50): a recovery
 * request initiated for page A can resolve AFTER navigation to page B, a CLEAR,
 * or a newer overlapping recovery. It REUSES the single panel-owned
 * `PageContextGeneration` from acquisitionNavGuard — it introduces NO second
 * recovery-specific counter. A superseded recovery result is DROPPED: it does not
 * update the recovery UI, does not replace the held capture, does not change
 * Draft-from-source readiness, and can never overwrite newer state. Pure.
 */
import type { RecoveryClientResult } from "./recoveryClient";
import { renderRecovery, type RecoveryRender } from "./recoveryRender";

export interface GuardedRecoveryOutcome {
  /** True when the result was current and projected; false when stale/dropped. */
  readonly projected: boolean;
  readonly render: RecoveryRender | null;
}

export interface GuardedRecoveryDeps {
  /** The page-context generation this run belongs to (snapshot at run start). */
  readonly token: number;
  /** Reads the live panel-owned page-context generation. */
  readonly currentGeneration: () => number;
  /** Performs the configured recovery assessment (client call). */
  readonly assess: () => Promise<RecoveryClientResult>;
  /** Writes the recovery status render (null clears it). */
  readonly setRecoveryStatus: (render: RecoveryRender | null) => void;
}

/**
 * Run a configured recovery assessment, projecting its result IFF the page context
 * that initiated it is still current at completion. A stale (including a failed)
 * response is DROPPED and can never overwrite a newer success.
 */
export async function runGuardedRecovery(
  deps: GuardedRecoveryDeps,
): Promise<GuardedRecoveryOutcome> {
  const result = await deps.assess();

  if (deps.currentGeneration() !== deps.token) {
    return { projected: false, render: null };
  }
  if (result.kind !== "assessed") {
    // Transport/config/no-ref/invalid: nothing to project as a recovery render.
    return { projected: true, render: null };
  }
  const render = renderRecovery(result.result);
  deps.setRecoveryStatus(render);
  return { projected: true, render };
}
