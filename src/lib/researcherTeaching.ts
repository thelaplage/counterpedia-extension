/**
 * CHECK-RESEARCHER-TEACH0 — governed cross-Researcher teaching metadata.
 *
 * Teaching does not copy or merge knowledge stores. It records an append-only
 * local metadata history describing which attributable path references one
 * Researcher grants another Researcher permission to reuse as an inquiry lens.
 */

import type {
  ResearcherPathRef,
  ResearcherProfile,
} from "./researcherProfiles";

export const RESEARCHER_TEACHING_STORAGE_KEY =
  "counterpedia.researcher-teaching-events.v0_1";
export const RESEARCHER_TEACHING_SCHEMA =
  "counterpedia.researcher-teaching-event.v0_1" as const;
export const RESEARCHER_TEACHING_BOUNDARY = {
  retention: "local_metadata_history",
  memory_admission: "not_performed",
  knowledge_copy: "none",
  history_merge: "none",
  agent_runtime: "none",
  tool_authority: "none",
  network_egress: "none",
} as const;

export type ResearcherTeachingAction = "grant" | "retag" | "revoke";

export interface ResearcherTeachingEvent {
  schema: typeof RESEARCHER_TEACHING_SCHEMA;
  event_id: string;
  grant_id: string;
  event_at: string;
  action: ResearcherTeachingAction;
  source_profile_id: string;
  source_profile_name: string;
  target_profile_id: string;
  target_profile_name: string;
  paths: ResearcherPathRef[];
  tags: string[];
  supersedes_event_id: string | null;
  boundary: typeof RESEARCHER_TEACHING_BOUNDARY;
}

export interface ResearcherTeachingGrantState {
  grant_id: string;
  source_profile_id: string;
  source_profile_name: string;
  target_profile_id: string;
  target_profile_name: string;
  paths: ResearcherPathRef[];
  tags: string[];
  active: boolean;
  created_at: string;
  last_event_at: string;
  last_event_id: string;
}

export interface ResearcherTeachingStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: ResearcherTeachingEvent[]): Promise<void>;
}

export class ResearcherTeachingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearcherTeachingError";
  }
}

function bounded(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new ResearcherTeachingError(`${field}_invalid`);
  }
  return trimmed;
}

function validTime(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new ResearcherTeachingError("event_at_invalid");
  }
  return value;
}

export function normalizeTeachingTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const value = raw.trim();
    if (!value) continue;
    if (value.length > 48) throw new ResearcherTeachingError("tag_invalid");
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length > 16) throw new ResearcherTeachingError("tags_too_many");
  }
  return out;
}

function clonePath(path: ResearcherPathRef): ResearcherPathRef {
  return { ...path };
}

function isPathRef(value: unknown): value is ResearcherPathRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const path = value as Record<string, unknown>;
  return (
    typeof path["id"] === "string" &&
    typeof path["label"] === "string" &&
    typeof path["kind"] === "string" &&
    typeof path["domain"] === "string" &&
    typeof path["provider_id"] === "string" &&
    typeof path["provider_kind"] === "string" &&
    typeof path["basis"] === "string"
  );
}

function isStoredEvent(value: unknown): value is ResearcherTeachingEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const boundary = event["boundary"] as Record<string, unknown> | undefined;
  return (
    event["schema"] === RESEARCHER_TEACHING_SCHEMA &&
    typeof event["event_id"] === "string" &&
    typeof event["grant_id"] === "string" &&
    typeof event["event_at"] === "string" &&
    (event["action"] === "grant" ||
      event["action"] === "retag" ||
      event["action"] === "revoke") &&
    typeof event["source_profile_id"] === "string" &&
    typeof event["source_profile_name"] === "string" &&
    typeof event["target_profile_id"] === "string" &&
    typeof event["target_profile_name"] === "string" &&
    Array.isArray(event["paths"]) &&
    event["paths"].every(isPathRef) &&
    Array.isArray(event["tags"]) &&
    event["tags"].every((tag) => typeof tag === "string") &&
    (event["supersedes_event_id"] === null ||
      typeof event["supersedes_event_id"] === "string") &&
    boundary?.["retention"] === RESEARCHER_TEACHING_BOUNDARY.retention &&
    boundary?.["memory_admission"] ===
      RESEARCHER_TEACHING_BOUNDARY.memory_admission &&
    boundary?.["knowledge_copy"] === RESEARCHER_TEACHING_BOUNDARY.knowledge_copy &&
    boundary?.["history_merge"] === RESEARCHER_TEACHING_BOUNDARY.history_merge &&
    boundary?.["agent_runtime"] === RESEARCHER_TEACHING_BOUNDARY.agent_runtime &&
    boundary?.["tool_authority"] === RESEARCHER_TEACHING_BOUNDARY.tool_authority &&
    boundary?.["network_egress"] === RESEARCHER_TEACHING_BOUNDARY.network_egress
  );
}

export function parseResearcherTeachingEvents(
  value: unknown,
): ResearcherTeachingEvent[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isStoredEvent)) {
    throw new ResearcherTeachingError("storage_corrupt");
  }
  const events = value as ResearcherTeachingEvent[];
  deriveTeachingGrantStates(events);
  return events;
}

