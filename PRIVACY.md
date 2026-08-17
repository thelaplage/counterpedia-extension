# Counterpedia Extension Privacy Policy

**Version 0.1 — 2026-08-17 (History + local corpus resolver draft)**

## What the extension does

The Counterpedia extension finds Counterpedia governed records that match the
current page you are viewing, or text you explicitly select.

This draft also adds optional **Counterpedia History**. History is **OFF by
default**. When you explicitly turn it ON, the extension can record completed
top-level HTTP(S) page encounters locally in your Chrome browser profile and
resolve supported source identities against a public Counterpedia source index.

## What data is sent

The existing Counterpedia search surface may send:

- **Normalized page URL**: while the side panel is open, the extension may send
  the normalized URL (lowercase hostname, no fragment, no credentials) to the
  Counterpedia search service at `www.garpedia.org` to find matching governed
  records.
- **Selected text** (up to 300 characters): when you use the right-click
  "Check selection in Counterpedia" action, the selected text is sent to the
  search service. This is an explicit user action.

When History is ON, the local corpus resolver may additionally fetch this one
fixed public artifact:

```text
https://www.garpedia.org/counterpedia/source-resolution-index.json
```

The encountered page URL, CourtListener docket id, Wikipedia title, Archive
identifier, or other Encounter identity is **not added to that resolver request**.
The whole public index is cached in `chrome.storage.session`, and HIT/MISS
matching happens locally in the extension.

Turning History ON therefore does not authorize upload of the local History
ledger or per-Encounter lookup telemetry.

## What is NOT sent by History / the corpus resolver

The History/resolver lane does **not** send:

- the locally stored Counterpedia History ledger or corpus-miss ledger;
- Encounter ids or Research Session ids;
- source-native identifiers as resolver query parameters;
- page content or DOM;
- cookies or session tokens;
- HTTP referrer headers;
- page title as History telemetry;
- form input or credentials;
- a corpus-miss report to Counterpedia;
- any History analytics event.

## Analytics and telemetry

There is **no History analytics or telemetry** in v0.1. Counterpedia History is
a local storage feature, not telemetry consent. A fixed public-index fetch is
not a report of which source the user encountered.

## Counterpedia History

History is a user-controlled binary setting:

- **OFF** — passive navigation creates no Encounter or corpus-miss records, and
  the passive History lane does not fetch the source-resolution index.
- **ON** — completed active-tab HTTP(S) page loads may create a local Encounter.

History content is stored in `chrome.storage.local`, not `chrome.storage.sync`.
Turning History OFF stops future passive writes but does not delete earlier
records. The side panel provides a separate **Clear Counterpedia History** action
that removes the Encounter and local corpus-miss ledgers while preserving the
ON/OFF preference.

A locally recorded Encounter does not mean the page was captured, verified,
admitted, published, or given standing in Counterpedia.

A matched source may carry:

```text
corpus_presence: public_current | historical_retired | governed_capture
```

This is source-presence metadata for lookup/deduplication, not a standing claim.
`governed_capture` means Counterpedia already has governed exact bytes and a
CaptureReceipt for that source identity; it does not mean the source was admitted,
verified, or published. This distinction is used by the NYT/OpenAI proof fixture:
the already captured complaint and court opinion are local HITs, while the
uncaptured OpenAI public-position source remains an honest MISS.

If the source-resolution index is unavailable or malformed, the Encounter stays
`UNRESOLVED`; infrastructure failure is not converted into a false corpus miss.

## Search history

Counterpedia does not keep a separate local log of selected-text search queries.
The optional History ledger records top-level page encounters, not a query log.

## Session caches

The extension uses `chrome.storage.session` for public, rebuildable caches such
as:

- the Counterpedia search index;
- the Counterpedia source-resolution index.

These caches contain public Counterpedia projection data, not the private local
History ledger, and are cleared with browser session storage.

## Third-party services

The current search/resolver surfaces use `www.garpedia.org` for public static
Counterpedia artifacts. Standard HTTP access logs may apply on the server side,
governed by Counterpedia's own privacy policy.

This draft does not add automatic Wayback preservation, CourtListener API
hydration, a History-reporting endpoint, or an Amnesiac/Countergraph upload.

## Changes

Future demand-submission, external archival, watch/alert, cross-device sync, or
memory-integration lanes require separate review and corresponding privacy
disclosure before activation.
