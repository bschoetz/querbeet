# querbeet – Technical Research Plan

This file tracks the technical research runs needed before implementation starts.
Each item is meant to be executed as one `/bmad-technical-research` (→ bmad-deep-recon,
type: technical) run. Check items off and link the resulting report when done.

**R6–R9 were added on 2026-08-01 after the PRD** (`_bmad-output/planning-artifacts/prds/prd-querbeet-2026-08-01/prd.md`)
put four MVP capabilities into scope that no research run covers: a node-graph pipeline
editor, charts, a PDF/HTML view document, and browser persistence with a compressed
package format. R4 and R5 were rescoped in the same pass. **Where this file and `idea.md`
disagree, the PRD is authoritative** — it postdates both.

Constraints that apply to every research question:

- Single HTML file, no server, no backend; all processing client-side.
- **Nothing may be fetched at runtime.** A `file://` page has an opaque origin, so
  `fetch()`, dynamic `import()` and `<script type="module" src>` all fail. Any candidate
  that lazy-loads its own icons, styles, fonts, layout engine or worker chunk is
  disqualified — and this fails only in the built artifact opened from `file://`, never
  during development. Measured in R2.
- A build step that emits one HTML file is acceptable and is now mandatory (`hyparquet-writer`
  is ESM-only).
- Target data size: **~100,000 rows per source and on the order of half a million rows in
  total** (PRD NFR-3, revised upward from the earlier "100,000 rows max"). No cap on the
  number of source files.
- Datasets are `Object.freeze`d and held in `shallowRef`. Any candidate that deep-watches,
  proxies or takes ownership of the row array is disqualified. Measured in R2: deep
  reactivity over 100k×20 costs 437–479 MB against 0 MB for frozen rows.
- Permissive licence with no runtime key and no eligibility gate. R4 found PrimeVue
  relicensing mid-flight, so treat every "MIT" as perishable and read the LICENSE in the
  published package rather than in the repository.
- Browsers: **Chromium-based (Edge 143+ / Chrome 143+) is the lead browser** — project decision
  2026-08-01, prompted by R4/D2. Firefox 145+ stays a target but is secondary and gets *measured*
  during the first MVP builds rather than assumed; if it does not deliver on the JS-heavy paths it
  is dropped rather than specially handled. Every colleague has Edge installed, so a Chromium
  browser is universally available. Safari optional. Full rationale in `idea.md` section 3.

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
nested-loop join); duplicate keys produce a Cartesian product. **Qualified 2026-08-01 by R4
Checkpoint D2-a: the sentinel rule is safe only when joining against a table with unique keys.
If both sides can contain nulls — which the PRD's graph makes easy, since two branches of one
source both inherit its nulls — every sentinel row matches every sentinel row, and the join
output grows quadratically in the null count.** See R4 below. And critically,
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

**Status:** [~] partial — D1 (table rendering) and D2 (Arquero at scale) done 2026-08-01; D3, D4 not run
**Report:** `_bmad-output/planning-artifacts/research/technical-performance-and-table-rendering-2026-08-01/research.md`

**D1 verdict: virtualization is mandatory, hand-rolled fixed-height row windowing wins
(94/100), TanStack Virtual is the runner-up at 92, and column virtualization is not needed.**
Measured against Chromium 151 and Firefox 153 from a real `file://` URL: rendering all
100,000 rows × 20 columns takes 11.2 s / 12.4 s and builds 2,000,000 cells — an eleven-second
frozen tab, not a crash. A 50-row window over the same data swaps in 4.1 ms / 5 ms with no
node recycling, and the same window at 50 columns still swaps in 10.9 ms / 14 ms, which is
why column virtualization is out. `content-visibility: auto` does not replace virtualization:
it skips rendering of off-screen subtrees but does not reduce DOM node count.

**Two items D1 flagged as product work, both now in the PRD:** Ctrl+F cannot find virtualized
rows and cannot be intercepted from userland, so querbeet ships its own search over the full
dataset (FR-33); and `aria-rowcount`/`aria-rowindex` bookkeeping is manual, with Ctrl+End
landing on the last *rendered* row — accepted rather than solved, per PRD NFR-7.

**Incidental finding with reach beyond R4: PrimeVue 5.0.0 (2026-07-15) is no longer MIT.**
The npm package ships a commercial "PrimeUI License" requiring a runtime key, with an
eligibility-gated free tier needing annual re-confirmation, while the GitHub repository still
displays the old MIT text. Anything from the PrimeTek family is affected.