export function buildTeachingGrantEvent(input: {
  eventId: string;
  grantId: string;
  eventAt: string;
  source: ResearcherProfile;
  target: ResearcherProfile;
  pathIds: ReadonlySet<string>;
  tags?: readonly string[];
}): ResearcherTeachingEvent {
  if (input.source.profile_id === input.target.profile_id) {
    throw new ResearcherTeachingError("same_researcher");
  }
  const paths = input.source.paths
    .filter((path) => input.pathIds.has(path.id))
    .map(clonePath);
  if (paths.length === 0) throw new ResearcherTeachingError("paths_empty");

  return {
    schema: RESEARCHER_TEACHING_SCHEMA,
    event_id: bounded(input.eventId, "event_id", 160),
    grant_id: bounded(input.grantId, "grant_id", 160),
    event_at: validTime(input.eventAt),
    action: "grant",
    source_profile_id: bounded(input.source.profile_id, "source_profile_id", 128),
    source_profile_name: bounded(input.source.name, "source_profile_name", 120),
    target_profile_id: bounded(input.target.profile_id, "target_profile_id", 128),
    target_profile_name: bounded(input.target.name, "target_profile_name", 120),
    paths,
    tags: normalizeTeachingTags(input.tags ?? []),
    supersedes_event_id: null,
    boundary: RESEARCHER_TEACHING_BOUNDARY,
  };
}

export function deriveTeachingGrantStates(
  events: readonly ResearcherTeachingEvent[],
): ResearcherTeachingGrantState[] {
  const states = new Map<string, ResearcherTeachingGrantState>();

  for (const event of events) {
    if (event.action === "grant") {
      if (states.has(event.grant_id)) {
        throw new ResearcherTeachingError("duplicate_grant");
      }
      states.set(event.grant_id, {
        grant_id: event.grant_id,
        source_profile_id: event.source_profile_id,
        source_profile_name: event.source_profile_name,
        target_profile_id: event.target_profile_id,
        target_profile_name: event.target_profile_name,
        paths: event.paths.map(clonePath),
        tags: [...event.tags],
        active: true,
        created_at: event.event_at,
        last_event_at: event.event_at,
        last_event_id: event.event_id,
      });
      continue;
    }

    const current = states.get(event.grant_id);
    if (!current) throw new ResearcherTeachingError("orphan_event");
    if (event.supersedes_event_id !== current.last_event_id) {
      throw new ResearcherTeachingError("history_discontinuity");
    }
    if (
      event.source_profile_id !== current.source_profile_id ||
      event.target_profile_id !== current.target_profile_id
    ) {
      throw new ResearcherTeachingError("grant_identity_changed");
    }

    if (event.action === "retag") {
      current.tags = [...event.tags];
    } else {
      current.active = false;
    }
    current.last_event_at = event.event_at;
    current.last_event_id = event.event_id;
  }

  return Array.from(states.values());
}

export function buildTeachingUpdateEvent(input: {
  eventId: string;
  eventAt: string;
  grant: ResearcherTeachingGrantState;
  action: "retag" | "revoke";
  tags?: readonly string[];
}): ResearcherTeachingEvent {
  if (!input.grant.active) {
    throw new ResearcherTeachingError("grant_inactive");
  }
  return {
    schema: RESEARCHER_TEACHING_SCHEMA,
    event_id: bounded(input.eventId, "event_id", 160),
    grant_id: input.grant.grant_id,
    event_at: validTime(input.eventAt),
    action: input.action,
    source_profile_id: input.grant.source_profile_id,
    source_profile_name: input.grant.source_profile_name,
    target_profile_id: input.grant.target_profile_id,
    target_profile_name: input.grant.target_profile_name,
    paths: [],
    tags:
      input.action === "retag"
        ? normalizeTeachingTags(input.tags ?? [])
        : [...input.grant.tags],
    supersedes_event_id: input.grant.last_event_id,
    boundary: RESEARCHER_TEACHING_BOUNDARY,
  };
}

export async function appendResearcherTeachingEvent(
  storage: ResearcherTeachingStorage,
  event: ResearcherTeachingEvent,
): Promise<number> {
  const existing = parseResearcherTeachingEvents(
    await storage.get(RESEARCHER_TEACHING_STORAGE_KEY),
  );
  const next = [...existing, event];
  deriveTeachingGrantStates(next);
  await storage.set(RESEARCHER_TEACHING_STORAGE_KEY, next);
  return next.length;
}

export function effectiveResearcherPaths(
  profile: ResearcherProfile,
  events: readonly ResearcherTeachingEvent[],
): ResearcherPathRef[] {
  const out = profile.paths.map(clonePath);
  const seen = new Set(out.map((path) => `${path.provider_id}\u0000${path.id}`));
  for (const grant of deriveTeachingGrantStates(events)) {
    if (!grant.active || grant.target_profile_id !== profile.profile_id) continue;
    for (const path of grant.paths) {
      const key = `${path.provider_id}\u0000${path.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clonePath(path));
    }
  }
  return out;
}

export function chromeResearcherTeachingStorage(): ResearcherTeachingStorage {
  return {
    async get(key: string): Promise<unknown> {
      const result = await chrome.storage.local.get(key);
      return result[key];
    },
    async set(key: string, value: ResearcherTeachingEvent[]): Promise<void> {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}
