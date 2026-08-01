# Digest — data volume, downsampling, resize, formatter hooks — round 1

Researcher: dimension 3. Budget: 13 tool calls, 10 cited sources.

## Findings

**1. How much data reaches a tile.** The "tiles render aggregated output" claim could **not** be verified from a primary source in this round — it is recorded as an unverified working assumption, not a finding. What is evidenced is the opposite side: the practical ceilings, and they differ by two orders of magnitude across candidates.

uPlot publishes hard numbers in its own README: 166,650 data points rendered in 25 ms cold, and roughly 100,000 points/ms thereafter, with a separate 10M-point benchmark page and raw results committed to the repo [1]. That is the only candidate of the five that publishes a reproducible artefact rather than a claim. uPlot is ~50 KB minified (47.9 KB measured) and explicitly does not use WebGL or WASM [1].

Chart.js encodes its own implicit limit in the decimation plugin's default threshold: decimation triggers when point count exceeds **4× canvas width** [2]. For a dashboard tile ~400 px wide that is ~1,600 points — Chart.js's own authors treat that as the point where a line series stops being worth drawing honestly.

For Vega-Lite the retrieved evidence is secondary (search-surfaced issue titles and the Vega-Altair "Large Datasets" guide) and the issues themselves were not read: interactive charts reported as unusably slow "if data points go into the thousands", transforms evaluated in JavaScript being the bottleneck, and — counter-intuitively — sampling reported as *slower* than not sampling (50K points drawn faster than 50K sampled down to 10) [3]. Treat as low confidence and a lead, not a basis for a decision. No numbers at all were found for Observable Plot or for ECharts' ceiling.

Failure modes: for the crash class, the only concrete pointer retrieved is a vega-lite issue titled "Ordinal scales crash on mid-sized datasets in Chrome and Firefox" [3] — unread, unquantified. No evidence for "silently dropped points" in any of the five except where decimation is explicitly enabled (below), where dropping is the documented behaviour, not a failure.

**2. Decimation for a line series over ~500k rows.** Two of the five ship it as a named feature.

Chart.js has a first-party **decimation plugin** with `algorithm: 'lttb' | 'min-max'` (default `'min-max'`), `samples` (defaults to canvas width), `threshold` (defaults to 4× canvas width), `enabled` (default `false`) [2]. Its preconditions are restrictive and one is decisive for a frozen-data app: **the dataset object must be mutable — the plugin stores the original as `dataset._data` and redefines the `data` property on the dataset** [2]. Against `Object.freeze`d input that is a write to a frozen object. The other preconditions: `indexAxis: 'x'`, line chart only, x-axis `'linear'` or `'time'`, and **`parsing: false`** [2].

ECharts has series-level `sampling` on line series, with `'lttb'` among the strategies alongside `'average' | 'max' | 'min' | 'sum'` [4] — the canonical option page (`echarts.apache.org/en/option.html`) is an SPA and returned only navigation chrome, so the strategy list is from search-surfaced secondary sources plus the ECharts issue tracker, medium confidence.

**The documented shape-distortion case is ECharts.** Issue #19383 (opened 2023-12-12) reports that with `sampling: 'lttb'` and `null` gaps in the data (`[[1,1],[2,2],null,[4,4]]`), lines render "increasingly sparse" and "disordered" when zoomed into a local region, normalising again at other zoom levels; without LTTB the nulls render correctly as missing segments. It was **closed as "not planned"** [5] — so as of that closure the misleading rendering stands unfixed. A second tracker item, #19814, reports `sampling` breaking the `updateAxisPointer` action [4] — unread, listed as a lead.

uPlot: no decimation or downsampling is mentioned anywhere in its README [1] or API docs [6]. Its answer to volume is raw draw speed, not point reduction. Vega-Lite's binning/aggregation as a decimation substitute is unverified here; note only the secondary report that its `sample` transform can cost more than it saves [3].

**3. Resize.** uPlot **requires** explicit dimensions: "width and height are required dimensions in plotting area, axes & ticks, but excluding `title` or `legend` dimensions" [6]. Neither the README nor the API doc read mentions a `setSize()` method or any container observation — so on the retrieved evidence, uPlot does not auto-resize and the app must drive it. (The researcher believes from prior knowledge that `setSize()` exists; it could not be evidenced this run, so it is flagged, not asserted.)

