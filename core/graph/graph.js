// The graph model querbeet owns outright. No library import, by design: this
// module is the exit from the editor library. Nodes are plain data, edges are
// *derived* from the input slots, and every mutation goes through a guard that
// returns a Diagnostic on refusal (CAP-12).
//
// Ported from the Editor spike's `model/graph.js`, which was measured working
// against a real file:// build. One thing changed on the way in, and it is the
// only structural change: the spike's refusals were German sentences, which
// AD-13 puts in `ui/` — the core emits codes and structured values, so CAP-34's
// run status can aggregate what the graph reports instead of re-parsing prose.
//
// **The codes carry ids, never names.** `ui/` resolves a name against the graph
// it is already rendering; a name frozen into a diagnostic goes stale the moment
// someone renames a Step. The one exception is `graph.input_lost`, where the lost
// node is gone and its name has nowhere else to live — which is why the model
// remembers it.
//
// **The graph holds ids and positions.** Never a table, never a row, never a
// `Table` handle (AD-6). That is what makes "a Recipe contains no data"
// structural in story 14 rather than a stripping step someone must remember.

import { error, info, unresolved, warning } from '../diagnostics/diagnostic.js'
import { kindSpec } from './kinds.js'

/**
 * Every code this file emits, as constants used at their own emit sites.
 *
 * `core/diagnostics` keeps no registry — codes are literals where they are
 * produced, and the only enumeration anywhere is the German map in `ui/`. That is
 * fine while the map is the *only* reader, and it is not fine here: `ui/graph-
 * labels.js` owes a completeness invariant the shape `typeLabelGaps()` has, and
 * an invariant with nothing to check against is a test that cannot fail.
 *
 * So the enumeration below is built out of the constants the emit sites use,
 * rather than written beside them. It cannot drift from what is emitted, because
 * a code that is not in this map is a code no line in this file can name.
 */
export const CODE = Object.freeze({
  // refusals — a state of the graph, returned rather than thrown
  cycle: 'graph.cycle',
  selfConnection: 'graph.self_connection',
  sourceTakesNoInput: 'graph.source_takes_no_input',
  alreadyConnected: 'graph.already_connected',
  resultIsSource: 'graph.result_is_source',
  maxInputs: 'graph.max_inputs',
  minInputs: 'graph.min_inputs',
  noSuchSlot: 'graph.no_such_slot',
  slotEmpty: 'graph.slot_empty',
  slotConnected: 'graph.slot_connected',
  emptyName: 'graph.empty_name',
  unknownStep: 'graph.unknown_step',
  unknownKind: 'graph.unknown_kind',
  duplicateId: 'graph.duplicate_id',
  sourceNotRemovable: 'graph.source_not_removable',

  // reports — what the graph says about itself after a change
  inputLost: 'graph.input_lost',
  inputsMissing: 'graph.inputs_missing',
  inputReplaced: 'graph.input_replaced',
  orphan: 'graph.orphan',
  noResult: 'graph.no_result',
})

/** The enumeration `ui/graph-labels.js` checks itself against. */
export const GRAPH_CODES = Object.freeze(Object.values(CODE))

// --- construction --------------------------------------------------------

/**
 * `lost` remembers the name of every removed node, so a Step that loses an input
 * can name what it lost. After the removal there is nothing left to read it from
 * — which is the whole reason this map exists rather than a lookup.
 */
export const emptyGraph = () => ({ nodes: [], resultId: null, lost: Object.create(null) })

export const findNode = (graph, id) => graph.nodes.find((n) => n.id === id) ?? null

/**
 * A node, with as many empty slots as its kind requires to be complete.
 *
 * `minInputs` and not `maxInputs`: a Union starts at two and grows, and a kind
 * whose maximum is `Infinity` has no number to start from anyway.
 */
export function makeNode(kind, { id, name, x = 0, y = 0, inputs } = {}) {
  const spec = kindSpec(kind)
  const slots = inputs ? inputs.length : (spec?.minInputs ?? 0)
  return {
    id,
    kind,
    name: name ?? id,
    x,
    y,
    inputs: inputs ? [...inputs] : new Array(slots).fill(null),
  }
}

