# Stub — Sort Step and First-N Step

**Status:** stub. Decisions recorded, story not cut.
**Date:** 2026-08-04
**Origin:** hand test of the Editor after story 6b; finding 3, reading A in `findings-columns-step-ui-2026-08-04.md`.

## Why

A row order can be looked at today and never handed over. Story 11 / CAP-32 sorts the view, transiently — not stored in the Recipe, lost on reload. No Step in any of the 23 stories makes a row order part of the data, and `core/graph/kinds.js` has no sort kind: the seven are Source, Union, Join, Filter, Columns, Computed, Aggregate. CAP-16 makes **column** order part of every export; nothing does the same for **row** order.

The case that decided it, from the project owner: *take the 10 newest records and carry them on through the pipeline.* That is ordinary, and it is not expressible — not now and not in any planned story. Top-N exists only as a Dashboard **Tile** (CAP-35, story 21, "row limit" in the Tile form), which is a display: a Tile cannot feed another Step.

## Decided

- **A sort Step will exist.** A row order becomes data, travels in the Recipe, and reaches the export.
- **Two Steps, not one:** *Sortieren* (order by a column) and *Erste N* (keep the first N rows). Sorting alone only reorders; the owner's case needs both. Kept separate so each is one verb and they compose.
- **No promotion from the view into a Step.** Story 11's header-click sorting stays what it is — looking. A user who wants the order in the data adds the Step. Rationale, in the owner's words: *viewing and transformation must stay clearly separated.*
- **Story 11's view sorting is unchanged** by this and stays transient.

## Consequence that needs a separate answer

The rule just stated — viewing and transformation stay separate — **contradicts CAP-32 as written**, which already promises the opposite for filters: *"A single action converts the active view filters into a Filter Step inserted before the Result Step, after which they are data and are stored in the Recipe."* So either the rule is about sorting specifically, or CAP-32's filter promotion goes too. Not decided here; flagged because the decision above implies it and story 11 will trip over it otherwise.

## Not decided, and wanted before the story is cut

- Cost and shape in Arquero. `orderby` and `slice` are `ColumnTable` methods (the class the adapter already builds on, decided 2026-08-04) — but `orderby` materializes an index and both need measuring against C-3's 100k rows, the way the two existing verbs were.
- Sort by one column or several; ascending/descending per column.
- Where a box and a `null` sort. AD-22 says a comparison never matches a box — ordering is not a comparison in that sense, so this needs its own answer rather than an assumption.
- Whether the sort is stable, and whether that is promised.
- Arity and slot rules for both kinds (`minInputs`/`maxInputs` in `kinds.js`), and their German labels.
- Whether *Erste N* also offers "last N", and whether N is bounded.
