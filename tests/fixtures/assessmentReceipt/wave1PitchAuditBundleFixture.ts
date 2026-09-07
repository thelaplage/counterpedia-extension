/**
 * EXT-CHECK-CONSUMER0 (R7) fixture loader.
 *
 * `wave1PitchAuditBundle.json` in this directory is byte-identical (verified
 * by git blob SHA `e9f35aec1a195ed343304819d5eb1bb884aeeb4b`) to
 * `thelaplage/counterpedia` `origin/main`'s
 * `tests/fixtures/assessmentReceipt/wave1PitchAuditBundle.json`, itself the
 * genuine, already-produced `AuditBundle.model_dump_json()` serialization of
 * `counterpedia_audit.pitch_check.build_wave1_pitch_check_bundle()`
 * (`counterpedia-audit` `origin/main@d09622a7`, CHECK-ENGINE-API0 #27). This
 * lane does NOT re-run/re-capture/re-assess anything; it imports the exact
 * committed bytes wholesale, the same way `counterpedia`'s
 * `wave1PitchAuditBundleFixture.ts` (R4, `#1124`) does.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AuditBundleLike } from "../../../src/lib/checkResultContract";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "wave1PitchAuditBundle.json");

export function loadWave1PitchAuditBundleFixture(): AuditBundleLike {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as AuditBundleLike;
}
