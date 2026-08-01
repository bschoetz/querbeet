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

**Verdict: hand-written array functions — no engine dependency** (94/100 on the weighted
matrix). Runner-up Arquero (68), which wins only if the feature set grows well past the
six operations; it is dormant since 2025-05-29 and is recommended as a development-time
test oracle instead. AlaSQL is rejected: a measured 25.2 s two-key join at 100k rows
(Arquero: 95 ms) plus documented, still-open silent-wrong-answer join bugs — this
overturns the proposal in `idea.md` section 4. DuckDB-WASM fails hard gate G2 on size
(~8 MB gzip, ~50 MB inlined into one HTML file), not on capability.

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

**Status:** [ ] open
**Report:** –

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

**Status:** [ ] open
**Report:** –

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

**Inputs already settled by R1** — do not re-research these:
- Transformation cost is not the bottleneck. The full pipeline runs in 10.5 ms at 100k
  rows on plain JavaScript, so no Web Worker is needed for transformation. If a worker
  is needed at all, it will be for rendering, not for computing.
- Memory: ~471 bytes per row measured (20 columns, array of objects); five simultaneous
  100k-row sources is roughly 235 MB of heap.
- Still open from R1 and relevant here: whether a Web Worker can be created at all from
  a `file://` page in current Chrome, Edge and Firefox (blob URL or data URI). R1 could
  not resolve this from public sources; a ~15-minute manual browser test settles it.

---

## R5 – Type detection & smaller decisions

**Status:** [ ] open
**Report:** –

**Question:** How to detect and handle data types on import, plus remaining
smaller stack decisions?

**Sub-questions:**
- Number/date detection with German formats (`1.234,56`, `31.12.2025`):
  existing libraries vs. small custom detector; manual override UX.
- CSS approach: Pico.css vs. Tailwind via CDN vs. hand-written (small decision,
  short comparison is enough).
- "Works offline" precision: keep CDN links (offline after first load, cached)
  vs. inlining all libraries into the HTML file.

---

## Suggested order

1. **R1 + R2 together** – they define the architecture.
2. **R3** – biggest risk collection (encoding, SheetJS license, Parquet feasibility).
3. **R4** – depends on R1 outcome.
4. **R5** – can run last or alongside R4.
