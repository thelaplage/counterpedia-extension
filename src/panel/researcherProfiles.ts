/**
 * CHECK-RESEARCHER0 — turn an explicit PATHS selection into a reusable named
 * local Researcher profile, then manually apply that routing lens to a Check.
 *
 * This is intentionally one step before a real agent runtime. Applying a
 * Researcher only toggles current PATHS controls. It grants no tools, network,
 * memory admission, or automatic execution.
 */

import { getCurrentState } from "./panel";
import { suggestInquiryPaths } from "../lib/inquiryPaths";
import {
  appendResearcherProfile,
  buildResearcherProfile,
  chromeResearcherProfileStorage,
  matchResearcherProfile,
  parseResearcherProfiles,
  RESEARCHER_PROFILE_STORAGE_KEY,
  type ResearcherProfile,
} from "../lib/researcherProfiles";

const storage = chromeResearcherProfileStorage();
let profiles: ResearcherProfile[] = [];
let loadFailed = false;
let loaded = false;

function newProfileId(): string {
  return crypto.randomUUID();
}

function currentSuggestions() {
  const state = getCurrentState();
  return state.kind === "results" ? suggestInquiryPaths(state.query, state.results) : [];
}

function selectedPathIds(): Set<string> {
  return new Set(
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "#inquiry-paths input[data-path-id]:checked",
      ),
    )
      .map((input) => input.dataset["pathId"])
      .filter((id): id is string => Boolean(id)),
  );
}

async function loadProfiles(): Promise<void> {
  try {
    profiles = parseResearcherProfiles(
      await storage.get(RESEARCHER_PROFILE_STORAGE_KEY),
    );
  } catch {
    profiles = [];
    loadFailed = true;
  } finally {
    loaded = true;
  }
}

function ensureSection(): HTMLElement | null {
  const list = document.getElementById("results-list");
  if (!list) return null;
  let section = document.getElementById("researcher-profiles");
  if (!section) {
    section = document.createElement("section");
    section.id = "researcher-profiles";
    section.setAttribute("aria-label", "Researcher profiles");
    section.style.margin = "10px 0";
    section.style.padding = "10px";
    section.style.border = "1px solid #e5e7eb";
    section.style.borderRadius = "6px";
    section.style.background = "#f9fafb";
    list.parentNode?.insertBefore(section, list);
  }
  return section;
}

function applyProfile(profile: ResearcherProfile): void {
  const suggestions = currentSuggestions();
  const match = matchResearcherProfile(profile, suggestions);
  const desired = new Set(match.matchedPathIds);
  const checkboxes = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      "#inquiry-paths input[data-path-id]",
    ),
  );

  for (const checkbox of checkboxes) {
    const id = checkbox.dataset["pathId"];
    if (!id) continue;
    const shouldBeChecked = desired.has(id);
    if (checkbox.checked !== shouldBeChecked) checkbox.click();
  }

  const status = document.getElementById("researcher-profile-status");
  if (status) {
    const missing = match.missingPathLabels.length;
    status.textContent = missing === 0
      ? `Applied “${profile.name}” to this Check (${match.matchedPathIds.length} path${match.matchedPathIds.length === 1 ? "" : "s"}).`
      : `Applied ${match.matchedPathIds.length} available path${match.matchedPathIds.length === 1 ? "" : "s"} from “${profile.name}”; ${missing} saved path${missing === 1 ? " is" : "s are"} not represented in the current Check.`;
    status.style.color = "#374151";
  }
}

async function createProfile(name: string): Promise<void> {
  const state = getCurrentState();
  const status = document.getElementById("researcher-profile-status");
  if (!status || state.kind !== "results") return;
  try {
    const profile = buildResearcherProfile({
      profileId: newProfileId(),
      name,
      createdAt: new Date().toISOString(),
      seedQuery: state.query,
      suggestions: suggestInquiryPaths(state.query, state.results),
      selectedPathIds: selectedPathIds(),
    });
    await appendResearcherProfile(storage, profile);
    profiles = [...profiles, profile];
    status.textContent = `Created local Researcher “${profile.name}”. Routing profile only — no agent runtime or tool authority.`;
    status.style.color = "#059669";
    renderSection();
  } catch {
    status.textContent = "Could not create this Researcher. Existing profiles were left unchanged.";
    status.style.color = "#dc2626";
  }
}

