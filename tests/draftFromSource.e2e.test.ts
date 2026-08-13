/**
 * DRAFT-FROM-SOURCE — real TWO-SERVER cross-process proof of the three acts.
 *
 * This test mocks NOTHING on either producer side. It stands up, as separate OS
 * processes:
 *   (a) the REAL ACQ1 acquisition HTTP server (counterpedia-acquisition), which
 *       re-fetches a deterministic local fixture and mints an UNADMITTED receipt;
 *   (b) the REAL AUTHOR-HTTP transport (counterpedia-authoring), wired for
 *       hermetic determinism via that repo's own fake builders, but with the
 *       governed source URL set to the SAME fixture URL the acquisition captured
 *       — so a single governed source URL threads all three acts;
 *   (c) a deterministic node:http fixture source.
 *
 * Then it drives the REAL extension code path:
 *   browser BPC
 *     -> real ACQ1 client + guard  -> real acquisition -> validated result (UNADMITTED)
 *     -> EXPLICIT draft-from-source -> real AUTHOR-HTTP client + guard
 *     -> real authoring pipeline    -> terminal proposal_only handoff.
 *
 * The three acts stay DISTINCT: capture never auto-drafts, the acquisition result
 * and the authoring proposal are different objects, and no producer-owned
 * acquisition fact is copied into the authoring request. There is no admission
 * endpoint and no admission call, ever.
 *
 * node:http is used for the client transports ONLY so the (browser-forbidden)
 * Origin header actually reaches the servers; in the real extension the browser
 * sets Origin automatically. Envelope/request construction, token headers,
 * response guards, and state derivation are all the real code path.
 *
 * Requires real checkouts of BOTH repos:
 *   COUNTERPEDIA_ACQUISITION_DIR -> has scripts/run_acquisition_http.py
 *   COUNTERPEDIA_AUTHORING_DIR   -> has the AUTHOR-HTTP transport + hermetic runner
 * If EITHER is unresolved the suite SKIPS with a loud warning (the loop is NOT
 * exercised) rather than passing hollow.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  request as httpRequest,
  createServer as createHttpServer,
  type Server,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHttpAcquisitionClient,
  type AcquisitionConfig,
} from "../src/lib/acquisitionClient";
import { renderAcquisitionResult } from "../src/lib/acquisitionState";
import type { AcquisitionCaptureResult } from "../src/lib/acquisitionResponseGuard";
import {
  createHttpAuthoringClient,
  type AuthoringConfig,
  type OperatorDraftMaterial,
} from "../src/lib/authoringClient";
import {
  mapDraftAvailability,
  renderProposalAssembled,
} from "../src/lib/authoringState";
import { tryParseAuthoringHandoff } from "../src/lib/authoringResponseGuard";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ORIGIN = "chrome-extension://draft-from-source-e2e";
const ACQ_TOKEN = "acq-e2e-transport-token-0123456789";
const AUTH_TOKEN = "author-e2e-transport-token-0123456789";

const FIXTURE_BYTES = Buffer.from(
  "<html><body>Draft-from-source cross-process fixture bytes.</body></html>",
  "utf-8",
);
const EXPECTED_SHA256 =
  "sha256:" + createHash("sha256").update(FIXTURE_BYTES).digest("hex");

// The hermetic authoring plan candidate id is fixed by the authoring repo's
// runner (SUBJECT_CANDIDATE_ID). The operator's candidate id must match it for
// the transport's governed-URL continuity check to bind.
const HERMETIC_CANDIDATE_ID = "src:lighthouse-registry";

function resolveAcquisitionDir(): string | null {
  const candidates = [
    process.env["COUNTERPEDIA_ACQUISITION_DIR"],
    join(__dirname, "../../counterpedia-acquisition"),
    join(__dirname, "../../../repos/counterpedia-acquisition"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(join(c, "scripts/run_acquisition_http.py"))) return c;
  }
  return null;
}

function resolveAuthoringDir(): string | null {
  const candidates = [
    process.env["COUNTERPEDIA_AUTHORING_DIR"],
    join(__dirname, "../../counterpedia-authoring"),
    join(__dirname, "../../../repos/counterpedia-authoring"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (
      existsSync(join(c, "src/counterpedia_authoring/http_transport.py")) &&
      existsSync(join(c, "tests/integration/_author_http_hermetic_server.py"))
    ) {
      return c;
    }
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** node:http POST adapter with the fetch-like shape the clients expect. */
function nodeHttpFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) {
  return new Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }>((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: init.method,
        headers: {
          ...init.headers,
          "Content-Length": Buffer.byteLength(init.body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(text),
            text: async () => text,
          });
        });
      },
    );
    req.on("error", reject);
    req.write(init.body);
    req.end();
  });
}

