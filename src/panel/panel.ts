/**
 * Counterpedia Side Panel — UI logic
 *
 * Privacy:
 * - Only receives URL from background via message (user's active tab)
 * - Only sends normalized URL or capped selection text to search
 * - Never reads page DOM, cookies, history, or referrer
 */

import { search } from "../lib/counterpediaClient";
import { getActivityFeed } from "../lib/activityClient";
import { normalizeUrl, isRestrictedUrl } from "../lib/search";
import { validateMessage } from "../lib/messaging";
import {
  buildSourceWorkbenchPresentation,
  OBSERVATION_LABEL,
  SOURCE_WORK_LABEL,
  RECEIPT_LABEL,
  type SourceLocator,
} from "../lib/sourceWorkbench";
import type { PanelState, SearchResult } from "../types";
import type {
  ActivityFeedProjection,
  ActivityFeedLaneProjection,
  LaneEmptyReason,
} from "../lib/activityFeedModel";
import type { BrowserPageCapture } from "../lib/browserPageCapture";

const COUNTERPEDIA_BASE_URL = "https://www.garpedia.org";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentState: PanelState = { kind: "idle" };

/** Returns the current panel state. Useful for debugging. */
export function getCurrentState(): PanelState {
  return currentState;
}

// ---------------------------------------------------------------------------
// Source Workbench (EXT-BROWSER1)
//
// Source-first presentation over the active tab. Three postures are kept
// plainly separate and NEVER synthesized from the browser observation:
//   (i)   Observed in this browser (only after an EXPLICIT capture click).
//   (ii)  Counterpedia source work: available / not yet available.
//   (iii) Receipt: available / not yet available.
//
// HOLD (live transport): postures (ii) and (iii) can only advance from a valid,
// matching, same-origin authoritative resolution. No stable public transport
// for that resolution exists in this repo yet, so the live panel passes NO
// resolution — both stay "not yet available". The deep-link handoff below is
// plain navigation (a URL) and is always safe; it carries the page locator as a
// HINT only, never as identity or proof of capture. The presentation/validation
// model and its fixtures exercise the "available" path for when transport lands.
// ---------------------------------------------------------------------------

const swState: {
  locator: SourceLocator | null;
  observed: boolean;
  publicMaterial: boolean;
  visible: boolean;
} = { locator: null, observed: false, publicMaterial: false, visible: false };

function setAnchor(id: string, href: string | null, show: boolean): void {
  const el = document.getElementById(id) as HTMLAnchorElement | null;
  if (!el) return;
  if (show && href) {
    el.href = href;
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}

function renderSourceWorkbench(): void {
  const section = document.getElementById("source-workbench");
  if (!section) return;

  if (!swState.visible || !swState.locator) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  const p = buildSourceWorkbenchPresentation({
    locator: swState.locator,
    observed: swState.observed,
    publicMaterial: swState.publicMaterial,
    // resolution intentionally omitted — see HOLD note above.
  });

  const titleEl = document.getElementById("sw-title");
  if (titleEl) titleEl.textContent = p.locator.title ?? "(title available after you capture this source)";

  const urlEl = document.getElementById("sw-url") as HTMLAnchorElement | null;
  if (urlEl) {
    const shown = p.locator.canonical_url ?? p.locator.current_url;
    urlEl.textContent = shown;
    urlEl.href = shown;
  }

  // Three plainly-separate postures. data-posture drives the dot color in CSS.
  const obsRow = document.getElementById("sw-posture-observation");
  if (obsRow) obsRow.dataset["posture"] = p.observation;
  const obsLabel = document.getElementById("sw-observation-label");
  if (obsLabel) obsLabel.textContent = OBSERVATION_LABEL[p.observation];

  const swRow = document.getElementById("sw-posture-source-work");
  if (swRow) swRow.dataset["posture"] = p.source_work;
  const swLabel = document.getElementById("sw-source-work-label");
  if (swLabel) swLabel.textContent = SOURCE_WORK_LABEL[p.source_work];

  const rcRow = document.getElementById("sw-posture-receipt");
  if (rcRow) rcRow.dataset["posture"] = p.receipt;
  const rcLabel = document.getElementById("sw-receipt-label");
  if (rcLabel) rcLabel.textContent = RECEIPT_LABEL[p.receipt];

  // Sparse-corpus notice — only when no public material relates to the source.
  const noRecord = document.getElementById("sw-no-record");
  if (noRecord) {
    if (p.no_public_record_copy) {
      noRecord.textContent = p.no_public_record_copy;
      noRecord.style.display = "";
    } else {
      noRecord.style.display = "none";
    }
  }

  // BPC observation claim boundary — verbatim, always present.
  const copyEl = document.getElementById("sw-observation-copy");
  if (copyEl) copyEl.textContent = p.observation_copy;

  // Deep-link handoff (always) + direct object/receipt links only when a valid
  // authoritative resolution made them available (HELD in live → hidden).
  setAnchor("sw-open-workbench", p.deep_link_url, true);
  setAnchor("sw-open-object", p.workbench_object_url, p.source_work === "available");
  setAnchor("sw-open-receipt", p.receipt_url, p.receipt === "available");
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const STATE_IDS: Record<string, string> = {
  idle: "state-idle",
  loading: "state-loading",
  results: "state-results",
  no_match: "state-no-match",
  restricted: "state-restricted",
  unavailable: "state-unavailable",
  rate_limited: "state-rate-limited",
};

function showState(kind: PanelState["kind"]): void {
  for (const [k, id] of Object.entries(STATE_IDS)) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle("active", k === kind);
    }
  }
}

