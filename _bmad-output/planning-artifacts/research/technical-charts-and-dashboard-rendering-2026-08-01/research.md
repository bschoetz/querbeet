---
title: 'Technical research: Charts and dashboard rendering'
type: 'technical'
topic: 'Charts and dashboard rendering (R7)'
decision: "Which chart library renders querbeet's Dashboard tiles (bar, line, Top-N/Bottom-N, key figure) under single-file offline constraints — or hand-written SVG"
source: 'native run (web fan-out + own measurement)'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-08-01'
updated: '2026-08-01'
---

# Technical research: Charts and dashboard rendering

**Decision this research serves:** Which chart library renders querbeet's Dashboard tiles (bar,
line, Top-N/Bottom-N, key figure) under single-file offline constraints — or hand-written SVG.

## Executive summary

**Recommendation: hand-written SVG, with Apache ECharts 6.1.0 in SVG mode as the named runner-up**
(93 against 84 on the weighted matrix). Five candidates were built as real single-file Vite
artefacts and opened from a `file://` URL in Chromium 151 and Firefox 153 — measured, not compared
on paper.

**The gate that was expected to separate the field separated nothing, again.** All six artefacts
build to exactly one HTML file, contain zero occurrences of `import(`, `fetch(`, `new Worker`,
`importScripts`, `@font-face` or a non-`data:` `url()`, and issue **zero network requests beyond the
document** in both engines with no page errors. R6 found the same thing about graph editors. The
lazy-loading hazard is real — R6 measured `@maxgraph/core` fetching four `.gif` files by relative
URL — but nothing in *this* field was caught doing it: every published bundle round 1 grepped came
back with zero `fetch(`, zero dynamic `import(` and zero `wasm`, at medium confidence, since the grep
covered UMD/IIFE builds rather than the ESM entry points Vite consumes.

**What decides it is the printed page, and the answer is sharper than the folklore.** No canvas chart
printed blank — the canonical Firefox bug behind that belief was closed as INVALID, its actual cause
being the browser's "print backgrounds" setting. What happens instead is that **a canvas chart enters
a PDF as a raster at CSS-pixel size while an SVG chart enters as vector plus selectable text**.
Measured in Chromium, the only engine Playwright can print from: the three SVG artefacts printed
95–131 words of real text carrying 21–35 of the application's own formatted axis labels and **zero**
raster images; the three canvas artefacts
printed 12 words — the page headings — and six images each. The raster's resolution tracks
`devicePixelRatio` exactly (620×300 → 1240×600 → 1860×900 across three scales), so a canvas chart in
a printed document is bounded by the *screen's* pixel ratio at print time, never by the print
resolution. FR-37 weights this at 25 and it is the criterion the two canvas candidates lose on.

**Three assumptions the measurement overturned.**

- **Volume is not a problem for anyone, and no decimation is needed.** Half a million raw points
  render in 55–505 ms across all five candidates with decimation configured on none of them. uPlot is
  flat across the entire ladder — 500k costs 54.7 ms against 62.9 ms for 1k. The whole downsampling
  question, which round 1 spent real effort on, does not arise at querbeet's scale.
- **The SVG renderer is not penalised at volume, because a line series is one element.** ECharts' SVG
  output held 50–56 DOM nodes at *every* rung from 1,000 to 500,000 points. The handbook's "canvas
  above roughly 1k elements" guidance counts elements, and a line series does not produce one per
  point.
- **No candidate mutates frozen input and none throws on it.** Round 1 could evidence this for none
  of the five; gate G5 is passed by all. One conditional survives: Chart.js's decimation plugin is
  documented to redefine `data` on the dataset, and it is off by default and was not enabled.

**Two ECharts traps, both measured.** `renderToSVGString()` works on an ordinary non-SSR instance in
SVG mode, contradicting the handbook — but in canvas mode **`getDataURL({type: 'svg'})` silently
returns a PNG**, same call, no error, no warning. And the 2019 hidden-container complaint **does not
reproduce against 6.1.0**: all six candidates recovered full width after being shown, in both
engines, under an explicit pixel size.

**The strongest argument against the recommendation is scope, and it cuts both ways.** FR-35 asks for
exactly **two** chart kinds — a Top-N list is a table and a key figure is a number — configured
through one small form with no stacking, no dual axes, no log scales and no zoom. That is what makes
hand-building affordable. What the probe did *not* build is tooltips, legends, and the edge cases of
a tick algorithm: all-zero columns, negative values, a single category, very long labels. Those are
where a chart library earns its size.

