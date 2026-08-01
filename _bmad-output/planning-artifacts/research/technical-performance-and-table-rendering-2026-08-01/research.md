---
title: 'technical research: Performance and table rendering (querbeet R4)'
type: 'technical'
topic: 'Performance and table rendering (querbeet R4)'
decision: 'How to keep the UI responsive at roughly half a million rows in a single-file Vue 3 + Arquero app'
source: 'native run (deep-recon)'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-08-01'
updated: '2026-08-01'
---

# technical research: Performance and table rendering (querbeet R4)

**Decision this research serves:** How to keep the UI responsive at roughly half a million rows in
a single-file Vue 3 + Arquero app. (The decision was scoped to 100,000 rows when the run started;
PRD NFR-3 raised it mid-run, and D3 and D4 were measured against the higher target.)

> **Run status — complete.** All four dimensions have been executed: **D1** (table rendering /
> virtualization) and **D2** (Arquero at scale in the browser) on 2026-08-01, **Checkpoint D2-a**
> (does the graph stay affordable with fan-out?) the same day, and **D3** (off-main-thread work and
> transfer cost) and **D4** (responsiveness patterns) in a Deepen on this folder, also 2026-08-01.

## Executive summary

**The architecture holds at half a million rows, and the two things that looked like open risks are
not.** A 30-Step graph recomputes in 496 ms (Chromium) / 1,394 ms (Firefox); the Editor and the
table show **no measurable contention at 30 Steps**, with the frame interval locked at 60 Hz through
real pointer drags and a 30-node `ResizeObserver` storm; and searching every one of 19.5 million
cells costs ~430 ms and chunks to a 2–3 ms longest block. What actually needs attention is narrower
and more concrete than the brief expected.

**Six things this research decides.**

1. **Virtualize the table, and hand-roll it.** Rendering 100,000 × 20 unvirtualized takes 11.2 s
   (Chromium) / 12.4 s (Firefox); a 50-row window swaps in 3–5 ms. Column virtualization is not
   needed even at 50 columns. **Row height is a load-bearing constant, not styling:** at half a
   million rows the maximum safe height in Firefox is ~32 px, and the spacer cap with offset
   rescaling is mandatory rather than optional. (D1)
2. **Arquero fits, and its sharing semantics are what make a graph affordable.** 80.2 MB per
   100,000 × 20 source, scaling linearly; `select`/`filter`/`orderby`/`derive` share the parent's
   arrays, only `slice`/`join`/`concat` copy. Fan-out is free — ten consumers of an 80 MB source
   cost 0.13 MB between them — and **joins and concats are the entire price**, still true at 30
   Steps. (D2, D2-a, D4)
3. **Memoize per Step.** Editing the last Step of a 30-Step graph costs **24 ms** memoized against
   496 ms recomputed, a factor of 20. Holding all 30 intermediates costs 180 MB at half a million
   rows, and the cache has nowhere else to live than the `shallowRef` registry the Editor spike
   already established. (D4)
4. **Only the exports belong in a worker, and the reason is the transfer.** Moving 100,000 rows
   across a thread boundary blocks the sender for 109 ms and half a million for 511 ms — more than
   the whole pipeline costs. But xlsx export takes **26.3 seconds** at half a million rows, and a
   worker buys back 95 % of that freeze for no measurable elapsed-time cost. **Never move a dataset to a
   worker to compute on it; if a worker needs data, it should receive it once and keep it.** (D3)
5. **Full-dataset search (FR-33) needs neither a worker nor an index** — a column scan with a yield
   every 25,000 rows, longest block 2–3 ms. (D4)
6. **There is no shared cancellation flag on this platform**, and the API surface says otherwise:
   `Atomics.wait` exists, `WebAssembly.Memory({shared:true})` yields a real `SharedArrayBuffer`, and
   both engines refuse to post it from `file://`. Cancel through the message queue instead — latency
   is 2–17 ms and is a function of chunk size alone, and progress messages cost 2.6 %. (D3, D4)

**Four findings that change something outside this report.**

- **PrimeVue 5.0.0 (2026-07-15) is no longer MIT** — a commercial licence with a runtime key and an
  eligibility-gated free tier, while the GitHub repository still shows the old MIT text. The whole
  PrimeTek family is affected. (D1)
- **R1's null-key sentinel is a Cartesian bomb between two branches of one Source.** 28,000 source
  rows produced 2,687,670 join rows; at 100,000 it crashed the tab. A Join Step must warn when both
  inputs carry nulls in the key column. (D2-a)
- **`hyparquet-writer` 0.16.3 writes an unreadable file when asked for GZIP** — raw bytes labelled
  GZIP, which pyarrow 25 refuses. One option fixes it, and GZIP is 2.4× smaller than SNAPPY. (D3)
- **`new Worker` is a poor gate signal for built artefacts.** It appears in a correctly inlined
  worker (inlining requires blob-URL construction), in dead library code, and in a genuinely
  fetching worker — only the last is a failure. Gate on the `dist/` file count and on opening the
  artefact from a real `file://` URL in both engines. (D3)

**Two corrections to earlier querbeet research, both from measuring rather than re-reading.**
R3's export figures are Node and understate the browser badly — plan against 26–31 s for xlsx at
half a million rows, not the ~16 s a linear projection suggested. And R3's leftover question about
`read-excel-file`'s internal worker does not arise: the library **never creates a worker at all**,
because `CAN_USE_WORKER` is hardcoded `false` and the whole call site is commented out. (D3)

**Engine ranking is per-operation, not global.** Firefox is 1.5–2× slower on Arquero work and 8×
slower on full row materialization (D2) — and roughly **twice as fast as Chromium** on Parquet
writing (D3), and exactly equal on column scanning (D4). Any statement of the form "Firefox is
slower" needs an operation attached to it.

> **Rescope note, 2026-08-01 (after the PRD).** The scale target moved from "~100,000 rows max"
> to **~100,000 rows per source and roughly half a million in total** (PRD NFR-3), the linear
> step list became a **graph** of named Steps (FR-12), and **full-dataset search** entered scope
> (FR-33). Everything measured below still holds — nothing was measured at a row count the
> rescope invalidates — but two conclusions change in force rather than direction:
>
> 1. **The spacer-height guard moves from optional to mandatory**, and row height becomes a
>    load-bearing constant rather than a styling choice. See "The scroll-range ceiling" below.
> 2. **D2's scale ladder happens to land exactly on the new target** — five simultaneous 100k
>    sources *is* half a million rows, measured at 552.6 MB total heap, ~400 MB of it tables.
>
> The question the rescope added — in a graph a Step may have several consumers, so intermediate
> outputs stay alive — has since been measured as **Checkpoint D2-a** (section below). Fan-out is
> free, joins are the whole price, and a half-million-row graph costs 447 MB. It also **corrected
> one D2 rule** and turned up a Cartesian trap in R1's sentinel recommendation.

> **Cross-run inputs, 2026-08-01 — R6, R9's gate and the Editor spike.** Reviewed against this
> report: **nothing in them contradicts a measurement here.** D1's verdict and row-height budget,
> D2's sharing semantics and memory totals, and Checkpoint D2-a all stand unchanged. Three things
> change the *remaining* work, and the full brief lives in `research-plan.md` R4:
>
> - **The Editor is now a measured co-tenant of the main thread.** R6 chose Vue Flow 1.48.2 and the
>   spike built it; the canvas costs 62.4 ms / 61 ms to mount and 2.76 MB of heap — but only at 3–4
>   nodes, and the PRD's range is 5–30. Every node carries a `ResizeObserver`, which is the concrete
>   contention mechanism against the table's window swap. D3/D4 measure at 30 Steps.
> - **IndexedDB persistence is a new long operation** that did not exist when D3 was scoped: R9
>   measured `put` of 100k × 20 at 305 ms (Chromium) / 731 ms (Firefox), projecting to ~1.5 s /
>   ~3.7 s at half a million — the Firefox figure lands on R3's tab-freeze threshold. It also gives
>   D3 its first transfer-cost data point, and it **points against putting the pipeline in a
>   worker**: if moving 100k rows costs hundreds of milliseconds, a 263–446 ms pipeline does not
>   profit from crossing the boundary.
> - **The spike settles where a per-Step result cache belongs.** Datasets never enter the graph
>   model; tables live in a `shallowRef` registry keyed by Source id. That confirms D2-a's premise
>   and removes a design question from D4.
>
> **One number to keep straight.** Three heap figures for "100k × 20" circulate and all three are
> correct about different things: **94.4 MB** (R6 — frozen plain objects, 20 short-string columns),
> **102.8 MB** (D2 below — frozen plain objects, 21 columns, longer strings) and **80.2 MB** (D2 —
> the same data as an *Arquero table*). querbeet holds Arquero tables, so **80.2 MB per source is
> the budget figure.**

---

## D1 — Table rendering: virtualize, and with what?

### The short answer

**Virtualization is mandatory, and hand-rolled fixed-height windowing wins the selection
matrix (94/100).** The runner-up is TanStack Virtual at 92 — close enough that adopting it
instead is a reasonable deliberate trade rather than a mistake. Column virtualization is
**not** needed at this shape, and that is a measured result, not a judgement call.

Three facts decide it, all measured for this decision against Chromium 151.0.7922.34 and
Firefox 153.0 from a real `file://` URL [24]:

1. **Rendering all 100,000 rows × 20 columns takes 11.2 s (Chromium) / 12.4 s (Firefox)** and
   builds 2,000,000 cells. Neither engine crashes — it is simply an eleven-second frozen tab.
   Virtualization is required, not advisable.
2. **A 50-row window over the same 100,000 rows swaps in 4.1 ms (p50, Chromium) / 5 ms
   (Firefox)**, rebuilding every node from scratch with no recycling. That is a quarter of a
   16.7 ms frame for the pessimistic implementation.
3. **The same 50-row window at 50 columns still swaps in 10.9 / 14 ms.** 2,500 cells is not
   enough work to justify a horizontal virtualizer — which matters, because column
   virtualization is exactly where the library ecosystem is documented to break (below).

