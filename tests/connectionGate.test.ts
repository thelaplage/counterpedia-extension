/**
 * SELF-LOAD0 polish (FIX 2): the shared pre-connect gate used by panel
 * widgets that call paired-only Counterpedia Local companion routes
 * (operator snapshot ingest, Wikipedia harvest, Wikipedia frontier capture).
 *
 * `isConnected` is pure and covers the actual gating decision;
 * `checkLocalCompanionConnected` is a thin async wrapper over the SAME
 * signal `readAcquisitionConfig()` already uses elsewhere in the panel, so
 * it introduces no new pairing/auth semantics.
 */
import { afterEach, describe, expect, it } from "vitest";

import { CONNECT_FIRST_MESSAGE, checkLocalCompanionConnected, isConnected } from "../src/lib/connectionGate";
import type { AcquisitionConfig } from "../src/lib/acquisitionClient";

const CONFIG: AcquisitionConfig = {
  baseUrl: "http://127.0.0.1:8787",
  token: "test-transport-token",
};

describe("isConnected (pure gating predicate)", () => {
  it("is false when no acquisition config is present (not yet connected)", () => {
    expect(isConnected(null)).toBe(false);
  });

  it("is true once a config is present (Connect succeeded)", () => {
    expect(isConnected(CONFIG)).toBe(true);
  });
});

describe("CONNECT_FIRST_MESSAGE", () => {
  it("is a neutral, non-alarming string (not an error/failure phrasing)", () => {
    expect(CONNECT_FIRST_MESSAGE).toMatch(/connect/i);
    expect(CONNECT_FIRST_MESSAGE).not.toMatch(/fail|error|403|refused/i);
  });
});

function stubChromeStorage(config: { baseUrl?: string; token?: string }): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: {
        get: async (_keys: string[]) => ({
          ...(config.baseUrl ? { counterpedia_acquisition_base_url: config.baseUrl } : {}),
        }),
      },
      session: {
        get: async (_keys: string[]) => ({
          ...(config.token ? { counterpedia_acquisition_token: config.token } : {}),
        }),
      },
    },
  };
}

describe("checkLocalCompanionConnected (reuses readAcquisitionConfig's own signal)", () => {
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("is false before any successful Connect (no stored config at all)", async () => {
    stubChromeStorage({});
    expect(await checkLocalCompanionConnected()).toBe(false);
  });

  it("is false with only a base URL and no session token (partial/expired state)", async () => {
    stubChromeStorage({ baseUrl: CONFIG.baseUrl });
    expect(await checkLocalCompanionConnected()).toBe(false);
  });

  it("is true once pairLocalCompanion's own storage writes are both present", async () => {
    stubChromeStorage({ baseUrl: CONFIG.baseUrl, token: CONFIG.token });
    expect(await checkLocalCompanionConnected()).toBe(true);
  });
});
