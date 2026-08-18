import {
  buildWikipediaCaptureRun,
  captureWikipediaFrontierUrl,
  persistWikipediaCaptureRun,
  readWikipediaReferenceFrontier,
} from "../lib/wikipediaFrontierCapture";
import type { AcquisitionCaptureResult } from "../lib/acquisitionResponseGuard";
import { selectGovernedSource } from "../lib/governedSourceSelection";
import { WIKIPEDIA_REFERENCE_FRONTIER_KEY } from "../lib/wikipediaHarvestBridge";

const SECTION_ID = "wikipedia-frontier-capture-section";
const MAX_CAPTURE_PER_RUN = 25;
const MAX_RENDERED = 100;

function teamBetaEnabled(): boolean {
  const manifest = chrome.runtime.getManifest() as unknown as Record<string, unknown>;
  return manifest["_local_companion_dev"] === true;
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

function buildSection() {
  const section = document.createElement("section");
  section.id = SECTION_ID;
  section.setAttribute("aria-label", "Wikipedia source capture frontier");
  section.style.border = "1px solid #d7dfdc";
  section.style.borderRadius = "9px";
  section.style.padding = "10px 12px";
  section.style.marginBottom = "12px";
  section.style.background = "#fbfcfb";
  section.style.display = "none";

  const title = document.createElement("div");
  title.textContent = "Wikipedia source capture";
  title.style.fontWeight = "600";
  title.style.marginBottom = "4px";

  const boundary = document.createElement("div");
  boundary.textContent =
    "Explicit producer capture · real CaptureReceipts · capture ≠ evidence support or admission";
  boundary.style.fontSize = "11px";
  boundary.style.color = "#687572";
  boundary.style.marginBottom = "7px";

  const context = document.createElement("div");
  context.style.fontSize = "12px";
  context.style.marginBottom = "7px";

  const status = document.createElement("div");
  status.setAttribute("aria-live", "polite");
  status.style.fontSize = "12px";
  status.style.color = "#53615e";
  status.style.marginBottom = "7px";

  const list = document.createElement("div");
  list.style.maxHeight = "260px";
  list.style.overflow = "auto";
  list.style.borderTop = "1px solid #e5e9e7";

  const capture = makeButton("Capture selected sources");
  capture.style.marginTop = "8px";

  const note = document.createElement("div");
  note.textContent =
    `Maximum ${MAX_CAPTURE_PER_RUN} explicit captures per click. No crawl or recursion. ` +
    "A successful capture may be selected for the separate existing Draft-from-source act.";
  note.style.fontSize = "11px";
  note.style.color = "#687572";
  note.style.marginTop = "5px";

  const results = document.createElement("div");
  results.style.marginTop = "8px";
  results.style.fontSize = "11px";

  section.append(title, boundary, context, status, list, capture, note, results);
  return { section, context, status, list, capture, results };
}

function renderResult(
  container: HTMLElement,
  result: AcquisitionCaptureResult,
  onUseForDraft: (result: AcquisitionCaptureResult) => void,
): void {
  const row = document.createElement("div");
  row.style.padding = "5px 0";
  row.style.borderTop = "1px solid #eef1f0";

  const locator = document.createElement("div");
  locator.textContent = result.source_locator ?? "(source locator unavailable)";
  locator.style.wordBreak = "break-all";

  const detail = document.createElement("div");
  detail.style.color = result.capture_status === "captured" ? "#177245" : "#a13c32";
  detail.textContent =
    result.capture_status === "captured"
      ? `Captured · ${result.capture_id ?? "capture id unavailable"} · ${result.captured_object_address ?? "digest unavailable"}`
      : `Capture failed · ${result.failure_detail ?? "producer returned no failure detail"}`;

  row.append(locator, detail);

  if (result.capture_status === "captured") {
    const useForDraft = makeButton("Use for Draft from source");
    useForDraft.style.marginTop = "5px";
    useForDraft.style.padding = "5px 8px";
    useForDraft.addEventListener("click", () => onUseForDraft(result));
    row.appendChild(useForDraft);
  }

  container.appendChild(row);
}

export async function initWikipediaFrontierCapturePanel(): Promise<void> {
  if (!teamBetaEnabled()) return;
  if (document.getElementById(SECTION_ID)) return;
  const content = document.querySelector(".panel-content");
  if (!content) return;

  const ui = buildSection();
  content.prepend(ui.section);

  let currentFrontier = await readWikipediaReferenceFrontier(chrome.storage.local).catch(() => null);

  const render = (): void => {
    ui.list.innerHTML = "";
    ui.results.innerHTML = "";
    if (!currentFrontier || currentFrontier.selected_sources.length === 0) {
      ui.section.style.display = "none";
      return;
    }
    ui.section.style.display = "";
    ui.context.textContent =
      `${currentFrontier.page.title} · revision ${currentFrontier.page.revision_id} · ` +
      `${currentFrontier.selected_sources.length} queued NEW source URL${currentFrontier.selected_sources.length === 1 ? "" : "s"}`;
    ui.status.textContent = "Choose which queued sources to capture. Nothing is captured until you click.";

    for (const source of currentFrontier.selected_sources.slice(0, MAX_RENDERED)) {
      const label = document.createElement("label");
      label.style.display = "grid";
      label.style.gridTemplateColumns = "18px minmax(0,1fr)";
      label.style.gap = "7px";
      label.style.padding = "6px 0";
      label.style.borderBottom = "1px solid #eef1f0";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset["sourceUrl"] = source.url;
      checkbox.setAttribute("aria-label", `Capture ${source.url}`);

      const url = document.createElement("span");
      url.textContent = source.url;
      url.style.fontSize = "11px";
      url.style.wordBreak = "break-all";
      label.append(checkbox, url);
      ui.list.appendChild(label);
    }

    if (currentFrontier.selected_sources.length > MAX_RENDERED) {
      const truncated = document.createElement("div");
      truncated.textContent =
        `Showing the first ${MAX_RENDERED} queued URLs. Narrow the frontier before capturing the remainder.`;
      truncated.style.fontSize = "11px";
      truncated.style.color = "#687572";
      truncated.style.padding = "6px 0";
      ui.list.appendChild(truncated);
    }
  };

  const useForDraft = (result: AcquisitionCaptureResult): void => {
    try {
      selectGovernedSource(result);
      ui.status.textContent =
        `Selected ${result.capture_id ?? "captured source"} for the existing Draft-from-source lane. ` +
        "No draft has been performed; enter operator claim material and click Draft from source separately.";
      document.getElementById("authoring-section")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    } catch (err) {
      ui.status.textContent =
        err instanceof Error
          ? err.message
          : "Captured source could not be selected for drafting.";
    }
  };

  ui.capture.addEventListener("click", () => {
    void (async () => {
      if (!currentFrontier) return;
      const selected = Array.from(
        ui.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-source-url]'),
      )
        .filter((input) => input.checked)
        .map((input) => input.dataset["sourceUrl"] ?? "")
        .filter(Boolean);

      if (selected.length === 0) {
        ui.status.textContent = "No queued source URLs selected.";
        return;
      }
      if (selected.length > MAX_CAPTURE_PER_RUN) {
        ui.status.textContent =
          `Select at most ${MAX_CAPTURE_PER_RUN} sources for one explicit capture run.`;
        return;
      }

      ui.capture.disabled = true;
      ui.results.innerHTML = "";
      const results: AcquisitionCaptureResult[] = [];
      try {
        for (let index = 0; index < selected.length; index += 1) {
          const url = selected[index];
          ui.status.textContent = `Capturing ${index + 1} of ${selected.length} through the acquisition producer…`;
          try {
            const result = await captureWikipediaFrontierUrl(url);
            results.push(result);
            renderResult(ui.results, result, useForDraft);
          } catch (err) {
            ui.status.textContent =
              err instanceof Error
                ? `Capture run stopped: ${err.message}`
                : "Capture run stopped by an unavailable local producer.";
            break;
          }
        }

        if (results.length > 0) {
          const run = buildWikipediaCaptureRun(currentFrontier, results);
          await persistWikipediaCaptureRun(chrome.storage.local, run);
          const captured = results.filter((result) => result.capture_status === "captured").length;
          const failed = results.length - captured;
          ui.status.textContent =
            `Explicit capture run recorded · ${captured} captured · ${failed} producer-level failures · ` +
            "admission not performed. Select a captured source separately if you want to offer it to Draft from source.";
        }
      } finally {
        ui.capture.disabled = false;
      }
    })();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[WIKIPEDIA_REFERENCE_FRONTIER_KEY]) return;
    void (async () => {
      currentFrontier = await readWikipediaReferenceFrontier(chrome.storage.local).catch(() => null);
      render();
    })();
  });

  render();
}