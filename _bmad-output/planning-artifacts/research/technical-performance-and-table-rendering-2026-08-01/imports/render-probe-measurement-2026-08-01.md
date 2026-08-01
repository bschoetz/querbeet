# Original measurement: table rendering at 100k rows, Chromium 151 and Firefox 153

Run for querbeet R4 on 2026-08-01. Reproduce with `node run-render-probe.mjs` (needs
`playwright`); the probe pages also run standalone by double-click from `file://`.
Raw output is preserved as `render-probe-raw.json`, `element-height-boundary.json`
and `scroll-extent-ladder.json`.

## Why this was measured

R3 states plainly that every performance figure in the prior reports is Node, not browser,
and that browser timings for table rendering are R4's own work. Three questions decisive for
D1 had no usable public evidence: whether virtualization is actually *required* at 100k rows
(as opposed to merely advisable), what one window swap costs against a frame budget, and
where the browsers' element-height ceiling really sits — the retrieved literature carried two
contradictory figures (17,187,496 px from Mozilla's own bug tracker, 33,554,400/33,554,428 px
from a TanStack issue thread) and neither had been checked against a current browser.

## Method

- **Browsers:** Chromium 151.0.7922.34 and Firefox 153.0, both headless via Playwright 1.62.1,
  both loading a real `file://` URL with no permissive flags. Chromium additionally ran with
  `--enable-precise-memory-info` for heap figures; Firefox exposes no `performance.memory`, so
  every heap number below is Chromium-only.
- **Data:** 100,000 rows built as frozen plain objects, 20 columns (and a second set at 50
  columns), mixed number and string values, every row and the array itself `Object.freeze`d.
- **Rendering:** real `<table>`/`<tr>`/`<td>` elements built through `document.createDocumentFragment`,
  appended to a scroll container, with a forced layout flush (`document.body.offsetHeight`)
  after every step so timings include the browser's layout work and not only script time.
- **Windowing:** absolute-positioned holder over a full-height spacer, moved with
  `transform: translateY(...)`; the window is rebuilt from scratch on every swap (the
  pessimistic case — no node recycling). 100 swaps spread evenly across the dataset for the
  50-row window, 50 swaps for the others; p50/p95/max reported over those swaps.

## Results

### 1. Virtualization is required, not optional

Building the full unvirtualized table, 20 columns:

| Rows | Cells | Chromium build | Firefox build |
| --- | --- | --- | --- |
| 1,000 | 20,000 | 90 ms | 128 ms |
| 10,000 | 200,000 | 1,107 ms | 1,362 ms |
| 50,000 | 1,000,000 | 4,749 ms | 6,510 ms |
| **100,000** | **2,000,000** | **11,217 ms** | **12,448 ms** |

Both engines complete it — nothing crashes — but an 11–12 second synchronous freeze is not a
UI. Cost is close to linear in cell count above 10k rows. The 1,000-row row includes engine
warm-up and overstates that case.

### 2. A hand-rolled fixed-height window is trivially cheap

100,000 rows behind the window, rebuilt from scratch on every swap:

| Window | Cols | First paint (Cr / Ff) | Swap p50 | Swap p95 | Swap max |
| --- | --- | --- | --- | --- | --- |
| 50 rows | 20 | 5.3 / 5 ms | 4.1 / 5 ms | 4.4 / 6 ms | 98.5 / 10 ms |
| 200 rows | 20 | 16.9 / 20 ms | 16.8 / 20 ms | 18.7 / 31 ms | 19.7 / 32 ms |
| 50 rows | **50** | 12.5 / 13 ms | 10.9 / 14 ms | 11.7 / 19 ms | 12.3 / 20 ms |

The 50-row window swaps in about 4–5 ms in both engines — well inside a 16.7 ms frame. The
single 98.5 ms outlier in Chromium is one swap out of 100 and is consistent with a GC pause,
not with a systematic cost; Firefox's max over the same run is 10 ms.

**A 50-row window over 50 columns still swaps in 11–14 ms.** 2,500 cells is not enough work to
need column virtualization. That is the answer to whether the horizontal axis needs a
virtualizer at this shape: it does not.

The 200-row window costs 17–20 ms per swap and would drop frames on fast scroll. Window size
is the knob that matters, and ~50 is comfortably on the right side of it.

### 3. Element-height ceiling — both circulating figures are right, about different engines

Requested height vs. observed box height and container `scrollHeight`, measured together:

| Requested px | Chromium box / scrollHeight | Firefox box / scrollHeight |
| --- | --- | --- |
| 1,000,000 – 16,000,000 | exact / exact | exact / exact |
| 20,000,000 | 20,000,000 / 20,000,000 | **0 / 300** |
| 33,000,000 | 33,000,000 / 33,000,000 | **0 / 300** |
| 67,000,000 and above | clamped to **33,554,428** | **0** |

Box height and scrollable extent track each other exactly in both engines, right up to the
failure point — there is no separate, earlier scroll-extent limit.

- **Chromium 151 clamps** at **33,554,428 px** ( = 2^25 − 4 ), matching the figure circulating
  in the TanStack issue thread. Content beyond the clamp is unreachable, but the page keeps working.
- **Firefox 153 does not clamp — it collapses the element to height 0**, silently. The
  scroll container reports `scrollHeight: 300` (its own client height), `scrollTop` stays 0,
  and the list simply vanishes. The transition lies between 16,000,000 and 20,000,000 px,
  consistent with the 17,187,496 px `nscoord` overflow in Mozilla bug 1527883.

A binary search for the exact boundary returned non-round values (Chromium 32,715,118;
Firefox 15,320,311) because at that magnitude heights snap to a coarse sub-pixel grid and
round by ±1 px — the search was measuring the precision grid, not the cliff. The ladder above
is the trustworthy result; the boundary run is preserved only for completeness.

**At the target scale this is 5.7× of headroom, but the margin is not as large as it looks.**
100,000 rows × 28 px = 2,800,000 px, exact in both engines. Firefox's cliff sits at roughly
**614,000 rows** at 28 px, or about **172,000 rows** if rows were 100 px tall. Since the
failure mode on the *stricter* engine is a silent blank list rather than a truncated one, a
one-line guard that caps `spacerHeight` and compensates the mapping is worth having even
though 100k rows do not need it.

### 4. Scroll offsets are precise at this range

At a 2,800,000 px spacer, both engines returned every requested `scrollTop` exactly (0 drift at
25/50/75/100 % of the range) and resolved a 1 px scroll step. There is no float-precision
problem to engineer around at 100k rows.

### 5. Memory

Chromium reports **110 MB** of heap for 100,000 frozen rows × 20 columns — **1,154 bytes per
row** for this row shape. R1 measured 471 B/row in Node for a narrower shape, so the two are
not directly comparable; what this figure establishes is that the browser number for a
realistic 20-column row is roughly 2.5× the earlier Node estimate, and that a five-source
worst case would be well into the hundreds of MB. Firefox could not be measured
(`performance.memory` is Chromium-only). **Arquero's own footprint is not in this figure** —
this is plain frozen objects, and measuring Arquero at this scale is D2's job.

## Caveats

- Headless, on one machine, with no competing tab load. Treat the timings as a floor.
- Rows carry short synthetic strings; wider real values will cost more per cell.
- The window swap rebuilds all nodes each time. A recycling implementation would be faster,
  which only strengthens the conclusion.
- `scrollHeight` was read after container removal in one early probe and reported 0; that
  probe's `maxScroll` figures are still valid, and the clean ladder in §3 supersedes it.