**D2 verdict (done 2026-08-01): Arquero fits, and its sharing semantics are what make a graph
affordable.** One 100,000 × 20 source costs **80.2 MB** of Chromium heap as an Arquero table
against 102.8 MB as plain row objects, scaling **exactly linearly** — so the revised half-million
target is **~400 MB of tables**, and the scale ladder measured five simultaneous 100k sources at
552.6 MB total heap. Verified by object identity: `select`, `filter`, `orderby` and `derive`
**share** the parent's backing arrays; only `slice`, `join` and `concat` copy. A six-step
pipeline is therefore not six copies of the data. `reify()` genuinely releases (80.2 MB → 0.7 MB
after dropping the parent), and reading the render window costs under 1 ms at any offset, so the
complete preview path is ~5 ms. Three architecture rules: drop the parsed row array after
`aq.from()`; `reify()` after a selective filter and release the parent, or a 1k-row view pins
80 MB; read the window with `objects({limit, offset})`, never by iterating.

The full pipeline runs in **263 ms (Chromium) / 446 ms (Firefox)** against R1's 10.5 ms for
hand-written plain JS in Node — the measured price of the Arquero decision, comfortably
interactive. Firefox is 1.5–2× slower on Arquero work and **8× slower on full row
materialization** (`objects()` over 100k: 97 ms vs 12.5 ms), which is what prompted the
lead-browser decision above.

**Rescoped 2026-08-01 after the PRD.** Three things changed the remaining dimensions:

- **The scale target moved from 100,000 rows to roughly half a million in total** (PRD NFR-3).
  Re-derived from D1's measurement, the ceiling is best expressed as a **row-height budget**,
  because the spacer is `rowCount × rowHeight`:

  | Row height | Firefox (measured-safe 16.0M px) | Firefox (bug 1527883: 17.19M px) | Chromium (clamp 33,554,428 px) |
  | --- | --- | --- | --- |
  | 28 px | 571,000 rows | 614,000 rows | 1,198,000 rows |
  | 32 px | **500,000 rows** | 537,000 rows | 1,048,000 rows |
  | 40 px | 400,000 rows | 430,000 rows | 839,000 rows |

  **At half a million rows the maximum safe row height in Firefox is ~32 px.** Row height stops
  being a styling choice and becomes a load-bearing constant. Above the ceiling Firefox collapses
  the spacer to zero height and the list silently vanishes; Chromium clamps and keeps working.
  The spacer cap with offset rescaling therefore moves from optional to **mandatory** — and it
  also lifts the Chromium ceiling, which is otherwise ~1.2M rows at 28 px.
- **Full-dataset search (FR-33) is a new performance question.** Searching every row of a
  500k-row result while staying interactive was never scoped. It belongs in D4. D2 supplies the
  primitive: `values(name)` iterates a column with **zero object allocation**, which is the right
  shape for a scan.
- **A graph editor now sits on the same main thread** (R6). Whether canvas interaction and
  table rendering compete is a D3/D4 question.

**Sub-questions still open:**
- **D3 — Off-main-thread work and transfer cost.** What actually belongs in a worker, and
  what structured-clone or transfer costs at these row counts. **The scale change makes this
  sharper:** R3 measured xlsx export at ~3.3 s for 100k rows, so half a million projects to
  roughly 16 s — export is no longer "long enough to freeze a tab", it is long enough to look
  broken. The worker is now required rather than advisable.
- **D4 — Responsiveness patterns.** Recompute-all versus memoize-per-Step for live preview
  (R1 measured the full pipeline at 10.5 ms and D2 measured Arquero's at 263–446 ms, so
  recompute-all is plausible but no longer obviously free — settle it by measurement);
  full-dataset search; graph-canvas versus table-rendering contention; and progress/cancellation
  for the export.
**Checkpoint D2-a — does the graph stay affordable when a Step has several consumers?**
**Status:** [x] done 2026-08-01. Measurement: `imports/arquero-graph-measurement-2026-08-01.md`.

