/**
 * CHECK-PATHS0 — consumer PATHS surface.
 *
 * In this first lane PATHS operates only over the current matched Counterpedia
 * result set. Selecting a path narrows/highlights the visible records that
 * caused that suggestion. It does not perform a new network query and does not
 * imply acceptance of any path's contents.
 */

import { getCurrentState } from "./panel";
import {
  suggestInquiryPaths,
  visibleRecordIdsForPaths,
  type InquiryPathSuggestion,
} from "../lib/inquiryPaths";
import {
  appendSavedInquiryRoute,
  buildSavedInquiryRoute,
  chromeInquiryRouteStorage,
} from "../lib/inquiryRouteStore";

let activeQuery: string | null = null;
let suggestions: InquiryPathSuggestion[] = [];
let selected = new Set<string>();
const storage = chromeInquiryRouteStorage();

function newRouteId(): string {
  return crypto.randomUUID();
}

function ensureSection(): HTMLElement | null {
  const list = document.getElementById("results-list");
  if (!list) return null;
  let section = document.getElementById("inquiry-paths");
  if (!section) {
    section = document.createElement("section");
    section.id = "inquiry-paths";
    section.setAttribute("aria-label", "Inquiry paths");
    section.style.margin = "10px 0";
    section.style.padding = "10px";
    section.style.border = "1px solid #e5e7eb";
    section.style.borderRadius = "6px";
    section.style.background = "#f9fafb";
    list.parentNode?.insertBefore(section, list);
  }
  return section;
}

function pathKindLabel(path: InquiryPathSuggestion): string {
  switch (path.kind) {
    case "structural":
      return "Counterpedia structure";
    case "record_topic":
      return "Matched record path";
    case "source_path":
      return "Source path";
  }
}

function applySelectionToCards(): number {
  const state = getCurrentState();
  if (state.kind !== "results") return 0;
  const visible = visibleRecordIdsForPaths(state.results, suggestions, selected);
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("#results-list .result-card"),
  );
  cards.forEach((card, index) => {
    const record = state.results[index];
    card.style.display = record && visible.has(record.record_id) ? "" : "none";
  });
  return visible.size;
}

function renderPathStatus(): void {
  const state = getCurrentState();
  const status = document.getElementById("inquiry-path-status");
  if (!status || state.kind !== "results") return;
  const visibleCount = applySelectionToCards();
  status.textContent =
    selected.size === 0
      ? `All ${state.results.length} current matches are visible. Select a path to explore a narrower route.`
      : `Path view: ${visibleCount} of ${state.results.length} current matches. Selecting a path chooses inquiry scope; it does not accept the path's contents.`;
}

function buildPathRow(path: InquiryPathSuggestion): HTMLElement {
  const row = document.createElement("div");
  row.style.padding = "7px 0";
  row.style.borderTop = "1px solid #e5e7eb";

  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.gap = "7px";
  label.style.alignItems = "flex-start";
  label.style.cursor = "pointer";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(path.id);
  checkbox.dataset["pathId"] = path.id;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selected.add(path.id);
    else selected.delete(path.id);
    row.style.background = checkbox.checked ? "#eff6ff" : "";
    renderPathStatus();
    const save = document.getElementById("save-inquiry-route") as HTMLButtonElement | null;
    if (save) save.disabled = selected.size === 0;
  });

  const copy = document.createElement("span");
  copy.style.flex = "1";
  const title = document.createElement("span");
  title.textContent = path.label;
  title.style.display = "block";
  title.style.fontSize = "12px";
  title.style.fontWeight = "600";
  const kind = document.createElement("span");
  kind.textContent = pathKindLabel(path);
  kind.style.display = "block";
  kind.style.fontSize = "10px";
  kind.style.color = "#6b7280";
  copy.append(title, kind);
  label.append(checkbox, copy);
  row.appendChild(label);

  const why = document.createElement("details");
  why.style.margin = "4px 0 0 24px";
  const summary = document.createElement("summary");
  summary.textContent = "Why this path?";
  summary.style.fontSize = "10px";
  summary.style.color = "#1a56db";
  summary.style.cursor = "pointer";
  why.appendChild(summary);

  const provenance = document.createElement("div");
  provenance.style.marginTop = "4px";
  provenance.style.fontSize = "10px";
  provenance.style.lineHeight = "1.45";
  provenance.style.color = "#6b7280";
  const titles = path.provenance.recordTitles.slice(0, 3).join(" · ");
  provenance.textContent = `${path.provenance.domain} · ${path.provenance.explanation} Basis: ${titles || path.provenance.recordIds.join(", ")}.`;
  why.appendChild(provenance);
  row.appendChild(why);

  return row;
}

