# Counterpedia Check PATHS v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Product thesis

Search engines return documents relevant to a query. Counterpedia Check can
also expose **possible paths through the knowledge already matched by the
query**, allowing the user to participate in forming the inquiry before accepting
or retaining any conclusion.

> **The system may suggest where to look. The user decides which paths become part of the inquiry.**

## v0.1 implementation

PATHS is rendered from the current Public Counterpedia `SearchResult[]` only.
There is no model-generated ontology and no hidden recommendation service.
Suggestions currently come from three mechanically inspectable bases:

1. **Counterpedia structure** — Sources, Why not?, What changed?, Verification.
2. **Matched record paths** — bounded title/subtitle segments from the current
   record set.
3. **Source paths** — exact source labels already visible in matched records.

Every suggestion includes **Why this path?** with:

- provider/domain (`Public Counterpedia`);
- basis type;
- explanatory rule;
- exact record titles/ids that caused the suggestion.

Selecting a path in v0.1 filters the current matched record view by the union of
records behind the selected paths. It performs no new network query. This is a
bounded first implementation of user-governed inquiry routing while richer
Countergraph/FSKN/provider path expansion remains a later lane.

## Saved paths

A user can locally **Save these paths** with an optional name. The saved route is
explicitly:

```text
retention: local_user_preference
memory_admission: not_performed
agent_created: no
automatic_future_inclusion: no
network_egress: none
```

This intentionally creates the stepping stone toward:

```text
Save these paths
→ Use these paths by default for music questions
→ Name this researcher
```

without pretending the final agent exists in this lane.

## Non-equivalences

```text
select path != accept path contents
suggest path != recommendation authority
save path != agent creation
foreign/domain inclusion != foreign standing adoption
path absence != subject irrelevance
```

## Future provider seam

The consumer shape separates suggestion label/kind from provenance. Future
sources may include:

- Countergraph relationship traversal;
- My Knowledge / Amnesiac inquiry history;
- organization graphs;
- FSKN sovereign knowledge nodes;
- specialist domains;
- agent-generated proposed paths.

Those providers must remain attributable and optional. This lane does not claim
they are implemented.

## Product rule

> **COUNTERPEDIA's recommendation system should optimize for intelligible expansion of inquiry, not opaque prediction of engagement. Every suggested knowledge path should be attributable, optional, and reversible.**
