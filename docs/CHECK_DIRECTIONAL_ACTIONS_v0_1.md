# Counterpedia Check Directional Actions v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Purpose

Counterpedia should not require a user to understand knowledge graphs, RAG,
federation, Amnesiac, or admission semantics before the product becomes useful.
The first consumer vocabulary is intentionally tiny:

- **CHECK** — What does this support?
- **KEEP** — Put this in my private research trail.
- **USE** — Allow this for the current AI/task.
- **PUBLISH** — Propose a bounded public version.
- **SHARE** — Send a governed projection or bundle.
- **REFUSE** — Record a governed refusal.

The vocabulary names the intended directional acts. Naming an act does not make
it implemented or authorized.

## v0.1 implementation boundary

Only CHECK and KEEP are operative in this lane.

CHECK reuses the extension's existing Counterpedia/source-match behavior. KEEP
writes a bounded structured research artifact to `chrome.storage.local`.

Every locally kept entry declares:

```text
retention: local_research_trail
memory_admission: not_performed
publication: not_performed
network_egress: none
```

Therefore:

```text
checked != remembered
kept research != admitted agent memory
keep != publish
keep != share
```

USE, PUBLISH, SHARE, and REFUSE remain mechanically HELD until their actual
governed owners are wired. The extension must not simulate those operations.

## What KEEP preserves

The user may keep three different things:

1. **Source** — a bounded source locator snapshot plus whether the page was
   explicitly observed through browser capture.
2. **Record** — one selected Counterpedia search result, including its supported
   proposition, source labels, Why-not summary, change posture, and verification
   posture.
3. **Check** — the current query plus the structured record snapshots returned by
   Counterpedia and the source locator when available.

This is intentionally more useful than bookmarking a URL. The retained object
preserves the structured result of the Check while keeping authority separate.

## Non-goals

This lane does not:

- admit anything into Amnesiac ClaimGraph;
- create ShadowGraph refusal state;
- authorize an agent to use retained material;
- publish or propose a public Counterpedia record;
- create an FSKN bundle or share operation;
- add network egress;
- infer truth from a saved search result;
- turn browser observation into source authenticity.

## Product principle

> **COUNTERPEDIA does not ask users to maintain a knowledge graph. It turns the ordinary act of checking something into the gradual construction of a governed knowledge system.**

And:

> **Find value now; save the structured result.**
