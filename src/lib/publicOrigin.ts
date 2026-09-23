/**
 * Single canonical public origin for the Counterpedia content surfaces this
 * extension consumes (search index, activity index, source-resolution index,
 * source-workbench deep links, record links).
 *
 * CURRENT_PUBLIC_ORIGIN = https://counterpedia.vercel.app — the working public
 * host the extension targets today. `counterpedia.org` is the RESERVED future
 * canonical apex and is intentionally NOT referenced here: it is unwired, and
 * no consumer may depend on it until it is deliberately exposed.
 *
 * The Counterpedia Check API host is a SEPARATE binding
 * (`checkApiConsumer.ts` / `checkHandoff.ts`, already on counterpedia.vercel.app)
 * and is not derived from this origin.
 *
 * This is a PURE constant module: no Chrome APIs, no DOM, no network. Consumers
 * that support a per-install override read the `counterpedia_base_url`
 * chrome.storage.sync key and fall back to this default.
 */
export const COUNTERPEDIA_PUBLIC_ORIGIN = "https://counterpedia.vercel.app";

/** chrome.storage.sync key that overrides the public origin (key unchanged). */
export const COUNTERPEDIA_PUBLIC_ORIGIN_OVERRIDE_KEY = "counterpedia_base_url";
