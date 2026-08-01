# R4 measurement harnesses — how to re-run them

Every performance figure in `../research.md` comes from one of the probes in this folder. The
staleness map tells you *when* to re-run them ("on browser major-version change"); this file tells
you how. All of them are self-contained: they build their own data, open a real `file://` URL in
headless Chromium and Firefox via Playwright, and print JSON to stdout.

## Setup

```sh
cd <this folder>
npm i                       # playwright, arquero, the three export libraries, esbuild
npx playwright install chromium firefox
```

`node_modules/` and `dist/` are gitignored, so the first run after a clean checkout needs the install.
Everything else — probe HTML, runners, raw JSON, the measurement notes — is committed.

## The probes

| Run | Answers | Writes |
| --- | --- | --- |
| `node run-render-probe.mjs <engine>` | D1 — virtualization, window swap, row-height budget | `render-probe-raw.json` |
| `node scrollext.mjs` / `node boundary.mjs` | D1 — the scroll-range cliff, bracketed | `scroll-extent-ladder.json`, `element-height-boundary.json` |
| `node run-arquero-probe.mjs <engine>` | D2 — Arquero memory, verb sharing, `reify()` | `arquero-probe-<engine>.json` |
| `node run-graph.mjs <engine>` | Checkpoint D2-a — fan-out, diamonds, the sentinel bomb | `arquero-graph-<engine>.json` |
| `node run-transfer.mjs <engine>` | **D3/M1** — structured clone across a worker boundary | `transfer-<engine>.json` |
| `node run-export.mjs <engine>` | **D3/M2 + D4/M8** — export cost, cancellation, progress | `export-<engine>.json` |
| `node run-sab.mjs` | **D3/M8** — can a SharedArrayBuffer reach a worker from `file://`? (both engines in one run) | stdout only |
| `node run-pipeline.mjs <engine>` | **D4/M5 + M7** — 30-Step recompute, memoization, full-dataset search | `pipeline-<engine>.json` |
| `node run-contention.mjs` | **D4/M6** — Editor / table contention (both engines in one run) | `contention.json` |
| `node run-worker-build.mjs` | **D3/M4** — the one-file build gate with a real Worker (both engines) | `worker-build.json` |

`<engine>` is `chromium` or `firefox`. Redirect stdout to the JSON file named above; the runners
print progress on stderr.

Two probes need a build first:

```sh
(cd editor-table-app && npx vite build)     # before run-contention.mjs
(cd worker-build-app  && npx vite build && npx vite build --config vite.config.idiomatic.js)
                                            # before run-worker-build.mjs — both variants
```

`hyparquet-writer.iife.js` is generated from `hpw-entry.mjs` (the package ships ESM only):

```sh
npx esbuild hpw-entry.mjs --bundle --format=iife --outfile=hyparquet-writer.iife.js
```

## The two apps

- **`editor-table-app/`** is the Editor spike's own Vue Flow build
  (`spikes/editor-vueflow-2026-08-01/app/`) with its wiring carried over verbatim, plus a real
  virtualized table pane (`src/TableWindow.vue`) and a contention harness (`src/perf.js`). Open
  `dist/index.html?steps=30` in a browser to drive it by hand. It is a **measurement artefact, not
  product code** — the spike remains the reference for the Editor itself.
- **`worker-build-app/`** exists only to prove R2's two build rules with a real worker in the
  bundle. It builds twice on purpose: the correct `?worker&inline` form and the idiomatic
  `new Worker(new URL(...))` form that emits two files.

## Reading the results

Each probe has a companion note that turns its raw JSON into prose with the method stated:
`transfer-measurement-`, `export-measurement-`, `pipeline-measurement-`,
`contention-measurement-`, `worker-build-measurement-`, plus D1's and D2's from the first session.
**The notes are the citable artefact; the JSON is the evidence behind them.**

## Things that will bite you if you extend these probes

Each of these produced a confidently wrong number in this run before it was caught, and each is
documented in the note it belongs to:

- **`MessageEvent.data` deserializes lazily in Chromium.** A timestamp taken at the top of
  `onmessage` measures nothing. Time the `.data` access itself, and touch the whole payload.
- **Vue patches on the microtask queue.** Reading layout synchronously after a state change
  measures the *old* DOM. Await `nextTick()` first.
- **A resize you cannot see is not a resize.** Check that node heights actually changed before
  believing a `ResizeObserver` measurement.
- **`await writeXlsxFile(sheet)` returns the builder**, not a Blob. Call `.toBlob()`.
- **hyparquet-writer's option is `codec`, not `compressed`**, and an unregistered codec is written
  as raw bytes under the requested label — silently, and unreadably.
- **Heap figures are Chromium-only.** Firefox exposes no `performance.memory`, so any memory number
  in these reports is Chromium's.
- **Run the timing probes on an idle machine.** One contention run taken alongside an npm install
  and two Vite builds showed Firefox dropping frames; it did not reproduce when run alone.

## The stray Parquet files

`codec-SNAPPY.parquet`, `codec-UNCOMPRESSED.parquet`, `codec-GZIP.parquet` and
`codec-GZIP-fixed.parquet` are the four 2,000-row files behind source [42] — the pyarrow 25
cross-check that showed `codec: 'GZIP'` producing a file a real reader refuses. Re-check with:

```sh
uv run --with pyarrow python3 -c "import pyarrow.parquet as pq; print(pq.read_table('codec-GZIP.parquet'))"
```