// --- edges are derived, never stored -------------------------------------

/**
 * The edge id grammar, and this file is its **one owner**.
 *
 * The adapter parses an edge id back with `parseEdgeId` below rather than with a
 * regex of its own: a second regex is a second owner of one fact, and the two
 * would part company silently the day this separator changes.
 */
export const edgeId = (sourceId, targetId, slot) => `${sourceId}->${targetId}#${slot}`

/**
 * The inverse of `edgeId`, or `null` for an id nothing here minted.
 *
 * The source group excludes `>` rather than being a second greedy `.*`. Two
 * greedy groups make `a->b->c#0` ambiguous — it parses as source `a->b` — and
 * while nothing mints such an id today, this file declares itself the one owner
 * of the grammar and story 14's loader reads ids out of a file.
 */
export function parseEdgeId(id) {
  const m = /^([^>]*)->(.*)#(\d+)$/.exec(String(id ?? ''))
  return m ? { source: m[1], target: m[2], slot: Number(m[3]) } : null
}

/** Every filled slot, as an edge. Derived on every call — never stored, so no
 *  second representation of a connection can disagree with the slots. */
export function edgesOf(graph) {
  const out = []
  for (const node of graph.nodes) {
    node.inputs.forEach((sourceId, slot) => {
      if (sourceId) out.push({ id: edgeId(sourceId, node.id, slot), source: sourceId, target: node.id, slot })
    })
  }
  return out
}

/** Walk forward from `targetId`; reaching `sourceId` means the proposed edge
 *  closes a cycle. Twelve lines, carried over from the spike unchanged. */
export function wouldCycle(graph, sourceId, targetId) {
  const seen = new Set()
  const stack = [targetId]
  const edges = edgesOf(graph)
  while (stack.length) {
    const id = stack.pop()
    if (id === sourceId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.source === id) stack.push(e.target)
  }
  return false
}

// --- the guard, separated from the mutation ------------------------------

/**
 * May this connection be made? Asked without changing anything.
 *
 * Both connect paths end here. The pointer drop asks before the library commits
 * the gesture; the slot row asks once per candidate to build its list. There is
 * no second rule set and no second refusal, which is what keeps the keyboard path
 * from being a slightly different product from the pointer one.
 *
 * @returns {{ ok: true } | { ok: false, diagnostic: Readonly<object> }}
 */
export function checkConnect(graph, sourceId, targetId, slot) {
  const source = findNode(graph, sourceId)
  const target = findNode(graph, targetId)
  if (!source) return refuse(error(CODE.unknownStep, { id: sourceId }))
  if (!target) return refuse(error(CODE.unknownStep, { id: targetId }))
  if (sourceId === targetId) return refuse(error(CODE.selfConnection, { id: sourceId }))

  const spec = kindSpec(target.kind)
  if (!spec) return refuse(error(CODE.unknownKind, { id: targetId, kind: target.kind }))
  if (spec.maxInputs === 0) return refuse(error(CODE.sourceTakesNoInput, { targetId }))
  if (!Number.isInteger(slot) || slot < 0 || slot >= target.inputs.length) {
    return refuse(error(CODE.noSuchSlot, { id: targetId, slot }))
  }
  if (target.inputs[slot] === sourceId) {
    return refuse(error(CODE.alreadyConnected, { sourceId, targetId, slot }))
  }
  if (wouldCycle(graph, sourceId, targetId)) {
    return refuse(error(CODE.cycle, { sourceId, targetId }))
  }
  return { ok: true }
}

const refuse = (diagnostic) => ({ ok: false, diagnostic })
const refused = (diagnostic) => ({ ok: false, diagnostics: Object.freeze([diagnostic]) })
const done = (diagnostics = []) => ({ ok: true, diagnostics: Object.freeze(diagnostics) })

