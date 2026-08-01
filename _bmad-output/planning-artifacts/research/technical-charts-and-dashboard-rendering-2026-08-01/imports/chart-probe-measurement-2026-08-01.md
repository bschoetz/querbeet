# R7 candidate probe — method and raw results

Measured 2026-08-01 against **Chromium 151.0.7922.34** and **Firefox 153.0**, driven by Playwright,
every artefact opened from a real `file://` URL. Raw data: `chart-probe-chromium.json`,
`chart-probe-firefox.json`. Harness: `chart-probe/run-chart-probe.mjs`.

## What was built

Six single-file Vite artefacts, one per candidate, each a Vue 3 SFC app with the same three tiles —
a categorical bar chart over twelve German states, a 730-point daily line series, and a third chart
deliberately born inside a `display: none` container. Every app exposes the same `window.__qbChart`
API, so the runner asks all six the same six questions and never knows which library is inside.

| Folder | Candidate | Renderer |
| --- | --- | --- |
| `handbuilt/` | hand-written SVG, no library | SVG |
| `uplot/` | uPlot 1.6.32 | canvas |
| `chartjs/` | Chart.js 4.5.1 + `chartjs-adapter-date-fns` + `date-fns` | canvas |
| `plot/` | Observable Plot 0.6.17 | SVG |
| `echarts-svg/` | Apache ECharts 6.1.0, `echarts/core` + BarChart + LineChart + Grid + Tooltip | SVG |
| `echarts-canvas/` | the same, differing only in the renderer | canvas |

The two ECharts apps are byte-identical but for the renderer import, so the renderer's own cost is
isolated rather than argued about.

The data comes from `chart-probe/shared-data.js` and is `Object.freeze`d at both levels, because
that is how querbeet holds data (R2) and a library that sorts its input in place must fail here
rather than in the product.

## The build gate

Run before any browser opens, per R2's rule that build success does not imply a working artefact.

| Candidate | `dist/` files | Bytes | gzip | Hazard greps | Non-`data:` `url()` | Requests beyond the document |
| --- | --- | --- | --- | --- | --- | --- |
| handbuilt | 1 | 70,795 | 28,002 | all zero | none | **0** |
| uplot | 1 | 120,524 | 49,887 | all zero | none | **0** |
| chartjs | 1 | 269,714 | 91,992 | all zero | none | **0** |
| plot | 1 | 340,783 | 118,636 | all zero | none | **0** |
| echarts-canvas | 1 | 584,928 | 202,486 | all zero | none | **0** |
| echarts-svg | 1 | 592,693 | 206,286 | all zero | none | **0** |

Byte counts are the probe's own record of the built `dist/index.html`; gzip is `gzipSync` at level 9
over that same file, computed for this table rather than taken from Vite's build report — the two
differ slightly and only one of them is reproducible from the committed artefact.

Hazard greps are `import(`, `fetch(`, `new Worker`, `importScripts`, `@font-face`, `XMLHttpRequest`.
Zero page errors and zero console errors in either engine for all six.

Every figure is the whole app including Vue, so the library's own share is the delta against the
handbuilt baseline: uPlot ~50 KB, Chart.js (with its mandatory date adapter) ~199 KB, Plot ~270 KB,
ECharts tree-shaken to bar+line ~514–522 KB raw.

**The ECharts number is the one nobody had.** Tree-shaking `echarts/core` down to two chart types and
two components lands at 206,286 B gzipped for the whole app — against the vendor's own
`echarts.simple` bundle at 168,900 B gzipped for the library alone (round 1, candidate-field digest
row [6]). Subtracting the hand-built baseline puts ECharts' own share at 178,284 B gzipped, so tree
shaking to bar+line beats the vendor's prebuilt subset only slightly, and the whole-library figure of
367,900 B overstates the real cost by roughly 52 %.

## Mount cost and heap

| Candidate | Mount, Chromium | Mount, Firefox | Heap (Chromium only) |
| --- | --- | --- | --- |
| handbuilt | 16.3 ms | 44 ms | 2.2 MB |
| uplot | 17.8 ms | 70 ms | 2.5 MB |
| plot | 30.4 ms | 60 ms | 3.8 MB |
| chartjs | 72.9 ms | 82 ms | 3.9 MB |
| echarts-svg | 51.0 ms | 83 ms | 6.0 MB |
| echarts-canvas | 68.3 ms | 89 ms | 5.5 MB |

