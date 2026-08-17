import { describe, expect, it } from "vitest";

import {
  pairLocalCompanion,
  parseLocalPairingResult,
} from "../src/lib/localCompanionClient";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

function validPairing() {
  return {
    pairing_schema: "counterpedia.local_pairing.v0.1",
    acquisition_base_url: "http://127.0.0.1:8787",
    authoring_base_url: "http://127.0.0.1:8788",
    acquisition_transport_token: "test-transport-token-abcdefghijklmnopqrstuvwxyz",
    authoring_transport_token: "local-authoring-dev",
    authoring_ready: true,
    authority_posture: "transport_configuration_only",
    admission: "not_performed",
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

describe("Counterpedia Local pairing", () => {
  it("keeps the acquisition credential session-only", async () => {
    const syncWrites: Record<string, unknown>[] = [];
    const sessionWrites: Record<string, unknown>[] = [];

    const result = await pairLocalCompanion({
      extensionId: EXTENSION_ID,
      fetchImpl: fetchReturning(validPairing()),
      syncStorage: {
        async set(items) {
          syncWrites.push(items);
        },
      },
      sessionStorage: {
        async set(items) {
          sessionWrites.push(items);
        },
      },
    });

    expect(result.authority_posture).toBe("transport_configuration_only");
    expect(result.admission).toBe("not_performed");
    expect(syncWrites).toEqual([
      {
        counterpedia_acquisition_base_url: "http://127.0.0.1:8787",
        counterpedia_authoring_base_url: "http://127.0.0.1:8788",
        counterpedia_authoring_token: "local-authoring-dev",
      },
    ]);
    expect(syncWrites[0]).not.toHaveProperty("counterpedia_acquisition_token");
    expect(sessionWrites).toEqual([
      {
        counterpedia_acquisition_token:
          "test-transport-token-abcdefghijklmnopqrstuvwxyz",
      },
    ]);
  });

  it("fails closed on an unexpected acquisition endpoint", () => {
    expect(() =>
      parseLocalPairingResult({
        ...validPairing(),
        acquisition_base_url: "https://example.com",
      }),
    ).toThrow(/unexpected acquisition endpoint/);
  });

  it("fails closed if the pairing response asserts admission", () => {
    expect(() =>
      parseLocalPairingResult({
        ...validPairing(),
        admission: "performed",
      }),
    ).toThrow(/asserted admission/);
  });

  it("fails closed on response-field widening", () => {
    expect(() =>
      parseLocalPairingResult({
        ...validPairing(),
        standing: "canonical",
      }),
    ).toThrow(/unknown or missing field/);
  });

  it("rejects malformed extension ids before network I/O", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("must not be called");
    }) as typeof fetch;

    await expect(
      pairLocalCompanion({
        extensionId: "not-an-extension-id",
        fetchImpl,
        syncStorage: { async set() {} },
        sessionStorage: { async set() {} },
      }),
    ).rejects.toThrow(/invalid Chrome extension id/);
    expect(called).toBe(false);
  });
});
