import type { LocalStorageArea } from "./history";

export const RESEARCH_SESSIONS_KEY = "counterpedia_research_sessions_v0_1";
export const ACTIVE_RESEARCH_SESSION_KEY = "counterpedia_active_research_session_v0_1";
export const RESEARCH_SESSION_SCHEMA = "counterpedia.research_session.v0.1" as const;

export interface ResearchSessionV01 {
  readonly schema_version: typeof RESEARCH_SESSION_SCHEMA;
  readonly session_ref: string;
  readonly name: string;
  readonly started_at: string;
  readonly stopped_at?: string;
  readonly encounter_ids: readonly string[];
  readonly retention: "LOCAL_ONLY";
}

export interface SessionOptions {
  readonly now?: () => string;
  readonly makeId?: () => string;
}

const MAX_SESSIONS = 500;
const MAX_ENCOUNTERS_PER_SESSION = 5000;
const SESSION_KEYS = new Set([
  "schema_version",
  "session_ref",
  "name",
  "started_at",
  "stopped_at",
  "encounter_ids",
  "retention",
]);

export async function readResearchSessions(
  storage: LocalStorageArea,
): Promise<ResearchSessionV01[]> {
  const raw = (await storage.get(RESEARCH_SESSIONS_KEY))[RESEARCH_SESSIONS_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SESSIONS) {
    throw new Error("research_sessions:invalid_container");
  }
  return raw.map(parseSession);
}

export async function readActiveResearchSessionRef(
  storage: LocalStorageArea,
): Promise<string | undefined> {
  const raw = (await storage.get(ACTIVE_RESEARCH_SESSION_KEY))[ACTIVE_RESEARCH_SESSION_KEY];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 160) {
    throw new Error("research_session:active_ref_invalid");
  }
  const sessions = await readResearchSessions(storage);
  const session = sessions.find((candidate) => candidate.session_ref === raw);
  if (!session || session.stopped_at) {
    throw new Error("research_session:active_ref_not_open_session");
  }
  return raw;
}

export async function startResearchSession(
  storage: LocalStorageArea,
  name: string,
  options: SessionOptions = {},
): Promise<ResearchSessionV01> {
  if ((await readActiveResearchSessionRef(storage)) !== undefined) {
    throw new Error("research_session:already_active");
  }
  const normalizedName = normalizeName(name);
  const now = (options.now ?? (() => new Date().toISOString()))();
  assertIsoUtc(now, "started_at");
  const id = (options.makeId ?? (() => crypto.randomUUID()))();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
    throw new Error("research_session:id_invalid");
  }

  const sessions = await readResearchSessions(storage);
  if (sessions.length >= MAX_SESSIONS) throw new Error("research_sessions:limit_reached");
  const session = parseSession({
    schema_version: RESEARCH_SESSION_SCHEMA,
    session_ref: `research-session:${id}`,
    name: normalizedName,
    started_at: now,
    encounter_ids: [],
    retention: "LOCAL_ONLY",
  });

  await storage.set({
    [RESEARCH_SESSIONS_KEY]: [...sessions, session],
    [ACTIVE_RESEARCH_SESSION_KEY]: session.session_ref,
  });
  return session;
}

export async function stopResearchSession(
  storage: LocalStorageArea,
  options: Pick<SessionOptions, "now"> = {},
): Promise<ResearchSessionV01> {
  const activeRef = await readActiveResearchSessionRef(storage);
  if (!activeRef) throw new Error("research_session:none_active");
  const stoppedAt = (options.now ?? (() => new Date().toISOString()))();
  assertIsoUtc(stoppedAt, "stopped_at");

  const sessions = await readResearchSessions(storage);
  const index = sessions.findIndex((session) => session.session_ref === activeRef);
  if (index < 0) throw new Error("research_session:active_missing");
  const current = sessions[index];
  if (current === undefined) throw new Error("research_session:active_missing");
  if (Date.parse(stoppedAt) < Date.parse(current.started_at)) {
    throw new Error("research_session:stop_before_start");
  }
  const stopped = parseSession({ ...current, stopped_at: stoppedAt });
  const updated = [...sessions];
  updated[index] = stopped;
  await storage.set({ [RESEARCH_SESSIONS_KEY]: updated });
  await storage.remove(ACTIVE_RESEARCH_SESSION_KEY);
  return stopped;
}

