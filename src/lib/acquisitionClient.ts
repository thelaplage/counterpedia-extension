/**
 * ACQ1-HTTP acquisition client.
 *
 * A thin client that submits an existing `BrowserPageCapture` to the localhost
 * acquisition producer over the constrained HTTP transport and returns a guarded,
 * UNADMITTED result. It owns HTTP concerns only: it introduces the
 * `{ "browser_page_capture": <BPC> }` envelope, attaches the transport token, and
 * runs the response through the fail-closed guard. It invents NO acquisition
 * semantics and confers no admission/standing/publication authority.
 *
 * Client selection is honest: with a configured base URL + token you get the HTTP
 * client; otherwise you get the `notConfigured` client, which NEVER fabricates a
 * successful acquisition.
 */

import type { BrowserPageCapture } from "./browserPageCapture";
import {
  parseAcquisitionCaptureResult,
  AcquisitionResponseError,
  type AcquisitionCaptureResult,
} from "./acquisitionResponseGuard";

/** Header carrying the local transport token (transport auth only). */
export const TRANSPORT_TOKEN_HEADER = "X-Counterpedia-Transport-Token";
/** The single POST path on the acquisition transport. */
export const OBSERVATION_PATH = "/v0/browser-observation";

export interface AcquisitionConfig {
  /** e.g. "http://127.0.0.1:8787" — loopback only in v0.1. */
  baseUrl: string;
  /** Per-run local transport token. Transport authentication ONLY. */
  token: string;
}

/**
 * Result of an acquisition attempt. `not_configured` and `transport_error` never
 * carry capture facts; `captured`/`capture_failed` carry the guarded producer
 * projection and are both terminally UNADMITTED.
 */
export type AcquisitionClientResult =
  | { kind: "not_configured" }
  | { kind: "captured"; result: AcquisitionCaptureResult }
  | { kind: "capture_failed"; result: AcquisitionCaptureResult }
  | { kind: "transport_error"; status: number | null; detail: string };

export interface AcquisitionClient {
  readonly kind: "http" | "not_configured";
  capture(capture: BrowserPageCapture): Promise<AcquisitionClientResult>;
}

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface HttpAcquisitionClientOptions {
  config: AcquisitionConfig;
  /** Injectable fetch (defaults to global fetch). Used by tests + the E2E. */
  fetchImpl?: FetchLike;
  /**
   * Explicit `Origin` header for non-browser runtimes (Node tests / E2E). In the
   * real extension the browser sets Origin automatically to the extension origin,
   * so this is omitted in production.
   */
  originHeader?: string;
}

function isLoopbackHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    return u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

/** The honest "no service configured" client. Never fabricates a capture. */
export const notConfiguredAcquisitionClient: AcquisitionClient = {
  kind: "not_configured",
  async capture(): Promise<AcquisitionClientResult> {
    return { kind: "not_configured" };
  },
};

/** Build the HTTP acquisition client for a configured loopback endpoint. */
export function createHttpAcquisitionClient(
  options: HttpAcquisitionClientOptions,
): AcquisitionClient {
  const { config, originHeader } = options;
  const fetchImpl: FetchLike =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  // Loopback-only guard, mirroring the demo transport discipline: the client
  // refuses to send a capture anywhere but a localhost endpoint.
  if (!isLoopbackHttpUrl(config.baseUrl)) {
    throw new Error(
      `acquisition baseUrl must be an http loopback URL; got ${config.baseUrl}`,
    );
  }

  const endpoint = config.baseUrl.replace(/\/+$/, "") + OBSERVATION_PATH;

  return {
    kind: "http",
    async capture(
      capture: BrowserPageCapture,
    ): Promise<AcquisitionClientResult> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        [TRANSPORT_TOKEN_HEADER]: config.token,
      };
      if (originHeader) headers["Origin"] = originHeader;

      const body = JSON.stringify({ browser_page_capture: capture });

      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body,
        });
      } catch (err) {
        return {
          kind: "transport_error",
          status: null,
          detail: err instanceof Error ? err.message : "network error",
        };
      }

      if (!response.ok) {
        // Transport-level rejection (4xx/5xx). Never a capture fact.
        return {
          kind: "transport_error",
          status: response.status,
          detail: `http ${response.status}`,
        };
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return {
          kind: "transport_error",
          status: response.status,
          detail: "non-JSON response",
        };
      }

      let result: AcquisitionCaptureResult;
      try {
        result = parseAcquisitionCaptureResult(raw);
      } catch (err) {
        if (err instanceof AcquisitionResponseError) {
          // Contaminated / unauthorized response: refuse it even from localhost.
          return {
            kind: "transport_error",
            status: response.status,
            detail: err.message,
          };
        }
        throw err;
      }

      return result.capture_status === "captured"
        ? { kind: "captured", result }
        : { kind: "capture_failed", result };
    },
  };
}

/**
 * Select the acquisition client honestly. A non-loopback or partial config
 * yields the notConfigured client — never a silent fake-acquisition fallback.
 */
export function selectAcquisitionClient(
  config: AcquisitionConfig | null | undefined,
  options?: Omit<HttpAcquisitionClientOptions, "config">,
): AcquisitionClient {
  if (
    !config ||
    !config.baseUrl ||
    !config.token ||
    !isLoopbackHttpUrl(config.baseUrl)
  ) {
    return notConfiguredAcquisitionClient;
  }
  return createHttpAcquisitionClient({ config, ...options });
}

/**
 * Read acquisition endpoint + credential without syncing the transport secret.
 *
 * The base URL is non-secret operator configuration and may live in
 * `chrome.storage.sync`. The per-run local transport token is intentionally read
 * ONLY from `chrome.storage.session`, so Chrome does not sync it across devices
 * or retain it as durable extension configuration. Missing either value yields
 * the honest not-configured state.
 */
export async function readAcquisitionConfig(): Promise<AcquisitionConfig | null> {
  try {
    const [storedConfig, storedSecret] = await Promise.all([
      chrome.storage.sync.get(["counterpedia_acquisition_base_url"]),
      chrome.storage.session.get(["counterpedia_acquisition_token"]),
    ]);
    const baseUrl = storedConfig["counterpedia_acquisition_base_url"] as
      | string
      | undefined;
    const token = storedSecret["counterpedia_acquisition_token"] as
      | string
      | undefined;
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  } catch {
    return null;
  }
}
