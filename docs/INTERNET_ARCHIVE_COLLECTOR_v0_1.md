# CP-ARCHIVE0 — Internet Archive / Wayback collectors v0.1

**Status:** DRAFT / stacked on CP-COLLECTOR0  
**Authority movement:** 0  
**Automatic external preservation:** NO

## Purpose

Recognize two archive-shaped knowledge objects during ordinary browsing:

1. Internet Archive item pages;
2. Wayback snapshot pages.

The collectors emit local Encounter identity/provenance only. They do not recursively hydrate the item, fetch file derivatives, or save a new snapshot.

## Internet Archive item

A URL under:

```text
https://archive.org/details/<identifier>/...
```

is represented as one item identity:

```text
collector_id       internet_archive_v0_1
source_kind        internet_archive_item
native id          internet_archive_id
canonical locator  https://archive.org/details/<identifier>
resolution         UNRESOLVED
```

A deeper viewer path is not treated as a different item merely because it has additional path segments.

The collector does not enumerate/download every file or derivative in the item.

## Wayback snapshot

A replay URL under:

```text
https://web.archive.org/web/<capture-token>/<original-url>
```

preserves two distinct pieces of identity:

```text
snapshot replay identity
    +
original target locator
```

V0.1 records:

- the full replay capture token in the canonical Wayback locator;
- the leading numeric capture timestamp as `wayback_timestamp`;
- the original HTTP(S) locator as `wayback_original_locator`.

The original target query string is preserved. It must not collapse
`https://example.test/page?a=1` and `...?a=2` into one target.

This describes an archive relationship. It does not establish external authenticity, completeness, or byte identity.

## Same bytes

Archive presence alone never creates a `same_bytes` relation.

```text
same document label != same bytes
same URL family != same bytes
archive mirror != same bytes
```

A future artifact-registry relation needs a real digest over retained bytes.

## External preservation

CP-ARCHIVE0 does **not** invoke Save Page Now or any other external preservation operation. History ON therefore does not tell Internet Archive to save arbitrary pages the user visits.

A later explicit preservation lane can expose a user action after separate privacy review because sending a URL for archival is an external disclosure/action, not merely local History.

## Boundary

This collector performs no:

- recursive file download;
- metadata API hydration;
- Save Page Now call;
- exact-byte capture;
- same-byte inference;
- central History upload;
- verification/admission/publication/standing movement.
