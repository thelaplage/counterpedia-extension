import {
  LOCAL_COMPANION_BASE_URL,
  pairLocalCompanion,
  readLocalCompanionStatus,
} from "../lib/localCompanionClient";

const SECTION_ID = "counterpedia-local-section";

function teamBetaEnabled(): boolean {
  const manifest = chrome.runtime.getManifest() as Record<string, unknown>;
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

function buildSection(): {
  section: HTMLElement;
  status: HTMLElement;
  connect: HTMLButtonElement;
  setup: HTMLButtonElement;
} {
  const section = document.createElement("section");
  section.id = SECTION_ID;
  section.setAttribute("aria-label", "Counterpedia Local");
  section.style.border = "1px solid #d7dfdc";
  section.style.borderRadius = "9px";
  section.style.padding = "10px 12px";
  section.style.marginBottom = "12px";
  section.style.background = "#fbfcfb";

  const title = document.createElement("div");
  title.textContent = "Counterpedia Local";
  title.style.fontWeight = "600";
  title.style.marginBottom = "4px";

  const status = document.createElement("div");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Checking local services…";
  status.style.fontSize = "12px";
  status.style.color = "#53615e";
  status.style.marginBottom = "8px";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "6px";
  actions.style.flexWrap = "wrap";

  const connect = makeButton("Connect Counterpedia Local");
  const setup = makeButton("Open local status");
  setup.style.display = "none";

  actions.append(connect, setup);
  section.append(title, status, actions);
  return { section, status, connect, setup };
}

async function hasSessionCredential(): Promise<boolean> {
  try {
    const stored = await chrome.storage.session.get(["counterpedia_acquisition_token"]);
    return typeof stored["counterpedia_acquisition_token"] === "string";
  } catch {
    return false;
  }
}

async function initLocalPairing(): Promise<void> {
  if (!teamBetaEnabled()) return;
  if (document.getElementById(SECTION_ID)) return;
  const content = document.querySelector(".panel-content");
  if (!content) return;

  const ui = buildSection();
  content.prepend(ui.section);

  const refresh = async (): Promise<void> => {
    const [local, hasCredential] = await Promise.all([
      readLocalCompanionStatus(),
      hasSessionCredential(),
    ]);
    if (!local) {
      ui.status.textContent = "Counterpedia Local is not running.";
      ui.connect.disabled = true;
      ui.connect.textContent = "Start Counterpedia Local first";
      ui.setup.style.display = "none";
      return;
    }

    ui.connect.disabled = false;
    ui.setup.style.display = "";
    if (local.acquisition.ready && hasCredential) {
      ui.connect.textContent = "Reconnect browser";
      ui.status.textContent = local.authoring.ready
        ? "Connected · Capture ready · Authoring ready"
        : "Connected · Capture ready · Authoring needs setup";
    } else {
      ui.connect.textContent = "Connect Counterpedia Local";
      ui.status.textContent = "Local companion found. Connect this browser to start capture.";
    }
  };

  ui.setup.addEventListener("click", () => {
    void chrome.tabs.create({ url: LOCAL_COMPANION_BASE_URL + "/" });
  });

  ui.connect.addEventListener("click", () => {
    void (async () => {
      ui.connect.disabled = true;
      ui.status.textContent = "Connecting browser and starting local services…";
      try {
        const result = await pairLocalCompanion({ extensionId: chrome.runtime.id });
        ui.status.textContent = result.authoring_ready
          ? "Connected · Capture ready · Authoring ready"
          : "Connected · Capture ready · Authoring needs setup";
        // Reload only this side-panel page so the existing authoring initializer
        // observes the newly stored config. This is NOT an extension reload and
        // therefore does not clear chrome.storage.session.
        window.location.reload();
      } catch (err) {
        ui.connect.disabled = false;
        ui.status.textContent =
          err instanceof Error ? err.message : "Could not connect Counterpedia Local";
      }
    })();
  });

  await refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initLocalPairing(), { once: true });
} else {
  void initLocalPairing();
}