**The hypothesis held on all three limbs, one D2 rule is corrected, and one new trap is
documented.** A DAG costs one copy of the source plus one full-length array per derived column
plus one materialisation per `join`/`concat`, and fan-out is free: **ten pure-view consumers of
an 80 MB source cost 0.13 MB between them**, with the per-consumer figure *falling* as consumer
count rises. A derived column costs a flat 0.40 MB per consumer at 100k rows, so a 30-Step graph
deriving one column per Step costs ~12 MB. In a diamond, two unjoined branches cost 0.79 MB and
recombining them costs **10.0 MB** — branching is free, combining is not. Retention is clean:
four Steps over a shared source cost 0.82 MB, dropping one leaf reclaims only its own derive
array, and dropping the whole graph returns exactly to baseline. **A realistic half-million-row
graph — five sources unioned, joined to a lookup, filtered, derived — costs 447 MB and 700 ms.**

**Corrected: D2's `reify()` rule is conditional and was stated unconditionally.** D2 said "reify
after a selective filter and release the parent", worth 80 MB there. In a graph the Editor can
re-run from any Step, so the parent normally *cannot* be released — and then reifying costs
0.10 MB and saves nothing (view 0.01 MB vs reified 0.11 MB, filtering 100k to 1k). **Reify only
when the parent is genuinely going away.**

**New trap — R1's null-key sentinel is a Cartesian bomb between two branches.** R1 mandated
sentinel substitution because null join keys never match; that rule was derived for joining
against a **unique lookup**, where sentinel rows find no partner. A DAG makes the dangerous case
easy: two branches of one source both inherit its nulls, so every sentinel row on the left
matches every one on the right. Measured, the join output tracks the sentinel *pair* count almost
exactly — 28,000 source rows produce **2,687,670 join rows**; growth is quadratic in the null
count, invisible on a sample and catastrophic at scale. At 100,000 source rows the pairs come to
~34 million and it **crashed the tab**. Reproduced in Node before being accepted.
*Implication:* R1's null keys silently *dropped* rows; the sentinel silently *multiplies* them,
which is worse. Either exclude sentinel rows from the join and re-attach afterwards, give each
side a distinct sentinel so they cannot match, or refuse the join. A Join Step must warn when
both inputs carry nulls in the key column — a UX requirement, not only an implementation detail.

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

**Rescoped 2026-08-01 after the PRD: the parser is not German-only.** PRD FR-9 requires
type *and* locale detection per column, with sources in different locales side by side in
one session and different locales possible within one source. The hard part is no longer
parsing German — it is the ambiguity: `1.234` is one thousand two hundred thirty-four under
one locale and 1.234 under another, and both readings are valid for the whole column. FR-9
requires the system to report that ambiguity rather than resolve it silently, which makes
this as much a UX design question as a parsing one.

The "works offline" sub-question below is **settled and can be struck**: R2's build probe
established inlining everything into one file, and R3 established that `hyparquet-writer`
being ESM-only makes the build mandatory. CDN links are not an option, since nothing is
fetchable at runtime from `file://`.

**Sub-questions:**
- Number/date detection across locales, not only German (`1.234,56` and `1,234.56`,
  `31.12.2025` and `12/31/2025`): existing libraries vs. a small custom detector.
- **Ambiguity handling** — how to detect that a column admits two readings, how to report
  a confidence or hit rate that a non-specialist can act on, and what the override UX looks
  like when the correct answer cannot be computed. This is the load-bearing part.
- How the confirmed type and locale are recorded in the Recipe so a Consumer inherits the
  Author's decisions (PRD FR-9, FR-21).
- CSS approach: Pico.css vs. Tailwind vs. hand-written (small decision, short comparison
  is enough). Note the constraint: no external stylesheet and no web font, so a framework
  that expects a CDN link needs its CSS inlined at build time.

---

## R6 – Node-graph pipeline editor

**Status:** [x] done (deep-recon, type technical, shape select, 2026-08-01)
**Report:** `_bmad-output/planning-artifacts/research/technical-node-graph-pipeline-editor-2026-08-01/research.md`

**Verdict: build the canvas by hand and keep the graph model library-free** (85/100 on the
weighted matrix). Runner-up Vue Flow 1.48.2 (75), BaklavaJS 2.8.1 (68). All three were built as
real single-file Vite artifacts and opened from a `file://` URL in Chromium 151 and Firefox 153 —
this is measured, not compared on paper.

**The gate that shaped this whole research plan turned out to separate nothing.** All three
candidates build to exactly one HTML file (224,382 / 175,233 / 73,532 B), contain zero
occurrences of `import(`, `fetch(`, `new Worker`, `importScripts`, `@font-face` or a non-`data:`
`url()`, and issue **zero network requests beyond the document** from `file://` in both engines,
with no page errors. The lazy-loading hazard exists in the field but not among the finalists:
`@maxgraph/core`'s stylesheet fetches four `.gif` files by relative URL, and Rete's auto-layout
path is elkjs-in-a-Worker (also `EPL-2.0 OR GPL-3.0-or-later`).