/** Records every request the authoring client makes (proves zero admit calls). */
const authoringRequests: Array<{ path: string; body: string }> = [];
function recordingAuthoringFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) {
  authoringRequests.push({ path: new URL(url).pathname, body: init.body });
  return nodeHttpFetch(url, init);
}

async function waitForHealth(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never became healthy: ${lastErr}`);
}

function e2eBpc(url: string): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture",
    spec_version: "v0.1",
    requested_url: url,
    current_url: url,
    canonical_url: url,
    document_title: "E2E fixture",
    document_language: "en",
    meta_description: "e2e fixture page",
    json_ld: [],
    selected_text: "advisory text — never the source bytes",
    main_text: "advisory main text",
    rendered_text: "advisory rendered text",
    captured_at: "2026-08-13T00:00:00Z",
  };
}

function operatorMaterial(): OperatorDraftMaterial {
  return {
    subjectSeed: "Portland Head Light",
    operatorObjective:
      "Produce a bounded proposal describing Portland Head Light.",
    candidateId: HERMETIC_CANDIDATE_ID,
    claims: [
      {
        claim_id: "claim-name",
        claim_text: "The subject is known as Portland Head Light.",
        supports: [{ evidence_refs: ["evidence:E001", "evidence:E002"] }],
        contradicts: [],
      },
      {
        claim_id: "claim-location",
        claim_text: "It is located in Cape Elizabeth, Maine.",
        supports: [{ evidence_refs: ["evidence:E003"] }],
        contradicts: [],
      },
    ],
    coverageRequirements: [
      {
        requirement_id: "req-core",
        label: "Core coverage",
        description: "Basic descriptive coverage of the subject.",
      },
    ],
    coverageAssessments: [
      {
        requirement_id: "req-core",
        state: "sufficient_candidate_support",
        supporting_claim_ids: ["claim-name", "claim-location"],
        conflicting_claim_ids: [],
      },
    ],
    recipe: {
      recipe_id: "landmark-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    },
    depth: "brief",
  };
}

/** Recursively collect every object key in a JSON tree. */
function allKeys(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((n) => allKeys(n, out));
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

const acqDir = resolveAcquisitionDir();
const authDir = resolveAuthoringDir();
if (!acqDir || !authDir) {
  // eslint-disable-next-line no-console
  console.warn(
    "[DRAFT-FROM-SOURCE E2E] SKIPPED: missing checkout(s) — " +
      `acquisition=${acqDir ?? "UNRESOLVED (set COUNTERPEDIA_ACQUISITION_DIR)"}, ` +
      `authoring=${authDir ?? "UNRESOLVED (set COUNTERPEDIA_AUTHORING_DIR)"}. ` +
      "The real two-server three-act loop was NOT exercised in this run.",
  );
}
const describeE2E = acqDir && authDir ? describe : describe.skip;

describeE2E("DRAFT-FROM-SOURCE — real two-server three-act loop", () => {
  let acqProc: ChildProcess;
  let authProc: ChildProcess;
  let fixture: Server;
  let acqBase = "";
  let authBase = "";
  let fixtureUrl = "";
  const fixtureHits: string[] = [];
  let acqStderr = "";
  let authStderr = "";

  /** Captured once in the happy-path test, reused (read-only) by later tests. */
  let capturedResult: AcquisitionCaptureResult | null = null;

  beforeAll(async () => {
    // (c) Deterministic local source both the producer re-fetch and the hermetic
    // authoring plan point at.
    fixture = createHttpServer((req, res) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      fixtureHits.push(path);
      if (path === "/page") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(FIXTURE_BYTES.length),
        });
        res.end(FIXTURE_BYTES);
      } else {
        res.writeHead(404, { "Content-Length": "0" });
        res.end();
      }
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", () => r()));
    const fAddr = fixture.address();
    const fPort = typeof fAddr === "object" && fAddr ? fAddr.port : 0;
    fixtureUrl = `http://127.0.0.1:${fPort}/page`;

    // (a) Spawn the REAL Python acquisition server on a free loopback port.
    const acqPort = await freePort();
    acqBase = `http://127.0.0.1:${acqPort}`;
    acqProc = spawn(
      "python3",
      [join(acqDir!, "scripts/run_acquisition_http.py")],
      {
        cwd: acqDir!,
        env: {
          ...process.env,
          PYTHONPATH: join(acqDir!, "src"),
          CP_ACQUISITION_ALLOWED_ORIGIN: ORIGIN,
          CP_ACQUISITION_TRANSPORT_TOKEN: ACQ_TOKEN,
          CP_ACQUISITION_HTTP_HOST: "127.0.0.1",
          CP_ACQUISITION_HTTP_PORT: String(acqPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    acqProc.stderr?.on("data", (c: Buffer) => (acqStderr += c.toString()));

    // (b) Spawn the REAL authoring transport (hermetic) with the governed source
    // URL == the fixture URL, on a free ephemeral port reported on stdout.
    authProc = spawn(
      "python3",
      [join(__dirname, "support/authorHttpHermeticRunner.py"), fixtureUrl, "0"],
      {
        cwd: authDir!,
        env: {
          ...process.env,
          COUNTERPEDIA_AUTHORING_DIR: authDir!,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    authProc.stderr?.on("data", (c: Buffer) => (authStderr += c.toString()));

    const authPort = await new Promise<number>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(
        () =>
          reject(
            new Error(`authoring server never reported a port:\n${authStderr}`),
          ),
        15_000,
      );
      authProc.stdout?.on("data", (c: Buffer) => {
        buf += c.toString();
        const m = buf.match(/PORT (\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      authProc.on("exit", (code) => {
        clearTimeout(timer);
        reject(
          new Error(`authoring server exited (${code}):\n${authStderr}`),
        );
      });
    });
    authBase = `http://127.0.0.1:${authPort}`;

    try {
      await waitForHealth(acqBase, 15_000);
      await waitForHealth(authBase, 15_000);
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : err}\n` +
          `acquisition stderr:\n${acqStderr}\nauthoring stderr:\n${authStderr}`,
      );
    }
  }, 45_000);

  afterAll(async () => {
    if (acqProc && !acqProc.killed) acqProc.kill("SIGTERM");
    if (authProc && !authProc.killed) authProc.kill("SIGTERM");
    if (fixture) await new Promise<void>((r) => fixture.close(() => r()));
  });

  // -------------------------------------------------------------------------
  // The primary chain: three distinct governed acts, one governed source URL.
  // -------------------------------------------------------------------------
  it("threads one governed source through capture -> acquisition (UNADMITTED) -> EXPLICIT draft (proposal_only)", async () => {
    // ACT 2: real acquisition of the browser observation.
    const acqConfig: AcquisitionConfig = { baseUrl: acqBase, token: ACQ_TOKEN };
    const acqClient = createHttpAcquisitionClient({
      config: acqConfig,
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const acqOutcome = await acqClient.capture(e2eBpc(fixtureUrl));
    expect(acqOutcome.kind).toBe("captured");
    if (acqOutcome.kind !== "captured") return;

    // The producer really re-fetched the fixture and the receipt is UNADMITTED.
    expect(fixtureHits).toContain("/page");
    expect(acqOutcome.result.captured_object_address).toBe(EXPECTED_SHA256);
    expect(acqOutcome.result.source_locator).toBe(fixtureUrl);
    const acqRender = renderAcquisitionResult(acqOutcome.result);
    expect(acqRender.state).toBe("UNADMITTED");

    capturedResult = acqOutcome.result;

    // The Draft option becomes available ONLY because a capture succeeded — and
    // capture did NOT itself draft. Zero authoring calls have been made so far.
    expect(mapDraftAvailability(true)).toBe("DRAFT_READY");
    expect(authoringRequests.length).toBe(0);

    // Snapshot the acquisition record before drafting to prove non-mutation.
    const acqSnapshot = JSON.parse(JSON.stringify(acqOutcome.result));

    // ACT 3: an EXPLICIT, separate draft-from-source over that governed source.
    const authConfig: AuthoringConfig = { baseUrl: authBase, token: AUTH_TOKEN };
    const authClient = createHttpAuthoringClient({
      config: authConfig,
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    const draft = await authClient.draftFromSource(
      acqOutcome.result,
      operatorMaterial(),
    );

    expect(draft.kind).toBe("assembled");
    if (draft.kind !== "assembled") return;

    // Terminal posture: proposal_only, draft lifecycle in {proposal, draft}.
    expect(draft.handoff.authority_posture).toBe("proposal_only");
    expect(draft.handoff.producer).toBe("counterpedia-authoring");
    expect(["proposal", "draft"]).toContain(
      draft.handoff.draft_proposal.lifecycle,
    );

    // No admission/standing field anywhere in the guarded handoff.
    const handoffKeys = allKeys(draft.handoff);
    for (const forbidden of [
      "admission",
      "admitted",
      "admitted_at",
      "standing",
      "published",
      "published_at",
      "verified",
      "ratified_by",
      "approved_by",
    ]) {
      expect(handoffKeys.has(forbidden)).toBe(false);
    }

    // The two acts are DISTINCT objects — the proposal is not the acquisition.
    expect((draft.handoff as unknown) === (acqOutcome.result as unknown)).toBe(
      false,
    );

    // Custody: the request the client sent carried the governed URL and NONE of
    // the producer-owned acquisition facts.
    const draftReq = authoringRequests.find(
      (r) => r.path === "/v0/draft-from-source",
    );
    expect(draftReq).toBeDefined();
    const sentBody = JSON.parse(draftReq!.body) as Record<string, unknown>;
    const sentKeys = allKeys(sentBody);
    for (const producerField of [
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
      expect(sentKeys.has(producerField)).toBe(false);
    }
    expect(draftReq!.body).not.toContain(acqSnapshot.capture_id);
    expect(draftReq!.body).not.toContain(acqSnapshot.captured_object_address);
    // The one legitimate crossover: the governed source URL.
    expect(
      (sentBody["candidates"] as Array<{ url: string }>)[0]!.url,
    ).toBe(fixtureUrl);

    // The acquisition record is untouched by the draft.
    expect(acqOutcome.result).toEqual(acqSnapshot);

    // ADMISSION discipline: every authoring request was the single draft POST;
    // there is no admit endpoint and none was called.
    for (const r of authoringRequests) {
      expect(r.path).toBe("/v0/draft-from-source");
      expect(r.path).not.toContain("admit");
    }
    const admissionCalls = authoringRequests.filter((r) =>
      r.path.toLowerCase().includes("admit"),
    ).length;
    expect(admissionCalls).toBe(0);

    // eslint-disable-next-line no-console
    console.log("ADMISSION CALLS = 0");
    // eslint-disable-next-line no-console
    console.log("STATE COLLAPSE = NONE");
  }, 45_000);

  // -------------------------------------------------------------------------
  // Negative: a producer-owned acquisition fact cannot be injected into the
  // AUTHOR-HTTP request — the real server rejects it (400 producer_owned_field).
  // -------------------------------------------------------------------------
  it("rejects a producer-owned fact injected into the AUTHOR-HTTP request (real 400)", async () => {
    // Bypass the client (which structurally cannot add these) to prove the
    // SERVER is the second, independent line of defense.
    const material = operatorMaterial();
    const contaminated = {
      subject_seed: material.subjectSeed,
      operator_objective: material.operatorObjective,
      candidates: [{ candidate_id: HERMETIC_CANDIDATE_ID, url: fixtureUrl }],
      // Producer-owned custody fact the caller must never assert:
      source_id: "src-attacker-supplied",
      claims: material.claims,
      coverage_requirements: material.coverageRequirements,
      coverage_assessments: material.coverageAssessments,
      recipe: {
        recipe_id: material.recipe.recipe_id,
        output_profile: material.recipe.output_profile,
        lead_policy_reference: material.recipe.lead_policy_reference,
        recipe_version: material.recipe.recipe_version,
        desired_section_vocabulary: material.recipe.desired_section_vocabulary,
      },
      depth: "brief",
    };
    const res = await nodeHttpFetch(`${authBase}/v0/draft-from-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contaminated),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("producer_owned_field");
  }, 30_000);

  // -------------------------------------------------------------------------
  // Negative: an authoring failure leaves the acquisition record intact and
  // never admits. A mismatched candidate id => governed_url_mismatch (422).
  // -------------------------------------------------------------------------
  it("authoring failure leaves the acquisition record intact (real 422, no proposal)", async () => {
    expect(capturedResult).not.toBeNull();
    const before = JSON.parse(JSON.stringify(capturedResult));

    const authClient = createHttpAuthoringClient({
      config: { baseUrl: authBase, token: AUTH_TOKEN },
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    // A candidate id the hermetic plan does not know => continuity fails closed.
    const bad = { ...operatorMaterial(), candidateId: "operator-unbound-id" };
    const out = await authClient.draftFromSource(capturedResult!, bad);

    expect(out.kind).toBe("authoring_failed");
    if (out.kind === "authoring_failed") expect(out.status).toBe(422);

    // The acquisition record is unchanged by the failed draft.
    expect(capturedResult).toEqual(before);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Negative: a missing acquisition artifact makes the draft action
  // unavailable, and the client refuses without any authoring call.
  // -------------------------------------------------------------------------
  it("missing acquisition artifact => Draft unavailable and refused (no authoring call)", async () => {
    expect(mapDraftAvailability(false)).toBe("DRAFT_UNAVAILABLE");

    const authClient = createHttpAuthoringClient({
      config: { baseUrl: authBase, token: AUTH_TOKEN },
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    const before = authoringRequests.length;
    // A captured result whose governed URL is absent — nothing to draft from.
    const noUrl: AcquisitionCaptureResult = {
      ...(capturedResult as AcquisitionCaptureResult),
      source_locator: null,
    };
    const out = await authClient.draftFromSource(noUrl, operatorMaterial());
    expect(out.kind).toBe("invalid_source");
    // The client made NO network call to the authoring server.
    expect(authoringRequests.length).toBe(before);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Negative: a contaminated authoring response (an admission/standing field)
  // is rejected by the guard and never rendered as authority. Built from the
  // REAL handoff bytes, then mutated.
  // -------------------------------------------------------------------------
  it("a contaminated authoring response is rejected by the guard, not rendered as authority", async () => {
    // Obtain a genuine handoff from the real server, then contaminate it.
    const authClient = createHttpAuthoringClient({
      config: { baseUrl: authBase, token: AUTH_TOKEN },
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    const good = await authClient.draftFromSource(
      capturedResult as AcquisitionCaptureResult,
      operatorMaterial(),
    );
    expect(good.kind).toBe("assembled");
    if (good.kind !== "assembled") return;

    // Contaminate the real handoff with a standing grant; the guard must reject.
    const contaminated = JSON.parse(JSON.stringify(good.handoff));
    contaminated.proposal_package.standing = "granted";
    expect(tryParseAuthoringHandoff(contaminated)).toBeNull();

    // And the clean handoff still renders as proposal_only (never admission).
    const render = renderProposalAssembled(good.handoff);
    expect(render.state).toBe("PROPOSAL_ASSEMBLED");
    expect(render.admissionLine).toBe("Admission: not performed");
  }, 30_000);

  // -------------------------------------------------------------------------
  // Negative: repeated draft-from-source does not mutate the prior acquisition
  // observation, and yields distinct proposal objects.
  // -------------------------------------------------------------------------
  it("repeated draft-from-source does not mutate the acquisition observation", async () => {
    expect(capturedResult).not.toBeNull();
    const before = JSON.parse(JSON.stringify(capturedResult));

    const authClient = createHttpAuthoringClient({
      config: { baseUrl: authBase, token: AUTH_TOKEN },
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    const first = await authClient.draftFromSource(
      capturedResult as AcquisitionCaptureResult,
      operatorMaterial(),
    );
    const second = await authClient.draftFromSource(
      capturedResult as AcquisitionCaptureResult,
      operatorMaterial(),
    );

    expect(first.kind).toBe("assembled");
    expect(second.kind).toBe("assembled");
    if (first.kind !== "assembled" || second.kind !== "assembled") return;
    expect(first.handoff.authority_posture).toBe("proposal_only");
    expect(second.handoff.authority_posture).toBe("proposal_only");
    // Distinct proposal objects; the acquisition observation is untouched.
    expect((first.handoff as unknown) === (second.handoff as unknown)).toBe(
      false,
    );
    expect(capturedResult).toEqual(before);
  }, 30_000);
});
