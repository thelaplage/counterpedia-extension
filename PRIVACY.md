# Counterpedia Extension Privacy Policy

**Version 0.1 — 2026-08-17 (CP-HISTORY0 draft)**

## What the extension does

The Counterpedia extension finds Counterpedia governed records that match the
current page you are viewing, or text you explicitly select.

This draft also adds an optional **Counterpedia History** feature. History is
**OFF by default**. When you explicitly turn it ON, the extension records
completed top-level HTTP(S) page encounters locally in your Chrome browser
profile so Counterpedia can later build a private research trail around what
you encountered.

## What data is sent

- **Normalized page URL**: When you navigate to a page, the extension sends the
  normalized URL (lowercase hostname, no fragment, no credentials) to the
  Counterpedia search service at `www.garpedia.org`. This happens automatically
  for each page you visit while the side panel is open.
- **Selected text** (up to 300 characters): When you use the right-click context
  menu "Check selection in Counterpedia", the selected text is sent to the search
  service. This is an explicit user action only.

Turning Counterpedia History ON does **not** authorize an additional network
submission. The local History ledger is not sent to Counterpedia by CP-HISTORY0.

## What is NOT sent

The extension does **not** send:
- The locally stored Counterpedia History ledger or corpus-miss ledger
- Page content or DOM
- Cookies or session tokens
- HTTP referrer headers
- Page title
- Any form input or credentials
- Any History-specific analytics or telemetry

## Analytics and telemetry

There is **no analytics or telemetry** in v0.1. No usage data is collected.
Counterpedia History is a local storage feature, not telemetry consent.

## Counterpedia History

History is a user-controlled binary setting:

- **OFF** — passive navigation creates no Encounter or corpus-miss records.
- **ON** — completed active-tab HTTP(S) page loads may create a local Encounter.

History is stored in `chrome.storage.local`, not `chrome.storage.sync`.
Turning History OFF stops future passive writes but does not delete earlier
records. The side panel provides a separate **Clear Counterpedia History**
action that removes the Encounter and local corpus-miss ledgers while preserving
your ON/OFF preference.

A locally recorded Encounter does not mean the page was captured, verified,
admitted, published, or given standing in Counterpedia. In this draft, unresolved
encounters remain local and are not automatically submitted as corpus demand.

## Search history

Counterpedia does not keep a separate local log of search queries. The optional
History ledger records top-level page encounters, not selected-text search history.
Each search query remains independent.

## Other local storage

The extension uses `chrome.storage.session` to cache the Counterpedia search
index for the duration of the browser session. This cache:
- Contains only the public search index from `www.garpedia.org`
- Is cleared automatically when you close all browser windows
- Is separate from the optional local Counterpedia History ledger

## Third-party services

The search surface uses `www.garpedia.org` to fetch the public static search
index. Standard HTTP access logs may apply on the server side, governed by
Counterpedia's own privacy policy.

CP-HISTORY0 does not add a third-party History service, automatic external
archival, or an encounter-reporting endpoint.

## Changes

This policy covers the CP-HISTORY0 draft behavior described above. Future
collector, demand-submission, archival, or memory integrations require separate
review and corresponding privacy disclosure before activation.
