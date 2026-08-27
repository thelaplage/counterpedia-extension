import { describe, expect, it } from "vitest";

import type { BrowserPageCapture } from "../src/lib/browserPageCapture";
import {
  observeBrowserCaptures,
  runCapture,
  type CaptureButtonLike,
} from "../src/panel/captureButton";

const CAPTURE: BrowserPageCapture = {
  artifact_type: "BrowserPageCapture",
  spec_version: "v0.1",
  requested_url: "https://example.com/a",
  current_url: "https://example.com/a",
  canonical_url: "https://example.com/a",
  document_title: "A",
  document_language: "en",
  meta_description: null,
  json_ld: [],
  selected_text: null,
  main_text: "browser observation",
  rendered_text: "browser observation",
  captured_at: "2026-08-27T00:00:00Z",
};

function button(): CaptureButtonLike {
  return {
    disabled: false,
    addEventListener() {},
  };
}

describe("capture observer reuse seam", () => {
  it("notifies downstream composition with the exact object from the single CAPTURE_PAGE request", async () => {
    let requestCount = 0;
    let observed: BrowserPageCapture | null = null;
    const unsubscribe = observeBrowserCaptures((capture) => {
      observed = capture;
    });

    try {
      await runCapture({
        button: button(),
        setStatus() {},
        sendMessage: async () => {
          requestCount += 1;
          return { type: "PAGE_CAPTURE_RESULT", capture: CAPTURE };
        },
      });
    } finally {
      unsubscribe();
    }

    expect(requestCount).toBe(1);
    expect(observed).toBe(CAPTURE);
  });

  it("unsubscribed observers receive no later captures", async () => {
    let calls = 0;
    const unsubscribe = observeBrowserCaptures(() => {
      calls += 1;
    });
    unsubscribe();

    await runCapture({
      button: button(),
      setStatus() {},
      sendMessage: async () => ({ type: "PAGE_CAPTURE_RESULT", capture: CAPTURE }),
    });

    expect(calls).toBe(0);
  });
});