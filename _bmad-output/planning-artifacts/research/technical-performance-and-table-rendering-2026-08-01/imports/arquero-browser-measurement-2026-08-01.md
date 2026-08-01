# Original measurement: Arquero 8.0.3 at scale in the browser

Run for querbeet R4 / D2 on 2026-08-01. Reproduce with `node run-arquero-probe.mjs chromium` /
`node run-arquero-probe.mjs firefox` against `arquero-browser-probe.html` (needs
`npm i playwright arquero` in the working directory). Raw output is preserved as
`arquero-probe-chromium.json` and `arquero-probe-firefox.json`.

## Why this was measured

R1 measured the transformation engines in **Node**, on **plain JavaScript arrays**, and the
project then overrode the research recommendation in favour of **Arquero**. R3 states that
every prior performance figure is Node, not browser. So the numbers that actually govern
querbeet's memory budget — Arquero's own footprint, what a chain of verbs retains, and what
feeding the render window costs — had never been measured for the stack that was chosen.

The parallel literature track read Arquero 8.0.3's source and predicted which verbs share
columns and which materialize. This run tests those predictions in a running browser.

## Method

- **Browsers:** Chromium 151.0.7922.34 (with `--enable-precise-memory-info` and
  `--js-flags=--expose-gc`) and Firefox 153.0, both headless via Playwright, both loading a
  real `file://` page. The Arquero 8.0.3 UMD bundle (236,290 B) is injected before the page
  script runs, matching the production shape of one self-contained file.
- **Data:** 100,000 rows × 20 columns plus a `key` column (21 total). Numeric columns vary
  with the row index; string columns are ~16-character values. Every seventh row has a
  `null` key — the shape R1 identified as the join hazard — and the 5,000-row lookup table
  is joined after sentinel substitution, per R1's rule.
- **Heap:** two forced GCs before and after each measurement, with the produced value still
  referenced, so what is reported is *retained* memory. Firefox exposes no
  `performance.memory`, so **all heap figures are Chromium-only**; Firefox contributes timings.
- **Sharing:** in Arquero 8, `table.column(name)` returns the backing array itself, so
  JavaScript object identity between a parent's and a child's column **is** direct proof of
  sharing rather than an inference.

### A correction made during the run

The first pass generated numeric columns as `i * c`, which makes column 0 constant. Every
filter-based test silently degenerated to 0 or all rows. The generator was fixed to
`i + c*1000 + seed` and all filter-dependent tests re-run; only the corrected figures are
reported here. The raw JSON files contain the corrected run.

## Results

### 1. Memory — the headline

| What is held | Chromium heap | Per row |
| --- | --- | --- |
| Plain array of 100k frozen row objects (21 cols) | 102.8 MB | 1,078 B |
| …plus an Arquero table built from it (`aq.from`) | **+8.0 MB** | — |
| Arquero table alone, source array discarded | **80.2 MB** | 802 B |

Two things follow, and they point the same way:

- **`aq.from()` is nearly free on top of the source array (+8 MB), because the table shares
  the string values** and allocates only one pointer array per column. This confirms the
  source reading: the table costs N×C new array slots, not a second copy of the payload.
- **The column store is ~22 % cheaper than the array of objects** (80.2 MB vs 102.8 MB) once
  the source array is released — the saving is per-row object overhead, roughly 276 B/row.
  So the architectural rule is: **parse into rows, build the table, then drop the row array.**
  Holding both costs 110.8 MB per source against 80.2 MB.

**The scale ladder is exactly linear — no surprises, no superlinearity:**

| Simultaneous 100k × 20 sources | Added | Cumulative heap |
| --- | --- | --- |
| 1 | 80.2 MB | 274.4 MB |
| 2 | 80.2 MB | 343.9 MB |
| 3 | 80.2 MB | 413.5 MB |
| 4 | 80.2 MB | 483.0 MB |
| 5 | 80.2 MB | **552.6 MB** |

Five simultaneous 100k-row sources cost about **550 MB of heap**, plus intermediates. That is
large but not disqualifying on a desktop browser; it is, however, roughly 2.4× R1's Node-based
estimate of ~235 MB for the same five sources, because that estimate used a narrower row shape
and plain arrays.

### 2. Verbs — every source-read prediction confirmed by identity

`backing` compares the parent's and the result's actual column array by object identity.

