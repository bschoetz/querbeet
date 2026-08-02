# Addendum to the querbeet PRD

Material that belongs to a downstream document — architecture, solution design, UX spec — or that earned a place but does not fit the PRD's narrative. Nothing here is a requirement; the requirements are in `prd.md`. This exists so the reasoning is not lost between documents.

## 1. Settled technology decisions

Every decision below comes from a completed research run in `_bmad-output/planning-artifacts/research/`. They are inputs to this PRD, not outputs of it, and they are not re-litigated here.

**Currency:** this table tracks R1 through R7 and R9, complete as of 2026-08-01. Four of its rows record a **project decision that overrode the research verdict** — Arquero, the Vite build path, Vue Flow and ECharts — and each says so in its own row, because a reader who finds only the pick would otherwise assume the research chose it. **R8 (view document export) has not run**, so nothing here covers how the HTML and PDF documents of FR-37 are produced; and **R9 is answered only at its gate**, so the Package container of FR-24 has no row either.

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
| Graph Editor | **Vue Flow 1.48.2** | R6 — *node-graph pipeline editor*. **Overrides** the research verdict, which scored a hand-built SVG canvas at 85 against Vue Flow's 75, on the same reasoning that decided R1. MIT with no paid tier and no runtime key, verified in the shipped LICENSE. Two findings become mandatory work rather than observations: the cycle check must sit *in front of* Vue Flow's mutation API, whose bundle contains no cycle detection at all, and the app's model owns the truth because Vue Flow copies the nodes it is handed. §7 records what the follow-up spike then measured. |
| Charts | **Apache ECharts 6.1.0, SVG renderer only** | R7 — *charts and dashboard rendering*. **Overrides** the research verdict, which scored hand-written SVG at 93 against ECharts' 84 — a margin carried entirely by footprint, the one criterion R2 and R6 each ruled out; without it the two tie at 92 to 91. Apache-2.0. Decided on battle-testedness, and the edge-case tripwire then confirmed it: eight cases, both engines, no throw and zero `NaN` in any serialized SVG. The renderer choice is not cosmetic — see §2. |
| Number parsing | **No library.** Separators read from `Intl.NumberFormat.formatToParts`, parsing in own code | R5 — *type and locale detection*. Runner-up `@internationalized/number` 3.6.7, which passed the single-file gate but has neither its size nor its throughput measured. The platform already knows what a locale's decimal and grouping characters are; what it does not do is decide between two readings, which is querbeet's own logic either way. |
| Date parsing | **`date-fns` 4.4.0**, `parse` with an explicit pattern | R5. Runner-up `d3-time-format` — stricter and about 500 B per locale object, at the price of maintaining the locale table yourself. **Temporal is not an option:** `PlainDate.from()` accepts only RFC 9557 strings, so `"31.12.2025"` throws, and Safari does not ship it. |
| Type record | Per column `{type, decimalChar, groupChar, dateFormat, missingValues, keepOriginal}`, stored in the Recipe | R5. This is what FR-9's confirmation actually persists. Runner-up was CSVW's `format` object — the same content inside a much heavier document model. The shape is deliberately close to Power Query's `Table.TransformColumnTypes(…, culture)`, which is the best override prior art found: it asks for a type and a locale in one action and serialises the culture into the saved script. |
| CSS | **Tailwind v4.3.3**, with `preflight.css` omitted from the three-line split import | R5. The freshness rule decided it — Pico 2.1.1 is 16 months old, Bulma 15, Simple.css 14 and Water.css 59; only Tailwind, UnoCSS and Open Props are current. The gate separated nothing: zero `@font-face` rules in any candidate and every `url()` already a `data:` URI, Vue Flow's own two stylesheets included. What makes it safe next to `@vue-flow/core/dist/style.css` (3,930 B, the only mandatory one) is that preflight comes out by deleting one line. Cost scales with querbeet rather than with the package: `tailwindcss/utilities.css` as published is **21 bytes**, every utility being generated from the app's own markup, against a classless framework shipping its whole sheet regardless — Pico 83 KB raw, Bulma 678 KB. |
| Session persistence | **IndexedDB**, no library | R9 — *browser persistence*. Works from `file://` in both engines and survives a browser restart, so FR-25 is buildable as written. Storage costs about a tenth of the heap: 100k × 20 rows occupy 8.9 MB stored against ~94 MB live. One consequence reaches NFR-8 and is recorded there — the `file://` origin is a single shared bucket, so any other local HTML page can read querbeet's stored data. |

