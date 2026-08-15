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
 */

import type { AcquisitionCaptureResult } from "../lib/acquisitionResponseGuard";
import type {
  AuthoringClient,
  OperatorDraftMaterial,
  AuthoringClientResult,
} from "../lib/authoringClient";
import {
  renderDraftUnavailable,
  renderDraftFailed,
  renderDraftPending,
  renderAuthoringClientResult,
  type AuthoringRender,
} from "../lib/authoringState";

/** Minimal button surface — satisfied by HTMLButtonElement and by test doubles. */
export interface DraftFromSourceButtonLike {
  addEventListener(type: "click", listener: () => void): void;
}

export interface DraftFromSourceDeps {
  readonly button: DraftFromSourceButtonLike;
  /** Render the draft lane status. */
  readonly setStatus: (render: AuthoringRender) => void;
  /** The currently-captured governed source, or null when none is held. */
  readonly getGovernedSource: () => AcquisitionCaptureResult | null;
  /** Build operator-authored material from the panel inputs; null when incomplete. */
  readonly readMaterial: () => OperatorDraftMaterial | null;
  /** Resolve the configured authoring client (may be `notConfigured`). */
  readonly getClient: () => Promise<AuthoringClient>;
}

/**
 * Run one draft-from-source attempt. Calls `draftFromHeldCapture()` and ONLY
 * `draftFromHeldCapture()` — `draftFromUrl()` is never reachable from this
 * function, under any input or failure. Exported for direct unit testing of
 * the no-fallback invariant.
 */
export async function runDraftFromSource(deps: DraftFromSourceDeps): Promise<void> {
  const source = deps.getGovernedSource();
  if (!source) {
    // Defensive: the button is disabled without a captured source. Never draft.
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
    // ONLY the historical action. When `capture_id` (or the continuity URL, or
    // operator claims) is missing, `draftFromHeldCapture()` itself refuses —
    // with zero network calls — and returns `invalid_source`. That refusal is
    // rendered as a terminal failed/unavailable state; it NEVER triggers a
    // call to `draftFromUrl()`.
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
}
