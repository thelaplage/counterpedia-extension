/**
 * PITCH-RESEARCH1B — narrow browser client for the existing
 * counterpedia-authoring POST /v0/draft-from-source action.
 *
 * The client accepts only an already-validated ACQ1 captured result plus an
 * explicit operator-authored proposition. Browser rendered/main/selected text
 * is never copied into ClaimMap material. The historical acquisition capture_id
 * is carried as capture_ref; source_locator is carried separately as the exact
 * governed selection/continuity fact.
 *
 * This module composes existing producer contracts. It does not admit, publish,
 * verify, assign standing, or reinterpret evidence/support semantics.
 */

import type { CaptureUrlCapturedResult } from "./acquisitionTransport";

export const AUTHORING_DEFAULT_ENDPOINT = "http://127.0.0.1:8788";
export const DRAFT_FROM_SOURCE_PATH = "/v0/draft-from-source";
export const AUTHORING_HTTP_TIMEOUT_MS = 90_000;

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const HANDOFF_VERSIONS = new Set([
  "authoring_admission_handoff.v0.1",
  "authoring_admission_handoff.v0.2",
  "authoring_admission_handoff.v0.3",
  "authoring_admission_handoff.v0.4",
]);
const HANDOFF_KEYS = new Set([
  "schema_version",
  "producer",
  "authority_posture",
  "proposal_package",
  "evidence_bundle",
  "claim_map",
  "draft_proposal",
  "claim_support_assessment_set",
  "draft_completeness_binding",
  "handoff_digest",
]);

export interface DraftFromSourceOperatorInput {
  readonly acquisition: CaptureUrlCapturedResult;
  readonly operatorClaim: string;
  readonly subjectSeed?: string;
  readonly operatorObjective?: string;
}

export interface DraftFromSourceRequestWire {
  readonly subject_seed: string;
  readonly operator_objective: string;
  readonly candidates: readonly [{ readonly candidate_id: string; readonly url: string }];
  readonly selected_candidate_ids: readonly [string];
  readonly capture_ref: string;
  readonly claims: readonly [
    {
      readonly claim_id: string;
      readonly claim_text: string;
      readonly supports: readonly [];
      readonly contradicts: readonly [];
    },
  ];
  readonly coverage_requirements: readonly [];
  readonly coverage_assessments: readonly [];
  readonly conflicts: readonly [];
  readonly recipe: {
    readonly recipe_id: "browser-source-pitch";
    readonly output_profile: "counterpedia.standard.v1";
    readonly lead_policy_reference: "doctrine:authoring.proposal.v0.1";
    readonly recipe_version: "0.1.0";
    readonly desired_section_vocabulary: readonly [];
  };
  readonly depth: "brief";
}

