/**
 * Counterpedia activity client for the Chrome extension.
 *
 * Fetches the public static, deterministic, disposable activity index
 * (`/counterpedia/activity-index.json`) and projects it into a feed model
 * locally. The index is cached in chrome.storage.session for the browser
 * session, exactly like the search index.
 *
 * This mirrors `counterpediaClient.ts` (the search-index consumer). It reuses
 * the SAME base URL and the SAME privacy discipline:
 * - No query is sent: the activity index is a static artifact fetched whole.
 * - `credentials: "omit"` — no cookies or credentials leave the browser.
 * - No page content, DOM, cookies, or history is ever accessed.
 * - No analytics or telemetry in v0.1.
 *
 * Fail-closed: the index is validated against a PINNED schema (family +
 * version). Any mismatch throws rather than rendering an unpinned shape.
 */

import {
  validateActivityIndex,
  projectIndexToFeed,
  type ActivityIndex,
  type ActivityFeedProjection,
} from "./activityFeedModel";

// ---------------------------------------------------------------------------
// Configuration — same base URL as the search client (same origin, so no new
// host permission is required).
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://www.garpedia.org";
const ACTIVITY_INDEX_PATH = "/counterpedia/activity-index.json";
const SESSION_CACHE_KEY = "counterpedia_activity_index_v1";
const SESSION_CACHE_FETCHED_KEY = "counterpedia_activity_index_fetched_at";
// Re-fetch if cached data is older than 1 hour (mirrors the search client).
const CACHE_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Index loading with session cache
// ---------------------------------------------------------------------------

let inMemoryIndex: ActivityIndex | null = null;

async function getBaseUrl(): Promise<string> {
  try {
    const result = await chrome.storage.sync.get(["counterpedia_base_url"]);
    return (result["counterpedia_base_url"] as string) || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

async function loadActivityIndex(): Promise<ActivityIndex> {
  // 1. In-memory cache (fastest)
  if (inMemoryIndex !== null) return inMemoryIndex;

  // 2. Session storage cache
  try {
    const cached = await chrome.storage.session.get([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
    const fetchedAt = cached[SESSION_CACHE_FETCHED_KEY] as number | undefined;
    const cachedData = cached[SESSION_CACHE_KEY] as ActivityIndex | undefined;
    if (cachedData && fetchedAt && Date.now() - fetchedAt < CACHE_TTL_MS) {
      // Re-validate cached data against the pinned schema before trusting it.
      inMemoryIndex = validateActivityIndex(cachedData);
      return inMemoryIndex;
    }
  } catch {
    // Session storage unavailable — fall through to fetch
  }

  // 3. Fetch from remote
  const baseUrl = await getBaseUrl();
  const url = `${baseUrl}${ACTIVITY_INDEX_PATH}`;
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 429) {
      const err = new Error("rate_limited");
      err.name = "rate_limited";
      throw err;
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;

  // Fail closed on any schema-family / schema-version mismatch.
  const index = validateActivityIndex(data);
  inMemoryIndex = index;

  // Store in session cache
  try {
    await chrome.storage.session.set({
      [SESSION_CACHE_KEY]: index,
      [SESSION_CACHE_FETCHED_KEY]: Date.now(),
    });
  } catch {
    // Non-fatal — session storage write failure
  }

  return inMemoryIndex;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the Counterpedia activity index and project it into a validated feed.
 *
 * The returned projection is honest-empty when the index carries no PUBLIC
 * receipts: each lane states it was inspected and recorded no activity, and the
 * inspection block names the substrates and window inspected.
 *
 * @returns A validated ActivityFeedProjection.
 * @throws Error with name "rate_limited" if the remote returns 429.
 * @throws Error if the remote is unavailable or the schema fails to validate.
 */
export async function getActivityFeed(): Promise<ActivityFeedProjection> {
  const index = await loadActivityIndex();
  return projectIndexToFeed(index);
}

/**
 * Clear the in-memory and session-storage cache.
 * Used for testing or manual refresh.
 */
export async function clearActivityCache(): Promise<void> {
  inMemoryIndex = null;
  try {
    await chrome.storage.session.remove([
      SESSION_CACHE_KEY,
      SESSION_CACHE_FETCHED_KEY,
    ]);
  } catch {
    // Non-fatal
  }
}
