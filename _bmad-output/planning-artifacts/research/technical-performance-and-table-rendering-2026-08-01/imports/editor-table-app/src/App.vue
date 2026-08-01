<script setup>
// R4/D4 — M6. The Editor spike, unchanged in its wiring, with two things added:
// a real virtualized table window beside the canvas, and a Step count the driver
// can dial from 6 to 30.
//
// Everything about the Vue Flow integration below — design B, applyDefault
// false, the projection watcher, the guarded doors — is carried over verbatim
// from `spikes/editor-vueflow-2026-08-01`, because the point is to measure the
// build that was already validated, not a fresh one.
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'

import Background from './flow/Background.vue'
import SourceNode from './nodes/SourceNode.vue'
import UnionNode from './nodes/UnionNode.vue'
import JoinNode from './nodes/JoinNode.vue'
import FilterNode from './nodes/FilterNode.vue'
import TableWindow from './TableWindow.vue'

import {
  editor, graph, tables, refusal, journal, lastRefusal,
  flowNodes, flowEdges, parseEdgeId, orphanIds, brokenById, seedIdCounter,
} from './editor.js'
import { makeFrozenTable } from './shared-data.js'
import { installHarness } from './harness.js'
import { createPerf } from './perf.js'

const vf = useVueFlow()
const {
  setNodes, setEdges, onNodesChange, onEdgesChange, onConnect, onConnectStart,
  onConnectEnd, fitView, applyNodeChanges, applyEdgeChanges, panBy,
} = vf

const changeLog = []

watch([flowNodes, flowEdges], ([ns, es]) => { setNodes(ns); setEdges(es) }, { immediate: true, flush: 'post' })

onNodesChange((changes) => {
  changeLog.push(...changes.map((c) => ({ from: 'nodes', type: c.type, id: c.id ?? c.item?.id })))
  for (const c of changes) {
    if (c.type === 'position' && c.position) editor.move(c.id, c.position.x, c.position.y)
    else if (c.type === 'remove') editor.removeNode(c.id)
  }
  applyViewState(changes, applyNodeChanges)
})

onEdgesChange((changes) => {
  changeLog.push(...changes.map((c) => ({ from: 'edges', type: c.type, id: c.id ?? c.item?.id })))
  for (const c of changes) {
    if (c.type !== 'remove') continue
    const p = parseEdgeId(c.id)
    if (p) editor.disconnect(p.target, p.slot)
  }
  applyViewState(changes, applyEdgeChanges)
})

const VIEW_STATE_CHANGES = new Set(['select'])
function applyViewState(changes, apply) {
  const viewOnly = changes.filter((c) => VIEW_STATE_CHANGES.has(c.type))
  if (viewOnly.length) apply(viewOnly)
}

onConnectStart(() => { lastRefusal.value = null })
onConnect((conn) => {
  const slot = Number(String(conn.targetHandle || '').replace('in-', ''))
  editor.connect(conn.source, conn.target, slot)
})
onConnectEnd(() => { if (lastRefusal.value) refusal.value = { op: 'connect (Zeiger)', reason: lastRefusal.value } })

const canvas = ref(null)
const VIEW_MARGIN = 24
function onFocusIn(event) {
  const nodeEl = event.target?.closest?.('.vue-flow__node')
  if (!nodeEl || !canvas.value) return
  const node = nodeEl.getBoundingClientRect()
  const pane = canvas.value.getBoundingClientRect()
  const shortfall = (lowNode, highNode, lowPane, highPane) => {
    if (highNode - lowNode > highPane - lowPane) return lowPane + VIEW_MARGIN - lowNode
    if (lowNode < lowPane + VIEW_MARGIN) return lowPane + VIEW_MARGIN - lowNode
    if (highNode > highPane - VIEW_MARGIN) return highPane - VIEW_MARGIN - highNode
    return 0
  }
  const dx = shortfall(node.left, node.right, pane.left, pane.right)
  const dy = shortfall(node.top, node.bottom, pane.top, pane.bottom)
  if (dx || dy) panBy({ x: dx, y: dy })
}