The classic hidden-container bug is confirmed as real and cross-library. For ECharts specifically: a chart initialised inside a `display:none` parent computes width 0, and **making the parent visible afterwards does not trigger recalculation** — the chart stays at 0 px, and setting 100% width does not help [7]. Reported against v4.2.1 on 2019-09-02; the issue was **closed as stale, not fixed** [7]. The remedy in circulation is an explicit `resize()`/reflow after the container becomes visible [8]. The same failure is reported against Chart.js, Highcharts and Plotly — browsers return 0/undefined for hidden elements, and libraries then either fall back to defaults (Highcharts: 600×400) or size to zero [8]. For a tile grid with preset size steps this is a design constraint, not an edge case: any tile that can be created or shown while collapsed needs an explicit post-visibility resize path.

No evidence found about ResizeObserver usage in Observable Plot or Vega-Lite.

**4. Formatter hooks.** uPlot: axis `values` accepts either a function `(self, ticks, space) => values` or an array of tick formatters with breakpoints using template tokens (`{YYYY}`, `{MMM}`, `{M}/{D}`), and each series takes a `value` formatter for the legend, e.g. `value: (self, rawValue) => rawValue == null ? '' : "$" + rawValue.toFixed(2)` [6]. So application-supplied functions for both ticks and legend values, no library format layer required.

Chart.js: `time.displayFormats` per unit and `time.tooltipFormat` are **format strings whose syntax is defined by whichever date adapter you install**; `ticks.callback` is referenced as the tick-configuration hook [9]. The bundling fact that matters: **"The time scale requires both a date library and a corresponding adapter to be present"**, and **no adapter ships with Chart.js** — you choose one from the adapters list [9]. So a time-axis line chart in Chart.js means a second local bundle (date-fns/luxon/moment/dayjs plus its adapter) is mandatory, not optional. That is a bundle-size and tree-shaking question, not a lazy-load question — nothing is fetched at runtime.

Observable Plot: its `package.json` on `main` (v0.6.17) declares dependencies **`d3 ^7.9.0`, `interval-tree-1d ^1.0.0`, `isoformat ^0.2.0`** [10]. It depends on the **d3 umbrella package**, which pulls d3-format and d3-time-format transitively — so number/date formatting machinery comes in by default. Whether a bundler can tree-shake down to the used d3 submodules was not verified. Plot's `tickFormat` option documentation, ECharts' `axisLabel.formatter`, and Vega-Lite's format options were not retrieved this run.

**5. Accessibility.** No evidence retrieved for any of the five. Recorded as a gap below, not answered.

| [n] | claim | source URL | publisher | pub_date | accessed | confidence | class |
|---|---|---|---|---|---|---|---|
| 1 | uPlot renders 166,650 points in 25 ms cold, ~100k points/ms after; ~50 KB min (47.9 KB); no WebGL/WASM; no decimation feature mentioned | https://raw.githubusercontent.com/leeoniya/uPlot/master/README.md | uPlot (leeoniya) | undated (master) | 2026-08-01 | medium | scale |
| 2 | Chart.js decimation: `lttb`/`min-max`, samples=canvas width, threshold=4× canvas width, off by default; requires line chart, indexAxis 'x', linear/time x-axis, `parsing:false`, and a **mutable dataset** — stores original as `dataset._data` and redefines `data` | https://www.chartjs.org/docs/latest/configuration/decimation.html | Chart.js | latest docs | 2026-08-01 | high | api |
| 3 | Vega-Lite/Altair: interactive charts slow "into the thousands" of points; JS-evaluated transforms are the bottleneck; sampling can be slower than drawing; an ordinal-scale crash on mid-sized datasets is reported | https://altair-viz.github.io/user_guide/large_datasets.html , https://github.com/vega/vega-lite/issues/4974 | Vega-Altair docs / vega-lite tracker | undated | 2026-08-01 | low | scale |
| 4 | ECharts line series `sampling` supports `lttb`, `average`, `max`, `min`, `sum`; issue #19814 reports `sampling` breaking `updateAxisPointer` | https://github.com/apache/echarts/issues/9403 , https://github.com/apache/echarts/issues/19814 (titles/snippets only) | Apache ECharts tracker | undated | 2026-08-01 | medium | api |
| 5 | ECharts `sampling:'lttb'` with null values renders sparse/"disordered" lines and loses correct gap rendering; closed as "not planned" | https://github.com/apache/echarts/issues/19383 | Apache ECharts | 2023-12-12 | 2026-08-01 | medium | failure |
| 6 | uPlot: width/height are required at init; axis `values` takes `(self,ticks,space)=>values` or token array; series `value` formatter for legend; x-values must be numbers, unique, ascending; no setSize/auto-resize documented on this page | https://raw.githubusercontent.com/leeoniya/uPlot/master/docs/README.md | uPlot (leeoniya) | undated (master) | 2026-08-01 | medium | api |
| 7 | ECharts chart initialised under `display:none` gets width 0 and does **not** recover when the parent becomes visible; reported v4.2.1, closed as stale | https://github.com/apache/echarts/issues/11155 | Apache ECharts | 2019-09-02 | 2026-08-01 | high | failure |
| 8 | Hidden/zero-size container init breaks Chart.js, Highcharts (falls back to 600×400), ECharts and Plotly alike; workaround is an explicit reflow/resize after showing | https://github.com/highcharts/highcharts/issues/212 , https://github.com/plotly/plotly.js/issues/2769 | various trackers | undated | 2026-08-01 | medium | behaviour |
| 9 | Chart.js time scale **requires** a date library + adapter, none bundled; formatting via `time.displayFormats`, `time.tooltipFormat` (adapter-defined syntax) and `ticks.callback` | https://www.chartjs.org/docs/latest/axes/cartesian/time.html | Chart.js | latest docs | 2026-08-01 | high | api |
| 10 | Observable Plot v0.6.17 depends on `d3 ^7.9.0`, `interval-tree-1d ^1.0.0`, `isoformat ^0.2.0` | https://raw.githubusercontent.com/observablehq/plot/main/package.json | Observable | main branch | 2026-08-01 | high | version |