export async function appendEncounterToResearchSession(
  storage: LocalStorageArea,
  sessionRef: string,
  encounterId: string,
): Promise<void> {
  const sessions = await readResearchSessions(storage);
  const index = sessions.findIndex((session) => session.session_ref === sessionRef);
  if (index < 0) throw new Error("research_session:not_found");
  const session = sessions[index];
  if (session === undefined) throw new Error("research_session:not_found");
  if (session.stopped_at) throw new Error("research_session:already_stopped");
  if (session.encounter_ids.includes(encounterId)) return;
  if (session.encounter_ids.length >= MAX_ENCOUNTERS_PER_SESSION) {
    throw new Error("research_session:encounter_limit_reached");
  }
  const updated = [...sessions];
  updated[index] = parseSession({
    ...session,
    encounter_ids: [...session.encounter_ids, boundedEncounterId(encounterId)],
  });
  await storage.set({ [RESEARCH_SESSIONS_KEY]: updated });
}

export async function deleteResearchSession(
  storage: LocalStorageArea,
  sessionRef: string,
): Promise<void> {
  const activeRef = await readActiveResearchSessionRef(storage);
  if (activeRef === sessionRef) throw new Error("research_session:stop_before_delete");
  const sessions = await readResearchSessions(storage);
  const filtered = sessions.filter((session) => session.session_ref !== sessionRef);
  if (filtered.length === sessions.length) throw new Error("research_session:not_found");
  await storage.set({ [RESEARCH_SESSIONS_KEY]: filtered });
}

function parseSession(value: unknown): ResearchSessionV01 {
  if (!isPlainObject(value)) throw new Error("research_session:expected_object");
  for (const key of Object.keys(value)) {
    if (!SESSION_KEYS.has(key)) throw new Error(`research_session:unknown_field:${key}`);
  }
  if (value.schema_version !== RESEARCH_SESSION_SCHEMA) throw new Error("research_session:schema");
  if (value.retention !== "LOCAL_ONLY") throw new Error("research_session:retention");
  const session_ref = boundedString(value.session_ref, "session_ref", 160);
  if (!session_ref.startsWith("research-session:")) throw new Error("research_session:ref_prefix");
  const name = normalizeName(value.name);
  const started_at = boundedString(value.started_at, "started_at", 64);
  assertIsoUtc(started_at, "started_at");
  let stopped_at: string | undefined;
  if (value.stopped_at !== undefined) {
    stopped_at = boundedString(value.stopped_at, "stopped_at", 64);
    assertIsoUtc(stopped_at, "stopped_at");
  }
  if (!Array.isArray(value.encounter_ids) || value.encounter_ids.length > MAX_ENCOUNTERS_PER_SESSION) {
    throw new Error("research_session:encounter_ids_invalid");
  }
  const encounter_ids = value.encounter_ids.map(boundedEncounterId);
  if (new Set(encounter_ids).size !== encounter_ids.length) {
    throw new Error("research_session:duplicate_encounter_id");
  }
  return {
    schema_version: RESEARCH_SESSION_SCHEMA,
    session_ref,
    name,
    started_at,
    ...(stopped_at ? { stopped_at } : {}),
    encounter_ids,
    retention: "LOCAL_ONLY",
  };
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw new Error("research_session:name_invalid");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 120) {
    throw new Error("research_session:name_invalid");
  }
  return normalized;
}

function boundedEncounterId(value: unknown): string {
  return boundedString(value, "encounter_id", 128);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new Error(`research_session:${field}:invalid`);
  }
  return value;
}

function assertIsoUtc(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) {
    throw new Error(`research_session:${field}:not_utc_iso`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
