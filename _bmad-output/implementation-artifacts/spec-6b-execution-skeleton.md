---
title: 'Story 6b — Execution walking skeleton: Filter and Columns Steps, and the per-Step preview'
type: 'feature'
created: '2026-08-04'
status: 'in-review'
baseline_commit: '9c8f1f115c263a3cd268d9ca29f7a89b18d3ddc3'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Seven Step kinds exist as arity records with no configuration body — `core/graph/kinds.js` says so in its header, and story 5's spec forbade exactly this ("A Step in this story produces nothing"). `core/steps/` and `core/recipe/` are `.gitkeep` files; a grep for execution code finds none. A pipeline can be drawn, connected and named, and CAP-15, CAP-16 and CAP-19 are all unrealized: nothing filters, nothing selects, nothing previews.

**Approach:** Give Steps a configuration body and a kind registry in `core/steps/` with AD-4's signature; execute the frontier `contributingTo(graph, resultId)` in `core/exec/` over the Tables story 6a produces, Step zero first, AD-29's gate 1 enforced. Widen `TableEngine` with the two operations Filter and Columns need, so a Step kind never touches a cell — boxes and temporal units stay adapter-private (AD-22, AD-21). Surface a per-Step preview (counts, warnings, windowed rows) from the canvas selection, which requires `GraphView` to report selection outward — story 5's two Ask-Firsts (config body, port widening) are both taken by approving this spec.

## Boundaries & Constraints

**Always:**

- **A Step is `(engine, inputs: Table[], config) => {table, diagnostics}`** (AD-4): pure, synchronous, no I/O, no clock, no randomness, no input mutation. Step kinds call engine operations only; none inspects a box or learns a temporal unit.
- **`TableEngine` grows exactly two operations:** `filter(table, {conditions, combine})` and `selectColumns(table, ordered: [{from, to}])`. Inside the adapter: a comparison **never matches a box** (AD-22); a temporal comparison value arrives as an ISO 8601 string and is converted to `BigInt` ns once, adapter-side; Arquero's `select`/`filter` share columns (measured ~0 MB per chain link).
- **Filter config is canonical machine form** (CAP-15): a number is a number (`1000`, never `"1.000"`), a temporal value an ISO 8601 string, never a display form. The entry controls are locale-aware; the stored config is not.
- **Type disagreement is refused, never coerced** (CAP-15): a condition whose value type disagrees with the column's confirmed type yields an `error` diagnostic naming both types, the Step produces no table, and downstream Steps refuse with a named missing-input diagnostic. Validation happens where the input schema is known — at execution, not at `configureStep` time.
- **"Is empty" matches null, the empty string, and whitespace-only alike; "is not empty" is its exact complement over non-boxed values.** The config UI states this in German. A row whose comparison cell is a box matches **no** operator; such rows are dropped and their count travels in a `warning` diagnostic — the box never silently passes as text.
- **The combination rule (all/any) is explicit** in config and UI; Filter reports removed rows as a diagnostic with the count in `values` (AD-13 — numbers, never sentences).
- **Columns:** renaming to a name already in use is refused naming the collision; config order is output column order (CAP-16).
- **Config lives on the graph node, opaque to `core/graph/`:** new command `configureStep(id, config)` validates structural shape through the kind registry and stores a frozen config; `kinds.js` stays arity-only. Every new diagnostic code gets a German entry and the gap tests stay green.
- **Execution** (`core/exec/`): topological walk over `contributingTo(graph, resultId)`; Step zero converts each contributing Source through story 6a's cache. **Gate 1 (AD-29): any contributing Source unconfirmed → the run is refused naming the Source; nothing executes.** Gates 2 and 3 arrive with story 7's scheduler. A frontier containing a kind without an executor (Union, Join, Computed, Aggregate — stories 8/9) refuses the run naming the Step and its kind, never crashes.
- **Interim execution mode, stated:** until story 7's threshold and mode switch, execution recomputes after every **data-affecting** change — `connect`, `disconnect`, `configureStep`, `removeStep`, `setResult`, `syncSources` — never after a rename or a move. Measured affordable: full 100k pipeline 263/446 ms, earliest edit of a 30-Step graph 578/1156 ms, and no Editor-vs-table frame contention across 2,800 swaps.
- **Per-Step preview** shows the row and column count of that Step's **full** output and that Step's warnings alongside it (CAP-19), plus a windowed row view. **Cells render through a German display projection** (`ui/cell-text.js`): a typed Table holds machine values, and bare interpolation would show a date as a raw nanosecond `BigInt` and a box as `[object Object]`. Numbers and temporals render in German convention; a boxed cell renders as its original text, **unmarked** — no positional box channel crosses the four-method Table after a filter, story 10 owns CAP-31's marking and the gap is filed in the ledger. Results are held outside reactivity (AD-6), swapped through `shallowRef`.
- **Selection crosses the port as one outward event** (selected node id or null). Selection *state* stays the library's; `EditorPane` only mirrors the id.
- **Union consuming the same upstream in two slots — decided: allow with a warning.** The graph emits a `warning` diagnostic when one Step consumes the same upstream node in ≥2 slots (self-union stays a legitimate way to double a dataset; silent duplication does not). Visible as a step mark before execution, satisfying "not only at the moment of execution". Ledger entry updated with the decision.

