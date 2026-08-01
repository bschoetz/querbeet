<script setup>
import { ref, shallowRef, onMounted, nextTick } from 'vue'
import Canvas from './Canvas.vue'
import SourceNode from './SourceNode.vue'
import FilterNode from './FilterNode.vue'
import ResultNode from './ResultNode.vue'
import { createGraph, connect } from './graph.js'
import { makeFrozenTable } from './shared-data.js'
import { assess, heap } from './assert.js'

const heapBefore = heap()
const frozenTable = makeFrozenTable()
const heapAfterTable = heap()

const KINDS = { source: SourceNode, filter: FilterNode, result: ResultNode }

const graph = ref(createGraph(
  [
    { id: 's1', kind: 'source', position: { x: 40, y: 80 }, data: { config: { file: 'umsatz.csv' }, table: frozenTable } },
    { id: 'f1', kind: 'filter', position: { x: 320, y: 80 }, data: { config: { column: 'c0', op: 'equals' } } },
    { id: 'r1', kind: 'result', position: { x: 600, y: 80 }, data: { config: { isResult: true } } },
  ],
  [
    { id: 'e1', source: 's1', target: 'f1' },
    { id: 'e2', source: 'f1', target: 'r1' },
  ],
))
const refusal = ref(null)
const canvas = shallowRef(null)

onMounted(async () => {
  const t0 = performance.now()
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const mountMs = performance.now() - t0
  const heapAfterMount = heap()

  const edgePathsAtMount = document.querySelectorAll('path.vue-flow__edge-path, path[data-probe-edge], .baklava-connection').length
  const readback = graph.value.nodes.find((n) => n.id === 's1').data.table

  let programmatic = null
  try {
    graph.value.nodes.push({ id: 'f2', kind: 'filter', position: { x: 320, y: 300 }, data: { config: { column: 'c1', op: 'contains' } } })
    connect(graph.value, 's1', 'f2')
    await nextTick()
    programmatic = { ok: true, nodeCount: graph.value.nodes.length, edgeCount: graph.value.edges.length }
  } catch (e) { programmatic = { ok: false, error: String(e) } }

  const cycle = connect(graph.value, 'r1', 's1')
  let zoomApi = null
  try { canvas.value.zoomIn(); zoomApi = { ok: true, k: canvas.value.view.k } } catch (e) { zoomApi = { ok: false, error: String(e) } }

  window.__RESULTS__ = assess({
    candidate: 'hand-built-svg',
    frozenTable, readback, domRoot: document,
    heapBefore, heapAfterTable, heapAfterMount, mountMs,
    extra: {
      edgePathsAtMount,
      programmatic, zoomApi,
      cycleRefused: cycle.ok === false, cycleReason: cycle.reason,
      edgeHitTargets: document.querySelectorAll('[data-probe-edge-hit]').length,
      orphanMarked: document.querySelectorAll('.qb-orphan').length,
    },
  })
  document.title = 'DONE'
})
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <Canvas ref="canvas" :graph="graph" result-id="r1" @refused="refusal = $event">
      <template #default="{ node }">
        <component :is="KINDS[node.kind]" :node="node" />
      </template>
    </Canvas>
    <p v-if="refusal" class="qb-refusal">{{ refusal }}</p>
  </div>
</template>

<style>
.qb-refusal { position: fixed; bottom: 8px; left: 8px; font: 12px sans-serif; color: #b91c1c; }
</style>
