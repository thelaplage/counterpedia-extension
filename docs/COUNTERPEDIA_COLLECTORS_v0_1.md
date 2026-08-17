# CP-COLLECTOR0 — attributable browser collectors v0.1

**Status:** DRAFT / stacked on CP-HISTORY0  
**Authority movement:** 0

## Purpose

A Collector recognizes what kind of knowledge object the user encountered and emits bounded identity/provenance data into the already-defined History Encounter contract.

```text
top-level URL
    |
    v
Collector registry
    |
    +-- Wikipedia collector
    `-- Generic Web fallback
            |
            v
       History Gate
       OFF      ON
        X        |
                 v
             Encounter
```

Collector recognition is not crawling, source admission, verification, or canonical corpus identity.

## Binary History remains simple

The product-level privacy control remains one switch:

```text
Counterpedia History ON / OFF
```

Specific collectors specialize attribution and native identity. They do not create hidden secondary History switches. If a specialized collector is disabled, an HTTP(S) page may still be recorded by the generic Web collector while History is ON.

If the user wants no passive research history, History OFF is the single authoritative control.

## v0.1 collector contract

Each collector declares:

- stable collector id;
- human label;
- deterministic priority;
- optional-origin metadata for a future explicit permission surface;
- default enablement;
- a pure `observe(URL)` function.

`observe` may only describe the loaded top-level URL. It performs no network I/O.

## Wikipedia Collector #1

The first specific collector recognizes `https?://<language>.wikipedia.org/wiki/<title>` and records:

- collector `wikipedia_v0_1`;
- canonical locator with fragment removed;
- source kind `wikipedia_page`;
- explicit native language and title parsed from the URL;
- resolution state `UNRESOLVED`.

It does not claim the Wikipedia title is a Counterpedia canonical identity. CP-SOURCE-RESOLVE0 or a later source-registry alias lane must establish that separately.

## Generic Web fallback

`generic_web_v0_1` preserves the HISTORY0 behavior for ordinary HTTP(S) pages. It is the binary History baseline and cannot be disabled through the specialized collector-setting function.

## Future collectors

CourtListener and Internet Archive/Wayback should be sibling collectors built on this contract. They should add explicit site-native IDs and discovered-reference stubs without recursively fetching those references.

## Held

- DOM-specific collectors requiring broad host permissions;
- automatic API enrichment;
- recursive crawling;
- exact-byte auto-capture;
- automatic corpus-demand upload;
- Watch/alerts;
- external archival.
