// The walking skeleton of execution (CAP-19, AD-29's first gate).
//
// It is a *frontier walk*, not a scheduler. `contributingTo(graph, resultId)`
// already existed and already answers which Steps a run has to touch; this file
// walks that set in dependency order, converts each contributing Source through
// story 6a's cache as Step zero, and asks each remaining Step's executor for a
// table. What it deliberately does not have is story 7's: no cache, no
// memoization, no cancellation, no mode switch and no row threshold. Every run
// recomputes, and the licence for that is measured rather than assumed — 263/446
// ms for a full 100k pipeline and 578/1156 ms for the earliest edit of a 30-Step
// graph, with the interim rule stated in the story spec.
//
// THREE REFUSALS, AND ALL THREE ARE WHOLE-RUN.
//
//   GATE 1 (AD-29). No Pipeline executes until the type mapping of every
//   contributing Source is confirmed. The refusal names the Source and **nothing
//   runs** — not the Steps that would have been fine, not the branch that does
//   not depend on it. A partial answer over an unconfirmed Source is the exact
//   failure the product exists to avoid, and a partial answer that *looks*
//   complete is worse than none.
//
//   A KIND WITH NO EXECUTOR. A Union, a Join, a Computed Column or an Aggregate
//   in the frontier refuses the run naming the Step and its kind (stories 8 and
//   9 close this by adding a file under `core/steps/`). It never crashes: the
//   registry answers `null` and the gap is data, not a missing function.
//
//   GATES 2 AND 3 ARE NOT HERE. The Pre-flight Check and the visible execution
//   mode are the scheduler's (story 7). This file is where they will land; that
//   they are absent is a sequencing fact, and the gate that is present is
//   enforced here rather than in `ui/` precisely so a second caller cannot reach
//   execution around it.
//
// A per-Step failure, by contrast, is **not** whole-run: a Filter whose condition
// disagrees with its column's type produces no table and says so, and each Step
// downstream reports its missing input **by name**. That difference is the point
// — a gate is about whether a run may happen at all, a Step error is about what
// one Step produced, and collapsing the two would either hide a gate or stop a
// pipeline over one badly typed comparison.
//
// Nothing here holds state between calls and nothing here is reactive: the result
// map carries `Table` handles, which may never enter `ref`, `reactive` or a
// `computed` return value (AD-6). `ui/` swaps the whole return value through a
// `shallowRef`.

import { error } from '../diagnostics/diagnostic.js'
import { contributingTo, findNode } from '../graph/graph.js'
import { SOURCE } from '../graph/kinds.js'
import { stepKind } from '../steps/index.js'

/**
 * Every code this file emits, built out of the constants its own emit sites use
 * — `core/graph/graph.js`'s pattern, for its reason: `ui/graph-labels.js` owes a
 * completeness invariant and needs something to check itself against.
 */
export const CODE = Object.freeze({
  sourceUnconfirmed: 'exec.source_unconfirmed',
  kindNotExecutable: 'exec.kind_not_executable',
  inputMissing: 'exec.input_missing',
  inputFailed: 'exec.input_failed',
})

/** The enumeration `ui/graph-labels.js` checks itself against. */
export const EXEC_CODES = Object.freeze(Object.values(CODE))

const NOTHING = Object.freeze(new Map())

const refused = (diagnostics) =>
  Object.freeze({ ok: false, results: NOTHING, diagnostics: Object.freeze(diagnostics) })

/**
 * The contributing Steps in dependency order — every input before its consumer.
 *
 * Depth-first post-order over the frontier, with a `seen` set rather than a
 * cycle guard: `checkConnect` refuses the edge that would close a cycle, so a
 * graph reaching here cannot contain one, and the `seen` set is what makes a
 * diamond (one Step feeding two consumers) cost one visit rather than two.
 *
 * A slot pointing at a Step that is gone is skipped here and reported at the
 * consumer, where it can name the slot — `contributingTo` adds the id it found in
 * the slot without asking whether a node answers to it.
 */
function inDependencyOrder(nodes, frontier) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const seen = new Set()
  const order = []

  const visit = (id) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = byId.get(id)
    if (!node) return
    for (const upstream of node.inputs) {
      if (upstream && frontier.has(upstream)) visit(upstream)
    }
    order.push(node)
  }

  for (const id of frontier) visit(id)
  return order
}

