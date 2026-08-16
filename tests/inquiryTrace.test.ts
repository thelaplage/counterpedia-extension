import { describe, expect, it } from "vitest";
import type { InquiryPathSuggestion } from "../src/lib/inquiryPaths";
import { PUBLIC_COUNTERPEDIA_PATH_PROVIDER } from "../src/lib/pathProviderContract";
import {
  projectInquiryTrace,
  recordPathSelection,
  startInquiryTrace,
} from "../src/lib/inquiryTrace";

const paths: InquiryPathSuggestion[] = [
  {
    id: "counterpedia.public::record-topic:sampling",
    label: "Sampling technology",
    kind: "record_topic",
    provenance: {
      provider: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
      domain: "Public Counterpedia",
      basis: "record_title",
      explanation: "Matched title",
      recordIds: ["REC-1"],
      recordTitles: ["Sampling technology"],
    },
  },
  {
    id: "counterpedia.public::record-topic:labels",
    label: "Record-label economics",
    kind: "record_topic",
    provenance: {
      provider: PUBLIC_COUNTERPEDIA_PATH_PROVIDER,
      domain: "Public Counterpedia",
      basis: "record_title",
      explanation: "Matched title",
      recordIds: ["REC-2"],
      recordTitles: ["Record-label economics"],
    },
  },
];

describe("inquiry trace", () => {
  it("preserves suggested but not-selected paths without calling them refused", () => {
    const session = startInquiryTrace({
      inquiryId: "inq-1",
      query: "hip-hop production",
      startedAt: "2026-08-16T04:00:00.000Z",
      recordIds: ["REC-1", "REC-2"],
      suggestions: paths,
    });
    const p = projectInquiryTrace(session);
    expect(p.selectedPaths).toHaveLength(0);
    expect(p.notSelectedPaths.map((path) => path.label)).toEqual([
      "Sampling technology",
      "Record-label economics",
    ]);
    expect(p.events.map((event) => event.kind)).toEqual(["check_started"]);
  });

  it("records the reversible topology of path selection", () => {
    let session = startInquiryTrace({
      inquiryId: "inq-1",
      query: "hip-hop production",
      startedAt: "2026-08-16T04:00:00.000Z",
      recordIds: ["REC-1", "REC-2"],
      suggestions: paths,
    });
    session = recordPathSelection(session, {
      pathId: paths[0]!.id,
      selected: true,
      at: "2026-08-16T04:01:00.000Z",
    });
    expect(projectInquiryTrace(session).selectedPaths[0]?.label).toBe(
      "Sampling technology",
    );
    session = recordPathSelection(session, {
      pathId: paths[0]!.id,
      selected: false,
      at: "2026-08-16T04:02:00.000Z",
    });
    const p = projectInquiryTrace(session);
    expect(p.selectedPaths).toHaveLength(0);
    expect(p.notSelectedPaths).toHaveLength(2);
    expect(p.events.map((event) => event.kind)).toEqual([
      "check_started",
      "path_selected",
      "path_deselected",
    ]);
  });

  it("ignores a selection for a path that was never suggested", () => {
    const session = startInquiryTrace({
      inquiryId: "inq-1",
      query: "query",
      startedAt: "2026-08-16T04:00:00.000Z",
      recordIds: ["REC-1"],
      suggestions: paths,
    });
    const next = recordPathSelection(session, {
      pathId: "unknown",
      selected: true,
      at: "2026-08-16T04:01:00.000Z",
    });
    expect(next).toBe(session);
  });
});
