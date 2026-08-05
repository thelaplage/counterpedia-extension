/**
 * Message validation tests.
 */

import { describe, it, expect } from "vitest";
import { validateMessage, MAX_SELECTION_LENGTH } from "../src/lib/messaging";

describe("validateMessage", () => {
  describe("TAB_CHANGED", () => {
    it("accepts a valid TAB_CHANGED message", () => {
      const result = validateMessage({ type: "TAB_CHANGED", url: "https://example.com" });
      expect(result).toEqual({ type: "TAB_CHANGED", url: "https://example.com" });
    });

    it("rejects TAB_CHANGED with missing url", () => {
      expect(validateMessage({ type: "TAB_CHANGED" })).toBeNull();
    });

    it("rejects TAB_CHANGED with non-string url", () => {
      expect(validateMessage({ type: "TAB_CHANGED", url: 42 })).toBeNull();
    });
  });

  describe("CHECK_SELECTION", () => {
    it("accepts a valid CHECK_SELECTION message", () => {
      const result = validateMessage({ type: "CHECK_SELECTION", text: "some selected text" });
      expect(result).toEqual({ type: "CHECK_SELECTION", text: "some selected text" });
    });

    it("truncates oversized selectedText to 300 chars", () => {
      const longText = "a".repeat(500);
      const result = validateMessage({ type: "CHECK_SELECTION", text: longText });
      expect(result).not.toBeNull();
      if (result?.type === "CHECK_SELECTION") {
        expect(result.text.length).toBe(MAX_SELECTION_LENGTH);
      }
    });

    it("rejects CHECK_SELECTION with missing text", () => {
      expect(validateMessage({ type: "CHECK_SELECTION" })).toBeNull();
    });

    it("rejects CHECK_SELECTION with non-string text", () => {
      expect(validateMessage({ type: "CHECK_SELECTION", text: 123 })).toBeNull();
    });
  });

  describe("CLEAR", () => {
    it("accepts a CLEAR message", () => {
      expect(validateMessage({ type: "CLEAR" })).toEqual({ type: "CLEAR" });
    });
  });

  describe("Invalid messages", () => {
    it("rejects unknown message type", () => {
      expect(validateMessage({ type: "UNKNOWN_TYPE" })).toBeNull();
    });

    it("rejects null input", () => {
      expect(validateMessage(null)).toBeNull();
    });

    it("rejects non-object input (string)", () => {
      expect(validateMessage("hello")).toBeNull();
    });

    it("rejects non-object input (number)", () => {
      expect(validateMessage(42)).toBeNull();
    });

    it("rejects message with no type field", () => {
      expect(validateMessage({ url: "https://example.com" })).toBeNull();
    });

    it("rejects message with non-string type", () => {
      expect(validateMessage({ type: 123 })).toBeNull();
    });
  });
});
