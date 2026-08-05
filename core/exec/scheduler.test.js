// The asynchronous driver of the one walk (AD-9, AD-25), in the node envelope
// (AD-27).
//
// The graph store is the real one and so is the engine, reached the way
// `execute.test.js` reaches it — through a dynamic import, so no static import
// points from `core/` outward (AD-1). What is *not* real is the yield and the
// clock, and that is the point of both being parameters: a case here drives the
// walk one Step at a time by hand, so it can stand a run in the middle of itself
// and do something to it.
//
// **No fake timers, and this file is why the repository still needs none.** An
// injected yield is both the architectural answer (AD-1, AD-2: the platform is
// named in an adapter) and the only testable one.

import { beforeEach, describe, expect, it } from 'vitest'
import { CODE } from './execute.js'
import { startRun } from './scheduler.js'
import { createRunCache } from './cache.js'
import { forgetRefusals } from './cache-key.js'
import { createGraphStore } from '../graph/graph-store.js'

const { createArqueroEngine } = await import('../../adapters/arquero/engine.js')

const realEngine = createArqueroEngine()

/** The real engine, counting the verbs a run asks it for — which is how "only the
 *  Steps that were not already done computed" is observed. */
const countingEngine = () => {
  const calls = { filter: 0, selectColumns: 0 }
  return {
    calls,
    ...realEngine,
    filter: (...args) => {
      calls.filter += 1
      return realEngine.filter(...args)
    },
    selectColumns: (...args) => {
      calls.selectColumns += 1
      return realEngine.selectColumns(...args)
    },
  }
}

const typed = (columns) =>
  realEngine.fromColumns(
    columns.map((c) => ({
      name: c.name,
      type: c.type ?? 'text',
      values: [...c.values],
      unparsed: Object.freeze([]),
    })),
  )

const REPORT = () =>
  typed([
    { name: 'Kunde', values: ['Anna', 'Bernd', 'Carla', 'Dora'] },
    { name: 'Betrag', type: 'number', values: [1000, 500, 1000, 250] },
  ])

/** Source → Filter → Columns: three nodes, so a run can be stopped with some of
 *  them done and some not. */
function chain() {
  const graph = createGraphStore()
  graph.syncSources([{ id: 'src:umsatz', name: 'Umsatz' }])
  const filter = graph.addStep('filter', { name: 'Nur Große' }).id
  const columns = graph.addStep('columns', { name: 'Nur Kunde' }).id
  graph.connect('src:umsatz', filter, 0)
  graph.connect(filter, columns, 0)
  graph.configureStep(columns, { columns: [{ from: 'Kunde', to: 'Kunde' }] })
  graph.setResult(columns)
  return { graph, filter, columns }
}

/** A stopped `Clock`. `at` is milliseconds and a case moves it by assignment. */
const testClock = () => {
  let minted = 0
  return {
    at: 1_000,
    now() {
      return this.at
    },
    runId: () => `run:${(minted += 1)}`,
  }
}

/** Everything queued as a microtask has run by the time this resolves. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * A `Yield` the case releases by hand.
 *
 * `release()` waits for the run to be *waiting* first, then lets exactly one Step
 * through — so `release(2)` means "two more Steps ran" rather than "two resolvers
 * were called at some point".
 */
const handYield = () => {
  const waiting = []
  return {
    next: () => new Promise((resolve) => waiting.push(resolve)),
    pending: () => waiting.length,
    async release(times = 1) {
      for (let i = 0; i < times; i += 1) {
        await settle()
        waiting.shift()?.()
      }
      await settle()
    },
  }
}

/** A `Yield` that resolves on the macrotask queue on its own, for the cases that
 *  only want the run to finish. */
const autoYield = () => ({ next: settle })

const start = (graph, { confirmed = new Map(), yielder, clock, ...rest } = {}) =>
  startRun({
    steps: graph.list(),
    resultId: graph.resultId(),
    engine: rest.engine ?? realEngine,
    sourceTable: (id) => confirmed.get(id) ?? null,
    clock: clock ?? testClock(),
    yieldNow: (yielder ?? autoYield()).next,
    ...rest,
  })

const confirmedReport = () => new Map([['src:umsatz', REPORT()]])

beforeEach(forgetRefusals)

