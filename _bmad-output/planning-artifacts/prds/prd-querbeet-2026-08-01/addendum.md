# Addendum to the querbeet PRD

Material that belongs to a downstream document — architecture, solution design, UX spec — or that earned a place but does not fit the PRD's narrative. Nothing here is a requirement; the requirements are in `prd.md`. This exists so the reasoning is not lost between documents.

## 1. Settled technology decisions

All four decisions below come from completed research runs in `_bmad-output/planning-artifacts/research/`. They are inputs to this PRD, not outputs of it, and they are not re-litigated here.

| Concern | Decision | Source |
| --- | --- | --- |
| Transformation engine | **Arquero 8.0.3**, pinned, vendored | R1 — *transformation engine*. Note this **overrides** the research verdict, which recommended hand-written functions (94 vs 68 on the matrix). The project owner chose a complete, widely used library over freshly written bespoke code; the research's own C5 criterion and its stated case-against support that reading, and the deepening revised Arquero's ecosystem score upward on measured fork cost and tenfold adoption growth. |
| UI framework | **Vue 3.5.40** | R2 — *UI framework*. 88/100; runner-up Preact + htm at 80, Alpine at 76. |
| Delivery | **Vite + `vite-plugin-singlefile`** emitting one HTML file (Path B) | R2 deepening. **Overrides** the report's Path A (no build) recommendation, trading toolchain risk for real Single-File Components. Measured: one 280,519-byte file, working from `file://` in Chromium 150 and Firefox 153, and about 121 KB *smaller* than the no-build path. |
| CSV | **PapaParse 5.5.4**, `dynamicTyping` permanently off | R3 |
| Encoding | **No library.** BOM sniff → strict UTF-8 probe → Windows-1252 fallback → user override | R3 |
| XLSX | **`write-excel-file` 4.1.1 + `read-excel-file` 9.3.5** behind a thin adapter | R3. 88 vs 61 against SheetJS CE, which is 334 KB gzipped, paywalls cell styling, and has shipped no release in two years. |
| JSON repair | **`jsonrepair` 3.15.0**, only after `JSON.parse` fails | R3 |
| JSON preview | **`json-formatter-js` 2.5.23** | R3 |
| JSON flattening | **Own code** | R3 — three maintained libraries chose three different array semantics, which is evidence there is no safe default. |
| Parquet write | **`hyparquet-writer` 0.16.3**, Snappy default | R3. Round-trip verified against pyarrow 25, DuckDB 1.5.5 and Polars 1.43.2. |
| Parquet read | **`hyparquet` 1.27.1** — the writer's own dependency | R3 measured the pair at 33,439 bytes gzipped together, against 17,239 for the writer alone, so reading costs about 16 KB on top. Same authors, zero dependencies, MIT, and the better-established of the two (842 stars against 59). Added when Parquet import entered scope. |
| Table rendering | **Hand-rolled fixed-height row windowing**, ~50-row window; no column virtualization | R4 D1. 94 vs 92 for TanStack Virtual — close enough that adopting the library instead is a reasonable deliberate trade. |
| Graph Editor | **Unresearched** | No research run covers node-graph editors against this project's constraints. See §7. |

## 2. Consequences that shape the build

**The build step is mandatory, not optional.** `hyparquet-writer` is ESM-only with no published UMD bundle, so keeping Parquet in scope (FR-36) converts the Vite build from permitted to required. Everything else in the stack ships a ready-made UMD artifact.

**Freeze every dataset at the boundary.** R2 measured that wrapping 100k rows × 20 columns in Vue's deep reactivity inside a render effect costs 437–479 MB on top of 160 MB of data and slows a full read 11–13×. `Object.freeze` on the rows removes that entirely — no proxy is created at all — for about 4% more heap. This is an architecture rule, not a tuning tip: one unfrozen 100k array inside a computed recreates the whole problem. Hold results in `shallowRef`.

**Workers must be classic scripts from a blob URL.** Measured as the only form that works from `file://` in both Chromium and Firefox. Vite's idiomatic `new Worker(new URL(...), {type:'module'})` emits a separate chunk, silently breaks the single-file build, and fails at runtime with no build-time signal. Import every worker as `?worker&inline`, set `worker.format = 'iife'`, and assert after every build that `dist/` contains exactly one file.

**The only operation that genuinely needs a worker is XLSX export.** Measured at ~3.3 s for 100k rows, against 273 ms for Parquet and 10.5 ms for the full transformation pipeline. That single number is why FR-36 requires progress and a responsive interface during export.

