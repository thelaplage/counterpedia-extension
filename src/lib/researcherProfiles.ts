/**
 * CHECK-RESEARCHER0 — named local inquiry-routing profiles.
 *
 * A Researcher profile is a reusable epistemic scope assembled from explicit
 * PATHS selections. It is not an autonomous agent, prompt, tool grant, or
 * automatic activation rule.
 */

import type { InquiryPathSuggestion } from "./inquiryPaths";

export const RESEARCHER_PROFILE_STORAGE_KEY =
  "counterpedia.researcher-profiles.v0_1";
export const RESEARCHER_PROFILE_SCHEMA =
  "counterpedia.researcher-profile.v0_1" as const;
export const RESEARCHER_PROFILE_BOUNDARY = {
  retention: "local_researcher_profile",
  memory_admission: "not_performed",
  agent_runtime: "none",
  tool_authority: "none",
  automatic_activation: "no",
  network_egress: "none",
} as const;

export interface ResearcherPathRef {
  id: string;
  label: string;
  kind: InquiryPathSuggestion["kind"];
  domain: string;
  basis: string;
}

export interface ResearcherProfile {
  schema: typeof RESEARCHER_PROFILE_SCHEMA;
  profile_id: string;
  name: string;
  created_at: string;
  seed_query: string;
  paths: ResearcherPathRef[];
  boundary: typeof RESEARCHER_PROFILE_BOUNDARY;
}

export interface ResearcherProfileStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: ResearcherProfile[]): Promise<void>;
}

export interface ResearcherProfileMatch {
  matchedPathIds: string[];
  missingPathLabels: string[];
}

export class ResearcherProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearcherProfileError";
  }
}

function bounded(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new ResearcherProfileError(`${field}_invalid`);
  }
  return trimmed;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isStoredProfile(value: unknown): value is ResearcherProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  if (profile["schema"] !== RESEARCHER_PROFILE_SCHEMA) return false;
  if (typeof profile["profile_id"] !== "string") return false;
  if (typeof profile["name"] !== "string") return false;
  if (typeof profile["created_at"] !== "string") return false;
  if (typeof profile["seed_query"] !== "string") return false;
  if (!Array.isArray(profile["paths"])) return false;
  const boundary = profile["boundary"] as Record<string, unknown> | undefined;
  return (
    boundary?.["retention"] === RESEARCHER_PROFILE_BOUNDARY.retention &&
    boundary?.["memory_admission"] === RESEARCHER_PROFILE_BOUNDARY.memory_admission &&
    boundary?.["agent_runtime"] === RESEARCHER_PROFILE_BOUNDARY.agent_runtime &&
    boundary?.["tool_authority"] === RESEARCHER_PROFILE_BOUNDARY.tool_authority &&
    boundary?.["automatic_activation"] ===
      RESEARCHER_PROFILE_BOUNDARY.automatic_activation &&
    boundary?.["network_egress"] === RESEARCHER_PROFILE_BOUNDARY.network_egress
  );
}

export function buildResearcherProfile(input: {
  profileId: string;
  name: string;
  createdAt: string;
  seedQuery: string;
  suggestions: InquiryPathSuggestion[];
  selectedPathIds: ReadonlySet<string>;
}): ResearcherProfile {
  bounded(input.profileId, "profile_id", 128);
  bounded(input.name, "name", 120);
  bounded(input.seedQuery, "seed_query", 8192);
  if (Number.isNaN(Date.parse(input.createdAt))) {
    throw new ResearcherProfileError("created_at_invalid");
  }

  const paths = input.suggestions
    .filter((path) => input.selectedPathIds.has(path.id))
    .map((path) => ({
      id: bounded(path.id, "path_id", 160),
      label: bounded(path.label, "path_label", 120),
      kind: path.kind,
      domain: bounded(path.provenance.domain, "path_domain", 120),
      basis: bounded(path.provenance.basis, "path_basis", 120),
    }));

  if (paths.length === 0) {
    throw new ResearcherProfileError("paths_empty");
  }

  return {
    schema: RESEARCHER_PROFILE_SCHEMA,
    profile_id: input.profileId.trim(),
    name: input.name.trim(),
    created_at: input.createdAt,
    seed_query: input.seedQuery.trim(),
    paths,
    boundary: RESEARCHER_PROFILE_BOUNDARY,
  };
}

export function parseResearcherProfiles(value: unknown): ResearcherProfile[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isStoredProfile)) {
    throw new ResearcherProfileError("storage_corrupt");
  }
  return value as ResearcherProfile[];
}

export async function appendResearcherProfile(
  storage: ResearcherProfileStorage,
  profile: ResearcherProfile,
): Promise<number> {
  const existing = parseResearcherProfiles(
    await storage.get(RESEARCHER_PROFILE_STORAGE_KEY),
  );
  const next = [...existing, profile];
  await storage.set(RESEARCHER_PROFILE_STORAGE_KEY, next);
  return next.length;
}

export function matchResearcherProfile(
  profile: ResearcherProfile,
  suggestions: InquiryPathSuggestion[],
): ResearcherProfileMatch {
  const matchedPathIds: string[] = [];
  const missingPathLabels: string[] = [];

  for (const ref of profile.paths) {
    const exact = suggestions.find((path) => path.id === ref.id);
    const fallback = suggestions.find(
      (path) =>
        path.kind === ref.kind && normalize(path.label) === normalize(ref.label),
    );
    const match = exact ?? fallback;
    if (match) matchedPathIds.push(match.id);
    else missingPathLabels.push(ref.label);
  }

  return { matchedPathIds, missingPathLabels };
}

export function chromeResearcherProfileStorage(): ResearcherProfileStorage {
  return {
    async get(key: string): Promise<unknown> {
      const result = await chrome.storage.local.get(key);
      return result[key];
    },
    async set(key: string, value: ResearcherProfile[]): Promise<void> {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}
