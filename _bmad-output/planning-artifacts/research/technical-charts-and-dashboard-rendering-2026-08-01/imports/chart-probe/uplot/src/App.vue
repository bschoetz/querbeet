<script setup>
// Candidate: uPlot 1.6.32, canvas.
//
// Two things round 1 could not settle are asked here directly: whether
// `setSize()` exists at all (the docs never mention it), and whether uPlot
// writes to the arrays it is handed — the docs require ascending x and say
// nothing about who does the sorting.
import { ref, onMounted, nextTick } from 'vue';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { tileBar, tileLineColumnar, rawLine, appTickFormat, appDateFormat } from '../../shared-data.js';
import {
  SIZE_STEPS, checksum, countingFormatter, inspectDataUrl, countMarkerInDom,
  frame, msAsync, registerProbe,
} from '../../probe-util.js';

const bars = tileBar(12);
const lineCols = tileLineColumnar(730);

const fmtY = countingFormatter(appTickFormat);
const fmtX = countingFormatter((s) => appDateFormat(s * 1000));

const barEl = ref(null), lineEl = ref(null), hiddenEl = ref(null);
const hidden = ref(true);
let barPlot, linePlot, hiddenPlot;

// uPlot has no bar-chart primitive of its own in the core build; a categorical
// bar tile is drawn through the paths API. That is itself a finding about fit,
// so it is built rather than skipped.
const barsPath = uPlot.paths.bars ? uPlot.paths.bars({ size: [0.7, Infinity] }) : null;

function lineOpts(w, h) {
  return {
    width: w, height: h, cursor: { show: false }, legend: { show: false },
    axes: [
      { values: (u, ticks) => ticks.map(fmtX) },
      { values: (u, ticks) => ticks.map(fmtY), size: 96 },
    ],
    series: [{}, { stroke: '#eb3b5a', width: 1.2, points: { show: false } }],
    scales: { x: { time: false } },
  };
}

onMounted(async () => {
  barPlot = new uPlot({
    width: SIZE_STEPS[1].w, height: SIZE_STEPS[1].h, legend: { show: false }, cursor: { show: false },
    axes: [{ values: (u, ticks) => ticks.map((t) => bars[t]?.label ?? '') }, { values: (u, ticks) => ticks.map(fmtY), size: 96 }],
    series: [{}, { fill: '#4b7bec', paths: barsPath ?? undefined, points: { show: false } }],
    scales: { x: { time: false } },
  }, [bars.map((_, i) => i), bars.map((r) => r.value)], barEl.value);

  linePlot = new uPlot(lineOpts(SIZE_STEPS[1].w, SIZE_STEPS[1].h), lineCols, lineEl.value);
  hiddenPlot = new uPlot(lineOpts(520, 240), lineCols, hiddenEl.value);
  await frame();

  registerProbe({
    formatterHit() {
      return {
        calls: { y: fmtY.calls, x: fmtX.calls },
        domMarkers: countMarkerInDom(document.getElementById('app')),
        mode: 'canvas+dom-axes',   // uPlot draws axis text into the canvas
      };
    },

    frozenProbe() {
      const before = checksum(bars) + ':' + checksum(lineCols);
      let threw = null;
      try { linePlot.setData(lineCols); }
      catch (e) { threw = String(e).slice(0, 200); }
      const after = checksum(bars) + ':' + checksum(lineCols);
      return {
        threw, mutated: before !== after,
        inputFrozen: Object.isFrozen(lineCols) && Object.isFrozen(lineCols[0]),
        // The flagged contradiction: does setSize exist?
        hasSetSize: typeof linePlot.setSize === 'function',
      };
    },

    async resizeSteps() {
      const steps = [];
      for (const s of SIZE_STEPS) {
        lineEl.value.style.width = s.w + 'px';
        await nextTick(); await frame();
        const auto = Math.round(linePlot.over.getBoundingClientRect().width);
        const r = await msAsync(async () => { linePlot.setSize({ width: s.w, height: s.h }); await frame(); });
        steps.push({
          name: s.name, requested: s.w,
          autoFollowed: false, widthBeforeResizeCall: auto,
          widthAfterResizeCall: Math.round(linePlot.width), ms: r.ms,
        });
      }
      hidden.value = false;
      await nextTick(); await frame();
      const beforeCall = Math.round(hiddenPlot.width);
      hiddenPlot.setSize({ width: 520, height: 240 });
      await frame();
      return {
        steps,
        hiddenInit: {
          renderedWidthAfterShow: beforeCall,
          recoveredWithoutExplicitResize: beforeCall === 520,
          widthAfterExplicitResize: Math.round(hiddenPlot.width),
        },
      };
    },

    exportSnapshot() {
      const canvas = lineEl.value.querySelector('canvas');
      return { dom: inspectDataUrl(canvas.toDataURL('image/png')) };
    },

    async volumeLadder() {
      const out = [];
      for (const n of [1000, 10000, 100000, 500000]) {
        const data = rawLine(n);
        let r;
        try { r = await msAsync(async () => { linePlot.setData(data); await frame(); }); }
        catch (e) { out.push({ n, failed: String(e).slice(0, 160) }); break; }
        out.push({ n, ms: r.ms });
        if (r.ms > 10000) { out.push({ n, note: 'stopped: over 10 s' }); break; }
      }
      linePlot.setData(lineCols);
      await frame();
      return out;
    },
  });
});
</script>

<template>
  <main>
    <h1>querbeet R7 — uPlot 1.6.32 (canvas)</h1>
    <section class="tile"><h2>Umsatz je Bundesland</h2><div ref="barEl"></div></section>
    <section class="tile"><h2>Verlauf</h2><div ref="lineEl"></div></section>
    <section class="tile" :style="{ display: hidden ? 'none' : 'block' }">
      <h2>Verdeckt initialisiert</h2><div ref="hiddenEl"></div>
    </section>
  </main>
</template>

<style>
body { font: 14px/1.4 sans-serif; margin: 16px; background: #fff; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
.tile { border: 1px solid #ddd; padding: 8px; margin-bottom: 12px; display: inline-block; }
</style>