**Nothing may be fetched at runtime.** A `file://` page has an opaque origin; anything that fetches fails CORS. No sibling config file, no lazy chunk, no CDN link, no external font or stylesheet. Data enters only through file input or drag-and-drop.

## 3. Arquero hazards the wrapper must absorb

R1's deepening measured these against the released 8.0.3. Each maps to a PRD requirement; the mechanism belongs here.

- **`concat` silently drops columns** present only in incoming tables — precisely querbeet's core use case. Workaround, measured working: compute the union of all column names, pad each table via `derive`, force order with `select`, then `concat`. This is FR-13's *"never dropped silently"* clause.
- **Null join keys never match and no option overrides it.** Two workarounds exist and the choice matters enormously: sentinel substitution before joining costs 30.8 ms at 100k rows; a custom predicate function drops Arquero to an O(n·m) loop join, projected at ~3.7 s. Use sentinels. This is FR-14's explicit null-handling setting.
- **Duplicate keys produce a Cartesian product.** `lookup()` is the row-count-safe alternative. This is FR-14's row-count warning, and the optional duplicate audit in the same FR is what turns the heuristic into a count.
- **Never call `fromCSV`.** Its type inference converts German `"1.234"` to 1.234 and samples only the first 1,000 values before applying a parser to the whole column. Feed Arquero via `aq.from(objects)` after PapaParse has done the parsing, and own the locale-aware number parser. This is FR-9 — and note that FR-9 requires more than a German parser: Sources in different locales may sit side by side in one session.
- **`toCSV` writes no BOM and uses LF.** Prepend U+FEFF for German Excel. This is FR-36.
- **CSP:** Arquero requires `unsafe-eval` for dynamic function compilation according to its open issue #361. Using `escape()` throughout may avoid it; untested. Only matters if the page ever imposes a policy on itself.

## 4. Rendering constraints

- **Fixed row height is the default, not a compromise.** Every documented failure mode in virtualization — list jumping, wrong scroll targets, upward drift — comes from dynamic heights.
- **Do not build column virtualization.** 50 columns × 50 rows measured at 11–14 ms per swap. Column virtualization is where the leading library visibly breaks, and where sticky columns fight the virtualizer.
- **Guard the spacer height, and note that the margin shrank.** Firefox does not clamp oversized elements; above roughly 17.2 million pixels it collapses them to zero height and the list silently vanishes. Chromium clamps at 33,554,428 px instead. At 28 px rows the Firefox cliff is around 614,000 rows. When R4 measured this, the design target was 100,000 rows and the cliff was six times away; NFR-3 now speaks of half a million rows in total, and a Union of several large Sources can produce a single Result table close to that. The guard is no longer a precaution against a case that cannot arise — build it.
- **Keep windowing behind a component whose props are `(rows, rowHeight, windowSize)`,** so swapping in TanStack Virtual later rewrites one file.
- **Accessibility bookkeeping is manual** where it is done at all: `aria-rowcount`/`aria-colcount` carry the totals, `aria-rowindex`/`aria-colindex` the true positions. Ctrl+End moving focus to the last *rendered* row is a known unsolved problem. Per NFR-7 none of this is required.

## 5. Reversibility seams worth building on day one

- **Every Step is a pure function `(tables, config) => table` over plain arrays of objects.** Every engine examined consumes and produces that shape, so replacing Arquero later is a per-operation change rather than an architectural one. Costs nothing now.
- **The Pipeline model — Steps, their configs, and the functions that execute them — holds no framework imports.** The framework owns rendering and binding only, so a framework swap rewrites the view layer against an unchanged core.
- **XLSX sits behind a `readWorkbook` / `writeWorkbook` adapter,** roughly fifty lines. The chosen pair is a single-author project; SheetJS is the drop-in fallback and the runner-up.
- **Keep a fork plan for Arquero on file rather than a fork.** 10,764 lines, 392 passing tests, two dependencies, BSD-3-Clause. Realistic to adopt if a blocking bug ever surfaces; worth recording so the option is remembered rather than rediscovered under pressure.

## 6. Options considered and rejected

**LLM channel.** Three shapes were considered in sequence, and the decision moved twice. API-only was the first answer; it was withdrawn during discovery in favour of copy-paste primary with an optional key; and at review the API path was removed from the MVP altogether. What survives is copy-paste only, which has a consequence worth stating plainly: **NFR-2 becomes unconditional.** The MVP artifact makes no network request in any configuration, which is verifiable by grepping the built file rather than by reasoning about settings. When the API path returns post-MVP, the binding constraint on it is already recorded in §6.2 of the PRD — it must send exactly what the copy-paste block would have contained, so that it can never become a second and laxer disclosure path.

