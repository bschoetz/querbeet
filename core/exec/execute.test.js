// The frontier walk and its gates, in the node envelope (AD-27).
//
// The graph store is the real one — the executor reads its frozen projection and
// a stub would be a second opinion about what a projection is — and so is the
// engine, reached the way `convert.test.js` reaches it, through a dynamic import
// so no static import points from `core/` outward (AD-1).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CODE, executeGraph, walkGraph } from './execute.js'
import { createRunCache } from './cache.js'
import { canonical, forgetRefusals, keyOrNull, sourceKey, stepKey } from './cache-key.js'
import { createGraphStore } from '../graph/graph-store.js'

const { createArqueroEngine } = await import('../../adapters/arquero/engine.js')

const engine = createArqueroEngine()

const typed = (columns) =>
  engine.fromColumns(
    columns.map((c) => ({
      name: c.name,
      type: c.type ?? 'text',
      values: [...c.values],
      unparsed: Object.freeze(c.unparsed ?? []),
    })),
  )

const REPORT = () =>
  typed([
    { name: 'Kunde', values: ['Anna', 'Bernd', 'Carla', 'Dora'] },
    { name: 'Betrag', type: 'number', values: [1000, 500, 1000, 250] },
  ])

/**
 * A graph plus the Sources that are confirmed.
 *
 * `confirmed` is the set of Source ids Step zero can answer for; everything else
 * answers `null`, which as of this story means exactly one thing — the typing is
 * not confirmed.
 */
function run(graph, confirmed = new Map()) {
  return executeGraph({
    steps: graph.list(),
    resultId: graph.resultId(),
    engine,
    sourceTable: (id) => confirmed.get(id) ?? null,
  })
}

const codesOf = (diagnostics) => diagnostics.map((d) => d.code)

/** Source → Filter → Columns, the chain the story is a skeleton for. */
function chain() {
  const graph = createGraphStore()
  graph.syncSources([{ id: 'src:umsatz', name: 'Umsatz' }])
  const filter = graph.addStep('filter', { name: 'Nur Große' }).id
  const columns = graph.addStep('columns', { name: 'Nur Kunde' }).id
  graph.connect('src:umsatz', filter, 0)
  graph.connect(filter, columns, 0)
  graph.setResult(columns)
  return { graph, filter, columns }
}

describe('the frontier', () => {
  it('runs every contributing Step and reports each one’s own counts', () => {
    const { graph, filter, columns } = chain()
    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 1000 }],
    })
    graph.configureStep(columns, { columns: [{ from: 'Kunde', to: 'Name' }] })

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(out.ok).toBe(true)
    // CAP-19: the row and column count of each Step's *full* output.
    expect(out.results.get('src:umsatz')).toMatchObject({ rowCount: 4, columnCount: 2 })
    expect(out.results.get(filter)).toMatchObject({ rowCount: 2, columnCount: 2 })
    expect(out.results.get(columns)).toMatchObject({ rowCount: 2, columnCount: 1 })
    expect(out.results.get(columns).table.schema()).toEqual([{ name: 'Name', type: 'text' }])
  })

  it('walks inputs before consumers, whatever order the Steps were added in', () => {
    const { graph, filter, columns } = chain()
    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    // The Columns Step ran after the Filter, so it saw a table rather than a
    // missing input — which is the whole of what "dependency order" buys.
    expect(out.results.get(columns).table).not.toBeNull()
    expect(out.results.get(filter).table).not.toBeNull()
  })

  it('touches nothing outside the frontier', () => {
    const { graph, columns } = chain()
    const orphan = graph.addStep('filter', { name: 'Nebenweg' }).id

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(out.results.has(orphan)).toBe(false)
    expect(out.results.has(columns)).toBe(true)
  })

  it('visits a Step feeding two consumers once', () => {
    // **A real diamond**, which the previous version of this case did not have —
    // it built a linear chain and asserted a key set, which any traversal
    // satisfies whether or not `inDependencyOrder` de-duplicates anything.
    //
    // The Step this story can *execute* takes one input, so the only way to
    // close a diamond today is a Union — and a Union in the frontier refuses the
    // run before the walk executes anything (stories 8 and 9 give it an
    // executor). What is still observable is the visit count, because the gate
    // pass emits one diagnostic **per contributing node**: without the `seen`
    // set, `src:a` is reached down both arms and would be named twice.
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:a', name: 'A' }])
    const left = graph.addStep('filter', { name: 'Links' }).id
    const right = graph.addStep('columns', { name: 'Rechts' }).id
    const union = graph.addStep('union', { name: 'Zusammen' }).id
    graph.connect('src:a', left, 0)
    graph.connect('src:a', right, 0)
    graph.connect(left, union, 0)
    graph.connect(right, union, 1)
    graph.setResult(union)

    const out = run(graph) // src:a unconfirmed, so gate 1 names it
    const named = out.diagnostics.filter((d) => d.code === CODE.sourceUnconfirmed)

    expect(named).toHaveLength(1)
    expect(named[0].values.id).toBe('src:a')
    expect(out.diagnostics.filter((d) => d.code === CODE.kindNotExecutable)).toHaveLength(1)
  })

  it('runs a shared upstream once for two consumers, counted at the executor', () => {
    // The other half of the same property, where it *can* be counted: one
    // Columns Step feeding two Filters, one of which is the Result. The shared
    // Step is applied once, not once per path that reaches it.
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:a', name: 'A' }])
    const shared = graph.addStep('columns', { name: 'Geteilt' }).id
    const one = graph.addStep('filter', { name: 'Eins' }).id
    graph.connect('src:a', shared, 0)
    graph.connect(shared, one, 0)
    graph.setResult(one)

    let applied = 0
    const counting = {
      ...engine,
      selectColumns: (...args) => {
        applied += 1
        return engine.selectColumns(...args)
      },
    }
    graph.configureStep(shared, { columns: [{ from: 'Kunde', to: 'Kunde' }] })

    executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine: counting,
      sourceTable: () => REPORT(),
    })

    expect(applied).toBe(1)
  })

  it('says nothing at all when no Step is designated as the Result', () => {
    // `graph.no_result` already names that state once, on the pane. A second
    // sentence here would say the same thing in a different place.
    const graph = createGraphStore()
    graph.addStep('filter', { name: 'Nur Große' })
    graph.removeStep(graph.list()[0].id)

    const out = run(graph)
    expect(out).toMatchObject({ ok: true, diagnostics: [] })
    expect(out.results.size).toBe(0)
  })
})

