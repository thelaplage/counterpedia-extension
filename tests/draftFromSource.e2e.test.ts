/**
 * DRAFT-FROM-SOURCE — real THREE-PROCESS cross-process proof of the three acts.
 *
 * This test mocks NOTHING on any producer side. It stands up, as separate OS
 * processes:
 *   (a) the REAL ACQ1 acquisition HTTP server (counterpedia-acquisition), TEST
 *       FIXTURE launcher (permissive egress ONLY so it can reach the local
 *       fixture "source" below — see scripts/run_acquisition_http_test_fixture.py's
 *       own docstring for exactly what that relaxes and what stays identical to
 *       production), filesystem-backed so its capture registry is durable across
 *       processes;
 *   (b) the REAL AUTHOR-HTTP transport (counterpedia-authoring), wired for
 *       `/v0/draft-from-source` (AUTH0-B1) with a REAL held_capture_client that
 *       talks to (c) below over real MCP stdio — NOT the URL-refetch fixture,
 *       which cannot serve this route at all (see support/authorHttpSourceHermeticRunner.py's
 *       module docstring for exactly why);
 *   (c) a REAL acquisition MCP stdio subprocess (support/acquisitionMcpStdioEntry.py),
 *       spawned fresh by (b) for each held-capture resolution, sharing (a)'s
 *       on-disk store/registry so a capture registered in process (a) is
 *       genuinely resolvable by capture_ref alone in this separate process;
 *   (d) a deterministic node:http fixture source.
 *
 * Then it drives the REAL extension code path:
 *   browser BPC
 *     -> real ACQ1 client + guard   -> real acquisition -> validated result (UNADMITTED)
 *     -> EXPLICIT draft-from-source -> real AUTHOR-HTTP client + guard
 *     -> real held-capture pipeline (b)+(c), ZERO live fetch -> terminal proposal_only handoff.
 *
 * The three acts stay DISTINCT: capture never auto-drafts, the acquisition result
 * and the authoring proposal are different objects, and only the two deliberate,
 * narrow fields (`source_locator` as a continuity constraint, `capture_id` as
 * `capture_ref`) cross from the acquisition result into the authoring request —
 * every other producer-owned acquisition fact does not. There is no admission
 * endpoint and no admission call, ever. `draftFromUrl()` / `/v0/draft-from-url`
 * is asserted to never be invoked anywhere in this run.
 *
 * node:http is used for the client transports ONLY so the (browser-forbidden)
 * Origin header actually reaches the servers; in the real extension the browser
 * sets Origin automatically. Envelope/request construction, token headers,
 * response guards, and state derivation are all the real code path.
 *
 * Requires real checkouts of BOTH repos:
 *   COUNTERPEDIA_ACQUISITION_DIR -> has scripts/run_acquisition_http_test_fixture.py
 *                                   and the MCP stdio surface (acquisition.mcp_cli /
 *                                   acquisition.mcp_server modules)
 *   COUNTERPEDIA_AUTHORING_DIR   -> has AUTH0-B1 (DraftFromSourceService /
 *                                   held_capture_client / source_deps) and the
 *                                   McpStdioAcquisitionToolTransport client
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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
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

// /v0/draft-from-source builds its RequestBoundSourcePlannerAdapter directly
// from the REQUEST's own candidates (see counterpedia-authoring's
// http_transport.py, DraftFromSourceService.handle) -- unlike the URL lane,
// there is no separate hermetic-server-side candidate id to bind against.
// The one real backend constraint (discovered via this same E2E, see
// src/panel/panel.ts's DEFAULT_AUTHORING_PROFILE.candidateId comment) is that
// the authoring planner's ResearchPlanProposal requires candidate_source ids
// to match `^src:[a-z0-9\-]{1,63}$`.
const OPERATOR_CANDIDATE_ID = "src:draft-from-source-e2e";

function resolveAcquisitionDir(): string | null {
  const candidates = [
    process.env["COUNTERPEDIA_ACQUISITION_DIR"],
    join(__dirname, "../../counterpedia-acquisition"),
    join(__dirname, "../../../repos/counterpedia-acquisition"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (
      existsSync(join(c, "scripts/run_acquisition_http_test_fixture.py")) &&
      existsSync(join(c, "src/acquisition/mcp_cli.py"))
    ) {
      return c;
    }
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
    if (existsSync(join(c, "src/counterpedia_authoring/http_transport.py"))) {
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
    candidateId: OPERATOR_CANDIDATE_ID,
    // The held-capture evidence bundle always allocates evidence:E001 to the
    // capture item itself (see counterpedia-authoring's evidence_builder/
    // builder.py, add_acquisition_session()); a second, abstractive-synthesis
    // handle is minted ONLY if the observer's grounding proposed a non-empty
    // field for the captured bytes. FIXTURE_BYTES below is deliberately
    // field-free HTML (no <title>/<h1>/meta description), so
    // DeterministicHtmlBackend (the real acquisition repo's own offline
    // reference backend, used by support/acquisitionMcpStdioEntry.py)
    // proposes zero fields and only evidence:E001 exists. Claims below cite
    // only that handle so this fixture never depends on that grounding
    // detail.
    claims: [
      {
        claim_id: "claim-name",
        claim_text: "The subject is known as Portland Head Light.",
        supports: [{ evidence_refs: ["evidence:E001"] }],
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
        supporting_claim_ids: ["claim-name"],
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
// DRAFT-E2E-HARNESS0: an explicit release-gate invocation (CP_DRAFT_E2E_REQUIRE=1,
// set by scripts/draft-e2e-gate.sh) must FAIL LOUDLY when the cross-repo fixture
// environment is unavailable, rather than letting describe.skip convert
// "not tested" into apparent green. Ordinary `npm test` runs leave the var unset
// and keep the expensive cross-repo fixture skippable.
const requireE2E = process.env["CP_DRAFT_E2E_REQUIRE"] === "1";
if (!acqDir || !authDir) {
  const detail =
    `acquisition=${acqDir ?? "UNRESOLVED (set COUNTERPEDIA_ACQUISITION_DIR)"}, ` +
    `authoring=${authDir ?? "UNRESOLVED (set COUNTERPEDIA_AUTHORING_DIR)"}`;
  if (requireE2E) {
    throw new Error(
      "[DRAFT-FROM-SOURCE E2E] REQUIRED but the cross-repo environment is " +
        `unavailable — ${detail}. This is a release gate: refusing to report ` +
        "green for an unexercised loop. Run via scripts/draft-e2e-gate.sh.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[DRAFT-FROM-SOURCE E2E] SKIPPED: missing checkout(s) — " +
      `${detail}. ` +
      "The real two-server three-act loop was NOT exercised in this run.",
  );
}
const describeE2E = acqDir && authDir ? describe : describe.skip;

describeE2E("DRAFT-FROM-SOURCE — real three-process held-capture loop", () => {
  let acqProc: ChildProcess;
  let authProc: ChildProcess;
  let fixture: Server;
  let acqBase = "";
  let authBase = "";
  let fixtureUrl = "";
  let storeRoot = "";
  const fixtureHits: string[] = [];
  let acqStderr = "";
  let authStderr = "";

  /** Captured once in the happy-path test, reused (read-only) by later tests. */
  let capturedResult: AcquisitionCaptureResult | null = null;

  beforeAll(async () => {
    // (d) Deterministic local source the ACQ1 producer captures from. Field-free
    // HTML on purpose — see operatorMaterial()'s comment on evidence:E001-only.
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

    // Filesystem-backed store root shared by (a) the acquisition HTTP server's
    // capture registry and (c) the authoring producer's separately-spawned
    // acquisition MCP stdio subprocess — the mechanism that lets a capture_ref
    // minted in one process resolve to real retained bytes in another.
    storeRoot = mkdtempSync(join(tmpdir(), "cp-draft-from-source-e2e-"));

    // (a) Spawn the REAL Python acquisition server on a free loopback port.
    // TEST FIXTURE launcher: permissive egress ONLY, so it can reach the local
    // fixture "source" above — see scripts/run_acquisition_http_test_fixture.py's
    // own docstring for exactly what differs from the production launcher (used
    // nowhere else in this file) and what stays byte-identical to it.
    const acqPort = await freePort();
    acqBase = `http://127.0.0.1:${acqPort}`;
    acqProc = spawn(
      "python3",
      [join(acqDir!, "scripts/run_acquisition_http_test_fixture.py")],
      {
        cwd: acqDir!,
        env: {
          ...process.env,
          PYTHONPATH: join(acqDir!, "src"),
          CP_ACQUISITION_ALLOWED_ORIGIN: ORIGIN,
          CP_ACQUISITION_TRANSPORT_TOKEN: ACQ_TOKEN,
          CP_ACQUISITION_HTTP_HOST: "127.0.0.1",
          CP_ACQUISITION_HTTP_PORT: String(acqPort),
          CP_ACQUISITION_HTTP_STORE_ROOT: storeRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    acqProc.stderr?.on("data", (c: Buffer) => (acqStderr += c.toString()));

    // (b) Spawn the REAL AUTHOR-HTTP transport wired for /v0/draft-from-source
    // (source-enabled launcher — NOT authorHttpHermeticRunner.py, which cannot
    // serve this route at all; see that file's own docstring and
    // authorHttpSourceHermeticRunner.py's module docstring for why). It is
    // handed the acquisition repo's src dir + the SAME storeRoot so its
    // held_capture_client can spawn (c) against the real registered capture.
    const authPort = await freePort();
    authProc = spawn(
      "python3",
      [
        join(__dirname, "support/authorHttpSourceHermeticRunner.py"),
        join(acqDir!, "src"),
        storeRoot,
        String(authPort),
      ],
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

    const boundAuthPort = await new Promise<number>((resolve, reject) => {
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
    authBase = `http://127.0.0.1:${boundAuthPort}`;

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
    if (storeRoot) {
      try {
        rmSync(storeRoot, { recursive: true, force: true });
      } catch {
        // best-effort cleanup only
      }
    }
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
    const draft = await authClient.draftFromHeldCapture(
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

    // Custody: the request the client sent carried the governed URL + the one
    // deliberate `capture_ref` exception, and NONE of the other producer-owned
    // acquisition facts.
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
      "byte_count",
      "exact_bytes_sha256",
    ]) {
      expect(sentKeys.has(producerField)).toBe(false);
    }
    expect(draftReq!.body).not.toContain(acqSnapshot.captured_object_address);
    // The two legitimate crossovers: the governed source URL (continuity
    // constraint) and capture_id forwarded as capture_ref (the ONE deliberate
    // custody exception for the historical-source action).
    expect(
      (sentBody["candidates"] as Array<{ url: string }>)[0]!.url,
    ).toBe(fixtureUrl);
    expect(sentBody["capture_ref"]).toBe(acqSnapshot.capture_id);

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

    // Zero authoring URL reacquisition: draftFromUrl() / /v0/draft-from-url is
    // never invoked anywhere in this run — the historical-reference lane never
    // falls back to a live re-fetch.
    const draftFromUrlCalls = authoringRequests.filter(
      (r) => r.path === "/v0/draft-from-url",
    ).length;
    expect(draftFromUrlCalls).toBe(0);

    // eslint-disable-next-line no-console
    console.log("ADMISSION CALLS = 0");
    // eslint-disable-next-line no-console
    console.log("STATE COLLAPSE = NONE");
  }, 45_000);

  // -------------------------------------------------------------------------
  // A -> B proof: capture A, then take the ORIGIN ITSELF DOWN (not just skip
  // calling draftFromUrl — the origin genuinely cannot be reached anymore),
  // and prove the historical draft still succeeds from the retained capture.
  // This is the strongest available proof of "zero live re-fetch": even a
  // producer that WANTED to fall back to a live fetch could not succeed here.
  // -------------------------------------------------------------------------
  it("origin taken down after capture -> historical draft still succeeds from retained bytes", async () => {
    // A private fixture + capture for this test only, so shutting the origin
    // down here cannot affect any other test in this file.
    const privateBytes = Buffer.from(
      "<html><body>A-to-B origin-gone proof fixture bytes.</body></html>",
      "utf-8",
    );
    const privateFixture = createHttpServer((req, res) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      if (path === "/gone-page") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(privateBytes.length),
        });
        res.end(privateBytes);
      } else {
        res.writeHead(404, { "Content-Length": "0" });
        res.end();
      }
    });
    await new Promise<void>((r) =>
      privateFixture.listen(0, "127.0.0.1", () => r()),
    );
    const pAddr = privateFixture.address();
    const pPort = typeof pAddr === "object" && pAddr ? pAddr.port : 0;
    const privateUrl = `http://127.0.0.1:${pPort}/gone-page`;

    // ACT A: real capture while the origin is still up.
    const acqClient = createHttpAcquisitionClient({
      config: { baseUrl: acqBase, token: ACQ_TOKEN },
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const captured = await acqClient.capture(e2eBpc(privateUrl));
    expect(captured.kind).toBe("captured");
    if (captured.kind !== "captured") return;

    // Take the origin ITSELF down — not a mock, not "we didn't call fetch":
    // the port is closed and nothing is listening there anymore. Any producer
    // attempting a live re-fetch of this exact URL would now hard-fail.
    await new Promise<void>((r) => privateFixture.close(() => r()));
    await new Promise((r) => setTimeout(r, 100));
    // Confirm the origin is genuinely unreachable before proceeding.
    await expect(
      new Promise((_resolve, reject) => {
        const req = httpRequest(
          { hostname: "127.0.0.1", port: pPort, path: "/gone-page", method: "GET" },
          () => reject(new Error("origin unexpectedly still reachable")),
        );
        req.on("error", () => reject(new Error("ECONNREFUSED (expected)")));
        req.end();
      }),
    ).rejects.toThrow("ECONNREFUSED");

    // ACT B: draft-from-source over the SAME retained capture, origin gone.
    const authClient = createHttpAuthoringClient({
      config: { baseUrl: authBase, token: AUTH_TOKEN },
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    const draft = await authClient.draftFromHeldCapture(
      captured.result,
      operatorMaterial(),
    );

    expect(draft.kind).toBe("assembled");
    if (draft.kind !== "assembled") return;
    expect(draft.handoff.authority_posture).toBe("proposal_only");

    // The evidence item's content digest is the digest of the ORIGINAL
    // retained bytes captured in ACT A — not a fresh (impossible) re-fetch.
    const privateSha256 =
      "sha256:" + createHash("sha256").update(privateBytes).digest("hex");
    expect(captured.result.captured_object_address).toBe(privateSha256);
    const items = draft.handoff.evidence_bundle["items"] as Array<{
      content_digest?: string;
    }>;
    expect(items.some((i) => i.content_digest === privateSha256)).toBe(true);
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
      candidates: [{ candidate_id: OPERATOR_CANDIDATE_ID, url: fixtureUrl }],
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
  // never admits. An unknown capture_ref => the real held-capture registry
  // resolution fails (held_capture_invalid), which DraftFromSourceService
  // maps to source_basis_unresolved (422) — never a fallback to a live fetch.
  // -------------------------------------------------------------------------
  it("authoring failure leaves the acquisition record intact (real 422, no proposal)", async () => {
    expect(capturedResult).not.toBeNull();
    const before = JSON.parse(JSON.stringify(capturedResult));

    const authClient = createHttpAuthoringClient({
      config: { baseUrl: authBase, token: AUTH_TOKEN },
      fetchImpl: recordingAuthoringFetch,
      originHeader: ORIGIN,
    });
    // A capture_id the real registry never registered => held-capture
    // resolution fails closed, real backend, real registry lookup.
    const unknownCapture: AcquisitionCaptureResult = {
      ...(capturedResult as AcquisitionCaptureResult),
      capture_id: "cap_00000000-0000-0000-0000-000000000000",
    };
    const out = await authClient.draftFromHeldCapture(
      unknownCapture,
      operatorMaterial(),
    );

    expect(out.kind).toBe("authoring_failed");
    if (out.kind === "authoring_failed") {
      expect(out.status).toBe(422);
      // C0-REFUSAL-DETAIL-RECON0: prove the REAL backend's bounded refusal
      // code survives all the way through the extension's HTTP client,
      // against the real DraftFromSourceService -> held_capture_client ->
      // real registry lookup (no mocking on either side of this call).
      expect(out.refusalCode).toBe("source_basis_unresolved");
    }

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
    const out = await authClient.draftFromHeldCapture(noUrl, operatorMaterial());
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
    const good = await authClient.draftFromHeldCapture(
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

    // DRAFT-FROM-SOURCE-PREVIEW0 forcing: the REAL producer handoff must project a
    // non-empty, evidence-carrying preview into the panel read-model (not just the
    // lifecycle line the panel showed before #60).
    const preview = render.proposalPreview;
    expect(preview).not.toBeNull();
    if (preview) {
      // Title projected from the real producer draft is non-empty.
      expect(typeof preview.title === "string" && preview.title.trim().length > 0).toBe(true);
      // Body projection is non-empty: at least one lead block carrying text.
      expect(preview.leadBlocks.length).toBeGreaterThan(0);
      expect(
        preview.leadBlocks.some((b) => typeof b.text === "string" && b.text.trim().length > 0),
      ).toBe(true);
      // The producer's real evidence handle survives into the preview. The
      // held-capture bundle allocates evidence:E001 to the capture item itself.
      const allEvidence = new Set<string>([
        ...preview.evidenceBasisRefs,
        ...preview.leadBlocks.flatMap((b) => b.evidenceRefs),
        ...preview.sections.flatMap((s) => s.blocks.flatMap((b) => b.evidenceRefs)),
        ...preview.propositions.flatMap((p) => p.evidenceRefs),
      ]);
      expect(allEvidence.has("evidence:E001")).toBe(true);
    }
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
    const first = await authClient.draftFromHeldCapture(
      capturedResult as AcquisitionCaptureResult,
      operatorMaterial(),
    );
    const second = await authClient.draftFromHeldCapture(
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
