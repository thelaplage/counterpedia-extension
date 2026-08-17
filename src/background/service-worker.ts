/**
 * Counterpedia Chrome Extension — Background Service Worker
 *
 * History flow:
 *   completed active top-level page
 *     -> History Gate
 *     -> attributable Collector
 *     -> fixed public source-resolution index (cached in storage.session)
 *     -> exact local HIT/MISS resolution
 *     -> local Encounter / LOCAL_ONLY corpus miss
 *
 * Privacy:
 * - Never accesses Chrome History, cookies, referrer, or page DOM for passive History.
 * - The source-resolution request is a fixed URL. The encountered URL/native ids
 *   are matched locally and are never transmitted as lookup parameters.
 * - History remains OFF by default and local Encounter content is not telemetry.
 */

import { sendMessage } from "../lib/messaging";
import { capturePageData } from "../capture/captureScript";
import { normalizeCaptureData } from "../lib/browserPageCapture";
import {
  readHistoryMode,
  recordPassiveEncounter,
  type LocalStorageArea,
} from "../lib/history";
import {
  readCollectorSettings,
  resolveCollectorObservation,
  type CollectorStorageArea,
} from "../lib/collectors";
import {
  resolveObservationWithPublicIndex,
  type SessionStorageArea,
} from "../lib/sourceResolutionClient";

const CONTEXT_MENU_ID = "counterpedia_check_selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Check selection in Counterpedia",
    contexts: ["selection"],
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId === undefined) return;
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("[Counterpedia] Failed to open side panel:", err);
  }
});

chrome.contextMenus.onClicked.addListener((info, _tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selectedText = info.selectionText ?? "";
  if (!selectedText.trim()) return;
  sendMessage({ type: "CHECK_SELECTION", text: selectedText.slice(0, 300) });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) sendMessage({ type: "TAB_CHANGED", url: tab.url });
  } catch {
    // Tab may have been closed.
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !tab.active) return;

  // Existing search/panel behavior is independent of History.
  sendMessage({ type: "TAB_CHANGED", url: tab.url });

  void recordCompletedTopLevelEncounter(tab.url).catch((error: unknown) => {
    // Never log the encountered URL.
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn(`[Counterpedia] local History write refused: ${reason}`);
  });
});

async function recordCompletedTopLevelEncounter(url: string): Promise<void> {
  const localStorage = chrome.storage.local as unknown as LocalStorageArea & CollectorStorageArea;

  // The binary History gate wins before collector specialization or resolver fetch.
  if ((await readHistoryMode(localStorage)) !== "ON") return;

  const settings = await readCollectorSettings(localStorage);
  const observation = resolveCollectorObservation(url, settings);
  if (!observation) return;

  const sessionStorage = chrome.storage.session as unknown as SessionStorageArea;
  const resolved = await resolveObservationWithPublicIndex(
    sessionStorage,
    observation,
  );

  // recordPassiveEncounter rechecks History, so a user switching OFF while the
  // fixed index request is in flight fails closed before local History mutation.
  await recordPassiveEncounter(localStorage, resolved);
}

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
    return true;
  }

  return false;
});

async function handleCapturePage(
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      sendResponse({ type: "PAGE_CAPTURE_ERROR", reason: "no_active_tab" });
      return;
    }

    const results = await chrome.scripting.executeScript<
      [string],
      ReturnType<typeof capturePageData>
    >({
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
