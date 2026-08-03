<script setup>
// The `GraphView` port's one implementation, and the only file in this tree that
// imports `@vue-flow/core` (AD-1, lint-enforced).
//
// Design B, in six rules the spike measured rather than reasoned about:
//
//  1. `applyDefault: false`, and `:nodes` / `:edges` are never bound — they are
//     v-models, so binding a projection there creates a second writer into our
//     own state. Measured: under `applyDefault: false` an `addEdges` call
//     proposing a cyclic edge left the edge count at 6; the identical call under
//     `applyDefault: true` landed it (6 → 7). The mutation API cannot mutate.
//  2. The projection is pushed with `setNodes` / `setEdges` from **one** watcher
//     and read back through `onNodesChange` / `onEdgesChange` in **one** place.
//     Two functions in, two out, no third path.
//  3. `isValidConnection` on the Handle, never as a `<VueFlow>` prop — see
//     `StepFrame.vue`.
//  4. `useVueFlow()` in `setup` and nowhere else. Anywhere else it resolves
//     through `inject()`, fails silently, hands back a second empty store, and a
//     production build strips the warning that would have said so.
//  5. `select` changes, and only those, are handed back to the library.
//  6. The dot background is vendored, not depended on.
//
// Everything here that is arithmetic lives in `canvas-logic.js` instead, which is
// the only envelope that can unit-test it — see that file's header.
//
// No German word appears in this file. The per-node body arrives as a scoped slot
// from `ui/`.

import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'

import FlowBackground from './FlowBackground.vue'
import StepFrame from './StepFrame.vue'
import {
  createFocusGate,
  createRemovalRouter,
  handleOfSlot,
  panShortfall,
  positionChanges,
  slotOfHandle,
  viewStateChanges,
} from './canvas-logic.js'

const props = defineProps({
  /** `[{ id, kind, x, y, slots, dimmed }]` — ids and positions, never data. */
  nodes: { type: Array, required: true },
  /** `[{ id, source, target, slot, dimmed }]`, ids minted by `core/graph`. */
  edges: { type: Array, required: true },
  /** `(source, target, slot) => boolean` — the host's own connect guard. */
  guard: { type: Function, required: true },
})

const emit = defineEmits(['move', 'remove', 'disconnect', 'connect', 'refused'])

// Resolved here, in setup, and nowhere else (rule 4).
const vf = useVueFlow()
const {
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectStart,
  onConnectEnd,
  applyNodeChanges,
  applyEdgeChanges,
  fitView,
  panBy,
} = vf

// ---------------------------------------------------------------- projection

const flowNodes = computed(() =>
  props.nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: { x: node.x, y: node.y },
    data: { node },
  })),
)

const flowEdges = computed(() =>
  props.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: 'out',
    targetHandle: handleOfSlot(edge.slot),
    class: edge.dimmed ? 'qb-edge-orphan' : '',
  })),
)

// The one place the library's store is written. `setNodes` merges into existing
// store nodes, so measured dimensions and handle bounds survive re-projection.
watch(
  [flowNodes, flowEdges],
  ([nodes, edges]) => {
    setNodes(nodes)
    setEdges(edges)
  },
  { immediate: true, flush: 'post' },
)

// ------------------------------------------------------------- reading back

// The removals are routed rather than interpreted on arrival: the library reports
// the edges a deleted node drags with it *before* it reports the node (AD-19).
const router = createRemovalRouter({
  removeStep: (id) => emit('remove', id),
  disconnect: (target, slot) => emit('disconnect', target, slot),
})

onNodesChange((changes) => {
  // Without this branch every Step is immovable by mouse **and by arrow key**,
  // and nothing else in the file changes.
  for (const at of positionChanges(changes)) emit('move', at.id, at.x, at.y)
  router.nodeRemovals(changes)
  const view = viewStateChanges(changes)
  if (view.length) applyNodeChanges(view)
})

