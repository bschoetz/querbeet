# querbeet – Technical Research Plan

This file tracks the five technical research runs needed before implementation starts.
Each item is meant to be executed as one `/bmad-technical-research` (→ bmad-deep-recon,
type: technical) run. Check items off and link the resulting report when done.

Constraints that apply to every research question (from `idea.md`, section 3 – fixed):

- Single HTML file, no server, no backend; all processing client-side.
- CDN libraries allowed; a build step that emits one HTML file is acceptable.
- Target data size: ~100,000 rows max, typical case 2–5 report files.
- Browsers: Firefox 145+, Edge 143+, Chrome 143+ (Safari optional).

---

## R1 – Transformation engine

**Status:** [x] done (deep-recon, type technical, shape select, 2026-08-01)
**Report:** `_bmad-output/planning-artifacts/research/technical-transformation-engine-2026-08-01/research.md`

**Research verdict: hand-written array functions — no engine dependency** (94/100 on the
weighted matrix). Runner-up Arquero (68). AlaSQL is rejected: a measured 25.2 s two-key
join at 100k rows (Arquero: 95 ms) plus documented, still-open silent-wrong-answer join
bugs — this overturns the proposal in `idea.md` section 4. DuckDB-WASM fails hard gate G2
on size (~8 MB gzip, ~50 MB inlined into one HTML file), not on capability.

**PROJECT DECISION: Arquero** — overrides the research recommendation. Rationale: a
complete, widely used library is more battle-tested than freshly written bespoke code.
A follow-up deepening (same run folder, section "Deepening: adopting Arquero") revised
the dormancy risk downward: npm downloads grew roughly tenfold *during* the dormancy, and
forking is cheap and measured — 10,764 lines of source, 392 tests passing on Node 26, two
runtime dependencies. Arquero's C2 score rises from 1/5 to 3/5, moving it 68 → 76. Still
below 94, so the recommendation stands as research, but the trade is a reasonable one
made deliberately.

**Three traps the implementation must handle** (all measured against released 8.0.3):
`concat` silently drops columns unique to incoming tables — pad every table to the union
of column names first; null join keys never match and no option changes that — use
sentinel substitution (30.8 ms), never a predicate function (~3.7 s projected, drops to a
nested-loop join); duplicate keys produce a Cartesian product. And critically,
`fromCSV`'s default type inference **silently corrupts German numbers** — `1.234` becomes
1.234 instead of 1234 — while sampling only the first 1000 rows, so always pass explicit
per-column `parse` functions or feed Arquero via `aq.from()` after parsing elsewhere.

Key evidence: an original benchmark run for this decision (100k rows x 20 cols joined
against a 5k lookup) is preserved in the run folder's `imports/`. Plain JavaScript
completes the full realistic pipeline in 10.5 ms and needs ~471 bytes per row.

Feeds R4 below (memory budget, worker question) and closes `idea.md` section 9's open
question on the transformation engine.

**Question:** Which client-side transformation engine should power the pipeline steps
(union with column mapping, join on key columns, filter, column edit, computed columns,
later group-by)?

**Candidates to compare:**
- AlaSQL (SQL over JS arrays – proposed in idea.md)
- Arquero (dplyr/pandas-style dataframes for JS)
- Danfo.js (pandas-like)
- DuckDB-WASM (full SQL engine; check WASM size vs. single-file/offline constraint)
- Hand-written array functions (no dependency)

**Decision criteria:** maintenance status, bundle size, CDN availability,
performance at 100k rows (especially joins), API fit for a linear click-together
step list (do we need SQL at all?), license.

---

## R2 – UI framework

**Status:** [x] done (deep-recon, type technical, shape select, 2026-08-01)
**Report:** `_bmad-output/planning-artifacts/research/technical-ui-framework-2026-08-01/research.md`

**Research verdict: Vue 3 on the global build, no build step** (88/100 on the weighted matrix).
Runner-up Preact + htm (80) — better on three of six criteria and only 13 KB, held back solely
by htm's dormancy (last release 2022-04-26, last commit 2024-02-01); it wins if you are willing
to vendor htm's 1.3 KB and own it. Alpine.js (76) is the right answer to a slightly different
question: smallest surface and the best form binding, but no component system, so five step
kinds mean five `x-if` branches with no way to factor the markup. Vanilla JS 65.

**Two hard facts, both measured for this decision rather than cited:**

