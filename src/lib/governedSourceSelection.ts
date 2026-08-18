/**
 * Governed-source selection shared by explicit capture surfaces.
 *
 * Selection is NOT an authoring action. It lets one already-guarded,
 * successfully captured producer result become the current source offered to
 * the existing Draft-from-source button. The explicit selection may also be
 * persisted as LOCAL_ONLY resumable work so a panel/window/browser restart does
 * not make a durable backend capture look lost.
 */

import {
  parseAcquisitionCaptureResult,
  type AcquisitionCaptureResult,
} from "./acquisitionResponseGuard";

export const GOVERNED_SOURCE_SELECTION_KEY =
  "counterpedia_governed_source_selection_v0_1";
export const GOVERNED_SOURCE_SELECTION_SCHEMA =
  "counterpedia.governed_source_selection.v0.1" as const;

export class GovernedSourceSelectionError extends Error {
  constructor(reason: string) {
    super(`governed source selection rejected: ${reason}`);
    this.name = "GovernedSourceSelectionError";
  }
}

export type GovernedSourceSelectionListener = (
  source: AcquisitionCaptureResult | null,
) => void;

export interface GovernedSourceSelectionStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PersistedGovernedSourceSelectionV01 {
  readonly schema_version: typeof GOVERNED_SOURCE_SELECTION_SCHEMA;
  readonly selected_at: string;
  readonly source: AcquisitionCaptureResult;
  readonly retention: "LOCAL_ONLY";
  readonly authority_posture: "selection_only";
}

let selected: AcquisitionCaptureResult | null = null;
const listeners = new Set<GovernedSourceSelectionListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GovernedSourceSelectionError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !value.endsWith("Z") ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new GovernedSourceSelectionError(`${field} must be an ISO UTC timestamp`);
  }
  return value;
}

/**
 * Assert that a producer result is eligible to be selected for historical
 * draft-from-source processing. This deliberately pins the existing producer
 * projection rather than creating a new source/capture contract.
 */
export function assertSelectableGovernedSource(
  result: AcquisitionCaptureResult,
): AcquisitionCaptureResult {
  if (result.tool !== "acquisition.capture_url") {
    throw new GovernedSourceSelectionError("tool must be acquisition.capture_url");
  }
  if (result.surface_schema !== "acquisition.mcp_surface.v0.1") {
    throw new GovernedSourceSelectionError(
      "surface_schema must be acquisition.mcp_surface.v0.1",
    );
  }
  if (result.capture_status !== "captured") {
    throw new GovernedSourceSelectionError("only captured results are selectable");
  }

  const captureId = requireNonEmptyString(result.capture_id, "capture_id");
  const sourceLocator = requireNonEmptyString(result.source_locator, "source_locator");
  requireNonEmptyString(result.captured_object_address, "captured_object_address");

  if (!result.capture_receipt) {
    throw new GovernedSourceSelectionError("captured result must carry capture_receipt");
  }

  const receiptCaptureId = result.capture_receipt["capture_id"];
  if (receiptCaptureId !== captureId) {
    throw new GovernedSourceSelectionError(
      "capture_receipt.capture_id must match capture_id",
    );
  }
  const receiptLocator = result.capture_receipt["source_locator"];
  if (receiptLocator !== sourceLocator) {
    throw new GovernedSourceSelectionError(
      "capture_receipt.source_locator must match source_locator",
    );
  }

  return result;
}

function publish(): void {
  for (const listener of listeners) listener(selected);
}

/**
 * Explicitly select one real captured source for the existing authoring UI.
 * Selection alone performs no draft and no producer call.
 */
export function selectGovernedSource(
  result: AcquisitionCaptureResult,
): AcquisitionCaptureResult {
  selected = assertSelectableGovernedSource(result);
  publish();
  return selected;
}

export function getSelectedGovernedSource(): AcquisitionCaptureResult | null {
  return selected;
}

export function clearGovernedSourceSelection(): void {
  selected = null;
  publish();
}

export function parsePersistedGovernedSourceSelection(
  raw: unknown,
): PersistedGovernedSourceSelectionV01 {
  if (!isRecord(raw)) {
    throw new GovernedSourceSelectionError("persisted selection must be an object");
  }
  if (
    !exactKeys(raw, [
      "schema_version",
      "selected_at",
      "source",
      "retention",
      "authority_posture",
    ])
  ) {
    throw new GovernedSourceSelectionError(
      "persisted selection has unknown or missing fields",
    );
  }
  if (raw.schema_version !== GOVERNED_SOURCE_SELECTION_SCHEMA) {
    throw new GovernedSourceSelectionError("persisted selection schema mismatch");
  }
  if (raw.retention !== "LOCAL_ONLY") {
    throw new GovernedSourceSelectionError("persisted selection retention mismatch");
  }
  if (raw.authority_posture !== "selection_only") {
    throw new GovernedSourceSelectionError("persisted selection authority posture mismatch");
  }

  const source = assertSelectableGovernedSource(
    parseAcquisitionCaptureResult(raw.source),
  );
  return {
    schema_version: GOVERNED_SOURCE_SELECTION_SCHEMA,
    selected_at: requireIsoTimestamp(raw.selected_at, "selected_at"),
    source,
    retention: "LOCAL_ONLY",
    authority_posture: "selection_only",
  };
}

/** Persist only a previously validated producer projection; this performs no authoring I/O. */
export async function persistGovernedSourceSelection(
  storage: GovernedSourceSelectionStorage,
  result: AcquisitionCaptureResult,
  options: { readonly now?: () => string } = {},
): Promise<PersistedGovernedSourceSelectionV01> {
  const source = assertSelectableGovernedSource(result);
  const record = parsePersistedGovernedSourceSelection({
    schema_version: GOVERNED_SOURCE_SELECTION_SCHEMA,
    selected_at: (options.now ?? (() => new Date().toISOString()))(),
    source,
    retention: "LOCAL_ONLY",
    authority_posture: "selection_only",
  });
  await storage.set({ [GOVERNED_SOURCE_SELECTION_KEY]: record });
  return record;
}

/**
 * Revalidate and restore a LOCAL_ONLY selection after panel/window/browser
 * lifecycle loss. Restore is inert: it publishes readiness only and never
 * invokes authoring or acquisition.
 */
export async function restoreGovernedSourceSelection(
  storage: GovernedSourceSelectionStorage,
): Promise<AcquisitionCaptureResult | null> {
  const raw = (await storage.get(GOVERNED_SOURCE_SELECTION_KEY))[
    GOVERNED_SOURCE_SELECTION_KEY
  ];
  if (raw === undefined) return null;
  const record = parsePersistedGovernedSourceSelection(raw);
  return selectGovernedSource(record.source);
}

export async function clearPersistedGovernedSourceSelection(
  storage: GovernedSourceSelectionStorage,
): Promise<void> {
  await storage.remove(GOVERNED_SOURCE_SELECTION_KEY);
  clearGovernedSourceSelection();
}

/** Subscribe to future selection changes. No callback is fired on subscribe. */
export function subscribeGovernedSourceSelection(
  listener: GovernedSourceSelectionListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
