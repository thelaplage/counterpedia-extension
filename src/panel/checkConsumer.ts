/**
 * EXT-CHECK-CONSUMER0 (R7) — in-panel CHECK CONSUMER.
 *
 * ADDITIVE to, and does not replace, the existing "Open in Counterpedia
 * CHECK" navigation handoff (`checkHandoff.ts`, #67): that link still
 * navigates the user out to Counterpedia's `/check/new` product surface and
 * is untouched by this module. This module instead lets the user run the
 * SAME canonical `/api/check/new` funnel without leaving the panel, and
 * renders the canonical response.
 *
 * Its only authority is: explicit user input (the URL in the field below,
 * edited only by the user) -> the canonical Counterpedia CHECK API
 * (`checkApiConsumer.ts`) -> render the canonical response
 * (`checkApiRender.ts`). It performs no evaluation, no capture, and no
 * scanner/acquisition side effect of its own.
 */

import { checkViaCanonicalApi, DEFAULT_CHECK_API_BASE_URL } from "../lib/checkApiConsumer";
import { projectCheckApiOutcomeToRenderFields } from "../lib/checkApiRender";
import { validateMessage } from "../lib/messaging";
import { isRestrictedUrl, normalizeUrl } from "../lib/search";

const CHECK_BASE_STORAGE_KEY = "counterpedia_check_base_url";
const SURFACE_ID = "counterpedia-check-consumer";
const INPUT_ID = "counterpedia-check-consumer-url";
const RUN_BUTTON_ID = "counterpedia-check-consumer-run";
const RESULT_ID = "counterpedia-check-consumer-result";
const STATUS_ID = "counterpedia-check-consumer-status";

let checkBaseUrl = DEFAULT_CHECK_API_BASE_URL;

function ensureSurface(): HTMLElement | null {
  const existing = document.getElementById(SURFACE_ID);
  if (existing) return existing;

  // Mount after the existing handoff surface if present, else after
  // source-workbench, so this consumer never displaces #67's link.
  const anchor = document.getElementById("counterpedia-check-handoff") ?? document.getElementById("source-workbench");
  const parent = anchor?.parentElement;
  if (!anchor || !parent) return null;

  const section = document.createElement("section");
  section.id = SURFACE_ID;
  section.className = "source-workbench";
  section.setAttribute("aria-label", "Counterpedia CHECK (in-panel)");
  section.innerHTML = `
    <h2 class="sw-heading">Run Check here</h2>
    <p class="sw-observation-copy">
      Calls Counterpedia's canonical CHECK API directly and renders its response.
      Nothing is evaluated locally; this consumer only invokes and renders.
    </p>
    <input id="${INPUT_ID}" class="authoring-input" type="text" placeholder="https://example.com/report" />
    <div class="sw-actions">
      <button id="${RUN_BUTTON_ID}" class="sw-btn" type="button">Run Check (canonical API)</button>
    </div>
    <p id="${STATUS_ID}" class="sw-observation-copy" aria-live="polite"></p>
    <pre id="${RESULT_ID}" class="sw-observation-copy" style="white-space: pre-wrap;"></pre>
  `;
  parent.insertBefore(section, anchor.nextSibling);
  return section;
}

async function readCheckBaseUrl(): Promise<string> {
  try {
    const stored = await chrome.storage.sync.get([CHECK_BASE_STORAGE_KEY]);
    const value = stored[CHECK_BASE_STORAGE_KEY];
    return typeof value === "string" && value.length > 0 ? value : DEFAULT_CHECK_API_BASE_URL;
  } catch {
    return DEFAULT_CHECK_API_BASE_URL;
  }
}

function setStatus(text: string): void {
  const status = document.getElementById(STATUS_ID);
  if (status) status.textContent = text;
}

function setResult(text: string): void {
  const result = document.getElementById(RESULT_ID);
  if (result) result.textContent = text;
}

async function runCheck(): Promise<void> {
  const section = ensureSurface();
  if (!section) return;

  const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
  const rawUrl = input?.value.trim() ?? "";
  const normalized = rawUrl && !isRestrictedUrl(rawUrl) ? normalizeUrl(rawUrl) : null;
  if (!normalized) {
    setStatus("Enter a checkable http(s) URL first.");
    setResult("");
    return;
  }

  setStatus("Calling canonical CHECK API…");
  setResult("");

  const outcome = await checkViaCanonicalApi({ url: normalized, checkBaseUrl });
  const fields = projectCheckApiOutcomeToRenderFields(outcome);

  if (fields.kind === "unbound") {
    setStatus("Canonical CHECK API is not configured for this destination (hosted runtime not bound).");
    setResult(fields.detail);
    return;
  }
  if (fields.kind === "unrecognized_response") {
    setStatus("Refused: the canonical API's response did not match a recognized CHECK result shape.");
    setResult(fields.detail);
    return;
  }
  if (fields.kind === "local_transport_error") {
    setStatus("Could not reach the canonical CHECK API.");
    setResult(fields.detail);
    return;
  }

  setStatus(`capture_status: ${fields.capture_status}`);
  setResult(JSON.stringify(fields, null, 2));
}

/**
 * CHECK-CONSUMER0 browser composition. Performs no fetch on init — only the
 * explicit "Run Check" click triggers a network call.
 */
export function initCheckConsumer(): void {
  void readCheckBaseUrl().then((base) => {
    checkBaseUrl = base;
  });

  const section = ensureSurface();
  if (!section) return;

  const button = document.getElementById(RUN_BUTTON_ID);
  button?.addEventListener("click", () => {
    void runCheck();
  });

  chrome.runtime.onMessage.addListener((rawMessage) => {
    const message = validateMessage(rawMessage);
    if (!message) return;
    if (message.type === "TAB_CHANGED") {
      const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
      const normalized =
        message.url && !isRestrictedUrl(message.url) ? normalizeUrl(message.url) : null;
      if (input && !input.value && normalized) {
        input.value = normalized;
      }
    }
  });
}