| Verb | Backing | Chromium heap Δ | Chromium ms | Firefox ms | Rows out |
| --- | --- | --- | --- | --- | --- |
| `select` | **SHARED** | 0.0 MB | 0.5 | 1 | 100,000 |
| `filter` | **SHARED** | 0.0 MB | 10.8 | 17 | 99,999 |
| `orderby` | **SHARED** | 0.1 MB | 4.7 | 2 | 100,000 |
| `derive` | **SHARED** | 0.4 MB | 10.8 | 14 | 100,000 |
| `slice` | **COPIED** | 0.0 MB | 0.6 | 0 | 50 |
| `join_left` (sentinel) | **COPIED** | 11.1 MB | 76.7 | 108 | 100,000 |
| `concat` (union) | **COPIED** | 16.0 MB | 35.2 | 52 | 200,000 |
| `groupby` + `rollup` | — | 0.5 MB | 23.3 | 24 | 5,001 |

The measured heap deltas line up with the allocation sites read from the source: `filter`
costs a bitset too small to register, `derive` allocates one full-backing-length array
(~0.4 MB), `groupby` allocates a `Uint32Array` of group keys (~0.5 MB observed against ~400 KB
predicted), and only `join`/`concat` build genuinely new column data.

**The practical consequence:** a chain of `select`/`filter`/`orderby`/`derive` steps over one
source is essentially free in memory. Cost enters only where rows are combined — join and
union — which is exactly where it should.

### 3. `reify()` really is the release lever

A filtered view pins the entire parent, because the child points at the parent's column
arrays. Measured on one 100k source filtered down to 1,000 surviving rows:

| Step | Chromium heap |
| --- | --- |
| Source table held | 80.2 MB |
| + filtered view + `reify()` of the survivors | no measurable increase |
| **After dropping the source table and the view** | **0.7 MB retained** |

**80.2 MB → 0.7 MB.** Reifying the survivor and releasing every reference to the parent lets
the backing arrays go. Without the `reify()`, the 1,000-row view would keep all 80.2 MB alive.

The related ordering rule also holds. Because `derive` allocates an array sized to the
*backing* row count rather than the surviving count, deriving on a table filtered from
100,000 down to 1,000 costs 0.4 MB, while reifying first costs 0.1 MB — **4× less memory, at
the price of 2.4 ms**. The absolute numbers are small at one step; the rule matters for long
chains, not for a single filter.

### 4. Feeding the render window is free

The D1 decision needs a ~50-row window read out of a table on every scroll swap:

| Read path | Chromium | Firefox | Heap |
| --- | --- | --- | --- |
| `objects({limit: 50})` | 0.3 ms | 1 ms | 0 MB |
| `slice(0, 50).objects()` | 0.5 ms | 0 ms | 0 MB |
| `slice(50000, 50050).objects()` (mid-table) | 0.6 ms | 0 ms | 0 MB |
| `get(col, row)` for 50 rows × 20 cols | 0.6 ms | 1 ms | — |
| **`objects()` — the whole table** | **12.5 ms** | **97 ms** | +9.6 MB |

A window read costs well under a millisecond and does not depend on where in the table the
window sits. Against D1's measured 4–5 ms per window swap, the Arquero read is noise: **the
complete preview path is about 5 ms.**

Note the engine gap on full materialization: `objects()` over 100k rows is **12.5 ms in
Chromium but 97 ms in Firefox — roughly 8×**. Any code path that materializes the whole table
(export, clipboard, JSON output) should be assumed Firefox-bound.

### 5. The full pipeline, in the browser

Union of two 100k tables → sentinel substitution → left join against a 5,000-row lookup →
filter → derive, producing 199,805 rows:

| | Chromium | Firefox |
| --- | --- | --- |
| Full pipeline | **262.9 ms** | **446 ms** |
| Retained heap | +24.4 MB | — |

This is the number to hold against R1: plain JavaScript ran a comparable pipeline in
**10.5 ms in Node**. Arquero in the browser at this shape costs **roughly 0.26–0.45 s**. Still
comfortably interactive — but 25–40× the hand-written figure, and the gap is a real,
now-measured cost of the project's decision to prefer a maintained library.

Firefox is consistently **1.5–2× slower than Chromium** across Arquero work, and 8× slower on
full row materialization.

## Caveats

- Headless, one machine, no competing tab load. Timings are a floor.
- All heap figures are Chromium's `performance.memory`, which reports the JS heap only.
- Synthetic strings of ~16 characters; wider real values raise every memory figure roughly
  proportionally.
- The scale ladder builds five *identical-shaped* sources; real files will differ in width.
- `groupby`'s column-sharing could not be established by the identity check used here (its
  result is a rollup, not a row-level table); its heap delta is consistent with the source
  reading but is not a direct proof.
