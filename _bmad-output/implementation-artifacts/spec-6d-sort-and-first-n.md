---
title: 'Story 6d — Sort and First-N Steps: a row order that is data'
type: 'feature'
created: '2026-08-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: '5c93aad5639ba327cfb3ffce5532b497c7df75ef'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/spikes/arquero-order-2026-08-04/findings.md'
  - '_bmad-output/implementation-artifacts/stub-sort-and-limit-steps.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A row order can be looked at and never handed over. CAP-16 makes column order part of every export and nothing does the same for rows, so the owner's ordinary case — *take the 10 newest records and carry them on* — is inexpressible in all 23 stories: story 11 sorts the view transiently, and CAP-35's Top-N is a Dashboard Tile that cannot feed a Step.

**Approach:** Two Step kinds, `sort` and `first`, added the way 6b added Filter and Columns — a file each under `core/steps/`, one entry each in `kinds.js`, two new engine verbs behind the `TableEngine` port, and a branch each in the side panel. **The adapter installs its own row comparator instead of calling the engine's `orderby`**, because the engine's is measurably wrong around a box and wrong *differently* per browser. A new capability entry is added for row order as data; CAP-32's text stays as it is and the contradiction it now carries is recorded for story 11.

## Boundaries & Constraints

**Always:**

- **A box and a `null` are placed, never compared** (AD-19, AD-22). Both sort **last in both directions**, and the rows a box put there are counted and said out loud at that Step (C-10). Measured: comparing them instead reorders unrelated rows, `1 2 3 4 5 7 8 9 BOX 6` in Chromium against `1 2 7 8 9 BOX 3 4 5 6` in Firefox.
- **Text compares through `Intl.Collator('de-DE')`**, every other type relationally. `de-DE` is the locale `core/types/typing.js:175` already parses with; the engine's default puts `Äpfel` and `Öl` behind `Zebra`.
- **The order is stable and that is promised** — ties keep input order, measured identical in all three engines. Without it "the first 10" is not reproducible.
- **A Step kind never touches a cell** (AD-4). `core/steps/sort.js` and `core/steps/first.js` read `schema()` and hand the work to the engine, exactly as `filter.js` does.
- The empty configuration of both kinds is the **identity**: no keys, no count — every row through, in input order, so a freshly added Step never empties the chain being built (`filter.js:97-101`, `columns.js:21-31`).
- An entry that has not finished is not a change to the config (`StepPanel.vue:194-247`): a sort key with no column chosen and an empty count field are withheld, and the previous setting stays in force.
- Keyboard reachability and an `aria-label` on every new control (C-7); German lives in `ui/graph-labels.js` and `ui/StepPanel.vue` only (AD-13, NFR-6).
- No Table, row array or preview cell in `ref`/`reactive`/`computed` (AD-6).

**Ask First:**

- Any change to `core/steps/filter.js`, `core/steps/columns.js`, or the two engine verbs 6b shipped.
- Making a sort key carry anything beyond a column and a direction (a locale switch, a numeric-collation flag, a custom null placement).

**Never:**