Three tiles each. Firefox exposes no `performance.memory`, so every heap figure is Chromium's —
R4's note, unchanged.

## Frozen input — the question round 1 left open for four of five

`Object.freeze`d data in, checksummed before and after a full re-render.

| Candidate | Threw | Input mutated | Input was frozen |
| --- | --- | --- | --- |
| handbuilt | no | **no** | yes |
| uplot | no | **no** | yes |
| chartjs | no | **no** | yes |
| plot | no | **no** | yes |
| echarts-svg | no | **no** | yes |
| echarts-canvas | no | **no** | yes |

**No candidate writes to the array it is handed, and none throws on frozen input.** Gate G5 is
passed by all six. Round 1 could evidence this for none of them.

One conditional, and it is Chart.js's alone: the probe reports `datasetRewritten: false`, but the
decimation plugin is **off by default** and was not enabled. The plugin is documented to store the
original as `dataset._data` and redefine `data` on the dataset (round 1, [d-2]) — so the clean result
above holds for Chart.js *without decimation*, and enabling it against frozen data is untested and
documented to write.

Incidental, and it settles round 1's flagged contradiction: **`uPlot.setSize()` exists**
(`hasSetSize: true`). The docs are incomplete, the belief was right.

## The app-supplied formatter

Each app hands the library a counting wrapper around its own tick formatter, whose output carries a
marker character. Both the call count and the rendered result are checked, because a canvas renderer
has no DOM text to assert against.

| Candidate | Formatter calls (y / x) | Markers in the DOM | Where the label lands |
| --- | --- | --- | --- |
| handbuilt | 27 / 6 | 33 | SVG text |
| uplot | 30 / 24 | 0 | drawn into the canvas |
| chartjs | 40 / 28 | 0 | drawn into the canvas |
| plot | 19 / 16 | 35 | SVG text |
| echarts-svg | 18 / 14 | 32 | SVG text |
| echarts-canvas | 18 / 14 | 0 | drawn into the canvas |

**Every candidate accepts an application-supplied formatter and calls it.** The options used are
`axisLabel.formatter` (ECharts), `ticks.callback` (Chart.js), axis `values` (uPlot), scale
`tickFormat` (Plot). R5 can decide what German formatting *is* without any of these being
re-litigated.

## Resize through the three preset steps

Two separate questions per step: does the chart follow its container unasked, and what does an
explicit resize cost when it does not.

| Candidate | Follows the container on its own | Explicit call | Cost per step |
| --- | --- | --- | --- |
| chartjs | **yes** (both engines, every step) | not needed | 98–100 ms C / 77–101 ms F |
| echarts-svg | no | `resize()`, lands exactly | 66 ms C / 63–67 ms F |
| echarts-canvas | no | `resize()`, lands exactly | 66 ms C / 66–67 ms F |
| uplot | no | `setSize()`, lands exactly | 67 ms C / 67 ms F |
| plot | n/a — a size step is a re-render | `Plot.plot()` again | 56–67 ms C / 55–67 ms F |
| handbuilt | n/a — the size is a prop | reactive | 17–33 ms C / 16–34 ms F |

Chart.js's `responsive: true` genuinely observes the container in both engines; nothing else does.
For ECharts the lag is visible in the raw data — at each step the pre-call width is the *previous*
step's — so a tile grid must call `resize()` after a size change.

## The hidden container — the 2019 complaint, re-asked

A chart initialised inside `display: none` and shown afterwards, with an explicit pixel size on the
element.

**All six recovered, in both engines**: rendered width 520 px after being shown, without any explicit
resize call. The ECharts issue from 2019 (v4.2.1, closed stale rather than fixed) **does not
reproduce against 6.1.0** under this condition.

*Scope, stated because it matters:* the hidden element carried an explicit `width: 520px`. The
original report concerned a percentage width, which was **not** tested. querbeet's tile grid uses
preset sizes, so the tested condition is the product's own — but the percentage case stays open.

## Static export — what comes out of each candidate

