/**
 * AUTHOR-HTTP draft clients — TWO structurally separate actions.
 *
 * AUTH0-RECON1 / C0: this module used to expose a single `draftFromSource()`
 * method that was mislabeled — it read only a URL off the acquisition result
 * and posted to `/v0/draft-from-source`, but its actual behavior (the producer
 * RE-FETCHES the URL and mints a NEW observation) is the `/v0/draft-from-url`
 * semantic. That method is now honestly named `draftFromUrl()` and posts to
 * `DRAFT_FROM_URL_PATH`.
 *
 * `/v0/draft-from-source` is reserved for a DIFFERENT, separately implemented
 * backend action: reprocessing an already-held historical capture with NO live
 * network re-fetch. That action is exposed here as `draftFromHeldCapture()`.
 * The two methods are never a resolver/fallback chain into each other — the
 * caller picks one action and that action alone runs to its terminal result.
 *
 * Both methods build a typed COMPOSITION of existing authoring contract inputs,
 * attach the transport token, and run the response through the fail-closed
 * guard. Neither invents authoring semantics, claims, or admission authority.
 *
 * CUSTODY FIREWALL:
 *   - `draftFromUrl()`'s ONLY source input is a URL string. It has no
 *     structural access to the acquisition result's producer-owned facts
 *     (`capture_id` / `source_id` / `capture_receipt` / `captured_object_address`
 *     / byte digests). The producer re-fetches the URL and mints its own facts;
 *     this method never claims ACQ1 bytes were reused.
 *   - `draftFromHeldCapture()` reads exactly ONE additional producer-owned
 *     field off the acquisition result — `capture_id` — and forwards it as the
 *     wire request's `capture_ref`. This is the one deliberate, narrow
 *     exception to the firewall; every other producer fact
 *     (`capture_receipt` / `captured_object_address` / `byte_count` /
 *     `source_id`) stays untouched.
 *   - Both methods pass operator claim material VERBATIM — neither invents,
 *     infers, or completes a claim.
 *
 * Client selection is honest: with a configured base URL + token you get the
 * HTTP client; otherwise you get the `notConfigured` client, which NEVER
 * fabricates a proposal.
 */

import type { AcquisitionCaptureResult } from "./acquisitionResponseGuard";
import {
  parseAuthoringHandoff,
  AuthoringResponseError,
  type AuthoringHandoff,
} from "./authoringResponseGuard";

/** Header carrying the local transport token (transport auth only). */
export const TRANSPORT_TOKEN_HEADER = "X-Counterpedia-Transport-Token";
/** URL-selection action: authoring-side producer re-fetches, yielding a NEW observation. */
export const DRAFT_FROM_URL_PATH = "/v0/draft-from-url";
/** Historical-source action: producer reprocesses an already-held capture. NO live fetch. */
export const DRAFT_FROM_SOURCE_PATH = "/v0/draft-from-source";

export interface AuthoringConfig {
  /** e.g. "http://127.0.0.1:8788" — loopback only in v0.1. */
  baseUrl: string;
  /** Per-run local transport token. Transport authentication ONLY. */
  token: string;
}

/** Minimal recipe scaffolding the composer needs. Proposal-only; no authority. */
export interface OperatorRecipeSpec {
  recipe_id: string;
  output_profile: string;
  lead_policy_reference: string;
  recipe_version: string;
  desired_section_vocabulary?: string[];
}

