/**
 * CHECK-TRACE0 — first HOW I GOT HERE + EXPLORE ANOTHER PATH surface.
 *
 * The trace is session scoped. It records the current query, the attributable
 * paths that were offered, and explicit path selection/deselection. It does not
 * call this Amnesiac memory and does not infer a refused path from non-selection.
 */

import { getCurrentState } from "./panel";
import { suggestInquiryPaths } from "../lib/inquiryPaths";
import {
  projectInquiryTrace,
  recordPathSelection,
  startInquiryTrace,
  type InquiryTraceSession,
} from "../lib/inquiryTrace";

let session: InquiryTraceSession | null = null;
let sessionSignature: string | null = null;

function signature(query: string, recordIds: string[]): string {
  return `${query}\n${recordIds.join("|")}`;
}

function newInquiryId(): string {
  return crypto.randomUUID();
}

function ensureSession(): void {
  const state = getCurrentState();
  if (state.kind !== "results") {
    session = null;
    sessionSignature = null;
    return;
  }

  const recordIds = state.results.map((result) => result.record_id);
  const nextSignature = signature(state.query, recordIds);
  if (session && sessionSignature === nextSignature) return;

  const suggestions = suggestInquiryPaths(state.query, state.results);
  const now = new Date().toISOString();
  session = startInquiryTrace({
    inquiryId: newInquiryId(),
    query: state.query,
    startedAt: now,
    recordIds,
    suggestions,
  });
  sessionSignature = nextSignature;
}

function eventTimeLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pathCheckbox(pathId: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `#inquiry-paths input[data-path-id="${CSS.escape(pathId)}"]`,
  );
}

