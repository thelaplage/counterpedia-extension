import { resolveCollectorObservation } from "../lib/collectors";
import { loadSourceResolutionIndex } from "../lib/sourceResolutionClient";
import {
  buildWikipediaReferenceFrontier,
  classifyWikipediaReferenceUrls,
  harvestWikipediaReferences,
  persistWikipediaReferenceFrontier,
  type ClassifiedWikipediaSource,
  type WikipediaReferenceManifest,
} from "../lib/wikipediaHarvestBridge";
import { validateMessage } from "../lib/messaging";

const SECTION_ID = "wikipedia-harvest-section";
const MAX_RENDERED_SOURCES = 250;

interface HarvestPanelState {
  pageUrl: string | null;
  manifest: WikipediaReferenceManifest | null;
  classified: ClassifiedWikipediaSource[];
}

const state: HarvestPanelState = {
  pageUrl: null,
  manifest: null,
  classified: [],
};

function teamBetaEnabled(): boolean {
  const manifest = chrome.runtime.getManifest() as unknown as Record<string, unknown>;
  return manifest["_local_companion_dev"] === true;
}

function wikipediaPageUrl(rawUrl: string): string | null {
  const observation = resolveCollectorObservation(rawUrl);
  return observation?.collector_id === "wikipedia_v0_1"
    ? observation.canonical_locator ?? observation.observed_url
    : null;
}

function makeButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.font = "inherit";
  button.style.border = "1px solid #8ca09a";
  button.style.borderRadius = "7px";
  button.style.background = "#fff";
  button.style.padding = "7px 10px";
  button.style.cursor = "pointer";
  return button;
}

function buildSection(): {
  section: HTMLElement;
  status: HTMLElement;
  harvest: HTMLButtonElement;
  summary: HTMLElement;
  list: HTMLElement;
  queue: HTMLButtonElement;
  queueNote: HTMLElement;
} {
  const section = document.createElement("section");
  section.id = SECTION_ID;
  section.setAttribute("aria-label", "Wikipedia reference harvest");
  section.style.border = "1px solid #d7dfdc";
  section.style.borderRadius = "9px";
  section.style.padding = "10px 12px";
  section.style.marginBottom = "12px";
  section.style.background = "#fbfcfb";
  section.style.display = "none";

  const title = document.createElement("div");
  title.textContent = "Wikipedia references";
  title.style.fontWeight = "600";
  title.style.marginBottom = "4px";

  const boundary = document.createElement("div");
  boundary.textContent =
    "Explicit discovery only · exact revision · Wikipedia citation ≠ Counterpedia evidence";
  boundary.style.fontSize = "11px";
  boundary.style.color = "#687572";
  boundary.style.marginBottom = "8px";

  const status = document.createElement("div");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Ready to harvest this Wikipedia page.";
  status.style.fontSize = "12px";
  status.style.color = "#53615e";
  status.style.marginBottom = "8px";

  const harvest = makeButton("Harvest references");
  harvest.title = "Use Counterpedia Local to run the merged ACQ-WIKI0 harvester";

  const summary = document.createElement("div");
  summary.style.fontSize = "12px";
  summary.style.margin = "9px 0 6px";
  summary.style.display = "none";

  const list = document.createElement("div");
  list.style.maxHeight = "300px";
  list.style.overflow = "auto";
  list.style.borderTop = "1px solid #e5e9e7";
  list.style.display = "none";

  const queue = makeButton("Queue selected locally");
  queue.style.marginTop = "8px";
  queue.style.display = "none";

  const queueNote = document.createElement("div");
  queueNote.textContent = "Local discovery frontier only · capture not attempted";
  queueNote.style.fontSize = "11px";
  queueNote.style.color = "#687572";
  queueNote.style.marginTop = "5px";
  queueNote.style.display = "none";

  section.append(title, boundary, status, harvest, summary, list, queue, queueNote);
  return { section, status, harvest, summary, list, queue, queueNote };
}

function firstOccurrenceByUrl(
  manifest: WikipediaReferenceManifest,
): Map<string, WikipediaReferenceManifest["references"][number]> {
  const first = new Map<string, WikipediaReferenceManifest["references"][number]>();
  for (const ref of manifest.references) {
    if (ref.source_url && !first.has(ref.source_url)) first.set(ref.source_url, ref);
  }
  return first;
}

function statusLabel(source: ClassifiedWikipediaSource): string {
  switch (source.status) {
    case "KNOWN":
      return source.corpus_presence ? `Known · ${source.corpus_presence}` : "Known";
    case "NEW":
      return "New to current source index";
    case "AMBIGUOUS":
      return "Hold · identity ambiguous";
    case "UNRESOLVED":
      return "Hold · index unavailable/unresolved";
  }
}