**The one thing a hand-built path gets wrong for free, and it is this report's own bug:** the
hand-written SVG carries `class` references whose styling lives in the document stylesheet, so a
naively serialized snapshot arrives in the export document **unstyled**. ECharts writes pure inline
attributes and Observable Plot emits a `<style>` child inside the SVG; both are self-contained by
construction. Whoever builds this must inline the chart's styling into the SVG node — a constraint on
the CSS approach R5 is deciding, not a CSS decision made here.

## Requirements frame

Set from the project (PRD FR-35, FR-37, NFR-1–NFR-5; research plan R7; prior runs R2, R4, R6),
not from the web. Agreed at the plan gate 2026-08-01.

**Hard gates.** A candidate failing any one is cut, whatever else it offers.

| | Gate | Where it comes from |
| --- | --- | --- |
| G1 | Builds into exactly one HTML file and fetches nothing at runtime; opens from a real `file://` URL in Chromium and Firefox with zero network requests beyond the document and no page errors | NFR-1, NFR-2; the gate shape is R6's |
| G2 | Permissive licence, no runtime key, no eligibility gate — read from the LICENSE in the published npm package, not the repository | R4's PrimeVue finding |
| G3 | Released within the last 12 months | research plan, global constraints |
| G4 | No external stylesheet and no web font | NFR-2; R5 owns the CSS framework decision, this is only a gate |
| G5 | Accepts an `Object.freeze`d array without cloning, sorting in place or mutating it | R2's frozen-dataset rule |

**Weighted criteria.**

| Criterion | Weight |
| --- | --- |
| Static export fidelity (FR-37): SVG or canvas, and what survives into a printed/PDF page | 25 |
| Data volume: what actually reaches a tile, and whether the library needs downsampling | 20 |
| Resize inside a fixed grid with three preset size steps | 15 |
| App-supplied formatter hooks for axis ticks and labels | 15 |
| Footprint | 10 |
| Ecosystem health / five-year regret risk | 10 |
| Vue 3 ergonomics (`<component :is>` per tile kind) | 5 |

**Excluded by the plan gate, because R5 is running in parallel:** the CSS framework choice, and the
German number/date format itself. This run establishes only whether a candidate accepts a formatter
supplied by the app — every one does, so R5's answer plugs into any of them.

## The candidate screen

The field is fifteen packages: the plan gate's own list, plus three wildcards an npm keyword search
added that nobody had named — `lightweight-charts`, `ag-charts-community` and `apexcharts` [1]. That
search is a discoverability finding in its own right: of the briefed names only chart.js, echarts,
highcharts and amCharts rank under `keywords:charts` at all, while uPlot, Observable Plot, vega-lite,
frappe-charts, billboard.js, `@unovis/vue`, chartist and layerchart do not [1].

**Cut on G2, licence, all three confirmed by reading the LICENSE inside the published package rather
than the repository** [4]:

- **Highcharts 13.0.0** — `LICENSE.txt` places commercial use under the Highsoft Standard License
  Agreement and non-commercial use under a separate EULA. Proprietary; the npm `license` field is
  literally a URL.
- **amCharts 5.20.0** — a "linkware" licence, free for any project including commercial ones but
  conditioned on displaying an attribution link. A branding-gated free tier, not an OSI licence.
- **ApexCharts 6.6.1** — and this is the one worth carrying forward. **ApexCharts left MIT inside the
  window this research covers.** Versions 1.0.1 through 5.0.0 — 231 releases — declare MIT; 5.2.0,
  published 2025-07-09 roughly seven minutes after 5.1.0, declares an ApexCharts License; the current
  LICENSE is a dual model whose free Community tier is restricted to individuals, non-profits,
  educators and businesses under **USD 2 million annual revenue** [5]. This is the second instance in
  two research runs of a library relicensing mid-flight, after R4 found PrimeVue doing it. **Treat
  every "MIT" as perishable** is now evidenced twice, not once.

**Cut on G3, released within 12 months:**

- **frappe-charts** — npm `latest` is 1.6.2 from 2021-06-16, five years old, with zero releases and
  zero issues closed in the last twelve months [2][8]. Note a discoverability trap: GitHub's latest
  release is v1.6.3 from 2022, a tag **never published to npm**, so anyone quoting "1.6.3" is quoting
  something not installable.