function renderProfileCard(profile: ResearcherProfile): HTMLElement {
  const card = document.createElement("div");
  card.style.marginTop = "7px";
  card.style.padding = "8px";
  card.style.border = "1px solid #e5e7eb";
  card.style.borderRadius = "5px";
  card.style.background = "#fff";

  const name = document.createElement("div");
  name.textContent = profile.name;
  name.style.fontSize = "12px";
  name.style.fontWeight = "600";
  card.appendChild(name);

  const paths = document.createElement("div");
  paths.textContent = profile.paths.map((path) => path.label).join(" · ");
  paths.style.marginTop = "3px";
  paths.style.fontSize = "10px";
  paths.style.color = "#6b7280";
  card.appendChild(paths);

  const match = matchResearcherProfile(profile, currentSuggestions());
  const matchLine = document.createElement("div");
  matchLine.textContent = `${match.matchedPathIds.length}/${profile.paths.length} saved paths available in this Check.`;
  matchLine.style.marginTop = "4px";
  matchLine.style.fontSize = "10px";
  matchLine.style.color = "#6b7280";
  card.appendChild(matchLine);

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "capture-btn";
  apply.textContent = "Use for this Check";
  apply.style.marginTop = "6px";
  apply.disabled = match.matchedPathIds.length === 0;
  apply.addEventListener("click", () => applyProfile(profile));
  card.appendChild(apply);

  return card;
}

function renderSection(): void {
  const section = ensureSection();
  if (!section) return;
  const state = getCurrentState();
  if (state.kind !== "results") {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "RESEARCHERS";
  heading.style.fontSize = "12px";
  heading.style.margin = "0 0 3px";
  section.appendChild(heading);

  const intro = document.createElement("p");
  intro.textContent = "Turn the paths you selected into a reusable research lens.";
  intro.style.fontSize = "11px";
  intro.style.margin = "0 0 3px";
  section.appendChild(intro);

  const boundary = document.createElement("p");
  boundary.textContent = "A Researcher is a local routing profile in this version — not an autonomous agent, prompt, or tool grant.";
  boundary.style.fontSize = "10px";
  boundary.style.color = "#6b7280";
  boundary.style.marginBottom = "7px";
  section.appendChild(boundary);

  const name = document.createElement("input");
  name.type = "text";
  name.id = "new-researcher-name";
  name.maxLength = 120;
  name.placeholder = "e.g. Music Industry Researcher";
  name.style.width = "100%";
  name.style.padding = "6px 8px";
  name.style.border = "1px solid #e5e7eb";
  name.style.borderRadius = "4px";
  name.style.fontSize = "11px";
  section.appendChild(name);

  const create = document.createElement("button");
  create.type = "button";
  create.className = "capture-btn";
  create.textContent = "Name this researcher";
  create.style.marginTop = "6px";
  create.disabled = selectedPathIds().size === 0;
  create.addEventListener("click", () => {
    const proposed = name.value.trim();
    const fallback = `Researcher: ${state.query.slice(0, 60)}`;
    void createProfile(proposed || fallback);
  });
  section.appendChild(create);

  const status = document.createElement("p");
  status.id = "researcher-profile-status";
  status.style.fontSize = "10px";
  status.style.marginTop = "5px";
  status.style.color = "#6b7280";
  if (!loaded) status.textContent = "Loading local Researchers…";
  else if (loadFailed) status.textContent = "Saved Researcher storage could not be read; no existing state was overwritten.";
  section.appendChild(status);

  if (loaded && profiles.length > 0) {
    const saved = document.createElement("div");
    saved.textContent = "Saved Researchers";
    saved.style.marginTop = "9px";
    saved.style.fontSize = "10px";
    saved.style.fontWeight = "700";
    saved.style.textTransform = "uppercase";
    saved.style.color = "#6b7280";
    section.appendChild(saved);
    for (const profile of profiles) section.appendChild(renderProfileCard(profile));
  }
}

export function initResearcherProfiles(): void {
  renderSection();
  void loadProfiles().then(renderSection);

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.matches("#inquiry-paths input[data-path-id]")
    ) {
      renderSection();
    }
  });

  const paths = document.getElementById("inquiry-paths");
  if (paths) {
    new MutationObserver(renderSection).observe(paths, { childList: true, subtree: true });
  }
  const resultsState = document.getElementById("state-results");
  if (resultsState) {
    new MutationObserver(renderSection).observe(resultsState, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}
