# Counterpedia Check — Researcher Teaching v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Product thesis

A Researcher is not a private playlist that owns copies of knowledge. It is a governed perspective over knowledge the user controls.

The consumer interaction is deliberately simple:

```text
Music Researcher
  knows about:
  - music theory
  - recording technology
  - record-label economics

Business Researcher
  knows about:
  - strategy
  - contracts

Teach Business Researcher:
  ✓ record-label economics
  □ music theory
```

The user should be able to carry developed knowledge across contexts without flattening the two Researchers into one memory history.

> **Teach another Researcher means carrying governed knowledge across contexts without erasing where it came from.**

## Why this is not merge

The implementation deliberately does not append copied paths into the target Researcher profile.

Instead it records an append-only local teaching metadata history:

```text
source Researcher
+ target Researcher
+ selected attributable path references
+ user tags
+ grant event
+ later retag/revoke events
```

The target Researcher resolves active teaching grants as an effective overlay when it is used.

Therefore:

```text
teach != merge histories
teach != copy knowledge bytes
teach != memory admission
teach != standing adoption
teach != tool authority
teach != agent execution
```

The original provider identity on each path reference survives the teaching operation.

## Tags and metadata history

Teaching grants support user-controlled tags such as:

```text
recording industry
rights
catalog finance
```

Tags are organizational metadata, not epistemic standing.

Changing tags creates a new `retag` event that supersedes the prior metadata event. The original grant and prior tags remain in history. Stopping teaching creates a `revoke` event. It does not erase the fact that the grant previously existed.

This makes the consumer experience behave like an editable tagging/filter system while preserving provenance and historical intelligibility.

## v0.1 storage shape

The local event family is:

```text
counterpedia.researcher-teaching-event.v0_1
```

Actions:

```text
grant
retag
revoke
```

Each event binds:

- `grant_id`;
- `source_profile_id` and name;
- `target_profile_id` and name;
- selected provider-attributed path references on the initial grant;
- user tags;
- event time;
- prior-event continuity for retag/revoke;
- an explicit no-authority boundary.

Boundary:

```text
retention: local_metadata_history
memory_admission: not_performed
knowledge_copy: none
history_merge: none
agent_runtime: none
tool_authority: none
network_egress: none
```

## Consumer surface

The first surface exposes:

```text
TEACH BETWEEN RESEARCHERS

From: Music Researcher
To:   Business Researcher

✓ Record-label economics · Public Counterpedia
□ Music theory · Public Counterpedia

Tags:
recording industry, rights

[ Teach selected paths ]
```

Saved teaching metadata can be filtered by Researcher, path, or tag.

An active grant supports:

- `Update tags` — append a retag event;
- `Stop teaching` — append a revoke event.

## Effective Researcher scope

When a Researcher is applied to a Check, its effective routing scope is:

```text
its own saved PATHS
+
active taught PATHS
```

Deduplication is provider-aware. A same-named path from another provider is not silently substituted.

The receiving profile itself remains unchanged. The teaching overlay can therefore be removed or retagged without rewriting the Researcher's creation history.

## Future Amnesiac composition

This v0.1 lane teaches **path references only**. It does not yet project durable Amnesiac claims, refusals, source roles, inquiry atmosphere, or other knowledge objects.

A later governed lane can generalize the same interaction to granular teaching projections such as:

```text
Teach this source
Teach this conclusion
Teach this path
Teach this Check
Teach what Music Researcher knows about record labels
```

That future projection must preserve source identity, local standing, retention posture, disclosure scope, and the receiving Researcher's own admission policy.

## Product principle

> **Researchers are not separate memory silos. They are governed perspectives over knowledge the user owns.**

And:

> **COUNTERPEDIA turns cross-domain intuition — the moment something learned over here becomes useful over there — into a durable, inspectable, user-controlled operation.**
