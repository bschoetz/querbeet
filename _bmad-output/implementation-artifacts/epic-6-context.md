# Epic 6 Context: Execution — the typed Table and the first pipeline that runs

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 6 turns the graph the Editor draws into something that actually computes. It introduces the engine port and its adapter, applies the confirmed type mapping on the way into a Table, runs a linear pipeline end to end with the first two Step kinds, and shows each Step's own output with its counts and warnings. It also carries the follow-up work that the first hand test of that skeleton exposed: the Columns form at the column count a real report has, a row order that is data rather than a view, and node placement derived from measured cards. **This epic has no declared title or goal in the source material — both are derived from what stories 6a–6e have in common.** Two further facts about the set: story 6 was split by the project owner into 6a (engine, conversion, no execution) and 6b (execution over the Table 6a produces); 6c, 6d and 6e are stubs cut from the 6b hand test and review, and 6d additionally needs a new capability entry before it is buildable as specified.

## Stories

- Story 6a: The typed Table — engine adapter, conversion, and the values that did not read
- Story 6b: Execution walking skeleton — Filter and Columns Steps, and the per-Step preview
- Story 6c: The Columns Step at the width a report actually has
- Story 6d: Sort and First-N Steps — a row order that is data
- Story 6e: Node layout from measured cards, not from a constant

## Requirements & Constraints

- **Nothing is typed (C-9).** No formula, expression or query anywhere in the Step vocabulary. Every Step config is a plain data structure a language model can emit and a validator can check.
- **Make the silent failures visible (C-10).** The characteristic failure of this product is a plausible wrong number, not an error message. Every hazard measured in the underlying libraries must surface at the Step that caused it.
- **Scale (C-3).** ~100,000 rows per Source, ~500,000 in total, interactive throughout. The full Arquero pipeline was measured at 263 ms (Chromium) / 446 ms (Firefox) at 100k rows; the worst editing case is the earliest edit in a long graph, 578.6 / 1,156 ms.
- **Keyboard reachability (C-7).** No interaction may exist only as a pointer gesture. Drag is fine when it computes a target and updates the model.
- **German UI, English code and docs (C-6).**
- **Filtering (CAP-15).** Operators: equals, not equals, contains, greater/less than, is empty, is not empty. Multiple conditions with an explicit all/any rule. Comparison respects the column's confirmed type; a comparison value whose type disagrees is **refused naming both types**, never coerced. Values are stored in canonical machine form only — a number is a number, a date is an ISO 8601 string, never a display form. The Step reports how many rows it removed.
- **Columns (CAP-16).** Select, rename, reorder. A rename onto an existing name is refused with a named reason. The Step's column order is the output order and, at the Result Step, the export order.
- **Per-Step preview (CAP-19).** Every Step's output is previewable with the row and column count of the *full* output, and that Step's warnings sit alongside the preview rather than appearing only during execution. Changing a config updates that Step's preview and everything downstream.
- **The CAP-9 remainder.** Values that fail to parse under the confirmed type are never silently nulled: they stay inspectable in their original form, so the "842 of 900 readable" count must lead to the rows behind it.

## Technical Decisions

