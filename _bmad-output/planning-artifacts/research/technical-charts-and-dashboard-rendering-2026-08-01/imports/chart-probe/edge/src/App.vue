<script setup>
// querbeet R7 tripwire — the five edge cases the verdict's counter-argument
// rests on, plus two that follow from the project decision itself.
//
// The pick is justified by ECharts having already absorbed the cases a
// hand-written tick algorithm would get wrong. This asks whether it has.
// Same registration as the chosen build: echarts/core, bar + line, SVG only.
import { ref, onMounted, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { appTickFormat, appDateFormat, MARKER } from '../../shared-data.js';
import { countingFormatter, frame, registerProbe } from '../../probe-util.js';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, SVGRenderer]);

const LABEL60 = 'Nordrhein-Westfalen und angrenzende Verwaltungsbezirke XY';   // 60 chars

// Each case is a bar tile unless it says otherwise. `expect` is what a correct
// renderer must do — checked mechanically below, not by eye.
const CASES = [
  { id: 'all-zero', kind: 'bar',
    rows: [['Bayern', 0], ['Hessen', 0], ['Berlin', 0], ['Bremen', 0]],
    expect: 'an axis that does not collapse and no NaN geometry' },
  { id: 'single-category', kind: 'bar',
    rows: [['Bayern', 4711.5]],
    expect: 'one bar of sane width, inside the plot area' },
  { id: 'negative', kind: 'bar',
    rows: [['Bayern', 1200], ['Hessen', -800], ['Berlin', 450], ['Bremen', -1500]],
    expect: 'a zero baseline with bars on both sides of it' },
  { id: 'all-negative', kind: 'bar',
    rows: [['Bayern', -1200], ['Hessen', -800], ['Berlin', -450]],
    expect: 'an axis whose range covers only negatives' },
  { id: 'empty', kind: 'bar', rows: [],
    expect: 'no throw, no NaN, and an empty plot rather than a broken one' },
  { id: 'label-60', kind: 'bar',
    rows: [[LABEL60, 900], ['Hessen', 400]],
    expect: 'the long label handled without escaping the SVG box' },
  // Two more, because the project decision banned `sampling` precisely over
  // null handling, and because one value repeated is the degenerate y-axis.
  { id: 'line-with-nulls', kind: 'line',
    points: [[0, 10], [1, 12], [2, null], [3, 9], [4, null], [5, 14]],
    expect: 'gaps rendered as gaps, no NaN in the path' },
  { id: 'flat-line', kind: 'line',
    points: [[0, 7], [1, 7], [2, 7], [3, 7]],
    expect: 'a degenerate y-range that still produces distinct ticks' },
];

const fmt = countingFormatter(appTickFormat);
const boxes = ref({});
const charts = {};

function optionFor(c) {
  if (c.kind === 'line') {
    return {
      animation: false, grid: { left: 100, right: 16, top: 12, bottom: 40 },
      xAxis: { type: 'value', axisLabel: { formatter: fmt } },
      yAxis: { type: 'value', axisLabel: { formatter: fmt } },
      series: [{ type: 'line', showSymbol: false, data: c.points }],
    };
  }
  return {
    animation: false, grid: { left: 100, right: 16, top: 12, bottom: 90 },
    xAxis: { type: 'category', data: c.rows.map((r) => r[0]), axisLabel: { rotate: 35, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: fmt } },
    series: [{ type: 'bar', data: c.rows.map((r) => r[1]) }],
  };
}