function renderResults(results: SearchResult[], query: string): void {
  const queryDisplay = document.getElementById("query-display");
  if (queryDisplay) queryDisplay.textContent = query;

  const header = document.getElementById("results-header");
  if (header) {
    header.textContent = `${results.length} record${results.length === 1 ? "" : "s"} found`;
  }

  const list = document.getElementById("results-list");
  if (!list) return;

  list.innerHTML = "";
  for (const result of results) {
    const card = document.createElement("article");
    card.className = "result-card";

    const baseUrl = "https://www.garpedia.org";
    const href = `${baseUrl}${result.record_url}`;

    card.innerHTML = `
      <a class="result-card-title" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.title)}</a>
      <div class="result-card-posture">
        <span class="posture-dot"></span>
        ${escapeHtml(result.corpus_posture_label)}
      </div>
      ${result.supported_proposition ? `<p class="result-card-proposition">${escapeHtml(result.supported_proposition)}</p>` : ""}
      ${result.top_source_labels.length > 0 ? `<div class="result-card-sources">Sources: ${escapeHtml(result.top_source_labels.join(", "))}</div>` : ""}
    `;
    list.appendChild(card);
  }
}

function setNoMatchQuery(query: string): void {
  const el = document.getElementById("no-match-query");
  if (el) el.textContent = query;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function updateBadge(count: number): void {
  chrome.runtime.sendMessage({ type: "SET_BADGE", count }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Search handler
// ---------------------------------------------------------------------------

async function runSearch(query: string): Promise<void> {
  currentState = { kind: "loading" };
  showState("loading");

  try {
    const results = await search(query);
    if (results.length > 0) {
      currentState = { kind: "results", results, query };
      showState("results");
      renderResults(results, query);
      updateBadge(results.length);
      swState.publicMaterial = true;
    } else {
      currentState = { kind: "no_match", query };
      showState("no_match");
      setNoMatchQuery(query);
      updateBadge(0);
      swState.publicMaterial = false;
    }
    renderSourceWorkbench();
  } catch (err) {
    const error = err as Error;
    if (error.name === "rate_limited" || error.message === "rate_limited") {
      currentState = { kind: "rate_limited" };
      showState("rate_limited");
    } else {
      currentState = { kind: "unavailable" };
      showState("unavailable");
    }
    updateBadge(0);
  }
}

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

async function handleTabUrl(url: string): Promise<void> {
  if (isRestrictedUrl(url)) {
    currentState = { kind: "restricted" };
    showState("restricted");
    updateBadge(0);
    // The workbench is not offered on pages Counterpedia cannot check.
    swState.visible = false;
    swState.locator = null;
    renderSourceWorkbench();
    return;
  }

  const normalized = normalizeUrl(url);
  if (!normalized) {
    currentState = { kind: "restricted" };
    showState("restricted");
    updateBadge(0);
    swState.visible = false;
    swState.locator = null;
    renderSourceWorkbench();
    return;
  }

  // New page: reset the observation (an observation is of a specific page).
  // Pre-capture we only know the URL — canonical/title arrive after an explicit
  // capture. publicMaterial is refined when the search resolves.
  swState.locator = { current_url: normalized, canonical_url: null, title: null };
  swState.observed = false;
  swState.visible = true;
  renderSourceWorkbench();

  await runSearch(normalized);
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((rawMessage, _sender, _sendResponse) => {
  const message = validateMessage(rawMessage);
  if (!message) return;

  if (message.type === "TAB_CHANGED") {
    void handleTabUrl(message.url);
  } else if (message.type === "CHECK_SELECTION") {
    // Show user what text is being sent before searching
    const queryDisplay = document.getElementById("query-display");
    if (queryDisplay) queryDisplay.textContent = message.text;
    void runSearch(message.text);
  } else if (message.type === "CLEAR") {
    currentState = { kind: "idle" };
    showState("idle");
    updateBadge(0);
  }
});

// ---------------------------------------------------------------------------
// Activity feed rendering
//
// The feed is a read-only projection over admitted PUBLIC activity receipts,
// independent of the current tab. It preserves the ACT2 invariants verbatim:
// every line names its receipt basis and links to it; NO aggregate/score is
// shown; an empty feed states which substrates and window it inspected, keeping
// inspected-empty distinct from not-inspected. No activity is synthesized — the
// real fetched index is rendered, honest-empty when it carries no receipts.
// ---------------------------------------------------------------------------

const EMPTY_REASON_LABEL: Record<LaneEmptyReason, string> = {
  no_activity_recorded: "Inspected — no activity recorded",
  not_inspected: "Not inspected",
};

function setActivityStatus(message: string): void {
  const el = document.getElementById("activity-status");
  if (el) el.textContent = message;
}

function renderActivityLane(lane: ActivityFeedLaneProjection): HTMLElement {
  const section = document.createElement("div");
  section.className = "activity-lane";

  const title = document.createElement("div");
  title.className = "activity-lane-title";
  title.textContent = lane.title;
  section.appendChild(title);

  if (lane.lines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "activity-lane-empty";
    // Absence discipline: state WHY the lane is empty, distinguishing
    // inspected-empty from not-inspected.
    const reason = lane.empty_reason ?? "not_inspected";
    empty.textContent = EMPTY_REASON_LABEL[reason];
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "activity-line-list";
  for (const line of lane.lines) {
    const item = document.createElement("li");
    item.className = "activity-line";

    const summary = document.createElement("span");
    summary.className = "activity-line-summary";
    summary.textContent = line.summary;
    item.appendChild(summary);

    const time = document.createElement("span");
    time.className = "activity-line-time";
    time.textContent = line.event_time;
    item.appendChild(time);

    // basis-descent: every line names its receipt basis and links to it.
    const basis = document.createElement("a");
    basis.className = "activity-line-basis";
    basis.href = `${COUNTERPEDIA_BASE_URL}${line.descend_ref}`;
    basis.target = "_blank";
    basis.rel = "noopener noreferrer";
    basis.textContent = `Basis: ${line.basis_receipt_id}`;
    item.appendChild(basis);

    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function renderActivityFeedView(feed: ActivityFeedProjection): void {
  // Claim boundary, stated on the surface.
  const boundary = document.getElementById("activity-boundary");
  if (boundary) boundary.textContent = feed.claim_boundary;

  // Inspection scope, so an empty feed is honest about what it looked at.
  const scope = document.getElementById("activity-scope");
  if (scope) {
    scope.textContent = `Inspected ${feed.inspection.substrates.join(", ")} over window: ${feed.inspection.window} (${feed.inspection.receipts_inspected} public receipt${feed.inspection.receipts_inspected === 1 ? "" : "s"} inspected).`;
  }

  const lanesEl = document.getElementById("activity-lanes");
  if (lanesEl) {
    lanesEl.innerHTML = "";
    for (const lane of feed.lanes) {
      lanesEl.appendChild(renderActivityLane(lane));
    }
  }

  const emptyEl = document.getElementById("activity-empty");
  if (emptyEl) {
    emptyEl.textContent = feed.is_empty
      ? "No PUBLIC activity has been recorded in the inspected substrates yet."
      : "";
  }

  // Explicit no-aggregate notice (C6 / ACT0 §3).
  const note = document.getElementById("activity-no-aggregate");
  if (note) note.textContent = feed.no_aggregate_notice;

  setActivityStatus("");
}

async function loadActivityFeed(): Promise<void> {
  setActivityStatus("Loading activity…");
  try {
    const feed = await getActivityFeed();
    renderActivityFeedView(feed);
  } catch (err) {
    const error = err as Error;
    if (error.name === "rate_limited" || error.message === "rate_limited") {
      setActivityStatus("Activity feed: too many requests. Please wait a moment.");
    } else {
      setActivityStatus("Activity feed unavailable. Please try again.");
    }
  }
}

// ---------------------------------------------------------------------------
// Init: request current tab URL on load
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      await handleTabUrl(tab.url);
    } else {
      showState("idle");
    }
  } catch {
    showState("idle");
  }
}

void init();
void loadActivityFeed();

// ---------------------------------------------------------------------------
// Demo panel — only active in demo builds (_demo_mode === true in manifest)
// ---------------------------------------------------------------------------

import { initDemoPanel } from "./panel.demo";
import { wireCaptureButton, type CaptureResponse } from "./captureButton";
import {
  selectAcquisitionClient,
  readAcquisitionConfig,
} from "../lib/acquisitionClient";
import {
  renderAcquisitionPending,
  renderAcquisitionClientResult,
  renderTransportError,
  type AcquisitionRender,
} from "../lib/acquisitionState";
import {
  selectAuthoringClient,
  readAuthoringConfig,
  type OperatorDraftMaterial,
} from "../lib/authoringClient";
import type { AcquisitionCaptureResult } from "../lib/acquisitionResponseGuard";
import {
  renderDraftUnavailable,
  renderDraftReady,
  renderDraftPending,
  renderDraftFailed,
  renderAuthoringClientResult,
  mapDraftAvailability,
  type AuthoringRender,
} from "../lib/authoringState";

/**
 * Shared capture store. Populated by the SINGLE capture flow below — the demo
 * panel reuses the exact BrowserPageCapture produced by that one request rather
 * than issuing a second one. In production builds _demo_mode is false, so
 * initDemoPanel() returns early and nothing here makes a network call.
 */
const demoCaptureStore: { latest: BrowserPageCapture | null } = { latest: null };

// ---------------------------------------------------------------------------
// Page capture — explicit user gesture only. Exactly ONE CAPTURE_PAGE request
// per click; the result is reused by the demo panel (no recapture).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ACQ1-HTTP product/ingestion lane.
//
// After an explicit capture, if a localhost acquisition service is configured,
// submit the exact BrowserPageCapture to the real producer and render its
// result. This lane is INDEPENDENT of the demo ADMITTED path and of the
// source-work/receipt postures: it only writes #acquisition-status, and a
// successful capture is terminally UNADMITTED. When unconfigured (production
// default) it stays silent. The browser sets the Origin header automatically.
// ---------------------------------------------------------------------------

function setAcquisitionStatus(render: AcquisitionRender | null): void {
  const el = document.getElementById("acquisition-status");
  if (!el) return;
  if (!render) {
    el.style.display = "none";
    el.textContent = "";
    el.dataset["state"] = "";
    return;
  }
  el.style.display = "";
  el.dataset["state"] = render.state;
  el.textContent = render.capturedObjectAddress
    ? `${render.label} — ${render.capturedObjectAddress}`
    : render.label;
}

async function runAcquisition(capture: BrowserPageCapture): Promise<void> {
  const config = await readAcquisitionConfig();
  const client = selectAcquisitionClient(config);
  if (client.kind === "not_configured") {
    // Opt-in dev capability: stay silent rather than nag on every capture.
    setAcquisitionStatus(null);
    return;
  }
  setAcquisitionStatus(renderAcquisitionPending());
  const result = await client.capture(capture);
  setAcquisitionStatus(renderAcquisitionClientResult(result));

  // Third-act gate: ONLY a `captured` acquisition makes drafting an option.
  // This is the single, one-directional touch between the two lanes: the
  // capture gates the Draft *option*; it never performs the draft. A recapture
  // of a new page replaces the prior governed source; a failed/absent capture
  // withdraws the option (Draft becomes unavailable again).
  setDraftGovernedSource(
    result.kind === "captured" ? result.result : null,
  );
}

// ---------------------------------------------------------------------------
// AUTHOR-HTTP draft lane (the THIRD governed act).
//
// Structurally independent of acquisition. It reads #authoring-status only, and
// its terminal success is a proposal_only handoff — never admission. The Draft
// button is DISABLED until a captured governed source exists; capture never
// auto-drafts.
//
// C0: there are TWO structurally separate backend actions behind this single
// button — `draftFromUrl()` (producer RE-FETCHES the source URL, a NEW
// observation) and `draftFromHeldCapture()` (producer reprocesses the
// already-held capture identified by `capture_id`, NO live re-fetch). The
// panel currently exposes only ONE "Draft from source" button rather than two
// distinct affordances; `runDraftFromSource()` below picks the action ONCE,
// preferring the historical action whenever the captured source carries a
// `capture_id` (strictly more provenance-preserving), and never falls back
// from one action's failure into the other. If/when the panel grows a second
// explicit UI affordance for "draft via fresh re-fetch", this heuristic should
// be replaced by an explicit operator choice.
// ---------------------------------------------------------------------------

/**
 * The governed source available to the draft lane. This holds ONLY a guarded
 * acquisition result whose `source_locator` (a URL) the draft client will read.
 * No producer fact is copied out of it here; the authoring client extracts the
 * URL alone.
 */
const draftGovernedSource: { result: AcquisitionCaptureResult | null } = {
  result: null,
};

function setAuthoringStatus(render: AuthoringRender | null): void {
  const el = document.getElementById("authoring-status");
  if (!el) return;
  if (!render) {
    el.style.display = "none";
    el.dataset["state"] = "";
    return;
  }
  el.style.display = "";
  el.dataset["state"] = render.state;
  const label = document.getElementById("authoring-status-label");
  if (label) label.textContent = render.label;
  const authority = document.getElementById("authoring-status-authority");
  if (authority) authority.textContent = render.authorityLine;
  const admission = document.getElementById("authoring-status-admission");
  // Ever-present: a proposal is never an admission.
  if (admission) admission.textContent = render.admissionLine;
  const lifecycle = document.getElementById("authoring-status-lifecycle");
  if (lifecycle) {
    lifecycle.textContent = render.lifecycle
      ? `Draft lifecycle: ${render.lifecycle}`
      : "";
  }
  const digest = document.getElementById("authoring-status-digest");
  if (digest) {
    digest.textContent = render.handoffDigest
      ? `Handoff: ${render.handoffDigest}`
      : "";
  }
}

/** Reflect draft availability onto the button + initial status line. */
function setDraftGovernedSource(result: AcquisitionCaptureResult | null): void {
  draftGovernedSource.result = result;
  const btn = document.getElementById(
    "authoring-draft-btn",
  ) as HTMLButtonElement | null;
  const section = document.getElementById("authoring-section");
  const availability = mapDraftAvailability(result !== null);
  if (btn) btn.disabled = availability !== "DRAFT_READY";
  // Only surface the draft section once the authoring service is configured;
  // otherwise the whole lane stays silent (opt-in dev capability). Visibility is
  // established by initAuthoringDraft(); here we only refresh the readiness line
  // when the section is already visible.
  if (section && section.style.display !== "none") {
    setAuthoringStatus(
      availability === "DRAFT_READY"
        ? renderDraftReady()
        : renderDraftUnavailable(),
    );
  }
}

/** Parse operator-typed evidence handles, keeping only well-formed ones. */
function parseEvidenceHandles(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^evidence:E\d{1,}$/.test(s));
}

/**
 * Build the operator-authored draft material from the panel inputs. The client
 * NEVER invents claims: the single claim is exactly the operator's text over the
 * operator's cited handles. The recipe is minimal proposal-only scaffolding.
 */
function readOperatorMaterial(): OperatorDraftMaterial | null {
  const subject = (
    document.getElementById("authoring-subject") as HTMLInputElement | null
  )?.value.trim();
  const claimText = (
    document.getElementById("authoring-claim-text") as HTMLTextAreaElement | null
  )?.value.trim();
  const evidenceRaw =
    (document.getElementById("authoring-evidence") as HTMLInputElement | null)
      ?.value ?? "";
  const evidenceRefs = parseEvidenceHandles(evidenceRaw);

  if (!subject || !claimText || evidenceRefs.length === 0) return null;

  const claimId = "claim-operator-1";
  return {
    subjectSeed: subject,
    operatorObjective: `Produce a bounded proposal describing ${subject}.`,
    // Operator label for the governed source. NOT a producer id.
    candidateId: "operator-governed-source-1",
    claims: [
      {
        claim_id: claimId,
        claim_text: claimText,
        supports: [{ evidence_refs: evidenceRefs }],
        contradicts: [],
      },
    ],
    coverageRequirements: [
      {
        requirement_id: "req-core",
        label: "Core coverage",
        description: "Operator-authored bounded descriptive coverage.",
      },
    ],
    coverageAssessments: [
      {
        requirement_id: "req-core",
        state: "sufficient_candidate_support",
        supporting_claim_ids: [claimId],
        conflicting_claim_ids: [],
      },
    ],
    recipe: {
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    },
    depth: "brief",
  };
}

async function runDraftFromSource(): Promise<void> {
  const source = draftGovernedSource.result;
  if (!source) {
    // Defensive: the button is disabled without a captured source. Never draft.
    setAuthoringStatus(renderDraftUnavailable());
    return;
  }
  const material = readOperatorMaterial();
  if (!material) {
    setAuthoringStatus(renderDraftFailed());
    return;
  }

  const config = await readAuthoringConfig();
  const client = selectAuthoringClient(config);
  if (client.kind === "not_configured") {
    setAuthoringStatus(renderAuthoringClientResult({ kind: "not_configured" }));
    return;
  }

  setAuthoringStatus(renderDraftPending());
  try {
    // Action selection (C0 UI judgment call — see panel.ts module docstring
    // above `runDraftFromSource`): the panel exposes ONE "Draft from source"
    // button, not two. When the captured source carries a real `capture_id`
    // we take the strictly more provenance-preserving historical action
    // (`/v0/draft-from-source`, no live re-fetch); otherwise we fall back to
    // the URL action (`/v0/draft-from-url`). This is a ONE-TIME choice made
    // before the request is sent — never a retry/fallback from one action's
    // failure into the other.
    const result = source.capture_id
      ? await client.draftFromHeldCapture(source, material)
      : await client.draftFromUrl(source, material);
    setAuthoringStatus(renderAuthoringClientResult(result));
  } catch {
    setAuthoringStatus(renderDraftFailed());
  }
}

async function initAuthoringDraft(): Promise<void> {
  const section = document.getElementById("authoring-section");
  const btn = document.getElementById(
    "authoring-draft-btn",
  ) as HTMLButtonElement | null;
  if (!section || !btn) return;

  // Opt-in dev capability: only reveal the third-act lane when an authoring
  // service is configured. Production stays silent (no host permission).
  const config = await readAuthoringConfig();
  if (!config) {
    section.style.display = "none";
    return;
  }
  section.style.display = "";
  setAuthoringStatus(
    draftGovernedSource.result ? renderDraftReady() : renderDraftUnavailable(),
  );

  // EXPLICIT act only — the draft never fires from the capture flow.
  btn.addEventListener("click", () => {
    void runDraftFromSource();
  });
}

void initAuthoringDraft();

function initCaptureButton(): void {
  const btn = document.getElementById("capture-btn") as HTMLButtonElement | null;
  const status = document.getElementById("capture-status");
  if (!btn || !status) return;

  wireCaptureButton({
    button: btn,
    setStatus: (text, isError) => {
      status.textContent = text;
      status.className = isError ? "capture-status error" : "capture-status";
    },
    sendMessage: (msg) =>
      chrome.runtime.sendMessage(msg) as Promise<CaptureResponse | undefined>,
    // Reuse the exact capture object from the single request. In production the
    // demo section is never injected, so this only records the in-memory store.
    onCapture: async (capture) => {
      demoCaptureStore.latest = capture;

      // EXPLICIT capture happened → the source is now OBSERVED in this browser.
      // This is the ONLY place `observed` is set true, and it is set only from a
      // real user-gesture capture — never inferred. The canonical/title from the
      // observation refine the locator (and the deep-link hint). This never
      // advances the source-work or receipt postures.
      swState.observed = true;
      swState.locator = {
        current_url: capture.current_url || swState.locator?.current_url || "",
        canonical_url: capture.canonical_url,
        title: capture.document_title || null,
      };
      swState.visible = true;
      renderSourceWorkbench();

      const section = document.getElementById("demo-section") as
        | (HTMLElement & { refreshCaptureInfo?: () => Promise<void> })
        | null;
      if (section?.refreshCaptureInfo) {
        await section.refreshCaptureInfo();
      }

      // Product/ingestion lane: submit to a configured localhost acquisition
      // service and render its UNADMITTED result. Never breaks the capture flow.
      try {
        await runAcquisition(capture);
      } catch {
        setAcquisitionStatus(renderTransportError());
      }
    },
  });
}

initCaptureButton();

initDemoPanel(demoCaptureStore);
