/**
 * CP-HISTORY0 — private local browser encounter history.
 *
 * History ON authorizes only a write to chrome.storage.local. It does not
 * authorize telemetry, acquisition, Amnesiac admission, Countergraph mutation,
 * publication, verification, or standing changes.
 */

export const HISTORY_MODE_KEY = "counterpedia_history_mode_v0_1";
export const ENCOUNTER_LEDGER_KEY = "counterpedia_encounters_v0_1";
export const CORPUS_MISS_LEDGER_KEY = "counterpedia_corpus_misses_v0_1";

export const ENCOUNTER_SCHEMA = "counterpedia.browser_encounter.v0.1" as const;
export const CORPUS_MISS_SCHEMA = "counterpedia.local_corpus_miss.v0.1" as const;

export type HistoryMode = "ON" | "OFF";
export type EncounterResolutionStatus =
  | "UNRESOLVED"
  | "MATCHED"
  | "AMBIGUOUS"
  | "UNMATCHED";
export type CorpusPresence = "current" | "historical_retired";

export interface BrowserEncounterV01 {
  readonly schema_version: typeof ENCOUNTER_SCHEMA;
  readonly encounter_id: string;
  readonly occurred_at: string;
  readonly collector_id: string;
  readonly observed_url: string;
  readonly canonical_locator?: string;
  readonly source_kind: string;
  readonly source_native_ids: Readonly<Record<string, string>>;
  readonly resolution_status: EncounterResolutionStatus;
  /** Identity/presence only. This is deliberately not a standing field. */
  readonly corpus_presence?: CorpusPresence;
  readonly canonical_source_ref?: string;
  readonly provisional_source_ref?: string;
  readonly session_ref?: string;
}

export interface LocalCorpusMissV01 {
  readonly schema_version: typeof CORPUS_MISS_SCHEMA;
  readonly miss_id: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly encounter_count: number;
  readonly collector_id: string;
  readonly observed_url: string;
  readonly canonical_locator?: string;
  readonly source_kind: string;
  readonly source_native_ids: Readonly<Record<string, string>>;
  readonly resolution_status: "UNMATCHED" | "AMBIGUOUS";
  readonly reporting_status: "LOCAL_ONLY";
}

export interface PassiveEncounterObservation {
  readonly collector_id: string;
  readonly observed_url: string;
  readonly canonical_locator?: string;
  readonly source_kind: string;
  readonly source_native_ids?: Readonly<Record<string, string>>;
  readonly resolution_status?: EncounterResolutionStatus;
  readonly corpus_presence?: CorpusPresence;
  readonly canonical_source_ref?: string;
  readonly provisional_source_ref?: string;
  readonly session_ref?: string;
}

export interface LocalStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface RecordEncounterOptions {
  readonly now?: () => string;
  readonly makeId?: () => string;
}

const MAX_ENCOUNTERS = 5000;
const MAX_MISSES = 2000;

const ENCOUNTER_KEYS = new Set([
  "schema_version",
  "encounter_id",
  "occurred_at",
  "collector_id",
  "observed_url",
  "canonical_locator",
  "source_kind",
  "source_native_ids",
  "resolution_status",
  "corpus_presence",
  "canonical_source_ref",
  "provisional_source_ref",
  "session_ref",
]);
const MISS_KEYS = new Set([
  "schema_version",
  "miss_id",
  "first_seen_at",
  "last_seen_at",
  "encounter_count",
  "collector_id",
  "observed_url",
  "canonical_locator",
  "source_kind",
  "source_native_ids",
  "resolution_status",
  "reporting_status",
]);
const AUTHORITY_FIELDS = new Set([
  "truth",
  "standing",
  "verified",
  "verification",
  "admitted",
  "admission",
  "published",
  "publication",
]);

export async function readHistoryMode(storage: LocalStorageArea): Promise<HistoryMode> {
  const result = await storage.get(HISTORY_MODE_KEY);
  return result[HISTORY_MODE_KEY] === "ON" ? "ON" : "OFF";
}

