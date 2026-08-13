/**
 * Demo panel additions — only active in demo builds.
 *
 * Two LOCAL transports coexist deliberately:
 * - legacy demo orchestrator at 127.0.0.1:4317 (manual Send + separate Admit);
 * - ACQ1 exact-byte acquisition at 127.0.0.1:8787, triggered only after the
 *   existing explicit "Capture this source" gesture and using that SAME BPC.
 *
 * EXT-ACQ1 boundaries:
 * - no second CAPTURE_PAGE request / no recapture;
 * - BrowserPageCapture remains a browser observation;
 * - acquisition CaptureReceipt is displayed as an acquisition receipt only;
 * - SRS source-capture remains "not represented";
 * - admission remains "not established";
 * - ACQ1 token lives in chrome.storage.session only (browser-session memory),
 *   never in source, manifest, logs, DOM text after save, or local storage.
 */

import type { BrowserPageCapture } from "../lib/browserPageCapture";
import { captureDigest } from "../lib/captureDigest";
import {
  acquisitionEndpointFromManifest,
  acquireBrowserPageCapture,
  clearAcquisitionTransportToken,
  loadAcquisitionTransportToken,
  saveAcquisitionTransportToken,
  type CaptureUrlResult,
  type SessionStorageLike,
} from "../lib/acquisitionTransport";
import {
  DEMO_ENDPOINT,
  sendCaptureToDemo,
  fetchDemoSession,
  admitWithDemo,
  type DemoSessionSummary,
} from "../lib/demoTransport";

// The sessionId returned by POST /capture. Used to build the D2-D reader link
// (/demo/session/<sessionId>) after admission.
let currentSessionId: string | null = null;

// ---------------------------------------------------------------------------
// Demo mode detection
// ---------------------------------------------------------------------------

function manifestRecord(): Record<string, unknown> {
  return chrome.runtime.getManifest() as unknown as Record<string, unknown>;
}

