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

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'

import FlowBackground from './FlowBackground.vue'
import StepFrame from './StepFrame.vue'
import {
  createFocusGate,
  createRemovalRouter,
  handleOfSlot,
  hasDimensionChange,
  isTypingTarget,
  panShortfall,
  positionChanges,
  reflowMoves,
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

const emit = defineEmits(['move', 'remove', 'disconnect', 'connect', 'refused', 'select'])

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
  getNodes,
  getSelectedNodes,
  getSelectedEdges,
} = vf

// ---------------------------------------------------------------- selection
//
// What the host is told after a selection change, and it is an **id**, never a
// node: selection state stays the library's (the `select` change is handed back
// below and this file remains its only owner), and the host mirrors the id so its
// side panel has a subject. The last selected wins, because the panel shows one
// Step and a multi-selection has no single answer — and an empty selection is
// `null` rather than an absent report, so a click on the background closes the
// panel.
//
// Declared above the projection watcher on purpose: that watcher is `immediate`,
// so it runs during `setup` and a `const` declared below it would be in its
// temporal dead zone.
let reportedSelection = null

const reportSelection = () => {
  const id = getSelectedNodes.value.at(-1)?.id ?? null
  if (id === reportedSelection) return
  reportedSelection = id
  emit('select', id)
}

// ---------------------------------------------------------------- projection

const flowNodes = computed(() =>
  props.nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: { x: node.x, y: node.y },
    class: node.dimmed ? 'qb-node-orphan' : '',
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
    // A removed Step reports a `remove` change, never a `select` one, so nothing
    // else would tell the host that what its panel is showing has ceased to
    // exist. Re-reading the selection after every projection covers that without
    // a second rule about removals.
    reportSelection()
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
  if (hasDimensionChange(changes)) armReflow()
  const view = viewStateChanges(changes)
  if (view.length) {
    applyNodeChanges(view)
    reportSelection()
  }
})

onEdgesChange((changes) => {
  // `add` is deliberately not read: under `applyDefault: false` a change is a
  // proposal, and edges exist only because the model produced them.
  router.edgeRemovals(changes)
  const view = viewStateChanges(changes)
  if (view.length) applyEdgeChanges(view)
})

// --------------------------------------------------------------- the reflow
//
// **What keeps two cards off each other, now that the row pitch cannot.** A Step
// card has no fixed height — every input slot row and every mark grows it, both
// from buttons inside the card — so `PLACEMENT.dy` is an opening guess and this
// is the guarantee. The measurement is the library's own: it observes every node
// with a ResizeObserver for its anchor arithmetic, and assigns `dimensions`
// directly on the store node, so it is there under `applyDefault: false` too.
//
// The moves leave through `move`, the same event a drag leaves through, so
// positions stay the model's and `core/graph/` stays browser-free (AD-2). This
// file writes no position into the library's store — rule 1 stands. **Every node,
// Sources included:** a Source card grows with its own marks and sits in a column
// of its own, and `moveStep` takes one (it is `removeStep` that refuses a Source,
// because the Source store owns which ones exist — not where they sit).
//
// **`dimensions` changes alone trigger it, and that is a rule about the trigger
// rather than a promise about the layout.** A drag reports `position` and resizes
// nothing, so no gesture can start a pass and nothing moves out from under a
// pressed pointer; `Eingang hinzufügen` grows a card on `click`, which is after
// the release. What it does *not* say — and an earlier version of this comment
// wrongly did, decided with the project owner on 2026-08-04 — is that an overlap
// the user made by dragging survives. The pass is graph-wide and stateless, so it
// separates that pair too, at the next measurement anywhere in the graph.
// Measured: a Filter dropped on a Source at y=63.7 sits at y=157 after three slot
// rows are added to an unrelated Union, and after a plain view switch. Leaving it
// would mean remembering the last settled layout in order to tell "the user put
// it there" from "a card just grew into it" — and the overlap it would preserve
// is the swallowed pointer this whole file exists to prevent.
//
// One pass per microtask: a mounting graph arrives as a burst of single-node
// measurements, and the pass is over the whole graph either way. It also runs on
// measurements that changed nothing — the library forces a report from its
// ResizeObserver and from two watchers — which is why the pass is idempotent
// rather than merely correct.
let reflowArmed = false
let disposed = false

function reflow() {
  reflowArmed = false
  if (disposed) return
  // **Position from the model, size from the library, and the split is the point.**
  // The library assigns `node.position` itself on its clamp path, so reading a
  // position out of its store and emitting it as a `move` would make it an
  // inbound writer of model state — the mirror image of the rule that keeps this
  // file from writing positions into it. Only the measurement is the library's to
  // give: `offsetWidth`/`offsetHeight`, layout pixels in the same space as the
  // position, because the canvas transform lives on an ancestor and does not
  // scale them. A client rect is in the other space and is deliberately unused.
  const measured = new Map(getNodes.value.map((node) => [node.id, node.dimensions]))
  const boxes = props.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    width: measured.get(node.id)?.width,
    height: measured.get(node.id)?.height,
  }))
  for (const at of reflowMoves(boxes)) emit('move', at.id, at.x, at.y)
}

