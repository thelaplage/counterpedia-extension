import {
  buildWikipediaCaptureRun,
  captureWikipediaFrontierUrl,
  persistWikipediaCaptureRun,
  readWikipediaReferenceFrontier,
  WIKIPEDIA_CAPTURE_RUNS_KEY,
  type WikipediaCaptureRunV01,
} from "../lib/wikipediaFrontierCapture";
import { readWikipediaCaptureRunsForRecovery } from "../lib/wikipediaCaptureRunRecovery";
import type { AcquisitionCaptureResult } from "../lib/acquisitionResponseGuard";
import {
  clearGovernedSourceSelection,
  persistGovernedSourceSelection,
  GOVERNED_SOURCE_SELECTION_KEY,
  restoreGovernedSourceSelection,
  selectGovernedSource,
} from "../lib/governedSourceSelection";
import { WIKIPEDIA_REFERENCE_FRONTIER_KEY } from "../lib/wikipediaHarvestBridge";

const SECTION_ID = "wikipedia-frontier-capture-section";
const MAX_CAPTURE_PER_RUN = 25;
const MAX_RENDERED = 100;
const MAX_RECOVERED_RUNS = 5;

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
    "Queued URLs and completed capture-run summaries are kept locally across panel/window/browser restarts. " +
    "An in-flight request is not auto-resumed; if its response was not recorded before lifecycle loss, " +
    "its local outcome is unknown even though a backend capture may still be durable.";
  note.style.fontSize = "11px";
  note.style.color = "#687572";
  note.style.marginTop = "5px";

  const recovery = document.createElement("div");
  recovery.style.marginTop = "8px";
  recovery.style.fontSize = "11px";
  recovery.style.borderTop = "1px solid #d7dfdc";
  recovery.style.paddingTop = "7px";

  const results = document.createElement("div");
  results.style.marginTop = "8px";
  results.style.fontSize = "11px";

  section.append(title, boundary, context, status, list, capture, note, recovery, results);
  return { section, context, status, list, capture, recovery, results };
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

function renderRecoveredRun(container: HTMLElement, run: WikipediaCaptureRunV01): void {
  const block = document.createElement("div");
  block.style.padding = "6px 0";
  block.style.borderTop = "1px solid #eef1f0";

  const heading = document.createElement("div");
  heading.textContent =
    `${run.page.title} · ${run.created_at} · ${run.attempts.length} locally recorded producer outcome${run.attempts.length === 1 ? "" : "s"}`;
  heading.style.fontWeight = "600";
  block.appendChild(heading);

  for (const attempt of run.attempts) {
    const row = document.createElement("div");
    row.style.marginTop = "3px";
    row.style.wordBreak = "break-all";
    row.textContent =
      attempt.capture_status === "captured"
        ? `Durable capture recorded · ${attempt.capture_id ?? "capture id unavailable"} · ${attempt.url}`
        : `Producer capture failure recorded · ${attempt.url}`;
    block.appendChild(row);
  }
  container.appendChild(block);
}