| Candidate | Snapshot | Bytes | External refs | Carries its own styling |
| --- | --- | --- | --- | --- |
| echarts-svg | serialized SVG | 15,639 | none | **yes** — pure inline attributes, no class references |
| echarts-svg | `getDataURL({type:'svg'})` | 15,361 | none | yes, a real `image/svg+xml` data URI |
| echarts-svg | `renderToSVGString()` | 16,495 | none | yes |
| plot | serialized SVG | 17,453 | none | **yes** — emits a `<style>` child |
| handbuilt | serialized SVG | 10,370 | none | **no** — class references, no `<style>` child |
| uplot | canvas `toDataURL` | 52,743 | n/a | raster |
| chartjs | `toBase64Image()` | 70,647 | n/a | raster |
| echarts-canvas | canvas `toDataURL` | 26,181 | n/a | raster |

Three findings here, all of which close round-1 leads:

1. **ECharts' `renderToSVGString()` works on an ordinary non-SSR instance in SVG mode.** The handbook
   presents it as requiring `ssr: true`; it does not. In canvas mode it throws
   `TypeError: n.renderToString is not a function`.
2. **`getDataURL({type: 'svg'})` silently returns a PNG in canvas mode.** Same call, same arguments,
   no error, no warning — `data:image/png;base64` instead of `data:image/svg+xml`. Asking for vector
   and receiving raster without being told is a trap worth naming.
3. **Observable Plot's default stylesheet lands *inside* the SVG** as a `<style>` child
   (`:where(.plot-d6a7b5)…`). Round 1 flagged the opposite as a real risk; it is not one. The
   hand-written baseline is the candidate that fails this — its scoped Vue classes live in the
   document, so a naively serialized snapshot arrives unstyled. That is a bug in the probe's own
   chart, not in any library, and it is fixable — but it is exactly the trap a hand-built path walks
   into for free.

## Print — the criterion with the highest weight

Each artefact printed to PDF through Chromium's own print pipeline with `printBackground: true`,
then inspected with poppler. **Chromium only** — Playwright exposes no PDF output for Firefox, so
every figure in this section is one-engine evidence. **And every one of the six PDFs is a single
page**, because the probe renders three tiles and no Result table: nothing here says anything about
pagination.

| Candidate | PDF bytes | Words of real text | Formatter markers in the text | Raster images |
| --- | --- | --- | --- | --- |
| plot | 43,713 | 131 | **35** | 0 |
| echarts-svg | 38,156 | 112 | **32** | 0 |
| handbuilt | 36,006 | 95 | **21** | 0 |
| chartjs | 135,478 | 12 | 0 | 6 (620×300, 1100×460, 520×240) |
| echarts-canvas | 85,778 | 12 | 0 | 6 (same sizes) |
| uplot | 84,429 | 12 | 0 | 6 (same sizes) |

**The folklore is dead and something sharper replaces it.** No canvas chart printed blank — round 1
already showed the canonical Firefox bug for that claim was closed as INVALID, and this confirms it
from the other side. What actually happens is that a canvas chart enters the PDF as a **raster at
CSS-pixel size**, while an SVG chart enters as **vector plus selectable text**: the twelve words in
the canvas PDFs are the page's own headings, and the axis labels are pixels.

The raster's resolution tracks `devicePixelRatio` exactly, measured across three scales:

| deviceScaleFactor | Embedded image | uplot PDF bytes | chartjs PDF bytes |
| --- | --- | --- | --- |
| 1 | 620×300 | 45,527 | 81,475 |
| 2 | 1240×600 | 100,607 | 195,856 |
| 3 | 1860×900 | 158,198 | 305,244 |

So a canvas chart in a printed document is bounded by the **screen's** pixel ratio at print time —
roughly 96 dpi on an ordinary office monitor, ~192 dpi on a 2× display — never the 300+ dpi a vector
gets for nothing. And in a canvas PDF the axis labels cannot be selected, searched or copied, which
for FR-37's Boxchecker reader is a property of the document, not a rendering detail.

## Two traps this probe walked into first

Recorded because each produced a confidently wrong number before it was caught, in the spirit of
R4's list.