describe('gate 1 — no run over an unconfirmed Source (AD-29)', () => {
  it('refuses the run naming the Source, and executes nothing at all', () => {
    const { graph, filter } = chain()

    const out = run(graph)

    expect(out.ok).toBe(false)
    expect(out.results.size).toBe(0)
    expect(out.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: CODE.sourceUnconfirmed,
      values: { id: 'src:umsatz' },
      stepId: 'src:umsatz',
    })
    // Not even the Steps that would have been fine — a partial answer that looks
    // complete is worse than none.
    expect(out.results.has(filter)).toBe(false)
  })

  it('names every unconfirmed Source, so the user makes one trip and not two', () => {
    const graph = createGraphStore()
    graph.syncSources([
      { id: 'src:a', name: 'A' },
      { id: 'src:b', name: 'B' },
    ])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id
    graph.connect('src:a', union, 0)
    graph.connect('src:b', union, 1)
    graph.setResult(union)

    const out = run(graph)
    expect(out.diagnostics.filter((d) => d.code === CODE.sourceUnconfirmed)).toHaveLength(2)
  })

  it('opens the moment the Source is confirmed, with nothing else changed', () => {
    const { graph, columns } = chain()
    expect(run(graph).ok).toBe(false)

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))
    expect(out.ok).toBe(true)
    expect(out.results.get(columns).rowCount).toBe(4)
  })
})

describe('a kind with no executor', () => {
  it('refuses the run naming the Step and its kind, and never crashes', () => {
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:a', name: 'A' }])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id
    graph.connect('src:a', union, 0)
    graph.connect('src:a', union, 1)
    graph.setResult(union)

    const out = run(graph, new Map([['src:a', REPORT()]]))

    expect(out.ok).toBe(false)
    expect(out.results.size).toBe(0)
    expect(out.diagnostics[0]).toMatchObject({
      code: CODE.kindNotExecutable,
      values: { id: union, kind: 'union' },
    })
  })

  it('is not a gate for a Union outside the frontier', () => {
    const { graph, columns } = chain()
    graph.addStep('union', { name: 'Ungenutzt' })

    expect(run(graph, new Map([['src:umsatz', REPORT()]])).ok).toBe(true)
    expect(run(graph, new Map([['src:umsatz', REPORT()]])).results.has(columns)).toBe(true)
  })
})

