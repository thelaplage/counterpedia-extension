# Counterpedia Check Result Anatomy v0.1

**Status:** implementation lane / product contract candidate  
**Authority movement:** 0

## Product goal

A Counterpedia Check must remain useful when the input is already correct. The
consumer value is not dependent on catching another model in an error. It comes
from exposing the source-based structure that a transient answer normally hides.

> **Every Check should leave the user with more epistemic structure than the source or AI answer they started with.**

## v0.1 surface

The extension already receives the following fields in its public search result:

- supported proposition;
- top source labels;
- Why-not summary and refusal count;
- change posture/count;
- verification posture/tokens.

CHECK-RESULT0 renders that existing material as an evidentiary anatomy instead
of leaving most of it invisible.

The summary reports matched governed records and the number of result surfaces
that carry supported formulations, Why-not material, recorded changes, and
verification material. It does **not** claim to count every factual claim in the
user's input.

Each result card can now expose:

- **Best supported formulation**
- **Sources**
- **Why not?**
- **What changed?**
- **Verify**

## Non-equivalences

```text
matched record != truth verdict
supported formulation != universal truth
citation/source presence != support for every stronger predicate
verification surface != verification of properties not evaluated
no Why-not summary != no possible objection
```

No new model inference, admission, source acquisition, or network action is
introduced in this lane.

## Product framing

Ordinary search returns documents relevant to a query. Counterpedia Check aims
to return the **evidentiary anatomy relevant to a claim or source**.

A correct AI answer therefore remains valuable to Check: the user can turn a
transient synthesis into a source-visible, historically inspectable, locally
keepable research object.
