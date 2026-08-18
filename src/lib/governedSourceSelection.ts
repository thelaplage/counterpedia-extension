/**
 * Ephemeral governed-source selection shared by explicit capture surfaces.
 *
 * This is NOT a persistence layer and NOT an authoring action. It only lets one
 * already-guarded, successfully captured producer result become the current
 * source offered to the existing Draft-from-source button. Selecting a source
 * performs zero network I/O and mints no proposal, admission, standing, or
 * publication state.
 */

import type { AcquisitionCaptureResult } from "./acquisitionResponseGuard";

export class GovernedSourceSelectionError extends Error {
  constructor(reason: string) {
    super(`governed source selection rejected: ${reason}`);
    this.name = "GovernedSourceSelectionError";
  }
}

export type GovernedSourceSelectionListener = (
  source: AcquisitionCaptureResult | null,
) => void;

let selected: AcquisitionCaptureResult | null = null;
const listeners = new Set<GovernedSourceSelectionListener>();

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GovernedSourceSelectionError(`${field} must be a non-empty string`);
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

/** Subscribe to future selection changes. No callback is fired on subscribe. */
export function subscribeGovernedSourceSelection(
  listener: GovernedSourceSelectionListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
