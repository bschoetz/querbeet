# Stub — Sort Step and First-N Step

**Status:** CLOSED 2026-08-04 — story 6d was cut from this stub and shipped. Every open point below is answered; the answers are kept here beside the questions rather than only in the spec, because this file is what a later reader finds first. The story is `spec-6d-sort-and-first-n.md`, the measurements are in `../planning-artifacts/spikes/arquero-order-2026-08-04/`.
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

## What was built

Two Step kinds, `sort` and `first`, plus **CAP-40** in the capability set — the entry this stub said was missing. The row order travels in the Recipe and reaches the export, which is what CAP-16 already promised for column order.

## Consequence that needs a separate answer

**Still open, and now recorded where it will be met.** CAP-32's own entry in `SPEC.md` carries the contradiction with a pointer to story 11; the text of CAP-32 itself is deliberately unchanged until story 11 settles it.

The rule just stated — viewing and transformation stay separate — **contradicts CAP-32 as written**, which already promises the opposite for filters: *"A single action converts the active view filters into a Filter Step inserted before the Result Step, after which they are data and are stored in the Recipe."* So either the rule is about sorting specifically, or CAP-32's filter promotion goes too. Not decided here; flagged because the decision above implies it and story 11 will trip over it otherwise.

## Answered before the story was cut, and where

Measured in Node, Chromium and Firefox — `../planning-artifacts/spikes/arquero-order-2026-08-04/findings.md`:

- **Cost and shape in Arquero.** `orderby` is not used at all. Its comparator was measured returning `1 2 3 4 5 7 8 9 BOX 6` in Chromium and `1 2 7 8 9 BOX 3 4 5 6` in Firefox from the same ten values — a box compares `false` in both directions, which makes the comparator inconsistent, and the result of an inconsistent sort is implementation-defined. The adapter installs its own comparator through `create({ order })` instead; it is also cheaper where the comparison is relational (57.8 ms against 83.8 ms per 100k rows in Chromium). Collated text is the expensive case at 213.9 / 224 ms, and that is what a correct German order costs. The limit is a `BitSet` over the ordered indices — 0.8 ms for the first 50,000 of 100,000 rows — never a `slice`, whose `reify` copies every column.
- **One column or several; ascending/descending per column.** Several, `[{column, direction}]`, decided by the project owner. The form never offers a column another key already uses, and a repeated column in a loaded config is refused naming it.
- **Where a box and a `null` sort.** Placed, never compared: **last in both directions**, per key, and the Sort reports how many rows a box put there. The rule uses the product's one definition of an empty cell (`null`, `''`, whitespace alike — CAP-15's), and `NaN` joins them.
- **Whether the sort is stable, and whether that is promised.** Stable, measured identical in all three engines, and promised in `ports/index.js` — an order already on the input is refined rather than replaced, so a second Sort breaks its ties by the first one's order. Without that, "the first N" is not reproducible.
- **Arity and slot rules, and the German labels.** Both kinds are `minInputs: 1, maxInputs: 1, addable: true`. „Sortieren" and „Erste/Letzte N".
- **Whether *Erste N* also offers "last N", and whether N is bounded.** Yes — asked for by the project owner on 2026-08-04, after the story had shipped, and built as a flag on the same Step (`ENDS = ['first','last']`) rather than a second kind: reaching the other end by reversing the order upstream edits a different Step and turns everything downstream of it around too. No upper bound on N — one would be an invented constant, and the honest limit is the row count, which the Step reports rather than refuses.
