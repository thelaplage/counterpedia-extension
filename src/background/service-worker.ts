/**
 * Counterpedia Chrome Extension — Background Service Worker
 *
 * Responsibilities:
 * - Set up context menu on install
 * - Open side panel on action click
 * - Route messages to the side panel
 * - Update badge with match count
 * - When Counterpedia History is explicitly ON, record completed active-tab
 *   top-level http(s) encounters to chrome.storage.local only
 *
 * Privacy:
 * - Never accesses page DOM, cookies, referrer, or the Chrome History API
 * - Only passes tab URL and explicitly selected text to the panel
 * - CP-HISTORY0 is OFF by default and performs no passive write while OFF
 * - History records are local only; this worker performs no history telemetry
 */

import { sendMessage } from "../lib/messaging";
import { capturePageData } from "../capture/captureScript";
import { normalizeCaptureData } from "../lib/browserPageCapture";
import {
  observationFromTopLevelUrl,
  recordPassiveEncounter,
  type LocalStorageArea,
} from "../lib/history";

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
  // Only fire when the top-level page load is complete.
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;
  if (!tab.active) return;

  // Search/panel notification is unchanged by History.
  sendMessage({ type: "TAB_CHANGED", url: tab.url });

  // CP-HISTORY0: this is the sole passive write trigger in v0.1. The library
  // checks the OFF-by-default History Gate before reading/writing the ledger.
  // It does not fetch, resolve, capture, submit telemetry, or call Amnesiac.
  const observation = observationFromTopLevelUrl(tab.url);
  if (observation) {
    void recordPassiveEncounter(
      chrome.storage.local as unknown as LocalStorageArea,
      observation,
    ).catch((error: unknown) => {
      // Never log the encountered URL. A malformed/over-limit local ledger fails
      // closed and remains available for the user's explicit Clear History action.
      const reason = error instanceof Error ? error.message : "unknown";
      console.warn(`[Counterpedia] local History write refused: ${reason}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Badge utilities (called from panel via message, or can be called directly)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return false;
  const msg = message as Record<string, unknown>;

  if (msg["type"] === "SET_BADGE") {
    const count = msg["count"] as number | undefined;
    if (typeof count === "number" && count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: "#1a56db" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
    return false;
  }

  if (msg["type"] === "CAPTURE_PAGE") {
    handleCapturePage(sendResponse);
    return true; // keep message channel open for async sendResponse
  }

  return false;
});

// ---------------------------------------------------------------------------
// Page capture — user-gesture only, requires scripting + activeTab
// ---------------------------------------------------------------------------

async function handleCapturePage(
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      sendResponse({ type: "PAGE_CAPTURE_ERROR", reason: "no_active_tab" });
      return;
    }

    const results = await chrome.scripting.executeScript<[string], ReturnType<typeof capturePageData>>({
      target: { tabId: tab.id, allFrames: false },
      func: capturePageData,
      args: [tab.url],
    });

    const rawData = results[0]?.result;
    if (!rawData) {
      sendResponse({ type: "PAGE_CAPTURE_ERROR", reason: "no_result" });
      return;
    }

    const capturedAt = new Date().toISOString();
    const capture = normalizeCaptureData(rawData, capturedAt);
    sendResponse({ type: "PAGE_CAPTURE_RESULT", capture });
  } catch (err) {
    sendResponse({ type: "PAGE_CAPTURE_ERROR", reason: String(err) });
  }
}