**The ownership question is settled, and it settles in everyone's favour.** A frozen 100,000×20
table placed by reference in node data comes back out of each library's own state with identity
preserved, `isReactive` false, and array plus rows still frozen. **Vue's reactivity skips
non-extensible objects, so `Object.freeze` is itself the protection** and Vue Flow's `markRaw`
advice does not apply to a frozen payload — this overturns the screening conclusion that Vue Flow
would fail on ownership. R2's existing rule already covers it. The editor itself costs 0.32–2.76 MB
of heap against ~94 MB for one source table — **0.34 % to 2.93 % of a single table**, so
**footprint genuinely cannot decide this**.

**What decides it is graph semantics, and both libraries fail the PRD requirement.** FR-12 says a
cycle-creating connection "is refused with a named reason". **Vue Flow has no cycle detection in its
bundle** — `addEdges` created `r1 → s1` on the chain `s1 → f1 → r1` without complaint, and a
literal search of the published `vue-flow-core.mjs` finds zero occurrences of `cycle`, `Cycle`,
`acyclic` or `topological`. The unguarded path is the programmatic one, which a Recipe loader and
an LLM-authored Recipe both use. BaklavaJS refuses a self-loop but accepted the
two-node cycle, while `containsCycle(graph)` returned `true` immediately after — the detector is
shipped, wiring it to the guard is still your code. The hand-built canvas refuses it and names the
reason in 12 lines.

**PROJECT DECISION: Vue Flow 1.48.2** — overrides the research recommendation, on the same
reasoning that decided R1 in Arquero's favour: a complete, widely used library is more battle-tested
than freshly written bespoke code. Vue Flow over BaklavaJS follows the same heuristic — 6,760 stars,
300 closed issues and 11 releases in 12 months against 2,045 / 228 / 2 — and R1's precedent settles
the dormancy tension explicitly, since Arquero was dormant when it was chosen. **Two findings
thereby become mandatory implementation work rather than observations:** the cycle check must sit
*in front of* Vue Flow's mutation API, because its bundle contains no cycle detection at all and
`addEdges` accepts one silently; and the app must decide which side owns the truth, because Vue Flow
copies the node objects it is handed. Full consequences in the report's section "Adopting Vue Flow —
what the measurements require". The graph model stays library-free regardless — that hedge now
points the other way, as the exit *from* Vue Flow.

**Cost, counted rather than estimated:** node dragging, background panning, cursor-anchored wheel
zoom with correct screen↔graph conversion, connection dragging, cycle refusal with a named reason,
orphan-Step marking and connection hit-testing come to **164 lines** (`graph.js` 40 +
`Canvas.vue` 124). No auto-layout, undo/redo, minimap, multi-select or keyboard handling — but
**neither library ships auto-layout either**, and Vue Flow ships no undo/redo. Baklava does ship
undo/redo, clipboard, subgraphs and a topological sort.

**The strongest argument against the pick, and the tripwire that tests it:** node dimension
measurement. React Flow #3270 (a node vanishes without an explicit width) and Vue Flow #174
(handles misplaced on dynamic-height nodes) are the same failure family — asynchronous DOM
geometry — in two independent mature codebases, and the probe used fixed-height nodes. Before building more than three Step kinds, build the Union
and Join bodies — the tallest, most variable ones — resize one at runtime and confirm the anchors
follow. If they do not and the fix is not small, switch to Vue Flow then.

**The hedge:** keep the model (`graph.js`-shaped — nodes, edges, cycle check, contributing-Steps
walk) free of both the canvas and any library, the same seam R2 mandated for the pipeline core.
Neither library touched it in the probe, so a switch rewrites one component and leaves the Recipe
format and FR-28's LLM protocol untouched.

**Also settles PRD Open Question 4: R2's Vue 3 verdict survives.** All three probes are Vue 3 SFCs,
per-kind `<component :is>` dispatch worked in every one, mount 18–97 ms across both engines with
no errors.

