// The frontier walk of execution (CAP-19, AD-29's first gate), with AD-8's
// content-addressed cache threaded through it and AD-9's yield point cut into it.
//
// It is a *frontier walk*. `contributingTo(graph, resultId)` already existed and
// already answers which Steps a run has to touch; this file walks that set in
// dependency order, converts each contributing Source through story 6a's cache as
// Step zero, and asks each remaining Step's executor for a table. What it still
// deliberately does not have is story 7c's: no mode switch and no row threshold.
//
// ONE WALK, TWO DRIVERS, AND THE WALK IS A GENERATOR (story 7b).
//
//   `walkGraph` is the loop. It yields once per node, **before that node is
//   touched at all**, and returns the assembled result. A yield placed anywhere
//   else in the body would land between a Step's key and its store, and a run
//   stopped there would leave a key in `keys` for a Step it never computed.
//
//   `executeGraph` drains it in a `while` and is the synchronous driver — the same
//   function, with the same signature and the same return, that every caller and
//   every test before this story described. It is what keeps the second driver
//   honest: a difference between the two would show up here first.
//
//   `core/exec/scheduler.js` is the asynchronous driver. It drains the same
//   generator one Step per turn of the macrotask queue, checks a cancellation flag
//   at each yield and reports progress. AD-4 forbids a *Step* from being a
//   generator or async; it says nothing about the loop around them, and that loop
//   is precisely what AD-9 calls the scheduler.
//
// A RUN HAS AN IDENTITY (AD-25), AND EVERY RETURN CARRIES IT. `{ id, startedAt }`
// is minted from the `Clock` port above everything, so a run refused at a gate
// carries it too — a refusal is a run that happened, and a compliance artifact
// that cannot say when it was refused is not one. The clock is a door like the
// cache: absent, the identity is two `null`s and the walk is what it always was.
//
// THE CACHE ARRIVES AS A PARAMETER, WHICH IS WHY THIS FILE IS STILL PURE. Story
// 6a's version of this comment said "nothing here holds state between calls",
// and that sentence would have been the first casualty of a module-level `Map`.
// It is not: `executeGraph` is handed a cache and a way to key a Source, and it
// owns neither. A run with no cache computes byte-for-byte what it computed
// before this story — the parameter is a door, not a mode — and the owner of the
// state is `ui/App.vue`, which already owns Step zero's cache for the same
// reason (AD-6: a `Table` handle must not be reachable from reactive state).
//
// WHAT A KEY IS MADE OF is `core/exec/cache-key.js`'s business and the one thing
// worth repeating here is what it is *not* made of: not a Step id, not a name,
// not a position. A rename and a move must not evict anything, and a re-parsed
// Source must not be served from the old entry — the two failures AD-8 names.
// **A hit replays the entry's diagnostics along with its table**, which is the
// whole of the guarantee that a repeat run never reports clean over a warning it
// did not re-emit; the run's diagnostic stream is assembled from `results` at the
// bottom of this file, so storing them together is all that takes.
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
//   NOTHING IS READ OR WRITTEN ABOVE THE GATES. A refused run touches the cache
//   at neither end: the gate loop returns before any Step has a key, so a run
//   that may not happen leaves no trace of itself to be served later.
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
import { keyFromDoor, keyOrNull, stepKey } from './cache-key.js'

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
  stepThrew: 'exec.step_threw',
  runIncomplete: 'exec.run_incomplete',
  // Minted here rather than in `core/exec/scheduler.js`, which is where it is
  // emitted, because this is the table `ui/graph-labels.js` checks itself against
  // (`EXEC_CODES` below). A code emitted from a file with no enumeration of its
  // own would be a German sentence nothing can prove exists.
  runCancelled: 'exec.run_cancelled',
})

/** The enumeration `ui/graph-labels.js` checks itself against. */
export const EXEC_CODES = Object.freeze(Object.values(CODE))

