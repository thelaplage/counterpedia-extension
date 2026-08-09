/**
 * Capture-button wiring — pure, DOM/chrome-free logic.
 *
 * Extracted from panel.ts so it is unit-testable in a node environment and so
 * the "one click → exactly one CAPTURE_PAGE request" invariant can be pinned by
 * a permanent test.
 *
 * Privacy / correctness invariant:
 * - A single user click registers ONE click handler that issues EXACTLY ONE
 *   `CAPTURE_PAGE` request. The resulting BrowserPageCapture is passed to
 *   `onCapture` for REUSE (e.g. by the demo panel). It is never recaptured with
 *   a second independent request.
 */

import type { BrowserPageCapture } from "../lib/browserPageCapture";

export type CaptureResponse =
  | { type: "PAGE_CAPTURE_RESULT"; capture: BrowserPageCapture }
  | { type: "PAGE_CAPTURE_ERROR"; reason: string };

/** Minimal button surface — satisfied by HTMLButtonElement and by test doubles. */
export interface CaptureButtonLike {
  disabled: boolean;
  addEventListener(type: "click", listener: () => void): void;
}

export interface CaptureButtonDeps {
  readonly button: CaptureButtonLike;
  /** Render capture status; `isError` toggles the error styling. */
  readonly setStatus: (text: string, isError: boolean) => void;
  /** Issues the single CAPTURE_PAGE request to the background service worker. */
  readonly sendMessage: (msg: { type: "CAPTURE_PAGE" }) => Promise<CaptureResponse | undefined>;
  /**
   * Receives the exact BrowserPageCapture produced by the single request, for
   * reuse by downstream surfaces (e.g. the demo panel). Never triggers a second
   * capture.
   */
  readonly onCapture?: (capture: BrowserPageCapture) => void | Promise<void>;
}

/**
 * Perform one capture: exactly one CAPTURE_PAGE request per invocation.
 * Exported for direct unit testing of the request-count invariant.
 */
export async function runCapture(deps: CaptureButtonDeps): Promise<void> {
  deps.button.disabled = true;
  deps.setStatus("Capturing…", false);

  try {
    const response = await deps.sendMessage({ type: "CAPTURE_PAGE" });

    if (!response) {
      deps.setStatus("No response from background.", true);
      return;
    }

    if (response.type === "PAGE_CAPTURE_RESULT") {
      const c = response.capture;
      deps.setStatus(`Captured: ${c.document_title || c.current_url}`, false);
      // Reuse the exact capture object — no second CAPTURE_PAGE request.
      if (deps.onCapture) await deps.onCapture(c);
    } else {
      deps.setStatus(`Error: ${response.reason}`, true);
    }
  } catch (err) {
    deps.setStatus(`Error: ${String(err)}`, true);
  } finally {
    deps.button.disabled = false;
  }
}

/**
 * Register the single click handler on the capture button. One click → one
 * `runCapture` → one CAPTURE_PAGE request.
 */
export function wireCaptureButton(deps: CaptureButtonDeps): void {
  deps.button.addEventListener("click", () => {
    void runCapture(deps);
  });
}
