/**
 * Source Workbench presentation model — EXT-BROWSER1 invariants.
 *
 * These are permanent guards for the deep-link handoff:
 *  - Three postures (observed / source-work / receipt) are kept plainly
 *    separate and NEVER synthesized from the browser observation.
 *  - The deep link carries the page locator as a HINT only — never as source
 *    identity, declaration identity, capture digest, or proof of capture, and
 *    never emits a "verified"/"captured"/"bound" token.
 *  - source-work / receipt reach "available" ONLY from a valid, matching,
 *    same-origin authoritative resolution — fail-closed on everything else, so
 *    an invalid session/report is never rendered as valid.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildSourceWorkbenchPresentation,
  buildSourceDeepLink,
  validateSourceWorkResolution,
  tryValidateSourceWorkResolution,
  SOURCE_WORKBENCH_PATH,
  DEEP_LINK_INTENT,
  BPC_OBSERVATION_COPY,
  NO_PUBLIC_RECORD_COPY,
  type SourceLocator,
} from "../src/lib/sourceWorkbench";
import { isRestrictedUrl } from "../src/lib/search";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/source-workbench/${name}`, import.meta.url), "utf8"),
  );
}

const LOCATOR: SourceLocator = {
  current_url: "https://example.com/article?q=test",
  canonical_url: "https://example.com/article",
  title: "Example Article",
};

const PRE_CAPTURE_LOCATOR: SourceLocator = {
  current_url: "https://example.com/article?q=test",
  canonical_url: null,
  title: null,
};

// ---------------------------------------------------------------------------
// No-match → useful capture / handoff state
// ---------------------------------------------------------------------------

describe("no public record for the source (sparse corpus)", () => {
  it("presents the sparse-corpus notice and a usable handoff", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: PRE_CAPTURE_LOCATOR,
      observed: false,
      publicMaterial: false,
    });
    expect(p.public_material).toBe("absent");
    expect(p.no_public_record_copy).toBe(NO_PUBLIC_RECORD_COPY);
    // Handoff (deep link) is always usable — it is just navigation.
    expect(p.deep_link_url).toContain(SOURCE_WORKBENCH_PATH);
    // Nothing has entered Counterpedia yet.
    expect(p.observation).toBe("not_observed");
    expect(p.source_work).toBe("not_yet_available");
    expect(p.receipt).toBe("not_yet_available");
  });
});

// ---------------------------------------------------------------------------
// Known source → source relationships present
// ---------------------------------------------------------------------------

describe("known source (public material present)", () => {
  it("marks public material present and drops the sparse notice", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
    });
    expect(p.public_material).toBe("present");
    expect(p.no_public_record_copy).toBeNull();
  });

  it("public material presence NEVER synthesizes source-work or receipt", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: true,
      publicMaterial: true,
    });
    // Both true, no authoritative resolution → still not yet available.
    expect(p.source_work).toBe("not_yet_available");
    expect(p.receipt).toBe("not_yet_available");
    expect(p.workbench_object_url).toBeNull();
    expect(p.receipt_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Restricted page — the workbench is not offered upstream
// ---------------------------------------------------------------------------

describe("restricted page", () => {
  it("is recognized as restricted so the panel suppresses the workbench", () => {
    expect(isRestrictedUrl("chrome://extensions")).toBe(true);
    expect(isRestrictedUrl("file:///Users/me/secret.pdf")).toBe(true);
    expect(isRestrictedUrl("https://example.com/article")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Observation posture is never synthesized into verified/captured/bound
// ---------------------------------------------------------------------------

describe("observation posture", () => {
  it("is not_observed until an explicit observation is reported", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: false,
    });
    expect(p.observation).toBe("not_observed");
  });

  it("becomes observed_in_browser only when observed=true, and never a stronger claim", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: true,
      publicMaterial: false,
    });
    expect(p.observation).toBe("observed_in_browser");
    // The closed posture set can never be a truth/bound claim.
    expect(["not_observed", "observed_in_browser"]).toContain(p.observation);
    expect(p.observation_copy).toBe(BPC_OBSERVATION_COPY);
  });

  it("never emits a synthesized verified/captured/bound state anywhere", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: true,
      publicMaterial: true,
      resolution: fixture("resolution.available.json"),
    });
    const serialized = JSON.stringify(p).toLowerCase();
    for (const banned of ["verified", "captured", "bound", "proven", "authentic"]) {
      expect(serialized).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Deep link carries the locator as a HINT only
// ---------------------------------------------------------------------------

describe("deep link — locator is a hint, never identity or proof", () => {
  it("carries source_hint + intent and prefers the canonical URL", () => {
    const url = new URL(buildSourceDeepLink(LOCATOR));
    expect(url.pathname).toBe(SOURCE_WORKBENCH_PATH);
    expect(url.searchParams.get("intent")).toBe(DEEP_LINK_INTENT);
    expect(url.searchParams.get("source_hint")).toBe(LOCATOR.canonical_url);
    expect(url.searchParams.get("title_hint")).toBe(LOCATOR.title);
  });

  it("falls back to current_url when no canonical is known (pre-capture)", () => {
    const url = new URL(buildSourceDeepLink(PRE_CAPTURE_LOCATOR));
    expect(url.searchParams.get("source_hint")).toBe(PRE_CAPTURE_LOCATOR.current_url);
    expect(url.searchParams.has("title_hint")).toBe(false);
  });

  it("never carries a capture digest, identity, declaration id, or captured/proof token", () => {
    const url = buildSourceDeepLink(LOCATOR).toLowerCase();
    for (const banned of [
      "digest",
      "sha256",
      "captured",
      "capture_id",
      "declaration",
      "identity",
      "proof",
      "receipt",
      "verified",
      "bound",
    ]) {
      expect(url).not.toContain(banned);
    }
  });

  it("only ever targets the Counterpedia origin", () => {
    const url = new URL(buildSourceDeepLink(LOCATOR));
    expect(url.origin).toBe("https://www.garpedia.org");
  });
});

// ---------------------------------------------------------------------------
// Authoritative resolution → available, fail-closed everywhere else
// ---------------------------------------------------------------------------

describe("authoritative resolution", () => {
  it("advances both postures on a valid, matching, same-origin resolution", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
      resolution: fixture("resolution.available.json"),
    });
    expect(p.source_work).toBe("available");
    expect(p.receipt).toBe("available");
    expect(p.workbench_object_url).toBe("https://www.garpedia.org/counterpedia/source/abc123");
    expect(p.receipt_url).toBe("https://www.garpedia.org/counterpedia/receipt/def456");
  });

  it("advances postures independently (work available, receipt not)", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
      resolution: fixture("resolution.work-only.json"),
    });
    expect(p.source_work).toBe("available");
    expect(p.receipt).toBe("not_yet_available");
    expect(p.workbench_object_url).not.toBeNull();
    expect(p.receipt_url).toBeNull();
  });

  it("stays not_yet_available when the resolution reports nothing available", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
      resolution: fixture("resolution.none.json"),
    });
    expect(p.source_work).toBe("not_yet_available");
    expect(p.receipt).toBe("not_yet_available");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: invalid / mismatched / external-ref resolutions
// ---------------------------------------------------------------------------

describe("fail-closed on unsafe or invalid resolutions", () => {
  it("schema mismatch throws in the strict validator", () => {
    expect(() => validateSourceWorkResolution(fixture("resolution.invalid-schema.json"))).toThrow();
  });

  it("schema mismatch is never rendered as available (fail-closed default)", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
      resolution: fixture("resolution.invalid-schema.json"),
    });
    expect(p.source_work).toBe("not_yet_available");
    expect(p.receipt).toBe("not_yet_available");
    expect(p.workbench_object_url).toBeNull();
    expect(p.receipt_url).toBeNull();
  });

  it("a resolution about a DIFFERENT page is never applied to this source", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
      resolution: fixture("resolution.mismatch-locator.json"),
    });
    expect(p.source_work).toBe("not_yet_available");
    expect(p.receipt).toBe("not_yet_available");
  });

  it("an external (non-same-origin) ref is refused even if available=true", () => {
    const p = buildSourceWorkbenchPresentation({
      locator: LOCATOR,
      observed: false,
      publicMaterial: true,
      resolution: fixture("resolution.external-ref.json"),
    });
    expect(p.source_work).toBe("not_yet_available");
    expect(p.receipt).toBe("not_yet_available");
    expect(p.workbench_object_url).toBeNull();
    expect(p.receipt_url).toBeNull();
  });

  it("tryValidate returns null (never throws) on garbage", () => {
    expect(tryValidateSourceWorkResolution(null)).toBeNull();
    expect(tryValidateSourceWorkResolution({ kind: "nope" })).toBeNull();
    expect(tryValidateSourceWorkResolution(fixture("resolution.available.json"))).not.toBeNull();
  });

  it("rejects an available claim with no resolvable ref (cannot claim available emptily)", () => {
    expect(() =>
      validateSourceWorkResolution({
        kind: "source_work_resolution",
        schema_version: 1,
        locator: { current_url: "https://example.com/article" },
        source_work: { available: true },
        receipt: { available: false },
      }),
    ).toThrow();
  });
});
