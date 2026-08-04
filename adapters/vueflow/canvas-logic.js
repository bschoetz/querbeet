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

/** Position changes, as the model's `moveStep` wants them. A `dimensions` change
 *  carries no position and never becomes one — it is a measurement, and what the
 *  host does with it is the reflow at the bottom of this file. */
export const positionChanges = (changes) =>
  changes
    .filter((c) => c.type === 'position' && c.position)
    .map((c) => ({ id: c.id, x: c.position.x, y: c.position.y }))

/**
 * Whether a batch carries the library's own measurement of a card.
 *
 * It is the only report that says a card changed size, and a card changes size
 * from buttons inside itself: every input slot row and every Diagnostic mark
 * grows it. A drag reports `position` and resizes nothing, which is why the
 * reflow below never fires under a pressed pointer.
 */
export const hasDimensionChange = (changes) => changes.some((c) => c.type === 'dimensions')

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
 * **Reading the veto does not spend it, and the release is what lifts it.** An
 * earlier version consumed the veto on read, so that a `pointerup` the canvas
 * element never saw could not wedge the pull shut — but a pointer gesture that
 * produces *no* focus event at all (a drag on the pane background, a click that
 * lands on nothing) then left the veto standing, and the next **keyboard** focus
 * was silently not pulled into view. That is the same failure one gesture later,
 * and on the users it was meant to protect. The host listens for `pointerup` on
 * the window instead, so the release is seen wherever it lands.
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
    allows() {
      return !pointer
    },
  }
}

/** Tags whose own keyboard handling owns the key. */
const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

/**
 * Whether a key press belongs to what the user is typing in rather than to the
 * canvas. Delete inside a name field means a character, never a Step.
 */
export const isTypingTarget = (element) =>
  !!element && (TYPING_TAGS.has(element.tagName) || element.isContentEditable === true)

// ----------------------------------------------------------------- the reflow

/**
 * The **vertical** clearance a reflow leaves between two cards in one column.
 *
 * Vertical only, and the asymmetry is deliberate: two columns that merely touch
 * (`a.x + a.width === b.x`) are clear, because a column is a place and the gap is
 * about stacking. Nothing horizontal is ever adjusted anyway — see `reflowMoves`.
 *
 * **It is not independent of `PLACEMENT.dy` in `core/graph/graph.js`, and the
 * bound is `gap <= dy - the tallest card`.** With `dy: 200` that leaves 176 px, so
 * any card above that height makes the reflow nudge the grid the model just placed
 * on: a 187 px card — the height story 6b measured for a slot row plus a mark —
 * moves the cell below it from y=240 to y=251, an 11 px shove on a layout that was
 * already free of overlap. That is the pass enforcing the clearance rather than a
 * defect, but it does mean the grid is not self-consistent, and raising this
 * number past 50 would have the emptiest possible graph reflow itself on mount.
 *
 * The same number as `VIEW_MARGIN` and still a separate constant: one is what
 * "inside the pane" means and the other what "not stacked on" means.
 */
export const LAYOUT = Object.freeze({ gap: 24 })

/**
 * A node the library has actually measured.
 *
 * Vue Flow leaves `dimensions` at `{ width: 0, height: 0 }` until its
 * ResizeObserver has reported (`updateNodeDimensions` only assigns when both are
 * truthy), so an unmeasured node arrives as a zero box. Reflowing against one
 * would stack every node on the first frame — so it is neither moved nor an
 * obstacle, and the pass runs again when its measurement arrives.
 */
const measured = (node) =>
  Number.isFinite(node?.x) &&
  Number.isFinite(node?.y) &&
  Number.isFinite(node?.width) &&
  Number.isFinite(node?.height) &&
  node.width > 0 &&
  node.height > 0

/** Whether two measured boxes leave each other alone. The horizontal clauses come
 *  first and carry the whole column idea: a vertical overlap between two nodes in
 *  different columns is not an overlap at all. They are bare — the gap is vertical
 *  by definition (see `LAYOUT`), so columns that touch are clear and columns that
 *  genuinely intersect fall through to the vertical test like anything else. */
const clear = (a, b, gap) =>
  a.x + a.width <= b.x ||
  b.x + b.width <= a.x ||
  a.y + a.height + gap <= b.y ||
  b.y + b.height + gap <= a.y

/**
 * The nodes that must move for no two cards to sit on top of each other, as
 * `[{ id, x, y }]` — empty when there is nothing to do.
 *
 * **This is the promise the row pitch in `core/graph/graph.js` cannot make.** A
 * Step card has no fixed height, so a constant pitch clears the tallest card that
 * existed the day it was chosen and nothing more; an overlapping card then
 * swallows the pointer aimed at the one beneath it. The model cannot fix that —
 * `core/graph/` is browser-free by AD-2 and can only place from numbers it was
 * given — so the measurement is read here and handed back through the `move`
 * command like any other position.
 *
 * Three properties it is written for, each asserted in the test beside it:
 *
 *   **Idempotent.** Its own output produces no moves. The library also reports
 *   dimensions with `forceUpdate: true` from two watchers, so this pass must be
 *   expected to run over a layout it already settled — without idempotence that
 *   is a loop rather than a no-op.
 *   **Deterministic.** The order nodes arrive in does not matter: they are sorted
 *   by `(y, x, id)`, and the first in that order is the anchor that never moves.
 *   **Down only.** The horizontal position carries the column meaning
 *   `freePosition` put there, and a sideways nudge would take it away.
 *
 * The inner loop terminates because every pass moves a node to a strictly greater
 * `y` — `max(bottom) + gap` over boxes it overlaps is above its own top by
 * definition of overlapping — and that value is always one of finitely many
 * settled bottoms. There are at most `settled.length` of those, so at most that
 * many increases can happen, and the loop is given one iteration more than that:
 * the last check cannot find a hit. The test beside this asserts the result is
 * pairwise clear over a spread of arrangements rather than trusting the argument.
 *
 * **Cost is `O(n³)` in the worst case** — the settled scan is inside the pass loop,
 * per node — and it runs on every measurement report, including the ones that
 * changed nothing (the library forces those). `n` is the node count, which the
 * whole product bounds at what a person can hold in a graph, so it is nowhere near
 * the row counts C-3 is about; if that ever stops being true it is this line that
 * has to be measured rather than the pass that has to be rewritten.
 */
export function reflowMoves(nodes, gap = LAYOUT.gap) {
  const ordered = (Array.isArray(nodes) ? nodes : [])
    .filter(measured)
    .map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }))
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const settled = []
  const moves = []
  for (const node of ordered) {
    const was = node.y
    for (let pass = 0; pass <= settled.length; pass += 1) {
      const hit = settled.filter((other) => !clear(node, other, gap))
      if (hit.length === 0) break
      node.y = Math.max(...hit.map((other) => other.y + other.height)) + gap
    }
    settled.push(node)
    if (node.y !== was) moves.push(Object.freeze({ id: node.id, x: node.x, y: node.y }))
  }
  return Object.freeze(moves)
}