- No promotion of the view's sorting into a Step (decided 2026-08-04) — story 11's header click stays looking, the Step is added by hand.
- No `orderby`, no `slice` and no `reify()` of a full table: the comparator goes on through `create({ order })` and the limit through a `BitSet`, so the columns stay shared.
- ~~No "letzte N" — descending plus *Erste N* is the same thing, and a second verb would be a second thing to explain.~~ **Renegotiated by the project owner on 2026-08-04, after the story shipped:** the other end is a flag on the same Step, not a second kind. See the change-log entry below.
- No upper bound on N and no threshold that hides a control: both would be invented constants.
- No sorting by a computed expression, no multi-locale option, no numeric collation (`Kunde 10` before `Kunde 9` stays as the collator has it).
- No change to CAP-32's own text, and no work on story 11.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sort, one key | `{keys:[{column:'Betrag',direction:'desc'}]}` over 10 rows | rows descending by Betrag; row count unchanged | N/A |
| Box in the key column | one unreadable Betrag | that row is last in both directions; a warning names how many | `step.boxed_rows_last` |
| Empty cells in the key column | two `null` Betrag | both last in both directions, after every real value | N/A |
| German text key | `Äpfel`, `Apfel`, `Zebra`, `Öl` ascending | `Apfel, Äpfel, Öl, Zebra` | N/A |
| Two keys | `[{Gruppe,asc},{Betrag,desc}]` | Gruppe ascending, ties by Betrag descending | N/A |
| Ties | equal key values | input order survives | N/A |
| Sort key column gone | config names a column the input no longer has | no table; the Steps downstream report their missing input | `step.unknown_column` |
| Same column twice | `[{Betrag,asc},{Betrag,desc}]` | refused at configure time; the previous config stays in force | `step.sort_key_repeated` |
| No keys | `{keys:[]}` — a freshly added Step | the input handle unchanged, no diagnostics | N/A |
| First N | `{count:3}` over 10 rows | the first 3 rows in current order; `3 Zeilen übrig` | `step.rows_removed` |
| N ≥ row count | `{count:1000}` over 10 rows | all 10 rows; „Keine Zeile entfernt" | `step.rows_removed` |
| No count yet | `{count:null}` | the input handle unchanged, no diagnostics | N/A |
| N is not a count | `0`, `-1`, `2.5` from a loaded Recipe | refused; previous config in force | `step.config_invalid` |
| Count field cleared | user empties the number input | nothing emitted; the stored count keeps computing | the panel says the previous setting stays in force |
| Sort → First N | Sortieren desc, then Erste 3 | the three largest, in order | N/A |

</frozen-after-approval>

## Code Map

- `core/graph/kinds.js:27-43` — the seven codes and the `KINDS` list. Two records join it, `minInputs: 1, maxInputs: 1, addable: true`. The file's own header calls widening this an Ask First: the widening **is** this story.
- `core/steps/index.js:24-33` — `REGISTRY`, the second table beside `kinds.js`. Two entries; `executorGaps()` then answers four instead of six and `steps.test.js:47-57` asserts exactly that list.
- `core/steps/codes.js:14-27` — `CODE`. Two additions: `sortKeyRepeated` (configure time, beside `renameCollision`) and `boxedRowsLast` (execution). `rows_removed` is **reused** by First-N — its German already reads „N Zeilen entfernt, M übrig."
- `core/steps/filter.js` — the template for `sort.js`: `OPERATORS`/`COMBINES` as closed exported vocabularies (`:43-62`), `validate` as shape-only (`:113-145`), `apply` collecting every refusal before evaluating any (`:157-184`), engine counts turned into Diagnostics (`:202-209`). `DIRECTIONS = ['asc','desc']` follows `COMBINES` exactly.
- `core/steps/columns.js:91-110` — the template for `first.js`: identity returns the **input handle itself**, and an unknown column is an error with no table.
- `ports/index.js:104-170` — the `TableEngine` typedef. `orderRows` and `firstRows` are documented here in the same voice, next to `filter`'s `{table, removed, boxed, unreadable}` contract.
- `adapters/arquero/engine.js:115-123` — `Unparsed` and `unbox`, the box's only home. `:196-207` `rows()` already honours `isOrdered()` through `indices()`, and `:213-223` `column()` reads through `t.array()`, which does too — **the handle needs no change for either verb**.
- `adapters/arquero/engine.js:524-635` — `filter`, the verb both new ones are modelled on: `behind(table)`, the `BitSet` over `totalRows()`, `t.create({filter})` sharing columns, counts returned rather than Diagnostics minted. `:652-668` `selectColumns` shows `wrap(t.create(...), types)` with a fresh type map.
- `adapters/arquero/engine.js:380-421` — `isEmptyCell` and `matches`, where "a `null` matches no ordering operator" is already stated. Ordering needs the neighbouring rule, not the same one.
- `_bmad-output/planning-artifacts/spikes/arquero-order-2026-08-04/findings.md` — the measurements this story rests on, and `probe.mjs` is the comparator shape in ~15 lines.
- `ui/graph-labels.js:30-40` `KIND` (two German words), `:89-130` the operator/combine maps plus `operatorLabelGaps()` — `DIRECTION` and its gap function follow that pattern —, `:209-244` the Step sentences the two new codes join.
- `ui/StepPanel.vue:112-161` `readDraft` (a branch per kind), `:216-247` `configOf`/`commit` — the single place a draft is withheld —, `:517-662` the Filter branch as the markup model for a repeatable row list, `:663-783` the Columns branch. `:99` `numberRefusals` is the precedent for a local refusal on a number field.
- `ui/EditorPane.vue:351-364` — the toolbar builds itself from `addableKindLabels()`, so both kinds appear with no edit here.
- `core/steps/steps.test.js:47-57` (the registry list), `:69-117` (config validation), `:118+` (execution) — where the new `describe` blocks go.
- `adapters/arquero/engine.test.js:214-401` `describe('filter')` — the fixture style, including how a boxed value is set up from outside.
- `ui/StepPanel.test.js:74` `entries()` and the `field()` helper; `tests/e2e/execution.spec.js:26-58` the inline-CSV fixture and locators, `:44-51` `REPORT` — nine clean rows plus one with an unreadable value in each typed column, which is exactly the fixture a sort needs.
- `_bmad-output/specs/spec-querbeet/SPEC.md:100-119` — CAP-16 and CAP-19; the new capability goes after CAP-16 as **CAP-40** (CAP-39 is the highest in use). `:174-177` CAP-32, whose text is not touched.

