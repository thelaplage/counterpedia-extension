/**
 * AUTHOR-HTTP client tests — custody firewall + honest selection + guarded I/O.
 *
 * The load-bearing proof here is the CUSTODY one: the request the client builds
 * from a governed source + operator material carries ONLY the source URL and the
 * operator's verbatim claims — never a producer-owned acquisition fact
 * (capture_id / source_id / capture_receipt / captured_object_address / byte
 * digest). The request builder is structurally incapable of copying those,
 * because its only source input is a bare URL string.
 */

import { describe, it, expect } from "vitest";

import {
  buildDraftFromSourceRequest,
  createHttpAuthoringClient,
  selectAuthoringClient,
  notConfiguredAuthoringClient,
  TRANSPORT_TOKEN_HEADER,
  type OperatorDraftMaterial,
} from "../src/lib/authoringClient";
import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";

const SOURCE_URL = "http://127.0.0.1:9/page";

function material(): OperatorDraftMaterial {
  return {
    subjectSeed: "Portland Head Light",
    operatorObjective: "Produce a bounded proposal describing Portland Head Light.",
    candidateId: "operator-governed-source-1",
    claims: [
      {
        claim_id: "claim-operator-1",
        claim_text: "The subject is known as Portland Head Light.",
        supports: [{ evidence_refs: ["evidence:E001"] }],
        contradicts: [],
      },
    ],
    coverageRequirements: [
      { requirement_id: "req-core", label: "Core", description: "d" },
    ],
    coverageAssessments: [
      {
        requirement_id: "req-core",
        state: "sufficient_candidate_support",
        supporting_claim_ids: ["claim-operator-1"],
        conflicting_claim_ids: [],
      },
    ],
    recipe: {
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    },
    depth: "brief",
  };
}

/**
 * A guarded acquisition result that is DELIBERATELY full of producer-owned facts,
 * so a "no copy" assertion is meaningful: if the client copied any of these into
 * the request, the recursive scan below would catch it.
 */
function capturedResult(): AcquisitionCaptureResult {
  return {
    tool: "capture_url",
    surface_schema: "acquisition.capture_url.v0.1",
    capture_status: "captured",
    capture_id: "cap-PRODUCER-OWNED-id",
    source_id: "src-PRODUCER-OWNED-id",
    source_locator: SOURCE_URL,
    captured_object_address: "sha256:" + "a".repeat(64),
    byte_count: 1234,
    failure_detail: null,
    capture_receipt: {
      exact_bytes_sha256: "sha256:" + "b".repeat(64),
      capture_id: "cap-PRODUCER-OWNED-id",
    },
  };
}

/** Recursively collect all keys + all string values from a JSON tree. */
function collect(node: unknown, keys: Set<string>, vals: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, keys, vals));
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      keys.add(k);
      collect(v, keys, vals);
    }
  } else if (typeof node === "string") {
    vals.add(node);
  }
}

