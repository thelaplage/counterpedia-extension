/**
 * Canonical capture digest.
 *
 * The single source of truth for the SHA-256 the extension shows for, and the
 * bytes it sends of, a BrowserPageCapture. It is computed over the EXACT capture
 * object CAP1 produced — `JSON.stringify(capture)` of that same reference — so
 * the displayed/sent `browserCaptureDigest` corresponds byte-for-byte to the
 * CAP1 capture. Silently rebuilding or mutating the capture before hashing would
 * change these bytes and therefore the digest; it is never done.
 *
 * Uses Web Crypto (`crypto.subtle`), available in extension contexts and in
 * Node 20+.
 */

import type { BrowserPageCapture } from "./browserPageCapture";

/** Serialize the capture to the exact transport bytes (identity-preserving). */
export function captureBytes(capture: BrowserPageCapture): string {
  return JSON.stringify(capture);
}

/** SHA-256 (lowercase hex) over the exact CAP1 capture bytes. */
export async function captureDigest(capture: BrowserPageCapture): Promise<string> {
  const data = new TextEncoder().encode(captureBytes(capture));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
