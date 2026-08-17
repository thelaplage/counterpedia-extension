import { courtListenerCollector } from "../collectors/courtlistener";
import type { PassiveEncounterObservation } from "./history";

export const COLLECTOR_SETTINGS_KEY = "counterpedia_collectors_v0_1";

export interface CollectorDefinition {
  readonly id: string;
  readonly label: string;
  readonly priority: number;
  readonly optional_origins: readonly string[];
  readonly default_enabled: boolean;
  observe(url: URL): PassiveEncounterObservation | null;
}

export interface CollectorSettings {
  readonly schema_version: "counterpedia.collector_settings.v0.1";
  readonly enabled: Readonly<Record<string, boolean>>;
}

export interface CollectorStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const wikipediaCollector: CollectorDefinition = {
  id: "wikipedia_v0_1",
  label: "Wikipedia",
  priority: 100,
  optional_origins: ["https://*.wikipedia.org/*"],
  default_enabled: true,
  observe(url) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host.endsWith(".wikipedia.org")) return null;
    const language = host.slice(0, -".wikipedia.org".length);
    if (!language || language.includes(".")) return null;
    if (!url.pathname.startsWith("/wiki/")) return null;
    const rawTitle = url.pathname.slice("/wiki/".length);
    if (!rawTitle) return null;
    let title: string;
    try {
      title = decodeURIComponent(rawTitle).replaceAll("_", " ");
    } catch {
      return null;
    }
    if (!title || title.length > 1024) return null;
    const canonical = new URL(url.toString());
    canonical.hash = "";
    return {
      collector_id: "wikipedia_v0_1",
      observed_url: canonical.toString(),
      canonical_locator: canonical.toString(),
      source_kind: "wikipedia_page",
      source_native_ids: {
        wikipedia_language: language,
        wikipedia_title: title,
      },
      resolution_status: "UNRESOLVED",
    };
  },
};

const genericWebCollector: CollectorDefinition = {
  id: "generic_web_v0_1",
  label: "Web page",
  priority: 0,
  optional_origins: [],
  default_enabled: true,
  observe(url) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const observed = new URL(url.toString());
    observed.hash = "";
    return {
      collector_id: "generic_web_v0_1",
      observed_url: observed.toString(),
      source_kind: "web_page",
      source_native_ids: {},
      resolution_status: "UNRESOLVED",
    };
  },
};

export const COLLECTORS: readonly CollectorDefinition[] = Object.freeze([
  courtListenerCollector,
  wikipediaCollector,
  genericWebCollector,
]);

assertCollectorRegistry(COLLECTORS);

export function defaultCollectorSettings(): CollectorSettings {
  return {
    schema_version: "counterpedia.collector_settings.v0.1",
    enabled: Object.fromEntries(
      COLLECTORS.map((collector) => [collector.id, collector.default_enabled]),
    ),
  };
}

export async function readCollectorSettings(
  storage: CollectorStorageArea,
): Promise<CollectorSettings> {
  const raw = (await storage.get(COLLECTOR_SETTINGS_KEY))[COLLECTOR_SETTINGS_KEY];
  if (raw === undefined) return defaultCollectorSettings();
  return parseCollectorSettings(raw);
}

export async function setCollectorEnabled(
  storage: CollectorStorageArea,
  collectorId: string,
  enabled: boolean,
): Promise<void> {
  const collector = COLLECTORS.find((candidate) => candidate.id === collectorId);
  if (!collector) throw new Error(`collector:unknown:${collectorId}`);
  if (collector.id === "generic_web_v0_1" && !enabled) {
    throw new Error("collector:generic_web_is_history_baseline");
  }
  const settings = await readCollectorSettings(storage);
  await storage.set({
    [COLLECTOR_SETTINGS_KEY]: {
      schema_version: "counterpedia.collector_settings.v0.1",
      enabled: { ...settings.enabled, [collectorId]: enabled },
    } satisfies CollectorSettings,
  });
}

export function resolveCollectorObservation(
  rawUrl: string,
  settings: CollectorSettings = defaultCollectorSettings(),
): PassiveEncounterObservation | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const ordered = [...COLLECTORS].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  for (const collector of ordered) {
    if (settings.enabled[collector.id] !== true) continue;
    const observation = collector.observe(url);
    if (observation) return observation;
  }
  return null;
}

export function assertCollectorRegistry(
  collectors: readonly CollectorDefinition[],
): void {
  const seen = new Set<string>();
  for (const collector of collectors) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(collector.id)) {
      throw new Error(`collector:invalid_id:${collector.id}`);
    }
    if (seen.has(collector.id)) throw new Error(`collector:duplicate_id:${collector.id}`);
    seen.add(collector.id);
  }
}

function parseCollectorSettings(value: unknown): CollectorSettings {
  if (!isPlainObject(value)) throw new Error("collector_settings:expected_object");
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "schema_version" && key !== "enabled")) {
    throw new Error("collector_settings:unknown_field");
  }
  if (value.schema_version !== "counterpedia.collector_settings.v0.1") {
    throw new Error("collector_settings:schema");
  }
  if (!isPlainObject(value.enabled)) throw new Error("collector_settings:enabled_object");
  const defaults = defaultCollectorSettings();
  const enabled: Record<string, boolean> = { ...defaults.enabled };
  for (const [id, flag] of Object.entries(value.enabled)) {
    if (!COLLECTORS.some((collector) => collector.id === id)) {
      throw new Error(`collector_settings:unknown_collector:${id}`);
    }
    if (typeof flag !== "boolean") throw new Error(`collector_settings:invalid_flag:${id}`);
    enabled[id] = flag;
  }
  if (enabled.generic_web_v0_1 !== true) {
    throw new Error("collector_settings:generic_web_must_remain_enabled");
  }
  return {
    schema_version: "counterpedia.collector_settings.v0.1",
    enabled,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
