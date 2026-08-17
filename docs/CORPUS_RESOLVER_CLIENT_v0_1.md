# CP-CORPUS-RESOLVER-CLIENT0 — local corpus HIT/MISS resolution v0.1

**Status:** DRAFT / stacked on HISTORY0 + COLLECTOR0  
**Authority movement:** 0  
**Encounter-query telemetry:** NO

## Purpose

Close the browser-side loop:

```text
user encounters supported knowledge object
        |
        v
Collector identity
        |
        v
fixed public source-resolution index
        |
     local exact match
      /           \
   HIT             MISS
    |                |
canonical ref     LOCAL_ONLY miss
+ presence
```

## Privacy shape

The extension fetches exactly one public artifact URL:

```text
https://www.garpedia.org/counterpedia/source-resolution-index.json
```

and caches the validated index in `chrome.storage.session`.

The user's encountered URL, CourtListener docket id, Wikipedia title, Archive identifier, or other Encounter identity is **not** placed into that HTTP request. Resolution happens locally against the cached bytes.

```text
fixed index fetch != History upload
local match != telemetry
```

History OFF wins before this fetch. If History is OFF, passive navigation does not need the source-resolution index.

## Failure behavior

Index/network failure is not evidence of a corpus miss.

```text
index unavailable/malformed -> UNRESOLVED
valid index + no exact key   -> UNMATCHED
registered key collision     -> AMBIGUOUS
exact one source             -> MATCHED
```

Only a real `UNMATCHED`/`AMBIGUOUS` result from a valid index may feed HISTORY0's LOCAL_ONLY corpus-miss ledger.

## Exact matching policy

Collectors can provide both site-native identity and a browsing locator. A normalized browsing locator is not necessarily byte-for-byte equal to a governed registered locator (for example a CourtListener collector can normalize a docket to `/docket/<id>/` while Counterpedia retains the full reviewed docket URL with slug).

Therefore the local client uses:

1. exact registered site-native IDs, when available;
2. exact registered canonical locator as fallback.

A native key collision or disagreement across registered native keys is `AMBIGUOUS`; it is not overridden by a locator guess.

No fuzzy/title/model matching exists.

## Presence is not standing

A HIT carries:

```text
canonical_source_ref
corpus_presence: current | historical_retired
```

`historical_retired` means Counterpedia already knows/retains the source lineage for deduplication, while current standing remains retired.

The Encounter contract contains no `standing`, `admitted`, `verified`, or publication field.

## Storage

- public index cache: `chrome.storage.session`;
- Encounter/miss history: `chrome.storage.local` via HISTORY0;
- no resolver data in `chrome.storage.sync`.

## Non-goals

- no source acquisition;
- no exact-byte capture;
- no automatic public demand submission;
- no Countergraph write;
- no Amnesiac admission;
- no publication or standing movement.
