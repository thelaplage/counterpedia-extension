/**
 * Source Workbench presentation model — EXT-BROWSER1.
 *
 * A source-first, sparse-corpus presentation state for the side panel. It is a
 * PURE module: no Chrome APIs, no DOM, no network. It turns three independent
 * inputs — a page locator, whether the user explicitly OBSERVED (captured) the
 * page in THIS browser, and whether public Counterpedia material relates to the
 * source — into a presentation object the panel renders, plus a deep link that
 * navigates to the Counterpedia Source Workbench "with intent".
 *
 * HANDOFF MODEL = DEEP-LINK (operator decision). The panel does NOT export
 * evidence into the workbench; it navigates with intent. The panel holds a
 * browser OBSERVATION (BrowserPageCapture); CP-WORK0 v0.1 imports a completed
 * declaration-bound source-work session. Those are different object states and
 * this module never distorts either to connect them:
 *
 *  - The BrowserPageCapture is OBSERVED only. It is never serialized here as a
 *    workbench session, and its bytes never become authoritative source bytes.
 *  - The deep link MAY carry the page locator as a convenience HINT, but never
 *    as source identity, declaration identity, or proof that capture happened.
 *    It therefore never carries the capture digest or any captured/verified/
 *    bound token.
 *  - Three postures are kept plainly separate and are NEVER synthesized from the
 *    observation: (i) Observed in this browser; (ii) Counterpedia source work
 *    available / not yet available; (iii) Receipt available / not yet available.
 *
 * "Available" for source-work / receipt is asserted ONLY by an authoritative
 * resolution object (a future Counterpedia public artifact, resolved elsewhere),
 * validated fail-closed here, whose locator matches this page and whose ref is a
 * same-origin path. Absent a valid, matching resolution the posture stays
 * "not_yet_available". No posture is ever derived from `observed` or from the
 * presence of public material — those are different facts.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COUNTERPEDIA_BASE_URL = "https://www.garpedia.org";

/** The Counterpedia Source Workbench entry path the deep link targets. */
export const SOURCE_WORKBENCH_PATH = "/counterpedia/source-workbench";

/**
 * CRITICAL COPY — the BrowserPageCapture claim boundary, rendered verbatim on
 * the surface. The observation is an observation, never proof of truth.
 */
export const BPC_OBSERVATION_COPY =
  "Captures what the browser rendered. It does not establish that the page's claims are true.";

/** Shown when the corpus is sparse: no public record relates to this source. */
export const NO_PUBLIC_RECORD_COPY =
  "Counterpedia does not have a public record for this source yet.";

// ---------------------------------------------------------------------------
// Postures — closed sets. There is deliberately NO "verified" / "captured" /
// "bound" observation posture: the panel has no authority to assert those.
// ---------------------------------------------------------------------------

export type ObservationPosture = "not_observed" | "observed_in_browser";
export type SourceWorkPosture = "not_yet_available" | "available";
export type ReceiptPosture = "not_yet_available" | "available";
export type PublicMaterialPosture = "present" | "absent";

// ---------------------------------------------------------------------------
// Page locator
// ---------------------------------------------------------------------------

export interface SourceLocator {
  /** document.URL / active-tab URL at observation time. */
  current_url: string;
  /** <link rel="canonical"> href, or null if unknown / not observed. */
  canonical_url: string | null;
  /** document title, or null if unknown / not observed. */
  title: string | null;
}

// ---------------------------------------------------------------------------
// Authoritative resolution (HELD transport in v0.1 — presentation + fixtures
// only). This is NOT CP-WORK0's SourceWorkbenchSessionImportV0_1 and does not
// import it; it is the minimal, pinned shape the panel would accept from a
// future Counterpedia PUBLIC resolution artifact (same discipline as the
// search-index / activity-index consumers). It is validated fail-closed.
// ---------------------------------------------------------------------------

export const PINNED_SOURCE_WORK_RESOLUTION_KIND = "source_work_resolution" as const;
export const PINNED_SOURCE_WORK_RESOLUTION_SCHEMA_VERSION = 1 as const;

