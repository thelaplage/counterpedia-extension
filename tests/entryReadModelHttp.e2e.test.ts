import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";

import type { AuthoringHandoff } from "../src/lib/authoringResponseGuard";
import { projectAuthoringHandoffToReaderEntry } from "../src/lib/entryReadModelClient";

function resolveCounterpediaDir(): string | null {
  const candidates = [
    process.env["COUNTERPEDIA_DIR"],
    join(process.cwd(), "../counterpedia"),
    join(process.cwd(), "../../repos/counterpedia"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "app/api/counterpedia/reader/proposal/route.ts")) &&
      existsSync(join(candidate, "lib/counterpedia/__fixtures__/authoringHandoff.evidenceE001.json"))
    ) {
      return candidate;
    }
  }
  return null;
}

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

async function waitForProjectionRoute(endpoint: string, timeoutMs: number): Promise<void> {
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
  throw new Error(`Counterpedia proposal route never became reachable: ${lastError}`);
}

const counterpediaDir = resolveCounterpediaDir();
const requireReaderE2E = process.env["CP_READER_E2E_REQUIRE"] === "1";

if (!counterpediaDir && requireReaderE2E) {
  throw new Error(
    "[COUNTERPEDIA READER HTTP E2E] REQUIRED but Counterpedia is unavailable — " +
      "set COUNTERPEDIA_DIR to a checkout containing the proposal reader route and golden fixture.",
  );
}

const describeReaderE2E = counterpediaDir ? describe : describe.skip;

describeReaderE2E("Counterpedia canonical proposal projection — real HTTP / committed-fixture leg", () => {
  let counterpediaProcess: ChildProcess;
  let endpoint = "";
  let stderr = "";
  let fixture: AuthoringHandoff;

  beforeAll(async () => {
    const port = await freePort();
    endpoint = `http://127.0.0.1:${port}/api/counterpedia/reader/proposal`;

    const fixturePath = join(
      counterpediaDir!,
      "lib/counterpedia/__fixtures__/authoringHandoff.evidenceE001.json",
    );
    fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as AuthoringHandoff;

    counterpediaProcess = spawn(
      "npm",
      ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: counterpediaDir!,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    counterpediaProcess.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    counterpediaProcess.on("exit", (code) => {
      if (code && code !== 0) {
        stderr += `\nCounterpedia dev server exited with code ${code}`;
      }
    });

    try {
      await waitForProjectionRoute(endpoint, 30_000);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nCounterpedia stderr:\n${stderr}`,
      );
    }
  }, 40_000);

  afterAll(async () => {
    if (counterpediaProcess && !counterpediaProcess.killed) {
      counterpediaProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!counterpediaProcess.killed) counterpediaProcess.kill("SIGKILL");
    }
  });

  it("projects the committed real evidence:E001 Authoring handoff through Counterpedia and the extension client", async () => {
    const entry = await projectAuthoringHandoffToReaderEntry(
      fixture,
      globalThis.fetch,
      endpoint,
    );

    expect(entry.title).toBe("Draft-from-source E2E fixture");
    expect(entry.posture).toBe("proposal");
    expect(entry.sourceKind).toBe("authoring_proposal");
    expect(entry.lifecycle).toBe("proposal");
    expect(entry.leadBlocks?.[0]?.text).toBe(
      "Deterministic held-capture composition over the retained bytes.",
    );
    expect(entry.leadBlocks?.[0]?.evidenceRefs).toEqual(["evidence:E001"]);
    expect(entry).not.toHaveProperty("admitted");
    expect(entry).not.toHaveProperty("published");
    expect(entry).not.toHaveProperty("standing");
  });

  it("fails closed when the real Counterpedia route receives authority contamination", async () => {
    const contaminated = JSON.parse(JSON.stringify(fixture)) as AuthoringHandoff & {
      proposal_package: Record<string, unknown>;
    };
    contaminated.proposal_package["standing"] = "granted";

    await expect(
      projectAuthoringHandoffToReaderEntry(contaminated, globalThis.fetch, endpoint),
    ).rejects.toThrow(/HTTP 4/);
  });
});