/**
 * The Steps that would be accepted at this slot, in graph order.
 *
 * Built from `checkConnect` itself rather than from a second reading of the
 * rules, so a candidate the list offers can never be refused on selection. The
 * refused ones are **absent** rather than listed and turned down: the guard
 * already knows the answer, and a list that offers a cycle only to refuse it is a
 * worse version of the same information.
 */
export function connectableInto(graph, targetId, slot) {
  return graph.nodes
    .filter((n) => checkConnect(graph, n.id, targetId, slot).ok)
    .map((n) => n.id)
}

// --- mutations: the only door --------------------------------------------

/**
 * Connect, after the guard. An occupied slot is **replaced and the replacement
 * is reported** — dropping the displaced id on the floor would let a slot-row
 * selection quietly detach an edge the user is still looking at.
 */
export function connect(graph, sourceId, targetId, slot) {
  const check = checkConnect(graph, sourceId, targetId, slot)
  if (!check.ok) return refused(check.diagnostic)

  const target = findNode(graph, targetId)
  const replaced = target.inputs[slot]
  target.inputs[slot] = sourceId
  return done(
    replaced ? [info(CODE.inputReplaced, { id: targetId, slot, replaced })] : [],
  )
}

export function disconnect(graph, targetId, slot) {
  const target = findNode(graph, targetId)
  if (!target) return refused(error(CODE.unknownStep, { id: targetId }))
  if (!Number.isInteger(slot) || slot < 0 || slot >= target.inputs.length) {
    return refused(error(CODE.noSuchSlot, { id: targetId, slot }))
  }
  if (!target.inputs[slot]) return refused(error(CODE.slotEmpty, { id: targetId, slot }))
  target.inputs[slot] = null
  return done()
}

export function addNode(graph, node) {
  if (!kindSpec(node.kind)) return refused(error(CODE.unknownKind, { id: node.id, kind: node.kind }))
  if (findNode(graph, node.id)) return refused(error(CODE.duplicateId, { id: node.id }))
  graph.nodes.push(node)
  // The first Step that could be a Result becomes one. A graph with exactly one
  // non-Source Step and no designation is a state nobody meant to be in.
  if (!graph.resultId && node.kind !== 'source') graph.resultId = node.id
  return done()
}

/**
 * Remove a node. CAP-12: a Step whose input disappears is marked broken and
 * names what it lost — it is neither deleted nor silently re-wired. So the
 * dangling reference stays in the consumer's slot and the name is remembered.
 */
export function removeNode(graph, id) {
  const node = findNode(graph, id)
  if (!node) return refused(error(CODE.unknownStep, { id }))
  graph.nodes = graph.nodes.filter((n) => n.id !== id)
  graph.lost[id] = node.name
  if (graph.resultId === id) graph.resultId = null
  return done()
}

/**
 * Rename. An empty name is a **refusal**, not a silent decline: returning `ok`
 * after declining to apply it clears the refusal region and leaves the input
 * showing text the model does not hold.
 */
export function renameNode(graph, id, name) {
  const node = findNode(graph, id)
  if (!node) return refused(error(CODE.unknownStep, { id }))
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') return refused(error(CODE.emptyName, { id }))
  node.name = trimmed
  return done()
}

/**
 * Move. An unknown id is a refusal rather than a throw, and the reasoning is the
 * whole of design B: the canvas reports about nodes it measured a frame ago, so a
 * position change for a Step that has just been deleted is a race between two
 * truthful views rather than a caller's bug.
 */
export function moveNode(graph, id, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('a position is two finite numbers')
  const node = findNode(graph, id)
  if (!node) return refused(error(CODE.unknownStep, { id }))
  node.x = x
  node.y = y
  return done()
}

export function setResult(graph, id) {
  const node = findNode(graph, id)
  if (!node) return refused(error(CODE.unknownStep, { id }))
  if (node.kind === 'source') return refused(error(CODE.resultIsSource, { id }))
  graph.resultId = id
  return done()
}

