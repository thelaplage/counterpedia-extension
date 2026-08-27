/**
 * PITCH-RESEARCH1 — visible browser composition:
 *
 * explicit browser capture
 *   -> the SAME BrowserPageCapture object
 *   -> real ACQ1 localhost producer (:8787)
 *   -> validated exact-byte CaptureReceipt
 *   -> explicit operator-authored proposition
 *   -> existing /v0/draft-from-source (:8788)
 *   -> AuthoringAdmissionHandoff (proposal_only)
 *
 * The module is loaded only by the demo panel bundle. It does not perform a
 * second browser capture, does not infer a claim from browser prose, and never
 * upgrades acquisition or authoring output into SRS/admission/publication.
 */

import type { BrowserPageCapture } from "../lib/browserPageCapture";
import {
  ACQ1_DEFAULT_ENDPOINT,
  acquireBrowserPageCapture,
  clearAcquisitionTransportToken,
  loadAcquisitionTransportToken,
  saveAcquisitionTransportToken,
  type CaptureUrlCapturedResult,
  type CaptureUrlResult,
  type SessionStorageLike,
} from "../lib/acquisitionTransport";
import {
  AUTHORING_DEFAULT_ENDPOINT,
  authoringEndpointFromManifest,
  draftFromCapturedSource,
  isSafeAuthoringEndpoint,
  type AuthoringHandoffProjection,
} from "../lib/authoringTransport";
import { observeBrowserCaptures } from "./captureButton";

interface PitchManifest extends Record<string, unknown> {
  _demo_mode?: unknown;
  _pitch_acquisition_endpoint?: unknown;
  _authoring_endpoint?: unknown;
}

type ResearchState =
  | "not_configured"
  | "ready"
  | "acquiring"
  | "acquired"
  | "acquisition_failed"
  | "drafting"
  | "proposal_ready"
  | "authoring_failed";

function manifest(): PitchManifest {
  return chrome.runtime.getManifest() as unknown as PitchManifest;
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

function acquisitionEndpointFromPitchManifest(m: PitchManifest): string | null {
  if (m._demo_mode !== true) return null;
  const value = m._pitch_acquisition_endpoint;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return url.protocol === "http:" && loopback && !url.username && !url.password &&
      (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash
      ? value
      : null;
  } catch {
    return null;
  }
}

function text(id: string, value: string, visible = true): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.style.display = visible ? "" : "none";
}

function setDraftEnabled(enabled: boolean): void {
  const button = document.getElementById("sw-draft-source-btn") as HTMLButtonElement | null;
  if (button) button.disabled = !enabled;
}

function renderAcquisition(state: ResearchState, result: CaptureUrlResult | null): void {
  const status = document.getElementById("sw-acquisition-status");
  if (status) {
    status.dataset["posture"] = state;
    status.textContent =
      state === "not_configured" ? "Acquisition capture receipt: local token not configured" :
      state === "ready" ? "Acquisition capture receipt: ready after explicit capture" :
      state === "acquiring" ? "Acquisition capture receipt: acquiring exact HTTP bytes…" :
      state === "acquired" ? "Acquisition capture receipt: available — REAL BYTES" :
      state === "acquisition_failed" ? "Acquisition capture receipt: failed — no receipt available" :
      state === "drafting" ? "Acquisition capture receipt: available — drafting from held bytes…" :
      state === "proposal_ready" ? "Acquisition capture receipt: available — REAL BYTES" :
      "Acquisition capture receipt: available; authoring failed separately";
  }

  if (result?.capture_status === "captured") {
    text("sw-acquisition-digest", `exact bytes: ${result.captured_object_address}`);
    text("sw-acquisition-source", `source locator: ${result.source_locator}`);
    text("sw-acquisition-capture-id", `capture ref: ${result.capture_id}`);
  } else {
    text("sw-acquisition-digest", "", false);
    text("sw-acquisition-source", "", false);
    text("sw-acquisition-capture-id", "", false);
  }
}