describe('a run that is left alone', () => {
  it('walks every Step and reports itself complete', async () => {
    const { graph, filter, columns } = chain()
    const out = await start(graph, { confirmed: confirmedReport() }).completed

    expect(out.ok).toBe(true)
    expect(out.run.state).toBe('complete')
    expect(out.results.get('src:umsatz')).toMatchObject({ rowCount: 4 })
    expect(out.results.get(filter)).toMatchObject({ rowCount: 4 })
    expect(out.results.get(columns)).toMatchObject({ rowCount: 4, columnCount: 1 })
  })

  it('carries the identity the Clock port minted, available before it finishes', async () => {
    // AD-25. Synchronously available, because a caller holding two runs has to be
    // able to tell them apart before either has finished — which is exactly the
    // state an edit during a run produces.
    const clock = testClock()
    clock.at = 1_712_000_000_000
    const handle = start(chain().graph, { confirmed: confirmedReport(), clock })

    expect(handle.id).toBe('run:1')
    expect(handle.startedAt).toBe(1_712_000_000_000)

    const out = await handle.completed
    expect(out.run).toEqual({ id: 'run:1', startedAt: 1_712_000_000_000, state: 'complete' })
  })

  it('reports progress once per Step, naming the Step, its kind and the length of the walk', async () => {
    const { graph, filter, columns } = chain()
    const seen = []
    await start(graph, {
      confirmed: confirmedReport(),
      onProgress: (at) => seen.push(at),
    }).completed

    // The kind is in the descriptor because the walk contains Quellen: a caller
    // rendering „Step 1 von 3" for `src:umsatz` is wrong about it, and round 1
    // shipped exactly that sentence.
    expect(seen).toEqual([
      { done: 0, total: 3, stepId: 'src:umsatz', kind: 'source' },
      { done: 1, total: 3, stepId: filter, kind: 'filter' },
      { done: 2, total: 3, stepId: columns, kind: 'columns' },
    ])
  })

  it('hands the callback the run’s identity, so it need not reach for the handle', async () => {
    // **The shape of a defect round 1 shipped.** The obvious callback compares
    // elapsed time against `startedAt`, which lives on a handle `startRun` has not
    // returned yet: `const h = startRun({ onProgress: () => h.startedAt })` reads
    // `h` out of its own temporal dead zone and survives only on the timing of the
    // first report. The second argument makes it a property of the signature.
    const clock = testClock()
    clock.at = 1_712_000_000_000
    const seen = []
    const handle = start(chain().graph, {
      confirmed: confirmedReport(),
      clock,
      onProgress: (at, run) => seen.push(run),
    })
    await handle.completed

    expect(seen).toHaveLength(3)
    for (const run of seen) {
      expect(run).toEqual({ id: handle.id, startedAt: handle.startedAt })
    }
  })

  it('never reports before it has handed back the handle', async () => {
    // The contract the second argument makes unnecessary, kept on its own terms: a
    // caller that has not been given its handle cannot cancel, cannot compare
    // generations, and cannot tell which run is reporting.
    let reportedBeforeReturn = false
    let returned = false
    const handle = start(chain().graph, {
      confirmed: confirmedReport(),
      onProgress: () => {
        if (!returned) reportedBeforeReturn = true
      },
    })
    returned = true

    await handle.completed
    expect(reportedBeforeReturn).toBe(false)
  })

  it('yields once per Step and not once per run', async () => {
    // The whole affordance rests on this: exit latency is one Step (AD-9), which
    // is only true if the driver comes back to the queue between every pair.
    const yielder = handYield()
    const handle = start(chain().graph, { confirmed: confirmedReport(), yielder })

    await settle()
    expect(yielder.pending()).toBe(1) // waiting in front of the Source
    await yielder.release()
    expect(yielder.pending()).toBe(1) // …and in front of the Filter
    await yielder.release(2)

    expect((await handle.completed).run.state).toBe('complete')
  })
})