## Tasks & Acceptance

**Execution:**

- [x] `_bmad-output/specs/spec-querbeet/SPEC.md` -- add **CAP-40 — Order rows and keep the first N**, intent and success in the file's voice, after CAP-16; add one line to CAP-32's entry recording that its filter promotion contradicts the no-promotion rule and that story 11 settles it -- the capability set is what the story was missing, and the contradiction must be findable from CAP-32 itself
- [x] `core/graph/kinds.js` -- `SORT` and `FIRST` codes and their two `KINDS` records -- arity is a property of the kind, and the toolbar reads this list
- [x] `core/steps/sort.js` -- `DIRECTIONS`, `defaultConfig`, `validate` (shape, direction vocabulary, repeated column), `apply` (unknown column, identity, engine call, box warning) -- the Step kind that makes a row order data
- [x] `core/steps/first.js` -- `defaultConfig` (`count: null`), `validate` (null or an integer ≥ 1), `apply` (identity, engine call, `rows_removed`) -- one verb, so it composes with the sort rather than absorbing it
- [x] `core/steps/index.js` and `core/steps/codes.js` -- register both kinds; add `sortKeyRepeated` and `boxedRowsLast` -- `executorGaps()` and the label completeness test both read these
- [x] `ports/index.js` -- document `orderRows(table, keys) => { table, boxed }` and `firstRows(table, count) => { table, removed }` on the `TableEngine` typedef, including the placement rule and the collator -- the port is where a contract is stated, not the adapter
- [x] `adapters/arquero/engine.js` -- both verbs: a comparator per key installed through `create({ order })`, box and `null` ranked last in both directions and counted, `Intl.Collator('de-DE')` for `text` columns and relational comparison otherwise, and a `BitSet` over the ordered indices for the limit -- AD-19: the hazard is absorbed here or it is everywhere
- [x] `ui/graph-labels.js` -- „Sortieren" and „Erste N"; a `DIRECTION` map with `directionLabels()`/`directionLabelGaps()`; German for both new codes -- a raw `asc` in a select is the core talking to the user
- [x] `ui/StepPanel.vue` -- a Sort branch (a removable row per key: column select, direction select) and a First-N branch (one number field), both through the existing `readDraft`/`configOf`/`commit` path, with the withholding rules and the sentence naming where empty and unreadable values land -- one draft path, so no control can reach the model around it
- [x] `adapters/arquero/engine.test.js` -- `orderRows` and `firstRows`: placement, collation, stability, multiple keys, `BigInt` temporal, counts, shared columns, and the throw for an unknown column -- the box is asserted from outside, as the file already does
- [x] `core/steps/steps.test.js` and `ui/StepPanel.test.js` -- every I/O matrix row that is a kind's or a form's, plus the updated `executorGaps()` list and empty `directionLabelGaps()` -- the matrix is where the coverage comes from
- [x] `tests/e2e/execution.spec.js` -- one case over `REPORT`: Sortieren by Betrag descending, then Erste 3, and the unreadable row asserted last rather than dropped -- the owner's case, end to end in both engines

