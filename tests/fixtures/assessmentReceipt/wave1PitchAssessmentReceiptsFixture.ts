/**
 * EXT-CHECK-CONSUMER0 (R7) fixture loader.
 *
 * `wave1PitchAssessmentReceipts.json` in this directory is byte-identical
 * (verified by git blob SHA `19cb3804f020fc955e6184f2ccc8ca9eeaf1238c`) to
 * `thelaplage/counterpedia` `origin/main`'s
 * `tests/fixtures/assessmentReceipt/wave1PitchAssessmentReceipts.json` — the
 * exact, already-minted `AssessmentReceipt` bytes for the two claims of
 * `wave1PitchAuditBundle.json` whose evidence is fully content-addressed
 * (see that file's own header in `counterpedia` for full mint provenance).
 * This lane never calls `buildAssessmentReceipt*` — it imports these bytes
 * wholesale, as a CONSUMER, exactly as `counterpedia`'s
 * `wave1PitchAssessmentReceiptsFixture.ts` (R4, `#1124`) does.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CommittedAssessmentReceiptRecord } from "../../../src/lib/checkResultContract";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "wave1PitchAssessmentReceipts.json");

export function loadWave1PitchAssessmentReceiptsFixture(): readonly CommittedAssessmentReceiptRecord[] {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as CommittedAssessmentReceiptRecord[];
}