**Ask First:**

- Widening `TableEngine` beyond the two named operations, or the `Table` interface at all.
- Any change to `kinds.js` arities or the kind list.
- Anything Recipe-persistence-shaped — serialization is story 14's.

**Never:**

- No cache, no memoization, no cancellation, no mode switch or row threshold — story 7's. Every run recomputes.
- No Union/Join/Computed/Aggregate executors — stories 8/9.
- No free-text expression anywhere: Filter and Columns configs are selects and typed inputs producing plain data (C-9, C-12).
- No `RowWindow` height prop or virtualization work — the reuse seam waits for story 10 (`deferred-work.md:185-188`); this story parameterizes only the test id and label, `VIEWPORT_ROWS` stays 10.
- No Table or row array in `ref`/`reactive`/`computed` (AD-6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Filter equals, number | column confirmed number, condition `{op: 'eq', value: 1000}` | matching rows; `info` diagnostic with removed count | N/A |
| Filter gt, date | date column, value `"2025-12-31"` | compares as ns `BigInt`, adapter-side | N/A |
| Type disagreement | date column vs value `1000` | no table; `error` naming `date` vs `number`; downstream refuses named | refusal, never coercion |
| Is empty | text column with `null`, `""`, `"   "` | all three match; "is not empty" matches the exact rest | UI states the semantics |
| Boxed comparison cell | box in the condition's column | row matches no operator; dropped; count in `warning` | never a silent pass |
| Rename collision | rename `b` → `a` while `a` exists | refused naming `a` | error diagnostic |
| Reorder | Columns config order `[c, a]` | output schema order `[c, a]` | N/A |
| Unimplemented kind in frontier | Union between Source and Result | run refused naming the Step and kind | no partial execution |
| Unconfirmed Source in frontier | Source without confirmed typing | run refused naming the Source (gate 1) | no partial execution |
| Same Source in two Union slots | `src:q1` in slot 0 and 1 | accepted; `warning` mark on the Union | decided: allow + warn |

</frozen-after-approval>

## Code Map

**Read-only shapes to build against:**

- `core/graph/graph.js:84-95` `makeNode` — nodes carry `{id, kind, name, x, y, inputs}`; config is the one new field. `:330` `contributingTo(graph, resultId)` — **the run frontier already exists**; `:38-65` `CODE`/`GRAPH_CODES` — new codes must join this pattern or the German gap test checks nothing; `:161-181` `checkConnect` — the duplicate-Source warning does *not* go here (it is not a refusal); `:183-185` `refuse/done` result grammar.
- `core/graph/graph-store.js:206-251` — the command surface `configureStep` joins; `:10-16` unknown id is a refusal on every command; `:168-204` `syncSources`.
- `core/graph/kinds.js:35-43` — arity catalogue, stays config-free; `kindSpec :48-65`.
- `core/diagnostics/diagnostic.js:20-27` the shape; `:72-81` `runStatus` — written for run aggregation, **unused until now**; the per-Step warning region should aggregate through it.
- `ports/index.js:20` `Table`; `:92` `TableEngine` (6a gave it `fromColumns`; this story adds the two ops); `:163` `GraphView` — the contract to widen with the select event; `:220` "Selection is view state and stays the library's" — the sentence to amend, precisely. **All four anchors moved when 6a landed; these are the post-6a lines.**
- `core/exec/source-store.js:755-773` command surface; entries frozen (`:260-267`) — reference identity drives 6a's cache. `core/exec/convert.js` (6a) — Step zero, consumed here, not reopened.

**What story 6a shipped, and what it costs this story** (measured 2026-08-04, all four figures taken rather than estimated):

- **`convertSource(entry, engine)` answers `null` for two different states** — the typing is not confirmed (gate 1's case) *and* the Source repeats a column name (`core/exec/convert.js:205`). Gate 1 must not report the second as the first: a duplicate header is not an unconfirmed Source and saying so would send the user to a control that is already satisfied. The collision is an open **Ask First** in the ledger (`deferred-work.md:44`) and it wants deciding here, because a Step reading a column by name is where the ambiguity stops being cosmetic. Until it is decided, the executor must distinguish the two before it names anything.
- **The Step-zero cache is created inside `ui/SourcesPane.vue:152` and `EditorPane` receives no engine at all** (`ui/App.vue:81` hands `engine` to `SourcesPane` only). **Decided 2026-08-04 with the project owner: one cache, created in `ui/App.vue` and passed to both panes as a prop.** Two caches would convert the same Source twice (545–555 ms each at 100k × 20) and retain it twice (39,3 MB each), putting five converted Sources at ~532 MB against the 550 MB the budget plans from; a module singleton would need a mutable slot for the engine and give AD-1's "one place names the adapter" a second home. The cache is created in `setup`, never in a `ref` — AD-6 holds as it does today. Release stays what it is now: a Source's removal releases it.
- **Step zero costs 545–555 ms, synchronously, once per frozen entry** at 100k × 20 — the interim recompute licence in this spec (263/446 ms full pipeline, 578/1156 ms earliest edit of a 30-Step graph) was measured *without* it. The cache keeps it to once per entry rather than once per run, but the first run after a confirmation pays it on the main thread. Open in the ledger (`deferred-work.md:16`) and assigned to this story's scheduler question.
- **`Table.column(name)` re-extracts and re-copies the whole column on every call** (`deferred-work.md:23`). This story's Step kinds are its first real callers: a Filter reading one column and a Columns Step reading three pay four full copies at 100k rows unless the executor holds what it reads.
- **`ui/RowWindow.vue` gained `marks` and a mark-title prop, and `buildWindow(table, page, scrollTop, marks)` gained the fourth argument.** A marked cell already carries a class and a `title`; `ui/cell-text.js` has to compose with that cell rather than replace its rendering. The `testid` parameterization this story asks for is unchanged and still needed.
- `adapters/vueflow/GraphCanvas.vue:55` — emits `['move','remove','disconnect','connect','refused']`; select joins this list. `canvas-logic.js` + test — where any new pure logic goes (node envelope).
- `ui/EditorPane.vue:27-56` — `shallowRef(read())` + `refresh()` + `run(result, {quiet})`; `:101` `marksFor(id)`; `:250-267` the `#step` scoped slot. `ui/StepCard.vue` — kind label, name input, slot rows; **no config panel exists**; `StepFrame.vue:13-17` — never a Handle inside a fixed-height scrolling container, so config/preview live in a side panel, not the node body.
- `ui/graph-labels.js:70-124` `GERMAN` map + `:140` `graphLabelGaps()` — every new code lands here; `:145-150` `SEVERITY`.
- `ui/RowWindow.vue` (props `table`, `label`; `data-testid="preview"`) + `core/view/row-window.js` — the windowed view the preview embeds. **Test-id collision is real:** `SourcesPane` is `v-show` (stays mounted), so a second `data-testid="preview"` would match existing page-scoped assertions — parameterize the id.
- `_bmad-output/implementation-artifacts/deferred-work.md:100` — the Union entry this story decides; `:50` (slot shifting — story 8's, do not fix here); `:221` (the `RowWindow` reuse seam, story 10's). **Story 6a appended eight entries at the top of the ledger, so every line reference into that file in this spec moved — these are the post-6a lines.**
- Measured licences: no Editor-vs-table contention (2,800 swaps < 50 ms/frame); `filter` costs a BitSet (~12.5 kB at 100k), `select` ~0 MB — a linear chain is memory-free; D2-a caveat: a Step output feeding several consumers is the graph case, `derive`-heavy costs charged per consumer do not apply to these two verbs.

## Tasks & Acceptance

**Execution:**

- [x] `core/graph/graph.js` + `graph-store.js` -- `config` on nodes (frozen, opaque), `configureStep(id, config)` command, duplicate-upstream `warning` in `graphDiagnostics`, new codes in `CODE` -- the model stays the one writer
- [x] `core/steps/index.js` (new) + `filter.js` + `columns.js` + tests -- registry `kind → {apply(engine, inputs, config), validate(config), defaultConfig()}` with AD-4's signature; exported `executorGaps()` naming kinds without executors -- the second table keyed by the same codes
- [x] `ports/index.js` -- `TableEngine.filter` / `TableEngine.selectColumns` contracts; `GraphView` select event, amending the selection sentence -- ports move before implementations
- [x] `adapters/arquero/engine.js` + test -- **switch the table construction from the base `Table` to `ColumnTable`** (decided 2026-08-04, measured — see Design Notes), then implement both ops on it: box-blind comparisons, ISO→`BigInt` once, explicit column handling -- hazards stay absorbed (AD-19)
- [x] `adapters/vueflow/GraphCanvas.vue` (+ `canvas-logic.js` if logic splits) -- emit `select` with node id / null -- one new outward event, nothing else widens
- [x] `core/exec/execute.js` (new) + test -- frontier walk over `contributingTo`, Step zero via 6a, gate 1, per-Step results `{table, rowCount, columnCount, diagnostics}`, named refusals for unimplemented kinds -- the walking skeleton
- [x] `core/exec/source-store.js` + tests -- **make column names unique on ingest** (decided 2026-08-04, see Design Notes): a repeated name takes the lowest free `_<n>` from 2 upward (`Betrag`, `Betrag_2`); an empty name becomes `col_<1-based position>`; the rule runs after both, so a file that itself contains the generated form is still resolved deterministically. One `warning` diagnostic carries the mapping (`{from, to, at}` per renamed column) -- the store is the one writer, so all three readers stop disagreeing
- [x] `ui/SourcesPane.vue` -- the German sentence for the rename code in the `GERMAN` map (`:247`), naming what became what -- AD-13: `core/` emits the mapping as values, `ui/` writes the sentence
- [x] `ui/App.vue` + `ui/SourcesPane.vue` + `ui/EditorPane.vue` -- move the Step-zero cache to `App.vue` and pass it (with the engine) to both panes; `SourcesPane` stops creating its own -- one converted Table per Source, whoever reads it (decided 2026-08-04)
- [x] `ui/EditorPane.vue` -- hold selected id (`shallowRef`), trigger recompute on data-affecting changes only, host the side panel -- the doors stay in one pane
- [x] `ui/cell-text.js` (new) + test -- German display projection for preview cells: number → `1.234,56`, temporals from `BigInt` ns → `31.12.2025` / `31.12.2025 14:30` / `14:30`, boolean → `wahr`/`falsch`, text and boxed original text as-is -- story 10 adopts and refines this module, it is written to be its seam
- [x] `ui/StepPanel.vue` (new) -- German config forms for Filter (column select, operator select, typed value input, all/any) and Columns (checkbox + rename + reorder), plus the preview: counts, warnings via `runStatus`, `RowWindow` embed rendering through `cell-text` -- CAP-15/16/19 surface
- [x] `ui/graph-labels.js` -- German sentences for every new code; gap tests stay `[]` -- NFR-6
- [x] `ui/RowWindow.vue` -- `testid` (and label already exists) parameterized -- no collision with page-scoped `preview` assertions
- [x] `tests/e2e/execution.spec.js` (new) -- load fixture → confirm → Filter + Columns → per-Step counts, warning visibility, refusal paths -- end to end over the built file
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- update `:59-62` with the decision (allow + warn), citing this spec; append a new entry: step-output previews render boxes as original text but cannot **mark** them — no positional channel crosses the four-method Table after a filter, and story 10 (CAP-31 "unparsed cells visually marked") needs a channel decision -- ledger hygiene

**Where the implementation departed from the task list, and why** (2026-08-04, decided alone with the owner away, both measured):

- **The panel is under the canvas rather than beside it.** The Code Map's reason for a panel at all is the Handle rule — never a Handle inside a fixed-height scrolling container — and that is satisfied either way. Beside was built first and measured: a 384 px column leaves ~396 px of canvas at this page width, which is narrower than one column of Steps (a 256 px card plus the 320 px column pitch), so every Step added after the initial fit panned the Steps already on screen out of the pane and thirteen story-5 e2e cases went red on geometry. Under the canvas the pane keeps its full width and the page grows instead.
- **A run's diagnostics are rendered in the panel and not as card marks.** They are full sentences, and a 256 px card wearing two of them grows past 280 px — taller than any placement pitch the model can pick, since `core/graph/` is browser-free and cannot measure a card. Cards then overlapped and the upper one swallowed the pointer aimed at the lower one's controls. `PLACEMENT.dy` went from 150 to 200 in the same pass (a Filter card is 151 px and a marked card 187 px, so the old pitch overlapped by up to 37 px), and the residual limitation is in the ledger.
- **`addStep` recomputes**, which the interim list does not name. `addNode` designates the first Step that could be a Result as one, so adding a Step can change which Pipeline exists — the same change `setResult` makes, and on the list for the same reason. `addInputSlot` and `removeInputSlot` do not recompute: a slot may only be removed while it is empty.
- **The base Arquero `Table` would have worked and is 57,829 bytes cheaper.** The two operations reduce to `create` + `BitSet`, both public on the base class, so the premise behind the `ColumnTable` decision ("the verbs exist only as its methods") is true and was not the constraint. `ColumnTable` shipped as decided; the measurement is filed in the ledger for the owner rather than acted on.

**Acceptance Criteria:**

- Given a confirmed Source → Filter → Columns → Result chain, when the graph changes or a config changes, then every contributing Step shows the row and column count of its full output and its own warnings beside its preview.
- Given a Filter condition whose value type disagrees with the column's confirmed type, when the run executes, then the Step yields an error naming both types, produces no table, and each downstream Step reports its missing input by name.
- Given cells `null`, `""` and `"  "` in a text column, when "is empty" filters, then all three match, and "is not empty" matches exactly the remaining non-boxed rows.
- Given a Filter over a column containing boxed cells, when the run executes, then no box matches any operator and the dropped-because-boxed count is visible as a warning at that Step.
- Given a Columns rename to an existing name, when configured, then the rename is refused naming the collision and the previous config stays in force.
- Given a frontier containing a Union (or an unconfirmed Source), when a run is requested, then the run is refused naming the Step and kind (or the Source), and no Step executes.
- Given one Source connected to both slots of a Union, when the graph renders, then the Union carries a visible warning before any run.
- Given a date column in a Step's preview, when the rows render, then the cell shows the German form (e.g. `31.12.2025`), never a raw nanosecond value — and renaming or moving a Step triggers no recomputation.
- Given a CSV whose header row ends in two extra delimiters (two columns with no name), when it is read, then the columns are named by position, a warning names each rename, the Source confirms and converts like any other, and its unparsed cells are marked.
- Given a Source with two columns called `Betrag`, when it is read and confirmed, then the second is `Betrag_2` everywhere a name appears — preview, typing panel, Filter column select, Columns Step — and a re-read of the same file carries annotations and chosen types across unchanged.

## Spec Change Log

- 2026-08-04 (post-6a review, owner-approved): the repeated-column-name Ask First from story 6a was taken here rather than carried further. The store makes column names unique on ingest (`Betrag_2`, `col_3`) and reports the mapping; the rule was widened from "duplicate header" to "any repeated name" after a probe showed a CSV header with two extra delimiters produces two nameless columns silently. Two tasks and two acceptance criteria added; the frozen block is untouched, so the I/O matrix does not carry the new rows — the criteria do. Parquet's `readable: false` for duplicated columns stays as it is and is filed in the ledger.
- 2026-08-04 (post-6a review, owner-approved): story 6a landed and this spec was re-read against the tree it now builds on. Two decisions taken with the project owner, both measured first: the adapter moves to `ColumnTable` (+58,729 bytes against 19.8 MB per retained chain), and one Step-zero cache lives in `ui/App.vue` rather than one per pane. Four facts added to the Code Map that the spec could not have known when it was written — `convertSource` answering `null` for two different states, Step zero's 545–555 ms landing outside this spec's recompute measurement, `column(name)` re-copying per call, and `RowWindow`'s new `marks` argument. Every line reference into `ports/index.js` and `deferred-work.md` was re-anchored; the frozen block is untouched and no acceptance criterion changed.
- 2026-08-04 (pre-dev seam review, owner-approved): added `ui/cell-text.js` — a typed Table renders machine values, and bare `{{ cell }}` would show raw `BigInt`s and `[object Object]` boxes; recompute narrowed to data-affecting changes (a rename cost 263–446 ms as written); a ledger entry is filed for the missing box-marking channel in step previews (story 10's CAP-31). KEEP: the Union decision (allow + warn) and both taken Ask-Firsts are unchanged.

## Design Notes

**Which Arquero table class carries the verbs — decided against the measurement.** Story 6a built against the base `Table`, which is 58,729 bytes cheaper and has no verb this story's port needed. It also has none of the verbs this story *does* need: `filter` and `select` are `undefined` on it, and Arquero exports no standalone verb functions — they exist only as methods on `ColumnTable`. So the choice was `ColumnTable` or a hand-written filter in the adapter, and both sides were measured on 2026-08-04 rather than argued:

| | Artefact | One filter, 100k × 20 | Source → Filter → Columns, every Step retained |
|---|---|---|---|
| `ColumnTable` (Arquero's verbs) | 723,262 → **781,991 bytes** (+58,729) | **0.1 MB** | **~0.0 MB** |
| Base `Table`, verbs hand-written | ±0 | **7.6 MB** | **19.8 MB** |

The chain figure decides it: CAP-19 shows the row and column count of every Step's **full** output, so no intermediate is transient — a hand-written filter materializes twenty fresh column arrays per link and holds them, and five Sources with such a chain add ~100 MB where Arquero's shared columns add nothing. **Decided with the project owner: `ColumnTable`.** Nothing about the frozen memory sentence changes — it is Arquero's sharing behaviour that was licensed, and this is the class that has it. The artefact has no stated byte budget (the single-file gate checks structure, not size) while memory has one, and the parser is no longer an argument either way: acorn is in the bundle regardless, which story 6a measured and wrote into the ledger.

**Who owns the uniqueness of a column name — decided 2026-08-04 with the project owner, and it is wider than it looked.** Story 6a left an Ask First: a Source repeating a column name is not converted, because the `unparsed` map is keyed by name and marking from it would give the first `Datum` the second one's failures. Probed on 2026-08-04, the case is not exotic. A CSV header ending in two extra delimiters — `Kunde,Betrag,,` — produces columns named `["Kunde","Betrag","",""]` **with no diagnostic at all**, which is the same collision; the engine's refusal then reads `a table cannot hold two columns called `, a sentence that breaks on its own empty name. The three readers also disagree today: CSV is silent, XLSX warns and keeps both, Parquet warns and marks the duplicate `readable: false`.

Two facts decide it. **Uniqueness has to exist somewhere regardless** — Arquero is name-keyed and cannot hold two columns of one name, so the only real question is whether the user can see where it happened. And **the header is already a proposal in this architecture rather than delivered data**: `adapters/csv/csv-reader.js:8` says so in as many words ("values as delivered, header a *proposal* over them") and the header row is user-correctable, so a name is not a value and AD-7 is not in the way.

**The store makes names unique on ingest and reports it.** A repeated name takes the lowest free `_<n>` from 2 upward (`Betrag`, `Betrag_2`); an empty name becomes `col_<1-based position>`; the uniqueness pass runs after both, so a file that happens to contain `Betrag_2` itself still resolves deterministically. Determinism is the load-bearing property, not the spelling: annotations and chosen types are carried across a re-read **by name**, so a rule that produced a different name on the second read would drop them.

The generated part is language-free on purpose. AD-13/NFR-6 put German in `ui/`, and `core/` generates no user-visible name anywhere today — a new Step's German label is handed *in* from `ui/EditorPane.vue:169`, and `makeNode` falls back to the `id`, which is structural rather than linguistic. `col_3` follows that precedent; `Spalte 3` would have been the first German string in `core/`. The mapping travels as diagnostic `values` and `ui/SourcesPane.vue`'s `GERMAN` map writes the sentence, which is exactly the split AD-13 describes.

What this dissolves: `convertSource` stops having two meanings for `null`. With unique names it can only mean "the typing is not confirmed", gate 1 can name the Source truthfully, and the adapter's duplicate-name throw becomes what it should be — an invariant guard nothing reaches, rather than a state the UI has to explain. **Not in scope here and filed in the ledger:** Parquet's `readable: false` for duplicated columns is no longer necessary once names are unique, but this story does not open the Parquet reader; such a file gets unique names and stays text.

**Why one Step-zero cache rather than two.** The Editor and the Sources pane both need converted Tables, and 6a left the cache inside `SourcesPane`. Two caches would be the cheapest edit and the most expensive result: the same Source converted twice at 545–555 ms and retained twice at 39.3 MB, which puts five Sources at ~532 MB against a 550 MB plan, plus two answers to "is this Source converted" — the duplicate bookkeeping 6a's own review already flagged once. A module singleton would avoid the prop and cost more: `createStepZeroCache` takes the engine, so the singleton needs a mutable slot for it, and AD-1's "one place names the adapter" would have a second home no test could reset per case. `App.vue` already receives the engine; it holds the cache and hands it down.

**Why validation lives at execution:** `configureStep` cannot see the input schema — it exists only once upstream Steps have run. Structural validation (shape, operator vocabulary) happens at configure time via the registry; type agreement is checked against the actual input `schema()` in `apply`, where CAP-15's refusal can name both sides truthfully.

**Why the box breaks the complement, and why that is stated:** AD-22 says comparison never matches a box. "Is not empty" as a strict complement would smuggle boxes through as non-empty text. The exception — complement over non-boxed values, boxes counted into a warning — keeps AD-22 intact and makes the dropped rows visible instead of silent, which is this product's whole argument.

**Why recompute-on-change is the interim:** AD-29's mode gate is scheduler state (story 7). Shipping 6b without any recompute rule would make CAP-19's "updates downstream" untestable; the measured costs license eager recompute at design scale, and story 7 replaces the rule, not the executor.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green; `executorGaps()` names exactly Union/Join/Computed/Aggregate
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` return `[]`
- `npm run build && npm run assert` -- expected: one HTML file, structural gate green
- `npm run verify` -- expected: lint, both Vitest projects, Playwright in Chromium and Firefox green