export function addInputSlot(graph, id) {
  const node = findNode(graph, id)
  if (!node) return refused(error(CODE.unknownStep, { id }))
  const spec = kindSpec(node.kind)
  if (!spec) return refused(error(CODE.unknownKind, { id, kind: node.kind }))
  if (node.inputs.length >= spec.maxInputs) {
    return refused(error(CODE.maxInputs, { id, max: spec.maxInputs }))
  }
  node.inputs.push(null)
  return done()
}

/**
 * Remove one input slot.
 *
 * A slot that **holds a connection** is refused. Without that, the `−` beside a
 * connected select destroys the edge with no diagnostic at all — the one class of
 * change this story exists to make impossible.
 */
export function removeInputSlot(graph, id, slot) {
  const node = findNode(graph, id)
  if (!node) return refused(error(CODE.unknownStep, { id }))
  const spec = kindSpec(node.kind)
  if (!spec) return refused(error(CODE.unknownKind, { id, kind: node.kind }))
  if (!Number.isInteger(slot) || slot < 0 || slot >= node.inputs.length) {
    return refused(error(CODE.noSuchSlot, { id, slot }))
  }
  if (node.inputs.length <= spec.minInputs) {
    return refused(error(CODE.minInputs, { id, min: spec.minInputs }))
  }
  if (node.inputs[slot]) return refused(error(CODE.slotConnected, { id, slot }))
  node.inputs.splice(slot, 1)
  return done()
}

// --- the two walks no library in the field provides ----------------------

export function contributingTo(graph, resultId = graph.resultId) {
  const seen = new Set()
  if (!resultId || !findNode(graph, resultId)) return seen
  seen.add(resultId)
  const stack = [resultId]
  const edges = edgesOf(graph)
  while (stack.length) {
    const id = stack.pop()
    for (const e of edges) {
      if (e.target === id && !seen.has(e.source)) {
        seen.add(e.source)
        stack.push(e.source)
      }
    }
  }
  return seen
}

/**
 * Steps on no path to the Result Step. Marked, never removed.
 *
 * **With no Result Step designated there are no orphans**, and that is a
 * statement about the question rather than an exemption: "contributes to the
 * Result" is not yet a question, so nothing can be failing it. Without this, two
 * freshly loaded Sources each carry „…trägt nicht zum Ergebnis bei." on the first
 * entry into the Editor, over a state the user cannot act on because there is no
 * Step to designate yet. `graph.no_result` is what names that state, and it says
 * so once instead of once per node.
 */
export function orphans(graph) {
  if (!graph.resultId || !findNode(graph, graph.resultId)) return []
  const contributing = contributingTo(graph)
  return graph.nodes.filter((n) => !contributing.has(n.id)).map((n) => n.id)
}

/**
 * A Step is broken when a slot points at a node that is gone, or when fewer slots
 * are filled than its kind requires. The two are reported as **different things**
 * and the difference is the whole of CAP-12's promise: an emptied slot is a Step
 * the user is still building, a lost input is a Step that came apart.
 */
export function brokenNodes(graph) {
  const out = []
  for (const node of graph.nodes) {
    const spec = kindSpec(node.kind)
    if (!spec) continue
    const lost = []
    let filled = 0
    node.inputs.forEach((sourceId, slot) => {
      if (!sourceId) return
      if (findNode(graph, sourceId)) filled += 1
      else lost.push({ slot, name: graph.lost[sourceId] ?? sourceId })
    })
    if (lost.length > 0 || filled < spec.minInputs) {
      out.push({ id: node.id, lost, filled, required: spec.minInputs })
    }
  }
  return out
}

/**
 * What the graph says about itself, as Diagnostics (AD-13, CAP-34).
 *
 * Derived on every commit rather than stored, exactly as a Source's typing
 * diagnostics are: a command changes the graph, so the marks follow without any
 * command having to remember to update them, and the two can never disagree.
 */