### Why this is a select decision with a low ceiling

The measured need is narrow: render a ~50-row window of fixed-height rows over a frozen array,
move it on scroll. That is index arithmetic plus a spacer div. Every candidate library clears
that bar comfortably; the question is what else you buy and what else you owe.

**The requirements frame** (hard gates first, then weighted preferences). This frame is derived
from the project's fixed constraints and the measurements above; the weights are a proposal and
the matrix below is meant to be re-weighted rather than trusted.

Hard gates — fail any one and the candidate is out:

| Gate | Requirement |
| --- | --- |
| G1 | Bundles into one self-contained HTML file; nothing fetched at runtime (no `import()`, `fetch`, external CSS/font/worker) — from `file://` these all fail [8][24] |
| G2 | Vue 3 first-class, not a stale community wrapper |
| G3 | Permissive licence, no runtime key, no eligibility gate |
| G4 | Tolerates `Object.freeze`d, non-reactive row data (R2 established deep reactivity over the dataset is unaffordable) |
| G5 | Released within the last 12 months |

Weighted criteria:

| # | Criterion | Weight | Why this weight |
| --- | --- | --- | --- |
| C1 | Fit to the measured need | 30 | The need is small and precisely known; over-serving it is a cost, not a bonus |
| C2 | Vue 3 + frozen-data integration | 20 | The one way a candidate can be fatally wrong rather than merely heavy |
| C3 | Maintenance / five-year regret risk | 20 | The app must still build in five years; R2 already made the toolchain a dependency |
| C4 | Licence and exit cost | 10 | Binary in practice, and the field just proved it is not stable (PrimeVue) |
| C5 | Footprint | 10 | Deliberately low: R2 established the whole build is 280,519 B and Arquero alone is 236 kB raw, so tens of kB do not decide anything |
| C6 | Capability headroom | 10 | Sticky headers, dynamic row heights, column virtualization — wanted only if cheap |

### The field, screened

The credible 2026 field splits into headless virtualizers (you bring the markup) and full data
grids (they bring the table). Since querbeet already owns its three-pane UI and its own step
list, a full grid is mostly surface area it does not need.

**Cut at the gates:**

- **PrimeVue DataTable — cut on G3, and this is the run's most consequential incidental
  finding.** PrimeVue **5.0.0 (2026-07-15) is no longer MIT**. The `LICENSE.md` shipped inside
  the npm package reads "PrimeUI License … a family of **commercial** UI libraries" and states
  that "A valid license key is required to use this software… A missing, invalid, or expired
  key may cause the software to display a license notice" [17]. The free Community tier is
  eligibility-gated — under $1M revenue, fewer than 5 developers, fewer than 10 employees,
  under $3M funding, capped at 4 developers — and **requires annual re-confirmation** [17]. A
  new package `@primeui/license-manager` is now a hard runtime dependency of `primevue@5.0.0`
  [17]. The relicence is corroborated by PrimeTek's own announcement and independent discussion
  [18], is not retroactive (4.5.5 of 2026-04-08 remains the last MIT release), and the GitHub
  repository appears archived as of 2026-06-28 while still displaying the old MIT text [18] —
  so the repo's visible licence now contradicts what npm ships. *This reaches beyond R4:
  anything from the PrimeTek family is affected.*
- **AG Grid Community — cut on C1/C5 rather than a gate.** It is MIT and its stylesheets are
  offline-clean (fonts are data-URI-embedded, no external `url()`) [19][21], but it is **338 kB
  gzipped** [19] — larger than querbeet's entire current single-file build — and the features a
  data tool would reach for are Enterprise-only behind a runtime licence key: set filter, multi
  filter, advanced filter, **column and context menus**, tool panels, range selection, Excel
  export, row grouping [20]. `ag-grid-vue3` also peers `vue ^3.5.32`, a tight floor on the host
  app [19].
- **`vue3-virtual-scroll-list` — cut on G5.** Last release 0.2.1 on 2022-11-04, no ESM
  `exports` map [11].
- **`vxe-table` — cut on evidence.** MIT and extraordinarily active (2807 published versions),
  but 14.3 MB unpacked with no `exports` map [23]; not screened in depth.

**Unresolved gate — do not shortlist until checked:** **RevoGrid** (`@revolist/vue3-datagrid`
4.24.2, 2026-07-29, MIT, 55.3 kB gzip — the lightest full grid [22]) is a Stencil web component.
Stencil can emit either a lazy-loader build that `import()`s component chunks at runtime, which
would be **fatal under G1**, or a `dist-custom-elements` build, which is fine. Which mode this
package ships was not established [22].

### The matrix

Scores are 1–5 against each criterion; the total is the weighted sum normalised to 100.

| Candidate | C1 Fit (30) | C2 Vue+frozen (20) | C3 Maint. (20) | C4 Licence (10) | C5 Size (10) | C6 Headroom (10) | **Total** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Hand-rolled windowing** | 5 | 5 | 5 | 5 | 5 | 2 | **94** |
| **TanStack Virtual** | 4 | 5 | 5 | 5 | 4 | 5 | **92** |
| virtua | 4 | 3 | 4 | 5 | 5 | 4 | **80** |
| vue-virtual-scroller | 4 | 5 | 3 | 5 | 3 | 4 | **80** |
| @pdanpdan/virtual-scroll | 4 | 2 | 2 | 5 | 3 | 5 | **66** |
| RevoGrid | 2 | 3 | 4 | 5 | 2 | 5 | **64** |
| Tabulator | 2 | 2 | 4 | 5 | 1 | 5 | **58** |

Where the contested cells come from:

- **Hand-rolled C1 = 5, C6 = 2.** The measurement [24] is the whole argument for the first
  score: a from-scratch 50-row window swap costs 4–5 ms, and the 50-column case costs 11–14 ms.
  The low headroom score is equally evidenced — dynamic row heights, sticky headers under
  virtualization and column virtualization are all documented to be genuinely hard, and a
  hand-rolled implementation would be starting from zero on each (below).
- **TanStack Virtual C2 = 5, and this is the strongest single piece of integration evidence in
  the run.** Its Vue adapter was read at source: it consumes `count`, `estimateSize` and
  `getScrollElement` and **never touches the row array at all** — the consumer indexes the data
  inside its own render loop [14]. Its options are `MaybeRef` (a plain object passes through
  `unref` unchanged) and the internal watch is **shallow**, with no `deep: true` [14]. A frozen
  array in a `shallowRef` is therefore structurally safe. It is MIT with `sideEffects: false`,
  no CSS export, one dependency, 3.13.35 released 2026-07-28 with 8 releases in two months, and
  ~10 kB gzip [11][12].
- **virtua C2 = 3 — the one open fatal risk among the finalists.** Unlike TanStack, `virtua/vue`
  **owns the array**: `VList` takes a `data` prop [13]. Whether its Vue adapter deep-watches
  that prop was not established, and a `deep: true` watch over 100,000 rows would be exactly
  the cost R2 measured as unaffordable. Otherwise it is attractive: MIT, zero dependencies,
  0.50.0 on 2026-07-25, and the smallest at 5.9–6.3 kB [12] — note its README's "~3 kB" is
  optimistic by roughly 2× against two independent measurements [12].
- **vue-virtual-scroller C2 = 5, C3 = 3.** It is the only candidate whose own documentation
  explicitly blesses the frozen case, telling you to `Object.freeze` the items array or to
  avoid `ref`/`reactive` wrapping for large lists [13] — the least modern candidate has the
  clearest statement on the load-bearing question. The trade it names: with a non-reactive
  array, mutations do not propagate, so you must replace the array reference. Against it: 3.0.4
  landed 2026-05-20 after years stalled on `2.0.0-beta.*` [11], so the stable line is ~2 months
  old. Its 1.5 kB stylesheet is offline-clean — no `@font-face`, no `@import`, no non-`data:`
  `url()` [21] — but it is the one finalist where a build misconfiguration could leave a
  `file://`-broken `<link>`.

### What the library ecosystem does *not* solve

This matters because it caps C6 for every candidate — buying a library buys less headroom than
it appears to:

- **Column virtualization is where the leading library visibly degrades.** A reproducible report
  against TanStack Virtual 3.1.1 + Table 8.12.0 shows a **blank page during combined
  horizontal + vertical scroll**, with repeated long-scroll-handler warnings; the issue is open
  with no maintainer diagnosis and no in-thread workaround [3]. The report is against old
  versions and was not re-verified — but since the measurement says querbeet does not need
  column virtualization at all [24], the safest reading is simply: do not go there.
- **Sticky/frozen columns fight column virtualization.** Making a column sticky via
  `rangeExtractor` causes columns to stop rendering once virtualization engages; the
  practitioner pattern is to render sticky layers *outside* the virtualized grid with plain CSS
  [4]. Sticky headers have the same shape of problem — a `<thead>` inside a `<table>` whose body
  holds only visible rows can disappear on scroll, and the fix is to lift the header out of the
  virtualized area and add its height to the total size [5]. That pattern tends to force a
  div-grid rather than a real `<table>`, which then collides with the ARIA work below.
- **Dynamic row height is the documented pain generator.** Correct offsets require every row
  above the viewport to have been measured, which is infeasible during fast scrolling; the
  reported failures are list jumping when heights are recomputed mid-scroll, `scrollToRow`
  landing on the wrong row, and upward-scroll drift [6]. These reports are 2016–2018 era against
  other libraries and the *specific bugs* are not current-version claims — but the mechanism is
  generic. **Fixed row height is the escape hatch, and it should be the default, not a
  compromise.** querbeet's measurement assumed fixed heights throughout.
- **Find-in-page cannot be fixed from userland, by any candidate.** Rows not in the DOM are not
  findable by the browser's own Ctrl+F, and there is no event to intercept: Angular's components
  repo has carried this as an open design task since 2018-02-23, stating plainly that native
  Ctrl+F cannot be detected [7], and the WICG virtual-scroller explainer names find-in-page,
  landmark navigation and fragment navigation as the motivating platform gaps [8]. **querbeet
  must ship its own find UI over the full dataset** — this is the item most likely to be
  discovered after launch, and it is a product requirement, not a rendering detail.