/**
 * Run the Pipeline that ends at the Result Step.
 *
 * @param {object} run
 * @param {ReadonlyArray<object>} run.steps the graph store's frozen projection
 * @param {string|null} run.resultId which Step the run ends at
 * @param {import('../../ports/index.js').TableEngine} run.engine
 * @param {(id: string) => (object|null)} run.sourceTable Step zero's output for a
 *   Source node — the converted `Table`, or `null` while its typing is not
 *   confirmed. With column names made unique on ingest, `null` has exactly one
 *   meaning here, which is what lets gate 1 name the Source truthfully.
 * @returns {{ ok: boolean,
 *            results: ReadonlyMap<string, { kind: string, table: object|null,
 *              rowCount: number|null, columnCount: number|null,
 *              diagnostics: ReadonlyArray<object> }>,
 *            diagnostics: ReadonlyArray<object> }}
 */
export function executeGraph({ steps, resultId, engine, sourceTable }) {
  // No Result Step designated is not a refusal and carries no sentence of its
  // own: `graph.no_result` already says it, once, on the pane. A second sentence
  // here would say the same thing in a different place.
  if (!resultId || !findNode({ nodes: steps }, resultId)) {
    return Object.freeze({ ok: true, results: NOTHING, diagnostics: Object.freeze([]) })
  }

  const graph = { nodes: steps, resultId }
  const frontier = contributingTo(graph, resultId)
  const order = inDependencyOrder(steps, frontier)

  // --- the gates, before anything is computed ----------------------------
  //
  // Both are collected in full rather than reported one at a time: a pipeline
  // with two unconfirmed Sources should name both, so the user makes one trip
  // through the Sources pane instead of two.
  const blocking = []
  for (const node of order) {
    if (node.kind === SOURCE) {
      if (sourceTable(node.id) === null) {
        blocking.push(error(CODE.sourceUnconfirmed, { id: node.id }, { stepId: node.id }))
      }
    } else if (!stepKind(node.kind)) {
      blocking.push(
        error(CODE.kindNotExecutable, { id: node.id, kind: node.kind }, { stepId: node.id }),
      )
    }
  }
  if (blocking.length > 0) return refused(blocking)

  // --- the walk ----------------------------------------------------------

  /** @type {Map<string, object>} */
  const results = new Map()

  const record = (node, table, diagnostics) => {
    results.set(
      node.id,
      Object.freeze({
        kind: node.kind,
        table,
        rowCount: table === null ? null : table.rowCount(),
        columnCount: table === null ? null : table.schema().length,
        diagnostics: Object.freeze([...diagnostics]),
      }),
    )
  }

  for (const node of order) {
    if (node.kind === SOURCE) {
      record(node, sourceTable(node.id), [])
      continue
    }

    // Every slot resolved before anything is applied, so a Step short of two
    // inputs names both rather than the first one it tripped over.
    const inputs = []
    const missing = []
    node.inputs.forEach((upstream, slot) => {
      if (!upstream || !frontier.has(upstream) || !findNode(graph, upstream)) {
        missing.push(error(CODE.inputMissing, { id: node.id, slot }, { stepId: node.id }))
        return
      }
      const produced = results.get(upstream)
      if (!produced || produced.table === null) {
        missing.push(
          error(CODE.inputFailed, { id: node.id, slot, upstream }, { stepId: node.id }),
        )
        return
      }
      inputs.push(produced.table)
    })
    if (missing.length > 0) {
      record(node, null, missing)
      continue
    }

    // The executor exists: the gate above refused the run otherwise.
    const kind = stepKind(node.kind)
    const config = node.config ?? kind.defaultConfig()
    const outcome = kind.apply(engine, inputs, config)
    // A Step emits its diagnostics without knowing which Step it is — AD-4 hands
    // it an engine, inputs and a config, and nothing else. The origin is stamped
    // here, once, so every mark in the run can be routed to the card it belongs
    // to without a Step author having to remember to carry an id.
    record(
      node,
      outcome.table,
      outcome.diagnostics.map((d) =>
        d.stepId === undefined ? Object.freeze({ ...d, stepId: node.id }) : d,
      ),
    )
  }

  return Object.freeze({
    ok: true,
    results,
    diagnostics: Object.freeze([...results.values()].flatMap((r) => r.diagnostics)),
  })
}
