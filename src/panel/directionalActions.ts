/**
 * CHECK-ACTIONS0 — progressive directional actions for the side panel.
 *
 * Only KEEP is newly operative in v0.1. It writes a bounded local research
 * trail to chrome.storage.local. No network request is made and no Amnesiac
 * admission is claimed. USE / PUBLISH / SHARE / REFUSE remain mechanically
 * HELD until their governed owners are wired.
 */

import { getCurrentState } from "./panel";
import { projectDirectionalActions } from "../lib/directionalActions";
import {
  appendLocalResearchTrail,
  buildCheckTrailEntry,
  buildRecordTrailEntry,
  buildSourceTrailEntry,
  chromeLocalResearchTrailStorage,
  type LocalSourceSnapshot,
} from "../lib/localResearchTrail";
import type { SearchResult } from "../types";

const storage = chromeLocalResearchTrailStorage();

function now(): string {
  return new Date().toISOString();
}

function newEntryId(): string {
  return crypto.randomUUID();
}

function getSourceSnapshot(): LocalSourceSnapshot | null {
  const section = document.getElementById("source-workbench");
  const url = document.getElementById("sw-url") as HTMLAnchorElement | null;
  if (!section || section.style.display === "none" || !url?.href) return null;

  const title = document.getElementById("sw-title")?.textContent?.trim() || null;
  const observation = document.getElementById("sw-posture-observation");
  return {
    current_url: url.href,
    canonical_url: null,
    title,
    observed_in_browser: observation?.dataset["posture"] === "observed",
  };
}

function setActionStatus(message: string, isError = false): void {
  const status = document.getElementById("check-action-status");
  if (!status) return;
  status.textContent = message;
  status.className = isError ? "capture-status error" : "capture-status";
}

async function keepWholeCheck(): Promise<void> {
  const state = getCurrentState();
  if (state.kind !== "results") {
    const source = getSourceSnapshot();
    if (!source) {
      setActionStatus("Nothing to keep yet.", true);
      return;
    }
    const entry = buildSourceTrailEntry({
      entryId: newEntryId(),
      keptAt: now(),
      source,
    });
    await appendLocalResearchTrail(storage, entry);
    setActionStatus(
      "Source kept locally — research trail only. Agent memory admission not performed.",
    );
    return;
  }

  const entry = buildCheckTrailEntry({
    entryId: newEntryId(),
    keptAt: now(),
    query: state.query,
    records: state.results,
    source: getSourceSnapshot(),
  });
  await appendLocalResearchTrail(storage, entry);
  setActionStatus(
    `Check kept locally (${state.results.length} record${state.results.length === 1 ? "" : "s"}) — agent memory admission not performed.`,
  );
}

async function keepRecord(result: SearchResult, query: string): Promise<void> {
  const entry = buildRecordTrailEntry({
    entryId: newEntryId(),
    keptAt: now(),
    query,
    record: result,
    source: getSourceSnapshot(),
  });
  await appendLocalResearchTrail(storage, entry);
  setActionStatus(
    `Kept “${result.title}” locally — research trail only.`,
  );
}

async function keepSource(): Promise<void> {
  const source = getSourceSnapshot();
  if (!source) {
    setActionStatus("No source is available to keep.", true);
    return;
  }
  const entry = buildSourceTrailEntry({
    entryId: newEntryId(),
    keptAt: now(),
    source,
  });
  await appendLocalResearchTrail(storage, entry);
  setActionStatus(
    "Source kept locally — no publication, network egress, or memory admission performed.",
  );
}

function wrapKeep(action: () => Promise<void>): void {
  void action().catch(() => {
    setActionStatus("Could not keep this locally. Existing research trail was left unchanged.", true);
  });
}

function ensureActionRail(): HTMLElement {
  const existing = document.getElementById("check-action-rail");
  if (existing) return existing;

  const rail = document.createElement("section");
  rail.id = "check-action-rail";
  rail.className = "capture-bar";
  rail.setAttribute("aria-label", "Counterpedia actions");
  rail.style.flexWrap = "wrap";

  const header = document.querySelector(".panel-header");
  if (header?.parentNode) {
    header.parentNode.insertBefore(rail, header.nextSibling);
  }

  const status = document.createElement("span");
  status.id = "check-action-status";
  status.className = "capture-status";
  status.style.flexBasis = "100%";
  status.textContent = "CHECK finds structure. KEEP preserves the structured result locally.";
  rail.appendChild(status);
  return rail;
}

function renderActionRail(): void {
  const rail = ensureActionRail();
  const status = document.getElementById("check-action-status");
  const state = getCurrentState();
  const source = getSourceSnapshot();
  const actions = projectDirectionalActions({
    hasCheckMaterial: state.kind === "results" || state.kind === "no_match",
    hasKeepableMaterial: state.kind === "results" || source !== null,
  });

  for (const prior of Array.from(rail.querySelectorAll("[data-action-id]"))) {
    prior.remove();
  }

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "capture-btn";
    button.dataset["actionId"] = action.id;
    button.textContent = action.label;
    button.title = action.holdReason ?? action.description;

    if (action.id === "keep" && action.state === "available") {
      button.addEventListener("click", () => wrapKeep(keepWholeCheck));
    } else {
      button.disabled = true;
    }

    if (action.state === "current") {
      button.setAttribute("aria-current", "true");
      button.title = action.description;
    }
    rail.insertBefore(button, status);
  }
}

function decorateResultCards(): void {
  const state = getCurrentState();
  if (state.kind !== "results") return;
  const list = document.getElementById("results-list");
  if (!list) return;

  const cards = Array.from(list.querySelectorAll<HTMLElement>(".result-card"));
  cards.forEach((card, index) => {
    if (card.querySelector("[data-keep-record]")) return;
    const result = state.results[index];
    if (!result) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "capture-btn";
    button.dataset["keepRecord"] = result.record_id;
    button.textContent = "Keep this";
    button.style.marginTop = "8px";
    button.addEventListener("click", () => {
      wrapKeep(async () => {
        await keepRecord(result, state.query);
        button.textContent = "Kept ✓";
        button.disabled = true;
      });
    });
    card.appendChild(button);
  });
}

function ensureKeepSourceButton(): void {
  const actions = document.querySelector("#source-workbench .sw-actions");
  if (!actions || actions.querySelector("[data-keep-source]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "capture-btn";
  button.dataset["keepSource"] = "true";
  button.textContent = "Keep source";
  button.addEventListener("click", () => {
    wrapKeep(async () => {
      await keepSource();
      button.textContent = "Source kept ✓";
      button.disabled = true;
    });
  });
  actions.appendChild(button);
}

function refreshDirectionalActions(): void {
  renderActionRail();
  decorateResultCards();
  ensureKeepSourceButton();
}

export function initDirectionalActions(): void {
  refreshDirectionalActions();

  const resultsList = document.getElementById("results-list");
  if (resultsList) {
    new MutationObserver(refreshDirectionalActions).observe(resultsList, {
      childList: true,
    });
  }

  const resultsState = document.getElementById("state-results");
  if (resultsState) {
    new MutationObserver(refreshDirectionalActions).observe(resultsState, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  const sourceWorkbench = document.getElementById("source-workbench");
  if (sourceWorkbench) {
    new MutationObserver(refreshDirectionalActions).observe(sourceWorkbench, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: false,
    });
  }
}