const status = computed(() => ({ steps: graph.value.nodes.length, edges: flowEdges.value.length }))

// ---------------------------------------------------------------------------
// The table pane. One frozen 100,000 x 20 dataset, rendered 50 rows at a time
// over a spacer — D1's winning shape, built rather than simulated.
// ---------------------------------------------------------------------------
const COLUMNS = Array.from({ length: 8 }, (_, i) => 'c' + i)   // 8 of 20 fit the pane
const dataset = makeFrozenTable(100000, 20)
const tableRef = ref(null)
const showTable = ref(true)

// ---------------------------------------------------------------------------
// A graph of N Steps. Five Sources, a Union, then a chain alternating Filter and
// Join so the tall, variable-height bodies are present at scale — R6's tripwire
// family is exactly what 30 ResizeObservers are observing.
// ---------------------------------------------------------------------------
function seed(stepCount) {
  editor.clear()
  const cols = Array.from({ length: 20 }, (_, i) => 'c' + i)
  const srcIds = []
  for (let s = 0; s < 5; s++) {
    const id = 's' + s
    editor.addNode('source', { id, name: 'Quelle ' + s, x: 40, y: 40 + s * 160, config: { file: `q${s}.csv`, columns: cols } })
    srcIds.push(id)
  }
  editor.addNode('union', { id: 'u0', name: 'Union', x: 340, y: 120, inputs: ['s0', 's1'] })
  let prev = 'u0'
  let placed = 6
  let col = 1
  while (placed < stepCount) {
    const i = placed
    const id = 'n' + i
    const x = 340 + col * 280
    const y = 40 + (i % 5) * 160
    if (i % 4 === 0) editor.addNode('join', { id, name: 'Join ' + i, x, y, inputs: [prev, srcIds[i % 5]] })
    else editor.addNode('filter', { id, name: 'Filter ' + i, x, y, inputs: [prev] })
    prev = id
    placed++
    if (placed % 5 === 0) col++
  }
  editor.setResult(prev)
  editor.attachTable('s0', dataset)
  seedIdCounter(stepCount + 2)
}

const perf = ref(null)
const mountStats = ref({})