function nestedString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function renderProposal(handoff: AuthoringHandoffProjection): void {
  const packageId = nestedString(handoff.proposal_package, "package_id");
  const packageDigest = nestedString(handoff.proposal_package, "package_digest");
  const bundleDigest = nestedString(handoff.evidence_bundle, "bundle_digest");
  const claimMapDigest = nestedString(handoff.claim_map, "claim_map_digest");
  const draftDigest = nestedString(handoff.draft_proposal, "proposal_body_digest");

  text("sw-authoring-status", "PROPOSAL ready — authority posture: PROPOSAL_ONLY");
  text("sw-authoring-handoff", `handoff: ${handoff.handoff_digest}`);
  text(
    "sw-authoring-package",
    [
      packageId ? `package ${packageId}` : null,
      packageDigest,
      bundleDigest ? `evidence ${bundleDigest}` : null,
      claimMapDigest ? `claim map ${claimMapDigest}` : null,
      draftDigest ? `draft ${draftDigest}` : null,
    ].filter((value): value is string => Boolean(value)).join(" · "),
  );
  text(
    "sw-authoring-boundary",
    "This is an AuthoringAdmissionHandoff candidate. It is not admitted, published, verified, or granted standing.",
  );
}

function clearProposal(): void {
  text("sw-authoring-status", "Draft from source: waiting for a REAL-BYTES acquisition receipt");
  text("sw-authoring-handoff", "", false);
  text("sw-authoring-package", "", false);
  text(
    "sw-authoring-boundary",
    "Operator proposition required. Browser text is never silently converted into a claim.",
  );
}