**Cut on vitality rather than on a gate**, recorded separately because it passes G3 as written:

- **chartist 1.5.0** (2025-09-30) sits inside the twelve-month window, so G3 does not touch it. What
  cuts it is throughput — **one issue closed against 244 open** in twelve months [8] — plus a licence
  declared `MIT OR WTFPL` in npm metadata that could not be verified against a LICENSE file.

**Cut on structure, reason recorded:**

- **Vega-Lite 6.4.3** — declares a peer dependency on `vega ^6`, so the measured 79.4 KB gzip is the
  compiler alone and the render-time cost is that plus the entire Vega runtime [7]. Combined with
  secondary reports of interactive charts becoming unusable "into the thousands" of points [3], it is
  a large bet for two chart types.
- **layerchart 2.0.4** — Svelte-native; no evidence found that it works in Vue 3 [8].
- **`@mui/x-charts`, `visx`, `nivo`, Recharts** — React.
- **`lightweight-charts` 5.2.0** — Apache-2.0, 61.6 KB gzip, no runtime fetches, genuinely alive, and
  financial-series oriented — **whether it draws a categorical bar chart at all was raised in round 1
  and never answered**, so this is a cut on unresolved fit rather than on a demonstrated gap.
- **billboard.js 4.0.3** — MIT, NAVER, 17 releases in twelve months, second only to layerchart's 39
  and well ahead of ECharts' 3, whose vitality shows in issue throughput rather than in cadence. Not measured for budget reasons, and one finding is recorded so a later run
  does not have to repeat it: **the single `XMLHttpRequest` occurrence round 1 flagged as
  disqualifier-shaped is benign.** It sits in billboard.js's `data.url` loader — a documented feature
  that fetches CSV/TSV/JSON from a URL, reachable but inert unless the application configures a URL.
  Verified by unpacking the published 4.0.3 tarball and reading the call site. What remains against it
  is the separate `billboard.css` its docs require (inlinable at build time, so not a G4 failure) and
  149.4 KB gzip.
- **`@unovis/vue` 1.6.7** — Apache-2.0, F5-backed, Vue 3 first-class, 7 releases. Not measured, for
  budget. The strongest unexamined candidate in the field and the first thing to add if this
  selection is ever revisited.

**Measured despite failing G3 as written, deliberately:**

- **uPlot 1.6.32** (2025-03-14) and **Observable Plot 0.6.17** (2025-02-14) both have zero releases
  in twelve months [2][8]. Cutting them mechanically would have been poor research: R1 chose a
  *dormant* Arquero on a project decision, and R6 recorded that precedent as settling the dormancy
  tension. Both were built and measured; the gate failure is reported rather than hidden, and it is
  where their ecosystem score comes from.

**Finalists measured:** hand-written SVG · uPlot 1.6.32 · Chart.js 4.5.1 · Observable Plot 0.6.17 ·
Apache ECharts 6.1.0, in both its SVG and canvas renderers as two separate builds.

## Gate results

All six artefacts pass G1, G4 and G5. Full detail:
`imports/chart-probe-measurement-2026-08-01.md`.

| Candidate | `dist/` files | Bytes | gzip | Hazard greps | Extra requests | Page errors |
| --- | --- | --- | --- | --- | --- | --- |
| handbuilt | 1 | 70,795 | 28,002 | all zero | 0 | 0 |
| uplot | 1 | 120,524 | 49,887 | all zero | 0 | 0 |
| chartjs | 1 | 269,714 | 91,992 | all zero | 0 | 0 |
| plot | 1 | 340,783 | 118,636 | all zero | 0 | 0 |
| echarts-canvas | 1 | 584,928 | 202,486 | all zero | 0 | 0 |
| echarts-svg | 1 | 592,693 | 206,286 | all zero | 0 | 0 |

Byte counts are the built `dist/index.html` as recorded by the probe; gzip is `gzipSync` at level 9
over that same file, computed for this table rather than taken from the build tool's own report.

Each figure is the whole app including Vue, so a library's own share is the delta against the
handbuilt baseline: uPlot ~50 KB, Chart.js ~199 KB **including its mandatory date adapter**, Plot
~270 KB, ECharts tree-shaken ~514–522 KB raw.

