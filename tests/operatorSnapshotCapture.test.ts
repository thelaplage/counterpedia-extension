import { describe, expect, it } from "vitest";

import {
  normalizeExpectedUrl,
  requireStableCapturedLocator,
} from "../src/panel/operatorSnapshotCapture";

describe("OPERATOR-BROWSER0 capture provenance guards", () => {
  it("preserves absence of a task-supplied expected locator", () => {
    expect(normalizeExpectedUrl(null)).toBeNull();
  });

  it("accepts only HTTP(S) expected locators", () => {
    expect(normalizeExpectedUrl("https://example.org/source")).toBe(
      "https://example.org/source",
    );
    expect(() => normalizeExpectedUrl("file:///tmp/source.html")).toThrow(/HTTP\(S\)/);
  });

  it("keeps the captured locator only when the tab stayed on the same page", () => {
    expect(
      requireStableCapturedLocator(
        "https://example.org/source",
        "https://example.org/source",
      ),
    ).toBe("https://example.org/source");
  });

  it("fails closed if the tab navigated while Chrome generated MHTML", () => {
    expect(() =>
      requireStableCapturedLocator(
        "https://example.org/source",
        "https://example.org/other",
      ),
    ).toThrow(/navigated.*mismatched bytes\/locator provenance/i);
  });
});
