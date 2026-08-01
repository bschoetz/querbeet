<script setup>
// Hand-written SVG bar chart. Deliberately not a toy: value axis with ticks
// through the app-supplied formatter, category labels, and a viewBox so the
// tile can be resized without re-laying out the geometry.
import { computed } from 'vue';

const props = defineProps({
  rows: { type: Array, required: true },
  format: { type: Function, required: true },
  width: { type: Number, default: 480 },
  height: { type: Number, default: 260 },
});

const PAD = { top: 12, right: 12, bottom: 56, left: 92 };

const max = computed(() => Math.max(...props.rows.map((r) => r.value)) || 1);
const plotW = computed(() => props.width - PAD.left - PAD.right);
const plotH = computed(() => props.height - PAD.top - PAD.bottom);

const ticks = computed(() => {
  const step = niceStep(max.value / 4);
  const out = [];
  for (let v = 0; v <= max.value; v += step) out.push(v);
  return out;
});

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
}

const bars = computed(() => {
  const n = props.rows.length;
  const slot = plotW.value / n;
  return props.rows.map((r, i) => {
    const h = (r.value / max.value) * plotH.value;
    return {
      label: r.label,
      value: r.value,
      x: PAD.left + i * slot + slot * 0.15,
      w: slot * 0.7,
      y: PAD.top + plotH.value - h,
      h,
    };
  });
});
</script>

<template>
  <svg
    class="qb-bar"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    role="img"
    aria-label="Balkendiagramm"
  >
    <g class="qb-axis">
      <line :x1="PAD.left" :y1="PAD.top" :x2="PAD.left" :y2="PAD.top + plotH" />
      <line
        :x1="PAD.left" :y1="PAD.top + plotH"
        :x2="PAD.left + plotW" :y2="PAD.top + plotH"
      />
      <g v-for="t in ticks" :key="t">
        <line
          :x1="PAD.left - 4" :x2="PAD.left + plotW"
          :y1="PAD.top + plotH - (t / max) * plotH"
          :y2="PAD.top + plotH - (t / max) * plotH"
          class="qb-grid"
        />
        <text
          class="qb-tick qb-tick-y"
          :x="PAD.left - 8"
          :y="PAD.top + plotH - (t / max) * plotH + 4"
          text-anchor="end"
        >{{ format(t) }}</text>
      </g>
    </g>
    <g>
      <rect
        v-for="b in bars" :key="b.label"
        :x="b.x" :y="b.y" :width="b.w" :height="b.h"
        class="qb-bar-rect"
      >
        <title>{{ b.label }}: {{ format(b.value) }}</title>
      </rect>
      <text
        v-for="b in bars" :key="'l' + b.label"
        class="qb-tick qb-tick-x"
        :x="b.x + b.w / 2" :y="height - PAD.bottom + 16"
        text-anchor="end"
        :transform="`rotate(-35 ${b.x + b.w / 2} ${height - PAD.bottom + 16})`"
      >{{ b.label }}</text>
    </g>
  </svg>
</template>

<style scoped>
.qb-axis line { stroke: #555; stroke-width: 1; }
.qb-grid { stroke: #e2e2e2; }
.qb-tick { font: 11px sans-serif; fill: #333; }
.qb-bar-rect { fill: #4b7bec; }
</style>