describe('a Step that produced nothing', () => {
  it('lets each downstream Step report its missing input by name', () => {
    // The type disagreement is a *Step* error, not a gate: the run happens, the
    // Filter produces no table, and the Steps after it say whose output they
    // were waiting for. Stopping the whole pipeline over one badly typed
    // comparison would be the gate's behaviour applied to the wrong thing.
    const { graph, filter, columns } = chain()
    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 'tausend' }],
    })

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(out.ok).toBe(true)
    expect(out.results.get(filter).table).toBeNull()
    expect(out.results.get(columns).table).toBeNull()
    expect(out.results.get(columns).diagnostics[0]).toMatchObject({
      code: CODE.inputFailed,
      values: { id: columns, slot: 0, upstream: filter },
    })
  })

  it('reports an empty slot as missing rather than as a failure upstream', () => {
    const { graph, filter } = chain()
    graph.disconnect(filter, 0)

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(codesOf(out.results.get(filter).diagnostics)).toEqual([CODE.inputMissing])
    expect(out.results.get(filter).rowCount).toBeNull()
    expect(out.results.get(filter).columnCount).toBeNull()
  })

  it('reports a slot still pointing at a Step that is gone', () => {
    // CAP-12 keeps the dangling reference in the slot; the executor must name it
    // rather than walk into a node that is not there.
    const { graph, filter, columns } = chain()
    graph.removeStep(filter)

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))
    expect(codesOf(out.results.get(columns).diagnostics)).toEqual([CODE.inputMissing])
  })
})

describe('a Step whose executor throws', () => {
  /** A graph whose one executable Step is handed an engine that throws. Every
   *  guard behind `apply` is an invariant guard, so this is how one arrives. */
  const withThrowingEngine = () => {
    const { graph, filter, columns } = chain()
    const throwing = {
      ...engine,
      filter: () => {
        throw new TypeError('a table cannot hold two columns called Betrag')
      },
    }
    return {
      out: executeGraph({
        steps: graph.list(),
        resultId: graph.resultId(),
        engine: throwing,
        sourceTable: () => REPORT(),
      }),
      filter,
      columns,
    }
  }

  it('records it as a Diagnostic rather than letting it escape the run', () => {
    // Both callers of `executeGraph` are on a render path, so a throw that
    // escapes reaches the user as a blank Editor — which is worse than the state
    // the invariant guard exists to prevent.
    let out
    expect(() => {
      out = withThrowingEngine().out
    }).not.toThrow()

    expect(out.ok).toBe(true)
    expect(out.diagnostics.some((d) => d.code === CODE.stepThrew)).toBe(true)
  })

  it('names the Step and its kind, and lets the walk continue past it', () => {
    const { out, filter, columns } = withThrowingEngine()

    expect(out.results.get(filter)).toMatchObject({ table: null, rowCount: null })
    expect(out.results.get(filter).diagnostics[0]).toMatchObject({
      severity: 'error',
      code: CODE.stepThrew,
      values: { id: filter, kind: 'filter' },
      stepId: filter,
    })
    // The Step downstream is still visited and reports its missing input by
    // name, exactly as it does for every other reason a Step produces no table.
    expect(out.results.get(columns).diagnostics[0]).toMatchObject({
      code: CODE.inputFailed,
      values: { upstream: filter },
    })
  })
})

describe('what the run says about itself', () => {
  it('names a run that produced no result, without a stepId, so it is not a card mark', () => {
    // The cards deliberately do not carry the run's marks — they are full
    // sentences and a card wearing two of them overlaps the one below it — so a
    // user with nothing selected would otherwise see a pipeline that computed
    // nothing and no reason anywhere on screen.
    const { graph, filter } = chain()
    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 'tausend' }],
    })

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))
    const whole = out.diagnostics.filter((d) => d.stepId === undefined)

    expect(whole).toHaveLength(1)
    expect(whole[0]).toMatchObject({
      code: CODE.runIncomplete,
      values: { id: filter, steps: 2 },
    })
  })

  it('says nothing about itself when every Step produced a table', () => {
    const { graph } = chain()
    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(out.diagnostics.filter((d) => d.stepId === undefined)).toEqual([])
  })
})

describe('what the run carries out of a Step', () => {
  it('stamps every Step diagnostic with the Step it came from', () => {
    // A Step kind is handed an engine, inputs and a config and nothing else
    // (AD-4), so it cannot know which Step it is. The origin is stamped once,
    // here, and the marks can then be routed to the card they belong to.
    const { graph, filter } = chain()
    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'gt', value: 600 }],
    })

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))
    for (const d of out.results.get(filter).diagnostics) expect(d.stepId).toBe(filter)
    expect(out.diagnostics.some((d) => d.stepId === filter)).toBe(true)
  })

  it('holds tables and stays frozen, so a caller can swap it as one value (AD-6)', () => {
    const { graph } = chain()
    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(Object.isFrozen(out)).toBe(true)
    expect(Object.isFrozen(out.diagnostics)).toBe(true)
    expect(Object.isFrozen(out.results.get('src:umsatz'))).toBe(true)
  })

  it('hands out a results map a caller cannot write to', () => {
    // `Object.freeze` does nothing to a `Map` — `set` and `delete` go on working
    // — so freezing one is a promise the object does not keep. Every other
    // projection in this codebase freezes what it hands out; this is the same
    // guarantee in the one shape `Object.freeze` cannot give.
    const { graph } = chain()
    const out = run(graph, new Map([['src:umsatz', REPORT()]]))

    expect(Object.isFrozen(out.results)).toBe(true)
    expect(out.results.set).toBeUndefined()
    expect(out.results.delete).toBeUndefined()
    // …and it still answers every read the callers make.
    expect(out.results.size).toBeGreaterThan(0)
    expect([...out.results.keys()]).toContain('src:umsatz')
    expect([...out.results.values()].every((r) => r !== undefined)).toBe(true)
  })

  it('uses a kind’s default config where the Step has none', () => {
    const { graph, filter, columns } = chain()
    expect(graph.get(filter).config).toBeNull()

    const out = run(graph, new Map([['src:umsatz', REPORT()]]))
    // No condition and no chosen column: both identities, so the Result is the
    // Source. That is what makes a half-built pipeline readable while it is
    // being built.
    expect(out.results.get(columns).rowCount).toBe(4)
    expect(out.results.get(columns).columnCount).toBe(2)
  })
})