/**
 * Draft material for a draft request. This type mixes two DIFFERENT
 * provenances, and callers must not conflate them:
 *
 * - **Operator-supplied** (typed by a human in the panel, passed through
 *   verbatim — the client neither invents nor completes these):
 *   `claims[].claim_text` and the evidence handles cited in
 *   `claims[].supports[].evidence_refs`, plus the free-text `subjectSeed`.
 * - **Application-constructed** (assembled by this extension's code from an
 *   explicit default profile, NOT an operator assertion — see
 *   `DEFAULT_AUTHORING_PROFILE` in `src/panel/panel.ts`): `operatorObjective`,
 *   `candidateId`, `coverageRequirements`, `coverageAssessments`, `recipe`,
 *   and `depth`. Despite the field name `operatorObjective`, the panel's
 *   current build populates this from a fixed application template, not
 *   operator-authored text; a future surface could let the operator edit it
 *   without changing this type.
 *
 * The only tie to the acquisition is `candidateId` (an application-assigned
 * label for the governed source, not a producer id); the source URL itself
 * is supplied separately as a bare string so this material can never smuggle
 * a producer fact. This SAME material shape is reused by both
 * `draftFromUrl()` and `draftFromHeldCapture()` — there is no second
 * "profile" concept.
 */
export interface OperatorDraftMaterial {
  subjectSeed: string;
  operatorObjective: string;
  /** Operator label for the governed source candidate. NOT a producer id. */
  candidateId: string;
  /** Operator-authored claims, verbatim. Must be non-empty. */
  claims: Array<Record<string, unknown>>;
  coverageRequirements?: Array<Record<string, unknown>>;
  coverageAssessments?: Array<Record<string, unknown>>;
  conflicts?: Array<Record<string, unknown>>;
  boundClaimIds?: string[];
  recipe: OperatorRecipeSpec;
  depth?: string;
}

/** One operator-authorized governed source candidate: an id + a URL. */
export interface OperatorCandidate {
  candidate_id: string;
  url: string;
}

/**
 * The URL-action wire request. A typed COMPOSITION of existing authoring
 * contract inputs; it mirrors the producer's `DraftFromUrlRequest` so the
 * extension consumes that contract without becoming a second schema authority.
 * The producer RE-FETCHES `candidates[].url`.
 */
export interface DraftFromUrlRequest {
  subject_seed: string;
  operator_objective: string;
  candidates: OperatorCandidate[];
  selected_candidate_ids?: string[];
  claims: Array<Record<string, unknown>>;
  coverage_requirements: Array<Record<string, unknown>>;
  coverage_assessments: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  bound_claim_ids?: string[];
  recipe: {
    recipe_id: string;
    output_profile: string;
    lead_policy_reference: string;
    recipe_version: string;
    desired_section_vocabulary: string[];
  };
  depth: string;
}

/**
 * The historical-source-action wire request. Mirrors the producer's
 * `DraftFromSourceRequest` (AUTHOR0-B1 / AUTHOR-B1-RECON1). `candidates[].url`
 * here is NOT a fetch instruction — it is the governed continuity constraint
 * (`expected_source_locator`) the backend binds against. `capture_ref` is the
 * SEPARATE historical acquisition identity that identifies which already-held
 * bytes to reprocess; this route never performs a live fetch under any
 * outcome. AUTHOR-B1-RECON1 enforces exactly one selected candidate in this
 * mode — this client only ever builds one.
 */
export interface DraftFromSourceRequest {
  subject_seed: string;
  operator_objective: string;
  candidates: OperatorCandidate[];
  selected_candidate_ids: string[];
  /** The historical acquisition identity to reprocess. NEVER a receipt, digest, or raw bytes. */
  capture_ref: string;
  claims: Array<Record<string, unknown>>;
  coverage_requirements: Array<Record<string, unknown>>;
  coverage_assessments: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  bound_claim_ids?: string[];
  recipe: {
    recipe_id: string;
    output_profile: string;
    lead_policy_reference: string;
    recipe_version: string;
    desired_section_vocabulary: string[];
  };
  depth: string;
}

function buildRecipe(material: OperatorDraftMaterial): DraftFromUrlRequest["recipe"] {
  return {
    recipe_id: material.recipe.recipe_id,
    output_profile: material.recipe.output_profile,
    lead_policy_reference: material.recipe.lead_policy_reference,
    recipe_version: material.recipe.recipe_version,
    desired_section_vocabulary: material.recipe.desired_section_vocabulary ?? [],
  };
}

