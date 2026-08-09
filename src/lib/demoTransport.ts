/**
 * Demo transport — local-only connection to the Counterpedia demo orchestrator.
 *
 * Privacy invariants:
 * - Only ever connects to 127.0.0.1:4317 (loopback).
 * - All sends require an explicit user gesture (enforced in the UI layer).
 * - isLoopbackEndpoint() is asserted at every network call site.
 * - No passive capture, no cookies, no history, no telemetry.
 */

import type { BrowserPageCapture } from "./browserPageCapture";

export const DEMO_ENDPOINT = "http://127.0.0.1:4317";
export const DEMO_LOOPBACK_HOST = "127.0.0.1";
export const DEMO_PORT = 4317;

export type DemoTransportState =
  | "unavailable"    // demo endpoint not reachable or not in demo build
  | "ready"          // endpoint reachable, waiting for capture
  | "capture_sent"   // BrowserPageCapture sent, waiting for HTTP fetch + proposal
  | "proposal_ready" // session has PROPOSAL_READY or ADMISSION_ELIGIBLE state
  | "admitted"       // session has ADMITTED or beyond
  | "error";         // non-recoverable error

/**
 * GET /session response — frozen to the D2-B contract, exact field names:
 *   { state, browserCaptureDigest, httpCaptureDigest, proposalSummary,
 *     proposalReady, admissionEligible, admitted, publicationDigest,
 *     evidenceComplete, sessionId }
 * No `sessionState` / `proposalId` aliases — D2-B does not emit those.
 */
export interface DemoSessionSummary {
  readonly state: string;
  readonly browserCaptureDigest?: string;
  readonly httpCaptureDigest?: string;
  readonly proposalSummary?: string;
  readonly proposalReady: boolean;
  readonly admissionEligible: boolean;
  readonly admitted: boolean;
  readonly publicationDigest?: string;
  readonly evidenceComplete: boolean;
  readonly sessionId?: string;
}

export interface DemoTransportResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Guard: refuse any non-loopback endpoint
// ---------------------------------------------------------------------------

export function isLoopbackEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Network calls — all guarded by isLoopbackEndpoint
// ---------------------------------------------------------------------------

/**
 * POST the BrowserPageCapture to the demo orchestrator's /capture endpoint.
 * Never sends to any non-loopback host.
 *
 * Response is frozen to the D2-B contract: { sessionId, browserCaptureDigest }.
 */
export async function sendCaptureToDemo(
  capture: BrowserPageCapture,
): Promise<DemoTransportResult<{ sessionId: string; browserCaptureDigest: string }>> {
  if (!isLoopbackEndpoint(DEMO_ENDPOINT)) {
    return { ok: false, error: "Safety guard: DEMO_ENDPOINT is not a loopback address" };
  }

  try {
    const response = await fetch(`${DEMO_ENDPOINT}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(capture),
    });

    if (!response.ok) {
      return { ok: false, error: `Demo orchestrator returned HTTP ${response.status}` };
    }

    const data = (await response.json()) as { sessionId: string; browserCaptureDigest: string };
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      error: "Demo orchestrator not running at 127.0.0.1:4317",
    };
  }
}

/**
 * GET the current session state from the demo orchestrator.
 */
export async function fetchDemoSession(): Promise<DemoTransportResult<DemoSessionSummary>> {
  if (!isLoopbackEndpoint(DEMO_ENDPOINT)) {
    return { ok: false, error: "Safety guard: DEMO_ENDPOINT is not a loopback address" };
  }

  try {
    const response = await fetch(`${DEMO_ENDPOINT}/session`, {
      method: "GET",
    });

    if (!response.ok) {
      return { ok: false, error: `Demo orchestrator returned HTTP ${response.status}` };
    }

    const data = (await response.json()) as DemoSessionSummary;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      error: "Demo orchestrator not running at 127.0.0.1:4317",
    };
  }
}

/**
 * POST to /admit to trigger Counterpedia admission.
 * Requires a separate explicit user click — never called automatically.
 */
export async function admitWithDemo(): Promise<DemoTransportResult<{ publicationDigest: string }>> {
  if (!isLoopbackEndpoint(DEMO_ENDPOINT)) {
    return { ok: false, error: "Safety guard: DEMO_ENDPOINT is not a loopback address" };
  }

  try {
    const response = await fetch(`${DEMO_ENDPOINT}/admit`, {
      method: "POST",
      body: "",
    });

    if (!response.ok) {
      return { ok: false, error: `Demo orchestrator returned HTTP ${response.status}` };
    }

    const data = (await response.json()) as { publicationDigest: string };
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      error: "Demo orchestrator not running at 127.0.0.1:4317",
    };
  }
}
