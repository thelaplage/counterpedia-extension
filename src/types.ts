/**
 * Shared types for the Counterpedia Chrome extension.
 */

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

export interface TabChangedMessage {
  type: "TAB_CHANGED";
  url: string;
}

export interface CheckSelectionMessage {
  type: "CHECK_SELECTION";
  text: string;
}

export interface ClearMessage {
  type: "CLEAR";
}

export interface CapturePageMessage {
  type: "CAPTURE_PAGE";
}

export type ExtensionMessage =
  | TabChangedMessage
  | CheckSelectionMessage
  | ClearMessage
  | CapturePageMessage;

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

export interface SearchResult {
  record_id: string;
  record_url: string;
  title: string;
  subtitle?: string;
  corpus_posture: string;
  corpus_posture_label: string;
  edition: string;
  supported_proposition: string | null;
  source_count: number;
  top_source_labels: string[];
  why_not_summary: string | null;
  refusal_count: number;
  has_changes: boolean;
  change_count: number;
  verification_posture: "receipt_present" | "reports_present" | "none";
  verification_tokens: string[];
}

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------

export type PanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: SearchResult[]; query: string }
  | { kind: "no_match"; query: string }
  | { kind: "restricted" }
  | { kind: "unavailable" }
  | { kind: "rate_limited" };
