# Original measurement — the one-file build gate with a real Worker (querbeet R4/D3, M4)

**Date:** 2026-08-01 · **Harness:** `worker-build-app/` (two Vite single-file builds) +
`run-worker-build.mjs`, headless Playwright 1.62, real `file://` URL · **Engines:** Chromium
151.0.7922.34, Firefox 153.0 · **Raw:** `worker-build.json`.

R2 wrote two build rules and the Editor spike's build never exercised either, because it contains
zero `new Worker` occurrences. This builds the first querbeet artefact that actually has a worker in
it, and builds the wrong form alongside it so the difference is demonstrated rather than inherited.

The worker is not a stub: it imports **hyparquet-writer 0.16.3** — the ESM-only dependency that made
the build step mandatory in the first place — and **fflate's `gzipSync`**, which is what makes a GZIP
Parquet file readable (M2). If those inline, everything smaller will.

## Result

| | `./exportWorker.js?worker&inline` | `new Worker(new URL('./exportWorker.js', import.meta.url), {type:'module'})` |
| --- | --- | --- |
| Files in `dist/` | **1** | **2** — `index-idiomatic.html` (607 B) + `exportWorker-DlJonCmc.js` (61,493 B) |
| Entry HTML size | 62,612 B | 607 B — a stub |
| Chromium 151 from `file://` | **worker ran**, 64,801 B Parquet in 56.4 ms | **`SecurityError: Failed to construct 'Worker': Script at 'file:///…/exportWorker-DlJonCmc.js' cannot be accessed from origin 'null'.`** |
| Firefox 153 from `file://` | **worker ran**, 64,801 B in 47 ms | **worker ran**, 64,801 B in 36 ms |

Both rules hold. The build succeeds either way — `vite build` reports success and exits 0 for the
two-file variant — which is exactly why R2 made "`dist/` contains exactly one file" a gate rather
than a habit.

## The nuance R2's rule did not have: the idiomatic form fails in Chromium *only*

R2 recorded the idiomatic form as throwing synchronously in Chromium. It does. What is new here is
that **Firefox 153 runs it fine** — it loads a sibling worker script from a `file://` page without
complaint, and the export completed in 36 ms.

That makes the trap worse rather than milder, because Chromium is the lead browser (project
decision 2026-08-01). A developer who checks the two-file build in Firefox sees a working app and
ships an artefact that fails on the browser every colleague actually has. The one-file gate catches
it before any browser is opened, which is the argument for keeping the gate mechanical.

## `new Worker` is now a poor gate signal, and that matters for R6's screening method

The **correct** artefact contains **2 occurrences of `new Worker` and 1 of `createObjectURL`** —
inlining a worker *requires* constructing it from a blob URL, so the string that R6's hard-gate scan
treats as a hazard is also the signature of the fix. Separately, M3 found `read-excel-file` 9.3.5's
shipped bundle carrying 2 occurrences of `new Worker` as pure dead code behind a hardcoded
`CAN_USE_WORKER = false`.

So a built artefact can contain `new Worker` for three different reasons — a correctly inlined
worker, dead library code, and a genuinely fetching worker — and only the third is a failure.
**Grep `new Worker` to start a question, never to answer one.** The reliable gate is the file count
plus opening the artefact from a real `file://` URL in both engines, which is what this harness does.

## Incidental

Chromium reports the worker's own `blob:` URL as a request (`blob:null/43d68c42-…`); Firefox reports
none. Neither engine issued any request to a real URL, and there were no failed requests.
