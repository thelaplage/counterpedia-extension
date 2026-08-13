/**
 * EXT-ACQ1 cross-process producer-consumer exact-byte proof.
 *
 * This test is intentionally opt-in because counterpedia-extension does not
 * vendor the Python acquisition producer. When COUNTERPEDIA_ACQUISITION_REPO is
 * set, the test FAILS unless that checkout is at the exact candidate head pinned
 * below, then spawns the real ACQ1 server from that checkout.
 *
 * Proven path when exercised:
 *
 *   TS BrowserPageCapture
 *     -> EXT-ACQ1 fetch client
 *     -> real Python localhost HTTP transport
 *     -> resolve_browser_capture_source()
 *     -> AcquisitionMcpSurface.capture_url()
 *     -> real HttpFetcher
 *     -> this test's real local HTTP source fixture
 *     -> exact captured bytes / CaptureReceipt
 *     -> strict TS CaptureUrlResult validator
 *
 * No model, SRS, admission, standing, or publication path is involved.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { BrowserPageCapture } from "../../src/lib/browserPageCapture";
import { acquireBrowserPageCapture } from "../../src/lib/acquisitionTransport";

const ACQUISITION_CANDIDATE_HEAD = "ef285bf447b19d8b5962bf0ea1f9bc1c3e3adb55";
const TEST_ORIGIN = "chrome-extension://extacq1integrationfixture";
const TEST_TOKEN = "ext-acq1-integration-token";
const SOURCE_BYTES = Buffer.from(
  "<html><body>EXT-ACQ1 exact-byte cross-process fixture.</body></html>",
  "utf8",
);

const acquisitionRepo = process.env["COUNTERPEDIA_ACQUISITION_REPO"] ?? "";
const integrationDescribe = acquisitionRepo ? describe : describe.skip;

function startSourceServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/source") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(SOURCE_BYTES.length),
        });
        res.end(SOURCE_BYTES);
        return;
      }
      res.writeHead(404, { "Content-Length": "0" });
      res.end();
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("source fixture did not expose an IP port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/source` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function assertPinnedAcquisitionCheckout(repo: string): void {
  if (!existsSync(join(repo, "scripts", "run_acquisition_http.py"))) {
    throw new Error(`COUNTERPEDIA_ACQUISITION_REPO is not an acquisition checkout: ${repo}`);
  }
  const probe = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    throw new Error(`unable to resolve acquisition HEAD: ${probe.stderr}`);
  }
  const actual = probe.stdout.trim();
  if (actual !== ACQUISITION_CANDIDATE_HEAD) {
    throw new Error(
      `acquisition checkout drift: expected ${ACQUISITION_CANDIDATE_HEAD}, got ${actual}`,
    );
  }
}

function startAcquisitionServer(repo: string): Promise<{
  child: ChildProcess;
  endpoint: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["scripts/run_acquisition_http.py"], {
      cwd: repo,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        CP_ACQUISITION_ALLOWED_ORIGIN: TEST_ORIGIN,
        CP_ACQUISITION_TRANSPORT_TOKEN: TEST_TOKEN,
        CP_ACQUISITION_HTTP_HOST: "127.0.0.1",
        CP_ACQUISITION_HTTP_PORT: "0",
        // TEST-ONLY: the fixture "source" server below simulates a remote site
        // but is itself on loopback, so the real (correct, default-on) SSRF
        // egress boundary must be explicitly relaxed for this subprocess.
        // Never set in production or the demo build.
        CP_ACQUISITION_HTTP_EGRESS_TEST_PERMISSIVE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`timed out starting ACQ1 server; stdout=${stdout} stderr=${stderr}`));
    }, 10_000);

    if (!child.stdout || !child.stderr) {
      clearTimeout(timer);
      child.kill("SIGTERM");
      reject(new Error("ACQ1 subprocess did not expose stdout/stderr pipes"));
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(
        /acquisition HTTP transport listening on (http:\/\/127\.0\.0\.1:\d+)/,
      );
      if (match && !settled) {
        const endpoint = match[1];
        if (!endpoint) {
          reject(new Error(`ACQ1 server did not report a listen endpoint; stdout=${stdout}`));
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ child, endpoint });
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`ACQ1 server exited before ready (${code}); stderr=${stderr}`));
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function bpc(sourceUrl: string): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture",
    spec_version: "v0.1",
    requested_url: sourceUrl,
    current_url: sourceUrl,
    canonical_url: sourceUrl,
    document_title: "EXT-ACQ1 cross-process fixture",
    document_language: "en",
    meta_description: null,
    json_ld: [],
    selected_text: "browser hint only",
    main_text: "THIS MUST NEVER BECOME SOURCE BYTES",
    rendered_text: "THIS MUST NEVER BECOME SOURCE BYTES",
    captured_at: "2026-08-12T22:00:00Z",
  };
}

integrationDescribe("EXT-ACQ1 cross-process producer-consumer exact-byte proof", () => {
  it(
    "drives the real Python producer and independently matches exact fetched bytes",
    async () => {
      assertPinnedAcquisitionCheckout(acquisitionRepo);
      const source = await startSourceServer();
      let child: ChildProcess | null = null;
      try {
        const acquisition = await startAcquisitionServer(acquisitionRepo);
        child = acquisition.child;

        // Browsers own the Origin header. Node's fetch has no extension origin, so
        // the integration wrapper supplies the exact browser-origin value solely
        // to emulate that browser transport fact; production client code does not
        // forge Origin.
        const browserOriginFetch: typeof fetch = (input, init = {}) => {
          const headers = new Headers(init.headers);
          headers.set("Origin", TEST_ORIGIN);
          return fetch(input, { ...init, headers });
        };

        const result = await acquireBrowserPageCapture(bpc(source.url), TEST_TOKEN, {
          endpoint: acquisition.endpoint,
          fetchImpl: browserOriginFetch,
          timeoutMs: 35_000,
        });

        expect(result.capture_status).toBe("captured");
        if (result.capture_status !== "captured") throw new Error("capture did not succeed");

        const expectedDigest = `sha256:${createHash("sha256").update(SOURCE_BYTES).digest("hex")}`;
        expect(result.captured_object_address).toBe(expectedDigest);
        expect(result.capture_receipt.exact_bytes_sha256).toBe(expectedDigest);
        expect(result.byte_count).toBe(SOURCE_BYTES.length);
        expect(result.source_locator).toBe(source.url);

        // The BrowserPageCapture's rendered text must not become authoritative
        // bytes. If it had, this independent digest could not match SOURCE_BYTES.
        expect(expectedDigest).not.toBe(
          `sha256:${createHash("sha256")
            .update("THIS MUST NEVER BECOME SOURCE BYTES")
            .digest("hex")}`,
        );

        const serialized = JSON.stringify(result).toLowerCase();
        for (const forbidden of ["srs", "admitted", "standing", "publication", "trust_score"]) {
          expect(serialized).not.toContain(forbidden);
        }
      } finally {
        if (child) await stopChild(child);
        await closeServer(source.server);
      }
    },
    60_000,
  );
});
