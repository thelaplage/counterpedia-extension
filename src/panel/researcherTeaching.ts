/**
 * CHECK-RESEARCHER-TEACH0 — local, explicit Researcher-to-Researcher teaching.
 *
 * The UI creates metadata grants over existing attributable path references.
 * It never copies knowledge bytes, merges histories, admits memory, or executes
 * an agent. Retag/revoke append new metadata events instead of rewriting origin.
 */

import {
  chromeResearcherProfileStorage,
  parseResearcherProfiles,
  RESEARCHER_PROFILE_STORAGE_KEY,
  type ResearcherProfile,
} from "../lib/researcherProfiles";
import {
  appendResearcherTeachingEvent,
  buildTeachingGrantEvent,
  buildTeachingUpdateEvent,
  chromeResearcherTeachingStorage,
  deriveTeachingGrantStates,
  parseResearcherTeachingEvents,
  RESEARCHER_TEACHING_STORAGE_KEY,
  type ResearcherTeachingEvent,
  type ResearcherTeachingGrantState,
} from "../lib/researcherTeaching";

const profileStorage = chromeResearcherProfileStorage();
const teachingStorage = chromeResearcherTeachingStorage();
let profiles: ResearcherProfile[] = [];
let events: ResearcherTeachingEvent[] = [];
let failed = false;
let loaded = false;
let filterValue = "";

function id(): string {
  return crypto.randomUUID();
}

async function load(): Promise<void> {
  try {
    profiles = parseResearcherProfiles(
      await profileStorage.get(RESEARCHER_PROFILE_STORAGE_KEY),
    );
    events = parseResearcherTeachingEvents(
      await teachingStorage.get(RESEARCHER_TEACHING_STORAGE_KEY),
    );
    failed = false;
  } catch {
    profiles = [];
    events = [];
    failed = true;
  } finally {
    loaded = true;
  }
}

function ensureSection(): HTMLElement | null {
  const list = document.getElementById("results-list");
  if (!list) return null;
  let section = document.getElementById("researcher-teaching");
  if (!section) {
    section = document.createElement("section");
    section.id = "researcher-teaching";
    section.setAttribute("aria-label", "Teach between Researchers");
    section.style.margin = "10px 0";
    section.style.padding = "10px";
    section.style.border = "1px solid #e5e7eb";
    section.style.borderRadius = "6px";
    section.style.background = "#fff";
    list.parentNode?.insertBefore(section, list);
  }
  return section;
}

function option(value: string, label: string): HTMLOptionElement {
  const out = document.createElement("option");
  out.value = value;
  out.textContent = label;
  return out;
}

/** Exported for tests: builds the per-path checkbox list for a source Researcher. */
export function pathSelection(source: ResearcherProfile): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = "researcher-teaching-paths";
  wrap.style.marginTop = "7px";
  for (const path of source.paths) {
    const label = document.createElement("label");
    label.style.display = "block";
    label.style.fontSize = "10px";
    label.style.margin = "3px 0";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    // Default unchecked: teaching one path must never silently grant every
    // path on a source Researcher. The user opts in per path explicitly.
    checkbox.checked = false;
    checkbox.dataset["teachPathId"] = path.id;
    label.appendChild(checkbox);
    label.append(` ${path.label} · ${path.domain}`);
    wrap.appendChild(label);
  }
  return wrap;
}

/** Exported for tests: reads only the explicitly-checked path checkboxes. */
export function selectedTeachingPathIds(): Set<string> {
  return new Set(
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "#researcher-teaching-paths input[data-teach-path-id]:checked",
      ),
    )
      .map((input) => input.dataset["teachPathId"])
      .filter((value): value is string => Boolean(value)),
  );
}

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

async function append(event: ResearcherTeachingEvent): Promise<void> {
  await appendResearcherTeachingEvent(teachingStorage, event);
  events = [...events, event];
  document.dispatchEvent(
    new CustomEvent("counterpedia:researcher-teaching-changed"),
  );
}