- **Accessibility is manual bookkeeping.** The ARIA APG covers the virtualized case explicitly:
  set `aria-rowcount`/`aria-colcount` to the *total*, and `aria-rowindex`/`aria-colindex` to
  each cell's true position [10]. It also names an unsolved keyboard problem — Ctrl+End moves
  focus to the last row *in the DOM*, not the last row in the data [10]. APG does **not** require
  `role="grid"` over `role="table"` for a read-only table; it frames that as a focus-management
  choice [10]. No library removes this work.

### The platform alternative, and why it is not one

`content-visibility: auto` was checked as a no-library path and does not replace virtualization
here. Decisively: **it does not reduce DOM node count** — it skips *rendering* of off-screen
subtrees, not their creation, so 2,000,000 cell elements would still be parsed, constructed and
held [9]. That alone disqualifies it for the 100k case, and the 11.2 s build time measured
above [24] is precisely that construction cost. Its documented failure mode compounds the
picture: elements under size containment with no specified height compute to 0 height, so the
scrollbar shifts as content enters and leaves — one practitioner measured a 60 % rendering
improvement in Chrome and removed the property anyway because the scrollbar flicker was
unacceptable [9]. `contain-intrinsic-size` is the prescribed fix but trades the problem for an
estimation one [9], and the interaction between `content-visibility` and scroll anchoring is
still an open CSSWG issue with traffic through at least February 2025 [26]. Confidence on the
node-count claim: medium — no source tested it at this node count; the reasoning is from the
property's own definition plus querbeet's measured build cost.

### The scroll-range ceiling — both circulating figures were right

The retrieved literature carried two contradictory numbers for the maximum element height:
**17,187,496 px** for Firefox, from an `nscoord` fixed-point overflow bug that is still open
and unresolved (filed 2019, status NEW, P5) [1]; and **33,554,400 / 33,554,428 px** from a
TanStack issue thread reporting Firefox and Chrome respectively [2]. The assistant flagged the
conflict rather than averaging it.

**Measurement resolves it: they describe different engines, and the failure modes differ in a
way that matters** [24]. Box height and container `scrollHeight` track each other exactly in
both engines right up to the failure point — there is no separate, earlier scroll-extent limit:

| Requested | Chromium 151 | Firefox 153 |
| --- | --- | --- |
| 1,000,000 – 16,000,000 px | exact | exact |
| 20,000,000 px | exact | **collapses to height 0** |
| 33,000,000 px | exact | **collapses to height 0** |
| above | clamps to **33,554,428 px** (2²⁵ − 4) | 0 |