// ------------------------------------------------ AD-8's per-Step cache (7a)
//
// A cached run and an uncached run must be indistinguishable except in time, so
// every case below is either "nothing was computed" — counted at the engine,
// because a cache that cannot be observed to hit is a cache nobody can trust —
// or "what came back is what came back the first time", diagnostics included.

describe('the per-Step cache', () => {
  // A refusal is warned about once per distinct message and the log is module
  // state, so a case that counts warnings must not depend on which case ran
  // before it. In a hook rather than in the cases that happen to need it today:
  // five hand-written calls were the round-2 shape, and the sixth case to need
  // one would have passed on its position in the file (review round 3).
  beforeEach(forgetRefusals)

  /** The real engine with its two verbs counted. A stub would be a second
   *  opinion about what a Step produces; what is under test is how often. */
  const countingEngine = () => {
    const calls = { filter: 0, selectColumns: 0 }
    return {
      ...engine,
      calls,
      filter: (...args) => {
        calls.filter += 1
        return engine.filter(...args)
      },
      selectColumns: (...args) => {
        calls.selectColumns += 1
        return engine.selectColumns(...args)
      },
    }
  }

  /**
   * A run against a cache, with the Source's key handed in as a plain string.
   *
   * The key is a *parameter of the test* rather than something derived here, and
   * that is the point of the seam: `executeGraph` asks what a Source is and does
   * not know how the answer is computed. Changing `sourceKey` between two runs is
   * exactly what a re-parse looks like from in here.
   */
  const runCached = (graph, { cache, engine: e, sourceKey = () => 'src-key-1', table }) =>
    executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine: e,
      sourceTable: () => table ?? REPORT(),
      cache,
      sourceKey,
    })

  /** The chain, configured, so both Steps do real work worth not repeating. */
  const configured = (value = 1000) => {
    const { graph, filter, columns } = chain()
    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value }],
    })
    graph.configureStep(columns, { columns: [{ from: 'Kunde', to: 'Name' }] })
    return { graph, filter, columns }
  }

  it('computes nothing on a repeat run with nothing changed', () => {
    const { graph } = configured()
    const cache = createRunCache()
    const e = countingEngine()

    runCached(graph, { cache, engine: e })
    expect(e.calls).toEqual({ filter: 1, selectColumns: 1 })

    runCached(graph, { cache, engine: e })
    expect(e.calls).toEqual({ filter: 1, selectColumns: 1 })
  })

  it('gives the repeat run the same rows, counts and diagnostics — in order and stamped', () => {
    // The acceptance criterion this whole story exists for: a repeat run must
    // never report clean over a warning it did not re-emit (C-10). The Filter
    // removes rows and says so, and that sentence has to be in the second run's
    // stream exactly as it was in the first's.
    const { graph, filter } = configured()
    const cache = createRunCache()
    const e = countingEngine()

    const first = runCached(graph, { cache, engine: e })
    const second = runCached(graph, { cache, engine: e })

    expect(first.results.get(filter).diagnostics.length).toBeGreaterThan(0)
    expect(second.diagnostics).toEqual(first.diagnostics)
    expect(second.results.get(filter).diagnostics).toEqual(first.results.get(filter).diagnostics)
    for (const d of second.results.get(filter).diagnostics) expect(d.stepId).toBe(filter)
    expect([...second.results.get(filter).table.rows()]).toEqual([
      ...first.results.get(filter).table.rows(),
    ])
    expect(second.results.get(filter).rowCount).toBe(first.results.get(filter).rowCount)
  })

  it('hits again when a config comes back to a value it already had', () => {
    const { graph, filter } = configured(1000)
    const cache = createRunCache()
    const e = countingEngine()

    runCached(graph, { cache, engine: e })
    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 500 }],
    })
    runCached(graph, { cache, engine: e })
    expect(e.calls.filter).toBe(2)

    graph.configureStep(filter, {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 1000 }],
    })
    const back = runCached(graph, { cache, engine: e })

    expect(e.calls.filter).toBe(2) // the third state is the first state
    expect(back.results.get(filter).rowCount).toBe(2)
  })

  it('computes nothing at all after a rename and a move', () => {
    // The interim recompute rule already refuses to run for either
    // (`ui/EditorPane.test.js`), and the cache must not weaken that from
    // underneath: a name and a position are not in a key, so a run issued for
    // any other reason still finds every Step waiting for it.
    const { graph, filter, columns } = configured()
    const cache = createRunCache()
    const e = countingEngine()

    runCached(graph, { cache, engine: e })
    graph.renameStep(filter, 'Ganz andere Zeilen')
    graph.moveStep(columns, 640, 480)
    runCached(graph, { cache, engine: e })

    expect(e.calls).toEqual({ filter: 1, selectColumns: 1 })
  })

  it('misses at every Step downstream when the Source was re-parsed', () => {
    // The id did not change and must not decide. A delimiter correction changes
    // what `key(source)` is, and every key below it is built out of that one.
    const { graph, columns } = configured()
    const cache = createRunCache()
    const e = countingEngine()

    runCached(graph, { cache, engine: e, sourceKey: () => 'before-the-delimiter-was-fixed' })
    const after = runCached(graph, {
      cache,
      engine: e,
      sourceKey: () => 'after-the-delimiter-was-fixed',
    })

    expect(e.calls).toEqual({ filter: 2, selectColumns: 2 })
    expect(after.results.get(columns).rowCount).toBe(2)
  })

  it('treats a Step configured to its kind’s own default as unchanged', () => {
    // `node.config ?? kind.defaultConfig()` is the trap: keying the raw field
    // would make the first `configureStep` that writes the default look like a
    // change and recompute a Step whose output is provably identical.
    const { graph, filter } = chain()
    const cache = createRunCache()
    const e = countingEngine()

    expect(graph.get(filter).config).toBeNull()
    runCached(graph, { cache, engine: e })
    expect(e.calls.filter).toBe(1)

    graph.configureStep(filter, { combine: 'all', conditions: [] })
    runCached(graph, { cache, engine: e })

    expect(e.calls.filter).toBe(1)
  })

  it('recomputes an evicted Step to an identical result', () => {
    // An eviction is a miss and never a wrong answer, which is the property that
    // makes a bound safe to pick without knowing the graph.
    const { graph, filter, columns } = configured()
    const tiny = createRunCache({ maxRows: 1 })
    const e = countingEngine()

    const first = runCached(graph, { cache: tiny, engine: e })
    // The Filter's insert evicts **nothing** — eviction stops at one entry, so an
    // entry over the bound stands alone rather than being refused. It is the
    // Columns insert that pushes the size to two and evicts the Filter, so the
    // survivor is Columns.
    expect(tiny.size()).toBe(1)
    expect(e.calls).toEqual({ filter: 1, selectColumns: 1 })
    const second = runCached(graph, { cache: tiny, engine: e })

    // **Both counters, because both are the claim.** `filter: 2` says the Filter
    // did not survive run 1 — had the survivor been the Filter instead of Columns
    // it would have hit and stayed at 1. `selectColumns: 2` says Columns did not
    // survive run 2 either: recomputing the Filter re-stores it, which evicts
    // Columns in turn. A bound that fits one entry over a two-entry chain
    // thrashes, and thrashing is a miss and never a wrong answer — which is the
    // rest of this case.
    expect(e.calls).toEqual({ filter: 2, selectColumns: 2 })
    expect(second.results.get(filter).rowCount).toBe(first.results.get(filter).rowCount)
    expect(second.results.get(filter).diagnostics).toEqual(first.results.get(filter).diagnostics)
    expect([...second.results.get(columns).table.rows()]).toEqual([
      ...first.results.get(columns).table.rows(),
    ])
  })

  it('stores nothing for a Step that threw, so the next run says the same thing', () => {
    const { graph, filter } = configured()
    const cache = createRunCache()
    let thrown = 0
    const throwing = {
      ...engine,
      filter: () => {
        thrown += 1
        throw new TypeError('a table cannot hold two columns called Betrag')
      },
    }

    const first = runCached(graph, { cache, engine: throwing })
    const second = runCached(graph, { cache, engine: throwing })

    expect(thrown).toBe(2)
    expect(cache.size()).toBe(0)
    expect(codesOf(second.results.get(filter).diagnostics)).toEqual([CODE.stepThrew])
    expect(second.results.get(filter).diagnostics).toEqual(first.results.get(filter).diagnostics)
  })

  it('neither reads nor writes when a gate refuses the run', () => {
    const { graph } = configured()
    const cache = createRunCache()

    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => null, // unconfirmed: gate 1 refuses
      cache,
      sourceKey: () => 'src-key-1',
    })

    expect(out.ok).toBe(false)
    expect(cache.size()).toBe(0)
  })

  it.each([
    ['a serializer refusal', () => canonical({ at: new Date(0) })],
    ['its own documented guard', () => sourceKey({ parseConfig: null, encoding: null })],
    ['a plain Error', () => { throw new Error('the door had its own opinion') }],
    ['a RangeError', () => { throw new RangeError('out of range') }],
    ['something that is not an Error at all', () => { throw { why: 'a bare object' } }],
  ])('contains a `sourceKey` door that throws %s', (_what, door) => {
    // **A door is foreign code on a render path, so everything it throws is
    // contained** — which is a different rule from the one the `stepKey` call
    // beside it follows, and rounds 1 and 2 pushed the same site both ways.
    // Round 1 wrapped it; round 2 narrowed the wrapper to `CanonicalRefusal`
    // only, which reopened the crash for every class except the one the case
    // was written with. This is that case, widened to the classes that were
    // actually escaping.
    const { graph, columns } = configured()
    const cache = createRunCache()
    const e = countingEngine()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let out
      expect(() => {
        out = runCached(graph, { cache, engine: e, sourceKey: door })
      }).not.toThrow()

      // The run is the run it would have been with no cache at all.
      expect(out.ok).toBe(true)
      expect(out.results.get(columns).rowCount).toBe(2)
      expect(cache.size()).toBe(0)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('still lets an internal caller bug propagate — the other boundary', () => {
    // The narrow rule, which the door rule must not have replaced: inside this
    // repository a non-refusal is a programming error and has to reach whoever
    // can fix it. `keyOrNull` is what the `stepKey` call uses and it rethrows.
    expect(() => keyOrNull(() => stepKey('filter', {}, [null]))).toThrow(/key for every input/)
  })

  it('caches nothing below a Source it cannot key, rather than guessing one', () => {
    const { graph } = configured()
    const cache = createRunCache()
    const e = countingEngine()

    runCached(graph, { cache, engine: e, sourceKey: () => null })
    runCached(graph, { cache, engine: e, sourceKey: () => null })

    expect(cache.size()).toBe(0)
    expect(e.calls).toEqual({ filter: 2, selectColumns: 2 })
  })

  it('stores nothing for a Step that returned no table, exactly as for one that threw', () => {
    // The rule is about the entry, not about which failure path produced it: an
    // entry with no table is not a result to replay. `columns` naming a column
    // its input does not have returns `{ table: null }` rather than throwing, and
    // it was being stored until review round 1.
    const { graph, filter, columns } = configured()
    graph.configureStep(columns, { columns: [{ from: 'Gibtsnicht', to: 'X' }] })
    const cache = createRunCache()
    const e = countingEngine()

    const first = runCached(graph, { cache, engine: e })
    const second = runCached(graph, { cache, engine: e })

    expect(first.results.get(columns).table).toBeNull()
    expect(cache.size()).toBe(1) // the Filter's entry, and only that
    expect(e.calls.selectColumns).toBe(0) // it refused before reaching the engine
    expect(second.results.get(columns).diagnostics).toEqual(
      first.results.get(columns).diagnostics,
    )
    expect(second.results.get(filter).rowCount).toBe(2) // the Step above it still hits
  })

  it('runs a config the serializer refuses exactly as it runs without a cache', () => {
    // **The frozen rule, at its sharpest.** `core/steps/first.js` admits an
    // explicitly-`undefined` `end` by construction, and `canonical` refuses
    // `undefined` by construction — both correct, and until review round 1 the
    // disagreement threw `TypeError` out of `executeGraph` and, through the
    // `watch` that calls it, out of the Editor's render. A cached run and an
    // uncached run must be indistinguishable except in time.
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:umsatz', name: 'Umsatz' }])
    const first = graph.addStep('first', { name: 'Die ersten drei' }).id
    graph.connect('src:umsatz', first, 0)
    graph.setResult(first)
    expect(graph.configureStep(first, { count: 3, end: undefined }).ok).toBe(true)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const uncached = executeGraph({
        steps: graph.list(),
        resultId: graph.resultId(),
        engine,
        sourceTable: () => REPORT(),
      })
      const cache = createRunCache()
      const cached = runCached(graph, { cache, engine })

      expect(uncached.results.get(first).rowCount).toBe(3)
      expect(cached.results.get(first).rowCount).toBe(3)
      expect(cached.diagnostics).toEqual(uncached.diagnostics)
      expect(cache.size()).toBe(0) // unkeyable, so uncached — and not wrong

      // Not swallowed: the one signal here that means a programming or format
      // error rather than a cold entry, and it names the path.
      expect(warn).toHaveBeenCalled()
      expect(warn.mock.calls[0][0]).toMatch(/cannot serialize undefined at \$step\.config\.end/)
    } finally {
      warn.mockRestore()
    }
  })

  it('computes every Step when there is no cache — the parameter is a door, not a mode', () => {
    const { graph } = configured()
    const e = countingEngine()

    executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine: e,
      sourceTable: () => REPORT(),
    })
    executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine: e,
      sourceTable: () => REPORT(),
    })

    expect(e.calls).toEqual({ filter: 2, selectColumns: 2 })
  })
})

