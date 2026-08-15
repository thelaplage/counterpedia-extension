const LOCAL_COMPANION_BASE_URL = "http://127.0.0.1:8790";
const PAIR_PATH = "/v0/pair";
const STATUS_PATH = "/v0/status";

export interface LocalCompanionStatus {
  readonly service: "counterpedia-local";
  readonly version: "0.1";
  readonly authority_posture: "transport_supervisor_only";
  readonly admission: "not_performed";
  readonly paired: boolean;
  readonly paired_extension_id: string | null;
  readonly acquisition: {
    readonly ready: boolean;
    readonly port: 8787;
    readonly durable_store: string;
    readonly process_managed: boolean;
  };
  readonly authoring: {
    readonly ready: boolean;
    readonly port: 8788;
    readonly process_managed: boolean;
  };
  readonly dependencies: {
    readonly acquisition_dir: string;
    readonly acquisition_launcher_present: boolean;
    readonly acquisition_python_present: boolean;
    readonly acquisition_mcp_present: boolean;
    readonly authoring_dir: string;
    readonly authoring_launcher_present: boolean;
    readonly openai_key_configured: boolean;
  };
}

export interface LocalPairingResult {
  readonly pairing_schema: "counterpedia.local_pairing.v0.1";
  readonly acquisition_base_url: "http://127.0.0.1:8787";
  readonly authoring_base_url: "http://127.0.0.1:8788";
  readonly acquisition_transport_token: string;
  readonly authoring_transport_token: string;
  readonly authoring_ready: boolean;
  readonly authority_posture: "transport_configuration_only";
  readonly admission: "not_performed";
}

interface StorageAreaLike {
  set(items: Record<string, unknown>): Promise<void>;
}

interface PairingDeps {
  readonly extensionId: string;
  readonly fetchImpl?: typeof fetch;
  readonly syncStorage?: StorageAreaLike;
  readonly sessionStorage?: StorageAreaLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, i) => key === wanted[i]);
}

export function parseLocalPairingResult(raw: unknown): LocalPairingResult {
  if (!isRecord(raw)) throw new Error("local pairing response must be an object");
  const expected = [
    "pairing_schema",
    "acquisition_base_url",
    "authoring_base_url",
    "acquisition_transport_token",
    "authoring_transport_token",
    "authoring_ready",
    "authority_posture",
    "admission",
  ] as const;
  if (!exactKeys(raw, expected)) {
    throw new Error("local pairing response has an unknown or missing field");
  }
  if (raw["pairing_schema"] !== "counterpedia.local_pairing.v0.1") {
    throw new Error("unknown local pairing schema");
  }
  if (raw["acquisition_base_url"] !== "http://127.0.0.1:8787") {
    throw new Error("local pairing returned an unexpected acquisition endpoint");
  }
  if (raw["authoring_base_url"] !== "http://127.0.0.1:8788") {
    throw new Error("local pairing returned an unexpected authoring endpoint");
  }
  const acquisitionToken = raw["acquisition_transport_token"];
  const authoringToken = raw["authoring_transport_token"];
  if (typeof acquisitionToken !== "string" || acquisitionToken.length < 20) {
    throw new Error("local pairing returned an invalid acquisition credential");
  }
  if (typeof authoringToken !== "string" || authoringToken.length < 1) {
    throw new Error("local pairing returned an invalid authoring credential");
  }
  if (typeof raw["authoring_ready"] !== "boolean") {
    throw new Error("local pairing returned an invalid authoring readiness state");
  }
  if (raw["authority_posture"] !== "transport_configuration_only") {
    throw new Error("local pairing response crossed the authority boundary");
  }
  if (raw["admission"] !== "not_performed") {
    throw new Error("local pairing response asserted admission");
  }
  return raw as unknown as LocalPairingResult;
}

export async function readLocalCompanionStatus(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<LocalCompanionStatus | null> {
  try {
    const response = await fetchImpl(LOCAL_COMPANION_BASE_URL + STATUS_PATH, {
      method: "GET",
    });
    if (!response.ok) return null;
    const raw = (await response.json()) as unknown;
    if (!isRecord(raw)) return null;
    if (
      raw["service"] !== "counterpedia-local" ||
      raw["version"] !== "0.1" ||
      raw["authority_posture"] !== "transport_supervisor_only" ||
      raw["admission"] !== "not_performed"
    ) {
      return null;
    }
    return raw as unknown as LocalCompanionStatus;
  } catch {
    return null;
  }
}

export async function pairLocalCompanion(deps: PairingDeps): Promise<LocalPairingResult> {
  if (!/^[a-p]{32}$/.test(deps.extensionId)) {
    throw new Error("invalid Chrome extension id");
  }
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(LOCAL_COMPANION_BASE_URL + PAIR_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extension_id: deps.extensionId }),
  });
  if (!response.ok) {
    throw new Error(`Counterpedia Local pairing failed (HTTP ${response.status})`);
  }
  const pairing = parseLocalPairingResult((await response.json()) as unknown);

  const syncStorage = deps.syncStorage ?? chrome.storage.sync;
  const sessionStorage = deps.sessionStorage ?? chrome.storage.session;

  // Non-secret endpoint configuration may survive browser restarts.
  await syncStorage.set({
    counterpedia_acquisition_base_url: pairing.acquisition_base_url,
    counterpedia_authoring_base_url: pairing.authoring_base_url,
    counterpedia_authoring_token: pairing.authoring_transport_token,
  });

  // Acquisition credential is deliberately session-only: transport auth, never
  // authority, never synced, never persisted into governed corpus artifacts.
  await sessionStorage.set({
    counterpedia_acquisition_token: pairing.acquisition_transport_token,
  });

  return pairing;
}

export { LOCAL_COMPANION_BASE_URL };