/**
 * Build the URL-action wire request from a GOVERNED SOURCE URL and operator
 * material.
 *
 * The signature is the custody firewall: the ONLY thing this function knows
 * about the acquisition is a URL string. It is structurally incapable of copying
 * `capture_id` / `source_id` / `capture_receipt` / digests into the request,
 * because it never receives them. The producer re-fetches the URL.
 */
export function buildDraftFromUrlRequest(
  governedSourceUrl: string,
  material: OperatorDraftMaterial,
): DraftFromUrlRequest {
  const candidate: OperatorCandidate = {
    candidate_id: material.candidateId,
    url: governedSourceUrl,
  };
  const request: DraftFromUrlRequest = {
    subject_seed: material.subjectSeed,
    operator_objective: material.operatorObjective,
    candidates: [candidate],
    selected_candidate_ids: [material.candidateId],
    claims: material.claims,
    coverage_requirements: material.coverageRequirements ?? [],
    coverage_assessments: material.coverageAssessments ?? [],
    conflicts: material.conflicts ?? [],
    recipe: buildRecipe(material),
    depth: material.depth ?? "brief",
  };
  if (material.boundClaimIds !== undefined) {
    request.bound_claim_ids = material.boundClaimIds;
  }
  return request;
}

/**
 * Build the historical-source-action wire request from the governed source's
 * continuity URL, its `capture_id` (forwarded as `capture_ref`), and operator
 * material.
 *
 * Exactly one candidate, exactly one selected id — this client never builds
 * multi-candidate plumbing, matching the backend's AUTHOR-B1-RECON1 singular
 * invariant by construction.
 */
export function buildDraftFromSourceRequest(
  governedSourceUrl: string,
  captureRef: string,
  material: OperatorDraftMaterial,
): DraftFromSourceRequest {
  const candidate: OperatorCandidate = {
    candidate_id: material.candidateId,
    url: governedSourceUrl,
  };
  const request: DraftFromSourceRequest = {
    subject_seed: material.subjectSeed,
    operator_objective: material.operatorObjective,
    candidates: [candidate],
    selected_candidate_ids: [material.candidateId],
    capture_ref: captureRef,
    claims: material.claims,
    coverage_requirements: material.coverageRequirements ?? [],
    coverage_assessments: material.coverageAssessments ?? [],
    conflicts: material.conflicts ?? [],
    recipe: buildRecipe(material),
    depth: material.depth ?? "brief",
  };
  if (material.boundClaimIds !== undefined) {
    request.bound_claim_ids = material.boundClaimIds;
  }
  return request;
}

/**
 * Result of a draft attempt (either action). `not_configured` / `invalid_source` /
 * `authoring_failed` never carry a proposal; `assembled` carries the guarded
 * proposal-only handoff and is terminally UNADMITTED.
 *
 * `authoring_failed.refusalCode` carries the backend's bounded typed refusal
 * code (e.g. `source_basis_unresolved`, `pipeline_refused`,
 * `held_capture_requires_single_candidate`) when the non-2xx response body
 * parses as JSON with a string `error` field. It is `null` whenever that
 * shape isn't present — malformed body, non-JSON body, missing/non-string
 * `error`, or a network-level failure with no response at all. `detail`
 * stays the existing coarse `http <status>` / error-message string; this new
 * field is additive, never a replacement.
 */
export type AuthoringClientResult =
  | { kind: "not_configured" }
  | { kind: "invalid_source"; detail: string }
  | { kind: "assembled"; handoff: AuthoringHandoff }
  | {
      kind: "authoring_failed";
      status: number | null;
      detail: string;
      refusalCode: string | null;
    };

/**
 * Parse the bounded server refusal shape (`{ "error": "<code>" }`) out of a
 * non-2xx response body. Fails safe to `null` on ANY deviation — non-JSON
 * text, a JSON body that isn't an object, a missing `error` field, or an
 * `error` field that isn't a string. Never throws; never reflects arbitrary
 * body content, only the single bounded `error` string when it is exactly
 * that shape.
 */