export interface SourceWorkResolution {
  kind: typeof PINNED_SOURCE_WORK_RESOLUTION_KIND;
  schema_version: typeof PINNED_SOURCE_WORK_RESOLUTION_SCHEMA_VERSION;
  /** The source this resolution is about. Must match the page locator. */
  locator: { current_url: string; canonical_url?: string | null };
  /** Whether Counterpedia holds a completed source-work object for this source. */
  source_work: { available: boolean; workbench_ref?: string };
  /** Whether an independently-verifiable receipt exists for that work. */
  receipt: { available: boolean; receipt_ref?: string };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed value as a SourceWorkResolution. Fails CLOSED (throws) on
 * any schema mismatch — no coercion, no "best effort" — mirroring the pinned
 * schema discipline of validateActivityIndex / validateCardModel. A caller that
 * wants a non-throwing default should use tryValidateSourceWorkResolution.
 */
export function validateSourceWorkResolution(input: unknown): SourceWorkResolution {
  if (!isPlainObject(input)) {
    throw new Error("SourceWorkResolution: input must be an object");
  }
  if (input["kind"] !== PINNED_SOURCE_WORK_RESOLUTION_KIND) {
    throw new Error(
      `SourceWorkResolution: kind must be ${JSON.stringify(PINNED_SOURCE_WORK_RESOLUTION_KIND)}, got ${JSON.stringify(input["kind"])}`,
    );
  }
  if (input["schema_version"] !== PINNED_SOURCE_WORK_RESOLUTION_SCHEMA_VERSION) {
    throw new Error(
      `SourceWorkResolution: schema_version must be ${PINNED_SOURCE_WORK_RESOLUTION_SCHEMA_VERSION}, got ${JSON.stringify(input["schema_version"])}`,
    );
  }

  const locator = input["locator"];
  if (!isPlainObject(locator)) {
    throw new Error("SourceWorkResolution: locator must be an object");
  }
  if (typeof locator["current_url"] !== "string" || locator["current_url"].length === 0) {
    throw new Error("SourceWorkResolution: locator.current_url must be a non-empty string");
  }
  if (
    locator["canonical_url"] !== undefined &&
    locator["canonical_url"] !== null &&
    typeof locator["canonical_url"] !== "string"
  ) {
    throw new Error("SourceWorkResolution: locator.canonical_url must be a string or null");
  }

  const sourceWork = input["source_work"];
  if (!isPlainObject(sourceWork)) {
    throw new Error("SourceWorkResolution: source_work must be an object");
  }
  if (typeof sourceWork["available"] !== "boolean") {
    throw new Error("SourceWorkResolution: source_work.available must be a boolean");
  }
  if (sourceWork["workbench_ref"] !== undefined && typeof sourceWork["workbench_ref"] !== "string") {
    throw new Error("SourceWorkResolution: source_work.workbench_ref must be a string when present");
  }
  if (sourceWork["available"] === true && typeof sourceWork["workbench_ref"] !== "string") {
    throw new Error(
      "SourceWorkResolution: source_work.available true requires a workbench_ref (cannot claim available without a resolvable object)",
    );
  }

  const receipt = input["receipt"];
  if (!isPlainObject(receipt)) {
    throw new Error("SourceWorkResolution: receipt must be an object");
  }
  if (typeof receipt["available"] !== "boolean") {
    throw new Error("SourceWorkResolution: receipt.available must be a boolean");
  }
  if (receipt["receipt_ref"] !== undefined && typeof receipt["receipt_ref"] !== "string") {
    throw new Error("SourceWorkResolution: receipt.receipt_ref must be a string when present");
  }
  if (receipt["available"] === true && typeof receipt["receipt_ref"] !== "string") {
    throw new Error(
      "SourceWorkResolution: receipt.available true requires a receipt_ref (cannot claim a receipt without a resolvable ref)",
    );
  }

  return input as unknown as SourceWorkResolution;
}

/** Non-throwing validation: returns null on any schema mismatch (fail-closed). */
export function tryValidateSourceWorkResolution(input: unknown): SourceWorkResolution | null {
  try {
    return validateSourceWorkResolution(input);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deep link — locator as HINT only
// ---------------------------------------------------------------------------

/**
 * The intent the deep link declares. "continue_source" means: continue this
 * source in Counterpedia. It is NOT a claim that the observation has entered
 * Counterpedia, nor that capture happened.
 */
export const DEEP_LINK_INTENT = "continue_source" as const;

/**
 * Build the Source Workbench deep link. The page locator is carried ONLY as a
 * hint (`source_hint`, and optionally `title_hint`) so the workbench can
 * pre-fill; it is never source identity, declaration identity, or proof of
 * capture. No capture digest and no captured/verified/bound token is ever
 * placed on the URL.
 */
export function buildSourceDeepLink(
  locator: SourceLocator,
  baseUrl: string = COUNTERPEDIA_BASE_URL,
): string {
  const url = new URL(SOURCE_WORKBENCH_PATH, baseUrl);
  // Prefer the canonical URL as the hint when observed; otherwise the current URL.
  const hint = locator.canonical_url ?? locator.current_url;
  url.searchParams.set("intent", DEEP_LINK_INTENT);
  url.searchParams.set("source_hint", hint);
  if (locator.title) {
    url.searchParams.set("title_hint", locator.title);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Ref safety — accept only same-origin absolute paths for authoritative links.
// ---------------------------------------------------------------------------

/** True only for a same-origin absolute path ("/…") — never an external URL. */
function isSameOriginPath(ref: string | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("/") && !ref.startsWith("//");
}

function locatorMatchesResolution(
  locator: SourceLocator,
  resolution: SourceWorkResolution,
): boolean {
  const rl = resolution.locator;
  const pageKeys = new Set(
    [locator.current_url, locator.canonical_url].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    ),
  );
  const resKeys = [rl.current_url, rl.canonical_url].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  // The resolution must be ABOUT this page: at least one locator key in common.
  return resKeys.some((k) => pageKeys.has(k));
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export interface SourceWorkbenchPresentation {
  locator: SourceLocator;
  /** (i) Observed in this browser. Never "verified"/"captured"/"bound". */
  observation: ObservationPosture;
  /** (ii) Counterpedia source work: available / not yet available. */
  source_work: SourceWorkPosture;
  /** (iii) Receipt: available / not yet available. */
  receipt: ReceiptPosture;
  /** Whether public Counterpedia material relates to this source. */
  public_material: PublicMaterialPosture;
  /** Deep link that continues this source in Counterpedia (locator = hint). */
  deep_link_url: string;
  /** Direct link to the resolved workbench object, or null when not available. */
  workbench_object_url: string | null;
  /** Direct link to the resolved receipt, or null when not available. */
  receipt_url: string | null;
  /** The verbatim BPC observation claim boundary. */
  observation_copy: string;
  /** Sparse-corpus notice, present only when public_material is "absent". */
  no_public_record_copy: string | null;
}

export interface SourceWorkbenchInput {
  locator: SourceLocator;
  /** Did the user EXPLICITLY capture (observe) this page in this browser? */
  observed: boolean;
  /** Did public Counterpedia material match this source? */
  publicMaterial: boolean;
  /**
   * Optional authoritative resolution. Validated fail-closed; anything that
   * does not validate, or does not match this page, or lacks a same-origin ref,
   * leaves the corresponding posture at "not_yet_available".
   */
  resolution?: unknown;
  baseUrl?: string;
}

/**
 * Build the presentation state. The three postures are computed independently
 * and are NEVER synthesized from `observed` or `publicMaterial`.
 */
export function buildSourceWorkbenchPresentation(
  input: SourceWorkbenchInput,
): SourceWorkbenchPresentation {
  const baseUrl = input.baseUrl ?? COUNTERPEDIA_BASE_URL;

  // (i) Observation — the ONLY thing `observed` can set. It is an observation
  // posture, not a truth/capture/bound claim.
  const observation: ObservationPosture = input.observed
    ? "observed_in_browser"
    : "not_observed";

  // (ii) + (iii) default to not_yet_available and only advance on a valid,
  // matching, same-origin resolution. Fail-closed on everything else.
  let source_work: SourceWorkPosture = "not_yet_available";
  let receipt: ReceiptPosture = "not_yet_available";
  let workbench_object_url: string | null = null;
  let receipt_url: string | null = null;

  const resolution =
    input.resolution === undefined
      ? null
      : tryValidateSourceWorkResolution(input.resolution);

  if (resolution && locatorMatchesResolution(input.locator, resolution)) {
    if (resolution.source_work.available && isSameOriginPath(resolution.source_work.workbench_ref)) {
      source_work = "available";
      workbench_object_url = new URL(resolution.source_work.workbench_ref, baseUrl).toString();
    }
    if (resolution.receipt.available && isSameOriginPath(resolution.receipt.receipt_ref)) {
      receipt = "available";
      receipt_url = new URL(resolution.receipt.receipt_ref, baseUrl).toString();
    }
  }

  const public_material: PublicMaterialPosture = input.publicMaterial ? "present" : "absent";

  return {
    locator: input.locator,
    observation,
    source_work,
    receipt,
    public_material,
    deep_link_url: buildSourceDeepLink(input.locator, baseUrl),
    workbench_object_url,
    receipt_url,
    observation_copy: BPC_OBSERVATION_COPY,
    no_public_record_copy: public_material === "absent" ? NO_PUBLIC_RECORD_COPY : null,
  };
}

// ---------------------------------------------------------------------------
// Human-readable posture labels (for the UI; kept here so tests can pin copy).
// ---------------------------------------------------------------------------

export const OBSERVATION_LABEL: Record<ObservationPosture, string> = {
  not_observed: "Not observed in this browser",
  observed_in_browser: "Observed in this browser",
};

export const SOURCE_WORK_LABEL: Record<SourceWorkPosture, string> = {
  not_yet_available: "Counterpedia source work: not yet available",
  available: "Counterpedia source work: available",
};

export const RECEIPT_LABEL: Record<ReceiptPosture, string> = {
  not_yet_available: "Counterpedia source-work receipt: not yet available",
  available: "Counterpedia source-work receipt: available",
};