describe("buildDraftFromSourceRequest — custody firewall", () => {
  it("carries the governed URL and the operator's verbatim claims only", () => {
    const req = buildDraftFromSourceRequest(SOURCE_URL, material());
    expect(req.candidates).toEqual([
      { candidate_id: "operator-governed-source-1", url: SOURCE_URL },
    ]);
    expect(req.selected_candidate_ids).toEqual(["operator-governed-source-1"]);
    // Operator claims pass through verbatim.
    expect(req.claims).toEqual(material().claims);
    expect(req.subject_seed).toBe("Portland Head Light");
    expect(req.depth).toBe("brief");
  });

  it("copies NO producer-owned field name into the request tree", () => {
    const req = buildDraftFromSourceRequest(SOURCE_URL, material());
    const keys = new Set<string>();
    const vals = new Set<string>();
    collect(req, keys, vals);
    for (const forbidden of [
      "capture_id",
      "source_id",
      "capture_receipt",
      "captured_object_address",
      "capture_digest",
      "content_digest",
      "source_locator",
      "byte_count",
      "exact_bytes_sha256",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("copies NO producer-owned VALUE into the request (only the URL crosses over)", () => {
    // The builder's only source input is the URL; prove the producer ids/digests
    // never appear anywhere as a value.
    const req = buildDraftFromSourceRequest(SOURCE_URL, material());
    const keys = new Set<string>();
    const vals = new Set<string>();
    collect(req, keys, vals);
    expect(vals.has("cap-PRODUCER-OWNED-id")).toBe(false);
    expect(vals.has("src-PRODUCER-OWNED-id")).toBe(false);
    expect([...vals].some((v) => v.includes("sha256:"))).toBe(false);
    // The governed URL is the ONE thing that legitimately crosses over.
    expect(vals.has(SOURCE_URL)).toBe(true);
  });
});

describe("selectAuthoringClient — honest selection", () => {
  it("returns notConfigured for null / partial / non-loopback config", () => {
    expect(selectAuthoringClient(null)).toBe(notConfiguredAuthoringClient);
    expect(selectAuthoringClient({ baseUrl: "", token: "t" })).toBe(
      notConfiguredAuthoringClient,
    );
    expect(
      selectAuthoringClient({ baseUrl: "http://127.0.0.1:8788", token: "" }),
    ).toBe(notConfiguredAuthoringClient);
    expect(
      selectAuthoringClient({ baseUrl: "https://evil.example", token: "t" }),
    ).toBe(notConfiguredAuthoringClient);
  });

  it("returns an http client for a loopback config", () => {
    const client = selectAuthoringClient({
      baseUrl: "http://127.0.0.1:8788",
      token: "t",
    });
    expect(client.kind).toBe("http");
  });

  it("notConfigured never fabricates a proposal", async () => {
    const out = await notConfiguredAuthoringClient.draftFromSource(
      capturedResult(),
      material(),
    );
    expect(out).toEqual({ kind: "not_configured" });
  });
});

describe("createHttpAuthoringClient — transport + guarded response", () => {
  it("rejects a non-loopback baseUrl at construction", () => {
    expect(() =>
      createHttpAuthoringClient({
        config: { baseUrl: "http://example.com", token: "t" },
      }),
    ).toThrow(/loopback/);
  });

  it("posts the built request with the transport token and reads ONLY the source URL", async () => {
    let captured: { url: string; headers: Record<string, string>; body: string } | null =
      null;
    const client = createHttpAuthoringClient({
      config: { baseUrl: "http://127.0.0.1:8788", token: "tok-123" },
      originHeader: "chrome-extension://unit",
      fetchImpl: async (url, init) => {
        captured = { url, headers: init.headers, body: init.body };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schema_version: "authoring_admission_handoff.v0.1",
            producer: "counterpedia-authoring",
            authority_posture: "proposal_only",
            proposal_package: {},
            evidence_bundle: {},
            claim_map: {},
            draft_proposal: { lifecycle: "proposal" },
            handoff_digest: "sha256:deadbeef",
          }),
          text: async () => "",
        };
      },
    });

    const out = await client.draftFromSource(capturedResult(), material());
    expect(out.kind).toBe("assembled");
    expect(captured).not.toBeNull();
    const c = captured as unknown as { url: string; headers: Record<string, string>; body: string };
    expect(c.url).toBe("http://127.0.0.1:8788/v0/draft-from-source");
    expect(c.headers[TRANSPORT_TOKEN_HEADER]).toBe("tok-123");
    expect(c.headers["Origin"]).toBe("chrome-extension://unit");
    const sent = JSON.parse(c.body) as { candidates: Array<{ url: string }> };
    expect(sent.candidates[0]!.url).toBe(SOURCE_URL);
    expect(c.body).not.toContain("cap-PRODUCER-OWNED-id");
  });

  it("refuses to draft when the governed source has no URL", async () => {
    const client = createHttpAuthoringClient({
      config: { baseUrl: "http://127.0.0.1:8788", token: "t" },
      fetchImpl: async () => {
        throw new Error("should not be reached");
      },
    });
    const noUrl = { ...capturedResult(), source_locator: null };
    const out = await client.draftFromSource(noUrl, material());
    expect(out.kind).toBe("invalid_source");
  });

  it("refuses to draft with zero operator claims (no synthesis)", async () => {
    const client = createHttpAuthoringClient({
      config: { baseUrl: "http://127.0.0.1:8788", token: "t" },
      fetchImpl: async () => {
        throw new Error("should not be reached");
      },
    });
    const out = await client.draftFromSource(capturedResult(), {
      ...material(),
      claims: [],
    });
    expect(out.kind).toBe("invalid_source");
  });

  it("maps a 4xx/5xx to authoring_failed (never a proposal)", async () => {
    const client = createHttpAuthoringClient({
      config: { baseUrl: "http://127.0.0.1:8788", token: "t" },
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        json: async () => ({ error: "pipeline_refused" }),
        text: async () => "pipeline_refused",
      }),
    });
    const out = await client.draftFromSource(capturedResult(), material());
    expect(out.kind).toBe("authoring_failed");
    if (out.kind === "authoring_failed") expect(out.status).toBe(422);
  });

  it("rejects a contaminated 200 response via the guard (renders no authority)", async () => {
    const client = createHttpAuthoringClient({
      config: { baseUrl: "http://127.0.0.1:8788", token: "t" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          schema_version: "authoring_admission_handoff.v0.1",
          producer: "counterpedia-authoring",
          authority_posture: "proposal_only",
          proposal_package: { standing: "granted" }, // contamination
          evidence_bundle: {},
          claim_map: {},
          draft_proposal: { lifecycle: "proposal" },
          handoff_digest: "sha256:x",
        }),
        text: async () => "",
      }),
    });
    const out = await client.draftFromSource(capturedResult(), material());
    expect(out.kind).toBe("authoring_failed");
  });
});