async function saveCurrentRoute(name: string): Promise<void> {
  const state = getCurrentState();
  const status = document.getElementById("inquiry-path-save-status");
  if (!status || state.kind !== "results") return;
  try {
    const route = buildSavedInquiryRoute({
      routeId: newRouteId(),
      name,
      savedAt: new Date().toISOString(),
      baseQuery: activeQuery ?? state.query,
      suggestions,
      selectedPathIds: selected,
    });
    await appendSavedInquiryRoute(storage, route);
    status.textContent = `Saved “${route.name}” locally. This is a routing preference, not an agent or automatic future inclusion rule.`;
    status.style.color = "#059669";
  } catch {
    status.textContent = "Could not save these paths. Existing saved routes were left unchanged.";
    status.style.color = "#dc2626";
  }
}

function renderSection(): void {
  const state = getCurrentState();
  const section = ensureSection();
  if (!section) return;

  if (state.kind !== "results") {
    section.style.display = "none";
    return;
  }

  if (activeQuery !== state.query) {
    activeQuery = state.query;
    selected = new Set<string>();
  }
  suggestions = suggestInquiryPaths(activeQuery, state.results);
  const validIds = new Set(suggestions.map((path) => path.id));
  selected = new Set([...selected].filter((id) => validIds.has(id)));

  if (suggestions.length === 0) {
    section.style.display = "none";
    applySelectionToCards();
    return;
  }

  section.style.display = "";
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "PATHS";
  heading.style.fontSize = "12px";
  heading.style.margin = "0 0 3px";
  const intro = document.createElement("p");
  intro.textContent = "Choose how you want to explore these matches.";
  intro.style.fontSize = "11px";
  intro.style.margin = "0 0 3px";
  const boundary = document.createElement("p");
  boundary.textContent = "Suggestions in v0.1 come only from the current Public Counterpedia matches. Every path shows why it was suggested.";
  boundary.style.fontSize = "10px";
  boundary.style.color = "#6b7280";
  boundary.style.margin = "0 0 7px";
  section.append(heading, intro, boundary);

  for (const path of suggestions) {
    section.appendChild(buildPathRow(path));
  }

  const status = document.createElement("p");
  status.id = "inquiry-path-status";
  status.style.fontSize = "10px";
  status.style.color = "#6b7280";
  status.style.margin = "8px 0";
  section.appendChild(status);

  const name = document.createElement("input");
  name.id = "inquiry-route-name";
  name.type = "text";
  name.maxLength = 120;
  name.placeholder = "Name these paths (optional)";
  name.style.width = "100%";
  name.style.padding = "6px 8px";
  name.style.border = "1px solid #e5e7eb";
  name.style.borderRadius = "4px";
  name.style.fontSize = "11px";
  section.appendChild(name);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "6px";
  controls.style.marginTop = "6px";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "capture-btn";
  clear.textContent = "Clear paths";
  clear.addEventListener("click", () => {
    selected.clear();
    renderSection();
  });

  const save = document.createElement("button");
  save.id = "save-inquiry-route";
  save.type = "button";
  save.className = "capture-btn";
  save.textContent = "Save these paths";
  save.disabled = selected.size === 0;
  save.addEventListener("click", () => {
    const routeName = name.value.trim() || `Paths: ${(activeQuery ?? state.query).slice(0, 72)}`;
    void saveCurrentRoute(routeName);
  });
  controls.append(clear, save);
  section.appendChild(controls);

  const saveStatus = document.createElement("p");
  saveStatus.id = "inquiry-path-save-status";
  saveStatus.style.fontSize = "10px";
  saveStatus.style.marginTop = "5px";
  section.appendChild(saveStatus);

  renderPathStatus();
}

export function initInquiryPaths(): void {
  renderSection();
  const resultsList = document.getElementById("results-list");
  if (resultsList) {
    new MutationObserver(renderSection).observe(resultsList, { childList: true });
  }
  const resultsState = document.getElementById("state-results");
  if (resultsState) {
    new MutationObserver(renderSection).observe(resultsState, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}
