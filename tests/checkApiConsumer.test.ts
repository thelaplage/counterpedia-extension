import { describe, expect, it, vi } from "vitest";

import {
  checkViaCanonicalApi,
  DEFAULT_CHECK_API_BASE_URL,
  isRecognizedCheckAttemptPresentation,
} from "../src/lib/checkApiConsumer";
import { CHECK_ATTEMPT_SCHEMA } from "../src/lib/checkResultContract";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GENUINE_PRESENTATION = {
  schema: CHECK_ATTEMPT_SCHEMA,
  kind: "check_attempt" as const,
  requested_url: "https://example.com/report",
  submitted_quote_text: null,
  submitted_proposition_text: null,
  capture_status: "captured" as const,
  capture_digest: "sha256:" + "a".repeat(64),
  capture_byte_count: 4096,
  dimensions: [
    { dimension: "source_capture" as const, state: "established" as const, reason_code: null },
    { dimension: "currentness" as const, state: "not_evaluated" as const, reason_code: "CURRENT_BYTES_UNAVAILABLE" },
    { dimension: "quote_integrity" as const, state: "not_evaluated" as const, reason_code: "CURRENT_BYTES_UNAVAILABLE" },
    { dimension: "proposition_support" as const, state: "not_evaluated" as const, reason_code: "NO_SUPPORT_EVALUATOR" },
    {
      dimension: "citation_resolution" as const,
      state: "not_evaluated" as const,
      reason_code: "CITATION_RESOLUTION_NOT_ATTEMPTED",
    },
  ],
  receipt_issued: false as const,
  note: "CAPTURE ATTEMPTED — RECEIPT NOT ISSUED",
};

/**
 * EXT-CHECK-CONSUMER0 (R7): the consumer invokes the canonical CHECK API and
 * renders its response only — it is not a second evaluator, never mints a
 * side effect, and fails closed on an unrecognized shape.
 */
describe("checkApiConsumer: external consumer over the canonical CHECK API", () => {
  it("issues EXACTLY ONE POST to /api/check/new with only url/quote_text/proposition_text — no scanner/acquisition side effect", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "captured", presentation: GENUINE_PRESENTATION }, 200));

    const outcome = await checkViaCanonicalApi({
      url: "https://example.com/report",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(`${DEFAULT_CHECK_API_BASE_URL}/api/check/new`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["proposition_text", "quote_text", "url"]);
    expect(body["url"]).toBe("https://example.com/report");
    expect(body["quote_text"]).toBeNull();
    expect(body["proposition_text"]).toBeNull();

    expect(outcome.kind).toBe("presentation");
    if (outcome.kind === "presentation") {
      expect(outcome.presentation).toEqual(GENUINE_PRESENTATION);
    }
  });

  it("carries the caller's quote/proposition text verbatim, never evaluating them", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "captured", presentation: GENUINE_PRESENTATION }, 200));
    await checkViaCanonicalApi({
      url: "https://example.com/report",
      quoteText: "an exact quote",
      propositionText: "a proposition",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["quote_text"]).toBe("an exact quote");
    expect(body["proposition_text"]).toBe("a proposition");
  });

  it("refuses a non-HTTPS, non-loopback Check base URL before making any call", async () => {
    const fetchImpl = vi.fn();
    await expect(
      checkViaCanonicalApi({
        url: "https://example.com/report",
        checkBaseUrl: "http://example.com",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTPS or loopback HTTP/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows an explicit loopback dev override", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "captured", presentation: GENUINE_PRESENTATION }, 200));
    const outcome = await checkViaCanonicalApi({
      url: "https://example.com/report",
      checkBaseUrl: "http://127.0.0.1:3000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe("http://127.0.0.1:3000/api/check/new");
    expect(outcome.kind).toBe("presentation");
  });

  it("refuses a credential-bearing source URL before making any call", async () => {
    const fetchImpl = vi.fn();
    await expect(
      checkViaCanonicalApi({ url: "https://user:pass@example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/credentials/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders a 503 not_configured/invalid_config response HONESTLY as unbound — never fabricates a local Check", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          status: "not_configured",
          detail: "No acquisition capture execution-port binding is configured.",
          presentation: { ...GENUINE_PRESENTATION, capture_status: "not_configured" },
        },
        503,
      ),
    );
    const outcome = await checkViaCanonicalApi({ url: "https://example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.kind).toBe("unbound");
    if (outcome.kind === "unbound") {
      expect(outcome.detail).toMatch(/not configured|execution-port/);
      expect(outcome.httpStatus).toBe(503);
    }
  });

  it("fails closed on an unrecognized schema string — never a best-effort render", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "captured", presentation: { ...GENUINE_PRESENTATION, schema: "counterpedia.check.attempt.v0_2" } }, 200),
    );
    const outcome = await checkViaCanonicalApi({ url: "https://example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.kind).toBe("unrecognized_response");
  });

  it("fails closed on an unrecognized capture_status value", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "captured", presentation: { ...GENUINE_PRESENTATION, capture_status: "future_unknown_status" } }, 200),
    );
    const outcome = await checkViaCanonicalApi({ url: "https://example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.kind).toBe("unrecognized_response");
  });

  it("fails closed on an unrecognized dimension state value", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          status: "captured",
          presentation: {
            ...GENUINE_PRESENTATION,
            dimensions: [{ dimension: "source_capture", state: "future_unknown_state", reason_code: null }],
          },
        },
        200,
      ),
    );
    const outcome = await checkViaCanonicalApi({ url: "https://example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.kind).toBe("unrecognized_response");
  });

  it("fails closed on a mangled receipt_issued literal (would otherwise be an evidentiary promotion)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "captured", presentation: { ...GENUINE_PRESENTATION, receipt_issued: true } }, 200),
    );
    const outcome = await checkViaCanonicalApi({ url: "https://example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.kind).toBe("unrecognized_response");
  });

  it("classifies a network failure as a distinct local_transport_error, never a governed refusal", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const outcome = await checkViaCanonicalApi({ url: "https://example.com/report", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.kind).toBe("local_transport_error");
  });

  it("isRecognizedCheckAttemptPresentation rejects non-object input", () => {
    expect(isRecognizedCheckAttemptPresentation(null)).toBe(false);
    expect(isRecognizedCheckAttemptPresentation("not an object")).toBe(false);
  });
});
