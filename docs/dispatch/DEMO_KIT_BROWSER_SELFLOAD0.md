# DEMO-KIT-BROWSER-SELFLOAD0

DRAFT / DO NOT MERGE · packaging/runtime repair only · `AUTHORITY_MOVEMENT=0`

## Exact parent

This lane is cut from `DEMO-KIT-INTEGRATION0` #83 exact head:

`41304bc16ce2967bf0c25aa5590b5b723ac67c10`

It does not rebase or transplant another branch.

## Recipient failure reproduced by TEAM r3

The physical TEAM r3 artifact installed successfully from a fresh ZIP extraction, including the seven exact source pins and bundled DAGR binding. The recipient browser step then failed: Counterpedia was absent from `chrome://extensions`.

The live Chrome-for-Testing process was observed using the dedicated demo profile but without the extension flag:

`Google Chrome for Testing ... --user-data-dir=.../CounterpediaLocal/demo-profile http://127.0.0.1:8800/`

The bounded probe returned:

`LOAD_EXTENSION_ARG=NO`

This falsifies neither the extension build nor Chrome-for-Testing support. It identifies a kit orchestration defect.

## First owning boundary

`tools/counterpedia-local/demo_kit_runtime.py` adds the Wikipedia and Terminal convenience tabs by invoking the same browser/profile again. Before this repair those invocations supplied `--user-data-dir` but omitted `--load-extension`.

The nested product launcher already supplied the correct extension binding. The packaging wrapper dropped it on its own subsequent browser invocations.

Classification:

- #83: `ALREADY_IMPLEMENTED / STACK PARENT`
- #82/#79 packaging runtime: `OWNED BASE / COMPOSABLE`
- #81 nested launcher/runtime hardening: `COMPOSABLE`, no owner-byte rewrite required
- other current lanes: `DISJOINT`
- this exact recipient self-load repair seam: `VACANT`

## Repair

1. Resolve the exact bundled extension `dist/` and require `dist/manifest.json`.
2. Every kit-triggered browser invocation on the dedicated demo profile repeats both:
   - `--user-data-dir=<dedicated profile>`
   - `--load-extension=<exact bundled extension dist>`
3. Before adding convenience tabs, prove a live browser command binds the dedicated profile and exact bundled extension together.
4. After adding convenience tabs, prove that exact binding again.
5. If the binding is absent, fail with `DEMO_EXTENSION_LOAD_REFUSED`; do not print the kit READY state. Best-effort teardown delegates to the existing ownership-scoped nested Reset and stops Terminal only if this kit invocation started it.
6. Add a regression test that rejects the exact TEAM r3 failure shape: profile-only Chrome is not extension-load proof.

The test is part of `npm run demo:kit:test`.

## Permanent boundary

This repair changes no scanner, Acquisition, Authoring, DAGR, CHECK, reader, publication, admission, verification, or standing semantics.

Capture remains `UNADMITTED`. Draft remains proposal-only. DAGR execution admission is not Counterpedia content admission.

`AUTHORITY_MOVEMENT=0`
`ADMISSION_EFFECT=none`
`STANDING_EFFECT=none`
`MERGE_AUTHORIZATION=NONE`
