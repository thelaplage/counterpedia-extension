import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  createHttpAcquisitionClient,
  type AcquisitionConfig,
} from "../src/lib/acquisitionClient";
import {
  createHttpAuthoringClient,
  type AuthoringConfig,
  type OperatorDraftMaterial,
} from "../src/lib/authoringClient";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";
import { projectAuthoringHandoffToReaderEntry } from "../src/lib/entryReadModelClient";
import { buildAuthoringProposalPreview } from "../src/lib/authoringProposalPreview";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "chrome-extension://draft-from-source-four-service-e2e";
const ACQ_TOKEN = "acq-four-service-e2e-token-0123456789";
const AUTH_TOKEN = "author-four-service-e2e-token-0123456789";
const FIXTURE_BYTES = Buffer.from(
  "<html><body>Literal four-service draft-from-source fixture bytes.</body></html>",
  "utf8",
);

function resolveDir(envName: string, relativeCandidates: string[], requiredPath: string): string | null {
  const candidates = [
    process.env[envName],
    ...relativeCandidates.map((candidate) => join(__dirname, candidate)),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(join(candidate, requiredPath))) ?? null;
}

const acquisitionDir = resolveDir(
  "COUNTERPEDIA_ACQUISITION_DIR",
  ["../../counterpedia-acquisition", "../../../repos/counterpedia-acquisition"],
  "scripts/run_acquisition_http_test_fixture.py",
);
const authoringDir = resolveDir(
  "COUNTERPEDIA_AUTHORING_DIR",
  ["../../counterpedia-authoring", "../../../repos/counterpedia-authoring"],
  "src/counterpedia_authoring/http_transport.py",
);
const counterpediaDir = resolveDir(
  "COUNTERPEDIA_DIR",
  ["../../counterpedia", "../../../repos/counterpedia"],
  "app/api/counterpedia/reader/proposal/route.ts",
);

const requireFourService =
  process.env["CP_DRAFT_E2E_REQUIRE"] === "1" ||
  process.env["CP_READER_E2E_REQUIRE"] === "1";

if ((!acquisitionDir || !authoringDir || !counterpediaDir) && requireFourService) {
  throw new Error(
    "[DRAFT-FROM-SOURCE FOUR-SERVICE E2E] REQUIRED but a checkout is unavailable — " +
      `acquisition=${acquisitionDir ?? "UNRESOLVED"}, ` +
      `authoring=${authoringDir ?? "UNRESOLVED"}, ` +
      `counterpedia=${counterpediaDir ?? "UNRESOLVED"}.`,
  );
}

const describeFourService = acquisitionDir && authoringDir && counterpediaDir ? describe : describe.skip;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

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
    const target = new URL(url);
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: init.method,
        headers: {
          ...init.headers,
          "Content-Length": Buffer.byteLength(init.body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(text),
            text: async () => text,
          });
        });
      },
    );
    request.on("error", reject);
    request.write(init.body);
    request.end();
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`service never became healthy: ${lastError}`);
}