**Acceptance Criteria:**

- Given a Source whose Betrag column holds one unreadable value, when a Sort Step orders by it ascending and then descending, then the readable values are in full order in both directions, the unreadable row is last in both, and the Step names how many rows that was.
- Given a Sort Step followed by an Erste-N Step, when the pipeline runs, then the Result carries exactly N rows in the sorted order and every Step's preview shows its own full row count (CAP-19).
- Given a graph containing a Sort Step, when a Recipe-shaped config with a repeated sort column arrives, then the command is refused with a German sentence naming the column and the previous configuration goes on computing.
- Given both new forms, when they are traversed by keyboard alone, then every control is reachable and named, and no German string exists outside `ui/` (C-7, NFR-6, AD-13).
- Given `npm run verify`, when it runs, then lint, both Vitest projects and Playwright in Chromium and Firefox are green.

## Spec Change Log

**2026-08-04 — six decisions taken during implementation, none renegotiating the frozen sections.** Recorded here because each is a choice the spec left open and each is visible in the product.

1. **Where the two kinds sit in `KINDS`.** Beside `columns`, not appended after `aggregate` — the list has followed the capability order since it was cut, and CAP-40 is written after CAP-16. It decides the toolbar order (`… Filter · Spalten · Sortieren · Erste N · Berechnete Spalte · Aggregation`) and is asserted in `core/graph/graph.test.js`. `executorGaps()` is unaffected either way.
2. **A Sort's incomplete key refuses with `field: 'key'`, not `field: 'column'`.** A Filter's condition and a Sort's key share `step.config_invalid` and `at` alone cannot tell them apart, so the field is what lets `ui/` say „Sortierung 2 ist unvollständig" rather than the Filter's „Bedingung 2". The field itself never reaches the screen (NFR-6) — a test asserts that too.
3. **What `boxed` counts.** Rows carrying a box in **at least one** key column, counted over the rows actually in the table rather than the backing array. Not one count per box (a row with two unreadable keys is one row) and not "the box decided the position" (under two keys a box in the second only moves the row within its group). The German is worded „hinter die lesbaren Werte gestellt" rather than „ganz am Ende" for exactly that reason: a sentence true of one key and false of two is the kind of number this product must not print.
4. **The Sort form never offers a column another key already uses.** A second key on one column can only be refused, and a control whose sole outcome is a refusal should not exist. So `step.sort_key_repeated` is a **loaded-Recipe** refusal in practice; it is pinned at unit level and its German is asserted in `ui/StepCard.test.js`, the way CAP-15's type disagreement already is.
5. **„Erste N" is exempt from the "input has no columns" guard.** It is the one kind whose form names no column, so a count is still meaningful over a table that has only rows.
6. **The count field parses with `Number()`, not `germanNumber`.** A row count is a small whole number, `type="number"` already keeps a decimal comma out, and `germanNumber` would read `1.000` as one thousand in a control the browser renders as `1000`. `0`, `-1` and `2.5` are a local refusal beside the field — `numberRefusals`' precedent — and never reach the model.

**2026-08-04 — nine review findings, all patch-level against contracts this spec and the port already state.** No frozen section changed.

