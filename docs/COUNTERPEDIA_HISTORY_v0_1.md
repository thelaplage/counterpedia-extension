# CP-HISTORY0 — Counterpedia History v0.1

**Status:** DRAFT  
**Authority movement:** 0  
**Default:** OFF

## Product contract

Counterpedia History is one simple user-controlled switch:

```text
History OFF
  -> zero passive Encounter writes
  -> zero passive corpus-miss writes

History ON
  -> completed active-tab HTTP(S) page load
  -> local Encounter
```

Turning History OFF stops future passive writes. It does not delete earlier History. Deletion is a separate explicit **Clear Counterpedia History** action.

History ON is not telemetry consent.

## Encounter v0.1

`counterpedia.browser_encounter.v0.1` records only the observation that a user encountered a top-level web object plus bounded identity/resolution metadata.

```text
encountered != captured
captured != registered
registered != verified
verified != admitted
```

The v0.1 generic browser observation starts `UNRESOLVED`. A later collector/resolver lane may bind exact registered identity keys. HISTORY0 itself does not perform source-resolution network calls.

## Local-only persistence

Encounter and corpus-miss ledgers use `chrome.storage.local` only. They are not written to `chrome.storage.sync` and this lane introduces no network upload endpoint.

Malformed local ledger state fails closed. A new Encounter never silently overwrites an invalid existing ledger.

Limits:

- Encounter ledger: 5,000 records;
- local corpus-miss ledger: 2,000 records.

A limit is an explicit refusal to write more History; it is not an excuse to evict older records silently.

## Corpus miss

`counterpedia.local_corpus_miss.v0.1` exists so later exact resolution can preserve `UNMATCHED`/`AMBIGUOUS` encounters as local demand observations.

Its reporting posture is structurally fixed:

```text
LOCAL_ONLY
```

HISTORY0 does not submit these records to Counterpedia. A later explicit, privacy-minimized demand-submission lane is separately governed.

## KEEP distinction

The extension also has draft work for an explicit KEEP/local-research-trail action. The concepts must not collapse:

```text
KEEP    = explicit user retention action
HISTORY = passive encounter recording while the History Gate is ON
```

Neither is Amnesiac memory admission.

## What this lane does not do

- no recursive crawl;
- no automatic exact-byte acquisition;
- no CourtListener/Internet Archive adapter semantics yet;
- no Countergraph mutation;
- no Amnesiac write;
- no publication;
- no verification;
- no standing/admission movement;
- no external archival.