describe('what the first `next()` costs (story 7b, review round 1)', () => {
  // **The assertion that would have caught the defect that got this story
  // reverted.** `startRun` drains the walk's gates synchronously, which is right —
  // a refusal must not arrive a turn of the queue later than it did before. What
  // was wrong is what the gate asked: `sourceTable(id) === null`, where in the
  // pane that door *converts* a Source at 548–555 ms apiece. So the first act of
  // an asynchronous, cancellable, progress-reporting run was an uncancellable,
  // unreported half second per Source. The e2e case could not see it because the
  // Sources pane warms the same conversion before the Editor mounts.

  /** A `sourceTable` that counts. The count is the whole assertion. */
  const counting = () => {
    const calls = []
    return { calls, door: (id) => (calls.push(id), REPORT()) }
  }

  it('converts nothing before the run has yielded once', () => {
    const { graph } = chain()
    const table = counting()
    const yielder = handYield()
    const handle = start(graph, {
      yielder,
      sourceTable: table.door,
      sourceConfirmed: () => true,
    })

    // Synchronously, at the moment `startRun` returned: the gates have run and
    // nothing has been converted.
    expect(table.calls).toEqual([])
    expect(handle.id).toBeTruthy()
  })

  it('converts at the Source’s node, one yield in, where a cancel can still stop it', async () => {
    const { graph } = chain()
    const table = counting()
    const yielder = handYield()
    const handle = start(graph, {
      yielder,
      sourceTable: table.door,
      sourceConfirmed: () => true,
    })

    await settle()
    expect(table.calls).toEqual([]) // waiting in front of the Source
    handle.cancel()
    await yielder.release()

    // Cancelled *before* Step zero, which is the thing that was impossible until
    // the gate stopped asking for a table.
    expect((await handle.completed).run.state).toBe('cancelled')
    expect(table.calls).toEqual([])
  })

  it('pays it in the gates when no predicate is passed, which is what the predicate removes', async () => {
    // The other side of the same fact, so that deleting `sourceConfirmed` from the
    // pane turns a case red rather than only making the product slower.
    const { graph } = chain()
    const table = counting()
    const yielder = handYield()
    const handle = start(graph, { yielder, sourceTable: table.door })

    expect(table.calls).toEqual(['src:umsatz'])
    handle.cancel()
    await yielder.release()
    await handle.completed
  })
})

describe('a run that is cancelled', () => {
  it('stops before the next Step begins and says so', async () => {
    const { graph } = chain()
    const engine = countingEngine()
    const yielder = handYield()
    const handle = start(graph, { confirmed: confirmedReport(), yielder, engine })

    await yielder.release() // the Source is done; the Filter is waiting to start
    handle.cancel()
    await yielder.release()

    const out = await handle.completed
    expect(out.run.state).toBe('cancelled')
    // The Filter never ran, which is what "stops before the next Step begins"
    // means — the check is at the yield, in front of the Step, not behind it.
    expect(engine.calls.filter).toBe(0)
  })

  it('publishes nothing at all, and one diagnostic naming how far it got', async () => {
    // A partly computed graph presented as the current result — some Steps new,
    // some old, nothing saying which — is the failure this product exists to
    // prevent. So a cancelled run's results are empty and the caller keeps showing
    // what it was showing.
    const { graph } = chain()
    const yielder = handYield()
    const handle = start(graph, { confirmed: confirmedReport(), yielder })

    await yielder.release(2) // Source and Filter done, Columns waiting
    handle.cancel()
    await yielder.release()

    const out = await handle.completed
    expect(out.results.size).toBe(0)
    expect(out.diagnostics).toHaveLength(1)
    expect(out.diagnostics[0]).toMatchObject({
      severity: 'info',
      code: CODE.runCancelled,
      values: { done: 2, total: 3 },
    })
    // About the run, not about the Step it stopped in front of: a mark on that
    // Step's card would read as something wrong with the Step.
    expect(out.diagnostics[0].stepId).toBeUndefined()
  })

  it('keeps its identity, so a caller can tell which run it was that stopped', async () => {
    const clock = testClock()
    const yielder = handYield()
    const handle = start(chain().graph, { confirmed: confirmedReport(), yielder, clock })

    handle.cancel()
    await yielder.release()

    expect((await handle.completed).run).toEqual({
      id: handle.id,
      startedAt: handle.startedAt,
      state: 'cancelled',
    })
  })

  it('leaves every Step that finished in the cache, so the next run picks up there', async () => {
    // **The reason story 7a came first.** Without it, cancelling would cost more
    // than waiting and nobody would use it twice.
    const { graph } = chain()
    const cache = createRunCache()
    const sourceKey = () => 'k:src'
    const first = countingEngine()
    const yielder = handYield()

    const stopped = start(graph, {
      confirmed: confirmedReport(),
      yielder,
      engine: first,
      cache,
      sourceKey,
    })
    await yielder.release(2) // Source and Filter done, Columns waiting
    stopped.cancel()
    await yielder.release()
    expect((await stopped.completed).run.state).toBe('cancelled')
    expect(first.calls).toEqual({ filter: 1, selectColumns: 0 })

    const second = countingEngine()
    const out = await start(graph, {
      confirmed: confirmedReport(),
      engine: second,
      cache,
      sourceKey,
    }).completed

    expect(out.run.state).toBe('complete')
    // The Filter is served from the entry the cancelled run left behind; only the
    // Step that never ran runs now.
    expect(second.calls).toEqual({ filter: 0, selectColumns: 1 })
    expect(out.results.get(graph.resultId())).toMatchObject({ rowCount: 4, columnCount: 1 })
  })

  it('can be cancelled before it has computed anything', async () => {
    const { graph } = chain()
    const engine = countingEngine()
    const yielder = handYield()
    const handle = start(graph, { confirmed: confirmedReport(), yielder, engine })

    handle.cancel()
    await yielder.release()

    const out = await handle.completed
    expect(out.run.state).toBe('cancelled')
    expect(out.diagnostics[0].values).toEqual({ done: 0, total: 3 })
    expect(engine.calls).toEqual({ filter: 0, selectColumns: 0 })
  })

  it('takes a cancel after it has finished without changing what it answered', async () => {
    const handle = start(chain().graph, { confirmed: confirmedReport() })
    const out = await handle.completed
    handle.cancel()

    expect(out.run.state).toBe('complete')
    expect(await handle.completed).toBe(out)
  })
})

