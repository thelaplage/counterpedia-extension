# Counterpedia CHECK / browser scanner boundary v0.1

The browser extension is the **browser companion / scanner**. Counterpedia CHECK is the **governed epistemic operation** owned by the Counterpedia product surface.

```text
browser companion
  observe active URL / explicit selected text
  match known Counterpedia records locally
  optionally capture / harvest / keep through their separate governed seams
  -> explicit Open in Counterpedia CHECK

Counterpedia CHECK
  canonical /check/new product surface
  -> existing /api/check/new or /api/check/quote
  -> source capture / retained-byte quote procedure as applicable
  -> explicit per-dimension established / not-established / not-evaluated posture
```

## Invariant

**Scanner observation != CHECK conclusion.**

The extension may carry an HTTP(S) source URL and explicitly selected text into CHECK as initial form values. The handoff itself performs no fetch, capture, evaluation, receipt issuance, admission, standing, verification, or publication. CHECK runs only after the user explicitly submits the canonical Counterpedia form.

Likewise, a CHECK gap may motivate later source acquisition, but CHECK does not silently turn that gap into browser capture or harvesting.

## CHECK-HANDOFF0

`src/lib/checkHandoff.ts` builds the navigation URL. `src/panel/checkHandoff.ts` renders the explicit action.

- destination defaults to `https://counterpedia.vercel.app/check/new`;
- development may override `counterpedia_check_base_url` to HTTPS or loopback HTTP;
- active URL is carried as `url`;
- explicit selected text is carried as optional `quote`, capped at the existing 300-character scanner-message bound;
- no extension host permission is added because this is plain user-click navigation, not cross-origin fetch;
- no Check response schema, evaluator, or receipt dialect is re-declared in the extension.

`AUTHORITY_MOVEMENT=0`.