export async function setHistoryMode(
  storage: LocalStorageArea,
  mode: HistoryMode,
): Promise<void> {
  if (mode !== "ON" && mode !== "OFF") throw new Error("history_mode:invalid");
  await storage.set({ [HISTORY_MODE_KEY]: mode });
}

export async function readEncounterLedger(
  storage: LocalStorageArea,
): Promise<BrowserEncounterV01[]> {
  const result = await storage.get(ENCOUNTER_LEDGER_KEY);
  const raw = result[ENCOUNTER_LEDGER_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ENCOUNTERS) {
    throw new Error("history_ledger:invalid_container");
  }
  return raw.map(parseEncounter);
}

export async function readCorpusMissLedger(
  storage: LocalStorageArea,
): Promise<LocalCorpusMissV01[]> {
  const result = await storage.get(CORPUS_MISS_LEDGER_KEY);
  const raw = result[CORPUS_MISS_LEDGER_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_MISSES) {
    throw new Error("corpus_miss_ledger:invalid_container");
  }
  return raw.map(parseCorpusMiss);
}

export async function recordPassiveEncounter(
  storage: LocalStorageArea,
  observation: PassiveEncounterObservation,
  options: RecordEncounterOptions = {},
): Promise<{ recorded: false } | { recorded: true; encounter: BrowserEncounterV01 }> {
  if ((await readHistoryMode(storage)) !== "ON") return { recorded: false };

  const occurredAt = (options.now ?? (() => new Date().toISOString()))();
  assertIsoUtc(occurredAt, "occurred_at");
  const makeId = options.makeId ?? (() => crypto.randomUUID());

  const encounter = parseEncounter({
    schema_version: ENCOUNTER_SCHEMA,
    encounter_id: makeId(),
    occurred_at: occurredAt,
    collector_id: observation.collector_id,
    observed_url: observation.observed_url,
    canonical_locator: observation.canonical_locator,
    source_kind: observation.source_kind,
    source_native_ids: observation.source_native_ids ?? {},
    resolution_status: observation.resolution_status ?? "UNRESOLVED",
    corpus_presence: observation.corpus_presence,
    canonical_source_ref: observation.canonical_source_ref,
    provisional_source_ref: observation.provisional_source_ref,
    session_ref: observation.session_ref,
  });

  const ledger = await readEncounterLedger(storage);
  if (ledger.length >= MAX_ENCOUNTERS) throw new Error("history_ledger:limit_reached");
  await storage.set({ [ENCOUNTER_LEDGER_KEY]: [...ledger, encounter] });

  if (
    encounter.resolution_status === "UNMATCHED" ||
    encounter.resolution_status === "AMBIGUOUS"
  ) {
    await upsertCorpusMiss(storage, encounter);
  }

  return { recorded: true, encounter };
}

export async function clearCounterpediaHistory(storage: LocalStorageArea): Promise<void> {
  await storage.remove([ENCOUNTER_LEDGER_KEY, CORPUS_MISS_LEDGER_KEY]);
}

export function observationFromTopLevelUrl(url: string): PassiveEncounterObservation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hash = "";
  return {
    collector_id: "generic_web_v0_1",
    observed_url: parsed.toString(),
    source_kind: "web_page",
    source_native_ids: {},
    resolution_status: "UNRESOLVED",
  };
}