## 2. Consequences that shape the build

**The build step is mandatory, not optional.** `hyparquet-writer` is ESM-only with no published UMD bundle, so keeping Parquet in scope (FR-36) converts the Vite build from permitted to required. Everything else in the stack ships a ready-made UMD artifact.

**Freeze every dataset at the boundary.** R2 measured that wrapping 100k rows × 20 columns in Vue's deep reactivity inside a render effect costs 437–479 MB on top of 160 MB of data and slows a full read 11–13×. `Object.freeze` on the rows removes that entirely — no proxy is created at all — for about 4% more heap. This is an architecture rule, not a tuning tip: one unfrozen 100k array inside a computed recreates the whole problem. Hold results in `shallowRef`.

**Workers must be classic scripts from a blob URL.** Measured as the only form that works from `file://` in both Chromium and Firefox. Vite's idiomatic `new Worker(new URL(...), {type:'module'})` emits a separate chunk, silently breaks the single-file build, and fails at runtime with no build-time signal. Import every worker as `?worker&inline`, set `worker.format = 'iife'`, and assert after every build that `dist/` contains exactly one file.

**Both exports belong in a worker, and nothing else does.** R3's figures were Node and understated the browser badly; R4 re-measured from `file://`. XLSX export costs **4,943.8 ms (Chromium) / 5,805 ms (Firefox)** at 100k rows and **26,269.7 / 30,558 ms at half a million** — it does not scale linearly. Parquet costs 1,553.6 / 801 ms at 100k and 9,717 / 4,369 ms at 500k, with Firefox roughly twice as fast as Chromium on that path. Across eight main-versus-worker pairs a worker removes 88–98 % of the block for between −0.9 % and +18.8 % elapsed time, so both exports move off-thread. This is why FR-36 requires progress and a responsive interface.

**Never move a dataset to a worker in order to compute on it.** The transfer is the cost, not the work: a structured clone of 100,000 rows blocks the sender for 109.4 ms (Chromium) / 132 ms (Firefox) and 510.8 / 627 ms at half a million, against 263–446 ms for the entire Arquero pipeline. If a worker needs data it should receive it once and keep it. Arquero column arrays are ~30 % cheaper to send than frozen row objects but the full round trip is *worse*, so the columnar intuition is only half right.

**There is no shared cancellation flag on this platform, and the API surface says otherwise.** `SharedArrayBuffer` is hidden from `file://` in both engines, and the documented `WebAssembly.Memory({shared:true})` escape hatch yields one that neither engine will post. A `typeof` check concludes the opposite of the truth. Cancel through the message queue instead: latency is 3.0 / 2 ms at ~5 ms chunks, and progress is effectively free at ~2.6 % overhead.

**The chart renderer choice is load-bearing, and two tile settings come with it.** Register ECharts' `SVGRenderer` and nothing else: in canvas mode `getDataURL({type:'svg'})` returns a PNG silently, with no error, so registering both renderers makes it possible for an export to degrade from vector to raster undetected. The reason SVG matters is FR-37 — measured, an SVG chart enters a printed PDF as vector plus selectable text while a canvas chart enters as a raster bounded by the screen's `devicePixelRatio`. Beyond that, **every tile needs a long-label strategy** (`axisLabel.width` with `overflow`, or a shortening formatter, which querbeet owns anyway since the tick formatter is application-supplied) because a 60-character category label escapes the SVG by 15–21 px, and **`barMaxWidth` must be set** or a single-category tile renders as a 237 px slab in a 346 px plot. ECharts does not observe its container either, so a tile size change must call `resize()`.

