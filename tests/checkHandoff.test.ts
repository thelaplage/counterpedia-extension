import { describe, expect, it } from "vitest";

import {
  buildCheckHandoffUrl,
  CHECK_HANDOFF_SELECTION_MAX_CHARS,
} from "../src/lib/checkHandoff";

describe("CHECK-HANDOFF0", () => {
  it("carries the exact source URL and explicit selection into canonical Check prefill params", () => {
    const href = buildCheckHandoffUrl({
      sourceUrl: "https://example.com/report?a=1&b=2",
      selectedText: "quoted passage",
      checkBaseUrl: "https://counterpedia.vercel.app",
    });
    const url = new URL(href);

    expect(url.origin).toBe("https://counterpedia.vercel.app");
    expect(url.pathname).toBe("/check/new");
    expect(url.searchParams.get("url")).toBe("https://example.com/report?a=1&b=2");
    expect(url.searchParams.get("quote")).toBe("quoted passage");
  });

  it("does not invent optional context when none was selected", () => {
    const url = new URL(
      buildCheckHandoffUrl({ sourceUrl: "https://example.com/report" }),
    );
    expect(url.searchParams.get("url")).toBe("https://example.com/report");
    expect(url.searchParams.has("quote")).toBe(false);
    expect(url.searchParams.has("claim")).toBe(false);
  });

  it("defensively preserves the scanner's 300-character selection bound", () => {
    const selectedText = "x".repeat(CHECK_HANDOFF_SELECTION_MAX_CHARS + 50);
    const url = new URL(
      buildCheckHandoffUrl({
        sourceUrl: "https://example.com/report",
        selectedText,
      }),
    );
    expect(url.searchParams.get("quote")).toHaveLength(CHECK_HANDOFF_SELECTION_MAX_CHARS);
  });

  it("refuses non-HTTP source locators and credential-bearing locators", () => {
    expect(() => buildCheckHandoffUrl({ sourceUrl: "file:///tmp/report" })).toThrow(/HTTP/);
    expect(() =>
      buildCheckHandoffUrl({ sourceUrl: "https://user:pass@example.com/report" }),
    ).toThrow(/credentials/);
  });

  it("refuses an unsafe Check destination while allowing loopback development", () => {
    expect(() =>
      buildCheckHandoffUrl({
        sourceUrl: "https://example.com/report",
        checkBaseUrl: "http://example.com",
      }),
    ).toThrow(/HTTPS or loopback HTTP/);

    const local = new URL(
      buildCheckHandoffUrl({
        sourceUrl: "https://example.com/report",
        checkBaseUrl: "http://127.0.0.1:3000",
      }),
    );
    expect(local.origin).toBe("http://127.0.0.1:3000");
  });
});