onMounted(async () => {
  const results = {};
  for (const c of CASES) {
    const el = boxes.value[c.id];
    const out = { id: c.id, kind: c.kind, expect: c.expect, threw: null };
    try {
      const ch = echarts.init(el, null, { renderer: 'svg' });
      charts[c.id] = ch;
      ch.setOption(optionFor(c));
    } catch (e) { out.threw = String(e).slice(0, 250); }
    results[c.id] = out;
  }
  await frame(); await nextTick(); await frame();

  registerProbe({
    inspect() {
      for (const c of CASES) {
        const out = results[c.id];
        const el = boxes.value[c.id];
        const svg = el.querySelector('svg');
        if (!svg) { out.noSvg = true; continue; }
        const xml = new XMLSerializer().serializeToString(svg);

        // A tick algorithm that divides by a zero range leaks these into the
        // geometry. Grepping the serialized output catches it wherever it lands.
        out.badNumbers = {
          NaN: (xml.match(/NaN/g) || []).length,
          Infinity: (xml.match(/Infinity/g) || []).length,
          undefined: (xml.match(/undefined/g) || []).length,
        };
        out.bytes = xml.length;

        // Every axis tick label, in render order. Duplicates are the tell for a
        // collapsed range: an all-zero column that ticks 0,0,0,0,0.
        const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
        const ticks = texts.filter((t) => t.includes(MARKER));
        out.axisTicks = ticks;
        out.distinctTicks = new Set(ticks).size;
        out.categoryLabels = texts.filter((t) => !t.includes(MARKER));

        // Does anything drawn escape the box the tile was given?
        //
        // getBBox() returns LOCAL coordinates, before the element's own
        // transform — and every ECharts text carries one, so a bbox read alone
        // reports every axis label as overflowing by ~11 px. It does not.
        // Screen rectangles against the SVG's own rectangle are the honest
        // comparison. This cost the first run of this probe a false positive on
        // seven of eight cases.
        const vb = svg.viewBox?.baseVal;
        const W = vb?.width || svg.clientWidth, H = vb?.height || svg.clientHeight;
        const svgRect = svg.getBoundingClientRect();
        const escapes = [];
        for (const n of svg.querySelectorAll('path,rect,text')) {
          const r = n.getBoundingClientRect();
          if (!r.width && !r.height) continue;
          if (!isFinite(r.x) || !isFinite(r.width)) { escapes.push({ tag: n.tagName, why: 'non-finite rect' }); continue; }
          const l = svgRect.left - r.left, rt = r.right - svgRect.right;
          const t = svgRect.top - r.top, bm = r.bottom - svgRect.bottom;
          const worst = Math.max(l, rt, t, bm);
          if (worst > 1) escapes.push({
            tag: n.tagName, text: (n.textContent || '').slice(0, 30) || null,
            outLeftPx: +l.toFixed(1), outRightPx: +rt.toFixed(1),
            outTopPx: +t.toFixed(1), outBottomPx: +bm.toFixed(1),
          });
        }
        out.escapes = escapes;
        out.clipped = escapes.length > 0;
        out.svgSize = { w: W, h: H };

        if (c.kind === 'bar') {
          // The series bars are the filled paths; grid lines and the plot
          // background are not. Filtering by width alone caught the grid, which
          // is why the first run reported four identical 344 px 'bars'.
          const bars = [...svg.querySelectorAll('path')]
            .filter((n) => { const f = n.getAttribute('fill'); return f && f !== 'none' && f !== '#000'; })
            .map((n) => { const b = n.getBBox(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; });
          out.expectedBars = c.rows.length;
          out.drawnBars = bars.length;
          out.bars = bars;
          out.plotWidth = W;
        } else {
          const paths = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d') || '');
          const series = paths.reduce((a, b) => (b.length > a.length ? b : a), '');
          out.seriesPathLength = series.length;
          // A null gap must break the path into separate M commands, not be
          // interpolated across or turned into NaN.
          out.moveCommands = (series.match(/M/g) || []).length;
          out.seriesPathSample = series.slice(0, 120);
        }
      }
      return results;
    },
  });
});
</script>

<template>
  <main>
    <h1>querbeet R7 — ECharts 6.1.0 SVG, Randfälle</h1>
    <section v-for="c in CASES" :key="c.id" class="tile">
      <h2>{{ c.id }} <small>— erwartet: {{ c.expect }}</small></h2>
      <div :ref="(el) => { if (el) boxes[c.id] = el; }" class="chart"></div>
    </section>
  </main>
</template>

<style>
body { font: 14px/1.4 sans-serif; margin: 16px; background: #fff; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 12px; font-weight: 600; margin: 0 0 4px; }
small { font-weight: 400; color: #666; }
.tile { border: 1px solid #ddd; padding: 8px; margin-bottom: 12px; display: inline-block; }
.chart { width: 460px; height: 280px; }
</style>
