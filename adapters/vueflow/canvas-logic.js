// Everything about the canvas that is arithmetic rather than rendering.
//
// It is a plain module, with no Vue import, and that is structural rather than
// tidy. This project has exactly two Vitest projects and an SFC falls between
// them: the `core` project reaches `adapters/**/*.test.js` but runs
// `environment: 'node'` with no `vue()` plugin, and the `ui` project has the
// plugin but looks only in `ui/**`. Logic left inside `GraphCanvas.vue` is
// therefore reachable only from Playwright, which is the slowest envelope and the
// one least able to enumerate cases — and `vitest.config.js`'s own comment,
// calling an adapter "framework-free code behind a port", would quietly stop
// being true.
//
// It is also what makes AD-19's "the adapter absorbs its own hazards" checkable
// instead of merely asserted. The hazards, read out of
// `@vue-flow/core@1.48.2`'s installed source rather than inferred:
//
//   `removeNodes` triggers `edgesChange` for every connected edge **before** it
//   triggers `nodesChange` for the node (dist/vue-flow-core.mjs:6572-6577), and
//   the Delete key calls `removeNodes(selected)` and then `removeEdges(selected)`
//   in one synchronous watcher (:8239-8245). So a host reading each edge removal
//   as a user disconnect empties the consumer's slot before it ever hears that a
//   node vanished — and the consumer comes out under-filled instead of
//   broken-and-named, which is the inversion of CAP-12's promise.
//
//   `createEdgeRemoveChange(id, source, target, sourceHandle, targetHandle)`
//   (:4074-4083) means a remove change already carries its own endpoints, so
//   nothing has to parse an edge id to find out which slot was emptied.
//
// `core/` must never learn either fact.

import { parseEdgeId } from '@core/graph/graph.js'

/** The one handle id shape an input slot carries. The output handle is `out`. */
export const IN_HANDLE = /^in-(\d+)$/

/** The slot an input handle addresses, or `null` for anything else — including
 *  `null`, the output handle, and a shape nothing here minted. Never `NaN`: a
 *  `NaN` slot index reaches `checkConnect` as a refusal nobody can read. */
export function slotOfHandle(handleId) {
  if (typeof handleId !== 'string') return null
  const m = IN_HANDLE.exec(handleId)
  return m ? Number(m[1]) : null
}

/** How the canvas spells the handle for slot `n`. The projection and the frame
 *  read this rather than each writing the string. */
export const handleOfSlot = (slot) => `in-${slot}`

/**
 * Where an edge removal landed: its target Step and the slot it emptied.
 *
 * Read off the change itself where the library supplies it, and out of the edge
 * id — through `core/graph`'s own `parseEdgeId`, the single owner of that grammar
 * — where it does not. Both readers, so a change carrying only an id still
 * resolves and a second regex never enters this tree.
 */
export function edgeRemovalAt(change) {
  const parsed = parseEdgeId(change?.id)
  const target = change?.target ?? parsed?.target ?? null
  const slot = slotOfHandle(change?.targetHandle) ?? parsed?.slot ?? null
  const source = change?.source ?? parsed?.source ?? null
  if (target === null || slot === null) return null
  return { source, target, slot }
}

/**
 * What a batch of removals actually means, once both halves are in hand.
 *
 * An edge removal whose either endpoint is among the removed nodes is one the
 * library dragged along, not a disconnect anybody asked for — so it is dropped,
 * and the consumer keeps the dangling reference that makes it *broken and named*
 * rather than merely short of an input.
 */
export function removalPlan(edgeRemovals, nodeRemovals) {
  const gone = new Set(nodeRemovals)
  const disconnects = []
  for (const change of edgeRemovals) {
    const at = edgeRemovalAt(change)
    if (!at) continue
    if (gone.has(at.target) || gone.has(at.source)) continue
    disconnects.push(at)
  }
  return Object.freeze({
    removals: Object.freeze([...gone]),
    disconnects: Object.freeze(disconnects),
  })
}

