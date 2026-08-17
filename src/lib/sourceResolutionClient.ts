import type {
  CorpusPresence,
  PassiveEncounterObservation,
} from "./history";

export const SOURCE_RESOLUTION_INDEX_URL =
  "https://www.garpedia.org/counterpedia/source-resolution-index.json";
export const SOURCE_RESOLUTION_CACHE_KEY =
  "counterpedia_source_resolution_index_v0_1";
export const SOURCE_RESOLUTION_SCHEMA =
  "counterpedia.source_resolution_index.v0.1" as const;

export type SourceIdentityKeyKind =
  | "canonical_source_ref"
  | "canonical_locator"
  | "native_id"
  | "capture_hash";

export interface SourceIdentityKey {
  readonly key_kind: SourceIdentityKeyKind;
  readonly value: string;
  readonly scheme?: string;
}

export interface SourceResolutionIndexEntry {
  readonly canonical_source_ref: string;
  readonly source_id: string;
  readonly corpus_presence: CorpusPresence;
  readonly identity_keys: readonly SourceIdentityKey[];
}

export interface SourceResolutionIndex {
  readonly schema_version: typeof SOURCE_RESOLUTION_SCHEMA;
  readonly generated_from: "public_source_registry";
  readonly entries: readonly SourceResolutionIndexEntry[];
}

export interface SessionStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

const MAX_INDEX_ENTRIES = 100_000;
const MAX_KEYS_PER_SOURCE = 64;
const INDEX_KEYS = new Set(["schema_version", "generated_from", "entries"]);
const ENTRY_KEYS = new Set([
  "canonical_source_ref",
  "source_id",
  "corpus_presence",
  "identity_keys",
]);
const IDENTITY_KEYS = new Set(["key_kind", "value", "scheme"]);
const AUTHORITY_KEYS = new Set([
  "truth",
  "standing",
  "verified",
  "verification",
  "admitted",
  "admission",
  "published",
  "publication",
]);

/**
 * Fetch one fixed public index and cache it in chrome.storage.session.
 * The encountered URL/native ids are never part of this request.
 */
export async function loadSourceResolutionIndex(
  storage: SessionStorageArea,
  fetchImpl: FetchLike = fetch,
): Promise<SourceResolutionIndex> {
  const cached = (await storage.get(SOURCE_RESOLUTION_CACHE_KEY))[
    SOURCE_RESOLUTION_CACHE_KEY
  ];
  if (cached !== undefined) return parseSourceResolutionIndex(cached);

  const response = await fetchImpl(SOURCE_RESOLUTION_INDEX_URL, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`source_resolution_index:http_${response.status}`);
  }
  const parsed = parseSourceResolutionIndex(await response.json());
  await storage.set({ [SOURCE_RESOLUTION_CACHE_KEY]: parsed });
  return parsed;
}

/**
 * Try the fixed public index, but do not turn index unavailability/malformed
 * bytes into a false corpus miss. The original observation remains UNRESOLVED.
 */
export async function resolveObservationWithPublicIndex(
  storage: SessionStorageArea,
  observation: PassiveEncounterObservation,
  fetchImpl: FetchLike = fetch,
): Promise<PassiveEncounterObservation> {
  try {
    const index = await loadSourceResolutionIndex(storage, fetchImpl);
    return resolveObservationAgainstIndex(index, observation);
  } catch {
    return stripCanonicalResolution(observation, "UNRESOLVED");
  }
}

/**
 * Resolve locally. Stable site-native IDs are preferred because a collector's
 * canonical browsing locator may intentionally be a normalized root while the
 * registry retains an exact observed slug URL. If no registered native key is
 * known, exact locator matching is attempted as the fallback.
 */