/**
 * A `Map` a caller cannot write to.
 *
 * `Object.freeze` does nothing to a `Map` — `set` and `delete` go on working —
 * so freezing one is a promise the object does not keep, and every other
 * projection in this codebase (`unparsed`, `slots`, `renamed`, the graph store's
 * whole snapshot) freezes what it hands out. This is the same guarantee in the
 * one shape `Object.freeze` cannot give: the read methods, and nothing else.
 */
function readOnlyMap(map) {
  return Object.freeze({
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    get size() {
      return map.size
    },
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    [Symbol.iterator]: () => map.entries(),
  })
}

/**
 * The result map of a run that produced none — a refusal, a graph with no Result
 * Step, a cancellation. Exported because `core/exec/scheduler.js` returns it for a
 * cancelled run and a second empty projection would be a second answer to "what
 * does a run with no results look like".
 */
export const EMPTY_RESULTS = readOnlyMap(new Map())

/**
 * A run's identity, taken from the `Clock` port (AD-25).
 *
 * **The clock is a door, exactly as the cache is.** Without one the identity is
 * two `null`s and the walk is byte-for-byte what it was before this story, which
 * is what lets every test written against `executeGraph` stay honest. In the
 * product `ui/EditorPane.vue` always passes one, because the composition root
 * names one adapter and threads it (AD-1).
 *
 * Minted through a function rather than inline because there are two mint sites
 * for one rule: the synchronous driver mints above its gate loop, and
 * `core/exec/scheduler.js` mints before its first `next()` so it can hand the id
 * back to its caller without awaiting anything.
 *
 * @param {import('../../ports/index.js').Clock|null} [clock]
 * @returns {Readonly<{ id: string|null, startedAt: number|null }>}
 */
export function mintRun(clock = null) {
  return Object.freeze({
    id: clock === null ? null : clock.runId(),
    startedAt: clock === null ? null : clock.now(),
  })
}

/**
 * The three states a run reports about itself.
 *
 * `refused` is a gate saying the run may not happen (AD-29); `cancelled` is a user
 * saying it should stop (AD-9); `complete` is the walk having reached the end of
 * its order — including the end of an empty order, which is what a graph with no
 * Result Step has. **A `complete` run is not a successful one**: a Step that
 * produced no table leaves `ok: true` and says so in its own diagnostics, and that
 * distinction is older than this story.
 */
export const RUN_STATE = Object.freeze({
  refused: 'refused',
  complete: 'complete',
  cancelled: 'cancelled',
})

const refused = (diagnostics, run) =>
  Object.freeze({
    ok: false,
    results: EMPTY_RESULTS,
    diagnostics: Object.freeze(diagnostics),
    run: Object.freeze({ ...run, state: RUN_STATE.refused }),
  })

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
 * The walk itself, as a generator: **one Step per `yield`, and the `yield` comes
 * first.**
 *
 * The value yielded is the progress of the run — `{ done, total, stepId }`, where
 * `done` is how many Steps are finished and `stepId` names the one about to start,
 * so `done + 1` of `total` is the position a person reads. `total` is the walk's
 * own length and nothing derived: `order.length` is exactly how many Steps this
 * run will touch.
 *
 * **Why the top of the loop body and nowhere else.** A driver that stops at a
 * yield stops *between* Steps, which is what AD-9 asks for and what makes exit
 * latency one Step. It also means the node whose descriptor was just yielded has
 * had nothing done to it — no key computed, no cache read, no executor called — so
 * a cancelled run leaves no key in `keys` for a Step it never ran and no entry in
 * `results` for a Step that never produced one. Story 7a made this loop the place
 * where content keys are minted and stored, so "somewhere in the body" would have
 * been a real choice with a wrong answer.
 *
 * A generator rather than a second copy of the walk, because two copies would
 * drift about dependency order, about the gates, or about what a result is — and
 * the synchronous driver below is what every existing test describes.
 *
 * @param {object} run see `executeGraph`
 * @param {Readonly<{ id: string|null, startedAt: number|null }>} [run.run] the
 *   identity to stamp, for a driver that minted one before starting. Absent, it is
 *   minted here from `run.clock`.
 * @returns {Generator<Readonly<{ done: number, total: number, stepId: string }>,
 *                     object, void>}
 */
