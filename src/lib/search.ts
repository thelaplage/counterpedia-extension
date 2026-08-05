/**
 * URL normalization and search request builder.
 */

const RESTRICTED_PROTOCOLS = new Set(["chrome:", "chrome-extension:", "file:", "ftp:", "data:", "javascript:", "about:"]);

/**
 * Normalize a URL for use as a Counterpedia search query.
 *
 * Rules:
 * - Returns null for restricted/invalid URLs (non-http/https, credentials, etc.)
 * - Lowercases hostname
 * - Strips URL fragment
 * - Strips credentials (username/password)
 * - Empty string → null
 */
export function normalizeUrl(rawUrl: string): string | null {
  if (!rawUrl || rawUrl.trim().length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // Only allow http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // Reject credential-bearing URLs
  if (parsed.username || parsed.password) {
    return null;
  }

  // Build normalized URL: lowercase hostname, strip fragment
  const normalized = new URL(rawUrl);
  normalized.hostname = normalized.hostname.toLowerCase();
  normalized.hash = "";
  // Remove credentials
  normalized.username = "";
  normalized.password = "";

  return normalized.toString();
}

/**
 * Build a search query from a normalized URL or plain text.
 * For URLs: use the full normalized URL.
 * For text: use the text as-is (already truncated by caller).
 */
export function buildSearchQuery(input: string): string {
  return input.trim();
}

/**
 * Check whether a URL is a restricted page that the extension cannot check.
 */
export function isRestrictedUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.trim().length === 0) return true;
  try {
    const parsed = new URL(rawUrl);
    if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    return false;
  } catch {
    return true;
  }
}
