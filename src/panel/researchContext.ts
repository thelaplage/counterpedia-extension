/**
 * Research Context panel wiring (RESEARCH-CONTEXT0).
 *
 * DOM-only glue over the pure `buildResearchContextPresentation()` model.
 * Reads NO tab/page content itself — it is called by panel.ts with the same
 * locator + SearchResult[] the existing Source Workbench section already
 * has, plus (for now) a locally-computed research-history summary.
 *
 * HELD transport (mirrors sourceWorkbench.ts's documented precedent): no
 * stable public transport exists yet in this repo for either
 * PublicObjectLink (counterpedia PR #475, still open/draft) or a Countergraph
 * research-context packet (countergraph PR #88's schema — merged upstream,
 * but with no fetchable public artifact wired into this extension). The live
 * panel therefore calls `render()` with `publicSourceLink`/`gapPacket`
 * omitted, and the corresponding sections render an honest HELD note instead
 * of a guessed "no gaps" claim. The presentation model and its fixtures
 * already exercise the populated path for when a transport lands.
 */

import {
  buildResearchContextPresentation,
  type ResearchContextInput,
  type ResearchContextPresentation,
} from "../lib/researchContext";
import { summarizeLocalResearchHistory } from "../lib/researchContextHistory";
import type { LocalStorageArea } from "../lib/history";

function storageArea(): LocalStorageArea {
  return chrome.storage.local as unknown as LocalStorageArea;
}

export function renderResearchContext(input: ResearchContextInput): void {
  const section = document.getElementById("research-context");
  if (!section) return;

  const p = buildResearchContextPresentation(input);
  section.style.display = "";
  renderPresentation(p);
}

/**
 * Render, then asynchronously fill in the LOCAL-ONLY research-history
 * summary (chrome.storage.local reads only — no network). Renders the
 * synchronous parts immediately so the panel never blocks on this.
 */
export async function renderResearchContextWithHistory(
  input: Omit<ResearchContextInput, "researchHistory">,
): Promise<void> {
  renderResearchContext(input);
  try {
    const researchHistory = await summarizeLocalResearchHistory(storageArea(), input.locator);
    renderResearchContext({ ...input, researchHistory });
  } catch {
    // Local history is a courtesy enhancement; a read failure (e.g. History
    // mode OFF, storage unavailable) must never block or corrupt the rest of
    // the panel — the section simply renders without a history block.
  }
}

export function hideResearchContext(): void {
  const section = document.getElementById("research-context");
  if (section) section.style.display = "none";
}

function renderPresentation(p: ResearchContextPresentation): void {
  const noRecord = document.getElementById("rc-no-record");
  if (noRecord) {
    if (p.no_public_record_copy) {
      noRecord.textContent = p.no_public_record_copy;
      noRecord.style.display = "";
    } else {
      noRecord.style.display = "none";
    }
  }

  const sourceBlock = document.getElementById("rc-source");
  const sourceTitle = document.getElementById("rc-source-title");
  const sourceLink = document.getElementById("rc-source-link") as HTMLAnchorElement | null;
  if (sourceBlock) sourceBlock.style.display = p.in_corpus ? "" : "none";
  if (p.in_corpus) {
    if (sourceTitle) sourceTitle.textContent = p.source_title ?? "(untitled record)";
    if (sourceLink) {
      const href = p.public_source_link_url ?? p.source_deep_link_url;
      sourceLink.href = href;
    }
  }

  const usedByBlock = document.getElementById("rc-used-by");
  const usedByList = document.getElementById("rc-used-by-list");
  if (usedByBlock && usedByList) {
    usedByList.textContent = "";
    if (p.used_by.length > 0) {
      usedByBlock.style.display = "";
      for (const entry of p.used_by) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = entry.record_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = `${entry.title} ↗`;
        li.appendChild(a);
        usedByList.appendChild(li);
      }
    } else {
      usedByBlock.style.display = "none";
    }
  }

  const gapsBlock = document.getElementById("rc-gaps");
  const gapsList = document.getElementById("rc-gaps-list");
  const gapsHeld = document.getElementById("rc-gaps-held");
  if (gapsBlock && gapsList) {
    gapsList.textContent = "";
    if (p.open_gaps.length > 0) {
      gapsBlock.style.display = "";
      if (gapsHeld) gapsHeld.style.display = "none";
      for (const gap of p.open_gaps) {
        const li = document.createElement("li");
        li.textContent = gap.why_unresolved;
        li.dataset["gapType"] = gap.type;
        gapsList.appendChild(li);
      }
    } else {
      gapsBlock.style.display = "none";
      if (gapsHeld) gapsHeld.style.display = p.gap_packet_supplied ? "none" : "";
    }
  }

  const historyBlock = document.getElementById("rc-history");
  const historyBody = document.getElementById("rc-history-body");
  if (historyBlock && historyBody) {
    if (p.research_history) {
      historyBlock.style.display = "";
      const { bounded_runs, held_ambiguities } = p.research_history;
      const runsLine = `${bounded_runs} bounded run${bounded_runs === 1 ? "" : "s"}`;
      const ambiguityLine =
        held_ambiguities > 0
          ? `${held_ambiguities} held ambiguit${held_ambiguities === 1 ? "y" : "ies"}`
          : null;
      historyBody.textContent = "";
      const runsEl = document.createElement("div");
      runsEl.textContent = runsLine;
      historyBody.appendChild(runsEl);
      if (ambiguityLine) {
        const ambEl = document.createElement("div");
        ambEl.textContent = ambiguityLine;
        historyBody.appendChild(ambEl);
      }
    } else {
      historyBlock.style.display = "none";
    }
  }

  const openLink = document.getElementById("rc-open-workbench") as HTMLAnchorElement | null;
  if (openLink) openLink.href = p.public_source_link_url ?? p.source_deep_link_url;
}
