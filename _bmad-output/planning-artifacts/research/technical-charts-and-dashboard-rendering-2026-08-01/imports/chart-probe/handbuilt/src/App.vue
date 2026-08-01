<script setup>
// Candidate: hand-written SVG. The baseline R6 established as a real option
// rather than a straw man — there, 164 lines carried a whole graph editor.
import { ref, shallowRef, nextTick, onMounted } from 'vue';
import BarTile from './BarTile.vue';
import LineTile from './LineTile.vue';
import {
  tileBar, tileLine, tileLineColumnar, rawLine, appTickFormat, appDateFormat,
} from '../../shared-data.js';
import {
  SIZE_STEPS, checksum, countingFormatter, inspectSvg, countMarkerInDom,
  frame, msAsync, registerProbe,
} from '../../probe-util.js';

const bars = tileBar(12);
const lineCols = tileLineColumnar(730);

// The x column is seconds (uPlot's convention, kept identical across candidates
// so the same data feeds all five); the app's date formatter takes ms.
const fmtY = countingFormatter(appTickFormat);
const fmtX = countingFormatter((s) => appDateFormat(s * 1000));

const size = ref(SIZE_STEPS[1]);
const lineData = shallowRef(lineCols);
const barRoot = ref(null);
const lineRoot = ref(null);
const hidden = ref(true);
const hiddenRoot = ref(null);

onMounted(async () => {
  await frame();

  registerProbe({
    formatterHit() {
      return {
        calls: { y: fmtY.calls, x: fmtX.calls },
        domMarkers: countMarkerInDom(document.getElementById('app')),
        mode: 'svg',
      };
    },

    // The frozen question, asked twice: did rendering throw, and did the
    // caller's array survive byte-identical?
    frozenProbe() {
      const before = checksum(bars) + ':' + checksum(lineCols);
      let threw = null;
      try {
        // rendering already happened at mount; force one more pass
        lineData.value = tileLineColumnar(730);
        lineData.value = lineCols;
      } catch (e) { threw = String(e).slice(0, 200); }
      const after = checksum(bars) + ':' + checksum(lineCols);
      return {
        threw,
        mutated: before !== after,
        inputFrozen: Object.isFrozen(bars) && Object.isFrozen(lineCols),
      };
    },

    async resizeSteps() {
      const steps = [];
      for (const s of SIZE_STEPS) {
        const r = await msAsync(async () => { size.value = s; await nextTick(); });
        const box = lineRoot.value?.$el?.getBoundingClientRect?.() ?? { width: 0 };
        steps.push({ name: s.name, requested: s.w, rendered: Math.round(box.width), ms: r.ms });
      }
      // The classic tile-grid bug: a chart born in a display:none container.
      hidden.value = false;
      await nextTick(); await frame();
      const hbox = hiddenRoot.value?.$el?.getBoundingClientRect?.() ?? { width: 0 };
      return {
        steps,
        hiddenInit: {
          renderedWidthAfterShow: Math.round(hbox.width),
          recoveredWithoutExplicitResize: Math.round(hbox.width) > 0,
        },
      };
    },

    exportSnapshot() {
      return inspectSvg(lineRoot.value.$el);
    },

    async volumeLadder() {
      const out = [];
      for (const n of [1000, 10000, 100000, 500000]) {
        const data = rawLine(n);
        let r;
        try {
          r = await msAsync(async () => { lineData.value = data; await nextTick(); });
        } catch (e) {
          out.push({ n, failed: String(e).slice(0, 160) });
          break;
        }
        out.push({ n, ms: r.ms });
        if (r.ms > 10000) { out.push({ n, note: 'stopped: over 10 s' }); break; }
      }
      lineData.value = lineCols;
      await nextTick();
      return out;
    },
  });
});
</script>

<template>
  <main>
    <h1>querbeet R7 — handbuilt SVG</h1>
    <section class="tile" :style="{ width: size.w + 'px' }">
      <h2>Umsatz je Bundesland</h2>
      <BarTile ref="barRoot" :rows="bars" :format="fmtY" :width="size.w" :height="size.h" />
    </section>
    <section class="tile" :style="{ width: size.w + 'px' }">
      <h2>Verlauf</h2>
      <LineTile
        ref="lineRoot" :cols="lineData" :format-x="fmtX" :format-y="fmtY"
        :width="size.w" :height="size.h"
      />
    </section>
    <section class="tile" :style="{ display: hidden ? 'none' : 'block', width: '520px' }">
      <h2>Verdeckt initialisiert</h2>
      <LineTile
        ref="hiddenRoot" :cols="lineCols" :format-x="fmtX" :format-y="fmtY"
        :width="520" :height="240"
      />
    </section>
  </main>
</template>

<style>
body { font: 14px/1.4 sans-serif; margin: 16px; background: #fff; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
.tile { border: 1px solid #ddd; padding: 8px; margin-bottom: 12px; }
</style>
