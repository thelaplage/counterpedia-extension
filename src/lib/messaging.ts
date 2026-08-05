/**
 * Typed chrome message protocol for the Counterpedia extension.
 */

import type { ExtensionMessage, TabChangedMessage, CheckSelectionMessage } from "../types";

export const MAX_SELECTION_LENGTH = 300;

/**
 * Validates that a value conforms to the ExtensionMessage type.
 * Returns the validated message or null if invalid.
 */
export function validateMessage(input: unknown): ExtensionMessage | null {
  if (typeof input !== "object" || input === null) return null;

  const obj = input as Record<string, unknown>;

  if (typeof obj["type"] !== "string") return null;

  switch (obj["type"]) {
    case "TAB_CHANGED": {
      if (typeof obj["url"] !== "string") return null;
      return { type: "TAB_CHANGED", url: obj["url"] } satisfies TabChangedMessage;
    }
    case "CHECK_SELECTION": {
      if (typeof obj["text"] !== "string") return null;
      // Truncate oversized selection
      const text = obj["text"].slice(0, MAX_SELECTION_LENGTH);
      return { type: "CHECK_SELECTION", text } satisfies CheckSelectionMessage;
    }
    case "CLEAR": {
      return { type: "CLEAR" };
    }
    default:
      return null;
  }
}

/**
 * Send a message to all extension panels/contexts.
 */
export function sendMessage(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Suppress "no receiver" errors — panel may not be open
  });
}
