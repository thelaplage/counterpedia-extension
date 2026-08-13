/**
 * AUTHOR-HTTP response guard (client-side allow-list).
 *
 * The localhost authoring producer already validates and digest-seals its own
 * `AuthoringAdmissionHandoff`, but the extension MUST NOT trust a response merely
 * because it arrived from localhost. This guard is the client-side half of the
 * defense-in-depth: it fails closed on any response that is not EXACTLY the
 * authorized proposal-only handoff projection.
 *
 * It is deliberately dumb about authoring semantics — it carries the producer's
 * metadata-only handoff and refuses anything that tries to smuggle epistemic
 * authority (admission / standing / publication / verification / ratification)
 * into the client, or that presents a draft as anything other than a proposal.
 * No Chrome APIs; pure and fully unit-testable.
 *
 * Modeled on `acquisitionResponseGuard.ts` (same recursive-forbidden-key
 * pattern). The forbidden set uses EXACT key matching (not substring) so it
 * never false-positives on legitimate producer metadata that merely echoes a
 * source id or digest inside the handoff's own body.
 */

/** Lifecycle values a draft may ever carry. Never admitted/published. */
export type DraftLifecycle = "proposal" | "draft";

/**
 * The authorized response projection. This mirrors the producer-owned
 * `AuthoringAdmissionHandoff` contract (`counterpedia-authoring` →
 * `contracts/admission_handoff.py`); the extension consumes it, it does not
 * become a second schema authority. The four component payloads
 * (`proposal_package` / `evidence_bundle` / `claim_map` / `draft_proposal`) are
 * kept as opaque guarded objects: the client never re-types or re-canonicalizes
 * the producer's digest-sealed components. `draft_proposal.lifecycle` is the one
 * field pinned, because it is the proposal-only boundary.
 */
export interface AuthoringHandoff {
  schema_version: string;
  producer: "counterpedia-authoring";
  authority_posture: "proposal_only";
  proposal_package: Record<string, unknown>;
  evidence_bundle: Record<string, unknown>;
  claim_map: Record<string, unknown>;
  draft_proposal: { lifecycle: DraftLifecycle } & Record<string, unknown>;
  handoff_digest: string;
}

/** Raised when a response is not exactly the authorized proposal-only handoff. */
export class AuthoringResponseError extends Error {
  constructor(reason: string) {
    super(`authoring response rejected: ${reason}`);
    this.name = "AuthoringResponseError";
  }
}

/** Exactly the allowed top-level keys. Any other key fails the response closed. */
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "producer",
  "authority_posture",
  "proposal_package",
  "evidence_bundle",
  "claim_map",
  "draft_proposal",
  "handoff_digest",
]);

/**
 * Governance/authority keys that must never appear ANYWHERE in a handoff
 * response. Their presence (at any nesting depth) marks a contaminated response
 * that is trying to promote a proposal into an admitted/published/verified
 * record. EXACT key match: this is a set of field NAMES, so `authority_posture`
 * (allowed, and required) is never confused with a bare `authority` field.
 */
const FORBIDDEN_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "standing",
  "standing_grant",
  "admitted",
  "admission",
  "admission_result",
  "admission_status",
  "admissiondecision",
  "admitted_at",
  "admitted_by",
  "published",
  "publication",
  "publish",
  "published_at",
  "verified",
  "verification",
  "signature_verified",
  "authenticity_verified",
  "ratified",
  "ratified_by",
  "approved_by",
  "support_type",
  "governance_state",
  "claim_support_edge",
  "claimsupportedge",
  "authority",
  "authorized",
  "cp_authority",
]);

/**
 * Keys that carry a lifecycle value. Wherever one appears (at any depth), its
 * value MUST be a proposal-only lifecycle. This catches a contaminated nested
 * `lifecycle: "admitted"` even inside a component payload.
 */
const LIFECYCLE_BEARING_KEYS: ReadonlySet<string> = new Set([
  "lifecycle",
  "draft_lifecycle",
]);

const ALLOWED_LIFECYCLES: ReadonlySet<string> = new Set(["proposal", "draft"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Recursively assert (a) no forbidden authority key appears at any depth, and
 * (b) every lifecycle-bearing key holds a proposal-only value.
 */
function assertNoForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_AUTHORITY_KEYS.has(lower)) {
      throw new AuthoringResponseError(
        `contaminated with authority-bearing field '${key}' at ${path}`,
      );
    }
    if (LIFECYCLE_BEARING_KEYS.has(lower)) {
      if (typeof child !== "string" || !ALLOWED_LIFECYCLES.has(child)) {
        throw new AuthoringResponseError(
          `lifecycle field '${key}' at ${path} is not proposal-only (got ${JSON.stringify(child)})`,
        );
      }
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function requireObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const v = obj[key];
  if (!isPlainObject(v)) {
    throw new AuthoringResponseError(`field '${key}' must be a JSON object`);
  }
  return v;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new AuthoringResponseError(`field '${key}' must be a non-empty string`);
  }
  return v;
}

/**
 * Parse and validate a raw authoring response, failing closed.
 *
 * @throws AuthoringResponseError on any deviation from the authorized
 *   proposal-only handoff projection.
 */
export function parseAuthoringHandoff(raw: unknown): AuthoringHandoff {
  if (!isPlainObject(raw)) {
    throw new AuthoringResponseError("response is not a JSON object");
  }

  // (1) Exact allow-list: no unknown top-level keys.
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new AuthoringResponseError(`unknown top-level field '${key}'`);
    }
  }

  // (2) No authority-bearing key anywhere, and every lifecycle value is
  //     proposal-only (incl. inside the component payloads).
  assertNoForbiddenKeys(raw, "$");

  // (3) Pin the two frozen literals: proposal_only posture, authoring producer.
  if (raw["authority_posture"] !== "proposal_only") {
    throw new AuthoringResponseError(
      `authority_posture must be exactly 'proposal_only'`,
    );
  }
  if (raw["producer"] !== "counterpedia-authoring") {
    throw new AuthoringResponseError(
      `producer must be exactly 'counterpedia-authoring'`,
    );
  }

  // (4) Structural top-level fields.
  const schemaVersion = requireString(raw, "schema_version");
  const handoffDigest = requireString(raw, "handoff_digest");
  const proposalPackage = requireObject(raw, "proposal_package");
  const evidenceBundle = requireObject(raw, "evidence_bundle");
  const claimMap = requireObject(raw, "claim_map");
  const draftProposal = requireObject(raw, "draft_proposal");

  // (5) The proposal-only boundary: the draft's own lifecycle must be present
  //     and proposal-only. (assertNoForbiddenKeys already validated any nested
  //     lifecycle value; this makes the draft's presence a hard requirement.)
  const lifecycle = draftProposal["lifecycle"];
  if (typeof lifecycle !== "string" || !ALLOWED_LIFECYCLES.has(lifecycle)) {
    throw new AuthoringResponseError(
      `draft_proposal.lifecycle must be 'proposal' or 'draft'`,
    );
  }

  return {
    schema_version: schemaVersion,
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: proposalPackage,
    evidence_bundle: evidenceBundle,
    claim_map: claimMap,
    draft_proposal: { ...draftProposal, lifecycle: lifecycle as DraftLifecycle },
    handoff_digest: handoffDigest,
  };
}

/** Non-throwing variant: returns null instead of raising. */
export function tryParseAuthoringHandoff(raw: unknown): AuthoringHandoff | null {
  try {
    return parseAuthoringHandoff(raw);
  } catch (err) {
    if (err instanceof AuthoringResponseError) return null;
    throw err;
  }
}
