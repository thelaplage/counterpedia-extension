/**
 * Local saved inquiry routing for CHECK-PATHS0.
 *
 * A saved route is a local user preference describing which paths the user
 * intentionally selected. It is NOT an agent, memory admission, publication,
 * or a permission grant to automatically query future providers.
 */

import type { InquiryPathSuggestion } from "./inquiryPaths";

export const INQUIRY_ROUTE_STORAGE_KEY = "counterpedia.inquiry-routes.v0_1";
export const INQUIRY_ROUTE_SCHEMA = "counterpedia.inquiry-route.v0_1" as const;
export const INQUIRY_ROUTE_BOUNDARY = {
  retention: "local_user_preference",
  memory_admission: "not_performed",
  agent_created: "no",
  automatic_future_inclusion: "no",
  network_egress: "none",
} as const;

export interface SavedInquiryPath {
  id: string;
  label: string;
  kind: InquiryPathSuggestion["kind"];
  domain: string;
  basis: string;
  record_ids: string[];
}

export interface SavedInquiryRoute {
  schema: typeof INQUIRY_ROUTE_SCHEMA;
  route_id: string;
  name: string;
  saved_at: string;
  base_query: string;
  paths: SavedInquiryPath[];
  boundary: typeof INQUIRY_ROUTE_BOUNDARY;
}

export interface InquiryRouteStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: SavedInquiryRoute[]): Promise<void>;
}

export class InquiryRouteStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InquiryRouteStoreError";
  }
}

function bounded(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new InquiryRouteStoreError(`${field}_invalid`);
  }
  return trimmed;
}

function isStoredRoute(value: unknown): value is SavedInquiryRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Record<string, unknown>;
  if (route["schema"] !== INQUIRY_ROUTE_SCHEMA) return false;
  if (typeof route["route_id"] !== "string") return false;
  if (typeof route["name"] !== "string") return false;
  if (typeof route["saved_at"] !== "string") return false;
  if (typeof route["base_query"] !== "string") return false;
  if (!Array.isArray(route["paths"])) return false;
  const boundary = route["boundary"] as Record<string, unknown> | undefined;
  return (
    boundary?.["retention"] === INQUIRY_ROUTE_BOUNDARY.retention &&
    boundary?.["memory_admission"] === INQUIRY_ROUTE_BOUNDARY.memory_admission &&
    boundary?.["agent_created"] === INQUIRY_ROUTE_BOUNDARY.agent_created &&
    boundary?.["automatic_future_inclusion"] ===
      INQUIRY_ROUTE_BOUNDARY.automatic_future_inclusion &&
    boundary?.["network_egress"] === INQUIRY_ROUTE_BOUNDARY.network_egress
  );
}

export function buildSavedInquiryRoute(input: {
  routeId: string;
  name: string;
  savedAt: string;
  baseQuery: string;
  suggestions: InquiryPathSuggestion[];
  selectedPathIds: ReadonlySet<string>;
}): SavedInquiryRoute {
  bounded(input.routeId, "route_id", 128);
  bounded(input.name, "name", 120);
  bounded(input.baseQuery, "base_query", 8192);
  if (Number.isNaN(Date.parse(input.savedAt))) {
    throw new InquiryRouteStoreError("saved_at_invalid");
  }

  const paths = input.suggestions
    .filter((suggestion) => input.selectedPathIds.has(suggestion.id))
    .map((suggestion) => ({
      id: bounded(suggestion.id, "path_id", 160),
      label: bounded(suggestion.label, "path_label", 120),
      kind: suggestion.kind,
      domain: bounded(suggestion.provenance.domain, "path_domain", 120),
      basis: bounded(suggestion.provenance.basis, "path_basis", 120),
      record_ids: suggestion.provenance.recordIds.map((recordId) =>
        bounded(recordId, "record_id", 512),
      ),
    }));

  if (paths.length === 0) {
    throw new InquiryRouteStoreError("paths_empty");
  }

  return {
    schema: INQUIRY_ROUTE_SCHEMA,
    route_id: input.routeId,
    name: input.name.trim(),
    saved_at: input.savedAt,
    base_query: input.baseQuery.trim(),
    paths,
    boundary: INQUIRY_ROUTE_BOUNDARY,
  };
}

export function parseSavedInquiryRoutes(value: unknown): SavedInquiryRoute[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isStoredRoute)) {
    throw new InquiryRouteStoreError("storage_corrupt");
  }
  return value as SavedInquiryRoute[];
}

export async function appendSavedInquiryRoute(
  storage: InquiryRouteStorage,
  route: SavedInquiryRoute,
): Promise<number> {
  const existing = parseSavedInquiryRoutes(await storage.get(INQUIRY_ROUTE_STORAGE_KEY));
  const next = [...existing, route];
  await storage.set(INQUIRY_ROUTE_STORAGE_KEY, next);
  return next.length;
}

export function chromeInquiryRouteStorage(): InquiryRouteStorage {
  return {
    async get(key: string): Promise<unknown> {
      const result = await chrome.storage.local.get(key);
      return result[key];
    },
    async set(key: string, value: SavedInquiryRoute[]): Promise<void> {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}
