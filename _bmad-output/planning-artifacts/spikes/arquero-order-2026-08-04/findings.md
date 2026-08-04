# Spike: what a row order costs, and what the engine's own one means

**Date:** 2026-08-04 · **Answers:** the four measurable questions story 6d's stub left open
**Engines:** Node v26.5.1 (ICU 78.3), Chromium 151.0.7922.34, Firefox 153.0
**Apparatus:** `probe.mjs` — one measurement function run unchanged in every engine; `run-spike.mjs` — the runner, which inlines the probe with the product's own vite + singlefile build and loads it from `file://`; raw output in `measurements.json`

## The questions

`stub-sort-and-limit-steps.md` decided that a Sort Step and a First-N Step exist and left four things to measure first: what `orderby` and a limit cost against C-3's 100,000 rows, where a box (AD-22) and a `null` sort, whether the sort is stable, and — added here, because a German product sorts German words — what a locale-correct order costs against the engine's default.

## Cost, at 100,000 rows, median of three

| Operation | Node | Chromium | Firefox |
| --- | --- | --- | --- |
| the engine's `orderby`, number column | 98.1 | 83.8 | 216 |
| the engine's `orderby`, text column | 99.0 | 83.9 | 148 |
| **our own comparator**, number column | **73.2** | **57.8** | **92** |
| our own comparator, `BigInt` temporal column | 82.7 | 71.5 | 118 |
| our own comparator, text, code-unit | 119.2 | 96.9 | 168 |
| **our own comparator, text, `Intl.Collator('de-DE')`** | **258** | **213.9** | **224** |
| first 10 rows of an ordered table | 0.1 | 0.1 | 0 |
| first 50,000 rows of an ordered table | 0.8 | 0.8 | 0 |

All numbers are in milliseconds. `orderby` itself is free — it hangs a comparator on a new table and the cost is paid when `indices()` sorts, which is what these figures measure.

Two things follow. **A limit is not a cost:** it is a `BitSet` over the rows the order already produced, the columns stay shared, and 50,000 rows cost 0.8 ms. And **our own comparator is cheaper than the engine's wherever the comparison is relational** — a number, a boolean, a `BigInt` temporal — by 20–60 %: the engine's builds a key accessor per row through its expression machinery, ours reads a column it captured once.

**Corrected 2026-08-04.** The sentence above originally continued "so the correct comparator is also the fast one", which reads the number column's row of the table and skips the row directly below it. **Collated text is the most expensive option measured** — 213.9 ms in Chromium and 224 ms in Firefox, against `orderby`'s 83.9 / 148, about 2.5× the engine's — and it is the comparison *every* `text` column gets. So the trade is real and it is worth naming rather than smoothing: correctness is free on numbers and temporals and costs roughly 130 ms per 100,000 text rows, against an alternative in which `Äpfel` and `Öl` sort behind `Zebra`.

Against C-3: a Filter → Columns pipeline over 100k rows was measured at 263 ms (Chromium) / 446 ms (Firefox). A collated sort adds 214 / 224 ms to that, a numeric one 58 / 92 ms.

## The finding that decides the shape: the engine's comparator is wrong around a box, and wrong *differently* per engine

Ten rows, values `9 8 7 BOX 6 5 4 3 2 1`, sorted ascending by the engine's own `orderby`:

| Engine | Result |
| --- | --- |
| Node | `1 2 3 4 5 7 8 9 BOX 6` |
| Chromium | `1 2 3 4 5 7 8 9 BOX 6` |
| Firefox | `1 2 7 8 9 BOX 3 4 5 6` |

The 6 is not merely misplaced — **rows that have nothing to do with the box lose their order too**, and which ones depends on the engine. A box compares `false` in both directions, so the comparator is inconsistent, and a sort over an inconsistent comparator is implementation-defined. This is C-10's failure mode exactly: no error, no warning, a plausible order, a different wrong answer in the two browsers the product ships in.

With the box placed rather than compared, all three engines agree, in both directions:

- ascending `1 2 3 4 5 6 7 8 9 BOX`
- descending `9 8 7 6 5 4 3 2 1 BOX`

Same for `null`: the engine sorts it to the front ascending (`null null 1 2 3`), because `null < 1` is `true` in JavaScript — the same accident `core/steps/filter.js` already guards for comparisons. Placed instead: `1 2 3 null null` ascending and `3 2 1 null null` descending.

## Collation: the default order is visibly wrong in German

The same eight words, ascending:

- code-unit (the engine's default): `Apfel | Osten | Strasse | Straße | Zebra | apfel | Äpfel | Öl`
- `Intl.Collator('de-DE')`: `apfel | Apfel | Äpfel | Öl | Osten | Strasse | Straße | Zebra`

Umlauts after `Z`, lowercase after uppercase. All three engines agree on both orders, so the collator is not an engine lottery — `de-DE` is already the locale `core/types/typing.js` parses numbers and month names with.

## Stability

`a1 a3 a5 b0 b2 b4` — ties keep their input order, in all three engines.

**The promise rests on that measurement and not on the clause usually quoted** (corrected 2026-08-04). ES2019's stability requirement is about `Array.prototype.sort`; the engine sorts a plain `Uint32Array` of row indices, which goes through `%TypedArray%.prototype.sort` instead. The three-engine measurement is what makes "the first 10" reproducible, and it is what should be re-run if a stability question ever comes up again.

One thing the spike did **not** measure and the story had to fix: `indices()` rebuilds its index in ascending *backing* row order before sorting it, so a second `create({ order })` over an already ordered table replaces the first order among its ties rather than refining it. The adapter therefore captures `table.comparator()` and chains it on as the final tie-break.

## Composition

A limit over an ordered table keeps the order (`isOrdered` stays true), reports the row count it kept, and a second limit over the first works. So *Sortieren* → *Erste N* is two ordinary Steps and not a special case.

## What this leaves for the story

- The adapter installs its own comparator through `create({ order })` rather than calling `orderby`. That is where AD-19's rule lands: the box is absorbed here, and no Step kind ever sees one.
- A box and a `null` are **placed last in both directions** and counted, rather than compared.
- Text is compared with `Intl.Collator('de-DE')`, other types relationally.
- The limit is a `BitSet` over the ordered indices, so the columns stay shared — the same memory rule the Filter already follows.
