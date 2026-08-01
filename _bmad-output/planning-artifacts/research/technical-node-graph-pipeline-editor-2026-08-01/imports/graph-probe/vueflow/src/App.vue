<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import SourceNode from './SourceNode.vue'
import FilterNode from './FilterNode.vue'
import ResultNode from './ResultNode.vue'
import { makeFrozenTable } from './shared-data.js'
import { assess, heap } from './assert.js'

const heapBefore = heap()
const frozenTable = makeFrozenTable()
const heapAfterTable = heap()

// The graph is authored as plain data the app owns. The frozen table goes in by
// reference — this is precisely gate G5 and the question both screens left open.
const nodes = ref([
  { id: 's1', type: 'source', position: { x: 20, y: 80 },
    data: { config: { file: 'umsatz.csv' }, table: frozenTable } },
  { id: 'f1', type: 'filter', position: { x: 300, y: 80 },
    data: { config: { column: 'c0', op: 'equals' } } },
  { id: 'r1', type: 'result', position: { x: 580, y: 80 },
    data: { config: { isResult: true } } },
])
const edges = ref([
  { id: 'e1', source: 's1', target: 'f1' },
  { id: 'e2', source: 'f1', target: 'r1' },
])

const { findNode, addNodes, addEdges, getNodes, getEdges, project, zoomIn } = useVueFlow()

onMounted(async () => {
  const t0 = performance.now()
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const mountMs = performance.now() - t0
  const heapAfterMount = heap()

  const edgePathsAtMount = document.querySelectorAll('path.vue-flow__edge-path, path[data-probe-edge], .baklava-connection').length
  // read the table back out of the library's own state
  const readback = findNode('s1').data.table

  // programmatic mutation without any pointer input
  let programmatic = null
  try {
    addNodes([{ id: 'f2', type: 'filter', position: { x: 300, y: 260 }, data: { config: { column: 'c1', op: 'contains' } } }])
    addEdges([{ id: 'e3', source: 's1', target: 'f2' }])
    await nextTick()
    programmatic = { ok: true, nodeCount: getNodes.value.length, edgeCount: getEdges.value.length }
  } catch (e) { programmatic = { ok: false, error: String(e) } }

  // does it refuse a cycle by itself? (PRD FR-12)
  let cycle = null
  try {
    const before = getEdges.value.length
    addEdges([{ id: 'cyc', source: 'r1', target: 's1' }])
    await nextTick()
    cycle = { accepted: getEdges.value.length > before, edgeCountAfter: getEdges.value.length,
              note: 'addEdges is the programmatic path; isValidConnection guards the pointer path only' }
  } catch (e) { cycle = { threw: String(e) } }

  // is pan/zoom present as an API rather than only a gesture?
  let zoomApi = null
  try { zoomIn(); zoomApi = { ok: true } } catch (e) { zoomApi = { ok: false, error: String(e) } }

  window.__RESULTS__ = assess({
    candidate: 'vue-flow@1.48.2',
    frozenTable, readback, domRoot: document,
    heapBefore, heapAfterTable, heapAfterMount, mountMs,
    extra: {
      edgePathsAtMount,
      programmatic, zoomApi, cycle,
      nodesArrayStillOurs: nodes.value[0].data.table === frozenTable,
      sourceNodeObjectIdentity: findNode('s1') === nodes.value[0],
    },
  })
  document.title = 'DONE'
})
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <VueFlow :nodes="nodes" :edges="edges" fit-view-on-init>
      <template #node-source="p"><SourceNode v-bind="p" /></template>
      <template #node-filter="p"><FilterNode v-bind="p" /></template>
      <template #node-result="p"><ResultNode v-bind="p" /></template>
    </VueFlow>
  </div>
</template>

<style>
.qb-node { background: #fff; border: 1px solid #888; border-radius: 6px; padding: 8px; font: 12px sans-serif; display: flex; flex-direction: column; gap: 4px; min-width: 160px; }
.qb-node input, .qb-node select { font: inherit; }
</style>