| # | What was false | Where it is fixed |
| --- | --- | --- |
| P1 | A second Sort **discarded** the first one's order among its ties instead of refining it — `indices()` rebuilds its index in ascending backing row order — so "ties keep input order" was false of a chain, which is an ordinary build (*by customer, and within that newest first*). | `engine.js` captures `t.comparator()` and chains it as the final tie-break; asserted in `engine.test.js` and `steps.test.js`, both of which fail without it. |
| P2 | The placement rule used a narrower "empty" than the product's own: `''` and a whitespace-only string sorted to the **front** of an ascending `text` order, contradicting the Sort form's sentence. Reachable by removing „(leer)" from a column's missing tokens. | `unordered` now composes `isEmptyCell`, the one definition CAP-15 and the Filter already use. |
| P3 | `NaN` made the comparator inconsistent again, and nothing said the guarantee rested on the converter boxing unreadable numbers. | `NaN` joins the unordered set, with the dependency named rather than implied. |
| P4 | `orderRows(table, [])` **reset** an existing order (`a b c` came back `c a b`) and scanned every row to count nothing. | The identity returns the input handle before anything runs; the existing test now starts from an ordered input, which is the only way it could see this. |
| P5 | The performance claim quoted one row of the spike's own table. The **relational** comparator is cheaper than `orderby` (57.8 vs 83.8 ms); the **collated** one, which every `text` column gets, is ~2.5× the engine's (213.9 / 224 against 83.9 / 148). | Corrected in all three places — `engine.js`, these Design Notes, and the spike's `findings.md`, whose summary sentence excluded its own collated row. |
| P6 | Stability was grounded in ES2019's `Array.prototype.sort` clause, which does not cover the `%TypedArray%.prototype.sort` that actually runs. | `engine.js`, `ports/index.js` and `findings.md` now rest the promise on the three-engine measurement and name the method called. |
| P7 | A key naming a column an upstream rename removed showed a **different** column than the config held, and editing the direction committed the invisible one. | `sortColumnOptions` always includes the key's own column. |
| P8 | `validate` returned early on a bad direction, so a repeated column stayed invisible until the direction was fixed — fixing one defect produced a "new" refusal. And `field: 'direction'` read „unvollständig" over an entry that is complete and wrong. | The column is registered before the direction is judged; `direction` gets its own German sentence. |
| P9 | The comparator sketch below showed `return 0` where the implementation uses `continue`, contradicting the paragraph under it. | Sketch corrected, and extended with the tie-break P1 added. |

**2026-08-04 — the owner renegotiated one `Never`, after the story was done and committed.** „Letzte N" is now a flag on the First-N Step rather than a forbidden second verb.

- **What changed in the reasoning.** The original line — descending plus *Erste N* is the same thing — is true of the *rows* and false of the *work*: reaching the other end by reversing the order means editing the Step **upstream**, which is a different Step than the one the user is looking at, and it turns everything downstream of that Sort around too. A flag costs one word in one form.
- **The shape.** `ENDS = ['first','last']` closed in `core/steps/first.js` beside `DIRECTIONS`' precedent; `defaultConfig()` writes `end: 'first'` out, so a stored config never relies on a reader's default, and an absent `end` still means the first N — every config written before the flag keeps meaning what it meant. The port takes `firstRows(table, count, end)` and throws on an unknown end rather than defaulting, for the reason a direction does: a silent default hands back the opposite rows with nothing to say so.
- **Both ends are one window on one order, and `last` is not a reversal.** The kept rows come out in the order they were already in, so the last two of an ascending order are the two largest *ascending* — not what a descending sort would have put first.
- **The kind's German name changed to „Erste/Letzte N".** A card reading „Erste N" while the Step is set to „Letzte 10" would be the one place the graph lies about itself.
- **A new warning, `step.boxed_rows_kept`.** Every order this product produces places empty and unreadable values last, so *Letzte 3* after a sort is quite likely three rows querbeet could not read. Reported rather than refused — inspecting exactly those rows is a real reason to ask for them (C-10) — and counted over the **kept** rows and every column of them, because a limit knows nothing about sort keys. It costs `count × columns` and never a pass over the table.

## Design Notes

**Why the adapter owns the comparator.** `orderby` is one call and it was measured wrong: with a single box among ten values, Chromium and Node produce `1 2 3 4 5 7 8 9 BOX 6` and Firefox produces `1 2 7 8 9 BOX 3 4 5 6`. A box compares `false` in both directions, which makes the comparator inconsistent, and the result of sorting with an inconsistent comparator is implementation-defined. `create({ order })` — the door `orderby` itself reduces to — takes a row comparator, so installing our own costs nothing structurally.

