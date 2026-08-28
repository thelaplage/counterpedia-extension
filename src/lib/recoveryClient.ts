/**
 * RECOVERY-BIND0 HTTP client. Sends an existing held `capture_ref` + a freshly
 * produced `BrowserPageCapture` to the loopback `/v0/recovery-assessment` route
 * and returns a guarded result. Loopback-only, transport-token auth only. It does
 * NOT fetch source URLs, does NOT run a browser, and never manufactures baseline
 * custody — the baseline is resolved server-side from the capture_ref.
 */
import type { BrowserPageCapture } from "./browserPageCapture";
import {
  parseRecoveryAssessmentResult,
  RecoveryResponseError,
  type RecoveryAssessmentResult,
} from "./recoveryResponseGuard";

export const TRANSPORT_TOKEN_HEADER = "X-Counterpedia-Transport-Token";
export const RECOVERY_ASSESSMENT_PATH = "/v0/recovery-assessment";

export interface RecoveryConfig {
  baseUrl: string;
  /** Per-run local transport token. Transport authentication ONLY. */
  token: string;
}

export type RecoveryClientResult =
  | { kind: "assessed"; result: RecoveryAssessmentResult }
  | { kind: "not_configured" }
  | { kind: "no_capture_ref" }
  | { kind: "transport_error"; status: number | null; detail: string }
  | { kind: "invalid_response"; detail: string };

export interface RecoveryClient {
  assessRecovery(captureRef: string, bpc: BrowserPageCapture): Promise<RecoveryClientResult>;
}

export interface HttpRecoveryClientOptions {
  fetchImpl?: typeof fetch;
  originHeader?: string;
}

function isLoopbackHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:")
      && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export const notConfiguredRecoveryClient: RecoveryClient = {
  async assessRecovery() {
    return { kind: "not_configured" };
  },
};

export function createHttpRecoveryClient(
  config: RecoveryConfig,
  options: HttpRecoveryClientOptions = {},
): RecoveryClient {
  if (!isLoopbackHttpUrl(config.baseUrl)) {
    // Refuse to send a capture anywhere but a localhost endpoint.
    return notConfiguredRecoveryClient;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const originHeader = options.originHeader;
  const endpoint = config.baseUrl.replace(/\/+$/, "") + RECOVERY_ASSESSMENT_PATH;

  return {
    async assessRecovery(captureRef, bpc): Promise<RecoveryClientResult> {
      // NEVER call the recovery route without an existing held capture_ref.
      if (typeof captureRef !== "string" || captureRef.length === 0) {
        return { kind: "no_capture_ref" };
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        [TRANSPORT_TOKEN_HEADER]: config.token,
      };
      if (originHeader) headers["Origin"] = originHeader;
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ capture_ref: captureRef, browser_page_capture: bpc }),
        });
      } catch (err) {
        return { kind: "transport_error", status: null, detail: String((err as Error)?.message ?? err) };
      }
      if (!response.ok) {
        return { kind: "transport_error", status: response.status, detail: `http ${response.status}` };
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch (err) {
        return { kind: "transport_error", status: response.status, detail: "malformed json" };
      }
      try {
        return { kind: "assessed", result: parseRecoveryAssessmentResult(raw) };
      } catch (err) {
        if (err instanceof RecoveryResponseError) return { kind: "invalid_response", detail: err.message };
        throw err;
      }
    },
  };
}
