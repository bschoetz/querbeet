// The Editor's authoritative state — Q3, design B: the app's model owns the
// truth and Vue Flow is a view over it.
//
// Two rules make that real rather than nominal:
//   1. Nothing writes to the graph except the mutations below, and each of them
//      goes through the guards in model/graph.js.
//   2. Vue Flow's store is written to in exactly one place (the projection
//      watcher in App.vue) and read from in exactly one place (the change
//      handlers). No third path exists.

import { ref, shallowRef, computed } from 'vue'
import * as G from './model/graph.js'
import { toRecipe, fromRecipe } from './model/recipe.js'

export const graph = ref(G.emptyGraph())

// Datasets live here, outside the graph, frozen at the boundary (R2/R6 [M6]).
// A frozen array is not extensible, so Vue's reactivity skips it — markRaw is
// unnecessary. Keeping them out of the graph is also what makes "a Recipe
// contains no data" structural.
export const tables = shallowRef({})

export const refusal = ref(null)
export const journal = ref([])

function record(op, result) {
  journal.value.push({ op, ok: result.ok, reason: result.reason || null })
  refusal.value = result.ok ? null : { op, reason: result.reason }
  return result
}

// Every mutation is a named door. There is no unguarded one.
export const editor = {
  connect: (sourceId, targetId, slot) => record('connect', G.connect(graph.value, sourceId, targetId, slot)),
  disconnect: (targetId, slot) => record('disconnect', G.disconnect(graph.value, targetId, slot)),
  addNode: (kind, opts) => {
    const id = opts?.id || nextId(kind)
    return record('addNode', G.addNode(graph.value, G.makeNode(kind, { ...opts, id })))
  },
  removeNode: (id) => record('removeNode', G.removeNode(graph.value, id)),
  setResult: (id) => record('setResult', G.setResult(graph.value, id)),
  addInputSlot: (id) => record('addInputSlot', G.addInputSlot(graph.value, id)),
  removeInputSlot: (id, slot) => record('removeInputSlot', G.removeInputSlot(graph.value, id, slot)),
  rename: (id, name) => {
    const n = G.findNode(graph.value, id)
    if (!n) return record('rename', { ok: false, reason: `Es gibt keinen Step mit der Kennung „${id}“.` })
    n.name = name
    return record('rename', { ok: true })
  },
  move: (id, x, y) => {
    const n = G.findNode(graph.value, id)
    if (!n) return { ok: false }
    n.x = x
    n.y = y
    return { ok: true }
  },
  attachTable: (sourceId, table) => {
    tables.value = { ...tables.value, [sourceId]: table }
  },
  clear: () => {
    graph.value = G.emptyGraph()
    refusal.value = null
  },
  loadRecipe: (json) => {
    const parsed = fromRecipe(json)
    if (!parsed.ok) {
      refusal.value = { op: 'loadRecipe', reason: parsed.errors.join(' ') }
      journal.value.push({ op: 'loadRecipe', ok: false, reason: parsed.errors.join(' ') })
      return parsed
    }
    graph.value = parsed.graph
    refusal.value = null
    journal.value.push({ op: 'loadRecipe', ok: true, reason: null })
    return parsed
  },
  saveRecipe: (name) => toRecipe(graph.value, { name }),
}

let counter = 0
export function nextId(kind) {
  counter += 1
  return `${kind.slice(0, 3)}${counter}`
}
export function seedIdCounter(n) {
  counter = Math.max(counter, n)
}

// --- derived views the Editor renders from -----------------------------

export const contributing = computed(() => G.contributingTo(graph.value))
export const orphanIds = computed(() => new Set(G.orphans(graph.value)))
export const brokenById = computed(() => {
  const m = new Map()
  for (const b of G.brokenNodes(graph.value)) m.set(b.id, b)
  return m
})

// The projection into Vue Flow. Positions come from the model; `data` carries a
// reference to the model node, so a node component reads the truth rather than
// a copy Vue Flow made.
export const flowNodes = computed(() =>
  graph.value.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    data: { node: n },
  })),
)

export const flowEdges = computed(() =>
  G.edgesOf(graph.value)
    .filter((e) => G.findNode(graph.value, e.source))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      targetHandle: `in-${e.slot}`,
      sourceHandle: 'out',
      class: contributing.value.has(e.target) ? '' : 'qb-edge-orphan',
    })),
)

// The pointer path asks the guard the same question the programmatic path
// asks, and stashes the reason so the drop can name it. Note where this is
// wired: on the Handle, never on <VueFlow>. The component-level
// `isValidConnection` prop is also applied by setEdges() to every already-valid
// edge on every projection, which would silently drop the whole graph.
export const lastRefusal = ref(null)

export function pointerGuard(connection) {
  const slot = Number(String(connection.targetHandle || '').replace('in-', ''))
  const check = G.checkConnect(graph.value, connection.source, connection.target, slot)
  lastRefusal.value = check.ok ? null : check.reason
  return check.ok
}

export function parseEdgeId(id) {
  const m = /^(.*)->(.*)#(\d+)$/.exec(id)
  return m ? { source: m[1], target: m[2], slot: Number(m[3]) } : null
}
