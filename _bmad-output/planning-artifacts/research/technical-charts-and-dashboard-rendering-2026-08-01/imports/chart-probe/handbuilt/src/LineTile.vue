<script setup>
// Hand-written SVG line chart. One <path> for the series, so the point count
// lands in a `d` attribute rather than in the node count — which is the only
// way a hand-built SVG has any chance at the volume ladder.
import { computed } from 'vue';

const props = defineProps({
  cols: { type: Array, required: true },      // [xs, ys], both ascending in x
  formatX: { type: Function, required: true },
  formatY: { type: Function, required: true },
  width: { type: Number, default: 480 },
  height: { type: Number, default: 260 },
});

const PAD = { top: 12, right: 16, bottom: 34, left: 92 };

const bounds = computed(() => {
  const [xs, ys] = props.cols;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ys.length; i++) { if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i]; }
  return { x0: xs[0], x1: xs[xs.length - 1], y0: minY, y1: maxY };
});

const plotW = computed(() => props.width - PAD.left - PAD.right);
const plotH = computed(() => props.height - PAD.top - PAD.bottom);

const d = computed(() => {
  const [xs, ys] = props.cols;
  const { x0, x1, y0, y1 } = bounds.value;
  const sx = plotW.value / ((x1 - x0) || 1);
  const sy = plotH.value / ((y1 - y0) || 1);
  const parts = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const px = PAD.left + (xs[i] - x0) * sx;
    const py = PAD.top + plotH.value - (ys[i] - y0) * sy;
    parts[i] = (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
  }
  return parts.join('');
});

const yTicks = computed(() => {
  const { y0, y1 } = bounds.value;
  return [0, 0.25, 0.5, 0.75, 1].map((f) => y0 + (y1 - y0) * f);
});
const xTicks = computed(() => {
  const { x0, x1 } = bounds.value;
  return [0, 0.5, 1].map((f) => x0 + (x1 - x0) * f);
});

function yPos(v) {
  const { y0, y1 } = bounds.value;
  return PAD.top + plotH.value - ((v - y0) / ((y1 - y0) || 1)) * plotH.value;
}
function xPos(v) {
  const { x0, x1 } = bounds.value;
  return PAD.left + ((v - x0) / ((x1 - x0) || 1)) * plotW.value;
}
</script>

<template>
  <svg
    class="qb-line" :width="width" :height="height"
    :viewBox="`0 0 ${width} ${height}`" role="img" aria-label="Liniendiagramm"
  >
    <g v-for="t in yTicks" :key="'y' + t">
      <line class="qb-grid" :x1="PAD.left" :x2="PAD.left + plotW" :y1="yPos(t)" :y2="yPos(t)" />
      <text class="qb-tick" :x="PAD.left - 8" :y="yPos(t) + 4" text-anchor="end">{{ formatY(t) }}</text>
    </g>
    <g v-for="t in xTicks" :key="'x' + t">
      <text class="qb-tick" :x="xPos(t)" :y="height - 12" text-anchor="middle">{{ formatX(t) }}</text>
    </g>
    <path :d="d" class="qb-series" />
  </svg>
</template>

<style scoped>
.qb-grid { stroke: #e2e2e2; stroke-width: 1; }
.qb-tick { font: 11px sans-serif; fill: #333; }
.qb-series { fill: none; stroke: #eb3b5a; stroke-width: 1.2; }
</style>