**LLM disclosure model.** An earlier decision in the same session was "structure plus opt-in sample values". The Probe Query concept, contributed by the project owner, supersedes the framing: rather than deciding up front how much to reveal, the model asks questions, querbeet answers them locally, and only answers travel. Sample release survives as an explicit narrower affordance (FR-30).

**Recipe with embedded data.** Considered as one format with a checkbox; rejected in favour of two named artifacts, Recipe and Package, so a file's contents are evident from what it is rather than from a flag inside it.

**Consumer mode.** Three depths were considered — binding-only repair, binding plus limited step editing, or one full editor for everyone. The last was chosen for the MVP on build cost, with the deliberate-entry guard (FR-11) carrying the intent that two interfaces would otherwise have carried. A roles/rights/views model is explicitly deferred.

**Interactive HTML export.** Cut from the MVP as the most expensive single item, being effectively a second small product. Named in the PRD as the strongest post-MVP candidate.

**Computed column formula language.** Deferred rather than rejected in favour of fixed click-together operations. The decisive argument was machine authorship rather than implementation cost: a fixed operation list is a plain data structure a model can emit and the system can validate, whereas a formula language invites a model to produce syntax the parser does not know.

**Pipeline shape.** Three shapes were put to the project owner: a strictly linear Step list, a list whose Steps can be named and referenced as inputs by any later Step, or a full node graph. The graph was chosen. The middle option was offered because it delivers the requested capability — a filtered subset reused in two places — at close to no cost, since Union and Join already take two inputs and the model therefore already admits multiple edges; the difference between it and a graph is mostly the editor, not the data model. The graph's costs were named before the decision and are recorded in PRD §6.3 and Open Questions 2–4: no research exists for the editor component, the Recipe format grows at exactly the point where a model must produce it correctly, and R2's framework verdict was scored against a list. The Recipe format should nonetheless be written so a linear pipeline is the trivial case of it — a graph whose every node has one input — so that a model asked for something simple can produce something simple.

**Drag-and-drop.** The first draft banned drag reordering outright, on a misreading of the research. The finding is narrower: the documented failure is a *library that mutates DOM order* while the framework diffs the same list — two sources of truth, and the list fights itself. Native drag events that compute a target index and update the model are fine, because the framework then re-renders from a single truth. What remains binding is that no interaction may exist *only* as a pointer gesture, which is a correctness rule about keyboard reachability rather than an accessibility target.

## 7. The graph Editor: what is not known

This is the one component in the stack with no research behind it, and it arrived after the four research runs had concluded. Recording the shape of the gap so it is not rediscovered later.

**Nothing has been screened.** The obvious candidates — Vue Flow, Rete.js, Drawflow, Litegraph, or a hand-built SVG canvas — have not been checked against a single one of this project's gates. The gates are known and are the same ones that cut half the field in R2 and R4: it must inline into one HTML file with nothing fetched at runtime (no `import()`, no external CSS, no web font, no worker chunk); it must be Vue 3 first-class rather than a stale community wrapper; it must be permissively licensed with no runtime key, which R4 showed is not a stable property — PrimeVue relicensed mid-flight; and it must not deep-watch or otherwise take ownership of data structures that must stay frozen.

**The scale question is different from R4's.** A graph canvas holds tens of nodes, not a hundred thousand rows, so rendering cost is not the concern. The concern is the interaction surface: connection dragging, hit testing, auto-layout, pan and zoom, and undo. That is where a hand-built canvas stops being a weekend and starts being a component — the opposite of the calculus in R4, where hand-rolling won precisely because the need was small and exactly known.

**Two constraints from elsewhere in this document apply and are easy to overlook.** The frozen-data rule means the graph library may hold the Pipeline structure but must never hold or watch the tables; keeping the Pipeline model framework-free (§5) already enforces the seam, provided the editor is a view over that model rather than its owner. And nothing may be fetched at runtime, which rules out any component that lazy-loads its own icons, styles or layout engine — a failure that shows up only when the built file is opened from `file://`, never at development time.

**The cheapest de-risking is the same move R2 and R4 both made:** build the thing that decides it. Three node kinds, one connection, one frozen table flowing through, built once and opened from a real `file://` URL. That answers the framework question (PRD Open Question 4) and the editor question (Open Question 2) in the same afternoon, and it is the only evidence that will actually settle either.
