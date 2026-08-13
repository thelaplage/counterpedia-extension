/**
 * HTTP-01 — real cross-process browser→acquisition loop.
 *
 * This test mocks NOTHING on the acquisition side. It:
 *   1. spawns the REAL Python acquisition HTTP server (counterpedia-acquisition);
 *   2. starts a deterministic local fixture HTTP source;
 *   3. drives the REAL extension acquisition client + response guard, which posts
 *      the {browser_page_capture} envelope with the transport token;
 *   4. the real producer re-fetches the fixture bytes and returns a CaptureReceipt;
 *   5. asserts the digest independently, and that the terminal state is UNADMITTED.
 *
 * The client's low-level transport is swapped for a node:http adapter ONLY so the
 * (browser-forbidden) Origin header actually reaches the server — in the real
 * extension the browser sets Origin automatically. The envelope construction,
 * token header, response guard, and state derivation are all the real code path.
 *
 * Requires a real counterpedia-acquisition checkout. Resolution order:
 * COUNTERPEDIA_ACQUISITION_DIR, then sibling guesses. If none is found the suite
 * SKIPS with a loud warning (the loop is NOT exercised) rather than passing hollow.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest, createServer as createHttpServer, type Server } from "node:http";
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
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ORIGIN = "chrome-extension://acq1-http-test";
const TOKEN = "e2e-transport-token-0123456789";
const FIXTURE_BYTES = Buffer.from(
  "<html><body>ACQ1-HTTP cross-process fixture bytes.</body></html>",
  "utf-8",
);
const EXPECTED_SHA256 =
  "sha256:" + createHash("sha256").update(FIXTURE_BYTES).digest("hex");

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

/** node:http POST adapter with the fetch-like shape the client expects. */
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
        headers: { ...init.headers, "Content-Length": Buffer.byteLength(init.body) },
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
  throw new Error(`acquisition server never became healthy: ${lastErr}`);
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
    captured_at: "2026-08-12T00:00:00Z",
  };
}

const acqDir = resolveAcquisitionDir();
if (!acqDir) {
  // eslint-disable-next-line no-console
  console.warn(
    "[ACQ1-HTTP E2E] SKIPPED: no counterpedia-acquisition checkout found " +
      "(set COUNTERPEDIA_ACQUISITION_DIR). The real browser→producer loop was " +
      "NOT exercised in this run.",
  );
}
const describeE2E = acqDir ? describe : describe.skip;

describeE2E("HTTP-01 — real cross-process browser→acquisition loop", () => {
  let py: ChildProcess;
  let fixture: Server;
  let serverBase = "";
  let fixtureUrl = "";
  const fixtureHits: string[] = [];
  let pyStderr = "";

  beforeAll(async () => {
    // Deterministic local source the producer will re-fetch.
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

    // Spawn the REAL Python acquisition server on a free loopback port.
    const port = await freePort();
    serverBase = `http://127.0.0.1:${port}`;
    py = spawn("python3", [join(acqDir!, "scripts/run_acquisition_http.py")], {
      cwd: acqDir!,
      env: {
        ...process.env,
        PYTHONPATH: join(acqDir!, "src"),
        CP_ACQUISITION_ALLOWED_ORIGIN: ORIGIN,
        CP_ACQUISITION_TRANSPORT_TOKEN: TOKEN,
        CP_ACQUISITION_HTTP_HOST: "127.0.0.1",
        CP_ACQUISITION_HTTP_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    py.stderr?.on("data", (c: Buffer) => (pyStderr += c.toString()));

    try {
      await waitForHealth(serverBase, 15_000);
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : err}\npython stderr:\n${pyStderr}`,
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (py && !py.killed) py.kill("SIGTERM");
    if (fixture) await new Promise<void>((r) => fixture.close(() => r()));
  });

  it("captures real bytes through the full boundary and stays UNADMITTED", async () => {
    const config: AcquisitionConfig = { baseUrl: serverBase, token: TOKEN };
    const client = createHttpAcquisitionClient({
      config,
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });

    const outcome = await client.capture(e2eBpc(fixtureUrl));

    expect(outcome.kind).toBe("captured");
    if (outcome.kind !== "captured") return;

    // The producer actually re-fetched the fixture bytes.
    expect(fixtureHits).toContain("/page");

    // Digest independently verifiable against the fixture bytes.
    expect(outcome.result.captured_object_address).toBe(EXPECTED_SHA256);
    expect(outcome.result.capture_receipt?.["exact_bytes_sha256"]).toBe(
      EXPECTED_SHA256,
    );
    expect(outcome.result.byte_count).toBe(FIXTURE_BYTES.length);
    expect(outcome.result.source_locator).toBe(fixtureUrl);

    // Identity fields are producer-created (present, non-empty).
    expect(typeof outcome.result.capture_id).toBe("string");
    expect(outcome.result.capture_id?.length).toBeGreaterThan(0);

    // Terminal product posture: UNADMITTED. No admission/verification/publication.
    const render = renderAcquisitionResult(outcome.result);
    expect(render.state).toBe("UNADMITTED");
    expect(render.anchorState).toBe("UNAVAILABLE");
  }, 30_000);

  it("rejects a wrong transport token before the producer runs (HTTP-06 live)", async () => {
    const client = createHttpAcquisitionClient({
      config: { baseUrl: serverBase, token: "wrong-token" },
      fetchImpl: nodeHttpFetch,
      originHeader: ORIGIN,
    });
    const before = fixtureHits.length;
    const outcome = await client.capture(e2eBpc(fixtureUrl));
    expect(outcome.kind).toBe("transport_error");
    if (outcome.kind === "transport_error") expect(outcome.status).toBe(401);
    // The producer must not have fetched anything on a rejected request.
    expect(fixtureHits.length).toBe(before);
  }, 30_000);
});
