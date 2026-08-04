// The frontier walk and its gates, in the node envelope (AD-27).
//
// The graph store is the real one — the executor reads its frozen projection and
// a stub would be a second opinion about what a projection is — and so is the
// engine, reached the way `convert.test.js` reaches it, through a dynamic import
// so no static import points from `core/` outward (AD-1).

import { describe, expect, it } from 'vitest'
import { CODE, executeGraph } from './execute.js'
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