// ------------------------------------------------ one walk, two drivers (7b)
//
// The Step loop is a generator now and `executeGraph` drains it in a `while`. Two
// things have to stay true or the split was not worth making: the synchronous
// driver has to answer exactly what it answered before — which is what every case
// above this line already asserts, unchanged — and the generator has to be
// drainable one Step at a time by somebody else, which is what
// `core/exec/scheduler.js` does and `core/exec/scheduler.test.js` pins.

describe('the walk as a generator', () => {
  it('yields once per contributing Step, before that Step is touched', () => {
    const { graph, filter, columns } = chain()
    const walk = walkGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
    })

    const yielded = []
    let step = walk.next()
    while (!step.done) {
      yielded.push(step.value)
      step = walk.next()
    }

    // The kind rides along because the order contains Quellen as well as Steps,
    // and a caller that renders „Step" off `stepId` alone is wrong about a third
    // of what it names (story 7b, review round 1).
    expect(yielded).toEqual([
      { done: 0, total: 3, stepId: 'src:umsatz', kind: 'source' },
      { done: 1, total: 3, stepId: filter, kind: 'filter' },
      { done: 2, total: 3, stepId: columns, kind: 'columns' },
    ])
    expect(step.value.results.size).toBe(3)
  })

  it('leaves nothing behind for a Step it never reached', () => {
    // **The trap story 7a set for this story, named in the spec's Code Map.** The
    // loop mints and stores content keys as well as results, so a yield placed
    // carelessly would land between a Step's key and its store — and a run stopped
    // there would leave a key for a Step that never computed. The yield is the
    // first statement of the body, so a walk closed at one has touched nothing.
    const { graph, filter } = chain()
    const cache = createRunCache()
    const walk = walkGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
      cache,
      sourceKey: () => 'k:src',
    })

    walk.next() // waiting in front of the Source
    walk.next() // the Source is done; waiting in front of the Filter
    const closed = walk.return(undefined)

    expect(closed.done).toBe(true)
    // A Source stores no entry of its own (its table is Step zero's), so an
    // untouched Filter means an empty cache rather than a smaller one.
    expect(cache.size()).toBe(0)

    // …and the Filter is still computable, from scratch, by a run that finishes.
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
      cache,
      sourceKey: () => 'k:src',
    })
    expect(out.results.get(filter).table).not.toBeNull()
  })

  it('answers what the synchronous driver answers, node for node', () => {
    const { graph } = chain()
    const drained = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
    })

    const walk = walkGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
    })
    let step = walk.next()
    while (!step.done) step = walk.next()

    expect([...step.value.results.keys()]).toEqual([...drained.results.keys()])
    expect(codesOf(step.value.diagnostics)).toEqual(codesOf(drained.diagnostics))
    expect(step.value.run.state).toBe(drained.run.state)
  })
})