**Licence findings worth carrying forward.** Vue Flow is MIT with no paid tier and no runtime key,
confirmed on vueflow.dev and in the shipped LICENSE — which carries a webkid GmbH copyright, since
it is an independent Vue reimplementation under React Flow's MIT grant, *not* xyflow code.
**Rete.js is disqualified on licence verification, not capability:** none of its four packages
ships a LICENSE file at all, so MIT rests solely on the `package.json` field. And `jointjs` was
renamed — the maintained line is `@joint/core` 4.3.1 (2026-07-27, MPL-2.0, zero dependencies), the
freshest release in the field; screening the old name alone would have scored a live project dead.

**One deviation from the PRD, recorded deliberately:** keyboard reachability was excluded from
this selection by project decision at the plan gate. **PRD FR-12 and NFR-7 must not be assumed
satisfied by this research.** The hand-built path makes adding it cheaper than either library
would, since every mutation is already a plain function call on an app-owned model.

**Why this exists:** the PRD replaced the linear step list with a directed acyclic graph of
named Steps (FR-12), on a project decision taken 2026-08-01. `idea.md` section 6 had
explicitly excluded a node-based editor from the MVP, so no research covers it, and it is
now the only component in the stack with no evidence behind it. It is also structural: it
shapes the Editor, the Recipe format, and what a language model must emit correctly.

**Question:** What carries a node-graph editor for ~5–30 nodes under querbeet's constraints —
an existing Vue 3 component, a framework-agnostic library, or a hand-built SVG canvas?

**Candidates to screen:** Vue Flow, Rete.js, Drawflow, LiteGraph.js, jsPlumb, baklavajs,
hand-built SVG/canvas. Screen the field first; this list is a starting point, not a shortlist.

**Hard gates:** inlines into one HTML file with nothing fetched at runtime (check the built
artifact for `import(`, `fetch(`, `new Worker`, `@font-face` and non-`data:` `url()`, and
open it from a real `file://` URL — a component that lazy-loads its own icons fails only
there); Vue 3 first-class rather than a stale community wrapper; released within the last
12 months; permissive licence with no runtime key, verified from the LICENSE in the
published package.

**Sub-questions:**
- **What does it own?** The library may hold the graph structure but must never hold or
  watch the tables. Does its API let the graph be a view over an external model, or does it
  insist on owning node data?
- **Interaction surface, which is where hand-building stops being cheap:** connection
  dragging, hit testing, pan and zoom, auto-layout, undo/redo, keyboard navigation. PRD
  NFR-7 requires every action to have a keyboard-reachable path, and most graph editors are
  pointer-only — check this early, it disqualifies quickly.
- **Footprint** is explicitly *not* a criterion. Arquero alone is 236 KB raw and the whole
  built file is 280 KB; a graph editor at 50 KB changes nothing. Do not let size decide this.
- **Node rendering:** can node bodies be arbitrary Vue components? Each Step kind has its own
  configuration form, which is the same `<component :is>` dispatch problem R2 scored Vue on.

**Spike sketched 2026-08-01, done 2026-08-01:** `_bmad-output/planning-artifacts/spikes/spike-editor-vueflow-2026-08-01.md`
— four questions in one build (variable-height anchors, the cycle guard in front of `addEdges`,
which side owns the truth, and the Recipe round trip), starting from R6's existing Vue Flow probe.
All four pass in Chromium 151 and Firefox 153; anchors drift 0 px / 0.02 px, the Recipe round-trips
byte-identically at 1,309 B, and the ownership question is decided for design B — the model is
authoritative. Results and the rules that follow: `spikes/editor-vueflow-2026-08-01/findings.md`.

**Related spike, not research:** PRD FR-28 requires a language model to emit a valid Recipe
from documentation alone, and a graph is materially harder to get right than a list. Draft
the Recipe format for a three-Step graph and have a model produce one from the spec before
the format is committed. Design the format so a linear pipeline is its trivial case — a graph
whose every node has one input — so a model asked for something simple can answer simply.

**Also settles PRD Open Question 4:** R2 chose Vue 3 on the criterion of authoring *a list of
heterogeneous step kinds*. That criterion is now a graph editor. R2's verdict may well
survive, but it has not been re-examined against the actual requirement. The cheapest way to
answer both: build three node kinds, one connection and one frozen table flowing through, and
open it from `file://`.

---

## R7 – Charts and dashboard rendering

**Status:** [ ] open
**Report:** –

**Why this exists:** PRD FR-35 puts bar charts, line charts, Top-N/Bottom-N lists and key
figures into the MVP Dashboard. `idea.md` mentioned charts but the research plan never
carried them, so no library has been screened.

