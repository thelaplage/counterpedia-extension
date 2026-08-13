/**
 * Acquisition client tests (stubbed fetch — no network, no Python).
 *
 * Covers HTTP-08 (notConfigured never fabricates), the exact wire envelope +
 * token header, HTTP-07 client-side (capture_failed carried honestly), and the
 * transport-error paths (non-200, contaminated response even from localhost).
 */

import { describe, it, expect } from "vitest";
import {
  createHttpAcquisitionClient,
  notConfiguredAcquisitionClient,
  selectAcquisitionClient,
  TRANSPORT_TOKEN_HEADER,
  OBSERVATION_PATH,
  type AcquisitionConfig,
} from "../src/lib/acquisitionClient";
import type { BrowserPageCapture } from "../src/lib/browserPageCapture";

const CONFIG: AcquisitionConfig = {
  baseUrl: "http://127.0.0.1:8787",
  token: "test-token-abc",
};

function bpc(url: string): BrowserPageCapture {
  return {
    artifact_type: "BrowserPageCapture",
    spec_version: "v0.1",
    requested_url: url,
    current_url: url,
    canonical_url: url,
    document_title: "Fixture",
    document_language: "en",
    meta_description: "fixture",
    json_ld: [],
    selected_text: null,
    main_text: "advisory",
    rendered_text: "advisory",
    captured_at: "2026-08-12T00:00:00Z",
  };
}

const CAPTURED_BODY = {
  tool: "acquisition.capture_url",
  surface_schema: "acquisition.mcp_surface.v0.1",
  capture_status: "captured",
  capture_id: "cap-1",
  source_id: "sha256:s",
  source_locator: "http://127.0.0.1:9/page",
  captured_object_address: "sha256:" + "a".repeat(64),
  byte_count: 10,
  failure_detail: null,
  capture_receipt: { exact_bytes_sha256: "sha256:" + "a".repeat(64) },
};

interface Captured {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function stubFetch(
  status: number,
  body: unknown,
  sink?: Captured[],
) {
  return async (url: string, init: Captured["init"]) => {
    sink?.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

describe("HTTP-08 — notConfigured never fabricates", () => {
  it("notConfigured client returns not_configured", async () => {
    const r = await notConfiguredAcquisitionClient.capture(bpc("http://x/y"));
    expect(r.kind).toBe("not_configured");
  });

  it("selectAcquisitionClient returns notConfigured on missing config", async () => {
    expect(selectAcquisitionClient(null).kind).toBe("not_configured");
    expect(
      selectAcquisitionClient({ baseUrl: "", token: "t" }).kind,
    ).toBe("not_configured");
    expect(
      selectAcquisitionClient({ baseUrl: "http://127.0.0.1:8787", token: "" })
        .kind,
    ).toBe("not_configured");
  });

  it("selectAcquisitionClient refuses a non-loopback base URL", () => {
    expect(
      selectAcquisitionClient({ baseUrl: "http://evil.example", token: "t" })
        .kind,
    ).toBe("not_configured");
  });
});

describe("HTTP client wire format", () => {
  it("posts the {browser_page_capture} envelope with the token header", async () => {
    const sink: Captured[] = [];
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: stubFetch(200, CAPTURED_BODY, sink),
      originHeader: "chrome-extension://acq1-http-test",
    });
    await client.capture(bpc("http://127.0.0.1:9/page"));

    expect(sink).toHaveLength(1);
    const sent = sink[0]!;
    expect(sent.url).toBe("http://127.0.0.1:8787" + OBSERVATION_PATH);
    expect(sent.init.method).toBe("POST");
    expect(sent.init.headers[TRANSPORT_TOKEN_HEADER]).toBe("test-token-abc");
    expect(sent.init.headers["Content-Type"]).toBe("application/json");
    expect(sent.init.headers["Origin"]).toBe("chrome-extension://acq1-http-test");
    const parsed = JSON.parse(sent.init.body);
    expect(Object.keys(parsed)).toEqual(["browser_page_capture"]);
    expect(parsed.browser_page_capture.artifact_type).toBe("BrowserPageCapture");
  });

  it("maps a captured response to kind=captured", async () => {
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: stubFetch(200, CAPTURED_BODY),
    });
    const r = await client.capture(bpc("http://127.0.0.1:9/page"));
    expect(r.kind).toBe("captured");
  });

  it("HTTP-07: maps a producer capture_failed (HTTP 200) honestly", async () => {
    const failedBody = {
      ...CAPTURED_BODY,
      capture_status: "capture_failed",
      capture_id: null,
      captured_object_address: null,
      byte_count: null,
      failure_detail: "fetch failed",
      capture_receipt: null,
    };
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: stubFetch(200, failedBody),
    });
    const r = await client.capture(bpc("http://127.0.0.1:9/notfound"));
    expect(r.kind).toBe("capture_failed");
  });

  it("maps a non-200 to transport_error (never a capture fact)", async () => {
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: stubFetch(401, { error: "invalid_token" }),
    });
    const r = await client.capture(bpc("http://127.0.0.1:9/page"));
    expect(r.kind).toBe("transport_error");
    if (r.kind === "transport_error") expect(r.status).toBe(401);
  });

  it("HTTP-04: refuses a contaminated 200 response even from localhost", async () => {
    // Contamination nested in capture_receipt passes the top-level allow-list and
    // must be caught by the recursive authority-key scan.
    const contaminated = {
      ...CAPTURED_BODY,
      capture_receipt: {
        exact_bytes_sha256: "sha256:" + "a".repeat(64),
        admitted: true,
      },
    };
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: stubFetch(200, contaminated),
    });
    const r = await client.capture(bpc("http://127.0.0.1:9/page"));
    expect(r.kind).toBe("transport_error");
    if (r.kind === "transport_error")
      expect(r.detail).toMatch(/authority-bearing field 'admitted'/);
  });

  it("HTTP-04b: refuses an unknown top-level field (allow-list)", async () => {
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: stubFetch(200, { ...CAPTURED_BODY, admitted: true }),
    });
    const r = await client.capture(bpc("http://127.0.0.1:9/page"));
    expect(r.kind).toBe("transport_error");
    if (r.kind === "transport_error")
      expect(r.detail).toMatch(/unknown top-level field 'admitted'/);
  });

  it("maps a network throw to transport_error", async () => {
    const client = createHttpAcquisitionClient({
      config: CONFIG,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const r = await client.capture(bpc("http://127.0.0.1:9/page"));
    expect(r.kind).toBe("transport_error");
    if (r.kind === "transport_error") expect(r.status).toBeNull();
  });
});