## Leads

- **Contradiction (unresolved):** search-surfaced reporting says Vega-Lite's `sample` transform makes rendering *slower* than drawing all 50K points [3], which inverts the usual premise that downsampling helps. The source is secondary and unread. Read vega-lite discussion #7916 and issue #9424 ("grid-based transform limits for downsampling") directly before relying on either direction.
- **Contradiction (the researcher's own, flagged):** uPlot is believed to expose `setSize()`, but neither retrieved uPlot document mentions it [1][6]. Either the docs are incomplete or the belief is wrong. Resolve against `dist/uPlot.d.ts` in the repo — that also settles whether uPlot mutates the arrays it is handed, which the docs are silent on and which is the single most load-bearing unknown for frozen data.
- **Chart.js decimation is likely disqualified by the frozen-data constraint** [2] — the plugin writes to the dataset object. Worth confirming whether it writes to the dataset *object* only or also to the `data` *array* (a frozen array vs. a frozen wrapper are different failures).
- ECharts #19814 (`sampling` breaks `updateAxisPointer`) is unread and is a tooltip/crosshair-correctness risk on exactly the tile pattern described.
- ECharts #11155 was closed **stale, not fixed**, against v4.2.1 in 2019 [7]. Modern ECharts may auto-observe containers now; the old complaint must be re-tested against the current version before being cited as a live defect.
- Observable Plot's `d3` umbrella dependency [10] — the open question is not whether d3-format arrives (it does) but whether a bundler eliminates the unused submodules from a single-file build.
- The ECharts option reference is a client-rendered SPA and is not fetchable; use the repo's `src/chart/line/LineSeries.ts` or a static mirror for authoritative option semantics.

## Looked for and could not find

- Any primary source establishing that dashboard tiles conventionally render pre-aggregated data. Question 1's working assumption is **unconfirmed** — ceilings were found, not conventions.
- Documented practical point limits for **Apache ECharts** and **Observable Plot**. No numbers of any kind retrieved.
- Any evidence of the "silently dropped points" failure mode. Everything retrieved points to slow or zero-size, not silent loss.
- Whether uPlot, ECharts, Plot or Vega-Lite **mutate or sort the input array**. uPlot documents that data must *arrive* ascending [6] but says nothing about mutation. Only Chart.js's decimation plugin states a write [2]. This is the core `Object.freeze` question and it remains open for four of five candidates.
- Resize behaviour for **Observable Plot** and **Vega-Lite**: no ResizeObserver evidence either way.
- Formatter option names for **ECharts** (`axisLabel.formatter`), **Observable Plot** (`tickFormat`) and **Vega-Lite** — named in the brief as hypotheses, not verified this run.
- Whether ECharts or Vega-Lite pull a date/locale bundle by default. Only Chart.js [9] and Plot [10] were resolved.
- Accessibility: nothing retrieved on keyboard focus or screen-reader output for any of the five.