**Question:** Which charting library renders bar and line charts over aggregated results in
a single offline HTML file?

**Candidates to screen:** uPlot, Chart.js, ECharts, Observable Plot, Vega-Lite, Frappe
Charts, hand-written SVG. Note the size spread is enormous here — unlike the UI framework
question, footprint may genuinely matter: ECharts and Vega-Lite are in the hundreds of
kilobytes against uPlot's tens.

**Hard gates:** same as R6 — inlines with nothing fetched at runtime (watch for web fonts
and icon sprites specifically, which chart libraries commonly pull), permissive licence,
released within 12 months, works from `file://`.

**Sub-questions:**
- **How much data reaches a chart?** Tiles render *aggregated* output, so a bar chart has
  tens of categories, not 100k points. If that holds, this is a small decision and a heavy
  library is unjustified. Confirm it rather than assume it: a line chart over a time series
  from 500k rows could be a different shape.
- Does it accept a frozen array, or does it clone, sort or mutate its input?
- Static export: FR-37 requires the chart to appear in an exported HTML file and in a PDF.
  Does the library render to SVG (embeddable and printable) or only to canvas (a raster
  image in the PDF)? This may decide the choice on its own.
- German number and date formatting on axes and labels, without pulling a locale bundle.
- Does it need a container size at render time? Charts inside a fixed-grid tile layout that
  the user can resize in three steps must re-render correctly.

---

## R8 – View document export: HTML and PDF

**Status:** [ ] open
**Report:** –

**Why this exists:** PRD FR-37 requires a self-contained static HTML export and a PDF export
of the Result and Dashboard. `idea.md` listed PDF export as explicitly out of MVP scope; the
PRD put it back in. No research covers either.

**Question:** How does a `file://` page with no network access produce a self-contained HTML
document and a PDF?

**Sub-questions:**
- **PDF: generate or print?** A library (jsPDF, pdfmake, pdf-lib) versus a print stylesheet
  plus the browser's own "print to PDF". The second costs almost nothing and produces correct
  typography and pagination for free, but it cannot be triggered as a file download and
  depends on the user's print dialog. Weigh this honestly before reaching for a library — it
  may be the whole answer.
- If a library: size, font embedding (a PDF with umlauts needs an embedded font, which is a
  large binary inside an already-inlined single file), table pagination across pages, and
  whether charts arrive as vectors or as rasters.
- **HTML export:** the exported document is itself a single self-contained file, so this is
  the same inlining problem as the app, one level down. How is the result table embedded —
  fully, or truncated with a stated row count? A 500k-row table inlined into an HTML document
  is a very large file, and FR-37 says the document is static, so the virtualization from R4
  does not apply.
- Both formats must carry the run status (FR-34) and name the Recipe, date and Sources
  (FR-37), so the export is a document template question and not only a rendering one.

---

## R9 – Browser persistence and the Package container

**Status:** [~] partial — the IndexedDB gate answered 2026-08-01; everything else open
**Report:** `_bmad-output/planning-artifacts/research/technical-browser-persistence-and-packaging-2026-08-01/research.md`

**Gate answer: IndexedDB works from `file://` in Chromium 151 and Firefox 153, and the data
survives closing and relaunching the browser. PRD FR-25 is buildable as written.** Measured with
persistent browser profiles, so "across sessions" means the process was restarted, not reloaded:
`open()` in 3.0 / 6.0 ms, a 100,000 × 20 Source written and read back intact at both ends of the
array, no page errors in either engine.

**Three findings the gate question did not ask for, all with product consequences:**

- **The `file://` origin is one shared bucket.** A page in a *different directory* read the full
  100,000-row Source written by another directory's page, in both engines. There is no per-file or
  per-directory partition, and querbeet cannot fix it from the inside. So: two copies of
  `querbeet.html` share one session; any other local HTML file can read querbeet's stored data;
  FR-25's one-action delete clears the *shared* store; and FR-24's Package needs a discriminator in
  the database or key name, because the origin supplies none.
- **`navigator.storage.persist()` never settles in Firefox from `file://`** — still pending at an
  8,000 ms bound, while Chromium resolves in 0.2 ms with `false`. Persistent storage is not
  grantable from `file://` in either engine, and **an unguarded `await` on it deadlocks startup in
  Firefox** before the first byte is stored. This cost the probe's own first run 180 s. Race it
  against a timeout or do not call it; `persisted()` is safe in both.
