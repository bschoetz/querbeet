# R7 tripwire — the edge cases the ECharts decision rests on

Run 2026-08-01 against **Chromium 151** and **Firefox 153** from a real `file://` URL.
App: `chart-probe/edge/` · runner: `chart-probe/run-edge.mjs` · raw: `edge-chromium.json`,
`edge-firefox.json` · screenshots: `edge-chromium.png`, `edge-firefox.png`.

**Why it exists.** The research verdict was hand-written SVG; the project decision overrode it in
favour of ECharts 6.1.0 in SVG mode, and the *reason given* was that ECharts has already absorbed the
cases a freshly written tick algorithm gets wrong. That is a claim about the library, and it was
untested. This tests it. Registration is identical to the chosen build: `echarts/core`, `BarChart`,
`LineChart`, `GridComponent`, `TooltipComponent`, `SVGRenderer`, and the application's own tick
formatter on both axes.

**Result: seven of eight cases pass in both engines. One fails, cosmetically, and it has a named
fix.** No case threw, no page or console errors in either engine, and **zero occurrences of `NaN`,
`Infinity` or `undefined` in the serialized SVG of any case** — which is the failure the whole
tripwire was aimed at.

| Case | Threw | NaN/Inf/undef | Distinct ticks | Bars drawn | Escapes the box |
| --- | --- | --- | --- | --- | --- |
| all-zero | no | 0 / 0 / 0 | 6 | 4 of 4 | no |
| single-category | no | 0 / 0 / 0 | 6 | 1 of 1 | no |
| negative | no | 0 / 0 / 0 | 7 | 4 of 4 | no |
| all-negative | no | 0 / 0 / 0 | 7 | 3 of 3 | no |
| empty | no | 0 / 0 / 0 | 0 | 0 of 0 | no |
| **label-60** | no | 0 / 0 / 0 | 6 | 2 of 2 | **yes — 15.2 px left (Chromium) / 21 px (Firefox)** |
| line-with-nulls | no | 0 / 0 / 0 | 10 | — | no |
| flat-line | no | 0 / 0 / 0 | 11 | — | no |

Identical verdicts in both engines; only the clip distance differs.

## What each case actually did

**all-zero** — a column where every value is 0. This is the classic divide-by-zero in a tick
algorithm. ECharts synthesises a 0–1 range and ticks it `0 · 0,2 · 0,4 · 0,6 · 0,8 · 1`, all six
distinct, and draws four bars of height exactly 0 sitting on the baseline at y=190. No collapsed axis,
no repeated `0` ticks, no NaN.

**single-category** — one bar. Drawn at x=153.3, width **237.4 px in a 346 px plot**. Correct but
visually a slab: with one category the band is the whole plot and the default `barWidth` fills 70 % of
it. Not a defect, and `barMaxWidth` is the option that fixes it. Worth setting once for the tile.

**negative** — mixed signs. The zero tick lands at y=101 and the four bars straddle it: two drawn
upward from 101 (heights 71.2 and 26.7), two downward from 101 (47.5 and 89.0). The axis runs
`-1.500 … 1.500` through `0`. A real zero baseline, which is exactly the thing a hand-rolled
`value/max * height` gets wrong.

**all-negative** — no positive value anywhere. The axis runs `-1.200 … 0` and the bars hang from the
top edge at y=12. The range covers only negatives rather than being padded to include a meaningless
positive half.

**empty** — zero rows. No throw, no ticks, no category labels, no series paths, no NaN. An empty plot
rather than a broken one.

**label-60 — the one failure.** A 60-character category label, rotated 35°. ECharts adapts: it shrinks
the plot area vertically to make room and shifts the y-axis right (tick labels move from x=92 to
x=161.9). It is not enough. The label's far end lands **15.2 px outside the SVG's left edge in
Chromium and 21 px in Firefox**, so it is clipped in the tile and would be clipped in the export
document too. Nothing else escapes in any case.

*This is a layout limit, not a bug, and the fixes are ordinary:* `axisLabel.width` with
`overflow: 'truncate'`, or `axisLabel.formatter` shortening the label — which querbeet already owns,
since the formatter is application-supplied — or a wider `grid.left`. **A tile must set one of them:
FR-35's grouping column can hold arbitrary text from the user's data, so a long category is not an
exotic case.**

**line-with-nulls** — `[[0,10],[1,12],[2,null],[3,9],[4,null],[5,14]]`. The series path is
`M100 88L168.8 57.6M306.4 103.2M444 27.2` — **three `M` commands for three segments.** Nulls become
genuine gaps: not interpolated across, not turned into a drop to zero, not NaN. This matters because
the project decision bans `sampling` specifically over ECharts' documented LTTB-with-nulls distortion;
this confirms the *unsampled* path handles nulls correctly, so the ban costs nothing.

**flat-line** — the degenerate y-range: the same value four times. ECharts opens the axis to `0 … 7`
with eight distinct ticks rather than dividing by a zero range, and draws the line flat at the top of
the plot. No NaN.

## Two probe bugs caught here, in the spirit of R4's list

Both produced a confidently wrong result in the first run of this tripwire.

- **`getBBox()` returns local coordinates, before the element's own transform.** Every ECharts axis
  label carries a `transform="translate(92 190)"`, so a bbox read alone reported *seven of eight
  cases* as overflowing the SVG by ~11 px. They do not. Compare
  `getBoundingClientRect()` against the SVG's own rectangle instead — and only then does the single
  real clip, label-60, stand out from the noise.
- **Filtering paths by width catches the grid, not the bars.** The first run reported four identical
  344 px "bars" in every case, which was the plot background and the grid lines. Select the series by
  its fill.

## Verdict on the decision

**The justification holds.** ECharts absorbs the five cases the research report named — all-zero,
single category, negatives, empty result and the degenerate range — plus null gaps, in both engines,
without a throw and without a single NaN. The 184-line hand-built fallback in `chart-probe/handbuilt/`
was never exercised against any of them, and a tick algorithm that handles `0…0`, an empty array and a
zero-width range correctly is precisely the kind of code that is cheap to write and expensive to get
right.

**Two settings a tile must carry**, both from this run: a long-label strategy (`axisLabel.width` +
`overflow`, or a shortening formatter), and `barMaxWidth` so a single-category tile does not render as
a slab.
