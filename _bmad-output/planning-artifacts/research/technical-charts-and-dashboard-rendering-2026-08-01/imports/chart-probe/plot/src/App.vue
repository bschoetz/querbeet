<script setup>
// Candidate: Observable Plot 0.6.17, SVG.
//
// Plot has no chart instance to resize — `Plot.plot()` returns a fresh node, so
// every size step is a re-render and the tile owns the DOM swap. The question
// round 1 flagged is asked here: Plot's default styling arrives via a class
// name, so does the *serialized* node carry a <style> child, or does the
// snapshot land in an export document unstyled?
import { ref, onMounted, nextTick } from 'vue';
import * as Plot from '@observablehq/plot';
import { tileBar, tileLine, rawLineObjects, appTickFormat, appDateFormat } from '../../shared-data.js';
import {
  SIZE_STEPS, checksum, countingFormatter, inspectSvg, countMarkerInDom,
  frame, msAsync, registerProbe,
} from '../../probe-util.js';

const bars = tileBar(12);
const lineRows = tileLine(730);

const fmtY = countingFormatter(appTickFormat);
const fmtX = countingFormatter((d) => appDateFormat(+d));

const barBox = ref(null), lineBox = ref(null), hiddenBox = ref(null);
const hidden = ref(true);

function renderBar(w, h) {
  const node = Plot.plot({
    width: w, height: h, marginLeft: 100, marginBottom: 76,
    y: { tickFormat: fmtY, grid: true },
    x: { tickRotate: 35 },
    marks: [Plot.barY(bars, { x: 'label', y: 'value', fill: '#4b7bec' })],
  });
  barBox.value.replaceChildren(node);
  return node;
}

function renderLine(box, w, h, rows = lineRows) {
  const node = Plot.plot({
    width: w, height: h, marginLeft: 100,
    y: { tickFormat: fmtY, grid: true },
    x: { tickFormat: fmtX, type: 'utc' },
    marks: [Plot.lineY(rows, { x: (d) => new Date(d.t), y: 'value', stroke: '#eb3b5a' })],
  });
  box.replaceChildren(node);
  return node;
}

let lineNode;

onMounted(async () => {
  renderBar(SIZE_STEPS[1].w, SIZE_STEPS[1].h);
  lineNode = renderLine(lineBox.value, SIZE_STEPS[1].w, SIZE_STEPS[1].h);
  renderLine(hiddenBox.value, 520, 240);
  await frame();

  registerProbe({
    formatterHit() {
      return {
        calls: { y: fmtY.calls, x: fmtX.calls },
        domMarkers: countMarkerInDom(document.getElementById('app')),
        mode: 'svg',
      };
    },

    frozenProbe() {
      const before = checksum(bars) + ':' + checksum(lineRows);
      let threw = null;
      try { renderBar(SIZE_STEPS[1].w, SIZE_STEPS[1].h); lineNode = renderLine(lineBox.value, SIZE_STEPS[1].w, SIZE_STEPS[1].h); }
      catch (e) { threw = String(e).slice(0, 200); }
      const after = checksum(bars) + ':' + checksum(lineRows);
      return {
        threw, mutated: before !== after,
        inputFrozen: Object.isFrozen(bars) && Object.isFrozen(lineRows) && Object.isFrozen(lineRows[0]),
      };
    },

    async resizeSteps() {
      const steps = [];
      for (const s of SIZE_STEPS) {
        const r = await msAsync(async () => {
          lineNode = renderLine(lineBox.value, s.w, s.h); await nextTick(); await frame();
        });
        steps.push({
          name: s.name, requested: s.w,
          autoFollowed: false,   // Plot has no resize: a size step is a re-render
          widthAfterResizeCall: Math.round(lineNode.getBoundingClientRect().width),
          ms: r.ms,
        });
      }
      hidden.value = false;
      await nextTick(); await frame();
      const shown = hiddenBox.value.firstElementChild;
      return {
        steps,
        hiddenInit: {
          renderedWidthAfterShow: Math.round(shown.getBoundingClientRect().width),
          recoveredWithoutExplicitResize: Math.round(shown.getBoundingClientRect().width) > 0,
        },
      };
    },

    exportSnapshot() {
      const svg = lineNode.tagName === 'svg' ? lineNode : lineNode.querySelector('svg');
      const out = { dom: inspectSvg(svg) };
      // If the styling lives in the document rather than in the node, say so by
      // name: this is the difference between a working static export and a
      // silently unstyled one.
      out.wrapperTag = lineNode.tagName;
      out.styleSheetsInDocument = document.styleSheets.length;
      out.plotClassOnNode = svg.getAttribute('class');
      return out;
    },

    async volumeLadder() {
      const out = [];
      for (const n of [1000, 10000, 100000, 500000]) {
        const rows = rawLineObjects(n);
        let r;
        try {
          r = await msAsync(async () => {
            const node = Plot.plot({
              width: SIZE_STEPS[1].w, height: SIZE_STEPS[1].h, marginLeft: 100,
              y: { tickFormat: fmtY }, x: { tickFormat: fmtX, type: 'utc' },
              marks: [Plot.lineY(rows, { x: (d) => new Date(d.x), y: 'y', stroke: '#eb3b5a' })],
            });
            lineBox.value.replaceChildren(node);
            await frame();
          });
        } catch (e) { out.push({ n, failed: String(e).slice(0, 160) }); break; }
        out.push({ n, ms: r.ms });
        if (r.ms > 10000) { out.push({ n, note: 'stopped: over 10 s' }); break; }
      }
      lineNode = renderLine(lineBox.value, SIZE_STEPS[1].w, SIZE_STEPS[1].h);
      await frame();
      return out;
    },
  });
});
</script>

<template>
  <main>
    <h1>querbeet R7 — Observable Plot 0.6.17 (SVG)</h1>
    <section class="tile"><h2>Umsatz je Bundesland</h2><div ref="barBox"></div></section>
    <section class="tile"><h2>Verlauf</h2><div ref="lineBox"></div></section>
    <section class="tile" :style="{ display: hidden ? 'none' : 'block' }">
      <h2>Verdeckt initialisiert</h2><div ref="hiddenBox"></div>
    </section>
  </main>
</template>

<style>
body { font: 14px/1.4 sans-serif; margin: 16px; background: #fff; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
.tile { border: 1px solid #ddd; padding: 8px; margin-bottom: 12px; display: inline-block; }
</style>