**The execution threshold of FR-38 has a measured shape, and the first Step is the case to design against.** Editing a Step recomputes it and everything downstream, so the worst case is not the largest graph but the *earliest* edit in one: changing the first Step of a 30-Step graph costs 578.6 ms in Chromium and 1,156 ms in Firefox, which R4 names as the number the progress affordance should be built against. Two findings bound the design either side of it. There is no Editor-versus-table contention at 30 Steps across 2,800 window swaps, so live mode does not have to defend the Editor's frame rate against the Result pane. And there is no shared cancellation flag available (see above), so an execution that has started can only be stopped through the message queue — which means the threshold has to be low enough that live mode never begins work the user cannot get out of. The threshold itself is an implementation calibration, not a product constant; FR-38 requires only that whatever it is, it is visible.

**The Editor's intended shape comes from the original outline and survived into the measurements.** `idea.md` sketched three panes — Sources, Pipeline, Result — and specified that a Step tile's **height grows with its content**. That second detail is not decoration: it is why the Editor spike measured anchor drift against variable-height node bodies at all, and the answer that came back (0 px / 0.02 px) is what makes the growing tile safe to build. Recorded here because the measurement in §7 otherwise sits with its motivation nowhere.

**Budget type detection as rows × columns × candidates tried, not rows × columns.** No parsing library infers a format from the data — date-fns, Luxon, Day.js and d3 all require the caller to supply the pattern — so the loop that tries candidate formats and counts how many values each one accepts is querbeet's own code in every scenario, and FR-9's full-column scan multiplies it by the candidate list rather than by the column. The one measured point is Luxon at 356 ms per 100,000 values *per candidate* even with its precompiled parser, roughly 7 s for a 100k × 20 Source, which is what disqualified it. Two adjacent traps, both the same family as the hazards in §3: **Day.js silently ignores a format string when its plugin is not registered** — `dayjs('12-25-1995','MM-DD-YYYY')` returns the right date through the native path while `dayjs('25.12.1995','DD.MM.YYYY')` returns Invalid Date — and `Intl` will happily report separators for a locale nobody in the column is using.

**The prompt block owes a numeric filter example.** `block-template.txt` illustrates a filter twice, at lines 74 and 128, and both illustrations are text comparisons — which is why five independent authoring runs had to guess whether a `>` comparison value is a string or a number, and why four of them guessed wrong. The template is the cheapest half of the fix; the ingest validator in FR-28 is the half that has to hold regardless, because a model that never saw the template can still paste a Recipe in.

**Nothing may be fetched at runtime.** A `file://` page has an opaque origin; anything that fetches fails CORS. No sibling config file, no lazy chunk, no CDN link, no external font or stylesheet. Data enters only through file input or drag-and-drop.

## 3. Arquero hazards the wrapper must absorb

R1's deepening measured these against the released 8.0.3. Each maps to a PRD requirement; the mechanism belongs here.

- **`concat` silently drops columns** present only in incoming tables — precisely querbeet's core use case. Workaround, measured working: compute the union of all column names, pad each table via `derive`, force order with `select`, then `concat`. This is FR-13's *"never dropped silently"* clause.
- **Null join keys never match and no option overrides it.** Two workarounds exist and the choice matters enormously: sentinel substitution before joining costs 30.8 ms at 100k rows; a custom predicate function drops Arquero to an O(n·m) loop join, projected at ~3.7 s. Use sentinels — **but only against a lookup whose keys are unique.** R4's Checkpoint D2-a measured the other case: when *both* sides carry nulls in the key column, which a graph makes easy since two branches of one Source inherit its nulls, every sentinel row matches every sentinel row and the output grows quadratically in the null count. 28,000 source rows produced **2,687,670 join rows**; at 100,000 it crashed the tab. Null keys silently *dropped* rows, and the sentinel silently *multiplies* them, which is worse. Either exclude sentinel rows from the join and re-attach them afterwards, give each side a distinct sentinel so they cannot match, or refuse the join — and a Join Step must warn when both inputs carry nulls in the key column, which is a UX requirement and not only an implementation detail. This is FR-14's explicit null-handling setting.
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

