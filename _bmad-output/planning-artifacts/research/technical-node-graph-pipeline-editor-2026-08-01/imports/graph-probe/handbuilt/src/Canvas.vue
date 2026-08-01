<script setup>
import { ref, computed, shallowRef } from 'vue'
import { connect } from './graph.js'

const props = defineProps({ graph: Object, resultId: String })
const emit = defineEmits(['refused'])

const NODE_W = 180
const view = ref({ x: 0, y: 0, k: 1 })
const root = shallowRef(null)
const drag = ref(null)       // { kind:'node'|'pan'|'link', ... }
const pending = ref(null)    // live link being dragged

// screen -> graph space. The one coordinate conversion everything else depends on.
function toGraph(ev) {
  const r = root.value.getBoundingClientRect()
  return { x: (ev.clientX - r.left - view.value.x) / view.value.k,
           y: (ev.clientY - r.top - view.value.y) / view.value.k }
}
const port = (n, side) => ({ x: n.position.x + (side === 'out' ? NODE_W : 0), y: n.position.y + 26 })
const byId = (id) => props.graph.nodes.find((n) => n.id === id)

function path(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5)
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
}
const edgePaths = computed(() =>
  props.graph.edges.map((e) => {
    const s = byId(e.source), t = byId(e.target)
    return s && t ? { id: e.id, d: path(port(s, 'out'), port(t, 'in')) } : null
  }).filter(Boolean))

function onNodeDown(ev, n) {
  ev.stopPropagation()
  const p = toGraph(ev)
  drag.value = { kind: 'node', id: n.id, dx: p.x - n.position.x, dy: p.y - n.position.y }
}
function onPortDown(ev, n) {
  ev.stopPropagation()
  pending.value = { from: n.id, to: toGraph(ev) }
  drag.value = { kind: 'link' }
}
function onPanDown(ev) { drag.value = { kind: 'pan', x: ev.clientX - view.value.x, y: ev.clientY - view.value.y } }

function onMove(ev) {
  if (!drag.value) return
  if (drag.value.kind === 'node') {
    const p = toGraph(ev), n = byId(drag.value.id)
    n.position = { x: p.x - drag.value.dx, y: p.y - drag.value.dy }
  } else if (drag.value.kind === 'pan') {
    view.value = { ...view.value, x: ev.clientX - drag.value.x, y: ev.clientY - drag.value.y }
  } else if (drag.value.kind === 'link') {
    pending.value = { ...pending.value, to: toGraph(ev) }
  }
}
function onUp(ev) {
  if (drag.value?.kind === 'link') {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    const target = el && el.closest('[data-node-id]')
    if (target) {
      const r = connect(props.graph, pending.value.from, target.dataset.nodeId)
      if (!r.ok) emit('refused', r.reason)
    }
  }
  drag.value = null; pending.value = null
}
function onWheel(ev) {
  ev.preventDefault()
  const r = root.value.getBoundingClientRect()
  const mx = ev.clientX - r.left, my = ev.clientY - r.top
  const k = Math.min(2.5, Math.max(0.2, view.value.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)))
  // keep the point under the cursor fixed
  view.value = { k, x: mx - (mx - view.value.x) * (k / view.value.k), y: my - (my - view.value.y) * (k / view.value.k) }
}

defineExpose({ view, zoomIn: () => (view.value = { ...view.value, k: view.value.k * 1.2 }) })
</script>

<template>
  <div ref="root" class="qb-canvas" @pointerdown="onPanDown" @pointermove="onMove"
       @pointerup="onUp" @pointerleave="onUp" @wheel="onWheel">
    <svg class="qb-edges">
      <g :transform="`translate(${view.x},${view.y}) scale(${view.k})`">
        <g v-for="e in edgePaths" :key="e.id">
          <!-- widened transparent twin: hit testing on connections, for free -->
          <path :d="e.d" class="qb-edge-hit" data-probe-edge-hit />
          <path :d="e.d" class="qb-edge" data-probe-edge />
        </g>
        <path v-if="pending" :d="path(port(byId(pending.from), 'out'), pending.to)" class="qb-edge qb-pending" />
      </g>
    </svg>
    <div class="qb-layer" :style="{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }">
      <div v-for="n in graph.nodes" :key="n.id" class="qb-node" :data-node-id="n.id"
           :class="{ 'qb-orphan': !contributes.has(n.id) }"
           :style="{ left: n.position.x + 'px', top: n.position.y + 'px', width: NODE_W + 'px' }"
           @pointerdown="onNodeDown($event, n)">
        <slot :node="n" />
        <div class="qb-port qb-port-in" />
        <div class="qb-port qb-port-out" @pointerdown="onPortDown($event, n)" />
      </div>
    </div>
  </div>
</template>

<script>
import { contributingTo } from './graph.js'
export default {
  computed: { contributes() { return contributingTo(this.graph, this.resultId) } },
}
</script>

<style>
.qb-canvas { position: relative; width: 100%; height: 100%; overflow: hidden; background: #f4f4f5; touch-action: none; }
.qb-edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.qb-edge { fill: none; stroke: #52525b; stroke-width: 2; }
.qb-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }
.qb-pending { stroke-dasharray: 4 3; }
.qb-layer { position: absolute; inset: 0; transform-origin: 0 0; }
.qb-node { position: absolute; background: #fff; border: 1px solid #888; border-radius: 6px;
  padding: 8px; font: 12px sans-serif; display: flex; flex-direction: column; gap: 4px; cursor: grab; }
.qb-orphan { opacity: .5; border-style: dashed; }
.qb-port { position: absolute; top: 20px; width: 12px; height: 12px; border-radius: 50%; background: #52525b; }
.qb-port-in { left: -6px; } .qb-port-out { right: -6px; cursor: crosshair; }
</style>
