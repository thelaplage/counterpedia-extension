import {
  clearCounterpediaHistory,
  readEncounterLedger,
  readHistoryMode,
  setHistoryMode,
  type LocalStorageArea,
} from "../lib/history";

function localStorageArea(): LocalStorageArea {
  return chrome.storage.local as unknown as LocalStorageArea;
}

export async function initHistoryControls(): Promise<void> {
  const main = document.querySelector("main.panel-content");
  if (!main) return;

  const section = document.createElement("section");
  section.id = "counterpedia-history";
  section.className = "history-controls";
  section.setAttribute("aria-label", "Counterpedia History");

  const heading = document.createElement("h2");
  heading.textContent = "Counterpedia History";
  heading.className = "history-heading";

  const row = document.createElement("div");
  row.className = "history-toggle-row";

  const label = document.createElement("label");
  label.htmlFor = "counterpedia-history-toggle";
  label.textContent = "History";

  const toggle = document.createElement("input");
  toggle.id = "counterpedia-history-toggle";
  toggle.type = "checkbox";
  toggle.setAttribute("role", "switch");

  const state = document.createElement("span");
  state.id = "counterpedia-history-state";

  const privacy = document.createElement("p");
  privacy.className = "history-privacy";
  privacy.textContent =
    "When on, Counterpedia records top-level web encounters locally in this browser profile. History is not uploaded or admitted into Counterpedia.";

  const count = document.createElement("p");
  count.id = "counterpedia-history-count";
  count.className = "history-count";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.id = "counterpedia-history-clear";
  clear.textContent = "Clear Counterpedia History";
  clear.className = "history-clear";

  row.append(label, toggle, state);
  section.append(heading, row, privacy, count, clear);
  main.prepend(section);

  const storage = localStorageArea();

  async function refresh(): Promise<void> {
    const mode = await readHistoryMode(storage);
    toggle.checked = mode === "ON";
    state.textContent = mode;
    try {
      const ledger = await readEncounterLedger(storage);
      count.textContent = `${ledger.length} locally recorded encounter${ledger.length === 1 ? "" : "s"}.`;
      clear.disabled = ledger.length === 0;
    } catch {
      count.textContent = "Local History data is malformed; recording is fail-closed until it is cleared.";
      clear.disabled = false;
    }
  }

  toggle.addEventListener("change", () => {
    const requested = toggle.checked ? "ON" : "OFF";
    void setHistoryMode(storage, requested)
      .then(refresh)
      .catch(() => {
        toggle.checked = !toggle.checked;
      });
  });

  clear.addEventListener("click", () => {
    void clearCounterpediaHistory(storage).then(refresh);
  });

  await refresh();
}