**The ECharts figure is the number nobody had.** Round 1 could only offer the whole library at
367.9 KB gzip and the vendor's `echarts.simple` subset at 168.9 KB (candidate-field digest, row [6]).
Tree-shaking `echarts/core` down to two chart types and two components lands the *entire app* at
206,286 B gzip; against the hand-built baseline that puts ECharts' own share at **178.3 KB gzip**, so
tree shaking beats the vendor's prebuilt subset only slightly and the whole-library figure overstates
the real cost by roughly **52 %**.

**Chart.js's footprint is not optional.** Chart.js ships **no date adapter**, and a time axis without
one throws [9]. `chartjs-adapter-date-fns` plus `date-fns` are part of the candidate, not an extra —
which is why a canvas library with a reputation for being small measures 269 KB against Plot's 341 KB.

## Static export — the criterion that decides this

FR-37 requires the Dashboard as a self-contained static HTML file *and* as a PDF. Both were measured.

**In the snapshot**, three of six produce vector output and it is genuinely self-contained:

| Candidate | Snapshot | Bytes | External refs | Carries its own styling |
| --- | --- | --- | --- | --- |
| echarts-svg | serialized SVG | 15,639 | none | **yes** — pure inline attributes |
| echarts-svg | `getDataURL({type:'svg'})` | 15,361 | none | yes, a real `image/svg+xml` data URI |
| echarts-svg | `renderToSVGString()` | 16,495 | none | yes |
| plot | serialized SVG | 17,453 | none | **yes** — emits a `<style>` child |
| handbuilt | serialized SVG | 10,370 | none | **no** — class references, no `<style>` child |
| uplot | canvas `toDataURL` | 52,743 | n/a | raster |
| chartjs | `toBase64Image()` | 70,647 | n/a | raster |
| echarts-canvas | canvas `toDataURL` | 26,181 | n/a | raster |

Three round-1 leads close here.

1. **ECharts' `renderToSVGString()` works on an ordinary non-SSR instance** in SVG mode. The handbook
   presents `ssr: true` as required [6]; it is not. In canvas mode the call throws
   `TypeError: n.renderToString is not a function`.
2. **`getDataURL({type: 'svg'})` silently returns a PNG in canvas mode** — same call, same arguments,
   no error and no warning, `data:image/png;base64` where `data:image/svg+xml` was asked for. Asking
   for vector and being handed raster without being told is worth naming as a trap.
3. **Observable Plot's default stylesheet lands *inside* the SVG** as a `<style>` child
   (`:where(.plot-d6a7b5)…`), so a serialized Plot node is self-contained. Round 1 flagged the
   opposite as a live risk [3]; it is not one.

**In the printed page**, the split is total. Each artefact was printed through Chromium's own print
pipeline with `printBackground: true` and inspected with poppler:

| Candidate | PDF bytes | Words of real text | Formatter markers in text | Raster images |
| --- | --- | --- | --- | --- |
| plot | 43,713 | 131 | **35** | 0 |
| echarts-svg | 38,156 | 112 | **32** | 0 |
| handbuilt | 36,006 | 95 | **21** | 0 |
| chartjs | 135,478 | 12 | 0 | 6 |
| echarts-canvas | 85,778 | 12 | 0 | 6 |
| uplot | 84,429 | 12 | 0 | 6 |

The twelve words in the canvas PDFs are the page's own headings; every axis label is pixels. The
raster's resolution tracks `devicePixelRatio` exactly — 620×300 at scale 1, 1240×600 at 2, 1860×900
at 3 — so a canvas chart in a printed document is bounded by the **screen's** pixel ratio at print
time, roughly 96 dpi on an ordinary office monitor, never the 300+ dpi a vector gets for nothing.

**The folklore is dead and something more useful replaces it.** Round 1 found that the canonical
"canvas prints blank" bug, Mozilla 1696619, is RESOLVED INVALID — the cause was the browser's "print
backgrounds" setting being off [11] — and that the one reproduced library-specific print failure,
hundreds of blank pages from Chart.js, was fixed in Chart.js 3 and is stale against 4.5.1 [12]. This
measurement confirms it from the other side: nothing printed blank in Chromium. **The engine gap is
worth naming, because the folklore's own bug was a Firefox one and Playwright offers no PDF output
for Firefox** — so this is one-engine evidence against a two-engine claim. The real cost of canvas is
resolution and text, not blankness.