function armReflow() {
  if (reflowArmed) return
  reflowArmed = true
  queueMicrotask(reflow)
}

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

// A refusal is reported only where the gesture actually ended on a handle. The
// guard is asked of every handle the pointer passes over, so surfacing the last
// refused one on any release would put „…würde einen Kreis schließen" on screen
// for a drag the user abandoned over empty canvas.
onConnectEnd((event) => {
  const onHandle = !!event?.target?.closest?.('.vue-flow__handle')
  if (!connected && refusedAt && onHandle) {
    emit('refused', refusedAt.source, refusedAt.target, refusedAt.slot)
  }
  refusedAt = null
})

// ---------------------------------------------------------------- the Delete key
//
// The library's own `delete-key-code` is disabled and the key is owned here, and
// the reason is scope rather than taste. `useKeyPress` listens on the **document**
// and the watcher calls `removeNodes(getSelectedNodes.value)` unconditionally,
// while its guard (`isInputDOMNode`) covers INPUT, SELECT, TEXTAREA,
// contenteditable and `.nokey` — **not BUTTON**. So with a Step selected, Delete
// pressed on the toolbar's `+ Filter`, on the Ergebnis badge, on a view tab, or
// anywhere in the Sources pane this app keeps mounted would destroy the Step.
//
// The library's escape hatch is a `.nokey` class on everything outside, which
// puts the rule on every future control in the app and fails silently when one
// forgets it. Owning the key here puts it on the element the key belongs to: a
// selected Step is only ever selected from inside this pane, and focus is inside
// it when the key is pressed.
/** Anything that takes focus by itself when the pointer lands on it. */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'

/**
 * Keep focus inside the pane, because the key is scoped to it.
 *
 * Measured: clicking an edge *selects* it and focuses nothing — the interaction
 * path is an SVG element and the edge group carries no `tabindex` — so
 * `document.activeElement` stays `BODY` and a pane-scoped Delete would never see
 * the key. A node wrapper and every control in a card focus themselves, so this
 * only ever claims focus where nothing else would.
 */
function onPointerDown(event) {
  focusGate.pointerDown()
  if (!event.target?.closest?.(FOCUSABLE)) pane.value?.focus({ preventScroll: true })
}

function onKeyDown(event) {
  if (event.key !== 'Delete' || isTypingTarget(event.target)) return
  const removedNodes = getSelectedNodes.value.map((node) => ({ id: node.id, type: 'remove' }))
  const removedEdges = getSelectedEdges.value.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    targetHandle: edge.targetHandle,
    type: 'remove',
  }))
  if (removedNodes.length === 0 && removedEdges.length === 0) return
  event.preventDefault()
  // Through the same router, in the same order the library reports them, so the
  // dragged-along edges of a removed node are absorbed exactly as before.
  router.edgeRemovals(removedEdges)
  router.nodeRemovals(removedNodes)
}

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
  if (!focusGate.allows()) return
  const element = event.target?.closest?.('.vue-flow__node')
  if (element) bringIntoView(element)
}

// On the window, not on the pane: a gesture that begins here can end anywhere,
// and a veto that only a release over this element could lift would leave the
// next *keyboard* focus silently unpulled.
const releasePointer = () => focusGate.pointerUp()

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

/** Whether the initial fit has run. Reflected into the DOM so a test can wait on
 *  the condition rather than on a duration — every geometry assertion is
 *  meaningless against a viewport that is still moving. */
const settled = ref(false)

onMounted(async () => {
  window.addEventListener('pointerup', releasePointer)
  window.addEventListener('pointercancel', releasePointer)
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
  settled.value = true
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerup', releasePointer)
  window.removeEventListener('pointercancel', releasePointer)
  // An armed reflow outlives the component by a microtask, and the graph store
  // outlives it altogether — so a pass that landed after teardown would move a
  // Step nobody is looking at.
  disposed = true
})
</script>

<template>
  <div
    ref="pane"
    class="qb-canvas"
    data-testid="editor-canvas"
    :data-fitted="settled ? 'true' : 'false'"
    tabindex="-1"
    @focusin="onFocusIn"
    @pointerdown="onPointerDown"
    @keydown="onKeyDown"
  >
    <!-- `:delete-key-code="null"` disables the library's document-level handler;
         the key is owned by `onKeyDown` above, scoped to this pane. Delete rather
         than Backspace, because Backspace in a name field is far too easy to
         mean. -->
    <VueFlow
      :apply-default="false"
      :delete-key-code="null"
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
