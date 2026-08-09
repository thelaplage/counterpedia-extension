/**
 * Counterpedia Side Panel — UI logic
 *
 * Privacy:
 * - Only receives URL from background via message (user's active tab)
 * - Only sends normalized URL or capped selection text to search
 * - Never reads page DOM, cookies, history, or referrer
 */

import { search } from "../lib/counterpediaClient";
import { getActivityFeed } from "../lib/activityClient";
import { normalizeUrl, isRestrictedUrl } from "../lib/search";
import { validateMessage } from "../lib/messaging";
import type { PanelState, SearchResult } from "../types";
import type {
  ActivityFeedProjection,
  ActivityFeedLaneProjection,
  LaneEmptyReason,
} from "../lib/activityFeedModel";
import type { BrowserPageCapture } from "../lib/browserPageCapture";

const COUNTERPEDIA_BASE_URL = "https://www.garpedia.org";

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
// Activity feed rendering
//
// The feed is a read-only projection over admitted PUBLIC activity receipts,
// independent of the current tab. It preserves the ACT2 invariants verbatim:
// every line names its receipt basis and links to it; NO aggregate/score is
// shown; an empty feed states which substrates and window it inspected, keeping
// inspected-empty distinct from not-inspected. No activity is synthesized — the
// real fetched index is rendered, honest-empty when it carries no receipts.
// ---------------------------------------------------------------------------

const EMPTY_REASON_LABEL: Record<LaneEmptyReason, string> = {
  no_activity_recorded: "Inspected — no activity recorded",
  not_inspected: "Not inspected",
};

function setActivityStatus(message: string): void {
  const el = document.getElementById("activity-status");
  if (el) el.textContent = message;
}

function renderActivityLane(lane: ActivityFeedLaneProjection): HTMLElement {
  const section = document.createElement("div");
  section.className = "activity-lane";

  const title = document.createElement("div");
  title.className = "activity-lane-title";
  title.textContent = lane.title;
  section.appendChild(title);

  if (lane.lines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "activity-lane-empty";
    // Absence discipline: state WHY the lane is empty, distinguishing
    // inspected-empty from not-inspected.
    const reason = lane.empty_reason ?? "not_inspected";
    empty.textContent = EMPTY_REASON_LABEL[reason];
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "activity-line-list";
  for (const line of lane.lines) {
    const item = document.createElement("li");
    item.className = "activity-line";

    const summary = document.createElement("span");
    summary.className = "activity-line-summary";
    summary.textContent = line.summary;
    item.appendChild(summary);

    const time = document.createElement("span");
    time.className = "activity-line-time";
    time.textContent = line.event_time;
    item.appendChild(time);

    // basis-descent: every line names its receipt basis and links to it.
    const basis = document.createElement("a");
    basis.className = "activity-line-basis";
    basis.href = `${COUNTERPEDIA_BASE_URL}${line.descend_ref}`;
    basis.target = "_blank";
    basis.rel = "noopener noreferrer";
    basis.textContent = `Basis: ${line.basis_receipt_id}`;
    item.appendChild(basis);

    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function renderActivityFeedView(feed: ActivityFeedProjection): void {
  // Claim boundary, stated on the surface.
  const boundary = document.getElementById("activity-boundary");
  if (boundary) boundary.textContent = feed.claim_boundary;

  // Inspection scope, so an empty feed is honest about what it looked at.
  const scope = document.getElementById("activity-scope");
  if (scope) {
    scope.textContent = `Inspected ${feed.inspection.substrates.join(", ")} over window: ${feed.inspection.window} (${feed.inspection.receipts_inspected} public receipt${feed.inspection.receipts_inspected === 1 ? "" : "s"} inspected).`;
  }

  const lanesEl = document.getElementById("activity-lanes");
  if (lanesEl) {
    lanesEl.innerHTML = "";
    for (const lane of feed.lanes) {
      lanesEl.appendChild(renderActivityLane(lane));
    }
  }

  const emptyEl = document.getElementById("activity-empty");
  if (emptyEl) {
    emptyEl.textContent = feed.is_empty
      ? "No PUBLIC activity has been recorded in the inspected substrates yet."
      : "";
  }

  // Explicit no-aggregate notice (C6 / ACT0 §3).
  const note = document.getElementById("activity-no-aggregate");
  if (note) note.textContent = feed.no_aggregate_notice;

  setActivityStatus("");
}

async function loadActivityFeed(): Promise<void> {
  setActivityStatus("Loading activity…");
  try {
    const feed = await getActivityFeed();
    renderActivityFeedView(feed);
  } catch (err) {
    const error = err as Error;
    if (error.name === "rate_limited" || error.message === "rate_limited") {
      setActivityStatus("Activity feed: too many requests. Please wait a moment.");
    } else {
      setActivityStatus("Activity feed unavailable. Please try again.");
    }
  }
}

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
void loadActivityFeed();

// ---------------------------------------------------------------------------
// Page capture — explicit user gesture only
// ---------------------------------------------------------------------------

type CaptureResponse =
  | { type: "PAGE_CAPTURE_RESULT"; capture: BrowserPageCapture }
  | { type: "PAGE_CAPTURE_ERROR"; reason: string };

function initCaptureButton(): void {
  const btn = document.getElementById("capture-btn") as HTMLButtonElement | null;
  const status = document.getElementById("capture-status");
  if (!btn || !status) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Capturing…";
    status.className = "capture-status";

    try {
      const response = await chrome.runtime.sendMessage({ type: "CAPTURE_PAGE" }) as CaptureResponse | undefined;

      if (!response) {
        status.className = "capture-status error";
        status.textContent = "No response from background.";
        return;
      }

      if (response.type === "PAGE_CAPTURE_RESULT") {
        const c = response.capture;
        status.textContent = `Captured: ${c.document_title || c.current_url}`;
        status.className = "capture-status";
      } else {
        status.className = "capture-status error";
        status.textContent = `Error: ${response.reason}`;
      }
    } catch (err) {
      status.className = "capture-status error";
      status.textContent = `Error: ${String(err)}`;
    } finally {
      btn.disabled = false;
    }
  });
}

initCaptureButton();

// ---------------------------------------------------------------------------
// Demo panel — only active in demo builds (_demo_mode === true in manifest)
// ---------------------------------------------------------------------------

import { initDemoPanel } from "./panel.demo";

/**
 * Shared capture store. Updated by the demo capture listener below.
 * initCaptureButton() is unchanged — the demo listener runs independently
 * on the same button, sending its own CAPTURE_PAGE message to background.
 */
const demoCaptureStore: { latest: BrowserPageCapture | null } = { latest: null };

initDemoPanel(demoCaptureStore);

// Add a second click listener on capture-btn. When demo mode is active this
// listener fires alongside the existing one and stores the capture result so
// initDemoPanel can show the demo send UI. In production builds _demo_mode is
// false so initDemoPanel() returns early and no network calls are made.
(function wireDemo(): void {
  const btn = document.getElementById("capture-btn") as HTMLButtonElement | null;
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "CAPTURE_PAGE" }) as CaptureResponse | undefined;
      if (response?.type === "PAGE_CAPTURE_RESULT") {
        demoCaptureStore.latest = response.capture;
        // Ask the demo section to refresh its capture display
        const section = document.getElementById("demo-section") as
          | (HTMLElement & { refreshCaptureInfo?: () => Promise<void> })
          | null;
        if (section?.refreshCaptureInfo) {
          await section.refreshCaptureInfo();
        }
      }
    } catch {
      // Demo listener: silently swallow errors
    }
  });
})();
