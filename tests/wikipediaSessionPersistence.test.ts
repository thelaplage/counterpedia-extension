import { describe, expect, it } from "vitest";

import {
  WIKIPEDIA_CAPTURE_RUNS_KEY,
  WIKIPEDIA_CAPTURE_RUN_SCHEMA,
} from "../src/lib/wikipediaFrontierCapture";
import {
  parseWikipediaCaptureRunForRecovery,
  readWikipediaCaptureRunsForRecovery,
} from "../src/lib/wikipediaCaptureRunRecovery";

class MemoryStorage {
  readonly state: Record<string, unknown> = {};

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const wanted = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      wanted.filter((key) => key in this.state).map((key) => [key, this.state[key]]),
    );
  }
}

function run() {
  return {
    schema_version: WIKIPEDIA_CAPTURE_RUN_SCHEMA,
    run_id: "run:restart-proof",
    created_at: "2026-08-18T22:00:00.000Z",
    page: {
      wiki_host: "en.wikipedia.org",
      title: "Theranos",
      revision_id: 123456,
      canonical_url: "https://en.wikipedia.org/wiki/Theranos",
    },
    attempts: [
      {
        url: "https://example.org/reference",
        capture_status: "captured",
        capture_id: "cap_reference",
        source_id: "src_reference",
        source_locator: "https://example.org/reference",
        captured_object_address: `sha256:${"a".repeat(64)}`,
        byte_count: 321,
        failure_detail: null,
      },
    ],
    authority_posture: "capture_receipt_projection_only",
    admission: "not_performed",
  } as const;
}

describe("Wikipedia completed-run lifecycle recovery", () => {
  it("strictly re-reads an existing completed local capture run after UI lifecycle loss", async () => {
    const storage = new MemoryStorage();
    storage.state[WIKIPEDIA_CAPTURE_RUNS_KEY] = [run()];

    const recovered = await readWikipediaCaptureRunsForRecovery(storage);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.run_id).toBe("run:restart-proof");
    expect(recovered[0]!.attempts[0]!.capture_id).toBe("cap_reference");
    expect(recovered[0]!.authority_posture).toBe("capture_receipt_projection_only");
    expect(recovered[0]!.admission).toBe("not_performed");
  });

  it("fails closed instead of trusting authority widening in local recovery state", () => {
    expect(() => parseWikipediaCaptureRunForRecovery({ ...run(), admitted: true })).toThrow(
      /run_shape/,
    );
    expect(() =>
      parseWikipediaCaptureRunForRecovery({ ...run(), admission: "performed" }),
    ).toThrow(/admission/);
  });

  it("requires captured run entries to retain source-locator continuity", () => {
    const base = run();
    expect(() =>
      parseWikipediaCaptureRunForRecovery({
        ...base,
        attempts: [
          {
            ...base.attempts[0],
            source_locator: "https://example.org/other",
          },
        ],
      }),
    ).toThrow(/source_locator_mismatch/);
  });
});
