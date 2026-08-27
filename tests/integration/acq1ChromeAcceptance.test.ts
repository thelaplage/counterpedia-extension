import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type JsonTarget = {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

type CdpRecord = {
  url: string;
  method: string;
  headers: Record<string, unknown>;
};

type CdpConnection = {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
  on(event: string, handler: (payload: any) => void): void;
};

const CHROME_ACCEPTANCE = process.env["COUNTERPEDIA_CHROME_ACCEPTANCE"] === "1";
const acceptanceDescribe = CHROME_ACCEPTANCE ? describe : describe.skip;

const ACQUISITION_CANDIDATE_HEAD = "ef285bf447b19d8b5962bf0ea1f9bc1c3e3adb55";
const TEST_TOKEN = "ext-acq1-chrome-acceptance-token";

const sourcePageABytes = Buffer.from(
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>ACQ1 Page A</title><link rel=\"canonical\" href=\"http://127.0.0.1/page-a\"></head><body><main>ACQ1 page A bytes.</main></body></html>",
  "utf8",
);
const sourcePageBBytes = Buffer.from(
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>ACQ1 Page B</title><link rel=\"canonical\" href=\"http://127.0.0.1/page-b\"></head><body><main>ACQ1 page B bytes.</main></body></html>",
  "utf8",
);

function chromeBinary(): string {
  return (
    process.env["CHROME_BIN"] ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );
}

function acquisitionRepo(): string {
  const repo = process.env["COUNTERPEDIA_ACQUISITION_REPO"] ?? "";
  if (!repo) {
    throw new Error("COUNTERPEDIA_ACQUISITION_REPO is required for the Chrome acceptance test");
  }
  return repo;
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

function connectCdp(webSocketUrl: string): Promise<CdpConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl);
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const listeners = new Map<string, Set<(payload: any) => void>>();
    let nextId = 1;

    const connection: CdpConnection = {
      send(method, params = {}) {
        return new Promise((sendResolve, sendReject) => {
          const id = nextId++;
          pending.set(id, {
            resolve: sendResolve as (value: unknown) => void,
            reject: sendReject,
          });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() {
        return new Promise((closeResolve) => {
          ws.addEventListener("close", () => closeResolve(), { once: true });
          ws.close();
        });
      },
      on(event, handler) {
        const set = listeners.get(event) ?? new Set();
        set.add(handler);
        listeners.set(event, set);
      },
    };

    ws.addEventListener("open", () => resolve(connection), { once: true });
    ws.addEventListener("error", () => reject(new Error(`failed to connect to CDP websocket ${webSocketUrl}`)), {
      once: true,
    });
    ws.addEventListener("message", (raw) => {
      const message = JSON.parse(String(raw.data)) as Record<string, unknown>;
      if (typeof message.id === "number") {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(JSON.stringify(message.error)));
        } else {
          entry.resolve(message.result);
        }
        return;
      }
      const method = message.method;
      if (typeof method !== "string") return;
      const set = listeners.get(method);
      if (!set) return;
      for (const handler of set) {
        handler(message.params);
      }
    });
  });
}

function waitFor<T>(fn: () => Promise<T> | T, predicate: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await fn();
        if (predicate(value)) {
          resolve(value);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error("timed out waiting for condition"));
          return;
        }
        setTimeout(() => void tick(), 250);
      } catch (error) {
        reject(error);
      }
    };
    void tick();
  });
}