- **Deep reactivity over the dataset is unaffordable, and `Object.freeze` is the escape.**
  `reactive()` over 100k×20 inside a render effect costs 437–479 MB on top of 160 MB of data
  and slows a full read 11–13x; frozen rows add no reactivity overhead at all, for ~4% more
  heap in the freeze itself. The dominant cost is per-*key* dependency tracking, so estimates
  derived from proxy count understate it tenfold. Vue 3.5's reactivity rewrite does not help
  this shape — which means Alpine's five-year-old pinned core costs nothing here.
- **The `file://` folklore is wrong.** An *inline* `<script type="module">` runs fine from a
  double-clicked file in Chromium 150 and Firefox 153; only modules that *fetch* are blocked.
  Also blocked: `fetch()` of a sibling, dynamic `import()`, workers from a file URL. Classic
  workers from a blob URL work in both engines — **this closes R1's open worker question**.

**Alpine passed the hard gate by measurement** (both engines): 100k frozen rows sit in `x-data`
with no proxy created while the small step array stays fully reactive, and `x-model` writes back
through `x-for` into nested config objects. It loses on ergonomics, not on capability.

**PROJECT DECISION: the Vite build path (Path B)** — overrides the report's recommendation of the
no-build path. Framework choice unchanged. Rationale: real Single-File Components instead of HTML
in JavaScript strings, at the price of a toolchain. A follow-up deepening (same run folder, section
"Deepening: the Vite single-file build path") built it end to end and found the trade better than
expected: one file of **280,519 B**, running identically from `file://` in Chromium 150 and
Firefox 153, which is **~121 KB / 30% smaller** than the no-build path's libraries alone — templates
compile at build time so runtime-only Vue ships automatically, and Arquero is tree-shaken.

**Three build rules that are not optional:**

1. Import every Web Worker as `./w.js?worker&inline`. With Vite's idiomatic
   `new Worker(new URL(...), {type:'module'})` the build still reports success but emits **two**
   files, and from `file://` the worker constructor throws synchronously in Chromium and takes the
   rest of the component mount with it. Measured.
2. **Gate the build on "`dist/` contains exactly one file."** On this path, build success does not
   imply a working artifact.
3. Set `worker: { format: 'iife' }` and `build.modulePreload: { polyfill: false }`; never pass a
   `build` object through the plugin's `overrideConfig` (shallow merge — it discards the plugin's
   own settings); keep nothing in `public/`.

Commit the lockfile and the built `querbeet.html`, and record the Node and Vite versions of a
known-good build — the toolchain is now a dependency with a five-year horizon.

**Architecture constraints this sets:** freeze every dataset at the boundary and hold results in
`shallowRef`; never render more than a ~50-row window; construct any worker as a classic script
from a blob URL; inline everything, since nothing is fetchable at runtime; and keep the pipeline
core framework-free so a framework swap only rewrites the view layer.

**Do not spend design effort on bundle size:** Arquero is 236,290 B raw — larger than Vue's
entire global build — and the spread across every UI candidate is ~58 KB gzip.

**The one open question is the one that decides it:** how the step list actually feels to author
in Vue without SFCs was not measured, and two rounds of searching found no multi-year
retrospective on Vue-via-CDN or on Alpine in a nontrivial app. Build the step list for two step
kinds in one HTML file before committing.

**Question:** Vue 3, Alpine.js, or vanilla JS for a reactive three-pane UI
(sources / pipeline steps / live preview)?

**Key aspects:**
- Reactivity model for live preview updates after every pipeline step.
- CDN usage without build step (Vue: in-browser template compiler) vs.
  Vite + `vite-plugin-singlefile` build that still emits one HTML file.
- Size, offline behavior after first load, long-term maintainability.

**Decision criteria:** developer ergonomics for the step-list UI, footprint,
whether the build-step option changes the trade-off. Decide together with R1
(engine + framework define the architecture).

---

## R3 – File formats & parsing

**Status:** [x] done (deep-recon, type technical, 2026-08-01)
**Report:** `_bmad-output/planning-artifacts/research/technical-file-formats-and-parsing-2026-08-01/research.md`

**Verdict: the whole file-handling stack costs ~64 KB gzipped, and Parquet stays in scope.**

| Job | Pick | Gzipped | Licence |
| --- | --- | --- | --- |
| CSV | PapaParse 5.5.4, `dynamicTyping: false` | 7,076 B | MIT |
| Encoding | none — `TextDecoder` BOM sniff + strict-UTF-8 probe | 0 B | platform |
| XLSX write | write-excel-file 4.1.1 | 19,132 B | MIT |
| XLSX read | read-excel-file 9.3.5 | 15,254 B | MIT |
| JSON repair | jsonrepair 3.15.0 (only on `JSON.parse` failure) | 2,880 B | ISC |
| JSON preview | json-formatter-js 2.5.23 | 3,250 B | MIT |
| JSON flatten | own code — no library's default fits | – | – |
| Parquet export | hyparquet-writer 0.16.3 | 17,239 B | MIT |

