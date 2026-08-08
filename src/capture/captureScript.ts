/**
 * captureScript — injected into the active tab via chrome.scripting.executeScript.
 *
 * MUST be self-contained: no imports, no references to outer closure variables.
 * Receives `requestedUrl` (the tab.url Chrome reports) as an argument.
 *
 * What it collects:
 *   - URL fields (requested, current, canonical)
 *   - Title, language, meta description
 *   - JSON-LD blocks (raw text only, not parsed here)
 *   - Selected text if any
 *   - main/article element text
 *   - Rendered body text (form inputs, scripts, and styles stripped)
 *
 * What it NEVER collects:
 *   - Cookies
 *   - Form field values (input, textarea, select nodes are removed before innerText)
 *   - Hidden input contents
 *   - Referrer, history, credentials
 */

export interface RawPageData {
  requested_url: string;
  current_url: string;
  canonical_url: string | null;
  document_title: string;
  document_language: string | null;
  meta_description: string | null;
  json_ld_raw: string[];
  selected_text: string | null;
  main_text: string | null;
  rendered_text: string | null;
}

/**
 * Self-contained page capture function.
 * Called by chrome.scripting.executeScript — must not reference module scope.
 */
export function capturePageData(requestedUrl: string): RawPageData {
  // Canonical URL
  const canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const rawCanonical = canonicalEl?.href ?? null;

  // Meta description
  const metaEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const rawMeta = metaEl?.content ?? null;

  // JSON-LD blocks — collect raw text content only; parsing happens in the normalization layer
  const json_ld_raw: string[] = [];
  document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach((el) => {
    const text = el.textContent ?? "";
    if (text) json_ld_raw.push(text);
  });

  // Selected text
  const selectionText = window.getSelection()?.toString() ?? "";

  // Main/article element text — clone, strip forms/scripts/styles
  let main_text: string | null = null;
  const mainEl = document.querySelector("main") ?? document.querySelector("article");
  if (mainEl) {
    const clone = mainEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, textarea, select, script, style").forEach((el) => el.remove());
    const text = (clone as HTMLElement).innerText;
    if (text) main_text = text;
  }

  // Rendered body text — clone body, strip form elements + scripts/styles/noscript
  let rendered_text: string | null = null;
  if (document.body) {
    const bodyClone = document.body.cloneNode(true) as HTMLElement;
    bodyClone.querySelectorAll("input, textarea, select, script, style, noscript").forEach((el) => el.remove());
    const text = bodyClone.innerText;
    if (text) rendered_text = text;
  }

  return {
    requested_url: requestedUrl,
    current_url: document.URL,
    canonical_url: rawCanonical || null,
    document_title: document.title,
    document_language: document.documentElement.lang || null,
    meta_description: rawMeta || null,
    json_ld_raw,
    selected_text: selectionText || null,
    main_text: main_text || null,
    rendered_text: rendered_text || null,
  };
}