**What it costs, in full rather than in its flattering half** (corrected 2026-08-04, review P5). The **relational** comparator is cheaper than the engine's — 57.8 ms against 83.8 ms per 100k rows in Chromium — because it reads a column captured once instead of going through the expression machinery per row. The **collated** one, which every `text` column gets, is the most expensive option in the spike's table: 213.9 ms Chromium / 224 ms Firefox against `orderby`'s 83.9 / 148, about 2.5× the engine's. So correctness is free on numbers and temporals and costs roughly 130 ms per 100k rows on text, and that is what a German order is worth — the alternative is `Äpfel` and `Öl` behind `Zebra`. The earlier claim that the comparator is simply "also faster" quoted one row of a table whose other row says the opposite.

The comparator, in the shape the adapter implements (the spike's own sketch returned `0` for two unordered values, which is right for one key and wrong for two — the paragraph below is what `continue` buys):

```js
const rank = (v) => (isEmptyCell(v) || v instanceof Unparsed || Number.isNaN(v) ? 1 : 0)
const order = (a, b, data) => {       // a, b are backing row indices
  for (const { column, sign, compare } of keys) {
    const x = column.at(a), y = column.at(b)
    if (rank(x) !== rank(y)) return rank(x) - rank(y)  // unordered values last…
    if (rank(x) === 1) continue                        // …and equal on *this* key
    const c = compare(x, y)           // collator for text, `<`/`>` otherwise
    if (c !== 0) return sign * c
  }
  return incoming ? incoming(a, b, data) : 0           // the order already in force
}
```

Several keys chain the same function: the first key that returns non-zero decides. The unordered-last rule is applied **per key**, so a row with an empty first key sits behind every row that has one, and its second key still orders it against its equals. And when every key is spent, **the order already on the input decides** — `indices()` rebuilds its index in backing row order before sorting, so without that last line a second Sort would discard the first one's order among its ties rather than refine it, and *by customer, and within that newest first* is two Steps a user builds from the toolbar.

**Why `boxed` is counted and empties are not.** An empty cell is data — the user can see it in the preview and it lands where the form says it lands. A box is a value the product could not read under a type the user confirmed, and CAP-9's remainder says those never disappear quietly. So the box count travels as a warning at the Step, in the shape `filter.js:207` already established, and the empty-value rule is a static sentence in the form rather than a diagnostic about nothing.

**Why the limit is a `BitSet` and not `slice`.** The engine's `slice` ends in `reify(indices)`, which materializes every column — at 50,000 kept rows that is a full copy of the data. A `BitSet` over the first N ordered indices costs ~12.5 kB at the NFR-3 shape and keeps the columns shared, which is the rule the Filter already follows and the reason a chain of Steps costs ~0.0 MB. Measured: 0.8 ms for the first 50,000 of 100,000 rows, and the ordered table's own order survives into the limited one.

**Why `count: null` rather than a number.** A freshly added Step must not empty the pipeline being built, so the default is the identity — the same decision `columns.js` makes for `[]` and `filter.js` for no conditions. `null` says "no limit set" where `0` would have to mean either "no rows" or "not set", and only one of those can be true.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green; `executorGaps()` answers `['union','join','computed','aggregate']`
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()`, `kindLabelGaps()`, `operatorLabelGaps()` and `directionLabelGaps()` all return `[]`
- `npm run build && npm run assert` -- expected: one HTML file, structural gate green
- `npm run verify` -- expected: lint, both Vitest projects and Playwright in Chromium and Firefox green
- `node _bmad-output/planning-artifacts/spikes/arquero-order-2026-08-04/run-spike.mjs` -- expected: unchanged findings; run only if the ordering behaviour is in doubt

## Suggested Review Order

**The comparator, which is the whole story**

- Entry point: what has no place in an ordering — one definition, shared with the Filter.
  [`engine.js:473`](../../adapters/arquero/engine.js#L473)

- The comparator itself: placement before direction, per key, ties last.
  [`engine.js:864`](../../adapters/arquero/engine.js#L864)

- The line the review added: an order already in force is refined, not replaced.
  [`engine.js:844`](../../adapters/arquero/engine.js#L844)

- No key is the identity — before the counting pass, so it costs nothing and destroys nothing.
  [`engine.js:787`](../../adapters/arquero/engine.js#L787)

- German collation, built once; the trade it costs is named rather than smoothed.
  [`engine.js:498`](../../adapters/arquero/engine.js#L498)

- The limit is a mask over the ordered indices, so the columns stay shared.
  [`engine.js:897`](../../adapters/arquero/engine.js#L897)

**What the contract now promises**

- Placement, collation and stability stated where a caller reads them.
  [`index.js:171`](../../ports/index.js#L171)

- Why "input order" includes an order the input table already carried.
  [`index.js:204`](../../ports/index.js#L204)

**The two Step kinds**

- The vocabulary is a select and a select — no third direction, no expression.
  [`sort.js:51`](../../core/steps/sort.js#L51)

- Refusals collected in one pass: a bad direction no longer hides a repeated column.
  [`sort.js:84`](../../core/steps/sort.js#L84)

- A Sort removes nothing, so the only thing said out loud is what a person could not see.
  [`sort.js:135`](../../core/steps/sort.js#L135)

- `null` is "no limit", not "no rows" — the distinction the validator rests on.
  [`first.js:42`](../../core/steps/first.js#L42)

- One reused code: a limit that took nothing away reads „Keine Zeile entfernt".
  [`first.js:71`](../../core/steps/first.js#L71)

- Two records, and the arity is the kind's property rather than a rule checked later.
  [`kinds.js:32`](../../core/graph/kinds.js#L32)

**The German, and the forms**

- Direction labels with their own gap function — a raw `asc` in a select is the core talking.
  [`graph-labels.js:144`](../../ui/graph-labels.js#L144)

- A repeated key names the column the user chose, not the position.
  [`graph-labels.js:280`](../../ui/graph-labels.js#L280)

- The select always offers the key's own column, so the screen cannot show one the config does not hold.
  [`StepPanel.vue:491`](../../ui/StepPanel.vue#L491)

- The sentence that has to stay true: empty and unreadable values sit behind the rest.
  [`StepPanel.vue:923`](../../ui/StepPanel.vue#L923)

- The count field withholds like an unfinished Filter condition rather than clearing the config.
  [`StepPanel.vue:1016`](../../ui/StepPanel.vue#L1016)

**Tests**

- The box placed rather than compared — the case the whole verb exists for.
  [`engine.test.js:494`](../../adapters/arquero/engine.test.js#L494)

- Chained sorts: the second refines the first, and it fails without the tie-break line.
  [`engine.test.js:700`](../../adapters/arquero/engine.test.js#L700)

- The same property one layer out, through two `sort.apply` calls.
  [`steps.test.js:570`](../../core/steps/steps.test.js#L570)

- The limit reads the order in force rather than the file's.
  [`engine.test.js:774`](../../adapters/arquero/engine.test.js#L774)

- The owner's case end to end: descending, then the first three, unreadable row last.
  [`execution.spec.js:213`](../../tests/e2e/execution.spec.js#L213)

**The capability set**

- CAP-40, the entry the story existed to add.
  [`SPEC.md:104`](../../_bmad-output/specs/spec-querbeet/SPEC.md#L104)

- CAP-32's recorded contradiction, left for story 11 rather than settled here.
  [`SPEC.md:181`](../../_bmad-output/specs/spec-querbeet/SPEC.md#L181)

**Added after the story shipped — the limit's other end**

- The vocabulary, closed beside the Sort's directions.
  [`first.js:38`](../../core/steps/first.js#L38)

- The window is placed from one end or the other; the order itself is never reversed.
  [`engine.js:912`](../../adapters/arquero/engine.js#L912)

- Counted over the rows that stayed — the end of an order is where the unreadable ones sit.
  [`first.js:124`](../../core/steps/first.js#L124)

- The select commits through the same path as every other control, so an end with no count is withheld.
  [`StepPanel.vue:527`](../../ui/StepPanel.vue#L527)
