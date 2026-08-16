/**
 * CHECK-RESEARCHER0 — named local inquiry-routing profiles.
 *
 * CHECK-RESEARCHER-TEACH0 adds a non-destructive teaching overlay. A taught
 * path remains attributable to its original provider and teaching history;
 * the receiving Researcher profile itself is not rewritten.
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
import {
  chromeResearcherTeachingStorage,
  effectiveResearcherPaths,
  parseResearcherTeachingEvents,
  RESEARCHER_TEACHING_STORAGE_KEY,
  type ResearcherTeachingEvent,
} from "../lib/researcherTeaching";

const storage = chromeResearcherProfileStorage();
const teachingStorage = chromeResearcherTeachingStorage();
let profiles: ResearcherProfile[] = [];
let teachingEvents: ResearcherTeachingEvent[] = [];
let loadFailed = false;
let teachingLoadFailed = false;
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
  }
  try {
    teachingEvents = parseResearcherTeachingEvents(
      await teachingStorage.get(RESEARCHER_TEACHING_STORAGE_KEY),
    );
  } catch {
    teachingEvents = [];
    teachingLoadFailed = true;
  }
  loaded = true;
}

async function reloadTeaching(): Promise<void> {
  try {
    teachingEvents = parseResearcherTeachingEvents(
      await teachingStorage.get(RESEARCHER_TEACHING_STORAGE_KEY),
    );
    teachingLoadFailed = false;
  } catch {
    teachingEvents = [];
    teachingLoadFailed = true;
  }
}

function effectiveProfile(profile: ResearcherProfile): ResearcherProfile {
  return { ...profile, paths: effectiveResearcherPaths(profile, teachingEvents) };
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
  const resolved = effectiveProfile(profile);
  const match = matchResearcherProfile(resolved, currentSuggestions());
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
    const taught = resolved.paths.length - profile.paths.length;
    const missing = match.missingPathLabels.length;
    status.textContent = missing === 0
      ? `Applied “${profile.name}” to this Check (${match.matchedPathIds.length} path${match.matchedPathIds.length === 1 ? "" : "s"}${taught > 0 ? `; ${taught} taught` : ""}).`
      : `Applied ${match.matchedPathIds.length} available path${match.matchedPathIds.length === 1 ? "" : "s"} from “${profile.name}”; ${missing} effective path${missing === 1 ? " is" : "s are"} not represented in the current Check.`;
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
    document.dispatchEvent(new CustomEvent("counterpedia:researchers-changed"));
  } catch {
    status.textContent = "Could not create this Researcher. Existing profiles were left unchanged.";
    status.style.color = "#dc2626";
  }
}

function renderProfileCard(profile: ResearcherProfile): HTMLElement {
  const resolved = effectiveProfile(profile);
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
  paths.textContent = resolved.paths.map((path) => path.label).join(" · ");
  paths.style.marginTop = "3px";
  paths.style.fontSize = "10px";
  paths.style.color = "#6b7280";
  card.appendChild(paths);

  const taughtCount = resolved.paths.length - profile.paths.length;
  if (taughtCount > 0) {
    const taught = document.createElement("div");
    taught.textContent = `${taughtCount} path${taughtCount === 1 ? "" : "s"} available through Researcher teaching metadata.`;
    taught.style.marginTop = "3px";
    taught.style.fontSize = "10px";
    taught.style.color = "#6b7280";
    card.appendChild(taught);
  }

  const match = matchResearcherProfile(resolved, currentSuggestions());
  const matchLine = document.createElement("div");
  matchLine.textContent = `${match.matchedPathIds.length}/${resolved.paths.length} effective paths available in this Check.`;
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
  boundary.textContent = "A Researcher is a local routing profile. Taught paths are resolved as a provenance-preserving overlay; profiles and histories are not merged.";
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
  else if (teachingLoadFailed) status.textContent = "Teaching metadata could not be read; Researchers are using only their own saved paths.";
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

  document.addEventListener("counterpedia:researcher-teaching-changed", () => {
    void reloadTeaching().then(renderSection);
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