async function upsertCorpusMiss(
  storage: LocalStorageArea,
  encounter: BrowserEncounterV01,
): Promise<void> {
  const resolution = encounter.resolution_status;
  if (resolution !== "UNMATCHED" && resolution !== "AMBIGUOUS") {
    throw new Error("corpus_miss:encounter_resolution_not_miss");
  }

  const misses = await readCorpusMissLedger(storage);
  const identity = missIdentity(encounter);
  const index = misses.findIndex((miss) => missIdentity(miss) === identity);

  if (index >= 0) {
    const existing = misses[index];
    const next = parseCorpusMiss({
      ...existing,
      last_seen_at: encounter.occurred_at,
      encounter_count: existing.encounter_count + 1,
      resolution_status: resolution,
    });
    const updated = [...misses];
    updated[index] = next;
    await storage.set({ [CORPUS_MISS_LEDGER_KEY]: updated });
    return;
  }

  if (misses.length >= MAX_MISSES) throw new Error("corpus_miss_ledger:limit_reached");
  const miss = parseCorpusMiss({
    schema_version: CORPUS_MISS_SCHEMA,
    miss_id: `miss:${encounter.encounter_id}`,
    first_seen_at: encounter.occurred_at,
    last_seen_at: encounter.occurred_at,
    encounter_count: 1,
    collector_id: encounter.collector_id,
    observed_url: encounter.observed_url,
    canonical_locator: encounter.canonical_locator,
    source_kind: encounter.source_kind,
    source_native_ids: encounter.source_native_ids,
    resolution_status: resolution,
    reporting_status: "LOCAL_ONLY",
  });
  await storage.set({ [CORPUS_MISS_LEDGER_KEY]: [...misses, miss] });
}

function parseEncounter(value: unknown): BrowserEncounterV01 {
  const object = strictObject(value, ENCOUNTER_KEYS, "history_encounter");
  if (object.schema_version !== ENCOUNTER_SCHEMA) throw new Error("history_encounter:schema");

  const status = object.resolution_status;
  if (
    status !== "UNRESOLVED" &&
    status !== "MATCHED" &&
    status !== "AMBIGUOUS" &&
    status !== "UNMATCHED"
  ) {
    throw new Error("history_encounter:resolution_status");
  }

  const occurred_at = stringField(object.occurred_at, "history_encounter:occurred_at", 64);
  assertIsoUtc(occurred_at, "occurred_at");
  const canonical_source_ref = optionalString(
    object.canonical_source_ref,
    "history_encounter:canonical_source_ref",
    512,
  );
  const corpus_presence = optionalCorpusPresence(object.corpus_presence);

  if (status === "MATCHED") {
    if (!canonical_source_ref) {
      throw new Error("history_encounter:matched_requires_canonical_source_ref");
    }
    if (!corpus_presence) {
      throw new Error("history_encounter:matched_requires_corpus_presence");
    }
  } else if (canonical_source_ref !== undefined || corpus_presence !== undefined) {
    throw new Error("history_encounter:nonmatched_cannot_carry_canonical_presence");
  }

  const base: BrowserEncounterV01 = {
    schema_version: ENCOUNTER_SCHEMA,
    encounter_id: stringField(object.encounter_id, "history_encounter:encounter_id", 128),
    occurred_at,
    collector_id: tokenField(object.collector_id, "history_encounter:collector_id"),
    observed_url: urlField(object.observed_url, "history_encounter:observed_url"),
    source_kind: tokenField(object.source_kind, "history_encounter:source_kind"),
    source_native_ids: nativeIds(object.source_native_ids, "history_encounter:source_native_ids"),
    resolution_status: status,
  };

  const canonical_locator = optionalUrl(
    object.canonical_locator,
    "history_encounter:canonical_locator",
  );
  const provisional_source_ref = optionalString(
    object.provisional_source_ref,
    "history_encounter:provisional_source_ref",
    512,
  );
  const session_ref = optionalString(object.session_ref, "history_encounter:session_ref", 512);

  return {
    ...base,
    ...(canonical_locator ? { canonical_locator } : {}),
    ...(corpus_presence ? { corpus_presence } : {}),
    ...(canonical_source_ref ? { canonical_source_ref } : {}),
    ...(provisional_source_ref ? { provisional_source_ref } : {}),
    ...(session_ref ? { session_ref } : {}),
  };
}

