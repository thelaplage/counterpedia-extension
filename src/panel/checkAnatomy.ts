/**
 * CHECK-RESULT0 — render the evidentiary anatomy already present in the
 * Counterpedia search projection.
 *
 * No new epistemic judgment is made here. The UI exposes support wording,
 * Why-not material, change posture, source visibility, and verification posture
 * that the existing SearchResult already carries.
 */

import { getCurrentState } from "./panel";
import {
  projectCheckAnatomy,
  projectRecordAnatomy,
  verificationPostureLabel,
} from "../lib/checkAnatomy";

function makeLabel(text: string): HTMLElement {
  const label = document.createElement("div");
  label.textContent = text;
  label.style.marginTop = "8px";
  label.style.fontSize = "10px";
  label.style.fontWeight = "700";
  label.style.letterSpacing = "0.05em";
  label.style.textTransform = "uppercase";
  label.style.color = "#6b7280";
  return label;
}

function makeBody(text: string): HTMLElement {
  const body = document.createElement("div");
  body.textContent = text;
  body.style.marginTop = "2px";
  body.style.fontSize = "11px";
  body.style.lineHeight = "1.45";
  body.style.color = "#111827";
  return body;
}

function ensureSummary(): HTMLElement | null {
  const state = getCurrentState();
  if (state.kind !== "results") return null;

  const header = document.getElementById("results-header");
  const list = document.getElementById("results-list");
  if (!header || !list) return null;

  let summary = document.getElementById("check-anatomy-summary");
  if (!summary) {
    summary = document.createElement("div");
    summary.id = "check-anatomy-summary";
    summary.setAttribute("aria-label", "Check summary");
    summary.style.marginBottom = "10px";
    summary.style.padding = "9px 10px";
    summary.style.border = "1px solid #e5e7eb";
    summary.style.borderRadius = "6px";
    summary.style.background = "#fff";
    list.parentNode?.insertBefore(summary, list);
  }

  const p = projectCheckAnatomy(state.results);
  const parts = [
    `${p.recordsChecked} matched record${p.recordsChecked === 1 ? "" : "s"}`,
    `${p.supportedFormulations} supported formulation${p.supportedFormulations === 1 ? "" : "s"}`,
  ];
  if (p.whyNotAvailable > 0) {
    parts.push(`${p.whyNotAvailable} Why not? explanation${p.whyNotAvailable === 1 ? "" : "s"}`);
  }
  if (p.changedRecords > 0) {
    parts.push(`${p.changedRecords} changed record${p.changedRecords === 1 ? "" : "s"}`);
  }
  if (p.verificationAvailable > 0) {
    parts.push(`${p.verificationAvailable} verification surface${p.verificationAvailable === 1 ? "" : "s"}`);
  }

  summary.textContent = parts.join(" · ");
  summary.style.fontSize = "11px";
  summary.style.color = "#374151";
  return summary;
}

function decorateCards(): void {
  const state = getCurrentState();
  if (state.kind !== "results") return;
  const list = document.getElementById("results-list");
  if (!list) return;

  const cards = Array.from(list.querySelectorAll<HTMLElement>(".result-card"));
  cards.forEach((card, index) => {
    const result = state.results[index];
    if (!result) return;
    if (card.querySelector("[data-check-anatomy]")) return;

    const anatomy = projectRecordAnatomy(result);

    const proposition = card.querySelector<HTMLElement>(".result-card-proposition");
    if (proposition && !card.querySelector("[data-supported-label]")) {
      const supported = makeLabel("Best supported formulation");
      supported.dataset["supportedLabel"] = "true";
      proposition.parentNode?.insertBefore(supported, proposition);
    }

    const detail = document.createElement("div");
    detail.dataset["checkAnatomy"] = anatomy.recordId;
    detail.style.marginTop = "8px";
    detail.style.paddingTop = "8px";
    detail.style.borderTop = "1px solid #e5e7eb";

    if (anatomy.whyNot) {
      detail.appendChild(makeLabel("Why not?"));
      detail.appendChild(makeBody(anatomy.whyNot));
    }

    if (anatomy.hasChanges) {
      detail.appendChild(makeLabel("What changed?"));
      detail.appendChild(
        makeBody(
          `${anatomy.changeCount} recorded change${anatomy.changeCount === 1 ? "" : "s"}. Open the governed record for the exact history.`,
        ),
      );
    }

    detail.appendChild(makeLabel("Verify"));
    const verifyBits = [verificationPostureLabel(anatomy.verificationPosture)];
    if (anatomy.verificationTokens.length > 0) {
      verifyBits.push(`Tokens: ${anatomy.verificationTokens.join(", ")}`);
    }
    detail.appendChild(makeBody(verifyBits.join(" · ")));

    card.appendChild(detail);
  });
}

function refreshCheckAnatomy(): void {
  ensureSummary();
  decorateCards();
}

export function initCheckAnatomy(): void {
  refreshCheckAnatomy();

  const resultsList = document.getElementById("results-list");
  if (resultsList) {
    new MutationObserver(refreshCheckAnatomy).observe(resultsList, {
      childList: true,
    });
  }

  const resultsState = document.getElementById("state-results");
  if (resultsState) {
    new MutationObserver(refreshCheckAnatomy).observe(resultsState, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}
