/**
 * EXT-CHECK-CONSUMER0 (R7) — canonical-JSON digest recompute, ported (not
 * reinvented) from the producer's own primitives:
 *
 *   - `canonicalJson` — byte-for-byte port of
 *     `thelaplage/counterpedia` `lib/counterpedia/canonicalJson.ts`
 *     (`canonicalJson(value)`): recursive alphabetical key sort, compact
 *     `JSON.stringify` separators. Same algorithm, same output bytes for the
 *     same input value — this is the single "sorted keys, compact JSON"
 *     dialect the whole Check/assessment-receipt digest family already uses;
 *     this module does not invent a second one.
 *   - `sha256Digest` — same "sha256:" + lowercase-hex convention as
 *     `lib/counterpedia/check/canonicalJson.ts`'s `sha256Digest`, but backed
 *     by Web Crypto (`crypto.subtle.digest`) instead of `node:crypto`,
 *     because this module runs inside a browser-extension panel context
 *     (mirrors the extension's own existing convention in
 *     `src/lib/captureDigest.ts`, which already uses `crypto.subtle` for the
 *     same reason). `node:crypto`'s `createHash("sha256")` and
 *     `crypto.subtle.digest("SHA-256", ...)` compute the identical SHA-256
 *     over the identical UTF-8 bytes; only the async API surface differs.
 *
 * This module performs NO evaluation and NO support inference — it is pure
 * bytes-in, digest-out, used only to independently RECOMPUTE a digest that
 * was already produced elsewhere.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (key) => JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key]),
  );
  return "{" + pairs.join(",") + "}";
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 (via Web Crypto) over the UTF-8 bytes of `canonical` -> "sha256:<hex>". */
export async function sha256Digest(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + toHex(hash);
}

/** Convenience: canonicalize + digest in one call. */
export async function sha256CanonicalJson(value: unknown): Promise<string> {
  return sha256Digest(canonicalJson(value));
}
