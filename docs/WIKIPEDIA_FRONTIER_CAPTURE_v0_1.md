# WIKI-FRONTIER-CAPTURE0 — RETIRED

**Status: RETIRED.**

This document previously described an explicit Wikipedia-discovered-source
capture chain (`Counterpedia Local POST /v0/capture-url` ->
`counterpedia-capture-url` -> `AcquisitionMcpSurface.capture_url`) built in
extension PR #36 on top of `counterpedia-acquisition` PR #99's execution
command.

`counterpedia-acquisition` PR #141 (ACQ-DAGR-DIRECT0) intentionally abolished
that execution contract: `counterpedia-capture-url` became a plan-only CLI
and its live-fetch/live-execution options were removed. From that point the
Wikipedia Frontier Capture consumer chain described here was calling a
producer surface that no longer executes, making the feature runtime-dead.

This retirement (CAPTURE-CLI-COMPAT1) removes the extension-side consumer of
that abolished execution act: `src/lib/wikipediaFrontierCapture.ts`,
`src/panel/wikipediaFrontierCapture.ts`, its wiring in `src/panel/entry.ts`,
the Counterpedia Local `/v0/capture-url` route, `LocalSupervisor.capture_url()`,
and their dedicated tests.

No replacement execution surface is asserted by this document or by the
extension. The **Wikipedia reference discovery frontier** (harvesting,
`counterpedia.wikipedia_reference_frontier.v0.1`, `acquisition_state =
not_attempted`) is a separate, independent feature and is **not** retired —
see `docs/WIKIPEDIA_HARVEST_BRIDGE_v0_1.md`.

Historical `counterpedia.wikipedia_capture_run.v0.1` records already saved by
any past install of this feature remain valid historical producer
observations of what the (now-abolished) producer command reported at the
time. Retiring the current feature does not reinterpret, migrate, or
invalidate that old evidence; it only removes the extension surface that
promised the capture act remains executable today.

This document intentionally contains no runnable instructions.