export async function initWikipediaFrontierCapturePanel(): Promise<void> {
  if (!teamBetaEnabled()) return;
  if (document.getElementById(SECTION_ID)) return;
  const content = document.querySelector(".panel-content");
  if (!content) return;

  const ui = buildSection();
  content.prepend(ui.section);

  let currentFrontier = await readWikipediaReferenceFrontier(chrome.storage.local).catch(() => null);
  let captureRuns: WikipediaCaptureRunV01[] = [];
  let captureRecoveryFailed = false;
  try {
    captureRuns = await readWikipediaCaptureRunsForRecovery(chrome.storage.local);
  } catch {
    captureRecoveryFailed = true;
  }
  let recoveredSelection: AcquisitionCaptureResult | null = null;
  let selectionRecoveryFailed = false;
  try {
    recoveredSelection = await restoreGovernedSourceSelection(chrome.storage.local);
  } catch {
    selectionRecoveryFailed = true;
  }

  const renderRecovery = (): void => {
    ui.recovery.innerHTML = "";

    const recoveryHeading = document.createElement("div");
    recoveryHeading.textContent = "Recovery status";
    recoveryHeading.style.fontWeight = "600";
    ui.recovery.appendChild(recoveryHeading);

    const selection = document.createElement("div");
    selection.style.marginTop = "4px";
    if (recoveredSelection) {
      selection.textContent =
        `Draft-source selection recovered locally · ${recoveredSelection.capture_id ?? "capture id unavailable"} · ` +
        "the backend capture remains producer-owned and durable; restoring selection performs no draft.";
    } else if (selectionRecoveryFailed) {
      selection.textContent =
        "Saved draft-source selection could not be revalidated. This does not erase or downgrade any backend capture.";
    } else {
      selection.textContent = "No persisted Draft-from-source selection is currently held.";
    }
    ui.recovery.appendChild(selection);

    const relevantRuns = captureRuns
      .filter(
        (run) =>
          !currentFrontier ||
          (run.page.wiki_host === currentFrontier.page.wiki_host &&
            run.page.revision_id === currentFrontier.page.revision_id),
      )
      .slice(-MAX_RECOVERED_RUNS)
      .reverse();

    if (captureRecoveryFailed) {
      const invalid = document.createElement("div");
      invalid.style.marginTop = "4px";
      invalid.textContent =
        "Saved local capture-run state could not be revalidated. This does not erase, fail, or downgrade any producer capture; backend outcomes must be treated independently.";
      ui.recovery.appendChild(invalid);
    } else if (relevantRuns.length === 0) {
      const none = document.createElement("div");
      none.style.marginTop = "4px";
      none.textContent = "No local Wikipedia capture-run outcomes are available for this view.";
      ui.recovery.appendChild(none);
    } else {
      for (const run of relevantRuns) renderRecoveredRun(ui.recovery, run);
    }

    const lifecycle = document.createElement("div");
    lifecycle.style.marginTop = "5px";
    lifecycle.style.color = "#687572";
    lifecycle.textContent =
      "Panel/window/browser restart preserves queued frontier state, recorded capture outcomes, and the explicit draft-source selection. " +
      "A request still in flight at lifecycle loss is not retried automatically; its local outcome remains unknown.";
    ui.recovery.appendChild(lifecycle);
  };

  const render = (): void => {
    ui.list.innerHTML = "";
    ui.results.innerHTML = "";
    const hasQueue = Boolean(currentFrontier && currentFrontier.selected_sources.length > 0);
    const hasRecovery =
      captureRuns.length > 0 ||
      captureRecoveryFailed ||
      recoveredSelection !== null ||
      selectionRecoveryFailed;
    if (!hasQueue && !hasRecovery) {
      ui.section.style.display = "none";
      return;
    }
    ui.section.style.display = "";

    if (currentFrontier && currentFrontier.selected_sources.length > 0) {
      ui.context.textContent =
        `${currentFrontier.page.title} · revision ${currentFrontier.page.revision_id} · ` +
        `${currentFrontier.selected_sources.length} queued NEW source URL${currentFrontier.selected_sources.length === 1 ? "" : "s"}`;
      ui.status.textContent =
        "Choose which queued sources to capture. Queue state is local-durable; nothing new is captured until you click.";
      ui.capture.style.display = "";

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
    } else {
      ui.context.textContent = "No queued Wikipedia source frontier is currently active.";
      ui.status.textContent =
        "Recovered local capture state is shown below. Backend capture durability does not depend on this panel being open.";
      ui.capture.style.display = "none";
    }

    renderRecovery();
  };

  const useForDraft = (result: AcquisitionCaptureResult): void => {
    void (async () => {
      try {
        await persistGovernedSourceSelection(chrome.storage.local, result);
        selectGovernedSource(result);
        recoveredSelection = result;
        selectionRecoveryFailed = false;
        renderRecovery();
        ui.status.textContent =
          `Selected ${result.capture_id ?? "captured source"} for the existing Draft-from-source lane and saved that selection for restart recovery. ` +
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
    })();
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
          const url = selected[index]!;
          ui.status.textContent = `Capturing ${index + 1} of ${selected.length} through the acquisition producer…`;
          try {
            const result = await captureWikipediaFrontierUrl(url);
            results.push(result);
            renderResult(ui.results, result, useForDraft);
          } catch (err) {
            ui.status.textContent =
              err instanceof Error
                ? `Capture run stopped: ${err.message}. Any producer outcome not yet committed to local run history is unknown after lifecycle loss.`
                : "Capture run stopped before a complete local run record was committed; local outcome is unknown.";
            break;
          }
        }

        if (results.length > 0) {
          try {
            const run = buildWikipediaCaptureRun(currentFrontier, results);
            await persistWikipediaCaptureRun(chrome.storage.local, run);
            captureRuns = await readWikipediaCaptureRunsForRecovery(chrome.storage.local);
            captureRecoveryFailed = false;
            renderRecovery();
            const captured = results.filter((result) => result.capture_status === "captured").length;
            const failed = results.length - captured;
            ui.status.textContent =
              `Explicit capture run recorded · ${captured} captured · ${failed} producer-level failures · ` +
              "admission not performed. Completed run history survives restart; a browser/panel close before this local commit is not auto-resumed and must be treated as unknown locally.";
          } catch {
            captureRecoveryFailed = true;
            renderRecovery();
            ui.status.textContent =
              "Producer result(s) were received, but the extension could not commit or revalidate the local capture-run summary. Backend capture facts are not erased or downgraded; local recovery is unavailable.";
          }
        }
      } finally {
        ui.capture.disabled = false;
      }
    })();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[WIKIPEDIA_REFERENCE_FRONTIER_KEY]) {
      void (async () => {
        currentFrontier = await readWikipediaReferenceFrontier(chrome.storage.local).catch(() => null);
        render();
      })();
    }
    if (changes[WIKIPEDIA_CAPTURE_RUNS_KEY]) {
      void (async () => {
        try {
          captureRuns = await readWikipediaCaptureRunsForRecovery(chrome.storage.local);
          captureRecoveryFailed = false;
        } catch {
          captureRuns = [];
          captureRecoveryFailed = true;
        }
        renderRecovery();
      })();
    }
    const selectionChange = changes[GOVERNED_SOURCE_SELECTION_KEY] as
      | { readonly newValue?: unknown }
      | undefined;
    if (selectionChange) {
      void (async () => {
        if (selectionChange.newValue === undefined) {
          recoveredSelection = null;
          selectionRecoveryFailed = false;
          clearGovernedSourceSelection();
          renderRecovery();
          return;
        }
        try {
          recoveredSelection = await restoreGovernedSourceSelection(chrome.storage.local);
          selectionRecoveryFailed = false;
        } catch {
          recoveredSelection = null;
          selectionRecoveryFailed = true;
          clearGovernedSourceSelection();
        }
        renderRecovery();
      })();
    }
  });

  render();
}