export function resolveObservationAgainstIndex(
  index: SourceResolutionIndex,
  observation: PassiveEncounterObservation,
): PassiveEncounterObservation {
  const nativeQueries = Object.entries(observation.source_native_ids ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scheme, value]): SourceIdentityKey => ({
      key_kind: "native_id",
      scheme,
      value,
    }));

  if (nativeQueries.length > 0) {
    const native = resolveExactKeys(index, nativeQueries);
    if (native.status === "MATCHED") return matchedObservation(observation, native.entry);
    if (native.status === "AMBIGUOUS") {
      return stripCanonicalResolution(observation, "AMBIGUOUS");
    }
    // No registered native identity key: fall through to exact locator.
  }

  const locator = observation.canonical_locator ?? observation.observed_url;
  const locatorResult = resolveExactKeys(index, [
    { key_kind: "canonical_locator", value: locator },
  ]);
  if (locatorResult.status === "MATCHED") {
    return matchedObservation(observation, locatorResult.entry);
  }
  if (locatorResult.status === "AMBIGUOUS") {
    return stripCanonicalResolution(observation, "AMBIGUOUS");
  }
  return stripCanonicalResolution(observation, "UNMATCHED");
}

export function parseSourceResolutionIndex(value: unknown): SourceResolutionIndex {
  const object = strictObject(value, INDEX_KEYS, "source_resolution_index");
  if (object.schema_version !== SOURCE_RESOLUTION_SCHEMA) {
    throw new Error("source_resolution_index:schema_version");
  }
  if (object.generated_from !== "public_source_registry") {
    throw new Error("source_resolution_index:generated_from");
  }
  if (!Array.isArray(object.entries) || object.entries.length > MAX_INDEX_ENTRIES) {
    throw new Error("source_resolution_index:entries");
  }

  const seenRefs = new Set<string>();
  const entries = object.entries.map((raw, index) => {
    const entry = strictObject(raw, ENTRY_KEYS, `source_resolution_index:entry:${index}`);
    const canonical_source_ref = boundedString(
      entry.canonical_source_ref,
      `source_resolution_index:entry:${index}:canonical_source_ref`,
      512,
    );
    const source_id = boundedString(
      entry.source_id,
      `source_resolution_index:entry:${index}:source_id`,
      512,
    );
    if (canonical_source_ref !== source_id) {
      throw new Error(`source_resolution_index:entry:${index}:source_ref_mismatch`);
    }
    if (seenRefs.has(canonical_source_ref)) {
      throw new Error(`source_resolution_index:duplicate_source_ref:${canonical_source_ref}`);
    }
    seenRefs.add(canonical_source_ref);

    const corpus_presence = parseCorpusPresence(
      entry.corpus_presence,
      `source_resolution_index:entry:${index}:corpus_presence`,
    );
    if (!Array.isArray(entry.identity_keys) || entry.identity_keys.length > MAX_KEYS_PER_SOURCE) {
      throw new Error(`source_resolution_index:entry:${index}:identity_keys`);
    }
    const seenKeys = new Set<string>();
    const identity_keys = entry.identity_keys.map((key, keyIndex) => {
      const parsed = parseIdentityKey(key, index, keyIndex);
      const identity = identityKeyId(parsed);
      if (seenKeys.has(identity)) {
        throw new Error(`source_resolution_index:entry:${index}:duplicate_identity_key`);
      }
      seenKeys.add(identity);
      return parsed;
    });
    if (
      !identity_keys.some(
        (key) =>
          key.key_kind === "canonical_source_ref" &&
          key.value === canonical_source_ref,
      )
    ) {
      throw new Error(`source_resolution_index:entry:${index}:canonical_key_missing`);
    }

    return {
      canonical_source_ref,
      source_id,
      corpus_presence,
      identity_keys,
    } satisfies SourceResolutionIndexEntry;
  });

  return {
    schema_version: SOURCE_RESOLUTION_SCHEMA,
    generated_from: "public_source_registry",
    entries,
  };
}

type LocalResolution =
  | { status: "MATCHED"; entry: SourceResolutionIndexEntry }
  | { status: "AMBIGUOUS" }
  | { status: "UNMATCHED" };

