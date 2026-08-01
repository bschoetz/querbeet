# Digest — static export (SVG vs canvas, print, PDF) — round 1

Researcher: dimension 2. Budget: 13 tool calls, 14 cited sources.

## Findings

**1. What each candidate renders to.**

Canvas-only: **uPlot** is described by its own repo/npm as "a fast, memory-efficient Canvas 2D-based chart", ~50 KB, explicitly not WebGL/WASM [7]. **Chart.js** is canvas-only — its developer API is built around `new Chart(ctx, config)` with a canvas rendering context, and the API reference contains no SVG path at all [2].

SVG-only: **Observable Plot** — "By default, plot returns an SVG element"; it is wrapped in an HTML `<figure>` automatically when the plot has a title, subtitle, legend or caption, or when `figure: true`. The documentation mentions no canvas rendering anywhere [3]. **Frappe Charts** describes itself as "Simple, responsive, modern SVG Charts with zero dependencies" [8].

Both, by option: **Apache ECharts** — `init` takes `renderer: 'canvas' | 'svg'` [5]. The official handbook is unusually candid about what SVG costs: canvas is recommended above roughly 1k elements and for heavy visual effects, heatmaps, scatter and geo/parallel plots; SVG wins on low-end/mobile devices, on pages with many chart instances (avoiding browser crashes), and for zoom sharpness. Concretely lost in SVG mode: "some special effects still relies on Canvas" — the trail effect and heatmap blending effects [1]. The SVG renderer landed in v4.0 and was rewritten on a virtual DOM in v5.3.0, claimed 2–10x faster [1]. **billboard.js** is D3-based with SVG as the default renderer; a canvas mode was added in 4.0, where the maintainer's own release note states "SVG remains the default rendering mode and continues to provide the richest styling model" and canvas trades per-node DOM styling for rendering performance [9][10]. **Vega / Vega-Lite** supports `canvas` (default) and `svg` renderers, with more registrable via `renderModule` [4].

**2. Documented static-snapshot APIs.**

- **ECharts**: with `renderer: 'svg'` plus `ssr: true`, "it will no longer render automatically every frame, you have to use the `renderToSVGString` method to get the rendered SVG string" [5]. The handbook frames this exact API as the way to embed charts "in environments such as Markdown and PDF that do not support scripts", with two documented costs: width and height must be given explicitly (no responsive container), and interaction-related features are unsupported [6]. Could **not** retrieve the `getDataURL` definition this run — the API file read only cross-references it (see gaps).
- **Chart.js**: `toBase64Image(type?, quality?)` "returns a base 64 encoded string of the chart in its current state" — a data URL, i.e. self-contained raster, no external reference [2].
- **Observable Plot**: the returned SVG element is a live DOM node, serializable as standard SVG/HTML. Caveat for a self-contained snapshot: the SVG "receives a class name that applies a default stylesheet", i.e. styling is partly carried by a generated stylesheet rather than inline attributes [3]. Default font-family is `system-ui` — no web-font fetch, which is what a `file://` page needs, but it also means the PDF/HTML will use whatever the viewer has.
- **Vega**: `view.toSVG(scaleFactor?)` is async and "resolves to an SVG string, providing a vector graphics image of the view"; `toImageURL()` resolves to an image URL; `toCanvas()` resolves to a canvas [4].
- **uPlot / Chart.js**: only the canvas is available, so the snapshot is necessarily a raster data URI.
- **Frappe / billboard.js**: no export API retrieved this round.

**3. Printing — the load-bearing part, and the honest result.**

The single most-cited "canvas goes blank when printing" bug, Mozilla bug 1696619, is **RESOLVED INVALID**: the reporter's canvas disappeared from print preview and printed output in Firefox 86/88 on Windows and Ubuntu, and the cause was that "Print backgrounds" was off; enabling it fixed it [11]. That is evidence *for* the background-graphics hazard in the brief and *against* treating canvas-blank-in-print as an intrinsic canvas defect. Note the trap this creates: a chart whose fill comes from CSS backgrounds vanishes in the default print settings regardless of renderer, and the user must tick a box the page cannot set.

The one reproduced, library-specific print failure found is Chart.js discussion #10986: printing a page containing a Chart.js canvas emitted hundreds of blank pages in Chrome and Edge, reported Dec 2022, confirmed with a test case Jan 2023 — and confirmed in the same thread that **Chart.js 3+ does not exhibit it**; the fault was in 2.x's `chartjs-size-monitor` resize elements, fixed by `position: fixed` on them or by upgrading [12]. Against a current Chart.js this complaint is stale and should not be carried into the decision.

