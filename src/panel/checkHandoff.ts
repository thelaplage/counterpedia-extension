import { buildCheckHandoffUrl, DEFAULT_COUNTERPEDIA_CHECK_BASE_URL } from "../lib/checkHandoff";
import { validateMessage } from "../lib/messaging";
import { isRestrictedUrl, normalizeUrl } from "../lib/search";

const CHECK_BASE_STORAGE_KEY = "counterpedia_check_base_url";
const SURFACE_ID = "counterpedia-check-handoff";
const LINK_ID = "counterpedia-check-handoff-link";
const CONTEXT_ID = "counterpedia-check-handoff-context";

let currentSourceUrl: string | null = null;
let selectedText: string | null = null;
let checkBaseUrl = DEFAULT_COUNTERPEDIA_CHECK_BASE_URL;

function ensureSurface(): HTMLElement | null {
  const existing = document.getElementById(SURFACE_ID);
  if (existing) return existing;

  const sourceWorkbench = document.getElementById("source-workbench");
  const parent = sourceWorkbench?.parentElement;
  if (!sourceWorkbench || !parent) return null;

  const section = document.createElement("section");
  section.id = SURFACE_ID;
  section.className = "source-workbench";
  section.setAttribute("aria-label", "Counterpedia CHECK handoff");
  section.style.display = "none";
  section.innerHTML = `
    <h2 class="sw-heading">Counterpedia CHECK</h2>
    <p class="sw-observation-copy">
      Browser matching is a scanner observation, not a Check result. Open CHECK to run Counterpedia's governed source and quote procedures.
    </p>
    <div class="sw-actions">
      <a id="${LINK_ID}" class="sw-btn sw-btn-link" target="_blank" rel="noopener noreferrer">Open in Counterpedia CHECK</a>
    </div>
    <p id="${CONTEXT_ID}" class="sw-observation-copy"></p>
  `;
  parent.insertBefore(section, sourceWorkbench.nextSibling);
  return section;
}

async function readCheckBaseUrl(): Promise<string> {
  try {
    const stored = await chrome.storage.sync.get([CHECK_BASE_STORAGE_KEY]);
    const value = stored[CHECK_BASE_STORAGE_KEY];
    return typeof value === "string" && value.length > 0
      ? value
      : DEFAULT_COUNTERPEDIA_CHECK_BASE_URL;
  } catch {
    return DEFAULT_COUNTERPEDIA_CHECK_BASE_URL;
  }
}

function setSourceUrl(rawUrl: string | null): void {
  selectedText = null;
  if (!rawUrl || isRestrictedUrl(rawUrl)) {
    currentSourceUrl = null;
    render();
    return;
  }
  currentSourceUrl = normalizeUrl(rawUrl);
  render();
}

function render(): void {
  const section = ensureSurface();
  if (!section) return;

  const link = document.getElementById(LINK_ID) as HTMLAnchorElement | null;
  const context = document.getElementById(CONTEXT_ID);

  if (!currentSourceUrl) {
    section.style.display = "none";
    if (link) link.removeAttribute("href");
    return;
  }

  let href: string;
  try {
    href = buildCheckHandoffUrl({
      sourceUrl: currentSourceUrl,
      selectedText,
      checkBaseUrl,
    });
  } catch {
    section.style.display = "none";
    if (link) link.removeAttribute("href");
    return;
  }

  section.style.display = "";
  if (link) link.href = href;
  if (context) {
    context.textContent = selectedText
      ? "Your explicit selection will be carried as optional quote context. CHECK still runs only after you click Run Check."
      : "The current source URL will be prefilled. CHECK still runs only after you click Run Check.";
  }
}

/**
 * CHECK-HANDOFF0 browser composition.
 *
 * This module observes only the same active-tab URL / explicit selection
 * messages already available to the scanner. It performs no network request.
 * The only outbound action it creates is an explicit user-click navigation to
 * Counterpedia's canonical Check surface.
 */
export async function initCheckHandoff(): Promise<void> {
  checkBaseUrl = await readCheckBaseUrl();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setSourceUrl(tab?.url ?? null);
  } catch {
    setSourceUrl(null);
  }

  chrome.runtime.onMessage.addListener((rawMessage) => {
    const message = validateMessage(rawMessage);
    if (!message) return;

    if (message.type === "TAB_CHANGED") {
      setSourceUrl(message.url);
      return;
    }
    if (message.type === "CHECK_SELECTION") {
      selectedText = message.text;
      render();
      return;
    }
    if (message.type === "CLEAR") {
      currentSourceUrl = null;
      selectedText = null;
      render();
    }
  });

  render();
}
