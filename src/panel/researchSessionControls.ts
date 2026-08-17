import { readHistoryMode, type LocalStorageArea } from "../lib/history";
import {
  readActiveResearchSessionRef,
  readResearchSessions,
  startResearchSession,
  stopResearchSession,
} from "../lib/researchSessions";

function storageArea(): LocalStorageArea {
  return chrome.storage.local as unknown as LocalStorageArea;
}

export async function initResearchSessionControls(): Promise<void> {
  const main = document.querySelector("main.panel-content");
  if (!main) return;

  const section = document.createElement("section");
  section.id = "counterpedia-research-session";
  section.className = "research-session-controls";
  section.setAttribute("aria-label", "Research Session");

  const heading = document.createElement("h2");
  heading.textContent = "Research Session";

  const status = document.createElement("p");
  status.id = "counterpedia-research-session-status";

  const form = document.createElement("form");
  form.id = "counterpedia-research-session-form";

  const label = document.createElement("label");
  label.htmlFor = "counterpedia-research-session-name";
  label.textContent = "Session name";

  const input = document.createElement("input");
  input.id = "counterpedia-research-session-name";
  input.type = "text";
  input.maxLength = 120;
  input.placeholder = "e.g. Boeing 737 MAX certification";

  const start = document.createElement("button");
  start.type = "submit";
  start.textContent = "Start Research Session";

  const stop = document.createElement("button");
  stop.type = "button";
  stop.id = "counterpedia-research-session-stop";
  stop.textContent = "Stop Research Session";

  const note = document.createElement("p");
  note.className = "research-session-note";
  note.textContent =
    "Sessions group local Encounter references only. They are not Countergraph state, publication, or admitted memory.";

  form.append(label, input, start);
  section.append(heading, status, form, stop, note);

  const history = document.querySelector("#counterpedia-history");
  if (history?.parentElement === main) history.insertAdjacentElement("afterend", section);
  else main.prepend(section);

  const storage = storageArea();

  async function refresh(): Promise<void> {
    try {
      const [activeRef, sessions, historyMode] = await Promise.all([
        readActiveResearchSessionRef(storage),
        readResearchSessions(storage),
        readHistoryMode(storage),
      ]);
      const active = activeRef
        ? sessions.find((candidate) => candidate.session_ref === activeRef)
        : undefined;
      if (active) {
        const historySuffix =
          historyMode === "ON"
            ? "History is ON; new encounters will be grouped here."
            : "History is OFF; this session stays open but no passive encounters will be recorded.";
        status.textContent = `${active.name} · ${active.encounter_ids.length} encounters. ${historySuffix}`;
        form.hidden = true;
        stop.hidden = false;
      } else {
        status.textContent = `${sessions.length} local session${sessions.length === 1 ? "" : "s"} saved.`;
        form.hidden = false;
        stop.hidden = true;
      }
    } catch {
      status.textContent = "Local Research Session data is malformed; session actions are fail-closed.";
      form.hidden = true;
      stop.hidden = true;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void startResearchSession(storage, input.value)
      .then(() => {
        input.value = "";
        return refresh();
      })
      .catch(() => refresh());
  });

  stop.addEventListener("click", () => {
    void stopResearchSession(storage).then(refresh).catch(() => refresh());
  });

  await refresh();
}