**Chromium clamps** — content beyond the ceiling is unreachable but the page keeps working.
**Firefox does not clamp; it collapses the element to zero height and the list silently
vanishes** (`scrollHeight` falls back to the container's own 300 px, `scrollTop` stays 0). The
transition lies between 16M and 20M px, consistent with the 17,187,496 px figure in the Mozilla
bug [1]. TanStack Virtual's own max-height issue is open with no shipped workaround [2], so a
library would not save you here either.

At 100,000 rows this was comfortable: 100,000 × 28 px = 2,800,000 px, exact in both engines,
with Firefox's cliff a factor of six away. Scroll offsets are precise there too — at a
2,800,000 px spacer both engines returned every requested `scrollTop` with zero drift and
resolved a 1 px step [24].

**At the rescoped half-million target it is no longer comfortable.** Because the spacer is
`rowCount × rowHeight`, the ceiling is best read as a **row-height budget**:

| Row height | Firefox (measured-safe, 16.0M px) | Firefox (bug 1527883, 17.19M px) | Chromium (clamp, 33,554,428 px) |
| --- | --- | --- | --- |
| 24 px | 666,000 rows | 716,000 rows | 1,398,000 rows |
| 28 px | 571,000 rows | 614,000 rows | 1,198,000 rows |
| 32 px | **500,000 rows** | 537,000 rows | 1,048,000 rows |
| 40 px | 400,000 rows | 430,000 rows | 839,000 rows |

**At half a million rows the maximum safe row height in Firefox is about 32 px** — and a
comfortable table row with padding is easily 36–40 px, which is already over the cliff. Row
height therefore stops being a styling decision and becomes a load-bearing constant that the
design must respect or the guard must absorb.

**The guard is consequently mandatory, not optional.** Cap the spacer at a safe maximum and
rescale the scroll-offset mapping (`rowIndex = scrollTop / spacerHeight × rowCount` rather than
`scrollTop / rowHeight`). This costs a few lines, removes row height from the risk surface
entirely, and also lifts Chromium's own ~1.2M-row ceiling at 28 px. Note that TanStack Virtual
would not supply this: its max-height issue is open with no shipped workaround [2], so on the
library path the guard would have to be built anyway — which, at the rescoped target, mildly
strengthens the hand-rolled recommendation rather than weakening it.

### Recommendation

**Hand-roll the windowing, with fixed row heights, a ~50-row window, and a spacer-height
guard.** It scores 94; it is roughly the amount of code that configuring a library would take;
and the measurement shows the pessimistic version — full node rebuild, no recycling — already
fits a frame four times over, at 20 and at 50 columns.

**Named runner-up: TanStack Virtual (92), and the conditions under which it wins instead.**
Adopt it if any of these becomes true: rows must have variable height after all (its dynamic
measurement is the part that is genuinely expensive to write); the preview grows toward the
window sizes where per-swap cost approached a frame (200 rows measured at 17–20 ms [24]); or
the same argument that decided R1 in favour of Arquero applies again — a maintained,
widely-used implementation over freshly written bespoke code. That argument is available here
on the same terms, and at 92 vs 94 it costs almost nothing on this matrix. Its
never-touches-your-data design [14] makes it the only candidate with *proof* rather than
inference on the frozen-data gate.

**Strongest argument against the recommendation:** the 94 assumes fixed row heights forever.
Every documented horror story in this dimension [6] is about dynamic heights, and the moment
querbeet needs wrapped cell content or expandable rows, the hand-rolled path inherits a problem
the ecosystem has not solved cleanly in a decade. The cheap hedge is an abstraction seam: keep
the windowing behind a component whose props are `(rows, rowHeight, windowSize)` so swapping in
TanStack Virtual later rewrites one file.

**Do not build column virtualization.** 50 columns × 50 rows measured at 11–14 ms per swap
[24], and column virtualization is where both the sticky-column [4] and blank-frame [3] failures
live. Render all columns; virtualize only rows.

**Two things to plan as product work, not rendering work:** a find UI over the full dataset,
because Ctrl+F will find nothing [7][8]; and manual `aria-rowcount`/`aria-rowindex` bookkeeping
with a known-broken Ctrl+End [10].

### Confidence and what remains open

Load-bearing claims in this dimension rest on **original measurement** [24] rather than
retrieved sources, which is the strongest evidence available here and also its own limitation:
one machine, headless, synthetic row content, no competing tab load. Treat the timings as a
floor.

Open, in priority order:

1. **`virtua`'s Vue adapter watch depth** — the single unresolved fatal-risk question among the
   finalists. Cheap to settle by reading the adapter source.
2. **RevoGrid's Stencil output mode** — decides whether it passes G1 at all. Only matters if a
   full grid comes back into scope.
3. **Nothing was tested from `file://` except querbeet's own probe.** Every library's
   offline-safety claim here is static analysis of shipped artifacts [11][12][21], not observed
   behaviour. The definitive check is local and cheap: build once, then grep the emitted single
   file for `import(`, `fetch(`, `new Worker`, `.wasm`, and `url(` outside data URIs.
4. **Maintenance was read from npm release timestamps only** — every GitHub API call failed in
   the research environment [11]. Release cadence shows liveness but says nothing about whether
   issues get answered, so the bus-factor question is genuinely unanswered for every candidate.
   `virtua`, `vue-virtual-scroller` and `@pdanpdan/virtual-scroll` are all published from
   personal accounts.
5. **A registry-date anomaly for `vue-virtual-scroller`** — npm's `time` map dates
   `2.0.0-beta.10` to 2026-03-12, conflicting with that package's known multi-year beta stall
   [11]. Confirm against GitHub releases before trusting its cadence read.
6. **No public benchmark exists for this shape.** Two rounds of searching found no
   current-version measurement of a virtualized table at 100k × 20–50 columns; every retrieved
   scale figure concerns 1D lists or synthetic 1000×1000 grids. This is why D1 was measured
   rather than cited.

Dimension stopped on **coverage**, not on its round cap: the plan questions are answered and
the load-bearing claims are measured rather than merely sourced.

---

## D2 — Arquero at scale in the browser

### The short answer

**Arquero fits, with room to spare, and it is cheaper than the array of objects it replaces.**
One 100,000 × 20 source costs **80.2 MB** of heap as an Arquero table against **102.8 MB** as
plain frozen row objects, and the cost scales **exactly linearly**: five simultaneous sources
are **552.6 MB** [31]. Nothing here threatens the design.

Three rules fall out of the measurements, and all three are cheap to follow:

1. **Drop the parsed row array once `aq.from()` has run.** Holding both costs 110.8 MB per
   source instead of 80.2 MB [31].
2. **`reify()` after a selective filter, then release the parent.** A filtered view pins the
   entire parent table; reifying the survivors and dropping every reference to the source took
   80.2 MB down to **0.7 MB** [31].
3. **Read the render window with `objects({limit, offset})`.** It costs 0.3–1 ms regardless of
   position in the table [31] — noise against D1's 4–5 ms window swap.

And one number the project should see plainly: **the full pipeline costs 263 ms in Chromium
and 446 ms in Firefox** [31], against R1's 10.5 ms for hand-written plain JavaScript in Node.
That is the measured price of the Arquero decision at this scale — comfortably interactive,
and 25–40× the alternative.

### Memory: what a table actually costs

The source reading and the measurement agree, and together they explain *why* the numbers land
where they do. `aq.from(arrayOfObjects)` **converts**: it allocates one fresh `Array(len)` per
column and copies each field across, so it does not retain the source array [27]. Because the
values themselves — strings, objects — are shared by reference rather than duplicated, building
a table on top of an existing row array adds only **8.0 MB** [31]. What the column store saves
is per-row *object* overhead: roughly 276 bytes per row, or about 22 %.

| What is held (100k × 21 cols) | Chromium heap | Per row |
| --- | --- | --- |
| Plain array of frozen row objects | 102.8 MB | 1,078 B |
| …plus an Arquero table built from it | +8.0 MB | — |
| **Arquero table alone, source discarded** | **80.2 MB** | **802 B** |

Scaling is linear with no surprises: 1 → 5 sources adds exactly 80.2 MB each time, reaching
**552.6 MB** cumulative heap at five [31]. That is roughly **2.4× R1's Node-based estimate** of
~235 MB for five sources — not because Arquero is worse than expected, but because R1's figure
used a narrower row shape and plain arrays. Plan the memory budget from 550 MB, not 235 MB.

Note for the single-file build: Arquero's only runtime dependencies are `acorn` and
`@uwdata/flechette`, with **no optional or peer dependencies** — Arrow support is bundled, not
opt-in, so the Flechette machinery ships whether or not querbeet ever reads Arrow [29]. Whether
tree-shaking removes it when only `aq.from` is used was not established.

### Which verbs are views and which are copies

Arquero is a column store whose derived tables **share the parent's column arrays by default**
— `create()` falls back to `this._data` [27], and the official documentation confirms this is
intentional design: "A column instance may be used across multiple tables and so does not track
a table's filter or orderby criteria" [28]. The measurement tests this by object identity —
in Arquero 8, `table.column(name)` returns the backing array itself, so identity between parent
and child column *is* direct proof rather than inference [31].

| Verb | Backing | Heap Δ | Chromium | Firefox | Mechanism [27] |
| --- | --- | --- | --- | --- | --- |
| `select` | **SHARED** | 0.0 MB | 0.5 ms | 1 ms | new names array, same column references |
| `filter` | **SHARED** | 0.0 MB | 10.8 ms | 17 ms | `BitSet(totalRows)` — ~12.5 KB at 100k |
| `orderby` | **SHARED** | 0.1 MB | 4.7 ms | 2 ms | stores a comparator; `Uint32Array` index built lazily and cached |
| `derive` | **SHARED** | 0.4 MB | 10.8 ms | 14 ms | one new `Array(totalRows)` per new column |
| `slice` | **COPIED** | 0.0 MB | 0.6 ms | 0 ms | calls `reify(indices)` — a copy, not a view |
| `join_left` | **COPIED** | 11.1 MB | 76.7 ms | 108 ms | new array per output column + index/hit vectors + hash map |
| `concat` / union | **COPIED** | 16.0 MB | 35.2 ms | 52 ms | `Array(nrows)` per column; early-out if row count unchanged |
| `groupby` + `rollup` | — | 0.5 MB | 23.3 ms | 24 ms | view + `Uint32Array(totalRows)` group keys; rollup output at group cardinality |

Every prediction from the source reading is confirmed by the measured heap deltas. **The
practical consequence: a chain of `select`/`filter`/`orderby`/`derive` over one source is
essentially free in memory.** Cost enters only where rows are combined — join and union —
which is where it belongs. A six-step pipeline is *not* six copies of the data.

Two behaviours are visible only in the source and are not documented [27], so they are easy to
trip over:

- **`slice` materializes.** It reads like a view and is not one. Harmless for a 50-row window,
  but not a way to cheaply narrow a large table.
- **`derive` allocates to the *backing* row count, not the surviving count.** Deriving a column
  on a table filtered from 100,000 down to 1,000 still allocates a 100,000-slot array. Measured:
  0.4 MB naive vs **0.1 MB if the table is reified first** — 4× less memory for 2.4 ms more
  time [31]. One step, small numbers; the rule matters for long chains.

### `reify()` is the release lever, and it works

The retention trap follows directly from column sharing: **a small filtered view keeps the
entire parent alive**, because it points at the parent's arrays. Measured on one source
filtered from 100,000 to 1,000 rows [31]:

| Step | Chromium heap |
| --- | --- |
| Source table held | 80.2 MB |
| + filtered view + `reify()` of the survivors | no measurable increase |
| **After dropping the source and the view** | **0.7 MB retained** |

`reify()` copies the surviving rows into fresh arrays, after which the parent's 80 MB can be
collected. It also has two no-copy fast paths — an unfiltered, unordered `reify()` returns
`this` and allocates nothing at all [27] — so calling it defensively is safe.

**Architecture rule for querbeet:** whenever a pipeline step discards a large fraction of rows
and the upstream source is no longer needed for the step list, reify and release. Where the
source *is* still needed (the user can always re-run from the top), sharing is the point and
nothing should be reified.

### Feeding the render window costs nothing

This is the D1 tie-in, and it settles the last piece of the preview path [31]:

| Read path | Chromium | Firefox | Heap |
| --- | --- | --- | --- |
| `objects({limit: 50})` | 0.3 ms | 1 ms | 0 MB |
| `slice(0, 50).objects()` | 0.5 ms | 0 ms | 0 MB |
| `slice(50000, 50050).objects()` — mid-table | 0.6 ms | 0 ms | 0 MB |
| `get(col, row)` over 50 rows × 20 cols | 0.6 ms | 1 ms | — |
| **`objects()` — the entire table** | **12.5 ms** | **97 ms** | +9.6 MB |

`objects({limit, offset})` genuinely pages: the offset is honoured inside `scan`, which seeks
through the filter bitset rather than building the full array first [27]. Window position does
not affect cost. **Combined with D1's 4–5 ms window swap, the complete preview path is about
5 ms** — well inside a frame.

Two cautions. First, **`[Symbol.iterator]` has no limit/offset and forces the full sort index**
on any filtered or ordered table [27], so iterating for a preview is strictly worse than
`objects({limit, offset})` — use the latter. Second, there is **no row-object pooling**: every
row read allocates a fresh object [27]. For paths that only need values, `values(name)` and
`array(name, TypedArray)` allocate no objects at all [27] and are the better primitives.

### The engine gap, and the cost of the Arquero decision

**Firefox is consistently 1.5–2× slower than Chromium on Arquero work, and 8× slower on full
row materialization** — `objects()` over 100k rows is 12.5 ms in Chromium against 97 ms in
Firefox [31]. Any path that materializes the whole table (export, clipboard, JSON output)
should be budgeted against Firefox, not Chromium. This feeds directly into D3.

The full pipeline — union of two 100k tables, sentinel substitution, left join against a
5,000-row lookup, filter, derive, producing 199,805 rows — runs in **262.9 ms (Chromium) /
446 ms (Firefox)**, retaining 24.4 MB [31].

Set against R1's **10.5 ms** for hand-written plain JavaScript in Node, this is the first
measured price of the project's decision to prefer Arquero over bespoke code. It is
**25–40× slower in absolute terms and still comfortably interactive** — under half a second for
a 200,000-row union-and-join, on the slower engine. The decision holds; the number is simply
now known rather than assumed, and it is the figure to re-check if datasets grow beyond the
100k target.

### Confidence and what remains open

The architecture claims are unusually well-grounded: read from Arquero 8.0.3's own source
[27], corroborated by the official API documentation [28], and then **confirmed empirically by
object-identity checks and heap deltas in a running browser** [31]. Where the two tracks could
disagree, they did not.

Open:

1. **No evidence was retrieved either way on reported out-of-memory problems at scale.** The
   issue-tracker search returned mostly unrelated repositories, so this is a genuine gap — not
   a finding that such reports are absent [27]. Worth a direct tracker query on a later pass.
2. **`toJSON()`'s allocation profile is unestablished** [27]. Relevant to D3 if JSON export
   goes through it.
3. **Whether tree-shaking removes the bundled Flechette/Arrow machinery** when only `aq.from`
   is used [29]. A build-time question, cheap to settle, and it interacts with R2's single-file
   size budget.
4. **`groupby`'s column sharing was not directly proven** — its result is a rollup rather than
   a row-level table, so the identity check did not apply. Its heap delta is consistent with
   the source reading [31].
5. **Heap figures are Chromium-only.** Firefox exposes no `performance.memory`, so the 552.6 MB
   five-source figure is unverified on the engine that is otherwise slower [31].
6. **The measurement uses synthetic ~16-character strings.** Wider real-world values raise every
   memory figure roughly proportionally.

Dimension stopped on **coverage**: the plan questions are answered, and the load-bearing claims
are both source-read and measured.

---

## Checkpoint D2-a — does the graph stay affordable when a Step has several consumers?

D2 proved its sharing result on a **linear chain**. The PRD's graph (FR-12) differs in two ways
a chain cannot exhibit: one Step may feed several consumers, and its output must outlive all of
them. This checkpoint tested the hypothesis that a DAG costs *one copy of the source, plus one
full-length array per derived column, plus one materialisation per `join`/`concat`, with fan-out
free*.

**All three limbs are confirmed [32].** A realistic half-million-row graph — five sources,
unioned, joined against a lookup, filtered, derived — costs **447 MB and 700 ms** [32]. But the
run also overturned one D2 recommendation and uncovered a trap that only a graph makes reachable.

### Fan-out is free; joins are the entire price

| Consumers of one source Step | Pure view chain | With a derived column |
| --- | --- | --- |
| 1 | 0.05 MB | 0.43 MB |
| 3 | 0.05 MB | 1.20 MB |
| 10 | **0.13 MB** | 3.95 MB |

Ten pure-view consumers of an 80 MB source cost **0.13 MB between them**, and the per-consumer
figure *falls* as N rises [32]. A derived column costs a flat **0.40 MB per consumer**, which is
the `Array(totalRows)` allocation D2 read from the source [27] — charged regardless of how
selective the branch is. A 30-Step graph deriving one column per Step would cost about 12 MB at
100k rows.

The diamond makes the shape explicit [32]: two branches held unjoined cost 0.79 MB; recombining
them with a `join_left` producing 50,000 rows costs 10.81 MB. **The rejoin is 10.0 MB of the
10.8** — branching is free, combining is not.

**Retention is clean.** Four Steps over a shared source cost 0.82 MB in total; dropping one leaf
reclaims its own derive array (0.42 MB) and nothing else, because the shared parent stays pinned
by its other consumers; dropping the whole graph returns **exactly to baseline** [32]. There is
no leak, and a leaf frees only what it alone owns.

### Overturned: D2's `reify()` rule is conditional, and D2 stated it unconditionally

D2 recommended *reify after a selective filter and release the parent*, worth 80 MB there. In a
graph the Editor can re-run from any Step, so **the parent normally cannot be released** — and
then the rule inverts [32]:

| Case (100,000 rows filtered to 1,000) | View only | Reified | Effect |
| --- | --- | --- | --- |
| **Parent stays alive — the graph case** | 0.01 MB | 0.11 MB | **costs 0.10 MB, saves nothing** |
| Parent can be released — D2's linear case | 69.65 MB → 0.70 MB after release | | saves ~69 MB |

**Corrected rule: `reify()` only when the parent is genuinely going away.** Where the parent
stays reachable from the graph, reifying copies the surviving rows while the original arrays
remain alive anyway — pure cost. This does not change D2's memory totals, only its advice.

### New trap: R1's null-key sentinel is a Cartesian bomb between two branches

R1 established that null join keys never match and mandated **sentinel substitution**. That rule
was derived for joining against a **unique lookup**, where sentinel rows simply find no partner.
A DAG makes the dangerous case easy: two branches of one source both inherit its nulls, so every
sentinel row on the left matches every sentinel row on the right.

| Source rows | Left × Right | Sentinels L × R | **Join output** | Time |
| --- | --- | --- | --- | --- |
| 7,000 | 3,500 × 2,334 | 167,000 | **170,000 rows** | 236 ms |
| 14,000 | 7,000 × 4,667 | 667,000 | **673,000 rows** | 716 ms |
| 28,000 | 14,000 × 9,334 | 2,668,000 | **2,687,670 rows** | 2,646 ms |

**Output row count tracks the sentinel pair count almost exactly** [32] — legitimate matches are
the small remainder. Growth is quadratic in the null count, which makes it invisible on a sample
and catastrophic at scale: the first run of this probe attempted the same join at 100,000 source
rows, where the sentinel pairs come to roughly 34 million, and **crashed the tab**. It was
reproduced independently in Node before being accepted as a finding.

**Implication for the Editor.** The sentinel rule must be scoped to the case it was derived for.
When both join inputs can contain nulls, substituting a shared sentinel is worse than the
original problem: R1's null keys silently *dropped* rows, this silently *multiplies* them. Either
exclude sentinel rows from the join and re-attach them afterwards, or give each side a distinct
sentinel so they cannot match, or refuse the join and tell the user. A Join Step in a graph
should also warn when both inputs carry nulls in the key column — this is a UX requirement, not
only an implementation detail.

### Confidence and scope

Everything above is original measurement in Chromium 151 [32]; Firefox has no heap
instrumentation and the findings are structural properties of Arquero's data model rather than
engine behaviour. Caveats carry over from D2: headless, one machine, synthetic ~16-character
strings, five identically-shaped sources.

**Checkpoint closed.** The hypothesis held, one D2 rule is corrected, and one new trap is
documented with a route out.

---

## D3 — Off-main-thread work and transfer cost

### The short answer

**Only the exports belong in a worker, and the reason is the transfer, exactly as the brief
suspected.** Moving 100,000 rows across a thread boundary blocks the sender for **109.4 ms**
(Chromium 151) / **132 ms** (Firefox 153); at half a million rows it is **510.8 / 627 ms** [33].
The Arquero pipeline that a worker was meant to rescue costs 263–446 ms in total (D2) — so paying
half a second of *frozen main thread* to hand it over is a straight loss. The exports are the
opposite case: xlsx costs **26.3 seconds** at half a million rows (Chromium), and a worker buys back
95 % of that block at **no cost in elapsed time at all** — 26,040.6 ms through the worker against
26,269.7 ms on the main thread [34].

Four rules follow, and one of them is a correction to a figure this project has been planning
against.

1. **Never move a dataset to a worker to compute on it.** Transfer costs what a whole pipeline
   costs. If a worker needs data, it should receive it *once* and keep it.
2. **Put both exports in a worker.** xlsx especially: 26.3 s of frozen tab versus 1.3 s of block.
3. **If a worker must return bulk data, transfer an `ArrayBuffer` rather than clone a structure.**
   A transferred 76.3 MB buffer costs **0.7 ms** to send and **0.3 ms** round trip [33]. Cloning
   the same volume as objects costs three orders of magnitude more.
4. **R3's export figures were Node and they understate the browser badly.** Plan against 26–31 s
   for xlsx at half a million rows, not the ~16 s that a linear projection from Node suggested [34].

### The transfer, measured in both shapes

The brief called this D3's most valuable single measurement, and it is: an Arquero table is column
arrays of primitives while a parsed Source is an array of objects, and structured clone might price
them very differently. It does — but not in the direction that helps.

`postBlock` is the number that decides everything, because structured-clone serialization happens
*synchronously inside* `postMessage()`. A worker that costs half a second of main-thread block to
feed has already frozen the tab it was supposed to keep responsive [33].

| Shape | Rows | Payload heap | postBlock (Chromium) | postBlock (Firefox) | Round trip (Chromium) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen row objects | 100,000 | 84.8 MB | **109.4 ms** | **132 ms** | 308.4 ms |
| Arquero column arrays | 100,000 | 47.3 MB | **65.2 ms** | **65 ms** | 308.0 ms |
| 10 of 20 columns typed (`Float64Array`) | 100,000 | 34.0 MB | **48.7 ms** | **62 ms** | 181.6 ms |
| Transferred `ArrayBuffer` | 100,000 | 15.3 MB | **0.1 ms** | **0 ms** | 0.2 ms |
| Frozen row objects | 500,000 | 438.7 MB | **510.8 ms** | **627 ms** | 1,578.6 ms |
| Arquero column arrays | 500,000 | 251.8 MB | **366.9 ms** | **402 ms** | 1,772.7 ms |
| 10 of 20 columns typed | 500,000 | 171.2 MB | **196.5 ms** | **199 ms** | 971.2 ms |
| Transferred `ArrayBuffer` | 500,000 | 76.3 MB | **0.7 ms** | **0 ms** | 0.3 ms |

**Columns are cheaper to send and not cheaper to round-trip.** The outbound leg improves by about
30 % (366.9 vs 510.8 ms at 500k), but the return leg is worse, so the full round trip is *slower*
for columns than for rows — 1,772.7 vs 1,578.6 ms [33]. The intuition that a columnar table is the
cheap thing to move is half right, and the half that is wrong is the half that matters if the worker
sends anything back.

**Keeping numeric columns typed is the one real lever short of transferables.** Ten `Float64Array`
columns out of twenty roughly halve the send block, 196.5 against 366.9 ms. That interacts with R5's
type-detection work: a column detected as numeric can be *stored* typed, and the saving is not only
memory.

### An engine difference worth knowing about

Chromium and Firefox put the deserialize cost in different places. Timestamping the worker's
`onmessage` entry *before* `.data` is touched shows it plainly [33]:

| `rows` 500k | Chromium 151 | Firefox 153 |
| --- | ---: | ---: |
| Send start → worker dispatch | 510.9 ms | 1,315 ms |
| Cost of touching `.data` | 496.7 ms | 4 ms |

**Chromium deserializes lazily, on first `MessageEvent.data` access; Firefox deserializes eagerly,
before the event dispatches.** Same total, different scheduling — and in Chromium a receiving thread
can therefore *defer* paying for a message it already holds. Both behaviours are spec-compatible:
the HTML Standard splits serialization from deserialization precisely so the second half can be
delayed until the target realm is known [39], and the split is independently documented as
Chrome/Safari-lazy versus Firefox-eager [39].

This is not trivia. It cost this probe its first run — a timestamp at the top of `onmessage`
reported Chromium's deserialize leg as 0.1 ms, wrong by three orders of magnitude — and any
measurement of worker latency that does not force the payload will report the same fiction.

### The exports, re-measured in a browser

R3 said plainly that every one of its figures is Node. Re-measured from a real `file://` page [34]:

| Export | Rows | Chromium 151 | Firefox 153 | R3 (Node) |
| --- | ---: | ---: | ---: | ---: |
| xlsx (write-excel-file 4.1.1) | 100,000 | **4,943.8 ms** | **5,805 ms** | ~3,300–3,400 ms |
| xlsx | 500,000 | **26,269.7 ms** | **30,558 ms** | ~16,000 ms projected |
| Parquet SNAPPY (hyparquet-writer 0.16.3) | 100,000 | **1,553.6 ms** | **801 ms** | 273 ms |
| Parquet SNAPPY | 500,000 | **9,717 ms** | **4,369 ms** | — |

Two things to read carefully here. **xlsx does not scale linearly** — 5× the rows costs 5.3× the
time in Chromium — so R3's ~16 s projection at half a million rows understates it by about ten
seconds. And **Parquet reverses the engine ranking**: Firefox is roughly twice as fast as Chromium,
the opposite of D2's finding that Firefox is 1.5–2× slower on Arquero work. Engine ranking is
per-operation, not global, and this report now contains examples in both directions.

On the 273 ms: re-running hyparquet-writer in Node 26 against *this* probe's data shape gives
**933 ms**, so R3's figure describes a narrower dataset and the like-for-like browser penalty is
**1.65×**, not 5.7× [34].

Moving both to a worker (the export libraries inlined into the worker body, as the build would
inline them):

| Export | Rows | Main-thread block | Worker block | Worker total | Block removed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Parquet | 500,000 | 9,717 ms | **294.7 ms** | 10,994.8 ms | 97 % |
| xlsx | 100,000 | 4,943.8 ms | **242.3 ms** | 5,271.5 ms | 95 % |
| xlsx | 500,000 | 26,269.7 ms | **1,332 ms** | 26,040.6 ms | 95 % |

Across all eight main-versus-worker pairs the worker **removes 88–98 % of the block** and costs
between **−0.9 % and +18.8 % in elapsed time** — the overhead is largest on the *shortest* job
(Parquet at 100k, +18.8 %) and vanishes on the longest (xlsx at 500k, −0.9 %, i.e. inside the noise).
For an operation measured in tens of seconds that is not a close call; for one measured in hundreds
of milliseconds it would be.

### Three library traps that only appear on the worker path

**A write-excel-file sheet cannot cross a thread boundary.** Its cell `type` field holds the native
`Number` / `String` *constructor*, and structured clone refuses it —
`DataCloneError: function Number() { [native code] } could not be cloned`. The worker must receive
plain rows and build the sheet itself [34]. This is why the xlsx worker path above sends *rows*
while the Parquet path sends *columns*, and why xlsx's block is the larger of the two at equal row
count: it matches the shape table exactly.

**`await writeXlsxFile(sheet)` silently does nothing.** The call returns
`{ toBlob(), toFile(fileName) }`; awaiting it yields the builder, performs no work, throws nothing.
This probe measured xlsx export at 37.9 ms for 100,000 rows before the mistake surfaced. The correct
call is `await writeXlsxFile(sheet).toBlob()`.

This **resolves R3's finding rather than repeating it.** R3 recorded `filePath` as "a documented
silent no-op" and concluded "verify options took effect rather than trusting its README". The
mechanism is now identified: the option was **removed in 4.0**, the README documents the removal at
the top (*"Old: `await writeExcelFile(data, { filePath: … })`" / "New: `await writeExcelFile(data).toFile(…)`"*),
and the same README still carries a v3 example further down describing `filePath` and `blob: true`
[41]. The library is not lying; its README disagrees with itself across the 3 → 4 boundary. R3's
advice stands; its diagnosis should be restated.

**`codec: 'GZIP'` writes a file that Parquet readers refuse.** hyparquet-writer 0.16.3 registers one
compressor by default and falls back to raw bytes for any other codec — while still recording the
requested codec in the column metadata. Verified against an independent reader [34][42]:

| Request | Bytes (2,000 × 4 probe) | pyarrow 25.0.0 |
| --- | ---: | --- |
| `codec: 'SNAPPY'` (default) | 38,819 | OK |
| `codec: 'UNCOMPRESSED'` | 101,550 | OK |
| `codec: 'GZIP'` | **101,550 — byte-identical to uncompressed** | **`OSError: GZipCodec failed: unknown compression method`** |
| `codec: 'GZIP'` + `compressors: { GZIP: fflate.gzipSync }` | **16,386** | OK |

The default is documented; the *failure mode* is not — an unregistered codec neither throws nor
warns. The fix is one option, and R3 already put `fflate` in the bundle for exactly this. GZIP is
**2.4× smaller than SNAPPY** here, so it is worth having rather than avoiding. **This also qualifies
R3's statement that hyparquet-writer's output "was read correctly by pyarrow 25, DuckDB 1.5.5 and
Polars 1.43.2 across three codecs":** out of the box, only SNAPPY is safe.

### R3's leftover, settled: `read-excel-file` never creates a worker

R3 left open whether `read-excel-file`'s internal worker (dependency `worker-f`) survives `file://`,
since its README both claims and retracts it. Read from the shipped 9.3.5 source [38]: the question
does not arise, because **the worker path is dead code**. `parseSpreadsheetContents.js` hardcodes
`var CAN_USE_WORKER = false`, the entire `createWorkerFunction` call site is commented out, and
`worker-f` is imported and passed from argument to argument without ever being invoked. The
README's retraction is the accurate half.

Had it run, it would have worked: `worker-f`'s browser path constructs
`new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))` — a classic worker
from a blob URL, which is precisely the construction R2 measured as working from `file://` [38]. The
documented fallback (`read-excel-file/web-worker`) is therefore not needed.

**One consequence reaches beyond this question:** the shipped UMD bundle still contains **2
occurrences of `new Worker` and 2 of `createObjectURL`** as dead weight [38] — a false positive for
R6's hard-gate scan of built artefacts. See D3's build-gate finding below.

### The build gate, exercised with a real worker at last

R2 wrote two build rules that no querbeet build had ever tested, because the Editor spike's artefact
contains zero `new Worker` occurrences. Built both ways, with hyparquet-writer and fflate inlined
into the worker so the hard case is the one measured [35]:

| | `./exportWorker.js?worker&inline` | `new Worker(new URL(…), {type:'module'})` |
| --- | --- | --- |
| Files in `dist/` | **1** (62,612 B) | **2** — a 607 B stub plus a 61,493 B worker chunk |
| Chromium 151 from `file://` | **worker ran** (56.4 ms) | **`SecurityError: … cannot be accessed from origin 'null'`** |
| Firefox 153 from `file://` | **worker ran** (47 ms) | **worker ran** (36 ms) |

Both rules hold, and `vite build` reports success in both cases — which is the whole argument for
making "exactly one file" a gate rather than a habit.

**One thing R2's rule did not have: the idiomatic form fails in Chromium only.** Firefox 153 loads a
sibling worker script from `file://` without complaint. That makes the trap *worse*, not milder,
because Chromium is the lead browser: a developer who checks the two-file build in Firefox sees a
working app and ships an artefact that fails on the browser every colleague has.

**And `new Worker` is now a poor gate signal.** The *correct* artefact contains two occurrences of it
plus a `createObjectURL`, because inlining a worker **requires** blob-URL construction — the string
R6's screening treats as a hazard is also the signature of the fix. Together with the dead
`read-excel-file` occurrences, a built artefact can contain `new Worker` for three reasons and only
one is a failure. **Grep `new Worker` to start a question, never to answer one.** The reliable gate
is the file count plus opening the artefact from a real `file://` URL in *both* engines.

### Confidence and what remains open

Every figure in this dimension is an original browser measurement made this run, from a real
`file://` URL, in both engines, with the harnesses preserved in `imports/`. The `read-excel-file`
finding is a source read of the shipped package, which is as primary as it gets. Two claims are
independently corroborated: the lazy/eager deserialize split by the HTML Standard and by a
third-party write-up [39], and the Parquet GZIP defect by pyarrow 25 refusing the file [42].

Open:

1. **Persisting to IndexedDB from a worker was not measured.** R9 projects ~1.5 s (Chromium) /
   ~3.7 s (Firefox) at half a million rows and IndexedDB is available inside workers, but the
   combination — transfer the data once, then persist from the worker — is inferred here rather
   than measured. Given the transfer cost above, the design that works is "the worker already holds
   the data", and that is a spike, not research.
2. **The `typed` shape is a synthetic contrast, not a design.** It shows the lever exists; what
   fraction of real querbeet columns are numeric is R5's question.
3. **CSV and JSON parsing were not re-measured in a browser.** R3's figures for those remain Node.
4. **`toJSON()`'s allocation profile** stays open from D2 and would matter for a JSON export path.

Dimension stopped on **coverage**: every question in the brief is answered, and the load-bearing
claim — that transfer, not work, decides what belongs in a worker — is measured in both shapes, both
sizes and both engines.

---

## D4 — Responsiveness patterns

### The short answer

**Nothing in the responsiveness brief turned out to be a problem, and one thing that was assumed to
be a design question is already answered by the numbers.** The 30-Step graph recomputes in 496 ms
(Chromium) / 1,394 ms (Firefox) at half a million rows; memoizing per Step drops an edit at the last
Step to **24 ms**; full-dataset search over 19.5 million cells costs **~430 ms** and chunks to a
2–3 ms longest block; and the Editor and the table show **no measurable contention at 30 Steps**,
with the frame interval locked at 60 Hz through real pointer drags and a 30-node ResizeObserver
storm [36][37].

Four answers, in the brief's own order.

### 1. Recompute-all versus memoize-per-Step: memoize, and it is nearly free

A 30-Step graph at the PRD's full scale — five 100,000-row Sources unioned, left-joined to a 5,000-row
lookup, filtered, then twenty-two further Steps — costs this [36]:

| | Chromium 151 | Firefox 153 |
| --- | ---: | ---: |
| Full recompute, all 30 Steps | **496.4 ms** | **1,394 ms** |
| Heap for all 30 intermediates held | **180 MB** | — |
| Sources alone (500,000 rows) | 216.9 MB | — |

The per-Step breakdown extends D2-a's rule from 8 Steps to 30 without amendment: **the join
(85.6 / 179 ms) and the concat (44.9 / 94 ms) are the price; twenty-two derives at 22–26 ms
(Chromium) / 90–98 ms (Firefox) are noise.** Branching is free, combining is not — still true at
30 Steps.

What memoization buys depends entirely on *where* the edit is, and the relationship is close to
linear in tail length [36]:

| Edit at | Steps in tail | Chromium | Firefox |
| --- | ---: | ---: | ---: |
| Step 0 (`union`) | 25 | 578.6 ms | 1,156 ms |
| Step 10 (`orderby`) | 15 | 251.3 ms | 534 ms |
| Step 20 (`derive`) | 5 | 88.8 ms | 203 ms |
| **Step 24 (last)** | **1** | **24.1 ms** | **54 ms** |

**Editing the last Step of a 30-Step graph costs 24 ms memoized against 496 ms recomputed — a factor
of 20, and 26 in Firefox.** Recompute-all is survivable; at 1.4 s per edit in Firefox it is not
pleasant. Memoize.

Two things make this an easy call rather than a trade. D2-a already established that holding every
Step output alive is affordable, and this measures the bill at full scale: **180 MB for a 30-Step
graph over half a million rows**, on top of Sources that cost more. And the cache has nowhere else
to live: the Editor spike settled that datasets never enter the graph model and tables live in a
`shallowRef` registry keyed by id — the per-Step cache is the same registry shape, which is a data
structure the app already has.

The one case memoization cannot help is an edit at the first Step, which is a full recompute by
definition (578.6 / 1,156 ms). That is the number to design the progress affordance against.

### 2. Editor / table contention at 30 Steps: there is none

Measured against the Editor spike's own build with a real virtualized table pane beside the canvas —
D1's shape, 50 rows over a `rowCount × 32 px` spacer, a frozen 100,000 × 20 dataset behind it — with
the Step count dialable between 6 and 30, and with genuine Playwright pointer drags running
*concurrently* with a 200-swap loop [37]:

| Case | Swap p50 (Chromium) | Swap p50 (Firefox) | Frame p50 | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: |
| 6 Steps, canvas idle | 3.1 ms | 5 ms | 16.7 / 17.02 ms | **0** |
| 6 Steps, node dragging | 2.9 ms | 4 ms | 16.7 / 17.02 ms | **0** |
| 30 Steps, canvas idle | 2.9 ms | 4 ms | 16.7 / 17.02 ms | **0** |
| **30 Steps, node dragging** | **2.9 ms** | **4 ms** | 16.7 / 17.02 ms | **0** |
| **30 Steps, all 30 bodies resizing** | **2.9 ms** | **4 ms** | 16.7 / 17.02 ms | **0** |

The swap costs the same at 30 Steps as at 6, the same while a node is dragged as while the canvas is
idle, and the same during a resize storm. **Not one frame exceeded 50 ms in either engine across
2,800 swaps**, and the frame interval never left 60 Hz.

**The mechanism the brief named is real, and it is cheap.** Driving every node's height from a CSS
custom property moves all 30 boxes at once — 38.7–92.2 px to 60.1–113.6 px — firing 30
`ResizeObserver` callbacks plus the relayout. The whole operation costs **32.2 ms (Chromium) /
33 ms (Firefox), once**. It is a one-off cost on a deliberate action, not a per-frame tax, and the
swap loop running through it never noticed.

Cold graph rebuild at 30 Steps: **50.1 ms (Chromium) / 67 ms (Firefox)**; warm rebuilds cost 33 ms.
That is not the same quantity as R6's 62.4 / 61 ms full page mount at 3–4 nodes, but what the two
jointly support is that **node count is not where the cost lives**. **This closes R6's open
question 2.**

The build still gates clean with the second pane and the 30-node graph added: exactly one file,
251,127 B, zero occurrences of every hazard string, zero requests beyond the document in both
engines [37].

### 3. Full-dataset search (FR-33): no worker, no index

Scanning the final 500,000 × 39 result — 19.5 million cells — three ways [36]:

| Method | Chromium | Firefox |
| --- | ---: | ---: |
| **Column scan** (`t.column(name)`, zero allocation) | **431.6 / 405.5 ms** | **433 / 458 ms** |
| `t.objects()` then scan rows | 674 / 611.2 ms | 828 / 700 ms |
| **Chunked column scan**, 25,000 rows per chunk | longest block **2.2 / 1.8 ms** | longest block **3 / 3 ms** |

D2's primitive is the right one: the column scan is 1.6× (Chromium) / 1.9× (Firefox) faster than
materialising rows and allocates nothing. **Chunking makes it free** — a yield every 25,000 rows puts
the longest uninterrupted block at 2–3 ms, comfortably inside a frame, with no measurable cost to the
total. FR-33 needs neither a worker nor an index; it needs a `for` loop with a yield in it.

Worth noting because it is unusual in this report: **the engines are equal here** (431.6 vs 433 ms).
Firefox's penalty in D2 was on Arquero's own machinery and on `objects()`, not on reading a backing
array.

### 4. Progress and cancellation for what D3 puts in a worker

**The usual mechanism is unavailable, and the API surface lies about it.** A `file://` page sends no
headers, so it can never be cross-origin isolated and the `SharedArrayBuffer` constructor is hidden
in both engines. MDN documents an escape hatch — `new WebAssembly.Memory({shared: true}).buffer` is
a SharedArrayBuffer regardless [40] — and it does produce one in Chromium 151 and Firefox 153. It is
still useless: **both engines refuse to post it** [34].

| Engine | `WebAssembly.Memory` buffer | `postMessage(buffer)` |
| --- | --- | --- |
| Chromium 151 | `SharedArrayBuffer` | **`DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated.`** |
| Firefox 153 | `SharedArrayBuffer` | **`DataCloneError: The SharedArrayBuffer object cannot be serialized…`** |

`Atomics.wait` exists in the worker in both engines, so a probe that only checked `typeof Atomics`
would have concluded the opposite. **There is no shared cancellation flag on this platform.**

That turns out not to matter, because the message queue is fast enough and the chunking a worker
needs anyway is what makes it work [34]:

| Chunk size (work between yields) | Cancel latency, Chromium | Firefox |
| --- | ---: | ---: |
| ≈5 ms | **3.0 ms** | **2 ms** |
| ≈50 ms | **17.2 ms** | **7 ms** |

Cancellation latency is a function of chunk size and nothing else. **And progress is effectively
free:** 100 progress messages over 571 ms of work cost about 15 ms — 2.6 %. There is no reason to be
stingy with progress granularity.

The practical shape, then: a worker that chunks its work, posts progress freely, and checks a
plain boolean set by a `cancel` message between chunks. No shared memory, no `Atomics`, nothing
exotic.

### Confidence and what remains open

Every claim here is an original measurement made this run, in both engines, from a real `file://`
URL — and the contention measurement runs against the **Editor spike's own build** rather than a
test double, which is what makes it an answer to R6's question rather than an analogy.

Two of these measurements were wrong before they were right, and both are recorded in the import
notes because the failure mode is instructive. The swap measurement first read layout *before* Vue
had patched the DOM and reported 0.1 ms — the cost of laying out the old document. The
"ResizeObserver storm" first lengthened node *names*, which live in fixed-height inputs, so no node
height changed and no storm occurred; the giveaway was that the height range was byte-identical to
the un-stormed cases.

Open:

1. **One non-reproducing observation.** An earlier run of the contention harness showed Firefox at
   30 Steps with a drag producing 8 frames over 50 ms. It did not reproduce in the clean run (zero
   long frames). The earlier run shared the machine with an npm install and two Vite builds. The
   clean run is the result — but the episode is a fair warning that a *loaded* machine degrades this,
   and users' machines are loaded.
2. **30 Steps is the PRD's ceiling, not a stress test.** Nothing here says where the cliff is; it
   says there is no cliff below 30.
3. **The graph is one shape.** A 30-Step graph with several joins rather than one would cost more,
   and joins are the whole price — a 5-join graph is the case to check before anyone promises a
   number.
4. **Search was measured on synthetic ~16-character strings.** Wider real values raise the scan time
   roughly proportionally.
5. **Firefox heap figures are absent throughout**, as in D2 — the engine exposes no
   `performance.memory`.

Dimension stopped on **coverage**: all four brief questions are answered with measurements, and the
one that was structural — where a per-Step cache lives — was already settled by the Editor spike.

---

## Sources

| # | Source | Publisher | Date | Accessed |
| --- | --- | --- | --- | --- |
| 1 | [Bug 1527883 — maximum element dimension 17,187,496 px](https://bugzilla.mozilla.org/show_bug.cgi?id=1527883) | Mozilla Bugzilla | filed 2019, status NEW | 2026-08-01 |
| 2 | [TanStack/virtual issue #616 — max height](https://github.com/TanStack/virtual/issues/616) | GitHub / TanStack | open | 2026-08-01 |
| 3 | [TanStack/virtual issue #685 — blank page on two-axis scroll](https://github.com/TanStack/virtual/issues/685) | GitHub / TanStack | open | 2026-08-01 |
| 4 | [TanStack/virtual discussions #917, #872 — sticky columns](https://github.com/TanStack/virtual/discussions/917) | GitHub / TanStack | — | 2026-08-01 |
| 5 | [TanStack/virtual issue #640 — sticky header disappears](https://github.com/TanStack/virtual/issues/640) | GitHub / TanStack | — | 2026-08-01 |
| 6 | [react-virtualized issues #424, #995, #610 — dynamic height drift](https://github.com/bvaughn/react-virtualized/issues/424) | GitHub | 2016–2018 | 2026-08-01 |
| 7 | [angular/components issue #10127 — cannot detect native Ctrl+F](https://github.com/angular/components/issues/10127) | GitHub / Angular | opened 2018-02-23, open | 2026-08-01 |
| 8 | [Virtual Scroller explainer](https://wicg.github.io/virtual-scroller/) | WICG | — | 2026-08-01 |
| 9 | [content-visibility and the scrollbar problem](https://adithya.dev/content-visibility-and-the-scrollbar-problem/) + [CSS-Tricks almanac](https://css-tricks.com/almanac/properties/c/content-visibility/) + [DebugBear](https://www.debugbear.com/blog/content-visibility-api) | various | 2021-03-12 / — | 2026-08-01 |
| 10 | [ARIA Authoring Practices — Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) | W3C WAI | — | 2026-08-01 |
| 11 | [npm registry: @tanstack/vue-virtual, vue-virtual-scroller, vue3-virtual-scroll-list](https://registry.npmjs.org/@tanstack%2Fvue-virtual) | npm registry | 3.13.35 / 2026-07-28 | 2026-08-01 |
| 12 | [npm registry: virtua](https://registry.npmjs.org/virtua) + [bundlephobia](https://bundlephobia.com/api/size?package=virtua) + jsDelivr artifact | npm / bundlephobia / self-measured | 0.50.0 / 2026-07-25 | 2026-08-01 |
| 13 | [virtua README](https://github.com/inokawa/virtua) + [vue-virtual-scroller README](https://github.com/Akryum/vue-virtual-scroller) | inokawa / Akryum | — | 2026-08-01 |
| 14 | [@tanstack/vue-virtual adapter source](https://raw.githubusercontent.com/TanStack/virtual/main/packages/vue-virtual/src/index.ts) | TanStack (GitHub) | main @ 2026-08-01 | 2026-08-01 |
| 17 | [primevue@5.0.0 LICENSE.md](https://unpkg.com/primevue@5.0.0/LICENSE.md) + [@primeui/license-manager](https://registry.npmjs.org/@primeui/license-manager) | PrimeTek (package artifact) | 2026-07-15 | 2026-08-01 |
| 18 | [PrimeUI next chapter](https://primeui.dev/nextchapter) + [Hacker News 48860682](https://news.ycombinator.com/item?id=48860682) + [primevue master LICENSE.md](https://github.com/primefaces/primevue/blob/master/LICENSE.md) | PrimeTek / HN / GitHub | ~2026-06/07 | 2026-08-01 |
| 19 | [npm registry: ag-grid-community, ag-grid-vue3](https://registry.npmjs.org/ag-grid-community) + bundlephobia | npm / bundlephobia | 36.0.2 / 2026-07-22 | 2026-08-01 |
| 20 | [AG Grid licence & pricing](https://www.ag-grid.com/license-pricing/) | AG Grid (vendor) | 2026 | 2026-08-01 |
| 21 | [jsDelivr artifacts: tabulator-tables@6.5.2, vue-virtual-scroller@3.0.4 CSS, ag-grid-community@36.0.2 styles](https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.2/dist/) | npm artifacts, self-inspected | 2026-06-23 / 2026-05-20 | 2026-08-01 |
| 22 | [npm registry: @revolist/vue3-datagrid](https://registry.npmjs.org/@revolist/vue3-datagrid) + bundlephobia | npm / bundlephobia | 4.24.2 / 2026-07-29 | 2026-08-01 |
| 23 | [npm registry: vxe-table](https://registry.npmjs.org/vxe-table) | npm registry | 4.20.9 / 2026-07-28 | 2026-08-01 |
| 24 | **Original measurement** — `imports/render-probe-measurement-2026-08-01.md`, raw data in `imports/render-probe-raw.json`, `imports/scroll-extent-ladder.json`, `imports/element-height-boundary.json`; harness `imports/render-probe.html`, `imports/run-render-probe.mjs`, `imports/scrollext.html` | this run — Chromium 151.0.7922.34 / Firefox 153.0, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 26 | [CSSWG issue #9833 — content-visibility and scroll anchoring](https://lists.w3.org/Archives/Public/public-css-archive/2024Nov/1036.html) | W3C public-css-archive | 2024-11 / 2025-02 | 2026-08-01 |
| 27 | [Arquero 8.0.3 source: `src/table/Table.js`, `columns-from.js`, `BitSet.js`, `ColumnSet.js`, and `src/verbs/{filter,select,slice,orderby,derive,join,concat,groupby,rollup}.js`](https://cdn.jsdelivr.net/npm/arquero@8.0.3/src/table/Table.js) | uwdata/arquero via jsDelivr | 8.0.3, 2025-05-29 | 2026-08-01 |
| 28 | [Arquero API reference — Table](https://idl.uw.edu/arquero/api/table.html) | UW Interactive Data Lab | undated | 2026-08-01 |
| 29 | [npm registry: arquero](https://registry.npmjs.org/arquero) | npm registry | 8.0.3, 2025-05-29 | 2026-08-01 |
| 30 | [uwdata/arquero releases](https://github.com/uwdata/arquero/releases) | uwdata/arquero | 8.0.0–8.0.3 | 2026-08-01 |
| 31 | **Original measurement** — `imports/arquero-browser-measurement-2026-08-01.md`, raw data in `imports/arquero-probe-chromium.json` and `imports/arquero-probe-firefox.json`; harness `imports/arquero-browser-probe.html`, `imports/run-arquero-probe.mjs` | this run — Arquero 8.0.3 in Chromium 151.0.7922.34 / Firefox 153.0, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 32 | **Original measurement** — Checkpoint D2-a: `imports/arquero-graph-measurement-2026-08-01.md`, raw data in `imports/arquero-graph-chromium.json`; harness `imports/arquero-graph-probe.html`, `imports/run-graph.mjs` | this run — Arquero 8.0.3 in Chromium 151.0.7922.34, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 33 | **Original measurement** — D3/M1 structured clone across a worker boundary: `imports/transfer-measurement-2026-08-01.md`, raw `imports/transfer-chromium.json`, `imports/transfer-firefox.json`; harness `imports/transfer-probe.html`, `imports/run-transfer.mjs` | this run — Chromium 151.0.7922.34 / Firefox 153.0, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 34 | **Original measurement** — D3/M2 + D4/M8 export cost, SharedArrayBuffer availability, cancellation and progress: `imports/export-measurement-2026-08-01.md`, raw `imports/export-chromium.json`, `imports/export-firefox.json`, `run-sab.mjs` output; harness `imports/export-probe.html`, `imports/run-export.mjs`, `imports/sab-probe.html`, `imports/run-sab.mjs` | this run — write-excel-file 4.1.1 and hyparquet-writer 0.16.3 in Chromium 151 / Firefox 153, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 35 | **Original measurement** — D3/M4 one-file build gate with a real Worker: `imports/worker-build-measurement-2026-08-01.md`, raw `imports/worker-build.json`; harness `imports/worker-build-app/` (two Vite builds), `imports/run-worker-build.mjs` | this run — Vite 8.2.0 + vite-plugin-singlefile 2.3.3, Chromium 151 / Firefox 153, `file://` | 2026-08-01 | 2026-08-01 |
| 36 | **Original measurement** — D4/M5 + M7 30-Step recompute, memoization and full-dataset search: `imports/pipeline-measurement-2026-08-01.md`, raw `imports/pipeline-chromium.json`, `imports/pipeline-firefox.json`; harness `imports/pipeline-probe.html`, `imports/run-pipeline.mjs` | this run — Arquero 8.0.3 in Chromium 151 / Firefox 153, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 37 | **Original measurement** — D4/M6 Editor / table contention at 30 Steps: `imports/contention-measurement-2026-08-01.md`, raw `imports/contention.json`; harness `imports/editor-table-app/` (the Editor spike's build plus a virtualized table pane), `imports/run-contention.mjs` | this run — Vue Flow 1.48.2 in Chromium 151 / Firefox 153, `file://`, headless | 2026-08-01 | 2026-08-01 |
| 38 | [read-excel-file 9.3.5 shipped source: `modules/xlsx/parseSpreadsheetContents.js`, `modules/export/readXlsxFileBrowser.js`, `bundle/read-excel-file.min.js`; worker-f 0.1.13 `lib/environment/createWorkerInBrowser.js`](https://registry.npmjs.org/read-excel-file) | npm package artefacts, self-inspected | 9.3.5 / worker-f 0.1.13 | 2026-08-01 |
| 39 | [HTML Living Standard 2.7 "Safe passing of structured data"](https://html.spec.whatwg.org/multipage/structured-data.html) + ["Is postMessage slow?"](https://surma.dev/things/is-postmessage-slow/) | WHATWG / surma.dev | living / — | 2026-08-01 |
| 40 | [MDN — SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) | MDN Web Docs | last modified 2026-02-10 | 2026-08-01 |
| 41 | [write-excel-file 4.1.1 README](https://registry.npmjs.org/write-excel-file) + [hyparquet-writer 0.16.3 README and `src/write.js`, `src/parquet-writer.js`, `src/datapage.js`](https://registry.npmjs.org/hyparquet-writer) | npm package artefacts, self-inspected | 4.1.1 / 0.16.3 | 2026-08-01 |
| 42 | Cross-check of hyparquet-writer output with an independent reader — `pq.read_table()` on files written by `codec: SNAPPY / UNCOMPRESSED / GZIP` and by `GZIP` + explicit `compressors` | pyarrow 25.0.0, run this session | 2026-08-01 | 2026-08-01 |

## Staleness map

| Claim class | Re-check after | Note |
| --- | --- | --- |
| Library versions and release dates [11][12][19][22][23] | 1 month | The field moves; TanStack shipped 8 releases in 2 months |
| Licence status [17][18][20] | 3 months | PrimeVue just relicensed mid-flight; treat every "MIT" as perishable |
| Browser element-height limits [24] | 12 months | Firefox bug 1527883 is open; a fix would raise the cliff |
| Own timings [24] | on browser major-version change | Re-run `run-render-probe.mjs`; it is self-contained |
| Failure-mode reports [3][4][5][6] | 2 years | Patterns, not versions |
| Arquero version and dependencies [29][30] | 3 months | 8.0.3 is over a year old (2025-05-29); a 9.x would invalidate the verb table |
| Arquero memory and verb semantics [27][31] | on Arquero major version | Read from 8.0.3 source; internals are not a documented contract |
| Structured-clone and worker timings [33][34] | on browser major-version change | Re-run `run-transfer.mjs` and `run-export.mjs`; both are self-contained |
| SharedArrayBuffer availability from `file://` [34][40] | 12 months | A platform policy, not a library one — but policies about opaque origins do move |
| Export library versions and defects [34][41][42] | 3 months | write-excel-file 4.1.1 and hyparquet-writer 0.16.3; the GZIP defect is a fixable bug and may be fixed |
| `read-excel-file`'s dead worker path [38] | on minor version | `CAN_USE_WORKER = false` is one line away from being flipped back on |
| Vite worker build behaviour [35] | on Vite major version | Vite 8.2.0 today; rule 1 is a build-tool behaviour, not a browser one |
| Contention and 30-Step figures [36][37] | on Vue Flow or Arquero major version | Both harnesses rebuild and re-run in minutes |

A selection report older than two quarters should be refreshed before anyone acts on it.