Two consequences reach past this run. **The browser's own print-to-PDF is a live partial answer
for FR-37's PDF half** — it produced selectable, searchable text from an SVG chart at zero library
cost, which is what R8 was told to try before researching properly. **Pagination was not exercised
and must not be read into this:** all six artefacts printed to a single page, because the probe
renders three tiles and no Result table. And **the "print background graphics" setting is a hazard
for every candidate**: a chart whose fill comes from a CSS background depends on a checkbox the page
cannot set, and when it is off the fill is simply absent — which is precisely what produced the
canvas-prints-blank report [11]. The print in this run had to pass `printBackground: true`
explicitly, because the printing API's own default is off. Whether both browsers' *print dialogs*
also default it off was not verified here; the safe rule does not depend on the answer. **Fills
belong in attributes or inline styles, not in CSS backgrounds.**

## Data volume, and the assumption that did not need defending

The plan gate refused to assume that tiles only ever render aggregates, and round 1 could not confirm
the convention from any primary source. So the counter-case was measured directly: a line series at
1k, 10k, 100k and 500k raw points, with decimation configured on no candidate.

| Candidate | 1k | 10k | 100k | 500k |
| --- | --- | --- | --- | --- |
| handbuilt (C / F) | 28.0 / 28 | 33.0 / 33 | 30.3 / 33 | **117.7 / 140** |
| uplot (C / F) | 62.9 / 59 | 64.2 / 65 | 64.7 / 66 | **54.7 / 60** |
| chartjs (C / F) | 91.4 / 72 | 64.9 / 66 | 75.1 / 63 | 185.0 / 114 |
| echarts-canvas (C / F) | 57.1 / 58 | 65.9 / 63 | 89.0 / 95 | 232.8 / 193 |
| echarts-svg (C / F) | 59.3 / 51 | 65.6 / 67 | 90.5 / 95 | 315.7 / 197 |
| plot (C / F) | 62.7 / 56 | 64.8 / 67 | 123.4 / 133 | 445.5 / 505 |

**Nothing here is a problem, and that is the finding.** The slowest result in the table — Plot at
505 ms in Firefox — is still interactive, and the aggregated tiles FR-35 actually specifies are three
orders of magnitude smaller than the hardest rung. uPlot is flat across the whole ladder — 500,000
points cost less than 1,000 do. That reproduces the *shape* of its published benchmark, not its
throughput figure: 500k in 54.7 ms is ~9,100 points/ms against a claimed ~100,000 [1], because every
candidate sits on a ~60 ms floor at the low rungs and the measurement is frame-bound there.

Two things follow. **The whole decimation question does not arise at querbeet's scale**, which
retires a body of round-1 material: Chart.js's decimation plugin and its frozen-data conflict [2],
ECharts' `sampling` and the LTTB-with-nulls distortion closed as "not planned" [5], and Vega-Lite's
reported sampling inversion [3] are all answers to a question this product does not ask. If a Step
ever *does* hand a tile half a million raw points, every candidate draws it in under half a second
without any of them.

And **the SVG renderer carries no volume penalty here, because a line series is one element.**
ECharts' SVG output held 50–56 DOM nodes at every rung, 1,000 points and 500,000 alike. The
handbook's guidance to prefer canvas above roughly 1k elements [1] counts elements, and a line series
does not produce one per point — so it does not bear on this shape. This is the single most
load-bearing correction the measurement makes to round 1's reading, because it is what makes the SVG
renderer affordable and therefore what makes the print result reachable.

## Frozen input, resize, and formatter hooks

**Frozen input — the question round 1 left open for four of five candidates.** Data `Object.freeze`d
at both levels, checksummed before and after a full re-render: **no candidate threw and no candidate
mutated the input.** Gate G5 is passed by all six.

One conditional survives, and it is Chart.js's alone. The clean result holds for Chart.js *without
decimation*; the plugin is off by default and was not enabled, and it is documented to store the
original as `dataset._data` and redefine `data` on the dataset [2] — a write to a frozen object.
Since the volume measurement shows decimation is unnecessary here, this is a constraint to record
rather than a defect to weigh.

Incidental and settling a contradiction round 1 flagged against itself: **`uPlot.setSize()` exists.**
The documentation never mentions it; the method is there.

**Resize through the three preset steps FR-35 defines:**