function extractRefusalCode(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const candidate = (raw as Record<string, unknown>)["error"];
  return typeof candidate === "string" ? candidate : null;
}

export interface AuthoringClient {
  readonly kind: "http" | "not_configured";
  /**
   * Draft via the URL action. Reads ONLY `source_locator` off the acquisition
   * result — never a producer fact — and passes it as a bare URL to the
   * request builder. The producer RE-FETCHES it, creating a NEW observation.
   */
  draftFromUrl(
    acquisitionResult: AcquisitionCaptureResult,
    material: OperatorDraftMaterial,
  ): Promise<AuthoringClientResult>;
  /**
   * Draft via the historical-source action. Reads `capture_id` (forwarded as
   * `capture_ref`) AND `source_locator` (forwarded as the continuity
   * constraint) off the acquisition result. Refuses — with ZERO network calls
   * — when `capture_id` is missing; this action is never attempted without a
   * real held-capture identity, and it never falls back to `draftFromUrl()`.
   */
  draftFromHeldCapture(
    acquisitionResult: AcquisitionCaptureResult,
    material: OperatorDraftMaterial,
  ): Promise<AuthoringClientResult>;
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

export interface HttpAuthoringClientOptions {
  config: AuthoringConfig;
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

/** The honest "no service configured" client. Never fabricates a proposal. */
export const notConfiguredAuthoringClient: AuthoringClient = {
  kind: "not_configured",
  async draftFromUrl(): Promise<AuthoringClientResult> {
    return { kind: "not_configured" };
  },
  async draftFromHeldCapture(): Promise<AuthoringClientResult> {
    return { kind: "not_configured" };
  },
};

/** POST `request` to `endpoint` and run the response through the fail-closed guard. */
async function postAndGuard(
  endpoint: string,
  request: DraftFromUrlRequest | DraftFromSourceRequest,
  config: AuthoringConfig,
  fetchImpl: FetchLike,
  originHeader: string | undefined,
): Promise<AuthoringClientResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [TRANSPORT_TOKEN_HEADER]: config.token,
  };
  if (originHeader) headers["Origin"] = originHeader;

  const body = JSON.stringify(request);

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(endpoint, { method: "POST", headers, body });
  } catch (err) {
    return {
      kind: "authoring_failed",
      status: null,
      detail: err instanceof Error ? err.message : "network error",
      refusalCode: null,
    };
  }

  if (!response.ok) {
    // Transport/pipeline-level rejection (4xx/5xx). Never a proposal. The
    // backend returns a bounded typed refusal code (e.g.
    // `source_basis_unresolved`, `pipeline_refused`,
    // `held_capture_requires_single_candidate`) in the JSON body; parse it
    // out defensively — a malformed or non-JSON body must never crash this
    // path, it just yields `refusalCode: null`.
    let refusalCode: string | null = null;
    try {
      refusalCode = extractRefusalCode(await response.json());
    } catch {
      refusalCode = null;
    }
    return {
      kind: "authoring_failed",
      status: response.status,
      detail: `http ${response.status}`,
      refusalCode,
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return {
      kind: "authoring_failed",
      status: response.status,
      detail: "non-JSON response",
      refusalCode: null,
    };
  }

  let handoff: AuthoringHandoff;
  try {
    handoff = parseAuthoringHandoff(raw);
  } catch (err) {
    if (err instanceof AuthoringResponseError) {
      // Contaminated / unauthorized response: refuse it even from localhost.
      // This is a CLIENT-SIDE guard rejection of an otherwise-2xx response,
      // not a server-declared bounded refusal code, so refusalCode is null.
      return {
        kind: "authoring_failed",
        status: response.status,
        detail: err.message,
        refusalCode: null,
      };
    }
    throw err;
  }

  return { kind: "assembled", handoff };
}