**Consumer mode.** Three depths were considered — binding-only repair, binding plus limited Step editing, or one full Editor for everyone. The last was chosen for the MVP on build cost, with the deliberate-entry guard (FR-11) carrying the intent that two interfaces would otherwise have carried. A roles/rights/views model is explicitly deferred.

**Interactive HTML export.** Cut from the MVP as the most expensive single item, being effectively a second small product. Named in the PRD as the strongest post-MVP candidate.

**Computed column formula language.** Deferred rather than rejected in favour of fixed click-together operations. The decisive argument was machine authorship rather than implementation cost: a fixed operation list is a plain data structure a model can emit and the system can validate, whereas a formula language invites a model to produce syntax the parser does not know.

**Pipeline shape.** Three shapes were put to the project owner: a strictly linear Step list, a list whose Steps can be named and referenced as inputs by any later Step, or a full node graph. The graph was chosen. The middle option was offered because it delivers the requested capability — a filtered subset reused in two places — at close to no cost, since Union and Join already take two inputs and the model therefore already admits multiple edges; the difference between it and a graph is mostly the editor, not the data model. The graph's costs were named before the decision and are recorded in PRD §6.3 and Open Questions 2–4: no research exists for the editor component, the Recipe format grows at exactly the point where a model must produce it correctly, and R2's framework verdict was scored against a list. The Recipe format should nonetheless be written so a linear pipeline is the trivial case of it — a graph whose every node has one input — so that a model asked for something simple can produce something simple.

**Comparison value as a string.** The alternative to a JSON number was to require a string always, and the research plan itself leaned that way on the argument that only a string keeps a Recipe portable across locales. The opposite holds. A JSON number needs no locale to be read correctly anywhere, while a string re-admits into the Recipe exactly the locale defect that FR-9's type confirmation exists to remove — and admits it one level deeper, past the gate. The two are equivalent below 2⁵³ and diverge only above it, which no report figure in this product reaches. The mechanism that would have made the question moot, grammar-constrained decoding under a strict schema, is unavailable because a Recipe arrives through the clipboard; enforcement therefore lives in the ingest validator (FR-28) rather than in the channel.

**Drag-and-drop.** The first draft banned drag reordering outright, on a misreading of the research. The finding is narrower: the documented failure is a *library that mutates DOM order* while the framework diffs the same list — two sources of truth, and the list fights itself. Native drag events that compute a target index and update the model are fine, because the framework then re-renders from a single truth. What remains binding is that no interaction may exist *only* as a pointer gesture, which is a correctness rule about keyboard reachability rather than an accessibility target.

## 7. The graph Editor: what was measured

*Rewritten 2026-08-01. This section previously recorded the shape of a gap — "nothing has been
screened" — and that is no longer true: R6 screened the field, the project chose Vue Flow, and a
follow-up spike built and measured the Editor. What follows is what is known; the open items are at
the end and are shorter than the list they replace.*

**All three finalists were built as real single-file artefacts and opened from `file://`.** Vue Flow
1.48.2, BaklavaJS 2.8.1 and a hand-built canvas each build to exactly one HTML file (175,233 /
73,532 / 224,382 B), contain zero occurrences of `import(`, `fetch(`, `new Worker`, `@font-face` or a
non-`data:` `url()`, and issue zero network requests beyond the document in Chromium 151 and Firefox
153. **The gate that shaped this whole plan separated nothing** — the lazy-loading hazard is real in
the field (`@maxgraph/core` fetches four `.gif` files by relative URL) but absent among the
finalists.