function renderHarvest(
  ui: ReturnType<typeof buildSection>,
  manifest: WikipediaReferenceManifest,
  classified: ClassifiedWikipediaSource[],
): void {
  const known = classified.filter((source) => source.status === "KNOWN").length;
  const fresh = classified.filter((source) => source.status === "NEW").length;
  const held = classified.length - known - fresh;
  ui.summary.style.display = "";
  ui.summary.textContent =
    `Revision ${manifest.page.revision_id} · ${manifest.counts.reference_occurrences} reference occurrences · ` +
    `${manifest.counts.unique_source_urls} unique source URLs · ${known} known · ${fresh} new · ${held} held`;

  const first = firstOccurrenceByUrl(manifest);
  ui.list.innerHTML = "";
  ui.list.style.display = "";

  for (const source of classified.slice(0, MAX_RENDERED_SOURCES)) {
    const ref = first.get(source.url);
    const row = document.createElement("label");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "18px minmax(0,1fr)";
    row.style.gap = "7px";
    row.style.padding = "7px 0";
    row.style.borderBottom = "1px solid #eef1f0";
    row.style.cursor = source.status === "NEW" ? "pointer" : "default";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset["sourceUrl"] = source.url;
    checkbox.checked = source.status === "NEW";
    checkbox.disabled = source.status !== "NEW";
    checkbox.setAttribute("aria-label", `Select ${source.url}`);

    const content = document.createElement("span");
    const title = document.createElement("span");
    title.style.display = "block";
    title.style.fontWeight = "500";
    title.textContent = ref?.title ?? ref?.work ?? source.url;

    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.url;
    link.style.display = "block";
    link.style.fontSize = "11px";
    link.style.wordBreak = "break-all";

    const posture = document.createElement("span");
    posture.textContent = statusLabel(source);
    posture.style.display = "block";
    posture.style.fontSize = "11px";
    posture.style.color = source.status === "NEW" ? "#177245" : "#687572";

    content.append(title, link, posture);
    row.append(checkbox, content);
    ui.list.appendChild(row);
  }

  if (classified.length > MAX_RENDERED_SOURCES) {
    const truncated = document.createElement("div");
    truncated.textContent =
      `Showing the first ${MAX_RENDERED_SOURCES} of ${classified.length} source URLs. The exact manifest remains intact in memory.`;
    truncated.style.fontSize = "11px";
    truncated.style.color = "#687572";
    truncated.style.padding = "7px 0";
    ui.list.appendChild(truncated);
  }

  ui.queue.style.display = fresh > 0 ? "" : "none";
  ui.queueNote.style.display = fresh > 0 ? "" : "none";
}

async function classifyManifest(
  manifest: WikipediaReferenceManifest,
): Promise<ClassifiedWikipediaSource[]> {
  try {
    const index = await loadSourceResolutionIndex(chrome.storage.session);
    return classifyWikipediaReferenceUrls(manifest, index);
  } catch {
    return classifyWikipediaReferenceUrls(manifest, null);
  }
}

function selectedSources(
  ui: ReturnType<typeof buildSection>,
  classified: ClassifiedWikipediaSource[],
): ClassifiedWikipediaSource[] {
  const selectedUrls = new Set(
    Array.from(
      ui.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-source-url]'),
    )
      .filter((input) => input.checked && !input.disabled)
      .map((input) => input.dataset["sourceUrl"] ?? ""),
  );
  return classified.filter((source) => selectedUrls.has(source.url));
}

async function refreshForUrl(
  ui: ReturnType<typeof buildSection>,
  rawUrl: string | null,
): Promise<void> {
  const pageUrl = rawUrl ? wikipediaPageUrl(rawUrl) : null;
  state.pageUrl = pageUrl;
  state.manifest = null;
  state.classified = [];
  ui.list.innerHTML = "";
  ui.list.style.display = "none";
  ui.summary.style.display = "none";
  ui.queue.style.display = "none";
  ui.queueNote.style.display = "none";
  ui.harvest.disabled = false;
  ui.status.textContent = "Ready to harvest this Wikipedia page.";
  ui.section.style.display = pageUrl ? "" : "none";
}

export async function initWikipediaHarvestPanel(): Promise<void> {
  if (!teamBetaEnabled()) return;
  if (document.getElementById(SECTION_ID)) return;
  const content = document.querySelector(".panel-content");
  if (!content) return;

  const ui = buildSection();
  content.prepend(ui.section);

  ui.harvest.addEventListener("click", () => {
    void (async () => {
      const requestedPageUrl = state.pageUrl;
      if (!requestedPageUrl) return;
      ui.harvest.disabled = true;
      ui.status.textContent = "Harvesting exact MediaWiki revision through Counterpedia Local…";
      try {
        const manifest = await harvestWikipediaReferences(requestedPageUrl);
        // Refuse a late response from a page that is no longer active. A normal
        // MediaWiki redirect is allowed: the producer may return a different
        // canonical page URL while the browser is still on the original request.
        if (state.pageUrl !== requestedPageUrl) {
          ui.status.textContent = "Page changed before harvest completed; result not applied.";
          return;
        }
        const classified = await classifyManifest(manifest);
        if (state.pageUrl !== requestedPageUrl) {
          ui.status.textContent = "Page changed before classification completed; result not applied.";
          return;
        }
        state.manifest = manifest;
        state.classified = classified;
        renderHarvest(ui, manifest, classified);
        ui.status.textContent =
          "Harvest complete. Classification is exact local source-index presence, not evidence support.";
      } catch (err) {
        ui.status.textContent =
          err instanceof Error
            ? `Wikipedia harvest unavailable: ${err.message}`
            : "Wikipedia harvest unavailable.";
      } finally {
        ui.harvest.disabled = false;
      }
    })();
  });

  ui.queue.addEventListener("click", () => {
    void (async () => {
      if (!state.manifest) return;
      const selected = selectedSources(ui, state.classified);
      if (selected.length === 0) {
        ui.status.textContent = "No new source URLs selected.";
        return;
      }
      const frontier = buildWikipediaReferenceFrontier(state.manifest, selected);
      await persistWikipediaReferenceFrontier(chrome.storage.local, frontier);
      ui.status.textContent =
        `Queued ${selected.length} source URL${selected.length === 1 ? "" : "s"} locally for the next acquisition step · capture not attempted.`;
    })();
  });

  chrome.runtime.onMessage.addListener((rawMessage) => {
    const message = validateMessage(rawMessage);
    if (!message) return;
    if (message.type === "TAB_CHANGED") {
      void refreshForUrl(ui, message.url);
    } else if (message.type === "CLEAR") {
      void refreshForUrl(ui, null);
    }
  });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await refreshForUrl(ui, tab?.url ?? null);
  } catch {
    await refreshForUrl(ui, null);
  }
}
