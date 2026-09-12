# LOCAL-VERIFY0 — private local intelligence + public Counterpedia verification

Status: **DRAFT / DESIGN ONLY / DO NOT MERGE WITHOUT SEPARATE OWNER GO**

Base reviewed: `counterpedia-extension/main@5a7c317fcf6eda48563cca1914e3ba0c41454223`

`AUTHORITY_MOVEMENT=0`

## 1. Purpose

Counterpedia's local/browser substrate already supports bounded observation, exact capture handoff, local companion orchestration, retained-capture authoring and explicit proposal-only boundaries. The next product layer is not another capture/demo path; it is a local intelligence composition that lets a user keep their model, RAG and private working state local while resolving public verification records from Counterpedia.

The product thesis is:

> **Run the intelligence anywhere. Verify against Counterpedia.**

And the privacy rule is:

> **Move the public question across the boundary, not necessarily the private context that produced it.**

## 2. Boundary model

```text
PRIVATE LOCAL ENVIRONMENT

local model
local RAG / embeddings
private documents
notes / working memory
browser-local observations
private assessments
credentials / preferences

        |
        | bounded proposition and/or public object ref
        v

PUBLIC COUNTERPEDIA NETWORK

registry identity
public source/artifact refs
CHECK assessment records
AssessmentReceipts
Countergraph relations
public lineage / supersession

        |
        | compact public result + refs/receipts
        v

PRIVATE LOCAL ENVIRONMENT

model revises / qualifies answer
local cache / private work product
optional explicit contribution proposal
```

Downward read does not imply upward publication.

## 3. Local privacy invariant

Counterpedia-compatible local operation must not require upload of:

- the user's private corpus;
- local RAG index;
- full conversation/history;
- unpublished notes;
- local model weights/state;
- private prompts that are not needed for the bounded public question;
- private credentials or local filesystem paths.

A user may explicitly choose to disclose any of those in a later governed contribution workflow, but contribution is an action, not telemetry.

## 4. Local CHECK request shapes

The smallest useful public operation is one of:

### A. Verify a bounded proposition

```text
claim_text / claim digest
optional public evidence refs
optional as-of/currentness requirement
requested procedure kind
```

### B. Resolve an existing public object

```text
claim/source/assessment/receipt ref
```

### C. Compare local statement against a public record

The local process performs the private extraction/comparison setup and sends only the bounded public proposition or resolvable public identifiers required by CHECK.

The local client should never pretend that stripping context is lossless. If CHECK cannot lawfully assess the proposition without additional public context, it should return a typed limitation or `not_evaluated` rather than request the whole private workspace by default.

## 5. Model independence

The local composition must not depend on one inference provider.

Candidate adapters may include:

```text
Ollama
LM Studio
OpenAI-compatible local endpoints
Apple/on-device runtimes
other local or remote models selected by the user
```

The common interface should be smaller than any provider SDK and should treat the model as a consumer/proposer, not as Counterpedia authority.

A provider adapter may:

- submit a user question to the chosen model;
- extract candidate propositions locally;
- ask whether the user wants important claims checked;
- pass bounded public propositions to Counterpedia CHECK;
- return assessment/receipt refs to the local model context.

It may not make model confidence a Counterpedia support result.

## 6. Product interaction

A simple local UI/CLI should eventually support:

```text
Answer locally
Verify important claims
Verify selected claim
Show Counterpedia record
Show evidence / method / limitations
Save verification receipt locally
Compare public record with private document
Draft a contribution without publishing
Show what could be contributed publicly
```

The default should make private/public boundaries visible rather than hide them.

## 7. Stale-training demo

Canonical forcing demo:

```text
User:
Is X still the applicable standard?

Local model:
My training suggests X.

Counterpedia:
X SUPERSEDED_BY Y on [date].
Governing source: ...
Capture/artifact: ...
Assessment: ...
Receipt: cp:assessment-receipt/...

Local model:
X was applicable previously, but Y superseded it on [date] ...
```

The intelligence did not change. The weights were not retrained. The local system gained current, inspectable standing by consulting the public verification network.

## 8. Local cache / snapshot behavior

A local client may cache public Counterpedia objects and receipts.

Every cached object must preserve:

- canonical public ref;
- exact digest/version where applicable;
- retrieved_at locally;
- upstream assessed/checked time separately;
- resolver/source endpoint identity when useful diagnostically;
- explicit stale/snapshot posture.

A cached object proves what the local client retained. It is not automatically a current-network result after the cache becomes stale.

Useful distinction:

```text
verified_against_local_snapshot
verified_against_current_network
```

The exact vocabulary remains a later contract decision; clients must not silently present old cache state as current.

## 9. Existing substrate to reuse

LOCAL-VERIFY0 must compose existing work rather than reimplement it:

- Extension scanner/observation remains sensing only.
- Counterpedia Local companion remains the local process/bridge owner.
- Acquisition remains exact capture/custody owner.
- Counterpedia Audit remains CHECK epistemic-assessment owner.
- Counterpedia public resolver owns public receipt/object dereference.
- Countergraph owns agent-readable public projection.
- DAGR/SRS own governed action lifecycle/receipts where invoked.

The active Demo Kit current-main reconciliation (#91 at design time) owns broad local/demo runtime paths. Therefore this lane is docs-only until that ownership settles; do not modify `tools/counterpedia-local/*`, extension runtime, launcher, package.json or demo-kit files from this branch.

## 10. Proposed implementation slices after current local/demo ownership settles

### LOCAL-VERIFY1 — public resolver client

A small transport-neutral local client for:

```text
resolve AssessmentReceipt
resolve public source/claim objects
run canonical hosted CHECK
```

No LLM dependency.

### LOCAL-VERIFY2 — model adapter interface

One small interface + one local-model implementation (likely the easiest available local runtime), with model selection kept outside semantic contracts.

### LOCAL-VERIFY3 — claim-check loop

```text
local answer
 -> locally select/extract proposition
 -> explicit CHECK action
 -> receive public result/refs
 -> local answer revision
```

No automatic publication.

### LOCAL-VERIFY4 — private overlay / cache

Persist public refs/receipts alongside local-only notes/doc refs without uploading local corpus state.

### LOCAL-VERIFY5 — explicit contribution handoff

User-selected local material becomes an authoring proposal. It crosses the existing governed admission boundary and remains proposal-only until admitted.

## 11. Security / privacy defaults

- local service binds loopback by default;
- public reads are client-initiated outbound operations;
- Counterpedia server does not initiate arbitrary local callbacks;
- private file paths are never sent as public provenance;
- model/provider credentials stay local;
- contribution requires explicit user action;
- telemetry must not contain private prompts/corpus content by default;
- local model provider selection has no effect on Counterpedia standing.

## 12. Stop conditions

STOP rather than implement if a design requires:

- automatic upload/sync of private RAG to use public CHECK;
- browser observation being treated as support;
- local model confidence being converted to SupportState;
- a new local verification engine instead of canonical CHECK;
- automatic contribution as a side effect of reading/verifying;
- provider-specific model IDs entering public claim identity;
- private local assessments appearing public merely because they use Counterpedia-compatible shapes.

## 13. Success condition

A successful first product proof is:

```text
one local model
+ one private/local context
+ one public stale/supersession question
+ canonical Counterpedia CHECK
+ resolvable AssessmentReceipt
+ updated local answer
+ zero publication of private context
```

That proves the strategic lane: shared verification network, private intelligence.