function init(): void {
  const m = manifest();
  if (m._demo_mode !== true) return;

  const acquisitionEndpoint = acquisitionEndpointFromPitchManifest(m);
  const authoringEndpoint = authoringEndpointFromManifest(m) ?? AUTHORING_DEFAULT_ENDPOINT;
  if (!acquisitionEndpoint || !isSafeAuthoringEndpoint(authoringEndpoint)) return;

  const acquisitionSection = document.getElementById("sw-acquisition");
  const authoringSection = document.getElementById("sw-authoring");
  if (!acquisitionSection || !authoringSection) return;
  acquisitionSection.style.display = "";
  authoringSection.style.display = "";

  const storage = sessionStorageAdapter();
  const tokenInput = document.getElementById("sw-acquisition-token") as HTMLInputElement | null;
  const tokenSave = document.getElementById("sw-acquisition-token-save") as HTMLButtonElement | null;
  const tokenClear = document.getElementById("sw-acquisition-token-clear") as HTMLButtonElement | null;
  const tokenStatus = document.getElementById("sw-acquisition-config-status");
  const claimInput = document.getElementById("sw-operator-claim") as HTMLTextAreaElement | null;
  const draftButton = document.getElementById("sw-draft-source-btn") as HTMLButtonElement | null;

  let generation = 0;
  let latestCapture: BrowserPageCapture | null = null;
  let latestAcquisition: CaptureUrlCapturedResult | null = null;

  const resetForPage = (): void => {
    ++generation;
    latestCapture = null;
    latestAcquisition = null;
    setDraftEnabled(false);
    clearProposal();
    void loadAcquisitionTransportToken(storage)
      .then((token) => renderAcquisition(token ? "ready" : "not_configured", null))
      .catch(() => renderAcquisition("not_configured", null));
  };

  const acquireExactBytes = async (capture: BrowserPageCapture): Promise<void> => {
    const myGeneration = ++generation;
    latestCapture = capture;
    latestAcquisition = null;
    setDraftEnabled(false);
    clearProposal();

    const token = await loadAcquisitionTransportToken(storage);
    if (myGeneration !== generation) return;
    if (!token) {
      renderAcquisition("not_configured", null);
      return;
    }

    renderAcquisition("acquiring", null);
    try {
      const result = await acquireBrowserPageCapture(capture, token, {
        endpoint: acquisitionEndpoint || ACQ1_DEFAULT_ENDPOINT,
      });
      if (myGeneration !== generation) return;
      if (result.capture_status !== "captured") {
        renderAcquisition("acquisition_failed", result);
        return;
      }
      latestAcquisition = result;
      renderAcquisition("acquired", result);
      setDraftEnabled((claimInput?.value.trim().length ?? 0) > 0);
      text("sw-authoring-status", "REAL-BYTES capture ready. Enter an operator proposition to draft from this held source.");
    } catch {
      if (myGeneration !== generation) return;
      latestAcquisition = null;
      renderAcquisition("acquisition_failed", null);
      setDraftEnabled(false);
    }
  };

  observeBrowserCaptures((capture) => {
    void acquireExactBytes(capture);
  });

  claimInput?.addEventListener("input", () => {
    setDraftEnabled(Boolean(latestAcquisition && claimInput.value.trim()));
  });

  tokenSave?.addEventListener("click", async () => {
    const token = tokenInput?.value ?? "";
    try {
      await saveAcquisitionTransportToken(storage, token);
      if (tokenInput) tokenInput.value = "";
      if (tokenStatus) tokenStatus.textContent = "Local token set for this browser session.";
      renderAcquisition("ready", null);
      if (latestCapture) void acquireExactBytes(latestCapture);
    } catch {
      if (tokenStatus) tokenStatus.textContent = "Token must be non-empty.";
    }
  });

  tokenClear?.addEventListener("click", async () => {
    ++generation;
    latestAcquisition = null;
    await clearAcquisitionTransportToken(storage);
    if (tokenInput) tokenInput.value = "";
    if (tokenStatus) tokenStatus.textContent = "Local token cleared.";
    renderAcquisition("not_configured", null);
    setDraftEnabled(false);
    clearProposal();
  });

  draftButton?.addEventListener("click", async () => {
    const acquisition = latestAcquisition;
    const capture = latestCapture;
    const operatorClaim = claimInput?.value.trim() ?? "";
    if (!acquisition || !capture || !operatorClaim) {
      text("sw-authoring-status", "Draft from source requires a current REAL-BYTES capture and an operator proposition.");
      return;
    }

    const myGeneration = ++generation;
    draftButton.disabled = true;
    renderAcquisition("drafting", acquisition);
    text("sw-authoring-status", "Drafting from retained exact source bytes…");
    try {
      const handoff = await draftFromCapturedSource(
        {
          acquisition,
          operatorClaim,
          subjectSeed: capture.document_title || new URL(acquisition.source_locator).hostname,
        },
        { endpoint: authoringEndpoint },
      );
      if (myGeneration !== generation) return;
      // The acquisition used for this handoff must still be the current one.
      if (!latestAcquisition || latestAcquisition.capture_id !== acquisition.capture_id) return;
      renderAcquisition("proposal_ready", acquisition);
      renderProposal(handoff);
    } catch {
      if (myGeneration !== generation) return;
      renderAcquisition("authoring_failed", acquisition);
      text("sw-authoring-status", "Draft from source refused or unavailable. No proposal was fabricated.");
      text("sw-authoring-handoff", "", false);
      text("sw-authoring-package", "", false);
    } finally {
      if (myGeneration === generation) {
        setDraftEnabled(Boolean(latestAcquisition && (claimInput?.value.trim().length ?? 0) > 0));
      }
    }
  });

  chrome.runtime.onMessage.addListener((rawMessage) => {
    if (typeof rawMessage !== "object" || rawMessage === null) return;
    const type = (rawMessage as { type?: unknown }).type;
    if (type === "TAB_CHANGED" || type === "CLEAR") resetForPage();
  });

  clearProposal();
  void loadAcquisitionTransportToken(storage)
    .then((token) => renderAcquisition(token ? "ready" : "not_configured", null))
    .catch(() => renderAcquisition("not_configured", null));
}

init();
