export const DEFAULT_COUNTERPEDIA_CHECK_BASE_URL = "https://counterpedia.vercel.app";
export const CHECK_HANDOFF_SELECTION_MAX_CHARS = 300;

export interface CheckHandoffInput {
  readonly sourceUrl: string;
  readonly selectedText?: string | null;
  readonly claimText?: string | null;
  readonly checkBaseUrl?: string;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function assertAllowedCheckBase(url: URL): void {
  if (url.username || url.password) {
    throw new Error("Counterpedia Check base URL must not contain credentials");
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new Error("Counterpedia Check base URL must be HTTPS or loopback HTTP");
}

function assertCheckableSource(url: URL): void {
  if (url.username || url.password) {
    throw new Error("source URL must not contain credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("source URL must be HTTP(S)");
  }
}

/**
 * CHECK-HANDOFF0
 *
 * Builds an explicit navigation-only handoff from the browser companion to
 * Counterpedia's canonical `/check/new` product surface. This function performs
 * no fetch, capture, evaluation, receipt issuance, admission, or publication.
 *
 * The active source URL is carried as `url`; explicitly selected browser text
 * is carried only as optional `quote` context. Selection is defensively capped
 * at the same 300-character browser-message bound used by the existing scanner.
 */
export function buildCheckHandoffUrl(input: CheckHandoffInput): string {
  const source = new URL(input.sourceUrl);
  assertCheckableSource(source);

  const base = new URL(input.checkBaseUrl ?? DEFAULT_COUNTERPEDIA_CHECK_BASE_URL);
  assertAllowedCheckBase(base);

  const target = new URL("/check/new", base);
  target.searchParams.set("url", source.toString());

  if (input.selectedText && input.selectedText.length > 0) {
    target.searchParams.set(
      "quote",
      input.selectedText.slice(0, CHECK_HANDOFF_SELECTION_MAX_CHARS),
    );
  }
  if (input.claimText && input.claimText.length > 0) {
    target.searchParams.set("claim", input.claimText.slice(0, 5_000));
  }

  return target.toString();
}