async function tick() {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

async function buildGraph(stepCount) {
  const t0 = performance.now()
  seed(stepCount)
  await tick()
  const mountMs = performance.now() - t0
  fitView({ padding: 0.1 })
  await tick()
  return {
    stepCount,
    mountMs: +mountMs.toFixed(1),
    nodesInDom: document.querySelectorAll('.vue-flow__node').length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  }
}

onMounted(async () => {
  const initial = Number(new URLSearchParams(location.search).get('steps')) || 30
  mountStats.value = await buildGraph(initial)
  installHarness(vf, changeLog)
  perf.value = createPerf({
    table: tableRef,
    viewport: { get value() { return document.querySelector('[data-t="viewport"]') } },
    rowCount: dataset.length,
  })

  // The driver reaches everything through here.
  window.__qbPerf = {
    perf: perf.value,
    buildGraph: async (n) => { const s = await buildGraph(n); mountStats.value = s; return s },
    stats: () => ({ ...mountStats.value, showTable: showTable.value }),
    setTable: async (on) => { showTable.value = on; await tick(); return showTable.value },
    // 30 nodes, 30 ResizeObservers: growing every body at once is the storm the
    // brief names as the contention mechanism to watch.
    // Lengthening the name does NOT change a node's height — the name lives in
    // a fixed-height input, and this probe's first run measured exactly nothing
    // because of it. Driving height from CSS does change it, on all 30 at once,
    // which is the storm the brief asks about.
    growAllNodes: async (extra) => {
      const t0 = performance.now()
      document.documentElement.style.setProperty('--qb-extra', extra ? extra * 8 + 'px' : '0px')
      await tick()
      return +(performance.now() - t0).toFixed(1)
    },
    nodeHeights: () => [...document.querySelectorAll('.qb-node')].map((e) => +e.getBoundingClientRect().height.toFixed(1)),
    tick,
  }
  document.title = 'READY'
})
</script>

<template>
  <div class="qb-app">
    <header class="qb-toolbar">
      <strong>querbeet · R4/D4 Kontention</strong>
      <span data-t="status">{{ status.steps }} Steps · {{ status.edges }} Verbindungen</span>
      <label class="qb-check"><input type="checkbox" v-model="showTable" data-t="toggle-table" /> Tabelle</label>
    </header>

    <div class="qb-panes">
      <div class="qb-canvas" ref="canvas" @focusin="onFocusIn">
        <VueFlow :apply-default="false" delete-key-code="Delete" :min-zoom="0.05">
          <Background />
          <template #node-source="p"><SourceNode v-bind="p" /></template>
          <template #node-union="p"><UnionNode v-bind="p" /></template>
          <template #node-join="p"><JoinNode v-bind="p" /></template>
          <template #node-filter="p"><FilterNode v-bind="p" /></template>
        </VueFlow>
      </div>
      <div v-if="showTable" class="qb-tableside">
        <TableWindow ref="tableRef" :rows="dataset" :columns="COLUMNS" />
      </div>
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.4 system-ui, sans-serif; color: #1c2430; }
.qb-app { display: flex; flex-direction: column; height: 100vh; }
.qb-toolbar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #d7dce3; background: #f6f8fa; }
.qb-panes { flex: 1; display: flex; min-height: 0; }
.qb-canvas { flex: 1 1 60%; position: relative; min-height: 0; min-width: 0; }
.qb-tableside { flex: 0 0 40%; min-width: 0; min-height: 0; }

.qb-node {
  position: relative; background: #fff; border: 1px solid #9aa4b2; border-radius: 7px;
  padding: 7px 9px calc(9px + var(--qb-extra, 0px)); min-width: 186px; max-width: 260px; display: flex; flex-direction: column; gap: 5px;
  box-shadow: 0 1px 3px rgba(20, 30, 45, 0.12);
}
.qb-node.qb-result { border-color: #2b6cb0; box-shadow: 0 0 0 2px rgba(43, 108, 176, 0.25); }
.qb-node.qb-broken { border-color: #c53030; background: #fffafa; }
.qb-node.qb-orphan { opacity: 0.72; border-style: dashed; }
.qb-head { display: flex; align-items: center; gap: 5px; }
.qb-kind { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a6675; }
.qb-name { flex: 1; min-width: 0; font: inherit; font-weight: 600; border: 1px solid transparent; background: transparent; padding: 1px 3px; border-radius: 3px; }
.qb-name:focus { border-color: #9aa4b2; background: #fff; }
.qb-badge { font-size: 10px; border: 1px solid #9aa4b2; background: #fff; border-radius: 9px; padding: 1px 6px; cursor: pointer; }
.qb-badge.on { background: #2b6cb0; border-color: #2b6cb0; color: #fff; }
.qb-warn { margin: 0; color: #9b2c2c; font-size: 11px; }
.qb-note { margin: 0; color: #7a6320; font-size: 11px; }
.qb-slots { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.qb-slot { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; background: #f2f5f8; border-radius: 3px; padding: 1px 5px; }
.qb-slot-label { color: #5a6675; }
.qb-slot-value { font-family: ui-monospace, monospace; }
.qb-body { display: flex; flex-direction: column; gap: 5px; }
.qb-field { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #5a6675; }
.qb-field input, .qb-field select { font: inherit; flex: 1; min-width: 0; }
.qb-check { font-size: 11px; color: #5a6675; display: flex; align-items: center; gap: 4px; }
.qb-row { display: flex; gap: 5px; }
.qb-table { border-collapse: collapse; font-size: 11px; }
.qb-table td { padding: 1px; }
.qb-table input, .qb-table select { font: inherit; }
.qb-eq { color: #5a6675; }
.qb-node button { font: inherit; font-size: 11px; padding: 1px 6px; border: 1px solid #9aa4b2; background: #fff; border-radius: 3px; cursor: pointer; }
.qb-edge-orphan .vue-flow__edge-path { stroke-dasharray: 4 3; opacity: 0.6; }
.vue-flow__handle { width: 9px; height: 9px; background: #2b6cb0; border: 1px solid #fff; }
</style>