export interface AuthoringHandoffProjection {
  readonly schema_version: string;
  readonly producer: "counterpedia-authoring";
  readonly authority_posture: "proposal_only";
  readonly proposal_package: Record<string, unknown>;
  readonly evidence_bundle: Record<string, unknown>;
  readonly claim_map: Record<string, unknown>;
  readonly draft_proposal: Record<string, unknown>;
  readonly claim_support_assessment_set?: unknown;
  readonly draft_completeness_binding?: unknown;
  readonly handoff_digest: string;
  /** Exact validated producer payload, retained for inspection/export. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export type AuthoringTransportFailureCode =
  | "unsafe_endpoint"
  | "invalid_operator_claim"
  | "timeout"
  | "network_error"
  | "http_error"
  | "invalid_response";

export class AuthoringTransportError extends Error {
  constructor(
    public readonly code: AuthoringTransportFailureCode,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "AuthoringTransportError";
  }
}

export interface AuthoringFetchOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new AuthoringTransportError("invalid_response", `${what} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthoringTransportError("invalid_response", `${what} must be a non-empty string`);
  }
  return value;
}

/** True only for an uncredentialed http:// loopback origin with no path/query/hash. */
export function isSafeAuthoringEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return (
      url.protocol === "http:" &&
      loopback &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function authoringEndpointFromManifest(manifest: Record<string, unknown>): string | null {
  if (manifest["_demo_mode"] !== true) return null;
  const endpoint = manifest["_authoring_endpoint"];
  return typeof endpoint === "string" && isSafeAuthoringEndpoint(endpoint) ? endpoint : null;
}

/**
 * Construct only operator-owned request material. Producer/runtime fields are
 * absent by construction except the one legitimate top-level capture_ref that
 * identifies the already-held acquisition attempt.
 */
export function buildDraftFromSourceRequest(
  input: DraftFromSourceOperatorInput,
): DraftFromSourceRequestWire {
  const claim = input.operatorClaim.trim();
  if (!claim) {
    throw new AuthoringTransportError(
      "invalid_operator_claim",
      "Draft from source requires an explicit operator-authored proposition",
    );
  }

  const sourceUrl = input.acquisition.source_locator;
  const titleSeed = input.subjectSeed?.trim() || new URL(sourceUrl).hostname;
  const candidateId = "src:browser-current";

  return {
    subject_seed: titleSeed,
    operator_objective:
      input.operatorObjective?.trim() ||
      "Produce a bounded proposal from the exact source bytes already captured by the operator.",
    candidates: [{ candidate_id: candidateId, url: sourceUrl }],
    selected_candidate_ids: [candidateId],
    capture_ref: input.acquisition.capture_id,
    claims: [
      {
        claim_id: "claim-browser-source",
        claim_text: claim,
        // Do not guess evidence handles before the producer constructs the real
        // EvidenceBundle. The downstream draft itself remains evidence-bound by
        // the authoring pipeline; this operator claim is carried without a fake
        // support edge rather than guessing evidence:E001.
        supports: [],
        contradicts: [],
      },
    ],
    coverage_requirements: [],
    coverage_assessments: [],
    conflicts: [],
    recipe: {
      recipe_id: "browser-source-pitch",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: [],
    },
    depth: "brief",
  };
}

/**
 * Validate the handoff's crossing boundary without reimplementing nested
 * authoring semantics. Known top-level fields only; exact producer/posture;
 * required materialized components; canonical digest shape. The exact raw
 * payload is retained rather than reconstructed by the UI.
 */
export function validateAuthoringHandoff(input: unknown): AuthoringHandoffProjection {
  const payload = requireObject(input, "AuthoringAdmissionHandoff");
  for (const key of Object.keys(payload)) {
    if (!HANDOFF_KEYS.has(key)) {
      throw new AuthoringTransportError(
        "invalid_response",
        `AuthoringAdmissionHandoff contains unknown field ${JSON.stringify(key)}`,
      );
    }
  }

  const schemaVersion = requireNonEmptyString(payload["schema_version"], "schema_version");
  if (!HANDOFF_VERSIONS.has(schemaVersion)) {
    throw new AuthoringTransportError("invalid_response", "unsupported authoring handoff version");
  }
  if (payload["producer"] !== "counterpedia-authoring") {
    throw new AuthoringTransportError("invalid_response", "unexpected authoring producer");
  }
  if (payload["authority_posture"] !== "proposal_only") {
    throw new AuthoringTransportError(
      "invalid_response",
      "authoring response attempted to widen proposal-only posture",
    );
  }

  const handoffDigest = requireNonEmptyString(payload["handoff_digest"], "handoff_digest");
  if (!SHA256_RE.test(handoffDigest)) {
    throw new AuthoringTransportError("invalid_response", "handoff_digest is malformed");
  }

  const projection: AuthoringHandoffProjection = {
    schema_version: schemaVersion,
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: requireObject(payload["proposal_package"], "proposal_package"),
    evidence_bundle: requireObject(payload["evidence_bundle"], "evidence_bundle"),
    claim_map: requireObject(payload["claim_map"], "claim_map"),
    draft_proposal: requireObject(payload["draft_proposal"], "draft_proposal"),
    handoff_digest: handoffDigest,
    raw: Object.freeze({ ...payload }),
  };
  if (Object.prototype.hasOwnProperty.call(payload, "claim_support_assessment_set")) {
    projection.claim_support_assessment_set = payload["claim_support_assessment_set"];
  }
  if (Object.prototype.hasOwnProperty.call(payload, "draft_completeness_binding")) {
    projection.draft_completeness_binding = payload["draft_completeness_binding"];
  }
  return projection;
}

export async function draftFromCapturedSource(
  input: DraftFromSourceOperatorInput,
  options: AuthoringFetchOptions = {},
): Promise<AuthoringHandoffProjection> {
  const endpoint = options.endpoint ?? AUTHORING_DEFAULT_ENDPOINT;
  if (!isSafeAuthoringEndpoint(endpoint)) {
    throw new AuthoringTransportError("unsafe_endpoint", "Authoring endpoint is not loopback http");
  }

  const body = buildDraftFromSourceRequest(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? AUTHORING_HTTP_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoint}${DRAFT_FROM_SOURCE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new AuthoringTransportError("timeout", "Draft-from-source request timed out");
      }
      throw new AuthoringTransportError("network_error", "Local authoring transport is unavailable");
    }

    if (!response.ok) {
      throw new AuthoringTransportError(
        "http_error",
        `Local authoring returned HTTP ${response.status}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthoringTransportError("invalid_response", "Local authoring returned non-JSON data");
    }
    return validateAuthoringHandoff(payload);
  } finally {
    clearTimeout(timeout);
  }
}