function resolveExactKeys(
  index: SourceResolutionIndex,
  queries: readonly SourceIdentityKey[],
): LocalResolution {
  const matchedEntries = new Map<string, SourceResolutionIndexEntry>();
  let anyRegisteredKey = false;

  for (const query of queries) {
    const matches = index.entries.filter((entry) =>
      entry.identity_keys.some((candidate) => sameIdentityKey(candidate, query)),
    );
    if (matches.length > 1) return { status: "AMBIGUOUS" };
    if (matches.length === 1) {
      anyRegisteredKey = true;
      matchedEntries.set(matches[0].canonical_source_ref, matches[0]);
    }
  }

  if (!anyRegisteredKey) return { status: "UNMATCHED" };
  if (matchedEntries.size !== 1) return { status: "AMBIGUOUS" };
  return { status: "MATCHED", entry: [...matchedEntries.values()][0] };
}

function matchedObservation(
  observation: PassiveEncounterObservation,
  entry: SourceResolutionIndexEntry,
): PassiveEncounterObservation {
  const base = stripCanonicalResolution(observation, "MATCHED");
  return {
    ...base,
    resolution_status: "MATCHED",
    canonical_source_ref: entry.canonical_source_ref,
    corpus_presence: entry.corpus_presence,
  };
}

function stripCanonicalResolution(
  observation: PassiveEncounterObservation,
  status: "UNRESOLVED" | "AMBIGUOUS" | "UNMATCHED" | "MATCHED",
): PassiveEncounterObservation {
  const {
    canonical_source_ref: _canonicalSourceRef,
    corpus_presence: _corpusPresence,
    ...rest
  } = observation;
  return { ...rest, resolution_status: status };
}

function parseIdentityKey(
  value: unknown,
  entryIndex: number,
  keyIndex: number,
): SourceIdentityKey {
  const prefix = `source_resolution_index:entry:${entryIndex}:key:${keyIndex}`;
  const object = strictObject(value, IDENTITY_KEYS, prefix);
  const kind = object.key_kind;
  if (
    kind !== "canonical_source_ref" &&
    kind !== "canonical_locator" &&
    kind !== "native_id" &&
    kind !== "capture_hash"
  ) {
    throw new Error(`${prefix}:key_kind`);
  }
  const rawValue = boundedString(object.value, `${prefix}:value`, 4096);
  const scheme =
    object.scheme === undefined
      ? undefined
      : boundedToken(object.scheme, `${prefix}:scheme`, 32);

  if (kind === "native_id" && !scheme) throw new Error(`${prefix}:native_scheme_required`);
  if (kind !== "native_id" && scheme !== undefined) {
    throw new Error(`${prefix}:scheme_only_for_native_id`);
  }
  if (kind === "canonical_locator") validateHttpUrl(rawValue, `${prefix}:value`);

  return {
    key_kind: kind,
    value: rawValue,
    ...(scheme ? { scheme } : {}),
  };
}

function strictObject(
  value: unknown,
  allowed: ReadonlySet<string>,
  prefix: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${prefix}:expected_object`);
  for (const key of Object.keys(value)) {
    if (AUTHORITY_KEYS.has(key)) throw new Error(`${prefix}:authority_field_forbidden:${key}`);
    if (!allowed.has(key)) throw new Error(`${prefix}:unknown_field:${key}`);
  }
  return value;
}

function parseCorpusPresence(value: unknown, field: string): CorpusPresence {
  if (value !== "current" && value !== "historical_retired") {
    throw new Error(`${field}:invalid`);
  }
  return value;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new Error(`${field}:invalid`);
  }
  return value;
}

function boundedToken(value: unknown, field: string, max: number): string {
  const text = boundedString(value, field, max);
  if (!/^[a-z][a-z0-9._-]*$/.test(text)) throw new Error(`${field}:token`);
  return text;
}

function validateHttpUrl(value: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field}:url`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${field}:url`);
  }
}

function sameIdentityKey(a: SourceIdentityKey, b: SourceIdentityKey): boolean {
  return a.key_kind === b.key_kind && a.scheme === b.scheme && a.value === b.value;
}

function identityKeyId(key: SourceIdentityKey): string {
  return `${key.key_kind}\u0000${key.scheme ?? ""}\u0000${key.value}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
