# WIKI-CAPTURE-AUTHOR0 — RETIRED

**Status: RETIRED.**

This document previously described a selection-only bridge connecting a
successful Wikipedia-frontier source capture (see the now-retired
`docs/WIKIPEDIA_FRONTIER_CAPTURE_v0_1.md`) to the existing, still-surviving
generic **Draft from source** action, via `src/lib/governedSourceSelection.ts`
and the `Use for Draft from source` control that lived in the now-removed
`src/panel/wikipediaFrontierCapture.ts` panel.

`counterpedia-acquisition` PR #141 (ACQ-DAGR-DIRECT0) intentionally abolished
the execution contract this bridge fed from (`counterpedia-capture-url`
became plan-only; live execution options were removed), making the Wikipedia
side of this bridge runtime-dead. CAPTURE-CLI-COMPAT1 removes the
Wikipedia-specific capture panel that produced the selection this document
describes.

This document covered **only** the retired execution act's bridge into
authoring. It asserts no replacement execution surface.

`src/lib/governedSourceSelection.ts` and `src/panel/draftFromSourceButton.ts`
are **not** retired: they are a general, non-Wikipedia-specific selection
mechanism and the existing single Draft-from-source dispatch surface,
independently used by other (non-Wikipedia) governed-source producers in this
extension. Only the Wikipedia-specific capture-to-selection wiring described
here is gone.

This document intentionally contains no runnable instructions.
