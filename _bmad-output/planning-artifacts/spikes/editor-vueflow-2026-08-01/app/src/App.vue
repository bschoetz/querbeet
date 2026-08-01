<script setup>
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'

import Background from './flow/Background.vue'
import SourceNode from './nodes/SourceNode.vue'
import UnionNode from './nodes/UnionNode.vue'
import JoinNode from './nodes/JoinNode.vue'
import FilterNode from './nodes/FilterNode.vue'

import {
  editor,
  graph,
  tables,
  refusal,
  journal,
  lastRefusal,
  flowNodes,
  flowEdges,
  parseEdgeId,
  orphanIds,
  brokenById,
  seedIdCounter,
} from './editor.js'
import { makeFrozenTable } from './shared-data.js'
import { installHarness } from './harness.js'

// Resolved here, in setup, because useVueFlow() reaches the store through
// inject() — anywhere else it hands back a fresh, empty one.
const vf = useVueFlow()
const { setNodes, setEdges, onNodesChange, onEdgesChange, onConnect, onConnectStart, onConnectEnd, fitView } = vf

// Every change Vue Flow proposes, recorded before it is interpreted. The spike
// reads this to tell "the library never asked" apart from "the app said no".
const changeLog = []

// ---------------------------------------------------------------------------
// Q3, design B — the model is authoritative.
//
// Vue Flow's store is written here and nowhere else. Note what is *not* used:
// the `:nodes` / `:edges` props. Those are v-models — Vue Flow writes the store
// back into them — so binding a projection there would create a second writer
// into our own state. That is the drift the R6 regret cluster is about, so the
// projection is pushed imperatively instead.
// ---------------------------------------------------------------------------
watch(
  [flowNodes, flowEdges],
  ([ns, es]) => {
    setNodes(ns)
    setEdges(es)
  },
  { immediate: true, flush: 'post' },
)

// ...and read back here and nowhere else.
onNodesChange((changes) => {
  changeLog.push(...changes.map((c) => ({ from: 'nodes', type: c.type, id: c.id ?? c.item?.id })))
  for (const c of changes) {
    if (c.type === 'position' && c.position) editor.move(c.id, c.position.x, c.position.y)
    else if (c.type === 'remove') editor.removeNode(c.id)
    // 'dimensions' and 'select' are Vue Flow's own view state. The model has no
    // opinion about either, which is the point of the split.
  }
})

onEdgesChange((changes) => {
  changeLog.push(...changes.map((c) => ({ from: 'edges', type: c.type, id: c.id ?? c.item?.id })))
  for (const c of changes) {
    // 'add' is deliberately ignored. Under applyDefault: false a change is a
    // proposal, and edges exist only because the model produced them.
    if (c.type !== 'remove') continue
    const p = parseEdgeId(c.id)
    if (p) editor.disconnect(p.target, p.slot)
  }
})

// ---------------------------------------------------------------------------
// Q2 — the cycle guard in front of the mutation, on both paths.
// The pointer path lands here; the programmatic path calls editor.connect()
// directly. Both funnel into the same checkConnect in model/graph.js.
// ---------------------------------------------------------------------------
onConnectStart(() => {
  lastRefusal.value = null
})

onConnect((conn) => {
  const slot = Number(String(conn.targetHandle || '').replace('in-', ''))
  editor.connect(conn.source, conn.target, slot)
})

// A refused drop never reaches onConnect, so the reason is surfaced here.
onConnectEnd(() => {
  if (lastRefusal.value) refusal.value = { op: 'connect (Zeiger)', reason: lastRefusal.value }
})

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
const recipeText = ref('')
const recipeName = ref('Spike-Rezept')

function addStep(kind) {
  const at = { x: 60 + Math.round((graph.value.nodes.length % 4) * 40), y: 420 }
  editor.addNode(kind, at)
}

function save() {
  recipeText.value = JSON.stringify(editor.saveRecipe(recipeName.value), null, 2)
}

function load() {
  editor.loadRecipe(recipeText.value)
}

const status = computed(() => ({
  steps: graph.value.nodes.length,
  edges: flowEdges.value.length,
  result: graph.value.resultId,
  orphans: [...orphanIds.value],
  broken: [...brokenById.value.values()].map((b) => b.reason),
}))