describe('the gate’s door (story 7b, review round 1)', () => {
  // **The defect this block exists for, and it shipped once.** Gate 1 asked
  // `sourceTable(id) === null`, and in the pane that door *converts* — 548–555 ms
  // per contributing Source at design scale. The gate loop runs above the walk, so
  // the scheduler's first `next()` paid every cold conversion synchronously,
  // uncancellable and unreported: the exact failure the story exists to remove,
  // with two artifacts in the repo claiming the opposite. The predicate answers
  // the question the gate actually has.

  /** A `sourceTable` that counts, so "it was not called" is an assertion. */
  const counting = (tables = new Map()) => {
    const calls = []
    return {
      calls,
      door: (id) => {
        calls.push(id)
        return tables.get(id) ?? null
      },
    }
  }

  it('refuses an unconfirmed Source without ever asking for a table', () => {
    const { graph } = chain()
    const table = counting()
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: table.door,
      sourceConfirmed: () => false,
    })

    expect(out.ok).toBe(false)
    expect(codesOf(out.diagnostics)).toEqual([CODE.sourceUnconfirmed])
    // Not once. A refused run converts nothing at all, which is what makes the
    // refusal free as well as synchronous.
    expect(table.calls).toEqual([])
  })

  it('asks for the table at the Source’s own node, and only there', () => {
    // Which is what puts Step zero between two yields: the walk yields before this
    // node, so a driver that stops there has not converted anything.
    const { graph } = chain()
    const table = counting(new Map([['src:umsatz', REPORT()]]))
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: table.door,
      sourceConfirmed: () => true,
    })

    expect(out.ok).toBe(true)
    expect(table.calls).toEqual(['src:umsatz'])
  })

  it('keeps `sourceTable(id) === null` as the gate for a caller that passes no predicate', () => {
    // Every caller and every test written before story 7b, and the reason this is
    // an added door rather than a changed contract.
    const { graph } = chain()
    const refusedRun = run(graph)
    const table = counting(new Map([['src:umsatz', REPORT()]]))
    const admitted = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: table.door,
    })

    expect(codesOf(refusedRun.diagnostics)).toEqual([CODE.sourceUnconfirmed])
    expect(admitted.ok).toBe(true)
    // Twice with no predicate: once at the gate, once at the node. That is the
    // cost the predicate removes, and it is here so that removing the predicate
    // from the pane cannot pass unseen.
    expect(table.calls).toEqual(['src:umsatz', 'src:umsatz'])
  })

  it('walks on when the two doors disagree, rather than refusing halfway', () => {
    // A predicate that says `confirmed` while the table door answers `null` is a
    // caller bug, not a state the store can produce. The Source records no table
    // and its consumers report their missing input by name — the same treatment
    // every other Step that produced nothing gets. A run cannot be refused after
    // the gates have passed.
    const { graph, filter } = chain()
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => null,
      sourceConfirmed: () => true,
    })

    expect(out.ok).toBe(true)
    expect(codesOf(out.diagnostics)).not.toContain(CODE.sourceUnconfirmed)
    expect(out.results.get('src:umsatz').table).toBeNull()
    expect(codesOf(out.results.get(filter).diagnostics)).toEqual([CODE.inputFailed])
  })
})

