/**
 * Capture-button wiring — request-count and capture-correspondence invariants.
 *
 * These are permanent guards for D2-C:
 *  1. One capture-button click issues EXACTLY ONE CAPTURE_PAGE request.
 *  2. The demo panel REUSES the exact BrowserPageCapture object CAP1 produced
 *     (identity), rather than issuing a second independent capture.
 *  3. The digest the demo shows/sends corresponds byte-for-byte to that exact
 *     CAP1 capture — a silently rebuilt/mutated copy would produce a different
 *     digest and is refused.
 */

import { describe, it, expect, vi } from "vitest";
import { wireCaptureButton, captureErrorMessage, type CaptureResponse } from "../src/panel/captureButton";
import { captureDigest } from "../src/lib/captureDigest";
import { normalizeCaptureData } from "../src/lib/browserPageCapture";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";
import type { RawPageData } from "../src/capture/captureScript";

// ---------------------------------------------------------------------------
// Minimal button double — records click listeners; click() fires them once.
// ---------------------------------------------------------------------------

class FakeButton {
  disabled = false;
  private listeners: Array<() => void> = [];
  addEventListener(type: "click", listener: () => void): void {
    if (type === "click") this.listeners.push(listener);
  }
  click(): void {
    for (const l of this.listeners) l();
  }
}

/** Flush pending microtasks/macrotasks so the async click handler settles. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// A genuine CAP1-produced capture (via the real normalizer).
const RAW: RawPageData = {
  requested_url: "https://example.com/article?q=test",
  current_url: "https://example.com/article?q=test",
  canonical_url: "https://example.com/article",
  document_title: "Example Article",
  document_language: "en-US",
  meta_description: "An example meta description.",
  json_ld_raw: [JSON.stringify({ "@type": "Article", name: "Example Article" })],
  selected_text: "This is selected text.",
  main_text: "The main article content goes here.",
  rendered_text: "Full page rendered text.",
};
const CAP1: BrowserPageCapture = normalizeCaptureData(RAW, "2026-08-08T12:00:00.000Z");

// ---------------------------------------------------------------------------
// 1. One click → exactly one CAPTURE_PAGE request
// ---------------------------------------------------------------------------

describe("capture button — one click, one request", () => {
  it("issues exactly ONE CAPTURE_PAGE request per click", async () => {
    const sendMessage = vi.fn(
      async (): Promise<CaptureResponse> => ({ type: "PAGE_CAPTURE_RESULT", capture: CAP1 }),
    );
    const button = new FakeButton();

    wireCaptureButton({
      button,
      setStatus: () => {},
      sendMessage,
      onCapture: () => {},
    });

    button.click(); // one human click
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: "CAPTURE_PAGE" });
  });

  it("does not fan out to a second request even with a demo onCapture consumer", async () => {
    const sendMessage = vi.fn(
      async (): Promise<CaptureResponse> => ({ type: "PAGE_CAPTURE_RESULT", capture: CAP1 }),
    );
    const button = new FakeButton();
    const demoStore: { latest: BrowserPageCapture | null } = { latest: null };

    wireCaptureButton({
      button,
      setStatus: () => {},
      sendMessage,
      onCapture: (c) => {
        demoStore.latest = c;
      },
    });

    button.click();
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(demoStore.latest).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Identity: the demo store reuses the EXACT CAP1 object
// ---------------------------------------------------------------------------

describe("capture button — capture reuse (identity)", () => {
  it("hands the demo consumer the exact BrowserPageCapture object CAP1 returned", async () => {
    const sendMessage = vi.fn(
      async (): Promise<CaptureResponse> => ({ type: "PAGE_CAPTURE_RESULT", capture: CAP1 }),
    );
    const button = new FakeButton();
    let received: BrowserPageCapture | null = null;

    wireCaptureButton({
      button,
      setStatus: () => {},
      sendMessage,
      onCapture: (c) => {
        received = c;
      },
    });

    button.click();
    await flush();

    // Same reference — reused, not a cloned reconstruction.
    expect(received).toBe(CAP1);
  });
});

// ---------------------------------------------------------------------------
// 3. Capture-correspondence: sent digest === sha256 of the exact CAP1 capture
// ---------------------------------------------------------------------------

describe("capture button — digest corresponds to the exact CAP1 capture", () => {
  it("digest over the reused object equals the digest of the CAP1 capture", async () => {
    const sendMessage = vi.fn(
      async (): Promise<CaptureResponse> => ({ type: "PAGE_CAPTURE_RESULT", capture: CAP1 }),
    );
    const button = new FakeButton();
    let reused: BrowserPageCapture | null = null;

    wireCaptureButton({
      button,
      setStatus: () => {},
      sendMessage,
      onCapture: (c) => {
        reused = c;
      },
    });

    button.click();
    await flush();

    expect(reused).toBe(CAP1);
    const sentDigest = await captureDigest(reused!);
    const cap1Digest = await captureDigest(CAP1);
    expect(sentDigest).toBe(cap1Digest);
  });

  it("is identity-bound: a rebuilt/mutated copy yields a different digest", async () => {
    const cap1Digest = await captureDigest(CAP1);

    // A silently rebuilt copy with a mutated field must not share the digest.
    const mutated: BrowserPageCapture = {
      ...CAP1,
      document_title: `${CAP1.document_title} (edited)`,
    };
    expect(await captureDigest(mutated)).not.toBe(cap1Digest);

    // A faithful clone (same bytes) shares the digest — proving the digest is
    // over the exact serialized bytes, not object identity per se.
    const faithfulClone: BrowserPageCapture = JSON.parse(JSON.stringify(CAP1));
    expect(await captureDigest(faithfulClone)).toBe(cap1Digest);
  });
});

describe("captureErrorMessage", () => {
  it("maps no_active_tab to an actionable toolbar-icon instruction", () => {
    const msg = captureErrorMessage("no_active_tab");
    expect(msg).not.toBe("Error: no_active_tab");
    expect(msg).toContain("toolbar icon");
    expect(msg).toContain("Capture");
  });

  it("passes unknown reasons through verbatim", () => {
    expect(captureErrorMessage("restricted")).toBe("Error: restricted");
  });
});