export function graphDiagnostics(graph) {
  const out = []
  for (const broken of brokenNodes(graph)) {
    // A lost input wins over an under-filled one. A Step that came apart is not
    // a Step being built, and reporting the count instead of the name is the
    // exact inversion this story exists to prevent.
    if (broken.lost.length > 0) {
      out.push(
        warning(
          CODE.inputLost,
          { id: broken.id, lost: Object.freeze(broken.lost.map((l) => Object.freeze({ ...l }))) },
          { stepId: broken.id },
        ),
      )
    } else {
      out.push(
        warning(
          CODE.inputsMissing,
          { id: broken.id, required: broken.required, filled: broken.filled },
          { stepId: broken.id },
        ),
      )
    }
  }
  for (const id of orphans(graph)) {
    out.push(info(CODE.orphan, { id }, { stepId: id }))
  }
  // Counted over the Steps that could *be* a Result. Counting every node would
  // make the sentence call Sources Steps, and a graph of Sources alone is not a
  // graph waiting for a designation.
  const steps = graph.nodes.filter((n) => n.kind !== 'source').length
  if (steps > 0 && (!graph.resultId || !findNode(graph, graph.resultId))) {
    out.push(unresolved(CODE.noResult, { steps }))
  }
  return out
}

/**
 * Names the cycle rather than only reporting that one exists.
 *
 * Unreachable from the Editor by construction — `checkConnect` refuses the edge
 * that would close one — and kept because story 14's loader reads a graph out of
 * a file, where a cycle arrives fully formed and CAP-28 requires a rejection
 * specific enough to paste back to a language model. Ids, not names: `ui/`
 * resolves those against the graph it renders.
 */
export function findCycle(graph) {
  const edges = edgesOf(graph)
  const state = new Map()
  const path = []
  let found = null
  const walk = (id) => {
    if (found) return
    state.set(id, 'open')
    path.push(id)
    for (const e of edges) {
      if (e.source !== id) continue
      if (state.get(e.target) === 'open') {
        found = [...path.slice(path.indexOf(e.target)), e.target]
        break
      }
      if (!state.has(e.target)) walk(e.target)
    }
    path.pop()
    state.set(id, 'done')
  }
  for (const n of graph.nodes) if (!state.has(n.id) && !found) walk(n.id)
  return found
}

export const cloneGraph = (graph) => ({
  nodes: graph.nodes.map((n) => ({ ...n, inputs: [...n.inputs] })),
  resultId: graph.resultId,
  lost: Object.assign(Object.create(null), graph.lost),
})

// --- placement ------------------------------------------------------------

/** The grid a new Step is placed on. Wide enough that two cards do not touch at
 *  the zoom the canvas opens at. */
export const PLACEMENT = Object.freeze({ x0: 40, y0: 40, dx: 320, dy: 150, near: 140 })

/**
 * Where a new node goes, **derived from the nodes already in the graph**.
 *
 * Never from a counter: this story unmounts the Editor on every view switch, so a
 * counter held anywhere above the store restarts at zero and the next Step lands
 * exactly on the first one. Counting existing nodes fails the same way one step
 * later, the moment one has been removed.
 *
 * Sources take the left column because they are where a pipeline starts and
 * because that is where `syncSources` keeps putting them; everything else starts
 * one column in. The scan is bounded by the node count, so it always terminates
 * on a free cell — there are strictly more candidate cells than nodes.
 */
export function freePosition(graph, kind) {
  const startColumn = kind === 'source' ? 0 : 1
  const taken = graph.nodes
  const occupied = (x, y) =>
    taken.some((n) => Math.abs(n.x - x) < PLACEMENT.near && Math.abs(n.y - y) < PLACEMENT.near)

  for (let column = startColumn; column <= startColumn + taken.length; column += 1) {
    for (let row = 0; row <= taken.length; row += 1) {
      const x = PLACEMENT.x0 + column * PLACEMENT.dx
      const y = PLACEMENT.y0 + row * PLACEMENT.dy
      if (!occupied(x, y)) return { x, y }
    }
  }
  /* c8 ignore next */
  return { x: PLACEMENT.x0, y: PLACEMENT.y0 }
}
