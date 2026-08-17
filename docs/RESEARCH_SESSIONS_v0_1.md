# CP-RESEARCH-SESSION0 — local Research Sessions v0.1

**Status:** DRAFT / stacked on CP-COLLECTOR0  
**Authority movement:** 0  
**Network egress:** 0

## Purpose

Let a user deliberately group the local History Encounters produced during one research activity.

```text
Start Research Session
        |
        v
named local session
        |
History ON + encountered page
        |
        v
Encounter(session_ref)
        |
        v
session.encounter_ids[]
```

The session stores Encounter references, not duplicated source/page bodies.

## Explicit lifecycle

V0.1 permits at most one active session.

- **Start** creates a named local session.
- **Stop** closes it and preserves its Encounter refs.
- Deleting an active session is refused; stop it first.
- Session names are user metadata, not corpus identity or proof of subject classification.

## History remains authoritative

An active Research Session never turns History on.

```text
active session + History OFF
        =
zero passive Encounter writes
```

The session may remain open while History is OFF. The panel states that no passive encounters will be added until the user turns History back ON.

## Storage

Sessions use `chrome.storage.local` and carry:

- local `session_ref`;
- user-supplied name;
- start/stop timestamps;
- Encounter IDs;
- fixed `retention: LOCAL_ONLY`.

V0.1 does not sync, share, publish, summarize, or model the session.

## Personal graph posture

The session timeline is a local research projection. It is **not** canonical Countergraph state.

Countergraph currently projects governed corpus state read-only. A future personal overlay/provider needs a separate owner decision instead of silently turning Research Sessions into a second canonical graph.

## Boundary

Research Session does not:

- create an agent or Researcher automatically;
- run a model;
- crawl links;
- upload browsing history;
- write Countergraph;
- admit Amnesiac memory;
- verify/admit/publish corpus state.
