# WIKI-SESSION-PERSIST0 — RETIRED

**Status: RETIRED.**

This document previously described lifecycle-recovery semantics (panel
close, browser restart, service-worker suspension) for the now-retired
Wikipedia Frontier Capture panel: the local capture-run recovery reader
(`src/lib/wikipediaCaptureRunRecovery.ts`, removed by CAPTURE-CLI-COMPAT1)
and the Wikipedia-specific rendering of a recovered Draft-from-source
selection inside that same removed panel
(`src/panel/wikipediaFrontierCapture.ts`).

`counterpedia-acquisition` PR #141 (ACQ-DAGR-DIRECT0) intentionally abolished
the execution contract (`counterpedia-capture-url` became plan-only) that
this recovery machinery existed to make resumable. With the capture panel
and its capture-run reader removed, the lifecycle-recovery behavior described
here no longer exists as a runnable feature.

This document is scoped entirely to the retired capture act; it is not a
description of the surviving Wikipedia discovery frontier (which has its own
independent, unaffected persistence in `chrome.storage.local` under
`counterpedia_wikipedia_reference_frontier_v0_1` — see
`docs/WIKIPEDIA_HARVEST_BRIDGE_v0_1.md`) nor of the general (non-Wikipedia)
Draft-from-source selection/recovery mechanism in
`src/lib/governedSourceSelection.ts`, which survives unchanged and is used by
other governed-source producers in this extension.

Any `counterpedia.wikipedia_capture_run.v0.1` records already saved locally
by a past install remain untouched local browser data; this retirement does
not reinterpret or migrate them. It only removes the reader/UI that promised
new capture-run recovery remains executable.

This document intentionally contains no runnable instructions.
