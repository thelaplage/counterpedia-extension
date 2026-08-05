/**
 * Counterpedia Side Panel — UI logic
 *
 * Privacy:
 * - Only receives URL from background via message (user's active tab)
 * - Only sends normalized URL or capped selection text to search
 * - Never reads page DOM, cookies, history, or referrer
 */

import { search } from "../lib/counterpediaClient";
import { normalizeUrl, isRestrictedUrl } from "../lib/search";
import { validateMessage } from "../lib/messaging";
import type { PanelState, SearchResult } from "../types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentState: PanelState = { kind: "idle" };

/** Returns the current panel state. Useful for debugging. */
export function getCurrentState(): PanelState {
  return currentState;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const STATE_IDS: Record<string, string> = {
  idle: "state-idle",
  loading: "state-loading",
  results: "state-results",
  no_match: "state-no-match",
  restricted: "state-restricted",
  unavailable: "state-unavailable",
  rate_limited: "state-rate-limited",
};

function showState(kind: PanelState["kind"]): void {
  for (const [k, id] of Object.entries(STATE_IDS)) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle("active", k === kind);
    }
  }
}

function renderResults(results: SearchResult[], query: string): void {
  const queryDisplay = document.getElementById("query-display");
  if (queryDisplay) queryDisplay.textContent = query;

  const header = document.getElementById("results-header");
  if (header) {
    header.textContent = `${results.length} record${results.length === 1 ? "" : "s"} found`;
  }

  const list = document.getElementById("results-list");
  if (!list) return;

  list.innerHTML = "";
  for (const result of results) {
    const card = document.createElement("article");
    card.className = "result-card";

    const baseUrl = "https://www.garpedia.org";
    const href = `${baseUrl}${result.record_url}`;

    card.innerHTML = `
      <a class="result-card-title" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.title)}</a>
      <div class="result-card-posture">
        <span class="posture-dot"></span>
        ${escapeHtml(result.corpus_posture_label)}
      </div>
      ${result.supported_proposition ? `<p class="result-card-proposition">${escapeHtml(result.supported_proposition)}</p>` : ""}
      ${result.top_source_labels.length > 0 ? `<div class="result-card-sources">Sources: ${escapeHtml(result.top_source_labels.join(", "))}</div>` : ""}
    `;
    list.appendChild(card);
  }
}

function setNoMatchQuery(query: string): void {
  const el = document.getElementById("no-match-query");
  if (el) el.textContent = query;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function updateBadge(count: number): void {
  chrome.runtime.sendMessage({ type: "SET_BADGE", count }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Search handler
// ---------------------------------------------------------------------------

async function runSearch(query: string): Promise<void> {
  currentState = { kind: "loading" };
  showState("loading");

  try {
    const results = await search(query);
    if (results.length > 0) {
      currentState = { kind: "results", results, query };
      showState("results");
      renderResults(results, query);
      updateBadge(results.length);
    } else {
      currentState = { kind: "no_match", query };
      showState("no_match");
      setNoMatchQuery(query);
      updateBadge(0);
    }
  } catch (err) {
    const error = err as Error;
    if (error.name === "rate_limited" || error.message === "rate_limited") {
      currentState = { kind: "rate_limited" };
      showState("rate_limited");
    } else {
      currentState = { kind: "unavailable" };
      showState("unavailable");
    }
    updateBadge(0);
  }
}

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

async function handleTabUrl(url: string): Promise<void> {
  if (isRestrictedUrl(url)) {
    currentState = { kind: "restricted" };
    showState("restricted");
    updateBadge(0);
    return;
  }

  const normalized = normalizeUrl(url);
  if (!normalized) {
    currentState = { kind: "restricted" };
    showState("restricted");
    updateBadge(0);
    return;
  }

  await runSearch(normalized);
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((rawMessage, _sender, _sendResponse) => {
  const message = validateMessage(rawMessage);
  if (!message) return;

  if (message.type === "TAB_CHANGED") {
    void handleTabUrl(message.url);
  } else if (message.type === "CHECK_SELECTION") {
    // Show user what text is being sent before searching
    const queryDisplay = document.getElementById("query-display");
    if (queryDisplay) queryDisplay.textContent = message.text;
    void runSearch(message.text);
  } else if (message.type === "CLEAR") {
    currentState = { kind: "idle" };
    showState("idle");
    updateBadge(0);
  }
});

// ---------------------------------------------------------------------------
// Init: request current tab URL on load
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      await handleTabUrl(tab.url);
    } else {
      showState("idle");
    }
  } catch {
    showState("idle");
  }
}

void init();