- **`setOption(option, true)` drops the axis configuration** along with the series. The ECharts
  volume ladder failed at 1,000 points with `TypeError: Cannot read properties of undefined
  (reading 'get')` and looked like an ECharts defect. `notMerge` must stay false, or the full option
  must be passed.
- **An explicit `width`/`height` in `echarts.init` pins the instance and makes `resize()` a no-op.**
  The first run reported ECharts ignoring every resize. Initialise from the container instead.

## Volume ladder

A line series at 1k, 10k, 100k and 500k points, milliseconds to set the data and reach the next
frame. This is the counter-case to the aggregated-tile assumption, not the expected tile load.

| Candidate | 1k | 10k | 100k | 500k |
| --- | --- | --- | --- | --- |
| handbuilt (C) | 28.0 | 33.0 | 30.3 | **117.7** |
| handbuilt (F) | 28 | 33 | 33 | 140 |
| uplot (C) | 62.9 | 64.2 | 64.7 | **54.7** |
| uplot (F) | 59 | 65 | 66 | 60 |
| chartjs (C) | 91.4 | 64.9 | 75.1 | 185.0 |
| chartjs (F) | 72 | 66 | 63 | 114 |
| echarts-canvas (C) | 57.1 | 65.9 | 89.0 | 232.8 |
| echarts-canvas (F) | 58 | 63 | 95 | 193 |
| echarts-svg (C) | 59.3 | 65.6 | 90.5 | 315.7 |
| echarts-svg (F) | 51 | 67 | 95 | 197 |
| plot (C) | 62.7 | 64.8 | 123.4 | 445.5 |
| plot (F) | 56 | 67 | 133 | 505 |

**Nothing here is a problem, and that is the finding.** Half a million raw points render in well
under half a second everywhere, with no decimation configured on any candidate. uPlot is flat across
the whole ladder — 500k costs no more than 1k, which is what its published benchmark claims and this
independently reproduces. The slowest result in the table, Plot at 505 ms in Firefox, is still
interactive.

**The SVG renderer is not penalised at volume, because a line series is one element.** ECharts' SVG
output held 50–56 DOM nodes at *every* rung of the ladder, 1,000 points and 500,000 alike. The
handbook's "canvas above roughly 1k elements" guidance is about element count, and a line series
does not produce one element per point — so it does not bear on this shape at all. That is the
single most load-bearing correction the measurement makes to round 1's reading.

## Re-running this

```sh
cd chart-probe
npm i && npx playwright install chromium firefox
for c in handbuilt uplot chartjs plot echarts-svg echarts-canvas; do (cd $c && npx vite build); done
node run-chart-probe.mjs chromium > chart-probe-chromium.json
node run-chart-probe.mjs firefox  > chart-probe-firefox.json
node dpr-print.mjs                     # the devicePixelRatio ladder
for f in print-*.pdf; do pdftotext "$f" - | wc -w; pdfimages -list "$f"; done
```

`node_modules/` and `dist/` are gitignored; everything else is committed.

## billboard.js — the one screened-out candidate that needed a call site read

Round 1 found a single `XMLHttpRequest` occurrence in billboard.js's published bundle and could not
tell whether it was reachable code or dead code inside a dependency. It is reachable, and it is
benign. Verified 2026-08-01 by unpacking the published tarball:

```sh
npm pack billboard.js@4.0.3 && tar xzf billboard.js-4.0.3.tgz
grep -o ".\{90\}XMLHttpRequest.\{60\}" package/dist/billboard.min.js
```

The call site is a data loader — `function Hh(e, t = "csv", n, i, a) { const s = new XMLHttpRequest,
o = {csv: …, tsv: …, json: …}; s.open("GET", e) … }` — the implementation of billboard.js's
documented `data.url` option, which fetches CSV, TSV or JSON from a URL. It fires only if the
application sets that option, so it is not a runtime-fetch disqualifier for a page that never does.
Present in all four dist bundles (`billboard.js`, `.min.js`, `.pkgd.js`, `.pkgd.min.js`).

What stands against billboard.js after this is its size (149.4 KB gzip) and the separate
`billboard.css` its documentation requires — inlinable at build time, so not a G4 failure either.
It was not otherwise measured, for budget.