- **AD-19 — the engine sits behind a port.** `ports/TableEngine` defines what Steps need; `adapters/arquero/` implements it against a pinned, vendored Arquero 8.0.3. **The adapter absorbs the measured hazards; Step kinds never do.**
- **AD-4 / AD-2 — a Step is `(engine, inputs, config) => { table, diagnostics }`,** pure and synchronous, no I/O, clock, randomness or input mutation. `core/` imports no Vue and touches no browser object.
- **AD-5 — a Table handle crosses Step boundaries,** behind querbeet's own narrow interface (`rows()`, `rowCount()`, `schema()`, `column(name)`). `rows()` materializes only at real edges: preview, export, session store, worker transfer.
- **AD-6 — data never enters the graph model or reactive state.** Tables live in a plain `Map` registry keyed by Source/Step id; `ui/` holds them only via `shallowRef`.
- **AD-22 — an unparsed value is a box carrying its original text,** held in the cell so it survives joins and aggregates. The adapter is the single place that knows the box: comparison never matches one, aggregation skips and counts it, export writes the original text.
- **AD-21 — one temporal unit inside a Table:** epoch nanoseconds as a `BigInt` for all four temporal types (date = UTC midnight). No `Date` object with an implicit zone crosses a boundary. `BigInt` does not mix with `Number` in arithmetic — the adapter carries that.
- **Where the converted copy lives is an open architecture question this epic must close.** AD-7 requires the registry to keep the raw parsed table (the preview renders it, the damage report reads it), while the performance research rules that the parsed row array be dropped once `aq.from()` has run — holding both costs 110.8 MB per Source against 80.2 MB, and five simultaneous Sources measured 552.6 MB. Decide it against the measurement.
- **Two adjacent measured rules from the same research:** `reify()` after a selective filter and release the parent (80.2 MB → 0.7 MB); read the render window with a limit/offset accessor (0.3–1 ms at any position).
- **Test envelopes (AD-18).** `core/`, `ports/`, `adapters/` run under Vitest with **no browser** — a core test needing a DOM means AD-2 broke. `ui/` runs under happy-dom, where `ResizeObserver` and `getBoundingClientRect` are unimplemented stubs, so anything needing real geometry goes to Playwright component testing.
- **Layout must come from measured dimensions, not a constant.** `core/graph/` is browser-free by AD-2, so it can only place nodes from numbers handed to it; a reflow pass belongs in `ui/` or the editor adapter.

## UX & Interaction Patterns

- **The Editor is deliberately entered**, three panes (Sources, Pipeline, Result), and a Step tile whose **height grows with its content** — which is exactly why fixed vertical pitch is unsafe.
- **An unfinished edit is not a change to the config.** An incomplete Filter condition is withheld today; the same rule governs an empty column selection, which keeps a zero-column table out of the model and keeps the empty list meaning identity.
- **The Columns form must scale to report width.** A flat list whose only verbs are check/type/move-by-one costs O(n) clicks at 30 columns. Bulk select/deselect, positions that survive deselection, and a search that filters visibility only — the list order *is* the config order, so finding a column may never reorder it.
- **"Is empty" is the one operator where user intuition and database semantics differ** (null, empty string and whitespace alike), so the interface states which it means.
- **Viewing and transformation stay separated** — decided 2026-08-04. A header click sorts the view and is never promoted into a Step; a Sort Step is added by hand. This contradicts CAP-32 as written, which promises promotion of view filters into a Filter Step; that conflict needs resolving with story 11.
- **No Editor-versus-table contention was found:** a 50-row window swap costs 2.9–3.1 / 4–5 ms identically at 6 and 30 Steps, so live preview need not defend the canvas frame rate.

## Cross-Story Dependencies

- **6a → 6b.** 6a executes nothing; the engine adapter and the conversion must exist before the skeleton can run. Neither is reopened in 6b.
- **6b → 6c.** 6c is pure UI repair of the Columns form 6b shipped; `core/` and `ports/` are untouched.
- **6b → 6e.** 6b raised the node pitch by arithmetic over today's tallest card, not by measurement; 6e replaces that and unblocks putting run diagnostics back onto the cards.
- **Story 3 → 6a.** Story 3 settles what a column *is* and deliberately holds only raw text; applying the confirmed mapping lands here.
- **Story 5 → 6b.** The graph model, named commands and the cycle guard are prerequisites. One story-5 allowance waits on 6b to decide it: a Union consuming the same Source in two slots duplicates every row once a pipeline executes.
- **6d → story 11 and the capability set.** 6d needs a new capability entry (CAP-32 covers the view only, CAP-35's Top-N is a Dashboard Tile that cannot feed a Step) and its no-promotion rule must be reconciled with story 11.
- **6a/6b → story 7.** Cache, cancellation and the live/explicit mode switch build directly on this execution path.
- Several ledger entries in `deferred-work.md` are assigned to this epic: the conversion overflow and large-integer cases, the ISO date shapes, the Union duplication question, and the node-placement measurements.
