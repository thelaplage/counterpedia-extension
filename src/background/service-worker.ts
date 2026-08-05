/**
 * Counterpedia Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * - Set up context menu on install
 * - Open side panel on action click
 * - Route messages to the side panel
 * - Update badge with match count
 *
 * Privacy:
 * - Never accesses page DOM, cookies, history, or referrer
 * - Only passes tab URL and explicitly selected text to the panel
 */

import { sendMessage } from "../lib/messaging";

const CONTEXT_MENU_ID = "counterpedia_check_selection";

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Check selection in Counterpedia",
    contexts: ["selection"],
  });
});

// ---------------------------------------------------------------------------
// Action click — open side panel
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId === undefined) return;
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("[Counterpedia] Failed to open side panel:", err);
  }
});

// ---------------------------------------------------------------------------
// Context menu — send selected text to panel
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener((info, _tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = info.selectionText ?? "";
  if (!selectedText.trim()) return;

  // Truncate to max 300 chars before sending
  const truncated = selectedText.slice(0, 300);
  sendMessage({ type: "CHECK_SELECTION", text: truncated });
});

// ---------------------------------------------------------------------------
// Tab events — notify panel of URL changes
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      sendMessage({ type: "TAB_CHANGED", url: tab.url });
    }
  } catch {
    // Tab may have been closed
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // Only fire when the URL is finalized (status === "complete")
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;
  if (!tab.active) return;
  sendMessage({ type: "TAB_CHANGED", url: tab.url });
});

// ---------------------------------------------------------------------------
// Badge utilities (called from panel via message, or can be called directly)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (typeof message !== "object" || message === null) return;
  const msg = message as Record<string, unknown>;

  if (msg["type"] === "SET_BADGE") {
    const count = msg["count"] as number | undefined;
    if (typeof count === "number" && count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: "#1a56db" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  }
});