describe('the run identity (AD-25)', () => {
  /** The `Clock` port, stopped. */
  const testClock = (at = 1_712_000_000_000) => {
    let minted = 0
    return { now: () => at, runId: () => `run:${(minted += 1)}` }
  }

  it('stamps a completed run with the id and the start time the Clock minted', () => {
    const { graph } = chain()
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
      clock: testClock(),
    })

    expect(out.run).toEqual({
      id: 'run:1',
      startedAt: 1_712_000_000_000,
      state: 'complete',
    })
  })

  it('stamps a run refused at a gate too — a refusal is a run that happened', () => {
    // AD-25 admits no exception, and the reason is FR-37's: a document that cannot
    // say when a run was refused cannot be filed six months later either.
    const { graph } = chain()
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => null,
      clock: testClock(1_712_000_000_500),
    })

    expect(out.ok).toBe(false)
    expect(codesOf(out.diagnostics)).toEqual([CODE.sourceUnconfirmed])
    expect(out.run).toEqual({
      id: 'run:1',
      startedAt: 1_712_000_000_500,
      state: 'refused',
    })
  })

  it('mints the identity above the gates, so a refusal costs one id and not none', () => {
    const { graph } = chain()
    const clock = testClock()
    const refusedRun = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => null,
      clock,
    })
    const completedRun = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
      clock,
    })

    expect(refusedRun.run.id).toBe('run:1')
    expect(completedRun.run.id).toBe('run:2')
  })

  it('carries two nulls when no clock was passed — the clock is a door', () => {
    // Which is what lets every case above this line, and every caller written
    // before story 7b, stay exactly what it was.
    const { graph } = chain()
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
    })

    expect(out.run).toEqual({ id: null, startedAt: null, state: 'complete' })
  })

  it('calls the clock exactly once per run, for each of its two members', () => {
    // A run has *a* start time, not one per Step and not one per return path.
    const { graph } = chain()
    const calls = { now: 0, runId: 0 }
    executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
      clock: {
        now: () => (calls.now += 1),
        runId: () => `run:${(calls.runId += 1)}`,
      },
    })

    expect(calls).toEqual({ now: 1, runId: 1 })
  })

  it('reports `complete` for a graph with no Result Step, and still mints an identity', () => {
    // Not a refusal: `graph.no_result` already says it, once, on the pane. It is a
    // run that walked an empty order.
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:umsatz', name: 'Umsatz' }])
    const out = executeGraph({
      steps: graph.list(),
      resultId: graph.resultId(),
      engine,
      sourceTable: () => REPORT(),
      clock: testClock(),
    })

    expect(out.ok).toBe(true)
    expect(out.results.size).toBe(0)
    expect(out.run).toEqual({ id: 'run:1', startedAt: 1_712_000_000_000, state: 'complete' })
  })
})
