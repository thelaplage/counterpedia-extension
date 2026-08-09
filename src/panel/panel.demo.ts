/**
 * Demo panel additions — only included in demo build.
 *
 * Adds "Send to local Counterpedia demo" flow after a successful capture.
 *
 * Privacy invariants:
 * - No passive capture; all sends require explicit user gesture.
 * - Only active when chrome.runtime.getManifest()._demo_mode === true.
 * - Network calls restricted to 127.0.0.1:4317 via demoTransport guards.
 * - "Send" and "ADMIT" are separate, independent explicit clicks.
 * - "PROPOSED — NOT PUBLISHED" badge is visible before any admission.
 */

import type { BrowserPageCapture } from "../lib/browserPageCapture";
import {
  sendCaptureToDemo,
  fetchDemoSession,
  admitWithDemo,
  type DemoSessionSummary,
} from "../lib/demoTransport";

// ---------------------------------------------------------------------------
// Demo mode detection
// ---------------------------------------------------------------------------

function isDemoMode(): boolean {
  try {
    const mf = chrome.runtime.getManifest() as Record<string, unknown>;
    return mf["_demo_mode"] === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SHA-256 digest helper (Web Crypto, available in extension contexts)
// ---------------------------------------------------------------------------

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// DOM injection
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
// State rendering
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

  if (session.proposalId) {
    const proposalLine = document.getElementById("demo-proposal-line");
    if (proposalLine) {
      proposalLine.style.display = "";
      proposalLine.textContent = `Proposal: ${session.proposalId}`;
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
    if (session.proposalId) parts.push(`Proposal ID: ${session.proposalId}`);
    if (session.browserCaptureDigest) parts.push(`Browser digest: ${session.browserCaptureDigest}`);
    if (session.httpCaptureDigest) parts.push(`HTTP digest: ${session.httpCaptureDigest}`);
    parts.push(`Evidence complete: ${session.evidenceComplete}`);
    fields.textContent = parts.join(" | ");
  }
}

function showAdmitted(publicationDigest: string): void {
  // Hide proposal-ready section
  const proposalSection = document.getElementById("demo-proposal-ready");
  if (proposalSection) proposalSection.style.display = "none";

  // Show admitted section
  const admittedSection = document.getElementById("demo-admitted");
  if (admittedSection) admittedSection.style.display = "";

  const digestEl = document.getElementById("demo-admitted-digest");
  if (digestEl) digestEl.textContent = `publication digest: ${publicationDigest}`;

  const linkEl = document.getElementById("demo-admitted-link");
  if (linkEl) {
    linkEl.textContent = `Open Counterpedia demo page: http://127.0.0.1:4317/publication/${publicationDigest}`;
  }
}

// ---------------------------------------------------------------------------
// Polling
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
    showSessionPolling(session);

    if (session.admitted) {
      stopPolling();
      showAdmitted(session.publicationDigest ?? "(unknown)");
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

  // Compute and show capture info whenever the capture store has a value.
  // We watch for changes by hooking into the send button click, not passively.
  // The caller is responsible for keeping captureStore.latest up to date.

  // Show capture info if already captured
  const refreshCaptureInfo = async (): Promise<void> => {
    const capture = captureStore.latest;
    if (!capture) return;

    const captureInfo = document.getElementById("demo-capture-info");
    if (!captureInfo) return;

    const digest = await sha256Hex(JSON.stringify(capture));
    showDemoCapture(capture, digest);
  };

  // Expose a method so panel.ts can call it after capture
  (section as HTMLElement & { refreshCaptureInfo?: () => Promise<void> }).refreshCaptureInfo =
    refreshCaptureInfo;

  // Send button
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

  // Admit button
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

      showAdmitted(result.data?.publicationDigest ?? "(unknown)");
    });
  }
}