**Three findings that drive it.** (1) *Measured against released 5.5.4:* PapaParse's
`dynamicTyping` turns `"1.234"` into the number 1.234 — wrong by 1000x, silently — while
leaving `"1.234,56"` a string in the same column, and drops leading zeros (`"0123"` → 123).
Same bug class as Arquero in R1: **treat every library's automatic typing as unsafe for
German data and own the parser.** (2) **SheetJS loses to an MIT pair, 88 vs 61** on the
weighted matrix: SheetJS CE is 334 KB gzipped, paywalls bold headers and conditional
formatting behind an unpriced Pro licence, has no release in 2 years and no commit in
6 months; `write-excel-file` + `read-excel-file` are 34 KB together, include styling free,
and their output was verified with openpyxl (umlauts, €, leading zeros, real numbers with
`#,##0.00`, real dates, bold headers, column widths — all correct). SheetJS stays the
runner-up and wins only if legacy `.xls`/`.xlsb`/`.ods` must be read. (3) **Parquet was
expected to be dropped — it should not be.** hyparquet-writer is pure JS with no WASM,
17 KB bundled, and its output was read correctly by pyarrow 25, DuckDB 1.5.5 and Polars
1.43.2 across three codecs. `parquet-wasm` (6.5 MB WASM, fetched at runtime) is what would
have failed the gate.

**Encoding is settled and needs no library.** The WHATWG Encoding Standard makes
`windows-1252` mandatory in every browser and maps `iso-8859-1`/`latin1`/`us-ascii` onto
that same decoder — so the classic 1252-vs-8859-1 discrimination problem does not exist
here. What remains is binary: is it valid UTF-8? Answer it with
`new TextDecoder('utf-8', {fatal: true})`. Note that **Microsoft documents no code page
for plain CSV export at all** — build for not knowing, and give the user an override.
This closes `idea.md` section 9's open question on CSV encoding.

**Two traps for the implementation.** `write-excel-file` 4.1.1's documented `filePath`
option is a **silent no-op** on the Node entry (returns `{toBuffer,toStream,toFile}`;
no file, no error) — verify options took effect rather than trusting its README. And
`jsonrepair` can throw `RangeError` from stack overflow, not just `SyntaxError`, so catch
both.

**The report was citation-verified** by a fresh-context pass: all WHATWG encoding claims
and all byte sizes confirmed, one claim overturned (the `read-excel-file` worker statement
above), six numbers corrected against the raw measurement artefacts, one internal
contradiction resolved. See the report's "Verification note" section.

**Feeds R4.** Measured costs: transformation 10.5 ms (R1), Parquet export 273 ms,
**xlsx export ~3.3-3.4 s** at 100k rows. Only xlsx export is long enough to freeze a tab.
R2 settled the platform question in parallel — a **classic Worker from a `blob:` URL works
from `file://`** in Chromium 150 and Firefox 153 — so that worker is buildable; construct
it as a classic script from a blob URL with the library inlined into the worker body.
What stays open is one library's internals: `read-excel-file` uses a worker somewhere
(dependency `worker-f`) but its README carries both the claim and an explicit retraction
of it, so whether its construction survives `file://` needs source-reading. Fallback if
not: the `read-excel-file/web-worker` export, which spawns none.
**Every performance number in the report is Node, not browser.**

**Also relevant to R5:** the German number/date parser is now load-bearing architecture,
not a utility — two libraries have already been measured corrupting German numbers by
default.

**Question:** Which libraries and strategies for reading and writing the supported
formats (CSV, JSON first; XLSX second stage; Parquet export if feasible)?

**Sub-questions:**
- CSV: PapaParse capabilities – delimiter/header auto-detection, streaming.
- Encoding detection UTF-8 vs. Windows-1252 (German Excel exports!) –
  PapaParse does not do this itself; evaluate jschardet or similar.
- XLSX: SheetJS Community Edition (CDN) vs. Pro – feature and license situation,
  both for reading and for "opens cleanly in Excel" export (umlauts, number formats).
- JSON: tolerant parsing of LLM-broken JSON (e.g. `jsonrepair`); libraries for
  nested-JSON preview and flattening.
- Parquet export: is there a viable browser library (hyparquet, parquet-wasm)?
  If not, explicitly drop Parquet from scope.

