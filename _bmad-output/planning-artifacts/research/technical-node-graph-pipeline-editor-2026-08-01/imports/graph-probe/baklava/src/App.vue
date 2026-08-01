<script setup>
import { onMounted, nextTick } from 'vue'
import { defineNode, NodeInterface, containsCycle } from 'baklavajs'
import {
  BaklavaEditor, useBaklava,
  TextInputInterface, SelectInterface, CheckboxInterface,
  UNDO_COMMAND, REDO_COMMAND,
} from '@baklavajs/renderer-vue'
import '@baklavajs/themes/dist/syrup-dark.css'
import { makeFrozenTable } from './shared-data.js'
import { assess, heap } from './assert.js'

const heapBefore = heap()
const frozenTable = makeFrozenTable()
const heapAfterTable = heap()

// Three node kinds, each with its own configuration surface.
const SourceNode = defineNode({
  type: 'Source',
  title: 'Source',
  inputs: {
    file: () => new TextInputInterface('Datei', 'umsatz.csv').setPort(false),
    table: () => new NodeInterface('table', frozenTable).setHidden(true),
  },
  outputs: { out: () => new NodeInterface('Out', null) },
})
const FilterNode = defineNode({
  type: 'Filter',
  title: 'Filter',
  inputs: {
    in: () => new NodeInterface('In', null),
    column: () => new TextInputInterface('Spalte', 'c0').setPort(false),
    op: () => new SelectInterface('Operator', 'equals', ['equals', 'contains']).setPort(false),
  },
  outputs: { out: () => new NodeInterface('Out', null) },
})
const ResultNode = defineNode({
  type: 'Result',
  title: 'Ergebnis',
  inputs: {
    in: () => new NodeInterface('In', null),
    isResult: () => new CheckboxInterface('Result-Step', true).setPort(false),
  },
  outputs: {},
})

const baklava = useBaklava()
baklava.editor.registerNodeType(SourceNode)
baklava.editor.registerNodeType(FilterNode)
baklava.editor.registerNodeType(ResultNode)

const s1 = new SourceNode(), f1 = new FilterNode(), r1 = new ResultNode()
const g = baklava.editor.graph
g.addNode(s1); g.addNode(f1); g.addNode(r1)
s1.position = { x: 40, y: 80 }; f1.position = { x: 320, y: 80 }; r1.position = { x: 600, y: 80 }
g.addConnection(s1.outputs.out, f1.inputs.in)
g.addConnection(f1.outputs.out, r1.inputs.in)

onMounted(async () => {
  const t0 = performance.now()
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const mountMs = performance.now() - t0
  const heapAfterMount = heap()

  const edgePathsAtMount = document.querySelectorAll('path.vue-flow__edge-path, path[data-probe-edge], .baklava-connection').length
  const readback = g.findNodeById(s1.id).inputs.table.value

  // programmatic mutation, no pointer input
  let programmatic = null
  try {
    const f2 = new FilterNode()
    g.addNode(f2); f2.position = { x: 320, y: 300 }
    g.addConnection(s1.outputs.out, f2.inputs.in)
    await nextTick()
    programmatic = { ok: true, nodeCount: g.nodes.length, edgeCount: g.connections.length }
  } catch (e) { programmatic = { ok: false, error: String(e) } }

  // does it refuse a cycle, and does it say why? (PRD FR-12)
  // r1 has no outputs, so build the cycle test on the s1 -> f1 -> r1 chain:
  // adding f1.out -> s1.<input port> would close a loop.
  let cycle = null
  try {
    const chk = g.checkConnection(f1.outputs.out, s1.inputs.table)
    const res = g.addConnection(f1.outputs.out, s1.inputs.table)
    cycle = {
      checkConnectionReturn: chk === false ? 'false' : JSON.stringify(chk, (k, v) => (k === 'from' || k === 'to' ? '<iface>' : v)),
      addConnectionReturn: res === undefined ? 'undefined' : String(res),
      connectionCountAfter: g.connections.length,
    }
  } catch (e) { cycle = { threw: String(e), name: e && e.name, connectionCountAfter: g.connections.length } }
  try { cycle.containsCycleAfterAdding = containsCycle(g) } catch (e) { cycle.containsCycleThrew = String(e) }
  let cycleCheck = null
  try {
    const chk = g.checkConnection(f1.outputs.out, f1.inputs.in)   // direct self-loop
    cycleCheck = { selfLoopReturn: chk === false ? 'false' : JSON.stringify(chk, (k, v) => (k === 'from' || k === 'to' ? '<iface>' : v)) }
  } catch (e) { cycleCheck = { threw: String(e) } }

  // undo/redo shipped?
  const ch = baklava.commandHandler
  const commands = {
    undo: !!(ch && ch.canExecuteCommand && ch.canExecuteCommand(UNDO_COMMAND, false) !== undefined),
    undoCommandName: UNDO_COMMAND, redoCommandName: REDO_COMMAND,
    hasHistory: !!baklava.history,
  }

  window.__RESULTS__ = assess({
    candidate: 'baklavajs@2.8.1',
    frozenTable, readback, domRoot: document,
    heapBefore, heapAfterTable, heapAfterMount, mountMs,
    extra: {
      edgePathsAtMount,
      programmatic, cycle, cycleCheck, commands,
      nodeTitlesRendered: [...document.querySelectorAll('.baklava-node .__title-label, .baklava-node .__title')].map(e => e.textContent.trim()),
      baklavaNodeCount: document.querySelectorAll('.baklava-node').length,
      connectionCount: document.querySelectorAll('.baklava-connection, .baklava-connection path, path.connection').length,
    },
  })
  document.title = 'DONE'
})
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <BaklavaEditor :view-model="baklava">
      <!-- probe: is a per-kind body possible through the node slot? -->
      <template #node="nodeProps">
        <div class="qb-slot" :data-kind="String(nodeProps.node.type).toLowerCase()">
          {{ nodeProps.node.title }}
        </div>
      </template>
    </BaklavaEditor>
  </div>
</template>