onEdgesChange((changes) => {
  // `add` is deliberately not read: under `applyDefault: false` a change is a
  // proposal, and edges exist only because the model produced them.
  router.edgeRemovals(changes)
  const view = viewStateChanges(changes)
  if (view.length) applyEdgeChanges(view)
})

// ------------------------------------------------------------- the pointer

// The guard's answer for the gesture in progress. A refused drop never reaches
// `onConnect`, so the reason has to be surfaced from the end of the gesture — and
// it is surfaced by re-issuing the command, so the pointer path and the slot row
// produce one refusal from one place rather than two sentences that could differ.
let refusedAt = null
let connected = false

const guardFor = (source, target, slot) => {
  const ok = props.guard(source, target, slot)
  refusedAt = ok ? null : { source, target, slot }
  return ok
}

onConnectStart(() => {
  refusedAt = null
  connected = false
})

onConnect((connection) => {
  const slot = slotOfHandle(connection.targetHandle)
  if (slot === null) return
  connected = true
  emit('connect', connection.source, connection.target, slot)
})

onConnectEnd(() => {
  if (!connected && refusedAt) emit('refused', refusedAt.source, refusedAt.target, refusedAt.slot)
  refusedAt = null
})

// ------------------------------------------------------- focus follows view

// The canvas is transformed rather than scrolled, so the browser's own
// focus-scrolling does nothing: a Step outside the visible area could be focused,
// moved and deleted without ever being seen.
const pane = ref(null)
const focusGate = createFocusGate()

function bringIntoView(element) {
  if (!element || !pane.value) return
  const delta = panShortfall(element.getBoundingClientRect(), pane.value.getBoundingClientRect())
  if (delta.x || delta.y) panBy(delta)
}

function onFocusIn(event) {
  if (!focusGate.claim()) return
  const element = event.target?.closest?.('.vue-flow__node')
  if (element) bringIntoView(element)
}

const elementFor = (id) => pane.value?.querySelector(`.vue-flow__node[data-id="${id}"]`) ?? null

// A Step added after the initial fit lands outside the visible canvas, and this
// story ships no deliberate pan to go and look for it. The same shortfall pan
// brings it in, so the zoom the user chose survives — fitting the view instead
// would take it away on every added Step.
let seen = new Set()
let fitted = false
watch(
  () => props.nodes.map((n) => n.id),
  async (ids) => {
    const added = ids.filter((id) => !seen.has(id))
    seen = new Set(ids)
    if (!fitted || added.length === 0) return
    await nextTick()
    bringIntoView(elementFor(added.at(-1)))
  },
  { immediate: true },
)

onMounted(async () => {
  await nextTick()
  // Two frames: the projection is pushed on `flush: 'post'` and the nodes are
  // measured by a ResizeObserver after that, so a fit before both has nothing to
  // fit to.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  // `maxZoom: 1` so the fit never zooms *in*. Two Sources alone would otherwise
  // open at the zoom ceiling, and every Step added after that would land outside
  // the pane — the fit would have optimised for the emptiest the graph ever is.
  fitView({ padding: 0.2, maxZoom: 1 })
  fitted = true
})
</script>

<template>
  <div
    ref="pane"
    class="qb-canvas"
    data-testid="editor-canvas"
    @focusin="onFocusIn"
    @pointerdown="focusGate.pointerDown()"
    @pointerup="focusGate.pointerUp()"
    @pointercancel="focusGate.pointerUp()"
  >
    <!-- Delete rather than Backspace: `useKeyPress` ignores presses inside
         inputs, but Backspace in a name field is far too easy to mean. -->
    <VueFlow
      :apply-default="false"
      delete-key-code="Delete"
      :min-zoom="0.2"
      :max-zoom="2"
    >
      <FlowBackground />
      <template #node-step="nodeProps">
        <StepFrame
          :node="nodeProps.data.node"
          :guard="guardFor"
        >
          <slot
            name="step"
            :node="nodeProps.data.node"
          />
        </StepFrame>
      </template>
    </VueFlow>
  </div>
</template>

<style>
.qb-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
