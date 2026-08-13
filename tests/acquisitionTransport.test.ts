import { describe, expect, it, vi } from "vitest";

import type { BrowserPageCapture } from "../src/lib/browserPageCapture";
import {
  ACQ1_DEFAULT_ENDPOINT,
  ACQ1_OBSERVATION_PATH,
  ACQ1_TOKEN_HEADER,
  ACQ1_TOKEN_SESSION_KEY,
  AcquisitionTransportError,
  acquireBrowserPageCapture,
  acquisitionEndpointFromManifest,
  clearAcquisitionTransportToken,
  isSafeAcquisitionEndpoint,
  loadAcquisitionTransportToken,
  saveAcquisitionTransportToken,
  validateCaptureUrlResult,
  type SessionStorageLike,
} from "../src/lib/acquisitionTransport";

const DIGEST = `sha256:${"a".repeat(64)}`;

const BPC: BrowserPageCapture = {
  artifact_type: "BrowserPageCapture",
  spec_version: "v0.1",
  requested_url: "https://example.com/source",
  current_url: "https://example.com/source",
  canonical_url: "https://example.com/source",
  document_title: "Source",
  document_language: "en",
  meta_description: null,
  json_ld: [],
  selected_text: null,
  main_text: "browser observation only",
  rendered_text: "browser observation only",
  captured_at: "2026-08-12T22:00:00Z",
};

function capturedResult(): Record<string, unknown> {
  return {
    tool: "acquisition.capture_url",
    surface_schema: "acquisition.mcp_surface.v0.1",
    capture_status: "captured",
    capture_receipt: {
      capture_id: "capture-123",
      source_id: "source-123",
      source_locator: "https://example.com/source",
      captured_at: "2026-08-12T22:00:01Z",
      http_metadata: {
        status_code: 200,
        content_type: "text/html",
        content_length: 123,
        last_modified: null,
        etag: null,
        final_url: "https://example.com/source",
      },
      exact_bytes_sha256: DIGEST,
      byte_count: 123,
      schema_version: "acquisition.capture.v0.1",
    },
    capture_id: "capture-123",
    source_id: "source-123",
    source_locator: "https://example.com/source",
    captured_object_address: DIGEST,
    byte_count: 123,
    failure_detail: null,
  };
}

function failedResult(): Record<string, unknown> {
  return {
    tool: "acquisition.capture_url",
    surface_schema: "acquisition.mcp_surface.v0.1",
    capture_status: "capture_failed",
    capture_receipt: null,
    capture_id: null,
    source_id: "source-123",
    source_locator: "https://example.com/source",
    captured_object_address: null,
    byte_count: null,
    failure_detail: "HTTP 404",
  };
}

function expectTransportError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected transport error");
  } catch (error) {
    expect(error).toBeInstanceOf(AcquisitionTransportError);
    expect((error as AcquisitionTransportError).code).toBe(code);
  }
}

describe("validateCaptureUrlResult", () => {
  it("accepts a coherent captured producer result", () => {
    const result = validateCaptureUrlResult(capturedResult());
    expect(result.capture_status).toBe("captured");
    if (result.capture_status !== "captured") throw new Error("unexpected status");
    expect(result.captured_object_address).toBe(DIGEST);
    expect(result.capture_receipt.exact_bytes_sha256).toBe(DIGEST);
    expect(result.byte_count).toBe(123);
  });

  it("accepts honest capture_failed without fabricating a receipt", () => {
    const result = validateCaptureUrlResult(failedResult());
    expect(result.capture_status).toBe("capture_failed");
    if (result.capture_status !== "capture_failed") throw new Error("unexpected status");
    expect(result.capture_receipt).toBeNull();
    expect(result.captured_object_address).toBeNull();
    expect(result.failure_detail).toBe("HTTP 404");
  });

  it("fails closed on unknown top-level fields", () => {
    expectTransportError(
      () => validateCaptureUrlResult({ ...capturedResult(), standing: "admitted" }),
      "invalid_response",
    );
  });

  it("fails closed on future surface schema", () => {
    expectTransportError(
      () =>
        validateCaptureUrlResult({
          ...capturedResult(),
          surface_schema: "acquisition.mcp_surface.v9.9",
        }),
      "invalid_response",
    );
  });

  it("fails closed when top-level digest does not match nested receipt", () => {
    expectTransportError(
      () =>
        validateCaptureUrlResult({
          ...capturedResult(),
          captured_object_address: `sha256:${"b".repeat(64)}`,
        }),
      "invalid_response",
    );
  });

  it("fails closed when top-level byte count does not match nested receipt", () => {
    expectTransportError(
      () => validateCaptureUrlResult({ ...capturedResult(), byte_count: 124 }),
      "invalid_response",
    );
  });

  it("rejects a fabricated receipt on capture_failed", () => {
    const failed = failedResult();
    failed["capture_receipt"] = capturedResult()["capture_receipt"];
    expectTransportError(() => validateCaptureUrlResult(failed), "invalid_response");
  });

  it("rejects malformed content addresses", () => {
    const value = capturedResult();
    const receipt = value["capture_receipt"] as Record<string, unknown>;
    receipt["exact_bytes_sha256"] = "sha256:not-a-real-digest";
    value["captured_object_address"] = "sha256:not-a-real-digest";
    expectTransportError(() => validateCaptureUrlResult(value), "invalid_response");
  });
});

