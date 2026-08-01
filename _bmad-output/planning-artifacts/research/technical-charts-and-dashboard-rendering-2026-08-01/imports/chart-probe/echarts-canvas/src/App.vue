<script setup>
// Candidate: Apache ECharts 6.1.0, SVG renderer.
//
// Imported through `echarts/core` with only the bar and line charts and the two
// components they need, because the whole-library figure (367.9 KB gzip) is not
// the number that decides this — the tree-shaken one is, and nobody had it.
// The canvas twin of this app is `../echarts-canvas`, identical but for the
// renderer, so the renderer's own cost is isolated rather than argued about.
import { ref, onMounted, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { tileBar, tileLineColumnar, rawLine, appTickFormat, appDateFormat } from '../../shared-data.js';
import {
  SIZE_STEPS, checksum, countingFormatter, inspectSvg, inspectDataUrl,
  countMarkerInDom, frame, msAsync, registerProbe,
} from '../../probe-util.js';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const RENDERER = 'canvas';

const bars = tileBar(12);
const lineCols = tileLineColumnar(730);

const fmtY = countingFormatter(appTickFormat);
const fmtX = countingFormatter((s) => appDateFormat(s * 1000));

const barEl = ref(null), lineEl = ref(null), hiddenEl = ref(null);
const hidden = ref(true);
let barChart, lineChart, hiddenChart;

function barOption() {
  return {
    animation: false,
    grid: { left: 100, right: 16, top: 12, bottom: 70 },
    xAxis: { type: 'category', data: bars.map((r) => r.label), axisLabel: { rotate: 35, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: fmtY } },
    series: [{ type: 'bar', data: bars.map((r) => r.value) }],
  };
}

function lineOption(cols) {
  return {
    animation: false,
    grid: { left: 100, right: 16, top: 12, bottom: 40 },
    xAxis: { type: 'value', axisLabel: { formatter: fmtX } },
    yAxis: { type: 'value', axisLabel: { formatter: fmtY } },
    // The frozen columns are handed over as-is. ECharts' own `dataset` shape
    // wants rows, but a pair of column arrays is what querbeet holds, and the
    // point of this probe is what happens to *that*.
    series: [{ type: 'line', showSymbol: false, data: cols[0].map((x, i) => [x, cols[1][i]]) }],
  };
}

onMounted(async () => {
  barChart = echarts.init(barEl.value, null, { renderer: RENDERER });
  barChart.setOption(barOption());
  lineChart = echarts.init(lineEl.value, null, { renderer: RENDERER });
  lineChart.setOption(lineOption(lineCols));
  // Born inside display:none — the 2019 complaint, re-asked against 6.1.0.
  hiddenChart = echarts.init(hiddenEl.value, null, { renderer: RENDERER });
  hiddenChart.setOption(lineOption(lineCols));
  await frame();

  registerProbe({
    formatterHit() {
      return {
        calls: { y: fmtY.calls, x: fmtX.calls },
        domMarkers: countMarkerInDom(document.getElementById('app')),
        mode: RENDERER,
      };
    },

    frozenProbe() {
      const before = checksum(bars) + ':' + checksum(lineCols);
      let threw = null;
      try {
        lineChart.setOption(lineOption(lineCols), true);
        barChart.setOption(barOption(), true);
      } catch (e) { threw = String(e).slice(0, 200); }
      const after = checksum(bars) + ':' + checksum(lineCols);
      return { threw, mutated: before !== after, inputFrozen: Object.isFrozen(bars) && Object.isFrozen(lineCols) };
    },

    async resizeSteps() {
      const steps = [];
      for (const s of SIZE_STEPS) {
        // Two questions in one loop: does the chart follow the container on its
        // own, and what does an explicit resize() cost when it does not?
        lineEl.value.style.width = s.w + 'px';
        lineEl.value.style.height = s.h + 'px';
        await nextTick(); await frame();
        // Read the rendered element, not only the instance's own idea of its
        // width — the two can disagree, and the export takes the element.
        const auto = Math.round(lineChart.getWidth());
        const autoEl = Math.round((lineEl.value.querySelector('svg,canvas')?.getBoundingClientRect().width) ?? 0);
        const r = await msAsync(async () => { lineChart.resize(); await frame(); });
        steps.push({
          name: s.name, requested: s.w,
          autoFollowed: auto === s.w, widthBeforeResizeCall: auto, renderedWidthBeforeResizeCall: autoEl,
          widthAfterResizeCall: Math.round(lineChart.getWidth()), ms: r.ms,
        });
      }
      hidden.value = false;
      await nextTick(); await frame();
      const beforeCall = Math.round(hiddenChart.getWidth());
      hiddenChart.resize();
      await frame();
      return {
        steps,
        hiddenInit: {
          renderedWidthAfterShow: beforeCall,
          recoveredWithoutExplicitResize: beforeCall > 0,
          widthAfterExplicitResize: Math.round(hiddenChart.getWidth()),
        },
      };
    },

    exportSnapshot() {
      // No DOM to serialize in canvas mode — the pixels are the artefact.
      const out = { dom: inspectDataUrl(lineEl.value.querySelector('canvas').toDataURL('image/png')) };
      // The lead round 1 could not close: what getDataURL returns in SVG mode.
      try {
        const url = lineChart.getDataURL({ type: 'svg' });
        out.getDataURL = url.startsWith('data:image/svg')
          ? { ...inspectDataUrl(url), kind: 'svg-data-uri' }
          : inspectDataUrl(url);
      } catch (e) { out.getDataURL = { failed: String(e).slice(0, 200) }; }
      try {
        out.renderToSVGString = typeof lineChart.renderToSVGString === 'function'
          ? { bytes: new Blob([lineChart.renderToSVGString()]).size }
          : { absent: 'not a function on a non-ssr instance' };
      } catch (e) { out.renderToSVGString = { failed: String(e).slice(0, 200) }; }
      return out;
    },

    async volumeLadder() {
      const out = [];
      for (const n of [1000, 10000, 100000, 500000]) {
        const [xs, ys] = rawLine(n);
        const data = new Array(n);
        for (let i = 0; i < n; i++) data[i] = [xs[i], ys[i]];
        let r;
        try {
          // notMerge must stay false here: passing `true` drops the axis
          // configuration along with the series, which is a probe bug and not
          // an ECharts one — it cost this run one wrong result before it showed.
          r = await msAsync(async () => {
            lineChart.setOption({ ...lineOption(lineCols), series: [{ type: 'line', showSymbol: false, data }] });
            await frame();
          });
        } catch (e) { out.push({ n, failed: String(e).slice(0, 160) }); break; }
        out.push({ n, ms: r.ms, svgNodes: lineEl.value.querySelectorAll('*').length });
        if (r.ms > 10000) { out.push({ n, note: 'stopped: over 10 s' }); break; }
      }
      lineChart.setOption(lineOption(lineCols), true);
      await frame();
      return out;
    },
  });
});
</script>

<template>
  <main>
    <h1>querbeet R7 — ECharts 6.1.0 ({{ RENDERER }})</h1>
    <section class="tile"><h2>Umsatz je Bundesland</h2><div ref="barEl" class="chart"></div></section>
    <section class="tile"><h2>Verlauf</h2><div ref="lineEl" class="chart"></div></section>
    <section class="tile" :style="{ display: hidden ? 'none' : 'block' }">
      <h2>Verdeckt initialisiert</h2>
      <div ref="hiddenEl" class="chart" style="width: 520px; height: 240px"></div>
    </section>
  </main>
</template>

<style>
body { font: 14px/1.4 sans-serif; margin: 16px; background: #fff; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
.tile { border: 1px solid #ddd; padding: 8px; margin-bottom: 12px; display: inline-block; }
.chart { width: 620px; height: 300px; }
</style>
