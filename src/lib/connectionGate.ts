/**
 * Shared "is Counterpedia Local connected" gate for panel widgets that call
 * paired-only Counterpedia Local companion routes (operator snapshot ingest,
 * Wikipedia reference harvest, Wikipedia frontier capture).
 *
 * Reuses the SAME signal the rest of the panel already relies on
 * (`readAcquisitionConfig()` -- populated only by a successful
 * `pairLocalCompanion()` call, see localCompanionClient.ts): a configured
 * base URL (chrome.storage.sync) plus a session transport token
 * (chrome.storage.session). This introduces no new pairing/auth semantics --
 * it only lets a widget avoid firing a paired-only request (and rendering
 * the resulting 403 as a scary failure) before that same signal is present.
 */
import { readAcquisitionConfig, type AcquisitionConfig } from "./acquisitionClient";

/** Neutral, non-alarming status text shown by gated widgets before Connect. */
export const CONNECT_FIRST_MESSAGE = "Connect Counterpedia Local first.";

/** Pure: does this (already-read) acquisition config represent a connected state? */
export function isConnected(config: AcquisitionConfig | null): boolean {
  return config !== null;
}

/** Reads the current config and applies the pure predicate above. */
export async function checkLocalCompanionConnected(): Promise<boolean> {
  return isConnected(await readAcquisitionConfig());
}