No retrieved evidence for `devicePixelRatio` rasterisation loss in print, or for `@media print` mis-sizing of a percentage-width chart container. Those remain untested claims, not findings.

**4. PDF libraries offline.**

Evidence here is thin and flagged as such. jsPDF's SVG handling: `addSvgAsImage` "parses SVG XML and saves it as an image into the PDF" and depends on a canvas element plus canvg — i.e. rasterised, not vector [13]. The same result surfaced an `addSvg`/`addSVG` path converting SVG PATH elements to PDF line arguments (true vector), but only via unofficial doc mirrors that look like an old plugin generation, so rated low and unconfirmed. On fonts: standard PDF fonts use WinAnsi/Windows-1252 encoding covering ~218 Latin characters, so anything outside it renders as tofu unless a font is embedded; **pdf-lib** exposes `embedFont` for exactly this, **pdfmake** supports embedding with reported Webpack friction, **jsPDF** needs explicit font configuration [14]. Whether ä/ö/ü specifically fall inside WinAnsi (so that the built-in fonts suffice for German) was **not** confirmed by anything retrieved — do not assume either way. Current versions, licences, minimum embedded font size, and cross-page table pagination behaviour: not retrieved.

**5. Retrospective accounts.** Only [12] qualifies as a reproduced production-side failure. No offline-HTML-report or generated-PDF retrospective with production numbers was retrieved within budget.

| [n] | claim | source URL | publisher | pub_date | accessed | confidence | class |
|---|---|---|---|---|---|---|---|
| 1 | ECharts SVG renderer since v4.0, vdom rewrite in v5.3.0 (2–10x); trail effect and heatmap blending rely on canvas and are unavailable in SVG; canvas advised >1k elements | https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/ | Apache ECharts (official handbook) | undated page | 2026-08-01 | high | api |
| 2 | Chart.js is canvas-only; `toBase64Image(type, quality)` "returns a base 64 encoded string of the chart in its current state" | https://www.chartjs.org/docs/latest/developers/api.html | Chart.js (official docs) | latest | 2026-08-01 | high | api |
| 3 | `Plot.plot()` returns an SVG element by default, wrapped in `<figure>` with title/subtitle/legend/caption or `figure:true`; no canvas; SVG carries a class applying a default stylesheet; default font system-ui | https://observablehq.com/plot/features/plots | Observable (official docs) | undated | 2026-08-01 | high | api |
| 4 | Vega `view.toSVG(scaleFactor)` is async, resolves to an SVG string; `toImageURL`, `toCanvas` also async; renderers canvas (default) and svg | https://vega.github.io/vega/docs/api/view/ | Vega (official docs) | undated | 2026-08-01 | high | api |
| 5 | ECharts `init` accepts `renderer: 'canvas'\|'svg'`; `ssr` "Only available in SVG rendering mode… you have to use the renderToSVGString method to get the rendered SVG string" | https://raw.githubusercontent.com/apache/echarts-doc/master/en/api/echarts.md | Apache ECharts docs repo | master | 2026-08-01 | high | api |
| 6 | SSR/`renderToSVGString` is the documented route for embedding ECharts in script-less environments (Markdown, PDF); requires explicit width/height; interaction-related features unsupported | https://apache.github.io/echarts-handbook/en/how-to/cross-platform/server/ | Apache ECharts handbook (search snippet, not full read) | undated | 2026-08-01 | medium | api |
| 7 | uPlot is Canvas-2D-based, ~50 KB, no WebGL/WASM | https://github.com/leeoniya/uPlot | leeoniya / uPlot repo (search snippet) | ongoing | 2026-08-01 | medium | api |
| 8 | Frappe Charts renders SVG, zero dependencies | https://github.com/frappe/charts | Frappe (search snippet) | ongoing | 2026-08-01 | medium | api |
| 9 | billboard.js is D3-based with SVG and Canvas rendering support | https://github.com/naver/billboard.js/ | Naver (search snippet) | ongoing | 2026-08-01 | medium | api |
| 10 | billboard.js 4.0 added canvas mode; SVG remains default and "provides the richest styling model"; canvas trades per-node DOM styling for performance | https://netil.medium.com/billboard-js-4-0-release-canvas-rendering-mode-94-3-faster-overall-in-benchmark-894b18798ffe | Jae Sung Park (maintainer), Medium | Jun 2026 | 2026-08-01 | medium | version |
| 11 | Canvas blank in Firefox 86/88 print preview and output — RESOLVED INVALID; cause was "Print backgrounds" disabled, fixed by enabling it | https://bugzilla.mozilla.org/show_bug.cgi?id=1696619 | Mozilla Bugzilla | 2021 (closed) | 2026-08-01 | high | failure |
| 12 | Chart.js 2.x printed hundreds of blank pages in Chrome/Edge; Chart.js 3+ unaffected; CSS `position: fixed` on `.chartjs-size-monitor-expand > div` works around it | https://github.com/chartjs/Chart.js/discussions/10986 | chartjs GitHub Discussions | 2022-12-16 → 2023-02-06 | 2026-08-01 | high | failure |
| 13 | jsPDF `addSvgAsImage` parses SVG XML and saves it as a raster image, depending on canvas + canvg | https://artskydj.github.io/jsPDF/docs/modules_svg.js.html | unofficial jsPDF doc mirror | undated | 2026-08-01 | low | api |
| 14 | Standard PDF fonts are WinAnsi/Windows-1252, ~218 Latin chars; non-covered characters render as tofu unless a font is embedded; pdf-lib `embedFont`, pdfmake embedding (Webpack friction), jsPDF requires font config | https://github.com/hopding/pdf-lib + https://dev.to/handdot/generate-a-pdf-in-js-summary-and-comparison-of-libraries-3k0p | pdf-lib repo / DEV comparison (search snippets) | ongoing / undated | 2026-08-01 | low-medium | behaviour |