async function teach(
  source: ResearcherProfile,
  target: ResearcherProfile,
  tags: string[],
): Promise<void> {
  await append(
    buildTeachingGrantEvent({
      eventId: id(),
      grantId: id(),
      eventAt: new Date().toISOString(),
      source,
      target,
      pathIds: selectedTeachingPathIds(),
      tags,
    }),
  );
}

async function retag(
  grant: ResearcherTeachingGrantState,
  tags: string[],
): Promise<void> {
  await append(
    buildTeachingUpdateEvent({
      eventId: id(),
      eventAt: new Date().toISOString(),
      grant,
      action: "retag",
      tags,
    }),
  );
}

async function revoke(grant: ResearcherTeachingGrantState): Promise<void> {
  await append(
    buildTeachingUpdateEvent({
      eventId: id(),
      eventAt: new Date().toISOString(),
      grant,
      action: "revoke",
    }),
  );
}

function grantMatches(grant: ResearcherTeachingGrantState): boolean {
  const needle = filterValue.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    grant.source_profile_name,
    grant.target_profile_name,
    ...grant.tags,
    ...grant.paths.map((path) => path.label),
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

function renderGrant(grant: ResearcherTeachingGrantState): HTMLElement {
  const card = document.createElement("div");
  card.style.marginTop = "7px";
  card.style.padding = "7px";
  card.style.border = "1px solid #e5e7eb";
  card.style.borderRadius = "5px";
  card.style.background = grant.active ? "#f9fafb" : "#f3f4f6";

  const title = document.createElement("div");
  title.textContent = `${grant.source_profile_name} → ${grant.target_profile_name}`;
  title.style.fontWeight = "600";
  title.style.fontSize = "11px";
  card.appendChild(title);

  const paths = document.createElement("div");
  paths.textContent = grant.paths.map((path) => path.label).join(" · ");
  paths.style.fontSize = "10px";
  paths.style.color = "#6b7280";
  paths.style.marginTop = "3px";
  card.appendChild(paths);

  const tags = document.createElement("input");
  tags.type = "text";
  tags.value = grant.tags.join(", ");
  tags.placeholder = "tags, e.g. recording industry";
  tags.disabled = !grant.active;
  tags.style.marginTop = "5px";
  tags.style.width = "100%";
  tags.style.fontSize = "10px";
  card.appendChild(tags);

  const historyCount = events.filter((event) => event.grant_id === grant.grant_id).length;
  const history = document.createElement("div");
  history.textContent = `${grant.active ? "Active" : "Stopped"} · metadata history ${historyCount} event${historyCount === 1 ? "" : "s"}`;
  history.style.marginTop = "4px";
  history.style.fontSize = "9px";
  history.style.color = "#6b7280";
  card.appendChild(history);

  if (grant.active) {
    const retagButton = document.createElement("button");
    retagButton.type = "button";
    retagButton.className = "capture-btn";
    retagButton.textContent = "Update tags";
    retagButton.style.marginTop = "5px";
    retagButton.addEventListener("click", () => {
      void retag(grant, parseTags(tags.value)).then(renderSection).catch(renderFailure);
    });
    card.appendChild(retagButton);

    const revokeButton = document.createElement("button");
    revokeButton.type = "button";
    revokeButton.className = "capture-btn";
    revokeButton.textContent = "Stop teaching";
    revokeButton.style.margin = "5px 0 0 5px";
    revokeButton.addEventListener("click", () => {
      void revoke(grant).then(renderSection).catch(renderFailure);
    });
    card.appendChild(revokeButton);
  }

  return card;
}

function renderFailure(): void {
  failed = true;
  renderSection();
}

function renderSection(): void {
  const section = ensureSection();
  if (!section) return;
  section.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "TEACH BETWEEN RESEARCHERS";
  heading.style.fontSize = "12px";
  heading.style.margin = "0 0 3px";
  section.appendChild(heading);

  const intro = document.createElement("p");
  intro.textContent = "Carry selected inquiry paths across contexts without merging Researcher histories.";
  intro.style.fontSize = "11px";
  intro.style.margin = "0 0 3px";
  section.appendChild(intro);

  const boundary = document.createElement("p");
  boundary.textContent = "TEACH creates local, tagged metadata grants only. Origin provider, source Researcher, and metadata history remain inspectable; no knowledge bytes are copied and no memory admission occurs.";
  boundary.style.fontSize = "10px";
  boundary.style.color = "#6b7280";
  boundary.style.margin = "0 0 7px";
  section.appendChild(boundary);

  if (!loaded) {
    section.append("Loading Researchers…");
    return;
  }
  if (failed) {
    section.append("Researcher teaching state could not be read or updated. Existing state was left unchanged.");
    return;
  }
  if (profiles.length < 2) {
    section.append("Create at least two Researchers to teach between them.");
    return;
  }

  const sourceSelect = document.createElement("select");
  sourceSelect.id = "researcher-teaching-source";
  for (const profile of profiles) sourceSelect.appendChild(option(profile.profile_id, profile.name));
  section.appendChild(sourceSelect);

  const targetSelect = document.createElement("select");
  targetSelect.id = "researcher-teaching-target";
  targetSelect.style.marginLeft = "5px";
  for (const profile of profiles) targetSelect.appendChild(option(profile.profile_id, profile.name));
  if (profiles[1]) targetSelect.value = profiles[1].profile_id;
  section.appendChild(targetSelect);

  let source = profiles.find((profile) => profile.profile_id === sourceSelect.value) ?? profiles[0]!;
  let paths = pathSelection(source);
  section.appendChild(paths);

  sourceSelect.addEventListener("change", () => {
    source = profiles.find((profile) => profile.profile_id === sourceSelect.value) ?? profiles[0]!;
    const next = pathSelection(source);
    paths.replaceWith(next);
    paths = next;
  });

  const tags = document.createElement("input");
  tags.type = "text";
  tags.placeholder = "tags, e.g. recording industry, rights";
  tags.style.width = "100%";
  tags.style.marginTop = "6px";
  tags.style.fontSize = "10px";
  section.appendChild(tags);

  const teachButton = document.createElement("button");
  teachButton.type = "button";
  teachButton.className = "capture-btn";
  teachButton.textContent = "Teach selected paths";
  teachButton.style.marginTop = "6px";
  teachButton.addEventListener("click", () => {
    const target = profiles.find((profile) => profile.profile_id === targetSelect.value);
    if (!target) return;
    void teach(source, target, parseTags(tags.value)).then(renderSection).catch(renderFailure);
  });
  section.appendChild(teachButton);

  const savedHeading = document.createElement("div");
  savedHeading.textContent = "Teaching metadata";
  savedHeading.style.marginTop = "10px";
  savedHeading.style.fontSize = "10px";
  savedHeading.style.fontWeight = "700";
  savedHeading.style.textTransform = "uppercase";
  section.appendChild(savedHeading);

  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = "Filter by Researcher, path, or tag";
  filter.value = filterValue;
  filter.style.width = "100%";
  filter.style.marginTop = "5px";
  filter.style.fontSize = "10px";
  filter.addEventListener("input", () => {
    filterValue = filter.value;
    renderSection();
  });
  section.appendChild(filter);

  const grants = deriveTeachingGrantStates(events).filter(grantMatches);
  if (grants.length === 0) {
    const none = document.createElement("div");
    none.textContent = "No matching teaching grants yet.";
    none.style.fontSize = "10px";
    none.style.color = "#6b7280";
    none.style.marginTop = "5px";
    section.appendChild(none);
  } else {
    for (const grant of grants) section.appendChild(renderGrant(grant));
  }
}

export function initResearcherTeaching(): void {
  renderSection();
  void load().then(renderSection);
  document.addEventListener("counterpedia:researchers-changed", () => {
    void load().then(renderSection);
  });
}