export function* walkGraph({
  steps,
  resultId,
  engine,
  sourceTable,
  cache = null,
  sourceKey = null,
  clock = null,
  run = null,
}) {
  // **Above everything, including the gates.** A refusal is a run that happened,
  // and AD-25 says every run carries an id and a start time — so the identity is
  // minted before the first thing that can return.
  const identity = run ?? mintRun(clock)

  // No Result Step designated is not a refusal and carries no sentence of its
  // own: `graph.no_result` already says it, once, on the pane. A second sentence
  // here would say the same thing in a different place.
  if (!resultId || !findNode({ nodes: steps }, resultId)) {
    return Object.freeze({
      ok: true,
      results: EMPTY_RESULTS,
      diagnostics: Object.freeze([]),
      run: Object.freeze({ ...identity, state: RUN_STATE.complete }),
    })
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
  if (blocking.length > 0) return refused(blocking, identity)

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

  /**
   * Each node's key, or nothing where it has none — filled in **inside the walk
   * and in the walk's order**, because a Step's key is built out of its inputs'
   * keys and dependency order is what guarantees they are already here.
   *
   * A node with no entry is a node nothing downstream of it may be cached
   * against: a missing key propagates as "not cacheable" rather than as a
   * guess, and that propagation is what keeps an eviction, an unkeyable Source
   * and a Step that produced nothing all in the same safe category — a miss.
   *
   * @type {Map<string, string>}
   */
  const keys = new Map()

  /** Caching is on only if there is somewhere to put an entry *and* a way to
   *  key the Sources it is derived from. A cache with no `sourceKey` would key
   *  nothing anyway, since every chain starts at a Source. */
  const caching = cache !== null && typeof sourceKey === 'function'

  for (const [index, node] of order.entries()) {
    // **The yield point (AD-9), and the cancellation-check point with it.** It is
    // the first statement of the body, so a driver that stops here has stopped
    // before this node was touched: nothing computed, no key minted, no entry
    // stored. `index` is how many Steps are finished, which is what makes
    // `done + 1 of total` the position a person reads.
    //
    // `order.entries()` rather than a counter, because the body `continue`s in
    // four places and a counter incremented at the bottom would miss every one of
    // them.
    yield Object.freeze({ done: index, total: order.length, stepId: node.id })

    if (node.kind === SOURCE) {
      // A Source's key exists to be an *input* key and nothing else. Its table
      // is Step zero's, already cached by `createStepZeroCache` under this very
      // key, and its diagnostics live on the registry entry rather than in the
      // run — so there is nothing here to store and nothing to replay.
      //
      // Through `keyFromDoor` and **not** through `keyOrNull`, and the two are
      // different on purpose (review round 3). `sourceKey` is a door: this file
      // did not write what is behind it, cannot audit it, and its one caller is a
      // Vue `watch`, so *whatever* it throws is a cache miss rather than a blank
      // Editor. The `stepKey` call below is internal and keeps the narrow rule,
      // so a caller bug in this repository still propagates to whoever can fix
      // it. Rounds 1 and 2 pushed one site both ways and it could only be one.
      if (caching) {
        const key = keyFromDoor(() => sourceKey(node.id))
        if (typeof key === 'string') keys.set(node.id, key)
      }
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
    // **The resolved config, and the `null` fallback is the trap.** Keying
    // `node.config` would make the first `configureStep` that writes a kind's
    // own default look like a change and recompute a Step whose output is
    // provably identical — a miss the user pays for and can see no reason for.
    // `null` and the default *are* the same Step, so they are one key.
    const config = node.config ?? kind.defaultConfig()

    // Every slot has a result by now (the missing-input branch above `continue`s
    // before this line), so an input without a key is an input that was itself
    // not cacheable, and this Step inherits that.
    //
    // Through `keyOrNull`, so a config the kind's own `validate` admits and
    // `canonical` refuses costs this Step its cache entry and costs the run
    // nothing. The frozen rule is that a cached run and an uncached run are
    // indistinguishable except in time, and a throw escaping here would be the
    // loudest possible way to break it — `executeGraph` is called from a Vue
    // `watch`, so it would reach the user as a blank Editor.
    const inputKeys = node.inputs.map((upstream) => keys.get(upstream))
    const key =
      caching && inputKeys.every((k) => typeof k === 'string')
        ? keyOrNull(() => stepKey(node.kind, config, inputKeys))
        : null
    if (key !== null) {
      keys.set(node.id, key)
      const hit = cache.get(key)
      if (hit !== undefined) {
        // **Unchanged**: the same frozen table, counts and diagnostics, with the
        // `stepId` stamps they were given when they were computed. A hit that
        // re-derived anything would be a second answer to a question that has
        // already been answered, and the diagnostics are frozen precisely so it
        // cannot (`core/diagnostics/diagnostic.js`, AD-8).
        //
        // One consequence, named rather than discovered: two Steps of one kind
        // with an identical config over an identical input share a key — that is
        // what content-addressing *means* — so the second of them replays the
        // first's `stepId` stamps. Nothing in the product can reach that state
        // today (both would have to contribute to the Result, which needs a
        // multi-input kind, and none is executable yet); it is a ledger entry
        // rather than a branch, because the fix is to route a replayed
        // diagnostic by the id in `results` instead of the id inside it, and
        // that is a decision about the diagnostic stream rather than the cache.
        results.set(node.id, hit)
        continue
      }
    }

    /**
     * **A throw out of a Step is a Diagnostic, not a broken Editor.**
     *
     * Every guard behind this call is an invariant guard — the engine refuses a
     * column no table has, `fromColumns` refuses two columns of one name, the
     * comparison refuses an operator outside a closed list — and each of them is
     * *supposed* to be unreachable. What makes the catch load-bearing rather
     * than defensive is where the call sits: both callers of `executeGraph` are
     * on a render path, so an invariant guard that escapes reaches the user as a
     * blank Editor, which is worse than the state the guard exists to prevent.
     * The Step is recorded as having produced nothing and the walk continues, so
     * the Steps downstream report their missing input exactly as they do for
     * every other reason a Step produces no table.
     */
    let outcome
    try {
      outcome = kind.apply(engine, inputs, config)
    } catch {
      // **Nothing is stored for a Step that threw**, and the `continue` is where
      // that is decided. An entry with no table is not a result to replay: the
      // next run calls the Step again and records the same diagnostic, which is
      // what a user correcting the cause needs to see happen.
      record(node, null, [
        error(CODE.stepThrew, { id: node.id, kind: node.kind }, { stepId: node.id }),
      ])
      continue
    }

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

    // The recorded object is the cache entry — table, counts and diagnostics
    // together, which is exactly AD-8's rule and needs nothing designed for it.
    // It is stored **after** the stamping, so a replay is already stamped and
    // nothing stamps it twice.
    //
    // **`table !== null` is the whole condition, and it is about the entry
    // rather than about which failure produced it.** A Step that *throws* is not
    // stored because the `catch` above `continue`s; a Step that *returns*
    // `{ table: null }` — `columns`' unknown column, `filter`'s type mismatch —
    // is the same nothing to replay and was being stored until review round 1.
    // The next run calls it again and records the same diagnostic, which is what
    // a user correcting the cause needs to see happen.
    //
    // The condition reads the **stored** entry rather than `outcome.table`, so it
    // is a statement about what is going into the cache rather than about what
    // `record` was handed a line earlier. The two agree today and there is no
    // reason for a reader to have to check that they do (review round 2).
    const stored = results.get(node.id)
    if (key !== null && stored.table !== null) cache.set(key, stored)
  }

  // **One sentence about the run as a whole, and it is here because the cards
  // deliberately do not carry the run's marks.** A Step error is visible in that
  // Step's panel, which is where CAP-19 puts it — and a user with nothing
  // selected would otherwise see a pipeline that computed nothing, with no
  // reason anywhere on screen. This diagnostic carries **no `stepId`**, which is
  // what routes it to the pane's own status region rather than to a card.
  const failed = [...results.values()].filter((r) => r.table === null)
  const whole =
    failed.length === 0
      ? []
      : [
          error(CODE.runIncomplete, {
            id: [...results.entries()].find(([, r]) => r.table === null)[0],
            steps: failed.length,
          }),
        ]

  return Object.freeze({
    ok: true,
    results: readOnlyMap(results),
    diagnostics: Object.freeze([
      ...[...results.values()].flatMap((r) => r.diagnostics),
      ...whole,
    ]),
    run: Object.freeze({ ...identity, state: RUN_STATE.complete }),
  })
}

/**
 * Run the Pipeline that ends at the Result Step, synchronously.
 *
 * **The synchronous driver, and the reason it did not become the asynchronous
 * one.** Every caller this function had before story 7b — `core/exec/execute.test.js`
 * and, until 7b, `ui/EditorPane.vue` — describes a function that takes a graph and
 * returns an answer. Turning that into a promise would have made every one of them
 * a statement about scheduling instead of about execution, and there would have
 * been nothing left that says what the walk *is* independently of when it runs.
 * So the walk moved into a generator and this drained it, unchanged in signature,
 * in behaviour and in what its tests can assert.
 *
 * @param {object} run
 * @param {ReadonlyArray<object>} run.steps the graph store's frozen projection
 * @param {string|null} run.resultId which Step the run ends at
 * @param {import('../../ports/index.js').TableEngine} run.engine
 * @param {(id: string) => (object|null)} run.sourceTable Step zero's output for a
 *   Source node — the converted `Table`, or `null` while its typing is not
 *   confirmed. With column names made unique on ingest, `null` has exactly one
 *   meaning here, which is what lets gate 1 name the Source truthfully.
 * @param {{ get: (key: string) => (object|undefined),
 *           set: (key: string, entry: object) => unknown }} [run.cache]
 *   AD-8's cache (`createRunCache`), or nothing. Absent, every Step computes
 *   exactly as it did before story 7a existed.
 * @param {(id: string) => (string|null)} [run.sourceKey] what a Source node's
 *   Step-zero output *is*, as a key — `core/exec/convert.js`'s `stepZeroKey`,
 *   which is `stepKey('typing', typing, [sourceKey(entry)])` so that the two
 *   stores share one key scheme rather than two opinions about staleness.
 *   **`null` means "not keyable", and it is a supported answer**: it makes that
 *   Source and everything downstream of it uncacheable for the run, which is a
 *   miss rather than a wrong answer. Anything else would mean guessing a key for
 *   a Source whose bytes nobody digested, and two such guesses would collide.
 * @param {import('../../ports/index.js').Clock} [run.clock] AD-25's identity, and
 *   a door like the two above: absent, `run.id` and `run.startedAt` are `null`.
 * @returns {{ ok: boolean,
 *            results: ReadonlyMap<string, { kind: string, table: object|null,
 *              rowCount: number|null, columnCount: number|null,
 *              diagnostics: ReadonlyArray<object> }>,
 *            diagnostics: ReadonlyArray<object>,
 *            run: Readonly<{ id: string|null, startedAt: number|null,
 *                            state: 'refused'|'complete'|'cancelled' }> }}
 */
export function executeGraph(run) {
  const walk = walkGraph(run)
  let step = walk.next()
  while (!step.done) step = walk.next()
  return step.value
}