/** Build the HTTP authoring client for a configured loopback endpoint. */
export function createHttpAuthoringClient(
  options: HttpAuthoringClientOptions,
): AuthoringClient {
  const { config, originHeader } = options;
  const fetchImpl: FetchLike =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  // Loopback-only guard, mirroring the acquisition client discipline: the client
  // refuses to send anything anywhere but a localhost endpoint.
  if (!isLoopbackHttpUrl(config.baseUrl)) {
    throw new Error(
      `authoring baseUrl must be an http loopback URL; got ${config.baseUrl}`,
    );
  }

  const base = config.baseUrl.replace(/\/+$/, "");
  const urlEndpoint = base + DRAFT_FROM_URL_PATH;
  const sourceEndpoint = base + DRAFT_FROM_SOURCE_PATH;

  return {
    kind: "http",
    async draftFromUrl(
      acquisitionResult: AcquisitionCaptureResult,
      material: OperatorDraftMaterial,
    ): Promise<AuthoringClientResult> {
      // CUSTODY: read ONLY the source URL off the acquisition result. Every
      // producer-owned capture field is deliberately left untouched.
      const governedSourceUrl = acquisitionResult.source_locator;
      if (!governedSourceUrl) {
        return {
          kind: "invalid_source",
          detail: "acquisition result carries no governed source URL",
        };
      }
      if (material.claims.length === 0) {
        // No-claim-synthesis: refuse rather than manufacture a claim.
        return {
          kind: "invalid_source",
          detail: "no operator claims supplied",
        };
      }

      const request = buildDraftFromUrlRequest(governedSourceUrl, material);
      return postAndGuard(urlEndpoint, request, config, fetchImpl, originHeader);
    },
    async draftFromHeldCapture(
      acquisitionResult: AcquisitionCaptureResult,
      material: OperatorDraftMaterial,
    ): Promise<AuthoringClientResult> {
      // CUSTODY: the one deliberate, narrow exception — read `capture_id` and
      // forward it as `capture_ref`. Every other producer-owned capture field
      // (capture_receipt / captured_object_address / byte_count / source_id)
      // stays untouched.
      const captureRef = acquisitionResult.capture_id;
      if (!captureRef) {
        return {
          kind: "invalid_source",
          detail: "acquisition result carries no capture_id",
        };
      }
      const governedSourceUrl = acquisitionResult.source_locator;
      if (!governedSourceUrl) {
        return {
          kind: "invalid_source",
          detail: "acquisition result carries no governed source URL",
        };
      }
      if (material.claims.length === 0) {
        // No-claim-synthesis: refuse rather than manufacture a claim.
        return {
          kind: "invalid_source",
          detail: "no operator claims supplied",
        };
      }

      const request = buildDraftFromSourceRequest(
        governedSourceUrl,
        captureRef,
        material,
      );
      return postAndGuard(sourceEndpoint, request, config, fetchImpl, originHeader);
    },
  };
}

/**
 * Select the authoring client honestly. A non-loopback or partial config yields
 * the notConfigured client — never a silent fake-proposal fallback.
 */
export function selectAuthoringClient(
  config: AuthoringConfig | null | undefined,
  options?: Omit<HttpAuthoringClientOptions, "config">,
): AuthoringClient {
  if (
    !config ||
    !config.baseUrl ||
    !config.token ||
    !isLoopbackHttpUrl(config.baseUrl)
  ) {
    return notConfiguredAuthoringClient;
  }
  return createHttpAuthoringClient({ config, ...options });
}

/**
 * Read authoring config from chrome.storage.sync, mirroring the acquisition
 * `readAcquisitionConfig()` pattern. Returns null when not configured. Isolated
 * here so the pure client/guard modules stay Chrome-API-free and unit-testable.
 */
export async function readAuthoringConfig(): Promise<AuthoringConfig | null> {
  try {
    const stored = await chrome.storage.sync.get([
      "counterpedia_authoring_base_url",
      "counterpedia_authoring_token",
    ]);
    const baseUrl = stored["counterpedia_authoring_base_url"] as
      | string
      | undefined;
    const token = stored["counterpedia_authoring_token"] as string | undefined;
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  } catch {
    return null;
  }
}