- **Storage costs about a tenth of the heap.** 100,000 × 20 rows occupy 8,913,424 B (Chromium) /
  9,960,184 B (Firefox) stored, against ~94 MB for the same data in the JS heap (R6). Quota before
  any write is ~10.0 GiB in Chromium and ~1.15 GiB in Firefox. `put` 304.6 / 731.0 ms, `get`
  194.9 / 825.0 ms.

**Linear projection to half a million rows — extrapolation from one point, not a measurement:**
~45–50 MB stored, comfortable against both quotas, and a write of ~1.5 s (Chromium) / ~3.7 s
(Firefox). R3's freeze threshold was ~3.3 s, so **Firefox lands on that line and Chromium does
not** — whether the write needs a worker is now a real question rather than an assumed no.

**Still open:** everything below except the first sub-question. Eviction is *more* open than
before, not less: since persistence cannot be granted, the store is best-effort in both engines and
no pressure test was run.

**Why this exists:** PRD FR-25 stores the Recipe *and* the loaded source data across sessions
with a one-action delete, and FR-24 defines a compressed Package bundling a Recipe with its
data. `idea.md` left persistence as an open decision and had no Package concept at all.

**Question:** How are up to half a million rows stored in the browser and packed into one
portable file, from a `file://` page?

**Sub-questions:**
- **IndexedDB from `file://`.** Does it work at all from an opaque origin, in Chromium and
  Firefox? What is the quota, and is it per-file or shared? This is a gate question — if
  IndexedDB is unavailable from `file://`, FR-25 is unbuildable as specified and the PRD needs
  revising. **Check this first; it is cheap and it can invalidate a requirement.**
- Storage cost and write time for ~500k rows: structured clone of plain objects versus a
  serialized columnar or compressed blob.
- Eviction: browsers may clear storage under pressure. What does the tool do when a restored
  session is incomplete, and does `navigator.storage.persist()` help from an opaque origin?
- **Package container.** A zip is the obvious shape, and `fflate` is already a candidate from
  R3's Parquet work (its `gzipSync` is what supplies GZIP to `hyparquet-writer`). Compare
  against JSZip on size and on synchronous versus asynchronous API — R3 established that
  `hyparquet-writer` needs a *synchronous* compressor, and the browser-native
  `CompressionStream` is async and therefore unusable there.
- Compression ratio and time for report-shaped data at half a million rows, and whether it
  needs a worker. R3 measured xlsx export at ~3.3 s as the threshold where an operation
  freezes a tab.
- Should a Package store its data as Parquet internally? The reader and writer are already in
  the bundle, the format is columnar and compact, and it would make the container inspectable
  by DuckDB or pandas — which may be a feature or an unwanted disclosure surface.

---

## Suggested order

1. ~~**R1 + R2 together** – they define the architecture.~~ Both done (2026-08-01):
   Arquero + Vue 3 (project decision on R1 was Arquero over the research recommendation).
2. ~~**R3** – biggest risk collection.~~ Done (2026-08-01).
3. ~~**R6 – graph editor.**~~ Done (2026-08-01). Research verdict: hand-built SVG canvas.
   **Project decision: Vue Flow 1.48.2**, with the graph model kept library-free either way.
   R2's Vue 3 verdict survived, so PRD Open Question 4 is closed. Two follow-ups, both spikes
   rather than research: the variable-height tripwire before more than three Step kinds are built,
   and the own-cycle-check-in-front-of-`addEdges` rule, which FR-12 makes non-optional.
4. ~~**R9's first sub-question alone — does IndexedDB work from `file://`?**~~ Done (2026-08-01):
   yes, in both engines, surviving a browser restart. FR-25 holds. Three consequences fell out —
   the shared `file://` bucket, the `persist()` deadlock in Firefox, and a Firefox write time at
   half a million rows that lands on R3's tab-freeze threshold.
5. **R4 (D2–D4)** – now also covers full-dataset search and the 614,000-row Firefox spacer
   cliff, which is close to the revised scale target.
6. **R5** – type and locale detection; can run alongside R4.
7. **R7 and R8** – charts and export documents. Both are presentation-layer and neither
   blocks the transformation path, so they can wait until the ETL core works. R8 has a
   plausible zero-library answer (print stylesheet) that should be tried before it is
   researched properly.
8. **R9's remainder** – package container and storage cost.