| Candidate | Follows its container unasked | Explicit call | Cost per step (C / F) |
| --- | --- | --- | --- |
| chartjs | **yes**, both engines, every step | none needed | 98–100 / 77–101 ms |
| handbuilt | n/a — the size is a prop | reactive | 17–33 / 16–34 ms |
| echarts-svg | no | `resize()`, lands exactly | 66 / 63–67 ms |
| echarts-canvas | no | `resize()`, lands exactly | 66 / 66–67 ms |
| uplot | no | `setSize()`, lands exactly | 67 / 67 ms |
| plot | n/a — a size step is a re-render | `Plot.plot()` again | 56–67 / 55–67 ms |

Chart.js's `responsive: true` genuinely observes the container; nothing else does. For ECharts the
lag is visible in the raw data — at each step the pre-call width is the *previous* step's — so a tile
grid must call `resize()` after a size change. This is cheap and mechanical, not a defect.

**The 2019 hidden-container complaint does not reproduce.** All six candidates recovered full width
after being shown from `display: none`, in both engines, with no explicit resize call. The ECharts
issue behind that reputation was filed against v4.2.1 and closed as stale rather than fixed [7]; it
does not hold against 6.1.0. *Scope, stated because it matters:* the hidden element carried an
explicit pixel width. The original report concerned a percentage width, which was **not** tested.
querbeet's tile grid uses preset sizes, so the tested condition is the product's own.

**Formatter hooks — every candidate accepts one and calls it.** `axisLabel.formatter` (ECharts),
`ticks.callback` (Chart.js), axis `values` (uPlot), scale `tickFormat` (Plot). The differentiator is
not whether the hook exists but *where its output lands*: on the three SVG candidates it becomes
text — 32–35 marker occurrences in the DOM and 21–35 in the printed PDF — while on the canvas
candidates it becomes pixels. R5 can settle what German formatting is without any of this being
re-litigated, and its answer plugs into any candidate.

One bundling consequence is worth carrying: Plot depends on the **d3 umbrella package** [10], so
d3-format and d3-time-format arrive whether used or not, and Chart.js needs a **separate date library
and adapter** [9]. Neither is a lazy-load hazard — both inline — but both are why these two measure
larger than their reputations.

## Weighted decision matrix

Scores 1–5 against the frame above. Shown per cell so the weighting can be re-argued.

| Criterion | W | handbuilt | ECharts (SVG) | Plot | uPlot | Chart.js |
| --- | --- | --- | --- | --- | --- | --- |
| Static export fidelity | 25 | 4 | 5 | 5 | 2 | 2 |
| Data volume | 20 | 5 | 4 | 3 | 5 | 4 |
| Resize in a fixed grid | 15 | 5 | 4 | 4 | 4 | 5 |
| App-supplied formatter | 15 | 5 | 5 | 4 | 3 | 3 |
| Footprint | 10 | 5 | 1 | 2 | 4 | 3 |
| Ecosystem / 5-year regret | 10 | 4 | 5 | 2 | 2 | 2 |
| Vue 3 ergonomics | 5 | 5 | 4 | 3 | 4 | 4 |
| **Total** | | **93** | **84** | **72** | **67** | **64** |

Where the contested cells come from. *Static export*: hand-built scores 4 rather than 5 only because
of the unstyled-snapshot bug, which is its own code and fixable; the canvas pair score 2 because
their output is a dpr-bound raster without text. *Ecosystem*: ECharts is the only *measured* candidate with
an organisation behind it, and closed 818 issues in twelve months [8]; Chart.js scores 2 on 18 closed
against 575 open; Plot and uPlot score 2 on zero releases in twelve months and, for uPlot, a bus
factor of one; hand-built scores 4 because the code is yours, which is R6's reasoning unchanged.
*Footprint*: ECharts is eight times the hand-built artefact and the whole app crosses half a megabyte.