async function waitForFile(path: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function chromeVersionEndpoint(port: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) {
    throw new Error(`chrome debug endpoint returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!payload.webSocketDebuggerUrl) {
    throw new Error("chrome debug endpoint did not expose webSocketDebuggerUrl");
  }
  return payload.webSocketDebuggerUrl;
}

async function chromeTargets(port: string): Promise<JsonTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`chrome target list returned HTTP ${response.status}`);
  }
  return (await response.json()) as JsonTarget[];
}

async function waitForTarget(port: string, predicate: (target: JsonTarget) => boolean): Promise<JsonTarget> {
  return waitFor(
    () => chromeTargets(port),
    (targets) => targets.some(predicate),
    30_000,
  ).then((targets) => {
    const target = targets.find(predicate);
    if (!target) {
      throw new Error("target not found");
    }
    return target;
  });
}

function readHeader(headers: Record<string, unknown>, name: string): string | null {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!entry) return null;
  return typeof entry[1] === "string" ? entry[1] : null;
}

async function launchChrome(extensionDir: string): Promise<{
  child: ChildProcess;
  userDataDir: string;
  debugPort: string;
  browserWs: string;
}> {
  const binary = chromeBinary();
  if (!existsSync(binary)) {
    throw new Error(`Chrome binary not found: ${binary}`);
  }
  const userDataDir = await mkdtemp(join(tmpdir(), "counterpedia-chrome-"));
  const child = spawn(
    binary,
    [
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "about:blank",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );

  try {
    const devToolsActivePort = join(userDataDir, "DevToolsActivePort");
    await waitForFile(devToolsActivePort);
    const [portLine] = readFileSync(devToolsActivePort, "utf8").split("\n");
    if (!portLine) {
      throw new Error("Chrome DevToolsActivePort did not expose a debugging port");
    }
    const debugPort = portLine.trim();
    const browserWs = await waitFor(
      () => chromeVersionEndpoint(debugPort),
      (value) => value.length > 0,
      30_000,
    );
    return { child, userDataDir, debugPort, browserWs };
  } catch (error) {
    await stopChild(child);
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

function startSourceServer(delayPageAms: number): Promise<{
  server: Server;
  port: number;
  pageA: string;
  pageB: string;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const path = req.url?.split("?", 1)[0] ?? "/";
      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Length": "0" });
        res.end();
        return;
      }
      if (path === "/page-a") {
        const body = sourcePageABytes;
        const finish = () => {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": String(body.length),
          });
          res.end(body);
        };
        if (delayPageAms > 0) {
          setTimeout(finish, delayPageAms);
        } else {
          finish();
        }
        return;
      }
      if (path === "/page-b") {
        const body = sourcePageBBytes;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(body.length),
        });
        res.end(body);
        return;
      }
      if (path === "/favicon.ico") {
        res.writeHead(404, { "Content-Length": "0" });
        res.end();
        return;
      }
      res.writeHead(404, { "Content-Length": "0" });
      res.end();
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("source server did not expose an IP port"));
        return;
      }
      const pageA = `http://127.0.0.1:${address.port}/page-a`;
      const pageB = `http://127.0.0.1:${address.port}/page-b`;
      resolve({ server, port: address.port, pageA, pageB });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function startAcquisitionServer(repo: string, origin: string): Promise<{
  child: ChildProcess;
  endpoint: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["scripts/run_acquisition_http.py"], {
      cwd: repo,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        CP_ACQUISITION_ALLOWED_ORIGIN: origin,
        CP_ACQUISITION_TRANSPORT_TOKEN: TEST_TOKEN,
        CP_ACQUISITION_HTTP_HOST: "127.0.0.1",
        CP_ACQUISITION_HTTP_PORT: "0",
        // TEST-ONLY: the fixture source pages below are served from loopback,
        // so the real (correct, default-on) SSRF egress boundary must be
        // explicitly relaxed for this subprocess. Never set in production or
        // the demo build.
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

async function openBrowserTarget(browserWs: string, url: string, background: boolean): Promise<string> {
  const browser = await connectCdp(browserWs);
  try {
    const result = await browser.send<{ targetId: string }>("Target.createTarget", {
      url,
      background,
    });
    return result.targetId;
  } finally {
    await browser.close();
  }
}

async function activateTarget(browserWs: string, targetId: string): Promise<void> {
  const browser = await connectCdp(browserWs);
  try {
    await browser.send("Target.activateTarget", { targetId });
  } finally {
    await browser.close();
  }
}

async function connectTarget(port: string, targetId: string): Promise<CdpConnection> {
  const target = await waitForTarget(port, (candidate) => candidate.id === targetId);
  return connectCdp(target.webSocketDebuggerUrl);
}

async function pageText(page: CdpConnection, selector: string): Promise<string> {
  const result = (await page.send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
    returnByValue: true,
  })) as { result?: { value?: string } };
  return String(result.result?.value ?? "");
}

async function setInputValue(page: CdpConnection, selector: string, value: string): Promise<void> {
  await page.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("missing input");
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
    awaitPromise: true,
  });
}

async function clickSelector(page: CdpConnection, selector: string): Promise<void> {
  const result = (await page.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: { x: number; y: number; width: number; height: number } } };
  const rect = result.result?.value;
  if (!rect) {
    throw new Error(`missing element: ${selector}`);
  }
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "left",
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function pageLoaded(page: CdpConnection): Promise<void> {
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await waitFor(
    async () => {
      const result = (await page.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      })) as { result?: { value?: string } };
      return String(result.result?.value ?? "");
    },
    (readyState) => readyState === "complete" || readyState === "interactive",
    30_000,
  );
}

async function waitForText(page: CdpConnection, selector: string, expected: string): Promise<void> {
  await waitFor(() => pageText(page, selector), (text) => text.includes(expected), 30_000);
}

