# WIKI-HARVEST-BRIDGE0 — explicit Wikipedia reference discovery

## Purpose

Connect the already-landed Wikipedia browser collector to the already-landed
`counterpedia-acquisition` ACQ-WIKI0 producer without creating a second
Wikipedia parser or giving the Chrome extension direct Wikipedia network
authority.

The explicit product path is:

```text
active *.wikipedia.org/wiki/<title> page
  -> user clicks Harvest references
  -> Counterpedia Local :8790 (paired loopback only)
  -> counterpedia-wikipedia-harvest (ACQ-WIKI0 producer)
  -> acquisition.wikipedia_reference_manifest.v0.1
  -> strict extension-side validation
  -> fixed public source-resolution index loaded once
  -> exact local known / new / ambiguous / unresolved classification
  -> user selects NEW locators
  -> local discovery frontier
```

The local frontier terminates at:

```text
authority_posture = discovery_only
acquisition_state = not_attempted
admission = not_performed
```

## Why Counterpedia Local owns the bridge

The extension's `wikipedia_v0_1` collector remains pure URL recognition. It does
not scrape the DOM or call MediaWiki. Counterpedia Local already supervises the
installed `counterpedia-acquisition` checkout, so it is the narrow place to
invoke the producer after an explicit user action.

The companion does not parse Wikipedia itself. It executes the installed
`counterpedia-wikipedia-harvest` console producer and refuses any response that
is not `acquisition.wikipedia_reference_manifest.v0.1` with the expected
negative authority boundary.

No `https://*.wikipedia.org/*` Chrome host permission is added.

## Paired-origin boundary

`POST /v0/wikipedia-harvest` accepts only the Chrome extension origin currently
paired with Counterpedia Local. A different extension origin, an unpaired
extension, and non-extension origins are refused before the producer runs.

Request:

```json
{
  "page": "https://en.wikipedia.org/wiki/Example"
}
```

Response: the exact ACQ-WIKI0 `acquisition.wikipedia_reference_manifest.v0.1`
JSON object.

## Known vs new

After the harvest returns, the extension loads the existing fixed
`counterpedia.source_resolution_index.v0.1` artifact. The discovered source URLs
are never included in that network request; matching occurs locally.

```text
exact source match      -> KNOWN (+ corpus_presence)
no exact match          -> NEW
identity collision      -> AMBIGUOUS / HOLD
index unavailable       -> UNRESOLVED / HOLD
```

An unavailable source index never becomes a false `NEW` result.

`KNOWN` means source identity/presence only. It does not mean the source is true,
verified, admitted, published, independent, or supportive of the Wikipedia
statement that cited it.

## Local frontier

Only rows classified `NEW` are selectable in v0.1. The resulting local object is
stored in `chrome.storage.local` under:

```text
counterpedia_wikipedia_reference_frontier_v0_1
```

Schema:

```text
counterpedia.wikipedia_reference_frontier.v0.1
```

This object is intentionally not an acquisition receipt or capture queue. It is
a user-selected discovery frontier for the next producer-owned acquisition
step.

## Non-collapse

```text
Wikipedia encounter != harvest
harvest != capture
Wikipedia citation != claim support
reference recurrence != corroboration
source-index presence != standing
NEW != safe/valuable/true
local selection != acquisition authorization
frontier != CaptureReceipt
frontier != SRS receipt
frontier != admission
```

## Validation target

```bash
npx vitest run \
  tests/wikipediaHarvestBridge.test.ts \
  tests/wikipediaLocalCompanionContract.test.ts
npm test
npm run lint
npm run build:authoring-dev
python3 -m py_compile tools/counterpedia-local/counterpedia_local.py
git diff --check
```

A live acceptance run additionally requires an installed current
`counterpedia-acquisition` environment containing `counterpedia-wikipedia-harvest`,
a paired authoring-dev extension, and an explicit harvest click on a real
Wikipedia page.

**AUTHORITY MOVEMENT = 0. ACQUISITION = NOT PERFORMED BY THE FRONTIER. ADMISSION = NOT PERFORMED.**
