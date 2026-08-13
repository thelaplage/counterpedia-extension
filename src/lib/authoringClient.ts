/**
 * AUTHOR-HTTP draft-from-source client.
 *
 * A thin client that turns a GOVERNED SOURCE (the URL an acquisition already
 * observed) plus OPERATOR-AUTHORED claim material into a real, terminal
 * `AuthoringAdmissionHandoff` (`authority_posture="proposal_only"`) by posting to
 * the localhost authoring producer over the constrained HTTP transport. It owns
 * HTTP concerns only: it builds the `DraftFromSourceRequest`, attaches the
 * transport token, and runs the response through the fail-closed guard. It
 * invents NO authoring semantics, no claims, and confers no admission authority.
 *
 * CUSTODY FIREWALL (the point of the lane): the request-builder's ONLY source
 * input is a URL string. It has no structural access to the acquisition result's
 * producer-owned facts (`capture_id` / `source_id` / `capture_receipt` /
 * `captured_object_address` / byte digests). The authoring producer RE-FETCHES
 * the URL and mints its own facts; this client never claims ACQ1 bytes were
 * reused. Operator claim material is passed VERBATIM — the client never invents,
 * infers, or completes a claim.
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
/** The single POST path on the authoring transport. */
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
 * Operator-authored material for a draft. Everything here is authored by the
 * operator in the panel and passed through verbatim; the client adds nothing.
 * The only tie to the acquisition is `candidateId` (an operator label for the
 * governed source); the source URL itself is supplied separately as a bare
 * string so this material can never smuggle a producer fact.
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

/** One operator-authorized governed source candidate: an id + the URL to acquire. */
export interface OperatorCandidate {
  candidate_id: string;
  url: string;
}

/**
 * The wire request. A typed COMPOSITION of existing authoring contract inputs;
 * it mirrors the producer's `DraftFromSourceRequest` so the extension consumes
 * that contract without becoming a second schema authority.
 */
export interface DraftFromSourceRequest {
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
 * Build the wire request from a GOVERNED SOURCE URL and operator material.
 *
 * The signature is the custody firewall: the ONLY thing this function knows
 * about the acquisition is a URL string. It is structurally incapable of copying
 * `capture_id` / `source_id` / `capture_receipt` / digests into the request,
 * because it never receives them. The producer re-fetches the URL.
 */
export function buildDraftFromSourceRequest(
  governedSourceUrl: string,
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
    claims: material.claims,
    coverage_requirements: material.coverageRequirements ?? [],
    coverage_assessments: material.coverageAssessments ?? [],
    conflicts: material.conflicts ?? [],
    recipe: {
      recipe_id: material.recipe.recipe_id,
      output_profile: material.recipe.output_profile,
      lead_policy_reference: material.recipe.lead_policy_reference,
      recipe_version: material.recipe.recipe_version,
      desired_section_vocabulary: material.recipe.desired_section_vocabulary ?? [],
    },
    depth: material.depth ?? "brief",
  };
  if (material.boundClaimIds !== undefined) {
    request.bound_claim_ids = material.boundClaimIds;
  }
  return request;
}

/**
 * Result of a draft-from-source attempt. `not_configured` / `invalid_source` /
 * `authoring_failed` never carry a proposal; `assembled` carries the guarded
 * proposal-only handoff and is terminally UNADMITTED.
 */
export type AuthoringClientResult =
  | { kind: "not_configured" }
  | { kind: "invalid_source"; detail: string }
  | { kind: "assembled"; handoff: AuthoringHandoff }
  | { kind: "authoring_failed"; status: number | null; detail: string };

export interface AuthoringClient {
  readonly kind: "http" | "not_configured";
  /**
   * Draft from a governed source. Reads ONLY `source_locator` off the
   * acquisition result — never a producer fact — and passes it as a bare URL to
   * the request builder.
   */
  draftFromSource(
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
  async draftFromSource(): Promise<AuthoringClientResult> {
    return { kind: "not_configured" };
  },
};

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

  const endpoint = config.baseUrl.replace(/\/+$/, "") + DRAFT_FROM_SOURCE_PATH;

  return {
    kind: "http",
    async draftFromSource(
      acquisitionResult: AcquisitionCaptureResult,
      material: OperatorDraftMaterial,
    ): Promise<AuthoringClientResult> {
      // CUSTODY: read ONLY the source URL off the acquisition result. Every
      // other field (capture_id / source_id / capture_receipt / address /
      // byte_count) is deliberately left untouched and never enters the request.
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

      const request = buildDraftFromSourceRequest(governedSourceUrl, material);

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
        };
      }

      if (!response.ok) {
        // Transport/pipeline-level rejection (4xx/5xx). Never a proposal.
        return {
          kind: "authoring_failed",
          status: response.status,
          detail: `http ${response.status}`,
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
        };
      }

      let handoff: AuthoringHandoff;
      try {
        handoff = parseAuthoringHandoff(raw);
      } catch (err) {
        if (err instanceof AuthoringResponseError) {
          // Contaminated / unauthorized response: refuse it even from localhost.
          return {
            kind: "authoring_failed",
            status: response.status,
            detail: err.message,
          };
        }
        throw err;
      }

      return { kind: "assembled", handoff };
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