**The nine-point gap is one criterion, and it is the criterion two earlier runs disqualified.** Per
criterion, hand-built leads by 4 on volume, 3 on resize and 1 on ergonomics, trails by 5 on static
export and 2 on ecosystem, and ties on the formatter — a net of −1 across six of the seven. The
whole margin is **footprint, worth +8 on its own**. And footprint is exactly what R2 ruled out ("do
not spend design effort on bundle size") and R6 ruled out again ("footprint is explicitly *not* a
criterion — do not let size decide this"). **Drop it and renormalise to 90: hand-built 92, ECharts
91 — a tie.**

Whether the earlier rule should hold here is a real question rather than a rhetorical one. R6
dismissed footprint because a 50 KB graph editor is noise beside Arquero's 236 KB. ECharts' own
share is **178 KB gzipped**, more than twice the largest dependency the project has taken so far, and
it takes the artefact from 70,795 B to 592,693 B. That is a different order of magnitude from the
case the rule was written for, which is the argument for letting it count — but it is an argument,
and whoever takes the project decision should take it knowing the matrix rests on this one cell.

## Verdict

**Hand-written SVG, 93.** It is top or joint-top on five of seven criteria — outright on footprint
and Vue ergonomics, tied with uPlot on volume, Chart.js on resize and ECharts on the formatter — and
loses decisively on none. The reason
it is affordable is scope: **FR-35 asks for exactly two chart kinds.** A Top-N/Bottom-N list is a
table and a key figure is a number — neither is a chart — and the tile configuration is one small
form with a grouping column, a measured column, an aggregation and a row limit. No stacking, no dual
axes, no log scales and no zoom — none of which FR-35 asks for — while cross-tile filtering is an
explicit PRD non-goal. The distinction matters: one is excluded, the rest are merely absent, and
absent is the easier of the two to change. The
probe's bar and line tiles came to roughly 200 lines between them, render 500,000 points in 118 ms,
and print as vector with selectable German axis labels.

**Runner-up: Apache ECharts 6.1.0 in SVG mode, 84**, and the conditions under which it wins instead
are concrete rather than rhetorical. It wins if the Dashboard grows past two chart kinds, if tooltips
and legends turn out to be wanted rather than optional, or if the tick algorithm's edge cases prove
to be a running cost rather than a one-off. It is also the only *measured* candidate with an
organisation behind it — billboard.js (NAVER) and `@unovis/vue` (F5), both screened out, are the
others — and its SVG output is the most self-contained of all six — pure inline
attributes, three independent snapshot APIs, and 15.6 KB for a 730-point chart.

**The strongest argument against the pick.** The probe built the parts of a chart that are easy and
skipped the parts that are tedious: no tooltips, no legend, and no exercise of a tick algorithm
against all-zero columns, negative values, a single category, an empty result or very long category
labels. Every one of those is a place where a mature library has absorbed a bug you have not. R6 made
the same trade with a graph editor and the project overrode it, on the reasoning that a complete,
widely used library is more battle-tested than freshly written bespoke code — and that reasoning
applies here unchanged. **This verdict is research; the same override would be a defensible project
decision, and ECharts in SVG mode is the shape it should take.**

**The cheapest reversibility hedge, and it is unusually cheap here.** Keep every tile behind a
component interface that takes `(rows, config, width, height)` and returns a DOM node, with the
aggregation done before the tile is called — the tile never sees the Result table, only its own tens
of rows. Then a switch to ECharts rewrites two components and touches neither the Recipe format, nor
the Dashboard definition, nor the export path. This is the same seam R2 mandated for the pipeline
core and R6 for the graph model, and it costs nothing to install now.

**Two rules the implementation does not get to choose**, both from measurement:

1. **Inline the chart's styling into the SVG node.** Scoped classes whose CSS lives in the document
   produce a snapshot that arrives unstyled in the export document. ECharts and Plot are
   self-contained by construction; hand-built code is not, unless it is made so. This is a constraint
   on whatever R5 picks for CSS, not a CSS decision taken here.
2. **Never put a chart's fill in a CSS background.** A background fill depends on a "print background
   graphics" setting the page cannot set — the printing API's own default is off — and when it is off
   the fill is absent from the printed document, which is the actual mechanism behind the
   canvas-prints-blank folklore [11]. Fills go in attributes or inline styles.

## What this run hands to other work

**To R8 (view document export), which was sequenced after this run.** The browser's own print-to-PDF
produced **selectable, searchable German axis labels** from an SVG chart at zero library cost — the
zero-library hypothesis R8 was told to try first is alive and should be tested before any PDF library
is researched. Two limits travel with it: **pagination is untested**, since every probe artefact
printed to one page, and **printing was measured in Chromium only**, because Playwright exposes no
PDF output for Firefox. Round 1 also collected, at low confidence, that jsPDF's
`addSvgAsImage` rasterises via canvg [13] and that standard PDF fonts cover WinAnsi/Windows-1252 so
German umlauts may need no embedded font [14] — both unverified and both R8's to settle.

**To R5 (type and locale detection), without pre-empting it.** Every candidate accepts an
application-supplied tick formatter, so R5's answer is portable across all five and the library
choice does not constrain it. The one constraint that runs the other way: on an SVG candidate the
formatter's output becomes selectable text in the exported PDF, so whatever R5 decides is what a
Boxchecker can copy out of the document.

**To the project's licence discipline.** ApexCharts is the second library in two research runs to
relicense mid-flight after PrimeVue [5]. The rule of reading the LICENSE in the published package
rather than the repository has now paid twice, and it caught a third case here — Highcharts' npm
`license` field is a bare URL.

## Sources

Round 1 digests, with the source tables that back every bracketed reference:
`digests/candidate-field-r1-1.md`, `digests/static-export-r1-1.md`,
`digests/data-volume-and-hooks-r1-1.md`.

| Ref | Source | Publisher | Accessed |
| --- | --- | --- | --- |
| [1] | npm registry keyword search; ECharts canvas-vs-SVG handbook; uPlot README | npm / Apache / leeoniya | 2026-08-01 |
| [2] | Chart.js decimation docs; npm registry package metadata | Chart.js / npm | 2026-08-01 |
| [3] | Vega-Altair large-datasets guide; vega-lite tracker; Observable Plot docs | Observable / Vega | 2026-08-01 |
| [4] | LICENSE files inside published packages, via unpkg | package publishers | 2026-08-01 |
| [5] | ApexCharts version/licence history; ECharts issue #19383 | npm / Apache | 2026-08-01 |
| [6] | ECharts SSR handbook and `echarts.md` API doc | Apache ECharts | 2026-08-01 |
| [7] | ECharts issue #11155 (hidden container); vega-lite peer dependency | Apache / npm | 2026-08-01 |
| [8] | GitHub API: releases, issue movement, push dates | GitHub | 2026-08-01 |
| [9] | Chart.js time-scale docs (adapter required) | Chart.js | 2026-08-01 |
| [10] | Observable Plot `package.json` (d3 umbrella dependency) | Observable | 2026-08-01 |
| [11] | Mozilla bug 1696619 — canvas blank in print, RESOLVED INVALID | Mozilla | 2026-08-01 |
| [12] | Chart.js discussion #10986 — blank pages, 2.x only | chartjs | 2026-08-01 |
| [13] | jsPDF `addSvgAsImage` (unofficial doc mirror, low confidence) | — | 2026-08-01 |
| [14] | pdf-lib `embedFont`; WinAnsi coverage (low confidence) | pdf-lib / DEV | 2026-08-01 |
| [M] | **This run's own measurement** — six single-file artefacts, Chromium 151 and Firefox 153, from `file://` | `imports/chart-probe-measurement-2026-08-01.md` | 2026-08-01 |

## Open questions

- **`@unovis/vue` 1.6.7 was never measured.** Apache-2.0, F5-backed, Vue 3 first-class, seven releases
  in twelve months. It is the strongest unexamined candidate and the first thing to add if this
  selection is revisited.
- **billboard.js 4.0.3 was screened out, not measured.** Its XHR is benign (verified here); what
  stands against it is 149.4 KB and a separate stylesheet.
- **The hidden-container test used an explicit pixel width.** The percentage-width case that the
  original ECharts report described is untested.
- **Tooltips, legends and tick-algorithm edge cases were not built** on any candidate. This is the
  gap the verdict's strongest counter-argument rests on, and it would be closed by a spike rather
  than by research: build the bar and line tiles against an all-zero column, a single category,
  negative values, an empty result and a 60-character label.
- **LICENSE files could not be retrieved** from the published packages of vega-lite, chartist,
  layerchart and ag-charts-community; only the npm-declared fields are known for those four. All are
  cut candidates, so this blocks nothing.
- **Weekly download figures are absent** from this report: npmjs.com returns 403 to the fetcher used,
  so all npm evidence comes from the registry API.

## Staleness

A selection report older than two quarters should be refreshed before anyone acts on it. Re-run the
probe (`imports/chart-probe/`, commands in the measurement note) on a browser major-version change,
and re-read the LICENSE of whatever is chosen at each upgrade — this field has produced two
mid-flight relicensings in two research runs.
