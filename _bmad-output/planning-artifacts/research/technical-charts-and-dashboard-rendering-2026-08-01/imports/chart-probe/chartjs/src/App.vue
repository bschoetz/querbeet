<script setup>
// Candidate: Chart.js 4.5.1, canvas only.
//
// Registered piecewise rather than via `chart.js/auto`, because auto pulls every
// controller. The date adapter is not optional: Chart.js ships none, and a time
// axis without one throws — so `chartjs-adapter-date-fns` plus `date-fns` are
// part of this candidate's real footprint, not an extra.
import { ref, onMounted, nextTick } from 'vue';
import {
  Chart, BarController, LineController, BarElement, LineElement, PointElement,
  LinearScale, CategoryScale, TimeScale, Tooltip,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { tileBar, tileLineColumnar, rawLine, appTickFormat, appDateFormat } from '../../shared-data.js';
import {
  SIZE_STEPS, checksum, countingFormatter, inspectDataUrl, countMarkerInDom,
  frame, msAsync, registerProbe,
} from '../../probe-util.js';

Chart.register(BarController, LineController, BarElement, LineElement, PointElement,
  LinearScale, CategoryScale, TimeScale, Tooltip);

const bars = tileBar(12);
const lineCols = tileLineColumnar(730);
// Chart.js wants {x,y} points for a linear/time x-axis. The array is frozen at
// both levels, exactly as querbeet would hand it over.
const linePoints = Object.freeze(
  lineCols[0].map((x, i) => Object.freeze({ x: x * 1000, y: lineCols[1][i] }))
);

const fmtY = countingFormatter(appTickFormat);
const fmtX = countingFormatter((ms) => appDateFormat(ms));

const barEl = ref(null), lineEl = ref(null), hiddenEl = ref(null);
const hidden = ref(true);
let barChart, lineChart, hiddenChart;

function lineConfig(data) {
  return {
    type: 'line',
    data: { datasets: [{ data, borderColor: '#eb3b5a', borderWidth: 1.2, pointRadius: 0 }] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      scales: {
        x: { type: 'time', ticks: { callback: (v) => fmtX(v) } },
        y: { ticks: { callback: (v) => fmtY(v) } },
      },
      plugins: { legend: { display: false } },
    },
  };
}

onMounted(async () => {
  barChart = new Chart(barEl.value, {
    type: 'bar',
    data: { labels: bars.map((r) => r.label), datasets: [{ data: bars.map((r) => r.value), backgroundColor: '#4b7bec' }] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      scales: { y: { ticks: { callback: (v) => fmtY(v) } } },
      plugins: { legend: { display: false } },
    },
  });
  lineChart = new Chart(lineEl.value, lineConfig(linePoints));
  hiddenChart = new Chart(hiddenEl.value, lineConfig(linePoints));
  await frame();

  registerProbe({
    formatterHit() {
      return {
        calls: { y: fmtY.calls, x: fmtX.calls },
        domMarkers: countMarkerInDom(document.getElementById('app')),
        mode: 'canvas',
      };
    },

    frozenProbe() {
      const before = checksum(bars) + ':' + checksum(linePoints);
      let threw = null;
      try { lineChart.update(); barChart.update(); }
      catch (e) { threw = String(e).slice(0, 200); }
      const after = checksum(bars) + ':' + checksum(linePoints);
      return {
        threw, mutated: before !== after,
        inputFrozen: Object.isFrozen(linePoints) && Object.isFrozen(linePoints[0]),
        // The decimation plugin is documented to redefine `data` on the dataset
        // and stash the original in `_data`. Ask whether it happened here.
        datasetRewritten: '_data' in lineChart.data.datasets[0],
      };
    },

    async resizeSteps() {
      const steps = [];
      for (const s of SIZE_STEPS) {
        const box = lineEl.value.parentElement;
        box.style.width = s.w + 'px';
        box.style.height = s.h + 'px';
        await nextTick();
        // Chart.js claims responsive:true observes the container itself.
        const r = await msAsync(async () => { await frame(); await frame(); });
        const auto = Math.round(lineChart.width);
        steps.push({ name: s.name, requested: s.w, autoFollowed: Math.abs(auto - s.w) <= 2, widthBeforeResizeCall: auto, ms: r.ms });
      }
      hidden.value = false;
      await nextTick(); await frame(); await frame();
      const beforeCall = Math.round(hiddenChart.width);
      hiddenChart.resize();
      await frame();
      return {
        steps,
        hiddenInit: {
          renderedWidthAfterShow: beforeCall,
          recoveredWithoutExplicitResize: beforeCall > 0 && beforeCall !== 300,
          widthAfterExplicitResize: Math.round(hiddenChart.width),
        },
      };
    },

    exportSnapshot() {
      return { dom: inspectDataUrl(lineChart.toBase64Image()) };
    },

    async volumeLadder() {
      const out = [];
      for (const n of [1000, 10000, 100000, 500000]) {
        const [xs, ys] = rawLine(n);
        const data = new Array(n);
        for (let i = 0; i < n; i++) data[i] = { x: xs[i] * 1000, y: ys[i] };
        let r;
        try {
          r = await msAsync(async () => {
            lineChart.data.datasets[0].data = data;
            lineChart.update('none');
            await frame();
          });
        } catch (e) { out.push({ n, failed: String(e).slice(0, 160) }); break; }
        out.push({ n, ms: r.ms });
        if (r.ms > 10000) { out.push({ n, note: 'stopped: over 10 s' }); break; }
      }
      lineChart.data.datasets[0].data = linePoints;
      lineChart.update('none');
      await frame();
      return out;
    },
  });
});
</script>

<template>
  <main>
    <h1>querbeet R7 — Chart.js 4.5.1 (canvas)</h1>
    <section class="tile"><h2>Umsatz je Bundesland</h2><div class="chart"><canvas ref="barEl"></canvas></div></section>
    <section class="tile"><h2>Verlauf</h2><div class="chart"><canvas ref="lineEl"></canvas></div></section>
    <section class="tile" :style="{ display: hidden ? 'none' : 'block' }">
      <h2>Verdeckt initialisiert</h2>
      <div class="chart" style="width: 520px; height: 240px"><canvas ref="hiddenEl"></canvas></div>
    </section>
  </main>
</template>

<style>
body { font: 14px/1.4 sans-serif; margin: 16px; background: #fff; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
.tile { border: 1px solid #ddd; padding: 8px; margin-bottom: 12px; display: inline-block; }
.chart { position: relative; width: 620px; height: 300px; }
</style>
