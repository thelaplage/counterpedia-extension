import { describe, expect, it } from "vitest";

import type { CaptureUrlCapturedResult } from "../src/lib/acquisitionTransport";
import {
  AuthoringTransportError,
  buildDraftFromSourceRequest,
  draftFromCapturedSource,
  isSafeAuthoringEndpoint,
  validateAuthoringHandoff,
} from "../src/lib/authoringTransport";

const ACQUISITION: CaptureUrlCapturedResult = {
  tool: "acquisition.capture_url",
  surface_schema: "acquisition.mcp_surface.v0.1",
  capture_status: "captured",
  capture_receipt: {
    capture_id: "cap_pitch_exact_001",
    source_id: "src_pitch_exact_001",
    source_locator: "https://example.com/report",
    captured_at: "2026-08-27T00:00:00Z",
    http_metadata: null,
    exact_bytes_sha256: `sha256:${"a".repeat(64)}`,
    byte_count: 123,
    schema_version: "acquisition.capture.v0.1",
  },
  capture_id: "cap_pitch_exact_001",
  source_id: "src_pitch_exact_001",
  source_locator: "https://example.com/report",
  captured_object_address: `sha256:${"a".repeat(64)}`,
  byte_count: 123,
  failure_detail: null,
};

function handoff(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "authoring_admission_handoff.v0.4",
    producer: "counterpedia-authoring",
    authority_posture: "proposal_only",
    proposal_package: { package_id: "pkg-pitch", package_digest: `sha256:${"b".repeat(64)}` },
    evidence_bundle: { bundle_id: "bundle-pitch", bundle_digest: `sha256:${"c".repeat(64)}` },
    claim_map: { claim_map_id: "claim-map-pitch", claim_map_digest: `sha256:${"d".repeat(64)}` },
    draft_proposal: { proposal_id: "draft-pitch", proposal_body_digest: `sha256:${"e".repeat(64)}` },
    claim_support_assessment_set: null,
    draft_completeness_binding: { binding_id: "completeness-pitch" },
    handoff_digest: `sha256:${"f".repeat(64)}`,
    ...overrides,
  };
}

describe("Draft-from-source request composition", () => {
  it("carries the exact historical capture_ref and operator claim without guessing evidence handles", () => {
    const request = buildDraftFromSourceRequest({
      acquisition: ACQUISITION,
      operatorClaim: "The filing states the bounded proposition under review.",
      subjectSeed: "Pitch source",
    });

    expect(request.capture_ref).toBe(ACQUISITION.capture_id);
    expect(request.candidates).toEqual([
      { candidate_id: "src:browser-current", url: ACQUISITION.source_locator },
    ]);
    expect(request.selected_candidate_ids).toEqual(["src:browser-current"]);
    expect(request.claims[0].claim_text).toBe(
      "The filing states the bounded proposition under review.",
    );
    expect(request.claims[0].supports).toEqual([]);
    expect(request.claims[0].contradicts).toEqual([]);

    const serialized = JSON.stringify(request);
    for (const forbidden of [
      "browser_page_capture",
      "main_text",
      "rendered_text",
      "selected_text",
      "exact_bytes_sha256",
      "authority_posture",
      "standing",
      "published_at",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("refuses to synthesize a claim when the operator supplied no proposition", () => {
    expect(() =>
      buildDraftFromSourceRequest({ acquisition: ACQUISITION, operatorClaim: "   " }),
    ).toThrowError(AuthoringTransportError);
  });
});

describe("Authoring handoff boundary validation", () => {
  it("accepts the known producer/proposal-only crossing and retains exact raw payload", () => {
    const raw = handoff();
    const result = validateAuthoringHandoff(raw);
    expect(result.producer).toBe("counterpedia-authoring");
    expect(result.authority_posture).toBe("proposal_only");
    expect(result.handoff_digest).toBe(raw["handoff_digest"]);
    expect(result.raw["proposal_package"]).toEqual(raw["proposal_package"]);
  });

  it("fails closed if a server attempts to widen proposal-only posture", () => {
    expect(() => validateAuthoringHandoff(handoff({ authority_posture: "admitted" }))).toThrow(
      /proposal-only posture/,
    );
  });

  it("fails closed on unknown top-level fields", () => {
    expect(() => validateAuthoringHandoff(handoff({ verified: true }))).toThrow(/unknown field/);
  });

  it("fails closed on malformed handoff digest", () => {
    expect(() => validateAuthoringHandoff(handoff({ handoff_digest: "sha256:bad" }))).toThrow(
      /malformed/,
    );
  });
});

describe("Authoring localhost transport", () => {
  it("accepts only uncredentialed plain-http loopback origins", () => {
    expect(isSafeAuthoringEndpoint("http://127.0.0.1:8788")).toBe(true);
    expect(isSafeAuthoringEndpoint("http://localhost:8788")).toBe(true);
    expect(isSafeAuthoringEndpoint("https://127.0.0.1:8788")).toBe(false);
    expect(isSafeAuthoringEndpoint("http://example.com:8788")).toBe(false);
    expect(isSafeAuthoringEndpoint("http://user:pass@127.0.0.1:8788")).toBe(false);
    expect(isSafeAuthoringEndpoint("http://127.0.0.1:8788/path")).toBe(false);
  });

  it("POSTs the exact source action and validates the producer handoff", async () => {
    let seenUrl = "";
    let seenBody: unknown = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(handoff()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await draftFromCapturedSource(
      { acquisition: ACQUISITION, operatorClaim: "Operator-authored bounded claim." },
      { endpoint: "http://127.0.0.1:8788", fetchImpl },
    );

    expect(seenUrl).toBe("http://127.0.0.1:8788/v0/draft-from-source");
    expect((seenBody as Record<string, unknown>)["capture_ref"]).toBe(ACQUISITION.capture_id);
    expect(result.authority_posture).toBe("proposal_only");
  });

  it("does not fabricate a proposal on producer HTTP refusal", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "source_basis_unresolved" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });

    await expect(
      draftFromCapturedSource(
        { acquisition: ACQUISITION, operatorClaim: "Operator-authored bounded claim." },
        { endpoint: "http://127.0.0.1:8788", fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "http_error", httpStatus: 422 });
  });
});