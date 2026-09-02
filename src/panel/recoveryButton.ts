/**
 * Recovery-button wiring — pure, DOM/chrome-free logic (mirrors captureButton.ts
 * so the "Assess browser recovery" action is unit-testable and pins its invariants).
 *
 * Composes the already-green recovery modules. On an explicit click it: obtains
 * the CURRENT governed held capture_ref (never reconstructs one), requests a
 * FRESH BrowserPageCapture through the EXISTING CAPTURE_PAGE path, and runs the
 * recovery assessment through runGuardedRecovery using the SAME panel-owned
 * pageContext generation (#50). It never launches a browser, never uses MHTML/
 * operator snapshot, never re-fetches a URL, never mutates the held capture, and
 * never makes Draft-from-source ready. AUTHORITY_MOVEMENT = 0.
 */
import type { BrowserPageCapture } from "../lib/browserPageCapture";
import type { RecoveryClientResult } from "../lib/recoveryClient";
import { runGuardedRecovery } from "../lib/recoveryNavGuard";
import type { RecoveryRender } from "../lib/recoveryRender";
import type { CaptureResponse } from "./captureButton";

export interface RecoveryButtonLike {
  disabled: boolean;
  addEventListener(type: "click", listener: () => void): void;
}

export interface RecoveryButtonDeps {
  readonly button: RecoveryButtonLike;
  /** Current governed held capture_ref, or null. Recovery is unavailable at null. */
  readonly getCaptureRef: () => string | null;
  /** Fresh CAPTURE_PAGE request (the exact same producer path as the capture button). */
  readonly requestBrowserCapture: (msg: { type: "CAPTURE_PAGE" }) => Promise<CaptureResponse | undefined>;
  /** The loopback recovery client call. */
  readonly assessRecovery: (captureRef: string, bpc: BrowserPageCapture) => Promise<RecoveryClientResult>;
  /** The SAME panel-owned #50 page-context generation. Not a new counter. */
  readonly generation: { current(): number; invalidate(): number };
  /** Render the recovery result (null clears). */
  readonly setRecoveryStatus: (render: RecoveryRender | null) => void;
  /** Plain status line for precondition / pending / capture-failure messages. */
  readonly setStatusText: (text: string) => void;
}

/** Run one recovery check. Exactly one CAPTURE_PAGE request; no call without a ref. */
export async function runRecoveryCheck(deps: RecoveryButtonDeps): Promise<void> {
  const captureRef = deps.getCaptureRef();
  if (typeof captureRef !== "string" || captureRef.length === 0) {
    // Precondition: no governed held capture -> the recovery client is NOT called.
    deps.setStatusText("No held capture to check.");
    return;
  }
  // Advance + snapshot the shared page context: a newer recovery (or any #50
  // boundary) strictly supersedes this run.
  const token = deps.generation.invalidate();
  deps.button.disabled = true;
  deps.setStatusText("Assessing browser recovery…");
  try {
    const response = await deps.requestBrowserCapture({ type: "CAPTURE_PAGE" });

    // A browser-capture failure means NO recovery HTTP call is made.
    if (!response || response.type !== "PAGE_CAPTURE_RESULT") {
      if (deps.generation.current() === token) {
        deps.setStatusText(
          response && response.type === "PAGE_CAPTURE_ERROR"
            ? `Browser capture failed: ${response.reason}`
            : "Browser capture failed.",
        );
      }
      return;
    }

    // If the page context changed while the BPC was in flight, DROP before any
    // recovery projection.
    if (deps.generation.current() !== token) return;

    const bpc = response.capture;
    await runGuardedRecovery({
      token,
      currentGeneration: () => deps.generation.current(),
      assess: () => deps.assessRecovery(captureRef, bpc),
      setRecoveryStatus: deps.setRecoveryStatus,
    });
  } finally {
    deps.button.disabled = false;
  }
}

export function wireRecoveryButton(deps: RecoveryButtonDeps): void {
  deps.button.addEventListener("click", () => {
    void runRecoveryCheck(deps);
  });
}