async function waitForAcqRequestHeaders(
  records: CdpRecord[],
  endpoint: string,
): Promise<{ post: CdpRecord; preflight: CdpRecord }> {
  return waitFor(
    () => records,
    (current) =>
      current.some((record) => record.method === "POST" && record.url === endpoint) &&
      current.some((record) => record.method === "OPTIONS" && record.url === endpoint),
    30_000,
  ).then((current) => {
    const post = current.find((record) => record.method === "POST" && record.url === endpoint);
    const preflight = current.find((record) => record.method === "OPTIONS" && record.url === endpoint);
    if (!post || !preflight) {
      throw new Error("missing ACQ1 request records");
    }
    return { post, preflight };
  });
}

acceptanceDescribe("EXT-ACQ1 Chrome MV3 acceptance", () => {
  it(
    "captures real browser-origin bytes and renders the acquisition receipt",
    async () => {
      const repo = acquisitionRepo();
      assertPinnedAcquisitionCheckout(repo);

      const extensionDir = join(process.cwd(), "dist");
      if (!existsSync(join(extensionDir, "manifest.json"))) {
        throw new Error("build output missing; run npm run build:demo before the Chrome acceptance test");
      }

  const chrome = await launchChrome(extensionDir);
  const sourceServer = await startSourceServer(0);
  let acqChild: ChildProcess | null = null;
  const browserTargets = await connectCdp(chrome.browserWs);
  let sourcePage: CdpConnection | null = null;
  let panelPage: CdpConnection | null = null;
  const requestRecords: CdpRecord[] = [];

      try {
        await browserTargets.send("Target.setDiscoverTargets", { discover: true });
        const serviceWorker = await waitForTarget(
          chrome.debugPort,
          (target) => target.type === "service_worker" && target.url.includes("service-worker.js"),
        );
        const extensionId = new URL(serviceWorker.url).host;
        const extensionOrigin = `chrome-extension://${extensionId}`;

        const acq = await startAcquisitionServer(repo, extensionOrigin);
        acqChild = acq.child;

        const sourceTargetId = await openBrowserTarget(chrome.browserWs, sourceServer.pageA, false);
        await activateTarget(chrome.browserWs, sourceTargetId);
        sourcePage = await connectTarget(chrome.debugPort, sourceTargetId);
        await pageLoaded(sourcePage);

        const panelTargetId = await openBrowserTarget(
          chrome.browserWs,
          `chrome-extension://${extensionId}/panel/index.html`,
          true,
        );
        await activateTarget(chrome.browserWs, sourceTargetId);
        panelPage = await connectTarget(chrome.debugPort, panelTargetId);
        await pageLoaded(panelPage);
        await panelPage.send("Network.enable");
        panelPage.on("Network.requestWillBeSent", (event) => {
          const params = event as {
            request?: { url?: string; method?: string; headers?: Record<string, unknown> };
          };
          const request = params.request;
          if (!request?.url || !request.method || !request.headers) return;
          requestRecords.push({
            url: request.url,
            method: request.method,
            headers: request.headers,
          });
        });

        await setInputValue(panelPage, "#sw-acquisition-token", TEST_TOKEN);
        await clickSelector(panelPage, "#sw-acquisition-token-save");
        await waitForText(panelPage, "#sw-acquisition-status", "ready after explicit capture");

        await clickSelector(panelPage, "#capture-btn");

        const expectedDigest = `sha256:${createHash("sha256").update(sourcePageABytes).digest("hex")}`;
        const { post, preflight } = await waitForAcqRequestHeaders(requestRecords, acq.endpoint);

        expect(readHeader(preflight.headers, "Origin")).toBe(extensionOrigin);
        expect(readHeader(preflight.headers, "Access-Control-Request-Method")).toBe("POST");
        const acRequestHeaders = readHeader(preflight.headers, "Access-Control-Request-Headers") ?? "";
        expect(acRequestHeaders.toLowerCase()).toContain("content-type");
        expect(acRequestHeaders.toLowerCase()).toContain("x-counterpedia-transport-token");

        expect(readHeader(post.headers, "Origin")).toBe(extensionOrigin);
        expect(readHeader(post.headers, "X-Counterpedia-Transport-Token")).toBe(TEST_TOKEN);

        await waitForText(panelPage, "#sw-acquisition-status", "Acquisition capture receipt: available");
        await waitForText(panelPage, "#sw-acquisition-digest", expectedDigest);
        await waitForText(panelPage, "#sw-acquisition-source", sourceServer.pageA);

        expect(await pageText(panelPage, "#sw-acquisition-status")).toBe(
          "Acquisition capture receipt: available",
        );
        expect(await pageText(panelPage, "#sw-acquisition-digest")).toBe(
          `exact bytes: ${expectedDigest}`,
        );
        expect(await pageText(panelPage, "#sw-acquisition-source")).toBe(
          `source locator: ${sourceServer.pageA}`,
        );
        expect(await pageText(panelPage, "#sw-receipt-label")).toBe(
          "Counterpedia source-work receipt: not yet available",
        );
        expect(await pageText(panelPage, "#sw-acquisition")).toContain(
          "SRS source-capture receipt: not represented",
        );
        expect(await pageText(panelPage, "#sw-acquisition")).toContain("Admission: not established");
      } finally {
        if (panelPage) await panelPage.close();
        if (sourcePage) await sourcePage.close();
        if (acqChild) await stopChild(acqChild);
        await browserTargets.close();
        await closeServer(sourceServer.server);
        await stopChild(chrome.child);
        rmSync(chrome.userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    "drops a delayed acquisition result after navigation to page B",
    async () => {
      const repo = acquisitionRepo();
      assertPinnedAcquisitionCheckout(repo);

      const extensionDir = join(process.cwd(), "dist");
      if (!existsSync(join(extensionDir, "manifest.json"))) {
        throw new Error("build output missing; run npm run build:demo before the Chrome acceptance test");
      }

  const chrome = await launchChrome(extensionDir);
  const sourceServer = await startSourceServer(2_500);
  let acqChild: ChildProcess | null = null;
  const browserTargets = await connectCdp(chrome.browserWs);
  let sourcePage: CdpConnection | null = null;
  let panelPage: CdpConnection | null = null;

      try {
        await browserTargets.send("Target.setDiscoverTargets", { discover: true });
        const serviceWorker = await waitForTarget(
          chrome.debugPort,
          (target) => target.type === "service_worker" && target.url.includes("service-worker.js"),
        );
        const extensionId = new URL(serviceWorker.url).host;
        const extensionOrigin = `chrome-extension://${extensionId}`;

        const acq = await startAcquisitionServer(repo, extensionOrigin);
        acqChild = acq.child;

        const sourceTargetId = await openBrowserTarget(chrome.browserWs, sourceServer.pageA, false);
        await activateTarget(chrome.browserWs, sourceTargetId);
        sourcePage = await connectTarget(chrome.debugPort, sourceTargetId);
        await pageLoaded(sourcePage);

        const panelTargetId = await openBrowserTarget(
          chrome.browserWs,
          `chrome-extension://${extensionId}/panel/index.html`,
          true,
        );
        await activateTarget(chrome.browserWs, sourceTargetId);
        panelPage = await connectTarget(chrome.debugPort, panelTargetId);
        await pageLoaded(panelPage);

        await setInputValue(panelPage, "#sw-acquisition-token", TEST_TOKEN);
        await clickSelector(panelPage, "#sw-acquisition-token-save");
        await waitForText(panelPage, "#sw-acquisition-status", "ready after explicit capture");

        await panelPage.send("Network.enable");
        await clickSelector(panelPage, "#capture-btn");

        await waitForText(panelPage, "#sw-acquisition-status", "acquiring exact HTTP bytes");

        await sourcePage.send("Page.navigate", { url: sourceServer.pageB });
        await activateTarget(chrome.browserWs, sourceTargetId);
        await pageLoaded(sourcePage);
        await waitForText(panelPage, "#sw-acquisition-status", "ready after explicit capture");

        const expectedDigest = `sha256:${createHash("sha256").update(sourcePageABytes).digest("hex")}`;
        await waitFor(
          async () => pageText(panelPage!, "#sw-acquisition-digest"),
          (text) => text === "",
          30_000,
        );
        expect(await pageText(panelPage!, "#sw-acquisition-digest")).toBe("");
        expect(await pageText(panelPage!, "#sw-acquisition-source")).toBe("");
        expect(await pageText(panelPage!, "#sw-receipt-label")).toBe(
          "Counterpedia source-work receipt: not yet available",
        );
        expect(await pageText(panelPage!, "#sw-acquisition")).not.toContain(expectedDigest);
        expect(await pageText(panelPage!, "#sw-acquisition")).toContain(
          "SRS source-capture receipt: not represented",
        );
        expect(await pageText(panelPage!, "#sw-acquisition")).toContain("Admission: not established");
        expect(await pageText(panelPage!, "#sw-title")).toBe("ACQ1 Page B");
      } finally {
        if (panelPage) await panelPage.close();
        if (sourcePage) await sourcePage.close();
        if (acqChild) await stopChild(acqChild);
        await browserTargets.close();
        await closeServer(sourceServer.server);
        await stopChild(chrome.child);
        rmSync(chrome.userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
