/**
 * Runtime origin for the Counterpedia content surfaces this extension consumes
 * (search index, activity index, source-resolution index, source-workbench deep
 * links, record links).
 *
 * `https://counterpedia.vercel.app` is the **pre-public deployment locator** —
 * the host the extension actually contacts today. It is NOT Counterpedia's
 * canonical or public identity, and must never be presented as one. The
 * reserved canonical apex `counterpedia.org` is deliberately NOT referenced
 * here: it is unwired, and no consumer may depend on it until the owner
 * authorizes the public-site cutover.
 *
 * Positions permitted to carry this host are enumerated in
 * `.public0/runtime-origin-positions.txt`. Anything outside that list is stray.
 *
 * The Counterpedia Check API host is a SEPARATE binding
 * (`checkApiConsumer.ts` / `checkHandoff.ts`) and is not derived from this.
 *
 * PURE constant module: no Chrome APIs, no DOM, no network. Consumers that
 * support a per-install override read the `counterpedia_base_url`
 * chrome.storage.sync key and fall back to this default.
 */
export const COUNTERPEDIA_RUNTIME_ORIGIN = "https://counterpedia.vercel.app";

/**
 * chrome.storage.sync key overriding the runtime origin.
 *
 * The KEY STRING is deliberately unchanged: it is persisted in real installs,
 * and renaming it would silently discard every existing per-install override.
 */
export const COUNTERPEDIA_RUNTIME_ORIGIN_OVERRIDE_KEY = "counterpedia_base_url";
