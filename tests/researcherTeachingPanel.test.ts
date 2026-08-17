// @vitest-environment jsdom
/**
 * CHECK-RESEARCHER-TEACH0 panel UI — checkbox default.
 *
 * Teaching one path from a source Researcher must never silently grant every
 * path on that Researcher by default. Each per-path checkbox must render
 * unchecked, and only explicitly-checked paths may be read back as the
 * teaching selection.
 */
import { describe, expect, it } from "vitest";
import {
  pathSelection,
  selectedTeachingPathIds,
} from "../src/panel/researcherTeaching";
import {
  RESEARCHER_PROFILE_BOUNDARY,
  RESEARCHER_PROFILE_SCHEMA,
  type ResearcherProfile,
} from "../src/lib/researcherProfiles";

function profile(pathIds: string[]): ResearcherProfile {
  return {
    schema: RESEARCHER_PROFILE_SCHEMA,
    profile_id: "profile-1",
    name: "Source Researcher",
    created_at: new Date().toISOString(),
    seed_query: "record-label economics",
    paths: pathIds.map((id) => ({
      id,
      label: id,
      kind: "record_topic",
      domain: "Public Counterpedia",
      provider_id: "counterpedia.public",
      provider_kind: "public_reference",
      basis: "record_title",
    })),
    boundary: RESEARCHER_PROFILE_BOUNDARY,
  };
}

function mount(source: ResearcherProfile): HTMLElement {
  const wrap = pathSelection(source);
  document.body.appendChild(wrap);
  return wrap;
}

describe("researcherTeaching panel — per-path checkbox default", () => {
  it("renders every path checkbox unchecked by default", () => {
    document.body.innerHTML = "";
    mount(profile(["path-a", "path-b", "path-c"]));

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      "#researcher-teaching-paths input[data-teach-path-id]",
    );
    expect(checkboxes.length).toBe(3);
    for (const checkbox of Array.from(checkboxes)) {
      expect(checkbox.checked).toBe(false);
    }
  });

  it("with nothing checked, teaching transfers no paths", () => {
    document.body.innerHTML = "";
    mount(profile(["path-a", "path-b"]));

    expect(selectedTeachingPathIds()).toEqual(new Set());
  });

  it("teaching transfers only the paths the user explicitly checked", () => {
    document.body.innerHTML = "";
    mount(profile(["path-a", "path-b", "path-c"]));

    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      "#researcher-teaching-paths input[data-teach-path-id]",
    );
    // Explicitly opt in to only one of the three paths.
    const target = Array.from(checkboxes).find(
      (checkbox) => checkbox.dataset["teachPathId"] === "path-b",
    );
    expect(target).toBeDefined();
    target!.checked = true;

    expect(selectedTeachingPathIds()).toEqual(new Set(["path-b"]));
  });
});
