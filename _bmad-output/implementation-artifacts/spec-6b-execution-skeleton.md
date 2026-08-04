---
title: 'Story 6b — Execution walking skeleton: Filter and Columns Steps, and the per-Step preview'
type: 'feature'
created: '2026-08-04'
status: 'ready-for-dev'
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
- **Interim execution mode, stated:** until story 7's threshold and mode switch, execution recomputes after every graph or config change. Measured affordable: full 100k pipeline 263/446 ms, earliest edit of a 30-Step graph 578/1156 ms, and no Editor-vs-table frame contention across 2,800 swaps.
- **Per-Step preview** shows the row and column count of that Step's **full** output and that Step's warnings alongside it (CAP-19), plus a windowed row view. Results are held outside reactivity (AD-6), swapped through `shallowRef`.
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
- `ports/index.js:19-30` `Table`; `:82-88` `TableEngine` (6a gives it `fromColumns`; this story adds the two ops); `:121-181` `GraphView` — the contract to widen with the select event; `:180` "Selection is view state and stays the library's" — the sentence to amend, precisely.
- `core/exec/source-store.js:755-773` command surface; entries frozen (`:260-267`) — reference identity drives 6a's cache. `core/exec/convert.js` (6a) — Step zero, consumed here, not reopened.
- `adapters/vueflow/GraphCanvas.vue:55` — emits `['move','remove','disconnect','connect','refused']`; select joins this list. `canvas-logic.js` + test — where any new pure logic goes (node envelope).
- `ui/EditorPane.vue:27-56` — `shallowRef(read())` + `refresh()` + `run(result, {quiet})`; `:101` `marksFor(id)`; `:250-267` the `#step` scoped slot. `ui/StepCard.vue` — kind label, name input, slot rows; **no config panel exists**; `StepFrame.vue:13-17` — never a Handle inside a fixed-height scrolling container, so config/preview live in a side panel, not the node body.
- `ui/graph-labels.js:70-124` `GERMAN` map + `:140` `graphLabelGaps()` — every new code lands here; `:145-150` `SEVERITY`.
- `ui/RowWindow.vue` (props `table`, `label`; `data-testid="preview"`) + `core/view/row-window.js` — the windowed view the preview embeds. **Test-id collision is real:** `SourcesPane` is `v-show` (stays mounted), so a second `data-testid="preview"` would match existing page-scoped assertions — parameterize the id.
- `_bmad-output/implementation-artifacts/deferred-work.md:59-62` — the Union entry this story decides; `:9-12` (slot shifting — story 8's, do not fix here).
- Measured licences: no Editor-vs-table contention (2,800 swaps < 50 ms/frame); `filter` costs a BitSet (~12.5 kB at 100k), `select` ~0 MB — a linear chain is memory-free; D2-a caveat: a Step output feeding several consumers is the graph case, `derive`-heavy costs charged per consumer do not apply to these two verbs.

## Tasks & Acceptance

**Execution:**

- [ ] `core/graph/graph.js` + `graph-store.js` -- `config` on nodes (frozen, opaque), `configureStep(id, config)` command, duplicate-upstream `warning` in `graphDiagnostics`, new codes in `CODE` -- the model stays the one writer
- [ ] `core/steps/index.js` (new) + `filter.js` + `columns.js` + tests -- registry `kind → {apply(engine, inputs, config), validate(config), defaultConfig()}` with AD-4's signature; exported `executorGaps()` naming kinds without executors -- the second table keyed by the same codes
- [ ] `ports/index.js` -- `TableEngine.filter` / `TableEngine.selectColumns` contracts; `GraphView` select event, amending the selection sentence -- ports move before implementations
- [ ] `adapters/arquero/engine.js` + test -- implement both ops: box-blind comparisons, ISO→`BigInt` once, explicit column handling -- hazards stay absorbed (AD-19)
- [ ] `adapters/vueflow/GraphCanvas.vue` (+ `canvas-logic.js` if logic splits) -- emit `select` with node id / null -- one new outward event, nothing else widens
- [ ] `core/exec/execute.js` (new) + test -- frontier walk over `contributingTo`, Step zero via 6a, gate 1, per-Step results `{table, rowCount, columnCount, diagnostics}`, named refusals for unimplemented kinds -- the walking skeleton
- [ ] `ui/EditorPane.vue` -- hold selected id (`shallowRef`), trigger recompute on graph/config change, host the side panel -- the doors stay in one pane
- [ ] `ui/StepPanel.vue` (new) -- German config forms for Filter (column select, operator select, typed value input, all/any) and Columns (checkbox + rename + reorder), plus the preview: counts, warnings via `runStatus`, `RowWindow` embed -- CAP-15/16/19 surface
- [ ] `ui/graph-labels.js` -- German sentences for every new code; gap tests stay `[]` -- NFR-6
- [ ] `ui/RowWindow.vue` -- `testid` (and label already exists) parameterized -- no collision with page-scoped `preview` assertions
- [ ] `tests/e2e/execution.spec.js` (new) -- load fixture → confirm → Filter + Columns → per-Step counts, warning visibility, refusal paths -- end to end over the built file
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- update `:59-62` with the decision (allow + warn), citing this spec -- ledger hygiene

**Acceptance Criteria:**

- Given a confirmed Source → Filter → Columns → Result chain, when the graph changes or a config changes, then every contributing Step shows the row and column count of its full output and its own warnings beside its preview.
- Given a Filter condition whose value type disagrees with the column's confirmed type, when the run executes, then the Step yields an error naming both types, produces no table, and each downstream Step reports its missing input by name.
- Given cells `null`, `""` and `"  "` in a text column, when "is empty" filters, then all three match, and "is not empty" matches exactly the remaining non-boxed rows.
- Given a Filter over a column containing boxed cells, when the run executes, then no box matches any operator and the dropped-because-boxed count is visible as a warning at that Step.
- Given a Columns rename to an existing name, when configured, then the rename is refused naming the collision and the previous config stays in force.
- Given a frontier containing a Union (or an unconfirmed Source), when a run is requested, then the run is refused naming the Step and kind (or the Source), and no Step executes.
- Given one Source connected to both slots of a Union, when the graph renders, then the Union carries a visible warning before any run.

## Spec Change Log

## Design Notes

**Why validation lives at execution:** `configureStep` cannot see the input schema — it exists only once upstream Steps have run. Structural validation (shape, operator vocabulary) happens at configure time via the registry; type agreement is checked against the actual input `schema()` in `apply`, where CAP-15's refusal can name both sides truthfully.

**Why the box breaks the complement, and why that is stated:** AD-22 says comparison never matches a box. "Is not empty" as a strict complement would smuggle boxes through as non-empty text. The exception — complement over non-boxed values, boxes counted into a warning — keeps AD-22 intact and makes the dropped rows visible instead of silent, which is this product's whole argument.

**Why recompute-on-change is the interim:** AD-29's mode gate is scheduler state (story 7). Shipping 6b without any recompute rule would make CAP-19's "updates downstream" untestable; the measured costs license eager recompute at design scale, and story 7 replaces the rule, not the executor.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green; `executorGaps()` names exactly Union/Join/Computed/Aggregate
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` return `[]`
- `npm run build && npm run assert` -- expected: one HTML file, structural gate green
- `npm run verify` -- expected: lint, both Vitest projects, Playwright in Chromium and Firefox green