describe('what cancellation is not', () => {
  it('is not what a throwing Step produces — the run carries on and completes', async () => {
    // A throw is a diagnostic about one Step and never a cancellation. The
    // distinction matters because the two would otherwise be indistinguishable to
    // a caller that only reads `run.state`.
    const { graph, filter } = chain()
    const engine = {
      ...realEngine,
      filter: () => {
        throw new Error('an invariant guard that was supposed to be unreachable')
      },
    }
    const out = await start(graph, { confirmed: confirmedReport(), engine }).completed

    expect(out.run.state).toBe('complete')
    expect(out.diagnostics.map((d) => d.code)).toContain(CODE.stepThrew)
    expect(out.diagnostics.map((d) => d.code)).not.toContain(CODE.runCancelled)
    expect(out.results.get(filter).table).toBeNull()
  })

  it('is not what a gate does — a refusal is refused before the first yield', async () => {
    // AD-29's gate 1. It runs inside `startRun` itself, so it does not wait for a
    // turn of the queue: nothing about the run being asynchronous makes a refusal
    // arrive later than it did.
    const { graph } = chain()
    const yielder = handYield()
    const handle = start(graph, { yielder }) // nothing confirmed

    const out = await handle.completed
    expect(out.ok).toBe(false)
    expect(out.run.state).toBe('refused')
    expect(out.diagnostics.map((d) => d.code)).toEqual([CODE.sourceUnconfirmed])
    // Not one yield was asked for, which is what "before the first" means.
    expect(yielder.pending()).toBe(0)
  })

  it('leaves a refused run carrying its identity all the same', async () => {
    // AD-25 says *every* run has an id and a start time, and a refusal is a run
    // that happened. A compliance artifact that cannot say when a run was refused
    // is not one.
    const clock = testClock()
    clock.at = 1_712_000_000_777
    const handle = start(chain().graph, { clock })

    expect((await handle.completed).run).toEqual({
      id: 'run:1',
      startedAt: 1_712_000_000_777,
      state: 'refused',
    })
  })

  it('costs no yield at all for a graph with no Result Step', async () => {
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:umsatz', name: 'Umsatz' }])
    const yielder = handYield()
    const handle = start(graph, { confirmed: confirmedReport(), yielder })

    const out = await handle.completed
    expect(out.run.state).toBe('complete')
    expect(out.results.size).toBe(0)
    expect(yielder.pending()).toBe(0)
  })
})
