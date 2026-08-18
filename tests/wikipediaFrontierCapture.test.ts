import { describe, expect, it } from "vitest";

import {
  buildWikipediaCaptureRun,
  captureWikipediaFrontierUrl,
  parseWikipediaReferenceFrontier,
} from "../src/lib/wikipediaFrontierCapture";

const URL = "https://example.com/source";

function frontier() {
  return {
    schema_version: "counterpedia.wikipedia_reference_frontier.v0.1",
    created_at: "2026-08-18T07:30:00Z",
    page: {
      wiki_host: "en.wikipedia.org",
      title: "Theranos",
      revision_id: 123456,
      canonical_url: "https://en.wikipedia.org/wiki/Theranos",
    },
    selected_sources: [{ url: URL, status: "NEW" }],
    authority_posture: "discovery_only",
    acquisition_state: "not_attempted",
    admission: "not_performed",
  };
}

function capturedResult(sourceLocator = URL) {
  return {
    tool: "acquisition.capture_url",
    surface_schema: "acquisition.mcp_surface.v0.1",
    capture_status: "captured",
    capture_id: "cap_test",
    source_id: "src_test",
    source_locator: sourceLocator,
    captured_object_address: "sha256:" + "a".repeat(64),
    byte_count: 123,
    failure_detail: null,
    capture_receipt: {
      capture_id: "cap_test",
      source_id: "src_test",
      source_locator: sourceLocator,
      captured_at: "2026-08-18T07:31:00Z",
      http_metadata: null,
      exact_bytes_sha256: "sha256:" + "a".repeat(64),
      byte_count: 123,
      schema_version: "acquisition.capture.v0.1",
    },
  };
}

function fetchReturning(payload: unknown, status = 200): typeof fetch {
  return (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    }) as Response) as typeof fetch;
}

describe("Wikipedia discovery frontier reader", () => {
  it("accepts only the immutable discovery-only NEW-source frontier", () => {
    const parsed = parseWikipediaReferenceFrontier(frontier());
    expect(parsed.acquisition_state).toBe("not_attempted");
    expect(parsed.selected_sources).toEqual([{ url: URL, status: "NEW" }]);
  });

  it("refuses authority or non-NEW widening", () => {
    expect(() =>
      parseWikipediaReferenceFrontier({ ...frontier(), admission: "performed" }),
    ).toThrow(/admission/);
    expect(() =>
      parseWikipediaReferenceFrontier({
        ...frontier(),
        selected_sources: [{ url: URL, status: "KNOWN" }],
      }),
    ).toThrow(/status/);
  });
});

describe("Wikipedia frontier explicit capture", () => {
  it("consumes only the existing acquisition.capture_url producer projection", async () => {
    const result = await captureWikipediaFrontierUrl(URL, fetchReturning(capturedResult()));
    expect(result.tool).toBe("acquisition.capture_url");
    expect(result.surface_schema).toBe("acquisition.mcp_surface.v0.1");
    expect(result.capture_status).toBe("captured");
  });

  it("fails closed if the producer result points at a different locator", async () => {
    await expect(
      captureWikipediaFrontierUrl(
        URL,
        fetchReturning(capturedResult("https://example.com/other")),
      ),
    ).rejects.toThrow(/source_locator_mismatch/);
  });

  it("records a separate capture run without mutating discovery posture", () => {
    const parsedFrontier = parseWikipediaReferenceFrontier(frontier());
    const producerResult = {
      ...capturedResult(),
      capture_status: "captured" as const,
    };
    const run = buildWikipediaCaptureRun(parsedFrontier, [producerResult], {
      now: () => "2026-08-18T07:32:00Z",
      makeId: () => "run:test",
    });

    expect(parsedFrontier.acquisition_state).toBe("not_attempted");
    expect(run.authority_posture).toBe("capture_receipt_projection_only");
    expect(run.admission).toBe("not_performed");
    expect(run.attempts[0]).toEqual({
      url: URL,
      capture_status: "captured",
      capture_id: "cap_test",
      source_id: "src_test",
      source_locator: URL,
      captured_object_address: "sha256:" + "a".repeat(64),
      byte_count: 123,
      failure_detail: null,
    });
    expect(run.attempts[0]).not.toHaveProperty("capture_receipt");
  });
});