/**
 * The router that holds the two halves together.
 *
 * The library reports the dragged edges and the node in two separate callbacks of
 * one synchronous gesture, so the adapter buffers both and interprets them once
 * the gesture is over — a microtask later, which is after the whole keypress
 * watcher including the `removeEdges` call that follows it. This is the only
 * place in the tree that can tell a dragged edge from a disconnect, because it is
 * the only place that sees both batches.
 *
 * `schedule` is injectable so a test can drive the flush without a clock.
 */
export function createRemovalRouter({ removeStep, disconnect, schedule = queueMicrotask }) {
  let edges = []
  let nodes = []
  let armed = false

  const flush = () => {
    armed = false
    const plan = removalPlan(edges, nodes)
    edges = []
    nodes = []
    // The node first: its consumers must be holding a dangling reference by the
    // time anything else is interpreted.
    for (const id of plan.removals) removeStep(id)
    for (const at of plan.disconnects) disconnect(at.target, at.slot)
    return plan
  }

  const arm = () => {
    if (armed) return
    armed = true
    schedule(flush)
  }

  return {
    edgeRemovals(changes) {
      const removals = changes.filter((c) => c.type === 'remove')
      if (removals.length === 0) return
      edges.push(...removals)
      arm()
    },
    nodeRemovals(changes) {
      const removals = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removals.length === 0) return
      nodes.push(...removals)
      arm()
    },
    flush,
  }
}

/** Position changes, as the model's `moveStep` wants them. `dimensions` changes
 *  are Vue Flow's own measurement and are none of the model's business. */
export const positionChanges = (changes) =>
  changes
    .filter((c) => c.type === 'position' && c.position)
    .map((c) => ({ id: c.id, x: c.position.x, y: c.position.y }))

/**
 * The one thing design B hands back to the library, kept deliberately narrow.
 *
 * `applyDefault: false` unsubscribes the applier for *all* changes, including the
 * view state the model has no opinion about. Single selection survives anyway
 * because `getSelectionChanges` is called with `mutateItem: true`; multi-selection
 * is emitted as a change only, so without this it is silently dropped — measured
 * broken for the pointer as much as for the keyboard.
 */
const VIEW_STATE_CHANGES = new Set(['select'])
export const viewStateChanges = (changes) => changes.filter((c) => VIEW_STATE_CHANGES.has(c.type))

/** How much of a node sticks out of the pane, per axis. */
export const VIEW_MARGIN = 24

/**
 * The pan that brings a node inside the pane, by the **shortfall** rather than by
 * centring: panning preserves the zoom the user chose, and `setCenter` would take
 * it away on every focus and on every added Step.
 *
 * A node larger than the pane cannot be fully shown, so its start edge is aligned
 * rather than oscillating between the two.
 */
export function panShortfall(node, pane, margin = VIEW_MARGIN) {
  const axis = (lowNode, highNode, lowPane, highPane) => {
    if (highNode - lowNode > highPane - lowPane) return lowPane + margin - lowNode
    if (lowNode < lowPane + margin) return lowPane + margin - lowNode
    if (highNode > highPane - margin) return highPane - margin - highNode
    return 0
  }
  return Object.freeze({
    x: axis(node.left, node.right, pane.left, pane.right),
    y: axis(node.top, node.bottom, pane.top, pane.bottom),
  })
}

/**
 * Whether a focus event may pull the canvas after it.
 *
 * It may not, while a pointer is down. That is a defect rather than a preference:
 * clicking a control on a node near the edge of the pane panned the canvas, the
 * control travelled out from under the cursor between `mousedown` and `mouseup`,
 * and the browser dispatched the click on the pane instead of on the button — so
 * the controls furthest from the centre silently did nothing.
 *
 * `claim()` **spends** the veto, and the side effect is the point rather than an
 * accident. A gesture that begins on the canvas can end anywhere — the library
 * drags the pane from a listener the canvas element never sees the `pointerup`
 * of — so a veto that only a matching `pointerup` could lift would wedge the
 * focus pull shut for the rest of the session, silently and for keyboard users
 * only. One pointer gesture produces exactly one focus event, so one veto is
 * exactly what it is owed.
 */
export function createFocusGate() {
  let pointer = false
  return {
    pointerDown() {
      pointer = true
    },
    pointerUp() {
      pointer = false
    },
    claim() {
      const allowed = !pointer
      pointer = false
      return allowed
    },
  }
}
