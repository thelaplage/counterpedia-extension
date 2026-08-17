# Counterpedia Check — Inquiry Path Provider Contract v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Purpose

PATHS must not become another Counterpedia-only recommendation system. The user
should eventually be able to see attributable routes such as:

```text
FROM PUBLIC COUNTERPEDIA
Sampling technology

FROM MY KNOWLEDGE
Recording technology

FROM DOMAIN I USE
Jazz Discography Commons

FROM ANOTHER RESEARCHER
Mixtape circulation
```

without those providers collapsing into one hidden ranking authority.

## Provider identity

Every path provider has an explicit identity and class:

```text
public_reference
local_knowledge
organization
federated_domain
researcher
agent_proposal
```

A provider proposes an inquiry route. Provider participation does not confer
standing, admission, trust, verification, or tool authority.

## Attribution binding

Provider outputs are aggregated through a registered provider reference. The
aggregator overwrites any self-claimed provider/domain value in a suggestion
payload with that registered identity.

This mechanically protects the consumer meaning:

```text
path suggestion source = registered provider
provider presence != provider authority
suggested path != accepted contents
```

Path ids are provider-scoped so the same route label may legitimately appear
from multiple systems without being silently fused.

That is important for cross-pollination: `Regional radio` from My Knowledge and
`Regional radio` from Jazz Discography Commons are two attributable routes, not
one synthetic consensus object.

## Current live provider

Only **Public Counterpedia** is live in this implementation stack.

The contract deliberately makes room for later reviewed adapters from:

- My Knowledge / Amnesiac;
- Countergraph;
- organization knowledge;
- FSKN sovereign knowledge nodes;
- named Researcher profiles;
- agent-proposed paths.

No adapter above is claimed as implemented here.

## Saved routing and Researchers

Saved PATHS and Researcher profiles preserve provider id/kind alongside each
selected route. Reusing a Researcher does not silently substitute an identically
named path from a different provider.

This preserves a key federation invariant:

> **Interoperability does not require authority fusion.**

## Product rule

> **Every suggested knowledge path should remain attributable to the system that proposed it, even when multiple systems contribute to one inquiry.**
