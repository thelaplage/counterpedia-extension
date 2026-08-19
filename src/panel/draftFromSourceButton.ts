/**
 * Draft-from-source button wiring — pure, DOM/chrome-free dispatch logic.
 *
 * Extracted from panel.ts so the "one button, one action, zero fallback"
 * invariant can be pinned by a permanent test, mirroring how captureButton.ts
 * extracts the capture-button's request-count invariant.
 *
 * C0 CORRECTION: the panel's single "Draft from source" button calls ONLY the
 * historical action (`draftFromHeldCapture()` -> `/v0/draft-from-source`).
 * `draftFromUrl()` (`/v0/draft-from-url`) remains a separate, legitimate,
 * explicit new-observation action defined in authoringClient.ts, but this
 * button never invokes it — not as a primary path, not as a fallback when
 * `capture_id` is absent, and not as a fallback when `draftFromHeldCapture()`
 * itself fails. An unresolved or absent historical capture reference is a
 * refused terminal state, never a reason to re-acquire from the URL.
 *
 * WIKI-CAPTURE-AUTHOR0 adds exactly one source-selection seam: when the active
 * page lane has no governed capture, the button may consume an explicitly
 * selected successful capture from `governedSourceSelection`. Selection is
 * inert; it never invokes authoring. The SAME button and SAME held-capture
 * dispatch below remain the only drafting act. A selection restored from
 * LOCAL_ONLY persistence is treated exactly like the same explicit selection
 * before lifecycle loss; restore never drafts by itself.
 */

import type { AcquisitionCaptureResult } from "../lib/acquisitionResponseGuard";
import {
  getSelectedGovernedSource,
  subscribeGovernedSourceSelection,
} from "../lib/governedSourceSelection";
import type {
  AuthoringClient,
  OperatorDraftMaterial,
  AuthoringClientResult,
} from "../lib/authoringClient";
import {
  renderDraftUnavailable,
  renderDraftFailed,
  renderDraftPending,
  renderDraftReady,
  renderAuthoringClientResult,
  type AuthoringRender,
} from "../lib/authoringState";

/** Minimal button surface — satisfied by HTMLButtonElement and by test doubles. */
export interface DraftFromSourceButtonLike {
  disabled?: boolean;
  addEventListener(type: "click", listener: () => void): void;
}

export interface DraftFromSourceDeps {
  readonly button: DraftFromSourceButtonLike;
  /** The currently-captured active-page governed source, or null when none is held. */
  readonly getGovernedSource: () => AcquisitionCaptureResult | null;
  /** Render the draft lane status. */
  readonly setStatus: (render: AuthoringRender) => void;
  /** Build operator-authored material from the panel inputs; null when incomplete. */
  readonly readMaterial: () => OperatorDraftMaterial | null;
  /** Resolve the configured authoring client (may be `notConfigured`). */
  readonly getClient: () => Promise<AuthoringClient>;
}

/**
 * Active-page capture wins when present; otherwise consume the separately and
 * explicitly selected historical source. No source is inferred from URL/page
 * state, and a capture_failed result can never enter the shared selection seam.
 */
export function resolveDraftGovernedSource(
  deps: Pick<DraftFromSourceDeps, "getGovernedSource">,
): AcquisitionCaptureResult | null {
  return deps.getGovernedSource() ?? getSelectedGovernedSource();
}

/**
 * Run one draft-from-source attempt. Calls `draftFromHeldCapture()` and ONLY
 * `draftFromHeldCapture()` — `draftFromUrl()` is never reachable from this
 * function, under any input or failure. Exported for direct unit testing of
 * the no-fallback invariant.
 */
export async function runDraftFromSource(deps: DraftFromSourceDeps): Promise<void> {
  const source = resolveDraftGovernedSource(deps);
  if (!source) {
    deps.setStatus(renderDraftUnavailable());
    return;
  }
  const material = deps.readMaterial();
  if (!material) {
    deps.setStatus(renderDraftFailed());
    return;
  }

  const client = await deps.getClient();
  if (client.kind === "not_configured") {
    deps.setStatus(renderAuthoringClientResult({ kind: "not_configured" }));
    return;
  }

  deps.setStatus(renderDraftPending());
  try {
    const result: AuthoringClientResult = await client.draftFromHeldCapture(
      source,
      material,
    );
    deps.setStatus(renderAuthoringClientResult(result));
  } catch {
    deps.setStatus(renderDraftFailed());
  }
}

/** Register the single click handler on the draft-from-source button. */
export function wireDraftFromSourceButton(deps: DraftFromSourceDeps): void {
  deps.button.addEventListener("click", () => {
    void runDraftFromSource(deps);
  });

  // Only stateful button surfaces (the real HTML button and matching test
  // doubles) need readiness subscriptions. Pure dispatch doubles without a
  // disabled property stay subscription-free.
  if (!("disabled" in deps.button)) return;

  // A LOCAL_ONLY selection may have been restored before this UI surface was
  // wired. Subscriptions intentionally do not replay, so establish readiness
  // from the already-restored state once before listening for future changes.
  if (resolveDraftGovernedSource(deps)) {
    deps.button.disabled = false;
    deps.setStatus(renderDraftReady());
  }

  subscribeGovernedSourceSelection((selected) => {
    if (deps.getGovernedSource()) return;
    if (!selected) {
      deps.button.disabled = true;
      deps.setStatus(renderDraftUnavailable());
      return;
    }
    deps.button.disabled = false;
    deps.setStatus(renderDraftReady());
  });
}
