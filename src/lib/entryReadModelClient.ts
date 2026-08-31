import type { AuthoringHandoff } from "./authoringResponseGuard";

export const COUNTERPEDIA_PROPOSAL_READER_URL =
  "http://127.0.0.1:3000/api/counterpedia/reader/proposal";

export interface ProposalReaderContentBlock {
  readonly id?: string;
  readonly kind: "paragraph" | "list";
  readonly text?: string;
  readonly items?: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly note?: string;
}

export interface ProposalReaderSection {
  readonly id?: string;
  readonly title: string;
  readonly blocks: readonly ProposalReaderContentBlock[];
  readonly support:
    | { readonly state: "supported" }
    | { readonly state: "unsupported"; readonly reason: string }
    | { readonly state: "not_evaluated" };
}

export interface ProposalReaderClaim {
  readonly id?: string;
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  readonly requiresHumanReview?: boolean;
  readonly sourceClass?: string;
  readonly confidenceNote?: string;
}

export interface ProposalReaderLinkSuggestion {
  readonly anchorText: string;
  readonly pageSuggestion: string;
  readonly evidenceRef?: string;
  readonly note?: string;
}

export interface ProposalReaderReviewGap {
  readonly label: string;
  readonly reason: string;
  readonly suggestedEvidenceKinds?: readonly string[];
}

export interface ProposalReaderEntry {
  readonly entryId: string;
  readonly title: string;
  readonly summary: string;
  readonly posture: "proposal";
  readonly sourceKind: "authoring_proposal";
  readonly lifecycle?: "proposal" | "draft";
  readonly leadBlocks?: readonly ProposalReaderContentBlock[];
  readonly articleSections?: readonly ProposalReaderSection[];
  readonly articleClaims?: readonly ProposalReaderClaim[];
  readonly linkSuggestions?: readonly ProposalReaderLinkSuggestion[];
  readonly review?: {
    readonly gaps: readonly ProposalReaderReviewGap[];
    readonly openQuestions: readonly string[];
  };
  readonly sections: {
    readonly provenance?: readonly {
      readonly family: string;
      readonly detail: Readonly<Record<string, unknown>>;
    }[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function validBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] !== "paragraph" && value["kind"] !== "list") return false;
  if (!optionalString(value["id"]) || !optionalString(value["text"]) || !optionalString(value["note"])) return false;
  if (value["items"] !== undefined && !isStringArray(value["items"])) return false;
  return isStringArray(value["evidenceRefs"]);
}

function validSupport(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["state"] === "supported" || value["state"] === "not_evaluated") return true;
  return value["state"] === "unsupported" && typeof value["reason"] === "string";
}

function validSection(value: unknown): boolean {
  if (!isRecord(value) || typeof value["title"] !== "string") return false;
  if (!Array.isArray(value["blocks"]) || !value["blocks"].every(validBlock)) return false;
  return validSupport(value["support"]);
}

function validClaim(value: unknown): boolean {
  if (!isRecord(value) || typeof value["text"] !== "string") return false;
  if (!isStringArray(value["evidenceRefs"])) return false;
  if (!optionalString(value["id"]) || !optionalString(value["sourceClass"]) || !optionalString(value["confidenceNote"])) return false;
  return value["requiresHumanReview"] === undefined || typeof value["requiresHumanReview"] === "boolean";
}

function validLink(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value["anchorText"] === "string" &&
    typeof value["pageSuggestion"] === "string" &&
    optionalString(value["evidenceRef"]) &&
    optionalString(value["note"])
  );
}

function validGap(value: unknown): boolean {
  if (!isRecord(value) || typeof value["label"] !== "string" || typeof value["reason"] !== "string") return false;
  return value["suggestedEvidenceKinds"] === undefined || isStringArray(value["suggestedEvidenceKinds"]);
}

/**
 * Consumer-side structural guard for the Counterpedia-owned proposal read
 * model. It validates only the fields this compact surface consumes and allows
 * additive unknown fields; semantic ownership remains in Counterpedia.
 */
export function parseProposalReaderEntry(raw: unknown): ProposalReaderEntry {
  if (!isRecord(raw)) throw new Error("proposal reader entry must be an object");
  if (
    typeof raw["entryId"] !== "string" ||
    typeof raw["title"] !== "string" ||
    typeof raw["summary"] !== "string" ||
    raw["posture"] !== "proposal" ||
    raw["sourceKind"] !== "authoring_proposal"
  ) {
    throw new Error("proposal reader entry failed identity/posture validation");
  }
  if (
    raw["lifecycle"] !== undefined &&
    raw["lifecycle"] !== "proposal" &&
    raw["lifecycle"] !== "draft"
  ) {
    throw new Error("proposal reader entry has invalid lifecycle");
  }
  if (raw["leadBlocks"] !== undefined && (!Array.isArray(raw["leadBlocks"]) || !raw["leadBlocks"].every(validBlock))) {
    throw new Error("proposal reader entry has invalid lead blocks");
  }
  if (raw["articleSections"] !== undefined && (!Array.isArray(raw["articleSections"]) || !raw["articleSections"].every(validSection))) {
    throw new Error("proposal reader entry has invalid article sections");
  }
  if (raw["articleClaims"] !== undefined && (!Array.isArray(raw["articleClaims"]) || !raw["articleClaims"].every(validClaim))) {
    throw new Error("proposal reader entry has invalid article claims");
  }
  if (raw["linkSuggestions"] !== undefined && (!Array.isArray(raw["linkSuggestions"]) || !raw["linkSuggestions"].every(validLink))) {
    throw new Error("proposal reader entry has invalid link suggestions");
  }
  if (raw["review"] !== undefined) {
    if (!isRecord(raw["review"])) throw new Error("proposal reader entry has invalid review");
    if (!Array.isArray(raw["review"]["gaps"]) || !raw["review"]["gaps"].every(validGap)) {
      throw new Error("proposal reader entry has invalid review gaps");
    }
    if (!isStringArray(raw["review"]["openQuestions"])) {
      throw new Error("proposal reader entry has invalid open questions");
    }
  }
  if (!isRecord(raw["sections"])) throw new Error("proposal reader entry has invalid sections");
  return raw as unknown as ProposalReaderEntry;
}

export async function projectAuthoringHandoffToReaderEntry(
  handoff: AuthoringHandoff,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ProposalReaderEntry> {
  const response = await fetchImpl(COUNTERPEDIA_PROPOSAL_READER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handoff),
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Counterpedia proposal projection unavailable (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !("entry" in payload)) {
    throw new Error("Counterpedia proposal projection returned an invalid envelope");
  }
  return parseProposalReaderEntry(payload["entry"]);
}
