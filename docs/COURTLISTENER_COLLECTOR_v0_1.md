# CP-COURTLISTENER0 — CourtListener collector v0.1

**Status:** DRAFT / stacked on CP-COLLECTOR0  
**Authority movement:** 0  
**CourtListener API calls:** 0

## Purpose

Recognize a small set of CourtListener knowledge-object URL shapes during ordinary browsing and give the local History Encounter an attributable provider/native identity.

V0.1 recognizes:

- docket pages: `/docket/<courtlistener-docket-id>/<slug>/`;
- case-law opinion pages: `/opinion/<cluster-id>/<slug>/`.

CourtListener's current case-law API documentation explicitly notes that the numeric ID in the website opinion URL is a **cluster ID**, not an opinion ID. The collector preserves that distinction as `courtlistener_cluster_id`.

## What it records

Docket Encounter:

```text
collector_id       courtlistener_v0_1
source_kind        courtlistener_docket
native id          courtlistener_docket_id
canonical locator  https://www.courtlistener.com/docket/<id>/
resolution         UNRESOLVED
```

Opinion Encounter:

```text
collector_id       courtlistener_v0_1
source_kind        courtlistener_opinion_cluster
native id          courtlistener_cluster_id
canonical locator  https://www.courtlistener.com/opinion/<cluster-id>/
resolution         UNRESOLVED
```

Slug text is not identity. Query strings/fragments are not canonical identity.

## Why no API call yet

CourtListener currently exposes v4 APIs for dockets, opinion clusters/opinions, RECAP/PACER data, citations, and related objects. That is a valuable later enrichment lane, but it is intentionally held here.

The first collector proves:

```text
user actually encountered object
    -> native identity
    -> local Encounter
```

without silently turning one page visit into docket-wide hydration or PACER/RECAP acquisition.

## RECAP documents

RECAP is explicitly in scope for a later CourtListener collector increment, but v0.1 does not guess a document-page URL grammar from docket HTML. Before adding a `courtlistener_recap_document` identity, pin the actual public URL/native-ID contract with real fixtures and the current PACER data model.

A docket page may expose many filings. Their existence does not mean Counterpedia captured them.

```text
linked filing != encountered filing
encountered filing != captured bytes
```

## Boundary

This collector does not:

- call `/api/rest/v4`;
- use a CourtListener token;
- invoke RECAP Fetch or PACER purchase APIs;
- recursively fetch docket entries/documents;
- decide legal merits;
- infer truth;
- verify/admit/publish anything;
- report local History centrally.

Later `COURTLISTENER-ENRICH1` can add reviewed, bounded API enrichment after the static encounter contract is proven.