function selectFromTrace(pathId: string): void {
  const checkbox = pathCheckbox(pathId);
  if (!checkbox) return;
  if (!checkbox.checked) checkbox.click();
  document.getElementById("inquiry-paths")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function ensureSection(): HTMLElement | null {
  const list = document.getElementById("results-list");
  if (!list) return null;
  let section = document.getElementById("inquiry-trace");
  if (!section) {
    section = document.createElement("section");
    section.id = "inquiry-trace";
    section.setAttribute("aria-label", "How I got here");
    section.style.margin = "10px 0";
    section.style.padding = "10px";
    section.style.border = "1px solid #e5e7eb";
    section.style.borderRadius = "6px";
    section.style.background = "#fff";
    list.parentNode?.insertBefore(section, list);
  }
  return section;
}

function renderTrace(): void {
  ensureSession();
  const section = ensureSection();
  if (!section) return;
  if (!session) {
    section.style.display = "none";
    return;
  }

  const p = projectInquiryTrace(session);
  section.style.display = "";
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "HOW I GOT HERE";
  heading.style.fontSize = "12px";
  heading.style.margin = "0 0 4px";
  section.appendChild(heading);

  const query = document.createElement("div");
  query.textContent = p.query;
  query.style.fontSize = "11px";
  query.style.fontFamily = "ui-monospace, monospace";
  query.style.color = "#374151";
  query.style.padding = "5px 7px";
  query.style.background = "#f9fafb";
  query.style.borderRadius = "4px";
  section.appendChild(query);

  const selectedHeading = document.createElement("div");
  selectedHeading.textContent = "Selected paths";
  selectedHeading.style.marginTop = "8px";
  selectedHeading.style.fontSize = "10px";
  selectedHeading.style.fontWeight = "700";
  selectedHeading.style.textTransform = "uppercase";
  selectedHeading.style.color = "#6b7280";
  section.appendChild(selectedHeading);

  const selected = document.createElement("div");
  selected.style.fontSize = "11px";
  selected.style.marginTop = "3px";
  selected.textContent =
    p.selectedPaths.length === 0
      ? "No additional path selected yet."
      : p.selectedPaths.map((path) => `✓ ${path.label}`).join(" · ");
  section.appendChild(selected);

  const anotherHeading = document.createElement("div");
  anotherHeading.textContent = "Explore another path";
  anotherHeading.style.marginTop = "9px";
  anotherHeading.style.fontSize = "10px";
  anotherHeading.style.fontWeight = "700";
  anotherHeading.style.textTransform = "uppercase";
  anotherHeading.style.color = "#6b7280";
  section.appendChild(anotherHeading);

  const note = document.createElement("p");
  note.textContent = "These were suggested but not selected. Not selected ≠ refused or irrelevant.";
  note.style.fontSize = "10px";
  note.style.color = "#6b7280";
  note.style.margin = "2px 0 4px";
  section.appendChild(note);

  const notTaken = document.createElement("div");
  notTaken.style.display = "flex";
  notTaken.style.flexWrap = "wrap";
  notTaken.style.gap = "5px";
  for (const path of p.notSelectedPaths.slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "capture-btn";
    button.textContent = `+ ${path.label}`;
    button.title = `Explore this path. Suggested by ${path.provenance.domain}.`;
    button.addEventListener("click", () => selectFromTrace(path.id));
    notTaken.appendChild(button);
  }
  if (p.notSelectedPaths.length === 0) {
    notTaken.textContent = "All currently suggested paths are selected.";
    notTaken.style.fontSize = "11px";
  }
  section.appendChild(notTaken);

  const timelineHeading = document.createElement("div");
  timelineHeading.textContent = "Inquiry trace";
  timelineHeading.style.marginTop = "9px";
  timelineHeading.style.fontSize = "10px";
  timelineHeading.style.fontWeight = "700";
  timelineHeading.style.textTransform = "uppercase";
  timelineHeading.style.color = "#6b7280";
  section.appendChild(timelineHeading);

  const timeline = document.createElement("ul");
  timeline.style.margin = "4px 0 0 16px";
  timeline.style.fontSize = "10px";
  timeline.style.color = "#6b7280";
  for (const event of p.events.slice(-8)) {
    const item = document.createElement("li");
    if (event.kind === "check_started") {
      item.textContent = `${eventTimeLabel(event.at)} — Inquiry opened with ${session.recordIds.length} Counterpedia match${session.recordIds.length === 1 ? "" : "es"}.`;
    } else if (event.kind === "path_selected") {
      item.textContent = `${eventTimeLabel(event.at)} — Selected path: ${event.pathLabel}.`;
    } else {
      item.textContent = `${eventTimeLabel(event.at)} — Removed path from this inquiry: ${event.pathLabel}.`;
    }
    timeline.appendChild(item);
  }
  section.appendChild(timeline);

  const boundary = document.createElement("p");
  boundary.textContent = "Session trace only — not Amnesiac memory, admission, or a behavioral diagnosis.";
  boundary.style.marginTop = "8px";
  boundary.style.fontSize = "9px";
  boundary.style.color = "#9ca3af";
  section.appendChild(boundary);
}

function bindPathControls(): void {
  if (!session) return;
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    "#inquiry-paths input[data-path-id]",
  );
  for (const checkbox of checkboxes) {
    if (checkbox.dataset["traceBound"] === "true") continue;
    checkbox.dataset["traceBound"] = "true";
    checkbox.addEventListener("change", () => {
      if (!session) return;
      const pathId = checkbox.dataset["pathId"];
      if (!pathId) return;
      session = recordPathSelection(session, {
        pathId,
        selected: checkbox.checked,
        at: new Date().toISOString(),
      });
      renderTrace();
    });
  }
}

function refreshTrace(): void {
  ensureSession();
  bindPathControls();
  renderTrace();
}

export function initInquiryTrace(): void {
  refreshTrace();
  const resultsList = document.getElementById("results-list");
  if (resultsList) {
    new MutationObserver(refreshTrace).observe(resultsList, { childList: true });
  }
  const paths = document.getElementById("inquiry-paths");
  if (paths) {
    new MutationObserver(refreshTrace).observe(paths, { childList: true, subtree: true });
  }
  const resultsState = document.getElementById("state-results");
  if (resultsState) {
    new MutationObserver(refreshTrace).observe(resultsState, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}
