# Counterpedia Check — Researcher Profiles v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Product thesis

COUNTERPEDIA can teach ordinary users agentic research behavior without making
them configure an agent harness.

The progressive interaction is:

```text
Select PATHS
→ Save the routing
→ Name this researcher
→ Reuse that research lens on another Check
```

A user can understand that a **Music Industry Researcher** considers labels,
rights, distribution, and economics while a **Music Theory Researcher** considers
harmony, rhythm, arrangement, and instrumentation. They do not need to understand
system prompts, tool declarations, graph namespaces, or retrieval configuration.

## v0.1 implementation

A Researcher profile is a named local bundle of explicitly selected PATHS.

The extension can:

1. create a Researcher from the paths selected in the current Check;
2. persist it in `chrome.storage.local`;
3. show which saved paths are represented in a later Check;
4. manually **Use for this Check**, replacing the current path selection with the
   paths from that profile that are actually available.

The profile declares:

```text
retention: local_researcher_profile
memory_admission: not_performed
agent_runtime: none
tool_authority: none
automatic_activation: no
network_egress: none
```

Therefore this lane does not pretend that naming a research lens has created an
autonomous agent.

## Why this matters

This gives a nontechnical user a tangible version of what an agent harness often
encodes indirectly: **what kinds of knowledge should this researcher consider?**

The consumer object is epistemic routing, not personality theater.

Future reviewed lanes can progressively add:

```text
Use these paths by default for music questions
→ attach model/runtime
→ attach bounded tools
→ attach governed memory
→ publish/share the Researcher as a capability
```

Each step must remain separately visible and reversible.

## Non-equivalences

```text
Researcher profile != autonomous agent
saved path != standing
routing scope != tool authority
profile name != expertise proof
manual apply != automatic activation
```

## Marketplace / forum direction

A future agent forum or Knowledge Exchange can make these profiles discoverable
as governed capabilities. The useful comparison is not merely `which agent gives
the best answer?` but:

- which inquiry paths does it usually take;
- which knowledge domains does it consult;
- which paths does it omit;
- what provenance supports those routing choices;
- how does its inquiry topology differ from mine?

That direction is held here; no forum, federation, exchange, or agent execution is
implemented by this lane.