**The ownership question settles in everyone's favour, and it settles by a mechanism worth knowing.**
A frozen 100,000 × 20 table placed by reference in node data comes back out of each library's own
state with identity preserved, `isReactive` false, and both array and rows still frozen. **Vue's
reactivity skips non-extensible objects, so `Object.freeze` is itself the protection** — Vue Flow's
`markRaw` advice does not apply to a frozen payload, and §2's existing freeze rule already covers it.
The editor costs 0.32–2.76 MB of heap against ~94 MB for one Source table, so footprint cannot
decide this.

**Two things the chosen library does not do, both now mandatory implementation work.** Vue Flow's
published bundle contains **no cycle detection whatsoever** — zero occurrences of `cycle`, `acyclic`
or `topological` — and `addEdges` created a cycle on a three-node chain without complaint. FR-12
requires refusal with a named reason, so the check sits *in front of* the mutation API, and the
unguarded path is the programmatic one that both a Recipe loader and an LLM-authored Recipe use. And
Vue Flow **copies the node objects it is handed**, so the app must decide which side owns the truth.

**The spike then built it and answered four questions** (`spikes/editor-vueflow-2026-08-01/`). The
variable-height tripwire — React Flow #3270 and Vue Flow #174 are the same asynchronous-DOM-geometry
failure in two independent codebases — **passes: anchors drift 0 px in Chromium and 0.02 px in
Firefox across five runtime height changes.** The cycle guard refuses on the pointer path, the
programmatic path and the Recipe loader. **Design B is authoritative:** `applyDefault: false`, the
model owns state, and the projection is pushed with `setNodes`/`setEdges` from one watcher. The
Recipe round-trips byte-identically at 1,309 B for a six-Step graph, with six rejection classes
each naming its defect specifically enough to paste back to a model.

**Datasets never enter the graph model.** Tables live in a `shallowRef` registry keyed by Source id,
outside the graph; the graph itself is small and deeply reactive. R4 confirmed this is also where a
per-Step result cache belongs.

**NFR-7 is better than assumed, and the cost claim inverted.** Nine of eleven Editor interactions are
keyboard-reachable in both engines — reaching the canvas, selecting, multi-selecting, moving (5 px
per arrow, 20 px with Shift), adding a Step, designating the Result Step, editing configuration,
deleting, and focus returning to the canvas. **Connecting two Steps is the one gap**, and it waits on
a UX decision rather than on anything technical, since `connectOnClick` is already on and its click
path ends in the same guarded door as the drag. Vue Flow ships `nodesFocusable`, `edgesFocusable`,
`tabIndex: 0`, arrow-key movement and an `aria-live` region — all of which the hand-built path would
have had to write. The two fixes this needed were four and fifteen lines.

**There is no Editor/table contention**, measured against a real build with a virtualized table pane
beside the canvas: the 50-row window swap costs 2.9–3.1 ms (Chromium) / 4–5 ms (Firefox) identically
at 6 and at 30 Steps, idle and during real pointer drags, and **not one frame exceeded 50 ms across
2,800 swaps** in either engine. The per-node `ResizeObserver` is real and cheap — resizing all 30
node bodies at once costs 32.2 / 33 ms once, not per frame.

**What is still not known.** Vue Flow ships no auto-layout and no undo/redo, and neither does the
hand-built canvas that the research scored above it — but one alternative does: Baklava ships
undo/redo, clipboard, subgraphs and a topological sort, so
if those become requirements it is the fallback rather than the hand-built canvas. Keyboard
*connecting* is unresolved and is a UX decision. And the hedge stands: the graph model stays free of
both the canvas and any library, which is now the exit *from* Vue Flow rather than an argument
against adopting it.
