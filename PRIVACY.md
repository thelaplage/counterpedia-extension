# Counterpedia Extension Privacy Policy

**Version 0.1 — 2026-08-05**

## What the extension does

The Counterpedia extension finds Counterpedia governed records that match the
current page you are viewing, or text you explicitly select.

## What data is sent

- **Normalized page URL**: When you navigate to a page, the extension sends the
  normalized URL (lowercase hostname, no fragment, no credentials) to the
  Counterpedia search service at `www.garpedia.org`. This happens automatically
  for each page you visit while the side panel is open.
- **Selected text** (up to 300 characters): When you use the right-click context
  menu "Check selection in Counterpedia", the selected text is sent to the search
  service. This is an explicit user action only.

## What is NOT sent

The extension does **not** send:
- Browsing history
- Page content or DOM
- Cookies or session tokens
- HTTP referrer headers
- Page title
- Any form input or credentials
- Any data from pages you do not explicitly check

## Analytics and telemetry

There is **no analytics or telemetry** in v0.1. No usage data is collected.

## Search history

No search history is stored. Each query is independent.

## Local storage

The extension uses `chrome.storage.session` to cache the Counterpedia search
index for the duration of the browser session. This cache:
- Contains only the public search index from `www.garpedia.org`
- Is cleared automatically when you close all browser windows
- Contains no personal data or browsing history

To clear the cache manually: close all extension side panels and reload.

## Third-party services

The only external service is `www.garpedia.org`. The extension fetches the
public static search index from this domain. Standard HTTP access logs may
apply on the server side, governed by Counterpedia's own privacy policy.

## Changes

This policy covers v0.1 only. Future versions may add additional capabilities;
any changes will be documented in an updated privacy policy.