async function waitForReader(endpoint: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (response.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Counterpedia reader route never became reachable: ${lastError}`);
}

function browserCapture(url: string): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture",
    spec_version: "v0.1",
    requested_url: url,
    current_url: url,
    canonical_url: url,
    document_title: "Four-service fixture",
    document_language: "en",
    meta_description: "four-service fixture page",
    json_ld: [],
    selected_text: "advisory selection only",
    main_text: "advisory main text",
    rendered_text: "advisory rendered text",
    captured_at: "2026-08-31T00:00:00Z",
  };
}

function operatorMaterial(): OperatorDraftMaterial {
  return {
    subjectSeed: "Portland Head Light",
    operatorObjective: "Produce a bounded proposal describing Portland Head Light.",
    candidateId: "src:draft-four-service-e2e",
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

/**
 * Exact application-profile migration exercised by EXT-DRAFT-SOURCE-V05-
 * ACTIVATE0. This deliberately does not put the semantic role on the generic
 * OperatorDraftMaterial type: buildDraftFromSourceRequest owns the one exact
 * migration from the shipped operator-standard@0.1.0 profile to the producer's
 * explicit recipe v0.2 desired_sections contract. Draft-from-URL remains legacy.
 */
function operatorMaterialV05(): OperatorDraftMaterial {
  return {
    ...operatorMaterial(),
    boundClaimIds: ["claim-name"],
    recipe: {
      recipe_id: "operator-standard",
      output_profile: "counterpedia.standard.v1",
      lead_policy_reference: "doctrine:authoring.proposal.v0.1",
      recipe_version: "0.1.0",
      desired_section_vocabulary: ["Background"],
    },
  };
}

describeFourService("DRAFT-FROM-SOURCE — literal same-run four-service loop", () => {
  let fixtureServer: Server;
  let acquisitionProcess: ChildProcess;
  let authoringProcess: ChildProcess;
  let counterpediaProcess: ChildProcess;
  let fixtureUrl = "";
  let acquisitionBase = "";
  let authoringBase = "";
  let readerEndpoint = "";
  let storeRoot = "";
  let acquisitionStderr = "";
  let authoringStderr = "";
  let counterpediaStderr = "";

  beforeAll(async () => {
    fixtureServer = createHttpServer((request, response) => {
      if ((request.url ?? "").split("?")[0] === "/page") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(FIXTURE_BYTES.length),
        });
        response.end(FIXTURE_BYTES);
      } else {
        response.writeHead(404, { "Content-Length": "0" });
        response.end();
      }
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
    const fixtureAddress = fixtureServer.address();
    const fixturePort = typeof fixtureAddress === "object" && fixtureAddress ? fixtureAddress.port : 0;
    fixtureUrl = `http://127.0.0.1:${fixturePort}/page`;

    storeRoot = mkdtempSync(join(tmpdir(), "cp-four-service-e2e-"));

    const acquisitionPort = await freePort();
    acquisitionBase = `http://127.0.0.1:${acquisitionPort}`;
    acquisitionProcess = spawn(
      "python3",
      [join(acquisitionDir!, "scripts/run_acquisition_http_test_fixture.py")],
      {
        cwd: acquisitionDir!,
        env: {
          ...process.env,
          PYTHONPATH: join(acquisitionDir!, "src"),
          CP_ACQUISITION_ALLOWED_ORIGIN: ORIGIN,
          CP_ACQUISITION_TRANSPORT_TOKEN: ACQ_TOKEN,
          CP_ACQUISITION_HTTP_HOST: "127.0.0.1",
          CP_ACQUISITION_HTTP_PORT: String(acquisitionPort),
          CP_ACQUISITION_HTTP_STORE_ROOT: storeRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    acquisitionProcess.stderr?.on("data", (chunk: Buffer) => {
      acquisitionStderr += chunk.toString();
    });

    const authoringPort = await freePort();
    authoringProcess = spawn(
      "python3",
      [
        join(__dirname, "support/authorHttpSourceHermeticRunner.py"),
        join(acquisitionDir!, "src"),
        storeRoot,
        String(authoringPort),
      ],
      {
        cwd: authoringDir!,
        env: { ...process.env, COUNTERPEDIA_AUTHORING_DIR: authoringDir! },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    authoringProcess.stderr?.on("data", (chunk: Buffer) => {
      authoringStderr += chunk.toString();
    });

    const boundAuthoringPort = await new Promise<number>((resolve, reject) => {
      let stdout = "";
      const timeout = setTimeout(
        () => reject(new Error(`authoring server never reported a port:\n${authoringStderr}`)),
        15_000,
      );
      authoringProcess.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const match = stdout.match(/PORT (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      authoringProcess.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`authoring server exited (${code}):\n${authoringStderr}`));
      });
    });
    authoringBase = `http://127.0.0.1:${boundAuthoringPort}`;

    const counterpediaPort = await freePort();
    readerEndpoint = `http://127.0.0.1:${counterpediaPort}/api/counterpedia/reader/proposal`;
    counterpediaProcess = spawn(
      "npm",
      ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(counterpediaPort)],
      {
        cwd: counterpediaDir!,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    counterpediaProcess.stderr?.on("data", (chunk: Buffer) => {
      counterpediaStderr += chunk.toString();
    });

    try {
      await Promise.all([
        waitForHealth(acquisitionBase),
        waitForHealth(authoringBase),
        waitForReader(readerEndpoint),
      ]);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n` +
          `acquisition stderr:\n${acquisitionStderr}\n` +
          `authoring stderr:\n${authoringStderr}\n` +
          `counterpedia stderr:\n${counterpediaStderr}`,
      );
    }
  }, 45_000);

  afterAll(async () => {
    for (const processHandle of [acquisitionProcess, authoringProcess, counterpediaProcess]) {
      if (processHandle && !processHandle.killed) processHandle.kill("SIGTERM");
    }
    if (fixtureServer) await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    if (storeRoot) rmSync(storeRoot, { recursive: true, force: true });
  });

  it("threads the exact fresh legacy Authoring handoff through Counterpedia and the extension preview", async () => {
    const acquisitionConfig: AcquisitionConfig = { baseUrl: acquisitionBase, token: ACQ_TOKEN };
    const acquisitionClient = createHttpAcquisitionClient({
      config: acquisitionConfig,
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const captured = await acquisitionClient.capture(browserCapture(fixtureUrl));
    expect(captured.kind).toBe("captured");
    if (captured.kind !== "captured") return;

    const authoringConfig: AuthoringConfig = { baseUrl: authoringBase, token: AUTH_TOKEN };
    const authoringClient = createHttpAuthoringClient({
      config: authoringConfig,
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const drafted = await authoringClient.draftFromHeldCapture(captured.result, operatorMaterial());
    expect(drafted.kind).toBe("assembled");
    if (drafted.kind !== "assembled") return;
    expect(drafted.handoff.authority_posture).toBe("proposal_only");

    const exactHandoffDigest = drafted.handoff.handoff_digest;
    expect(exactHandoffDigest).toBeTruthy();

    // Load-bearing coupling: the EXACT handoff object emitted above is
    // serialized by the extension's real reader client to the REAL
    // Counterpedia projection route in this same executable run.
    const entry = await projectAuthoringHandoffToReaderEntry(
      drafted.handoff,
      globalThis.fetch,
      readerEndpoint,
    );
    expect(entry.posture).toBe("proposal");
    expect(entry.sourceKind).toBe("authoring_proposal");
    expect(entry.leadBlocks?.[0]?.evidenceRefs).toContain("evidence:E001");

    const provenance = entry.sections.provenance?.find(
      (record) => record.family === "authoring_proposal_handoff",
    );
    expect(provenance?.detail["handoff_digest"]).toBe(exactHandoffDigest);
    expect(provenance?.detail["evidence_basis_refs"]).toContain("evidence:E001");

    // The canonical model is then consumed by the extension's ACTUAL compact
    // layout projector — no raw draft_proposal interpretation here.
    const preview = buildAuthoringProposalPreview(entry);
    expect(preview.title).toBeTruthy();
    expect(preview.leadBlocks[0]?.evidenceRefs).toContain("evidence:E001");
    expect(preview.evidenceBasisRefs).toContain("evidence:E001");
    expect(preview.handoffDigest).toBe(exactHandoffDigest);
    expect(preview.handoffDigest).not.toBe("projection:unavailable");

    expect(entry).not.toHaveProperty("admitted");
    expect(entry).not.toHaveProperty("published");
    expect(entry).not.toHaveProperty("standing");
  }, 45_000);

  it("threads the exact fresh v0.5 role-bearing + completeness handoff through the canonical reader", async () => {
    const acquisitionConfig: AcquisitionConfig = { baseUrl: acquisitionBase, token: ACQ_TOKEN };
    const acquisitionClient = createHttpAcquisitionClient({
      config: acquisitionConfig,
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const captured = await acquisitionClient.capture(browserCapture(fixtureUrl));
    expect(captured.kind).toBe("captured");
    if (captured.kind !== "captured") return;

    const authoringConfig: AuthoringConfig = { baseUrl: authoringBase, token: AUTH_TOKEN };
    const authoringClient = createHttpAuthoringClient({
      config: authoringConfig,
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const drafted = await authoringClient.draftFromHeldCapture(captured.result, operatorMaterialV05());
    expect(drafted.kind).toBe("assembled");
    if (drafted.kind !== "assembled") return;

    const handoff = drafted.handoff as unknown as Record<string, unknown>;
    expect(handoff["schema_version"]).toBe("authoring_admission_handoff.v0.5");
    expect(handoff["authority_posture"]).toBe("proposal_only");
    expect(handoff["draft_completeness_binding"]).toBeTruthy();
    const draft = handoff["draft_proposal"] as Record<string, unknown>;
    expect(draft["schema_version"]).toBe("draft_entry_proposal.v0.3");

    const exactHandoffDigest = drafted.handoff.handoff_digest;
    expect(exactHandoffDigest).toBeTruthy();

    // Same-run load-bearing coupling: the exact v0.5 object accepted by the
    // extension guard is posted unchanged to the real Counterpedia reader.
    const entry = await projectAuthoringHandoffToReaderEntry(
      drafted.handoff,
      globalThis.fetch,
      readerEndpoint,
    );
    expect(entry.posture).toBe("proposal");
    expect(entry.sourceKind).toBe("authoring_proposal");
    expect(entry.lifecycle).toBe("proposal");
    expect(entry.leadBlocks?.[0]?.evidenceRefs).toContain("evidence:E001");

    const background = entry.articleSections?.find((section) => section.title === "Background") as
      | ({ role?: string; blocks: readonly { evidenceRefs: readonly string[] }[] })
      | undefined;
    expect(background).toBeTruthy();
    expect(background?.role).toBe("background");
    expect(background?.blocks[0]?.evidenceRefs).toContain("evidence:E001");

    const provenance = entry.sections.provenance?.find(
      (record) => record.family === "authoring_proposal_handoff",
    );
    expect(provenance?.detail["handoff_digest"]).toBe(exactHandoffDigest);
    expect(provenance?.detail["evidence_basis_refs"]).toContain("evidence:E001");

    const preview = buildAuthoringProposalPreview(entry);
    expect(preview.title).toBe("Draft-from-source E2E fixture");
    expect(preview.leadBlocks[0]?.evidenceRefs).toContain("evidence:E001");
    expect(preview.evidenceBasisRefs).toContain("evidence:E001");
    expect(preview.handoffDigest).toBe(exactHandoffDigest);
    expect(preview.handoffDigest).not.toBe("projection:unavailable");

    // Completeness and role transport are additive structural signals only.
    // The transaction remains proposal-only throughout.
    expect(entry).not.toHaveProperty("admitted");
    expect(entry).not.toHaveProperty("published");
    expect(entry).not.toHaveProperty("standing");
    expect(entry).not.toHaveProperty("verification");
  }, 45_000);
});
