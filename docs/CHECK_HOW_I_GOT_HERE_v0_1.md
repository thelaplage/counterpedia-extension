# Counterpedia Check — HOW I GOT HERE v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Product thesis

A conclusion is not the whole research object. The path that produced it can
contain valuable information: what was offered, what was selected, what was not
selected, what was later removed, and which routes remain available to explore.

> **A conclusion is cheap. The path that made it intelligible is part of the asset.**

This is the first consumer expression of the longer-term Amnesiac idea that the
apparently "inefficient" residue around cognition can itself be information.

## v0.1 boundary

The extension renders a **session-scoped** inquiry trace only. It is deliberately
not persisted or called Amnesiac memory in this lane.

For the current Check it records:

- the query;
- matched record ids;
- attributable PATHS that were suggested;
- explicit path selection;
- explicit path deselection;
- the order of those interactions.

The surface then shows:

### HOW I GOT HERE

- selected paths;
- an inquiry timeline.

### EXPLORE ANOTHER PATH

- paths that were suggested but are not currently selected;
- one-click return into PATHS to explore them.

Crucially:

```text
not selected != refused
not selected != irrelevant
path selected != contents accepted
```

The v0.1 UI therefore calls these `not selected`, not `rejected` or `refused`.

## Why session-scoped first

A browser clickstream is not automatically durable epistemic memory. Persisting
this topology into Amnesiac requires a reviewed nomination/admission boundary.
This lane proves the interaction and data shape without bypassing that membrane.

Future work may allow an explicitly kept Check or governed Amnesiac candidate to
carry richer atmosphere such as:

- traversed paths;
- parked paths;
- declined-for-now paths;
- rejected claims (separate from path disposition);
- reopening conditions;
- sources that changed the synthesis;
- foreign inquiry branches from FSKN peers.

## Product value

The visual graph becomes useful because it can eventually represent an actual
journey rather than decorative topology. A user can return to a point in the
inquiry and ask:

> What would I see if I took another path from here?

That is the bridge from a pretty knowledge graph to a retraceable **map of
understanding**.