function parseCorpusMiss(value: unknown): LocalCorpusMissV01 {
  const object = strictObject(value, MISS_KEYS, "corpus_miss");
  if (object.schema_version !== CORPUS_MISS_SCHEMA) throw new Error("corpus_miss:schema");
  if (object.resolution_status !== "UNMATCHED" && object.resolution_status !== "AMBIGUOUS") {
    throw new Error("corpus_miss:resolution_status");
  }
  if (object.reporting_status !== "LOCAL_ONLY") throw new Error("corpus_miss:reporting_status");

  const first_seen_at = stringField(object.first_seen_at, "corpus_miss:first_seen_at", 64);
  const last_seen_at = stringField(object.last_seen_at, "corpus_miss:last_seen_at", 64);
  assertIsoUtc(first_seen_at, "first_seen_at");
  assertIsoUtc(last_seen_at, "last_seen_at");

  if (!Number.isSafeInteger(object.encounter_count) || (object.encounter_count as number) < 1) {
    throw new Error("corpus_miss:encounter_count");
  }

  const base: LocalCorpusMissV01 = {
    schema_version: CORPUS_MISS_SCHEMA,
    miss_id: stringField(object.miss_id, "corpus_miss:miss_id", 160),
    first_seen_at,
    last_seen_at,
    encounter_count: object.encounter_count as number,
    collector_id: tokenField(object.collector_id, "corpus_miss:collector_id"),
    observed_url: urlField(object.observed_url, "corpus_miss:observed_url"),
    source_kind: tokenField(object.source_kind, "corpus_miss:source_kind"),
    source_native_ids: nativeIds(object.source_native_ids, "corpus_miss:source_native_ids"),
    resolution_status: object.resolution_status,
    reporting_status: "LOCAL_ONLY",
  };
  const canonical_locator = optionalUrl(object.canonical_locator, "corpus_miss:canonical_locator");
  return canonical_locator ? { ...base, canonical_locator } : base;
}

function strictObject(
  value: unknown,
  allowed: Set<string>,
  prefix: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${prefix}:expected_object`);
  for (const key of Object.keys(value)) {
    if (AUTHORITY_FIELDS.has(key)) throw new Error(`${prefix}:authority_field_forbidden:${key}`);
    if (!allowed.has(key)) throw new Error(`${prefix}:unknown_field:${key}`);
  }
  return value;
}

function missIdentity(
  value: Pick<
    BrowserEncounterV01 | LocalCorpusMissV01,
    "collector_id" | "observed_url" | "canonical_locator" | "source_native_ids"
  >,
): string {
  return JSON.stringify({
    collector_id: value.collector_id,
    locator: value.canonical_locator ?? value.observed_url,
    native: Object.entries(value.source_native_ids).sort(([a], [b]) => a.localeCompare(b)),
  });
}

function nativeIds(value: unknown, field: string): Record<string, string> {
  if (!isPlainObject(value)) throw new Error(`${field}:expected_object`);
  const entries = Object.entries(value);
  if (entries.length > 16) throw new Error(`${field}:too_many`);
  const out: Record<string, string> = {};
  for (const [scheme, id] of entries) {
    if (!/^[a-z][a-z0-9._-]{0,31}$/.test(scheme)) throw new Error(`${field}:bad_scheme`);
    out[scheme] = stringField(id, `${field}.${scheme}`, 1024);
  }
  return out;
}

function optionalCorpusPresence(value: unknown): CorpusPresence | undefined {
  if (value === undefined) return undefined;
  if (value !== "current" && value !== "historical_retired") {
    throw new Error("history_encounter:corpus_presence_invalid");
  }
  return value;
}

function tokenField(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${field}:invalid`);
  }
  return value;
}

function stringField(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new Error(`${field}:invalid`);
  }
  return value;
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return stringField(value, field, max);
}

function urlField(value: unknown, field: string): string {
  const raw = stringField(value, field, 4096);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field}:invalid_url`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field}:invalid_scheme`);
  }
  return raw;
}

function optionalUrl(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return urlField(value, field);
}

function assertIsoUtc(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) {
    throw new Error(`history:${field}:not_utc_iso`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