function isDemoMode(): boolean {
  try {
    return manifestRecord()["_demo_mode"] === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// EXT-ACQ1 local acquisition controller
// ---------------------------------------------------------------------------

type LocalAcquisitionPosture =
  | "not_configured"
  | "ready"
  | "pending"
  | "capture_receipt_available"
  | "capture_failed"
  | "transport_error";

interface LocalAcquisitionController {
  capture(capture: BrowserPageCapture): Promise<void>;
}

function sessionStorageAdapter(): SessionStorageLike {
  return {
    get: async (key: string) =>
      (await chrome.storage.session.get(key)) as Record<string, unknown>,
    set: async (items: Record<string, unknown>) => {
      await chrome.storage.session.set(items);
    },
    remove: async (key: string) => {
      await chrome.storage.session.remove(key);
    },
  };
}

function acquisitionStatusCopy(
  posture: LocalAcquisitionPosture,
  result: CaptureUrlResult | null,
): string {
  switch (posture) {
    case "not_configured":
      return "Acquisition capture receipt: local token not configured";
    case "ready":
      return "Acquisition capture receipt: ready after explicit capture";
    case "pending":
      return "Acquisition capture receipt: acquiring exact HTTP bytes…";
    case "capture_receipt_available":
      return "Acquisition capture receipt: available";
    case "capture_failed":
      return result?.capture_status === "capture_failed"
        ? "Acquisition capture receipt: capture failed — no receipt minted"
        : "Acquisition capture receipt: capture failed";
    case "transport_error":
      return "Acquisition capture receipt: local transport unavailable";
  }
}

function renderAcquisitionState(
  posture: LocalAcquisitionPosture,
  result: CaptureUrlResult | null = null,
): void {
  const status = document.getElementById("sw-acquisition-status");
  if (status) {
    status.dataset["posture"] = posture;
    status.textContent = acquisitionStatusCopy(posture, result);
  }

  const digest = document.getElementById("sw-acquisition-digest");
  const source = document.getElementById("sw-acquisition-source");
  const captured = result?.capture_status === "captured" ? result : null;

  if (digest) {
    if (captured) {
      digest.textContent = `exact bytes: ${captured.captured_object_address}`;
      digest.style.display = "";
    } else {
      digest.textContent = "";
      digest.style.display = "none";
    }
  }

  if (source) {
    if (result) {
      source.textContent = `source locator: ${result.source_locator}`;
      source.style.display = "";
    } else {
      source.textContent = "";
      source.style.display = "none";
    }
  }
}

function initLocalAcquisition(
  captureStore: { latest: BrowserPageCapture | null },
): LocalAcquisitionController | null {
  const endpoint = acquisitionEndpointFromManifest(manifestRecord());
  if (!endpoint) return null;

  const section = document.getElementById("sw-acquisition");
  if (!section) return null;
  section.style.display = "";

  const storage = sessionStorageAdapter();
  const input = document.getElementById("sw-acquisition-token") as HTMLInputElement | null;
  const saveBtn = document.getElementById("sw-acquisition-token-save") as HTMLButtonElement | null;
  const clearBtn = document.getElementById("sw-acquisition-token-clear") as HTMLButtonElement | null;
  const configStatus = document.getElementById("sw-acquisition-config-status");

  // Monotonic generation: a late response from an older capture can never
  // overwrite a newer page/capture state.
  let generation = 0;

  const renderConfiguredState = async (expectedGeneration: number): Promise<void> => {
    try {
      const token = await loadAcquisitionTransportToken(storage);
      if (expectedGeneration !== generation) return;
      renderAcquisitionState(token ? "ready" : "not_configured");
    } catch {
      if (expectedGeneration !== generation) return;
      renderAcquisitionState("transport_error");
    }
  };

  const controller: LocalAcquisitionController = {
    async capture(capture: BrowserPageCapture): Promise<void> {
      const myGeneration = ++generation;
      const token = await loadAcquisitionTransportToken(storage);
      if (myGeneration !== generation) return;
      if (!token) {
        renderAcquisitionState("not_configured");
        return;
      }

      renderAcquisitionState("pending");
      try {
        const result = await acquireBrowserPageCapture(capture, token, { endpoint });
        if (myGeneration !== generation) return;
        renderAcquisitionState(
          result.capture_status === "captured"
            ? "capture_receipt_available"
            : "capture_failed",
          result,
        );
      } catch {
        if (myGeneration !== generation) return;
        // Error details are intentionally not surfaced here. The browser
        // observation remains intact; no source-work/SRS/admission state moves.
        renderAcquisitionState("transport_error");
      }
    },
  };

  const initialGeneration = generation;
  void renderConfiguredState(initialGeneration);

  // A navigation/CLEAR invalidates any in-flight acquisition even if the user
  // does not capture the new page. Without this, a slow result from page A could
  // arrive after panel.ts moved the Source Workbench to page B. The old BPC is
  // cleared from the shared demo store at the same boundary.
  chrome.runtime.onMessage.addListener((rawMessage) => {
    if (typeof rawMessage !== "object" || rawMessage === null) return;
    const type = (rawMessage as { type?: unknown }).type;
    if (type !== "TAB_CHANGED" && type !== "CLEAR") return;
    const myGeneration = ++generation;
    captureStore.latest = null;
    if (configStatus) configStatus.textContent = "";
    void renderConfiguredState(myGeneration);
  });

  saveBtn?.addEventListener("click", async () => {
    const token = input?.value ?? "";
    try {
      await saveAcquisitionTransportToken(storage, token);
      if (input) input.value = ""; // never leave the token in DOM after save.
      if (configStatus) configStatus.textContent = "Local token set for this browser session.";
      renderAcquisitionState("ready");
      if (captureStore.latest) {
        // Reuse the exact already-captured BPC; never issue a second CAPTURE_PAGE.
        void controller.capture(captureStore.latest);
      }
    } catch {
      if (configStatus) configStatus.textContent = "Token must be non-empty.";
    }
  });

  clearBtn?.addEventListener("click", async () => {
    ++generation; // invalidate any in-flight response before clearing config.
    await clearAcquisitionTransportToken(storage);
    if (input) input.value = "";
    if (configStatus) configStatus.textContent = "Local token cleared.";
    renderAcquisitionState("not_configured");
  });

  return controller;
}

// ---------------------------------------------------------------------------
// DOM injection for legacy 4317 demo orchestrator
// ---------------------------------------------------------------------------

function injectDemoSection(): HTMLElement | null {
  const existing = document.getElementById("demo-section");
  if (existing) return existing;

  const section = document.createElement("section");
  section.id = "demo-section";
  section.className = "demo-section";
  section.setAttribute("aria-label", "Demo: Send to local Counterpedia demo");
  section.style.display = "none"; // hidden until demo mode confirmed

  section.innerHTML = `
    <div class="demo-capture-info" id="demo-capture-info" style="display:none">
      <div class="demo-capture-label" id="demo-capture-label"></div>
      <div class="demo-capture-digest" id="demo-capture-digest"></div>
      <div class="demo-observation-warning">&#9888; Browser observation — not HTTP evidence</div>
      <button id="demo-send-btn" class="demo-send-btn" type="button">Send to local Counterpedia demo</button>
      <span id="demo-send-status" class="demo-send-status" aria-live="polite"></span>
    </div>

    <div class="demo-session-info" id="demo-session-info" style="display:none">
      <div id="demo-session-status-line"></div>
      <div id="demo-http-capture-line" style="display:none"></div>
      <div id="demo-http-digest-line" style="display:none"></div>
      <div id="demo-proposal-line" style="display:none"></div>
    </div>

    <div class="demo-proposal-ready" id="demo-proposal-ready" style="display:none">
      <div class="demo-proposed-badge" id="demo-proposed-badge">PROPOSED &#8212; NOT PUBLISHED</div>
      <div id="demo-proposal-fields" class="demo-proposal-fields"></div>
      <button id="demo-admit-btn" class="demo-admit-btn" type="button">ADMIT</button>
      <div class="demo-admit-warning">&#9888; Requires confirmation</div>
    </div>

    <div class="demo-admitted" id="demo-admitted" style="display:none">
      <div class="demo-admitted-badge">ADMITTED</div>
      <div id="demo-admitted-digest"></div>
      <div id="demo-admitted-link" class="demo-admitted-link"></div>
    </div>
  `;

  // Append after the capture-bar section
  const captureBar = document.querySelector(".capture-bar");
  if (captureBar && captureBar.parentNode) {
    captureBar.parentNode.insertBefore(section, captureBar.nextSibling);
  } else {
    document.body.appendChild(section);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Legacy 4317 state rendering
// ---------------------------------------------------------------------------

function showDemoCapture(capture: BrowserPageCapture, digest: string): void {
  const info = document.getElementById("demo-capture-info");
  if (info) info.style.display = "";

  const label = document.getElementById("demo-capture-label");
  if (label) label.textContent = `Browser capture: ${capture.document_title || capture.current_url}`;

  const digestEl = document.getElementById("demo-capture-digest");
  if (digestEl) digestEl.textContent = `digest: ${digest}`;
}

function showSessionPolling(session: DemoSessionSummary): void {
  const info = document.getElementById("demo-session-info");
  if (info) info.style.display = "";

  const statusLine = document.getElementById("demo-session-status-line");
  if (statusLine) statusLine.textContent = `Sent to demo. Fetching HTTP evidence…`;

  if (session.httpCaptureDigest) {
    const httpCapture = document.getElementById("demo-http-capture-line");
    if (httpCapture) {
      httpCapture.style.display = "";
      httpCapture.textContent = `HTTP capture: ${session.sessionId ?? "(session)"}`;
    }
    const httpDigest = document.getElementById("demo-http-digest-line");
    if (httpDigest) {
      httpDigest.style.display = "";
      httpDigest.textContent = `HTTP digest: ${session.httpCaptureDigest}`;
    }
  }

  if (session.proposalSummary) {
    const proposalLine = document.getElementById("demo-proposal-line");
    if (proposalLine) {
      proposalLine.style.display = "";
      proposalLine.textContent = `Proposal: ${session.proposalSummary}`;
    }
  }
}

function showProposalReady(session: DemoSessionSummary): void {
  const proposalSection = document.getElementById("demo-proposal-ready");
  if (proposalSection) proposalSection.style.display = "";

  // Ensure the badge is always visible when proposalReady && !admitted
  const badge = document.getElementById("demo-proposed-badge");
  if (badge) badge.style.display = "";

  const fields = document.getElementById("demo-proposal-fields");
  if (fields) {
    const parts: string[] = [];
    if (session.proposalSummary) parts.push(`Proposal: ${session.proposalSummary}`);
    if (session.browserCaptureDigest) parts.push(`Browser digest: ${session.browserCaptureDigest}`);
    if (session.httpCaptureDigest) parts.push(`HTTP digest: ${session.httpCaptureDigest}`);
    parts.push(`Evidence complete: ${session.evidenceComplete}`);
    fields.textContent = parts.join(" | ");
  }
}

function showAdmitted(sessionId: string | null, publicationDigest: string): void {
  // Hide proposal-ready section
  const proposalSection = document.getElementById("demo-proposal-ready");
  if (proposalSection) proposalSection.style.display = "none";

  // Show admitted section
  const admittedSection = document.getElementById("demo-admitted");
  if (admittedSection) admittedSection.style.display = "";

  const digestEl = document.getElementById("demo-admitted-digest");
  if (digestEl) digestEl.textContent = `publication digest: ${publicationDigest}`;

  // Reader link points at the D2-D reader surface, /demo/session/<sessionId>.
  // D2-B defines no /publication/<digest> endpoint, so we never link to one.
  const linkEl = document.getElementById("demo-admitted-link");
  if (linkEl) {
    if (sessionId) {
      linkEl.textContent = `Open Counterpedia demo reader: ${DEMO_ENDPOINT}/demo/session/${sessionId}`;
    } else {
      linkEl.textContent = "Admitted. Reader link unavailable (no session id).";
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy 4317 polling
// ---------------------------------------------------------------------------

let pollingHandle: ReturnType<typeof setTimeout> | null = null;

function stopPolling(): void {
  if (pollingHandle !== null) {
    clearTimeout(pollingHandle);
    pollingHandle = null;
  }
}

function startPolling(onProposalReady: (session: DemoSessionSummary) => void): void {
  stopPolling();

  const poll = async (): Promise<void> => {
    const result = await fetchDemoSession();
    if (!result.ok || !result.data) {
      // Keep polling — orchestrator may still be fetching HTTP evidence
      pollingHandle = setTimeout(() => void poll(), 2000);
      return;
    }

    const session = result.data;
    if (session.sessionId) currentSessionId = session.sessionId;
    showSessionPolling(session);

    if (session.admitted) {
      stopPolling();
      showAdmitted(currentSessionId, session.publicationDigest ?? "(unknown)");
      return;
    }

    if (session.proposalReady || session.admissionEligible) {
      stopPolling();
      onProposalReady(session);
      return;
    }

    // Not yet ready — keep polling
    pollingHandle = setTimeout(() => void poll(), 2000);
  };

  pollingHandle = setTimeout(() => void poll(), 1000);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function initDemoPanel(captureStore: { latest: BrowserPageCapture | null }): void {
  if (!isDemoMode()) return;

  const section = injectDemoSection();
  if (!section) return;

  section.style.display = "";
  const localAcquisition = initLocalAcquisition(captureStore);

  // Compute and show capture info whenever the capture store has a value.
  // The caller is responsible for keeping captureStore.latest up to date.
  const refreshCaptureInfo = async (): Promise<void> => {
    const capture = captureStore.latest;
    if (!capture) return;

    const captureInfo = document.getElementById("demo-capture-info");
    if (!captureInfo) return;

    // Digest over the EXACT reused CAP1 capture object — never a rebuilt copy.
    const digest = await captureDigest(capture);
    showDemoCapture(capture, digest);

    // EXT-ACQ1: same explicit BPC, no recapture. Do not block the capture button
    // while the real HTTP acquisition fetch runs; visible state moves to pending.
    if (localAcquisition) void localAcquisition.capture(capture);
  };

  // Expose a method so panel.ts can call it after the ONE explicit capture.
  (section as HTMLElement & { refreshCaptureInfo?: () => Promise<void> }).refreshCaptureInfo =
    refreshCaptureInfo;

  // Legacy 4317 Send button — stays a separate explicit action.
  const sendBtn = document.getElementById("demo-send-btn") as HTMLButtonElement | null;
  const sendStatus = document.getElementById("demo-send-status");

  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const capture = captureStore.latest;
      if (!capture) {
        if (sendStatus) {
          sendStatus.textContent = "No capture available. Click 'Capture this page' first.";
        }
        return;
      }

      sendBtn.disabled = true;
      if (sendStatus) sendStatus.textContent = "Sending to demo orchestrator…";

      const result = await sendCaptureToDemo(capture);

      if (!result.ok) {
        if (sendStatus) {
          sendStatus.textContent = `Error: ${result.error ?? "Unknown error"}`;
          sendStatus.className = "demo-send-status error";
        }
        sendBtn.disabled = false;
        return;
      }

      // Carry the sessionId from POST /capture for the D2-D reader link.
      currentSessionId = result.data?.sessionId ?? null;

      if (sendStatus) sendStatus.textContent = "Sent. Waiting for HTTP evidence…";

      // Show session info section
      const sessionInfo = document.getElementById("demo-session-info");
      if (sessionInfo) sessionInfo.style.display = "";

      // Start polling for session state
      startPolling((session) => {
        showProposalReady(session);
      });
    });
  }

  // Admit button — intentionally independent of acquisition and still requires
  // a separate explicit confirmation in the legacy orchestrator demo.
  const admitBtn = document.getElementById("demo-admit-btn") as HTMLButtonElement | null;

  if (admitBtn) {
    admitBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Are you sure? This will trigger real Counterpedia admission. Click OK to confirm.",
      );
      if (!confirmed) return;

      admitBtn.disabled = true;

      const result = await admitWithDemo();

      if (!result.ok) {
        admitBtn.disabled = false;
        const fields = document.getElementById("demo-proposal-fields");
        if (fields) {
          fields.textContent += ` | Admit error: ${result.error ?? "Unknown error"}`;
        }
        return;
      }

      showAdmitted(currentSessionId, result.data?.publicationDigest ?? "(unknown)");
    });
  }
}