describe("ACQ1 endpoint guard", () => {
  it("accepts plain-http loopback endpoints", () => {
    expect(isSafeAcquisitionEndpoint("http://127.0.0.1:8787")).toBe(true);
    expect(isSafeAcquisitionEndpoint("http://localhost:9999")).toBe(true);
  });

  it("rejects non-loopback, https, credentials, and embedded paths", () => {
    for (const url of [
      "https://127.0.0.1:8787",
      "http://10.0.0.1:8787",
      "http://example.com:8787",
      "http://user:pass@127.0.0.1:8787",
      "http://127.0.0.1:8787/evil",
      "not-a-url",
    ]) {
      expect(isSafeAcquisitionEndpoint(url)).toBe(false);
    }
  });

  it("reads endpoint only from a demo manifest and fails closed otherwise", () => {
    expect(
      acquisitionEndpointFromManifest({
        _demo_mode: true,
        _acquisition_endpoint: ACQ1_DEFAULT_ENDPOINT,
      }),
    ).toBe(ACQ1_DEFAULT_ENDPOINT);
    expect(
      acquisitionEndpointFromManifest({
        _demo_mode: false,
        _acquisition_endpoint: ACQ1_DEFAULT_ENDPOINT,
      }),
    ).toBeNull();
    expect(
      acquisitionEndpointFromManifest({
        _demo_mode: true,
        _acquisition_endpoint: "https://evil.example",
      }),
    ).toBeNull();
  });
});

describe("acquireBrowserPageCapture", () => {
  it("posts the exact BPC envelope with token and no credentials, then validates result", async () => {
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${ACQ1_DEFAULT_ENDPOINT}${ACQ1_OBSERVATION_PATH}`);
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers[ACQ1_TOKEN_HEADER]).toBe("session-token");
      expect(JSON.parse(String(init?.body))).toEqual({ browser_page_capture: BPC });
      return new Response(JSON.stringify(capturedResult()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await acquireBrowserPageCapture(BPC, "session-token", {
      fetchImpl: fakeFetch as typeof fetch,
    });
    expect(result.capture_status).toBe("captured");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("does not manufacture a result from a non-200 HTTP response", async () => {
    const fakeFetch = vi.fn(async () => new Response('{"error":"invalid_token"}', { status: 401 }));
    await expect(
      acquireBrowserPageCapture(BPC, "wrong", { fetchImpl: fakeFetch as typeof fetch }),
    ).rejects.toMatchObject({ code: "http_error", httpStatus: 401 });
  });

  it("fails before fetch when token is empty", async () => {
    const fakeFetch = vi.fn();
    await expect(
      acquireBrowserPageCapture(BPC, "", { fetchImpl: fakeFetch as typeof fetch }),
    ).rejects.toMatchObject({ code: "invalid_token" });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("fails before fetch for a non-loopback endpoint", async () => {
    const fakeFetch = vi.fn();
    await expect(
      acquireBrowserPageCapture(BPC, "token", {
        endpoint: "https://evil.example",
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "unsafe_endpoint" });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe("session-only token storage", () => {
  function memoryStorage(): SessionStorageLike & { values: Record<string, unknown> } {
    const values: Record<string, unknown> = {};
    return {
      values,
      async get(key: string) {
        return { [key]: values[key] };
      },
      async set(items: Record<string, unknown>) {
        Object.assign(values, items);
      },
      async remove(key: string) {
        delete values[key];
      },
    };
  }

  it("stores, loads, and clears the token under the pinned session key", async () => {
    const storage = memoryStorage();
    expect(await loadAcquisitionTransportToken(storage)).toBeNull();
    await saveAcquisitionTransportToken(storage, "abc123");
    expect(storage.values[ACQ1_TOKEN_SESSION_KEY]).toBe("abc123");
    expect(await loadAcquisitionTransportToken(storage)).toBe("abc123");
    await clearAcquisitionTransportToken(storage);
    expect(await loadAcquisitionTransportToken(storage)).toBeNull();
  });

  it("rejects blank tokens rather than persisting them", async () => {
    const storage = memoryStorage();
    await expect(saveAcquisitionTransportToken(storage, "   ")).rejects.toMatchObject({
      code: "invalid_token",
    });
    expect(storage.values).toEqual({});
  });
});
