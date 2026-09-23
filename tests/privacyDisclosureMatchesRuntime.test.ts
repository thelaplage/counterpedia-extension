/**
 * Atomicity guard for the runtime endpoint and its published disclosure.
 *
 * The failure this exists to prevent actually shipped: #95 moved every runtime
 * client from www.garpedia.org to counterpedia.vercel.app but left PRIVACY.md
 * naming the old host, so the published privacy disclosure was false on main.
 * `src/` alone looked clean, which is why a "legacy host removed" check missed
 * it — the defect is DISAGREEMENT between two files, not a bad string in one.
 *
 * These assertions make the rule executable inside the consumer repo rather
 * than relying only on dagr-ops Gate C, so the endpoint cannot move in a commit
 * that does not move the disclosure with it.
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { COUNTERPEDIA_RUNTIME_ORIGIN } from "../src/lib/runtimeOrigin";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

/** Hosts this extension must never silently contact or silently disclose. */
const KNOWN_HOSTS = [
  "www.garpedia.org",
  "garpedia.org",
  "counterpedia.vercel.app",
  "counterpedia.org",
];

const hostOf = (origin: string) => new URL(origin).host;

function hostsNamedIn(text: string): Set<string> {
  return new Set(KNOWN_HOSTS.filter((h) => text.includes(h)));
}

describe("privacy disclosure matches the runtime endpoint", () => {
  it("PRIVACY.md names the host the extension actually contacts", () => {
    expect(hostsNamedIn(read("PRIVACY.md"))).toContain(
      hostOf(COUNTERPEDIA_RUNTIME_ORIGIN),
    );
  });

  it("PRIVACY.md names no OTHER known host", () => {
    // The #95 failure mode exactly: disclosure left pointing at a host the
    // runtime no longer uses.
    const disclosed = hostsNamedIn(read("PRIVACY.md"));
    const stale = [...disclosed].filter(
      (h) => h !== hostOf(COUNTERPEDIA_RUNTIME_ORIGIN),
    );
    expect(stale).toEqual([]);
  });

  it("the disclosed set equals the contacted set exactly", () => {
    expect([...hostsNamedIn(read("PRIVACY.md"))].sort()).toEqual([
      hostOf(COUNTERPEDIA_RUNTIME_ORIGIN),
    ]);
  });
});

describe("the runtime origin is a locator, not an identity claim", () => {
  it("is not bound to an identity-claiming constant name", () => {
    // counterpedia.vercel.app is the pre-public DEPLOYMENT locator. Binding it
    // to a name asserting public/canonical identity is the thing the ratified
    // posture prohibits.
    const src = read("src/lib/runtimeOrigin.ts");
    expect(src).not.toMatch(
      /\b[A-Za-z0-9_]*(PUBLIC_ORIGIN|PUBLIC_IDENTITY|CANONICAL|SITE_ORIGIN|PUBLIC_URL)[A-Za-z0-9_]*\b/,
    );
    expect(src).toContain("COUNTERPEDIA_RUNTIME_ORIGIN");
  });

  it("does not reference the reserved apex, which is still unwired", () => {
    expect(read("src/lib/runtimeOrigin.ts")).not.toContain(
      "https://counterpedia.org",
    );
  });
});

describe("every vendor-host position is classified", () => {
  const classified = read(".public0/runtime-origin-positions.txt")
    .split("\n")
    .map((l) => l.split("#")[0].trim())
    .filter(Boolean)
    .sort();

  it("the classification file covers exactly the files that carry the host", () => {
    // Drift in either direction is a defect: an unclassified occurrence is
    // stray identity leakage, and a stale entry hides that a position was
    // already migrated.
    const actual = execSync(
      "grep -rl 'counterpedia\\.vercel\\.app' src || true",
      { cwd: ROOT, encoding: "utf-8" },
    )
      .split("\n")
      .map((l) => l.trim().replace(/\/{2,}/g, "/"))
      .filter(Boolean)
      .sort();
    expect(classified).toEqual(actual);
  });
});
