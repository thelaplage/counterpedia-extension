/**
 * CHECK-TRACE0 — session-scoped topology of an inquiry.
 *
 * This is intentionally NOT Amnesiac memory. It preserves enough current-session
 * state to make suggested, selected, and not-selected paths legible without
 * pretending browser UI telemetry has been admitted as durable memory.
 */

import type { InquiryPathSuggestion } from "./inquiryPaths";

export type InquiryTraceEventKind =
  | "check_started"
  | "path_selected"
  | "path_deselected";

export interface InquiryTraceEvent {
  kind: InquiryTraceEventKind;
  at: string;
  pathId: string | null;
  pathLabel: string | null;
}

export interface InquiryTraceSession {
  inquiryId: string;
  query: string;
  startedAt: string;
  recordIds: string[];
  suggestions: InquiryPathSuggestion[];
  selectedPathIds: Set<string>;
  events: InquiryTraceEvent[];
}

export interface InquiryTraceProjection {
  inquiryId: string;
  query: string;
  selectedPaths: InquiryPathSuggestion[];
  notSelectedPaths: InquiryPathSuggestion[];
  events: InquiryTraceEvent[];
}

export function startInquiryTrace(input: {
  inquiryId: string;
  query: string;
  startedAt: string;
  recordIds: string[];
  suggestions: InquiryPathSuggestion[];
}): InquiryTraceSession {
  return {
    inquiryId: input.inquiryId,
    query: input.query,
    startedAt: input.startedAt,
    recordIds: [...input.recordIds],
    suggestions: [...input.suggestions],
    selectedPathIds: new Set<string>(),
    events: [
      {
        kind: "check_started",
        at: input.startedAt,
        pathId: null,
        pathLabel: null,
      },
    ],
  };
}

export function recordPathSelection(
  session: InquiryTraceSession,
  input: { pathId: string; selected: boolean; at: string },
): InquiryTraceSession {
  const path = session.suggestions.find((candidate) => candidate.id === input.pathId);
  if (!path) return session;

  const selectedPathIds = new Set(session.selectedPathIds);
  if (input.selected) selectedPathIds.add(path.id);
  else selectedPathIds.delete(path.id);

  return {
    ...session,
    selectedPathIds,
    events: [
      ...session.events,
      {
        kind: input.selected ? "path_selected" : "path_deselected",
        at: input.at,
        pathId: path.id,
        pathLabel: path.label,
      },
    ],
  };
}

export function projectInquiryTrace(
  session: InquiryTraceSession,
): InquiryTraceProjection {
  return {
    inquiryId: session.inquiryId,
    query: session.query,
    selectedPaths: session.suggestions.filter((path) =>
      session.selectedPathIds.has(path.id),
    ),
    notSelectedPaths: session.suggestions.filter(
      (path) => !session.selectedPathIds.has(path.id),
    ),
    events: [...session.events],
  };
}
