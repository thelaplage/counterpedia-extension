# DEMO-CANONICAL-JOURNEY-CURRENT0 — real-browser proof

Status: **PASS / exact tested proof cut**

This record is verification evidence only. It does not admit, publish, grant standing, promote a ClaimSupportEdge, or turn CHECK into an acquisition authority.

## Exact tested source heads

- extension execution head: `d392e6e214f712296c8fde75e05c6ee68cdb363e`
- acquisition main: `efc928ca2b564e433adf7602bb2619d142f3a824`
- authoring main: `ea4f49db1616f024d1ceccd78f901722c10c6e74`
- Counterpedia main: `be25f8fa303902a75a62cafa80524b35138525e1`

The run used Google Chrome for Testing `153.0.8010.36` under Xvfb. Repo-scoped GitHub Actions artifacts were used only to move exact private checkout/runtime bytes into the isolated execution environment; no cross-repo credential was invented.

## Transaction A — encounter -> capture -> draft -> Counterpedia reader

**PASS.** A real browser loaded the real extension and ordinary loopback HTTP source, then a real DOM click on Capture crossed the real Acquisition HTTP boundary.

Observed governed capture:

- acquisition disposition shown by the product: `Captured — UNADMITTED`
- exact retained-byte SHA-256: `sha256:33c7f57537aec2a18de8658ae2f05b7cb8620a51b9bd109a56f0cd3179c70abe`
- byte count: `99`
- capture ID: `cap_2ce32241-51a5-4627-970f-4c411929990f`
- source ID: `src_ebab9095f2458615c35b0c8533910941`

The same real-browser journey then clicked **Draft from source** and crossed the current Authoring v0.5 proposal-only handoff into Counterpedia's canonical proposal reader.

Observed authoring/reader result:

- `Proposal assembled (proposal) — proposal only`
- `Admission: not performed`
- handoff digest: `sha256:91d3a08384c441d5a75f64785a63363025c45bf40cd11ac5a7646ed9f2341236`
- Counterpedia proposal reader HTTP status: `200`
- rendered preview title: `Draft-from-source E2E fixture`

The fresh provenance packet itself hashed to:

`sha256:26485746c7d7614c6ad6689083cc873489d50d6b1ea8ed90bf45cbf9b882bcdf`

Fresh screenshot SHA-256s, in journey order:

1. `af16e7cd9ad8de9d11f683d567063cf5138222fad4a75c8b6bfc6c89418c6c34`
2. `6ce7b5d7e76bb9b61feadf752554abd625c3424a5da66755778377e5c0231187`
3. `7bfe022d766591f01c4b364ea23417dcdc9b0ef70cfeae8a08c42b86e4f354d1`
4. `99967077a089f2428f174e80e98faf5bc79dd8fe7f9e4f9e393cbccddffe4d7d`
5. `d2ee39466b662b975472315e415e87ab12386f0ce90215e2ddecfd75c58ca0a3`
6. `af16e7cd9ad8de9d11f683d567063cf5138222fad4a75c8b6bfc6c89418c6c34`

The matching first/last screenshot digest is expected: the source page itself was unchanged by the transaction.

## Transaction B — explicit CHECK handoff

**PASS against the same Counterpedia proof cut.** The browser opened an ordinary source, applied explicit quote context through the extension's real runtime-message contract, and real-clicked **Open in Counterpedia CHECK**.

The resulting `/check/new` page proved:

- URL and quote were correctly prefilled.
- **0** `POST /api/check/*` requests occurred before the user clicked **Run Check**.
- the real **Run Check** click produced exactly the explicit Counterpedia CHECK request at `/api/check/quote`.
- API status: `not_configured`.
- `receipt_issued=false`.
- attempt capture status: `not_configured`.
- quote integrity: `not_evaluated`.
- rendered UI: `Capture not established` / `Receipt not issued`.
- the extension made **0** requests to its own Acquisition/Authoring/local-companion backend ports during the CHECK flow.
- returning from CHECK left the scanner in the same settled `state-unavailable`; the source URL persisted, while explicit-selection quote context was correctly cleared at the fresh tab-activation page-context boundary.

Transaction-B stdout record SHA-256:

`sha256:4dbe089503f97a26dcacaddcf5d744b3dcc17266440b923a77d81d9a6d905d0a`

### B-harness compatibility correction

The previously landed verifier contained two stale assumptions relative to current product behavior: it expected the raw `not_configured` token to be rendered in the UI, and it compared scanner state before a legitimate tab-reactivation refresh had re-settled. The successful proof used a verification-only correction that:

- binds both local Counterpedia base URLs hermetically;
- captures and parses the exact `/api/check/quote` response;
- requires typed API `not_configured`, `receipt_issued=false`, attempt `capture_status=not_configured`, and quote-integrity `not_evaluated`;
- separately requires the current UI projection `Capture not established` + `Receipt not issued`;
- waits for scanner state to re-settle before the return-state comparison.

Unified compatibility patch SHA-256:

`sha256:763636d2b372dfaadf71a0227182a0f0dc0d78d0c33635132bc691ec2b47583a`

That verifier correction must be reviewed/landed before this execution lane is considered self-contained. It changes verification machinery only, not product behavior.

## Post-run Counterpedia drift

After these runs, Counterpedia `main` advanced from the exact tested `be25f8fa303902a75a62cafa80524b35138525e1` proof cut to `865b91e9e35aa4470a7a62279a5d4c291fcdba01`.

The live compare was classified **DISJOINT** from both tested seams: the delta adds only the `lib/counterpedia/sourceFamilies0/*` presentation-taxonomy plane and its test. It does not touch `/api/counterpedia/reader/proposal`, `/check/new`, or the CHECK API path exercised here.

The exact tested proof remains the `be25f8f...` cut; this record does not pretend the later unrelated commits were executed.

## Authority statement

`AUTHORITY_MOVEMENT=0`

`ADMISSION_EFFECT=none`

`STANDING_EFFECT=none`

Transaction A proves the current encounter/capture/draft/reader composition at the pinned heads. Transaction B proves CHECK remains a separate explicit user-triggered Counterpedia operation and does not silently invoke the extension's acquisition/authoring backends.