---

## R4 – Performance & table rendering

**Status:** [ ] open
**Report:** –

**Question:** How do we keep the UI responsive with up to 100k rows?

**Sub-questions:**
- Table preview rendering: virtualization needed? Lightweight virtual-table
  libraries vs. hand-rolled windowing (preview shows ~50 rows, but full-result
  view and export must handle 100k).
- Should transformations run in a Web Worker to avoid UI freezes during joins?
- Memory footprint of 2–5 files × 100k rows in the chosen engine (input from R1).

**Inputs already settled by R2** — do not re-research these:
- A Web Worker *can* be created from a `file://` page: classic workers from a `blob:` URL or a
  `data:` URI work in both Chromium and Firefox. A module-type blob worker works in Firefox and
  fails in Chromium, and `new Worker('./file.js')` fails in both — so construct workers as classic
  from a blob URL. This closes the question R1 left open.
- The preview must render a window (~50 rows), not the full result, and the data behind it must be
  frozen. Both follow from R2's measurements, not from preference.

**Inputs already settled by R1** — do not re-research these:
- Transformation cost is not the bottleneck. The full pipeline runs in 10.5 ms at 100k
  rows on plain JavaScript, so no Web Worker is needed for transformation. If a worker
  is needed at all, it will be for rendering, not for computing.
- Memory: ~471 bytes per row measured (20 columns, array of objects); five simultaneous
  100k-row sources is roughly 235 MB of heap.
- (Formerly open from R1: whether a Web Worker can be created from a `file://` page. Answered by
  R2's measurement — yes, as a classic worker from a blob URL. See above.)

**Inputs added by R3** — do not re-research these:
- Rendering is not the only worker candidate after all. Measured at 100k rows: xlsx
  export takes **~3.3-3.4 s** (write-excel-file 4.1.1, Node) against 273 ms for Parquet
  and 10.5 ms for the transformation pipeline. Export is the one operation long enough
  to freeze a tab.
- The worker construction shape is settled by R2, not open: classic script from a
  `blob:` URL, library inlined into the worker body. Module workers from a blob URL fail
  in Chromium.
- Still open, but narrower: `read-excel-file` uses a worker internally (dependency
  `worker-f`) and its README both claims and retracts this. If its construction does not
  survive `file://`, the documented fallback is the `read-excel-file/web-worker` export
  (spawns none, designed to run inside your own worker) or version 8.x. Untested.
- Nothing in R3 was measured in a browser — every figure is Node. Browser timings for
  table rendering remain entirely open and are R4's own work.

---

## R5 – Type detection & smaller decisions

**Status:** [ ] open
**Report:** –

**Question:** How to detect and handle data types on import, plus remaining
smaller stack decisions?

**Inputs added by R3** — do not re-research these:
- The German number/date parser is now load-bearing architecture. Two libraries have been
  measured corrupting German numbers through default type inference — Arquero's `fromCSV`
  (R1) and PapaParse's `dynamicTyping` (R3) — both via an anchored regex reading `.` as a
  decimal point. Assume the next library does it too. R5's job is to design the parser and
  its override UX, not to re-litigate whether one is needed.
- Encoding is settled: no library. `TextDecoder` BOM sniff → `{fatal:true}` UTF-8 probe →
  `windows-1252` fallback → user override. `iso-8859-1` and `windows-1252` are the same
  decoder per the WHATWG Encoding Standard, so detection libraries add nothing.
- "Works offline" now has a cost attached: PapaParse, jsonrepair, write-excel-file,
  read-excel-file and json-formatter-js all ship ready-made UMD bundles that inline into
  one HTML file. `hyparquet-writer` ships **ESM only** — it is the single dependency that
  turns the build step from optional into required.

**Sub-questions:**
- Number/date detection with German formats (`1.234,56`, `31.12.2025`):
  existing libraries vs. small custom detector; manual override UX.
- CSS approach: Pico.css vs. Tailwind via CDN vs. hand-written (small decision,
  short comparison is enough).
- "Works offline" precision: keep CDN links (offline after first load, cached)
  vs. inlining all libraries into the HTML file.

---

## Suggested order

1. ~~**R1 + R2 together** – they define the architecture.~~ Both done (2026-08-01):
   Arquero + Vue 3 (project decision on R1 was Arquero over the research recommendation).
2. **R3** – biggest risk collection (encoding, SheetJS license, Parquet feasibility).
3. **R4** – depends on R1 outcome.
4. **R5** – can run last or alongside R4.