## Leads

- **Contradiction to resolve:** the folklore "canvas goes blank in print" does not survive its own canonical bug — [11] is INVALID and reduces to print-backgrounds being off, while [12] is a real but 2.x-only Chart.js layout bug. Before any candidate is rejected on print grounds, someone must actually print a canvas chart and an SVG chart from a `file://` page in current Chrome and Firefox. This dimension currently has *no* retrieved evidence that a modern canvas chart fails browser print-to-PDF.
- **ECharts `getDataURL`** — its definition lives in the `echartsInstance` API doc, not the `echarts` module file fetched. Chase `en/api/echartsInstance.md` in apache/echarts-doc: whether it can emit an SVG data URI in SVG mode, or only PNG/JPEG from canvas, materially changes the ECharts story.
- **Observable Plot's stylesheet**: [3] says the SVG gets a class that applies a *default stylesheet*. If that stylesheet is injected once into the document rather than inlined per-SVG, a naively serialized `outerHTML` snapshot is unstyled. Verify whether Plot emits a `<style>` child inside the SVG — this is the difference between a working and a broken static export.
- **jsPDF vector SVG**: the modern answer is almost certainly `svg2pdf.js`, not the `addSvg` in [13]'s stale mirror. Chase the jsPDF README and the yWorks/svg2pdf.js repo for current version, licence, and which SVG features it drops.
- **Umlauts vs WinAnsi**: settle whether ä/ö/ü are inside Windows-1252 (they are Latin-1, so likely yes) with a real source. If yes, German text needs no embedded font in pdf-lib/jsPDF standard fonts, which removes a large chunk of payload from the single-file constraint.
- billboard.js 4.0 canvas mode is very recent (Jun 2026) — worth checking its issue tracker for export/print regressions before treating canvas mode as mature.
- Casey Primozic's uPlot notes (cprimozic.net) looked like a genuine practitioner retrospective; unread this run.

## Looked for and could not find

- Any documented or reproduced failure of `devicePixelRatio` rasterisation in browser print-to-PDF.
- Any documented case of `@media print` mis-sizing a percentage-width chart container (canvas or SVG).
- ECharts `getDataURL` parameters and return type (SVG data URI in SVG mode?).
- Whether Vega's `toSVG` output contains external references or font dependencies — the View API documents no caveats at all [4].
- Export/snapshot APIs for Frappe Charts and billboard.js.
- Current versions, licences, and release dates for jsPDF, pdf-lib, pdfmake (nothing retrieved inside the ≤1-month freshness bar).
- Smallest usable embedded font size, and cross-page table pagination behaviour, for any of the three PDF libraries.
- A production retrospective on shipping charts inside a self-contained offline HTML report; everything surfaced was tutorial-grade or a server-side tool (wkhtmltopdf) irrelevant to a no-network `file://` page.