// ---------------------------------------------------------------------------
// A seeded graph: two Sources, a Union of both, a Filter, a Join. One Source
// carries a frozen 100,000 x 20 table, so the Editor is measured with a real
// dataset in it.
// ---------------------------------------------------------------------------
function seed() {
  editor.clear()
  const cols = Array.from({ length: 20 }, (_, i) => 'c' + i)
  editor.addNode('source', { id: 'q1', name: 'Umsatz Q1', x: 40, y: 60, config: { file: 'umsatz-q1.csv', columns: cols } })
  editor.addNode('source', { id: 'q2', name: 'Umsatz Q2', x: 40, y: 300, config: { file: 'umsatz-q2.csv', columns: cols } })
  editor.addNode('source', { id: 'kd', name: 'Kunden', x: 40, y: 520, config: { file: 'kunden.csv', columns: ['kdnr', 'name'] } })
  editor.addNode('union', { id: 'u1', name: 'Halbjahr', x: 420, y: 110, inputs: ['q1', 'q2'] })
  editor.addNode('filter', { id: 'f1', name: 'Nur Bestand', x: 880, y: 170, inputs: ['u1'] })
  editor.addNode('join', { id: 'j1', name: 'Mit Kunden', x: 1330, y: 230, inputs: ['f1', 'kd'] })
  editor.setResult('j1')
  editor.attachTable('q1', makeFrozenTable())
  seedIdCounter(2)
}

onMounted(async () => {
  seed()
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  fitView({ padding: 0.15 })
  installHarness(vf, changeLog)
})
</script>

<template>
  <div class="qb-app">
    <header class="qb-toolbar">
      <strong>querbeet · Editor-Spike</strong>
      <button data-t="add-union" @click="addStep('union')">+ Union</button>
      <button data-t="add-join" @click="addStep('join')">+ Join</button>
      <button data-t="add-filter" @click="addStep('filter')">+ Filter</button>
      <span class="qb-sep" />
      <input v-model="recipeName" data-t="recipe-name" size="16" />
      <button data-t="save" @click="save">Rezept speichern</button>
      <button data-t="clear" @click="editor.clear()">Leeren</button>
      <button data-t="load" @click="load">Rezept laden</button>
      <span class="qb-sep" />
      <span data-t="status">{{ status.steps }} Steps · {{ status.edges }} Verbindungen · Ergebnis: {{ status.result || '—' }}</span>
    </header>

    <p v-if="refusal" class="qb-refusal" data-t="refusal">
      <strong>Abgelehnt ({{ refusal.op }}):</strong> {{ refusal.reason }}
    </p>

    <div class="qb-canvas">
      <VueFlow :apply-default="false" :delete-key-code="null" :min-zoom="0.2">
        <Background />
        <template #node-source="p"><SourceNode v-bind="p" /></template>
        <template #node-union="p"><UnionNode v-bind="p" /></template>
        <template #node-join="p"><JoinNode v-bind="p" /></template>
        <template #node-filter="p"><FilterNode v-bind="p" /></template>
      </VueFlow>
    </div>

    <details class="qb-drawer">
      <summary>Rezept</summary>
      <textarea v-model="recipeText" data-t="recipe" rows="12" spellcheck="false"></textarea>
      <pre data-t="journal">{{ journal.slice(-8) }}</pre>
    </details>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.4 system-ui, sans-serif; color: #1c2430; }
.qb-app { display: flex; flex-direction: column; height: 100vh; }
.qb-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #d7dce3; background: #f6f8fa; flex-wrap: wrap; }
.qb-sep { width: 1px; height: 18px; background: #d7dce3; }
.qb-refusal { margin: 0; padding: 8px 12px; background: #fdecec; border-bottom: 1px solid #f2b8b8; color: #8a1c1c; }
.qb-canvas { flex: 1; position: relative; min-height: 0; }
.qb-drawer { border-top: 1px solid #d7dce3; background: #f6f8fa; padding: 6px 12px; }
.qb-drawer textarea { width: 100%; font: 11px/1.35 ui-monospace, monospace; }
.qb-drawer pre { font: 10px/1.3 ui-monospace, monospace; max-height: 90px; overflow: auto; }

.qb-node {
  position: relative;
  background: #fff;
  border: 1px solid #9aa4b2;
  border-radius: 7px;
  padding: 7px 9px 9px;
  min-width: 186px;
  display: flex;
  flex-direction: column;
  gap: 5px;
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
