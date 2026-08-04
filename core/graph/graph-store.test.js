// The command surface (AD-10), under `--project core`.
//
// Every row of the spec's I/O matrix that is about a command rather than about a
// rendering is here; the ones about the walks themselves are in `graph.test.js`.

import { describe, expect, it } from 'vitest'
import { CODE } from './graph.js'
import { createGraphStore } from './graph-store.js'

const codesOf = (result) => result.diagnostics.map((d) => d.code)
const marks = (store) => store.diagnostics().map((d) => d.code)
const state = (store) => JSON.stringify([store.list(), store.edges(), store.resultId()])

/** Two Sources, a Union of both, a Filter downstream. */
function seeded() {
  const store = createGraphStore()
  store.syncSources([
    { id: 'src:q1', name: 'Umsatz Q1' },
    { id: 'src:q2', name: 'Umsatz Q2' },
  ])
  const union = store.addStep('union')
  const filter = store.addStep('filter')
  store.connect('src:q1', union.id, 0)
  store.connect('src:q2', union.id, 1)
  store.connect(union.id, filter.id, 0)
  store.setResult(filter.id)
  return { store, union: union.id, filter: filter.id }
}

describe('ids', () => {
  it('are short, readable and minted here', () => {
    const store = createGraphStore()
    expect(store.addStep('union').id).toBe('s1')
    expect(store.addStep('filter').id).toBe('s2')
  })

  it('are never reissued after a deletion (AD-14)', () => {
    const store = createGraphStore()
    const first = store.addStep('union').id
    store.removeStep(first)
    const second = store.addStep('union').id

    expect(second).not.toBe(first)
    expect(second).toBe('s2')
  })

  it('leave a Source id alone — the Source store minted that one', () => {
    const { store } = seeded()
    expect(store.list().map((s) => s.id)).toContain('src:q1')
  })
})

describe('addStep', () => {
  it('throws for a kind the toolbar cannot offer, rather than refusing', () => {
    // The toolbar is rendered from `addableKinds()`, so neither is a state a user
    // can reach; `graph.unknown_kind` survives as a refusal for story 14's loader.
    const store = createGraphStore()
    expect(() => store.addStep('pivot')).toThrow(TypeError)
    expect(() => store.addStep('source')).toThrow(TypeError)
    expect(store.list()).toHaveLength(0)
  })

  it('places a new Step where no Step already sits, across a removal', () => {
    const store = createGraphStore()
    const a = store.addStep('filter').id
    const b = store.addStep('filter').id
    store.removeStep(a)
    const c = store.addStep('filter').id

    const at = (id) => store.get(id)
    expect({ x: at(c).x, y: at(c).y }).not.toEqual({ x: at(b).x, y: at(b).y })
  })

  it('takes an explicit position when one is given', () => {
    const store = createGraphStore()
    const id = store.addStep('filter', { x: 700, y: 300, name: 'Filter' }).id
    expect(store.get(id)).toMatchObject({ x: 700, y: 300, name: 'Filter' })
  })

  it('designates the first Step that could be a Result', () => {
    const store = createGraphStore()
    const id = store.addStep('union').id
    expect(store.resultId()).toBe(id)
  })
})

describe('the projection', () => {
  it('is frozen on the way out, one level down', () => {
    const { store } = seeded()
    const [step] = store.list()

    expect(Object.isFrozen(store.list())).toBe(true)
    expect(Object.isFrozen(step)).toBe(true)
    expect(Object.isFrozen(step.inputs)).toBe(true)
    expect(Object.isFrozen(store.edges())).toBe(true)
    expect(Object.isFrozen(store.diagnostics())).toBe(true)
  })

  it('carries the edges derived from the slots and never a second copy', () => {
    const { store, union, filter } = seeded()
    expect(store.edges().map((e) => e.id)).toEqual([
      `src:q1->${union}#0`,
      `src:q2->${union}#1`,
      `${union}->${filter}#0`,
    ])
  })

  it('re-derives its marks on every commit, so no snapshot describes the graph it replaced', () => {
    const { store, union } = seeded()
    expect(marks(store)).toEqual([])
    store.disconnect(union, 1)
    expect(marks(store)).toContain(CODE.inputsMissing)
  })
})

describe('refusals leave the graph byte-identical', () => {
  it('on a cycle, on both the pointer path and the slot row — one guard', () => {
    const { store, union, filter } = seeded()
    const before = state(store)

    expect(store.candidates(union, 0)).not.toContain(filter)
    expect(codesOf(store.connect(filter, union, 0))).toEqual([CODE.cycle])
    expect(state(store)).toBe(before)
  })

  it('on a Source as the Result Step', () => {
    const { store } = seeded()
    const before = state(store)
    expect(codesOf(store.setResult('src:q1'))).toEqual([CODE.resultIsSource])
    expect(state(store)).toBe(before)
  })

  it('on a slot past the maximum and one below the minimum', () => {
    const { store, union } = seeded()
    const join = store.addStep('join').id

    expect(codesOf(store.addInputSlot(join))).toEqual([CODE.maxInputs])
    expect(store.get(join).inputs).toHaveLength(2)

    expect(codesOf(store.removeInputSlot(union, 1))).toEqual([CODE.minInputs])
    expect(store.get(union).inputs).toHaveLength(2)
  })

  it('on removing a slot that holds a connection', () => {
    const { store, union } = seeded()
    store.addInputSlot(union)
    store.connect('src:q1', union, 2)

    expect(codesOf(store.removeInputSlot(union, 2))).toEqual([CODE.slotConnected])
    expect(store.get(union).inputs[2]).toBe('src:q1')
  })

  it('on an empty name, which is a refusal and not a quiet decline', () => {
    const { store, filter } = seeded()
    const result = store.renameStep(filter, '   ')

    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual([CODE.emptyName])
    expect(store.get(filter).name).toBe(filter) // the default name is the id; ui/ passes a German one
  })

  it('on an unknown id, on every command — a stale canvas report is not a bug', () => {
    const { store } = seeded()
    for (const result of [
      store.moveStep('ghost', 1, 2),
      store.removeStep('ghost'),
      store.renameStep('ghost', 'x'),
      store.setResult('ghost'),
      store.addInputSlot('ghost'),
      store.removeInputSlot('ghost', 0),
      store.disconnect('ghost', 0),
      store.connect('ghost', 'ghost2', 0),
    ]) {
      expect(codesOf(result)).toEqual([CODE.unknownStep])
    }
  })
})

describe('removing', () => {
  it('refuses a Source, because the Sources pane owns that list', () => {
    // Without the refusal the node goes, its consumers go broken, and the next
    // syncSources puts the node *and* — through the dangling slot references
    // left in place — its edges straight back. Half a removal that undoes itself.
    const { store, union } = seeded()
    const result = store.removeStep('src:q2')

    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual([CODE.sourceNotRemovable])
    expect(store.get('src:q2')).not.toBeNull()
    expect(store.get(union).inputs).toEqual(['src:q1', 'src:q2'])
    expect(marks(store)).toEqual([])
  })

  it('takes a Step, and remembers the name for the slot still pointing at it', () => {
    const { store, union, filter } = seeded()
    store.removeStep(union)

    expect(store.get(union)).toBeNull()
    // The default name is the id; `ui/` passes a German one on `addStep`.
    expect(store.lostName(union)).toBe(union)
    expect(store.get(filter).inputs).toEqual([union])
  })

  it('has no name for an id nothing ever removed', () => {
    const { store } = seeded()
    expect(store.lostName('src:q1')).toBeNull()
    expect(store.lostName('nope')).toBeNull()
  })
})

describe('the guard, asked without changing anything', () => {
  it('answers the same as the command, and mutates nothing', () => {
    const { store, union, filter } = seeded()
    const before = state(store)

    const refusedResult = store.check(filter, union, 0)
    expect(refusedResult.ok).toBe(false)
    expect(codesOf(refusedResult)).toEqual([CODE.cycle])
    expect(store.check('src:q2', union, 0)).toMatchObject({ ok: true })
    expect(state(store)).toBe(before)
  })
})

describe('connecting through the store', () => {
  it('reports the replacement when the slot was occupied', () => {
    const { store, union } = seeded()
    const result = store.connect('src:q2', union, 0)

    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual([CODE.inputReplaced])
    expect(result.diagnostics[0].values).toMatchObject({ slot: 0, replaced: 'src:q1' })
  })

  it('offers, through `candidates`, exactly what `connect` accepts', () => {
    const { store, union, filter } = seeded()
    // The Union is attached at slot 0, so it is refused there and absent from
    // the list rather than offered and then turned down …
    expect(store.candidates(filter, 0)).not.toContain(union)
    // … and every Step the list does offer is one `connect` takes. Checked by
    // running the command for each of them on a store built the same way, so the
    // claim is about the command and not about a second reading of the rules.
    for (const id of store.candidates(filter, 0)) {
      const fresh = seeded()
      expect(fresh.store.connect(id, fresh.filter, 0).ok, id).toBe(true)
    }
    expect(store.candidates(filter, 0)).toContain('src:q1')
  })
})

describe('syncSources', () => {
  it('adds a node per new Source, in the Source column, without colliding', () => {
    const store = createGraphStore()
    store.syncSources([
      { id: 'src:a', name: 'A' },
      { id: 'src:b', name: 'B' },
      { id: 'src:c', name: 'C' },
    ])

    const sources = store.list().filter((s) => s.kind === 'source')
    expect(sources.map((s) => s.name)).toEqual(['A', 'B', 'C'])
    expect(new Set(sources.map((s) => `${s.x},${s.y}`)).size).toBe(3)
  })

  it('places a new Source where no node sits, after one has been removed', () => {
    const store = createGraphStore()
    store.syncSources([
      { id: 'src:a', name: 'A' },
      { id: 'src:b', name: 'B' },
    ])
    store.syncSources([{ id: 'src:b', name: 'B' }])
    store.syncSources([
      { id: 'src:b', name: 'B' },
      { id: 'src:c', name: 'C' },
    ])

    const at = (id) => `${store.get(id).x},${store.get(id).y}`
    expect(at('src:c')).not.toBe(at('src:b'))
  })

  it('marks a consumer broken and naming the Source when it disappears', () => {
    const { store, union } = seeded()
    store.syncSources([{ id: 'src:q1', name: 'Umsatz Q1' }])

    const lost = store.diagnostics().find((d) => d.code === CODE.inputLost)
    expect(lost.values).toEqual({ id: union, lost: [{ slot: 1, name: 'Umsatz Q2' }] })
    // Neither deleted nor re-wired.
    expect(store.get(union).inputs).toEqual(['src:q1', 'src:q2'])
  })

  it('renames through the rename command rather than writing the field', () => {
    const { store } = seeded()
    store.syncSources([
      { id: 'src:q1', name: 'Umsatz Januar' },
      { id: 'src:q2', name: 'Umsatz Q2' },
    ])
    expect(store.get('src:q1').name).toBe('Umsatz Januar')
    // …and the rename command's own guard still holds: an empty name is refused
    // and the old one stands, rather than a card losing its identity.
    store.syncSources([
      { id: 'src:q1', name: '' },
      { id: 'src:q2', name: 'Umsatz Q2' },
    ])
    expect(store.get('src:q1').name).toBe('Umsatz Januar')
  })

  it('leaves the positions of Sources it already knows alone', () => {
    const { store } = seeded()
    store.moveStep('src:q1', 900, 900)
    store.syncSources([
      { id: 'src:q1', name: 'Umsatz Q1' },
      { id: 'src:q2', name: 'Umsatz Q2' },
    ])
    expect(store.get('src:q1')).toMatchObject({ x: 900, y: 900 })
  })

  it('validates the whole argument before it mutates anything', () => {
    // Round 1 could throw on a later entry with earlier ones already added and
    // `commit()` never reached, leaving every reader on a stale snapshot.
    const { store } = seeded()
    const before = state(store)

    expect(() =>
      store.syncSources([{ id: 'src:q1', name: 'Umsatz Q1' }, { id: 'src:neu' }]),
    ).toThrow(TypeError)
    expect(state(store)).toBe(before)

    expect(() => store.syncSources('nope')).toThrow(TypeError)
    expect(() => store.syncSources([{ id: '', name: 'x' }])).toThrow(TypeError)
    expect(state(store)).toBe(before)
  })

  it('returns the refusals it collected rather than a result derived from nothing', () => {
    // It is the one command that issues more than one mutation, which is why it
    // was the one that could report success over a refusal.
    const { store } = seeded()
    const result = store.syncSources([
      { id: 'src:q1', name: '' },
      { id: 'src:q2', name: 'Umsatz Q2' },
    ])

    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual([CODE.emptyName])
    expect(store.get('src:q1').name).toBe('Umsatz Q1')
  })

  it('reports nothing when nothing was refused', () => {
    const { store } = seeded()
    const result = store.syncSources([
      { id: 'src:q1', name: 'Umsatz Januar' },
      { id: 'src:q2', name: 'Umsatz Q2' },
    ])
    expect(result).toMatchObject({ ok: true })
    expect(codesOf(result)).toEqual([])
  })

  it('is idempotent — running it twice changes nothing', () => {
    const { store } = seeded()
    const before = state(store)
    store.syncSources([
      { id: 'src:q1', name: 'Umsatz Q1' },
      { id: 'src:q2', name: 'Umsatz Q2' },
    ])
    expect(state(store)).toBe(before)
  })
})

describe('leaving and re-entering the Editor', () => {
  it('changes nothing, because the store outlives the pane', () => {
    const { store, union, filter } = seeded()
    store.renameStep(filter, 'Nur Bestand')
    store.moveStep(filter, 820, 140)
    store.setResult(union)

    // Whatever a pane does on unmount, it never touches the store — so this is
    // the whole of "leaving and re-entering loses no Step configuration".
    const before = state(store)
    expect(JSON.parse(before)[0].find((s) => s.id === filter)).toMatchObject({
      name: 'Nur Bestand',
      x: 820,
      y: 140,
      inputs: [union],
    })
    expect(state(store)).toBe(before)
    expect(store.resultId()).toBe(union)
  })
})

// ------------------------------------------------------- story 6b: the body
//
// `configureStep` is the one door a Step's body goes through. What is asserted
// here is the division of labour: the registry decides whether an object is a
// configuration, the graph stores it opaquely, and a refusal changes nothing.

describe('configureStep', () => {
  const store = () => createGraphStore()

  it('stores a validated config, frozen all the way down, and hands the same object back', () => {
    const graph = store()
    const filter = graph.addStep('filter', { name: 'Nur Große' }).id
    const config = { combine: 'all', conditions: [{ column: 'Betrag', op: 'gt', value: 1000 }] }

    expect(graph.configureStep(filter, config).ok).toBe(true)
    expect(graph.get(filter).config).toBe(config)

    // **Deep, not shallow.** `Object.freeze` on the outer object leaves the
    // conditions array and every condition in it writable, so a component could
    // change a Step's body without going through a command (AD-10) — and do it
    // invisibly, because the object on the node is the object the caller kept.
    const stored = graph.get(filter).config
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored.conditions)).toBe(true)
    expect(Object.isFrozen(stored.conditions[0])).toBe(true)
  })

  it('freezes the leaves of a config whose outer object was already frozen', () => {
    // The case a `Object.isFrozen` short circuit would miss: a caller that
    // froze the wrapper and not its contents.
    const graph = store()
    const columns = graph.addStep('columns').id
    const config = Object.freeze({ columns: [{ from: 'a', to: 'b' }] })

    graph.configureStep(columns, config)

    expect(Object.isFrozen(graph.get(columns).config.columns)).toBe(true)
    expect(Object.isFrozen(graph.get(columns).config.columns[0])).toBe(true)
  })

  it('opens with no config at all, so a kind can supply its own default', () => {
    const graph = store()
    expect(graph.get(graph.addStep('filter').id).config).toBeNull()
  })

  it('refuses through the registry, and the previous config stays in force', () => {
    const graph = store()
    const columns = graph.addStep('columns', { name: 'Spalten' }).id
    const good = { columns: [{ from: 'a', to: 'a' }] }
    graph.configureStep(columns, good)

    const refused = graph.configureStep(columns, {
      columns: [
        { from: 'a', to: 'x' },
        { from: 'b', to: 'x' },
      ],
    })

    expect(refused.ok).toBe(false)
    expect(refused.diagnostics[0]).toMatchObject({
      code: 'step.rename_collision',
      values: { name: 'x' },
    })
    expect(graph.get(columns).config).toBe(good)
  })

  it('refuses a kind with no executor and a Source, naming what has nothing to set', () => {
    const graph = store()
    graph.syncSources([{ id: 'src:a', name: 'A' }])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id

    expect(graph.configureStep(union, {}).diagnostics[0]).toMatchObject({
      code: CODE.notConfigurable,
      values: { id: union, kind: 'union' },
    })
    expect(graph.configureStep('src:a', {}).diagnostics[0]).toMatchObject({
      code: CODE.notConfigurable,
    })
  })

  it('refuses an unknown id rather than throwing, like every other command', () => {
    expect(store().configureStep('ghost', {}).diagnostics[0]).toMatchObject({
      code: CODE.unknownStep,
    })
  })

  it('takes null as the reset, back to whatever the kind proposes', () => {
    const graph = store()
    const filter = graph.addStep('filter').id
    graph.configureStep(filter, { combine: 'any', conditions: [] })

    expect(graph.configureStep(filter, null).ok).toBe(true)
    expect(graph.get(filter).config).toBeNull()
  })
})

describe('one upstream in two slots', () => {
  it('is allowed, and the graph warns before anything is executed', () => {
    // Decided 2026-08-04 with the project owner: a Union of a table with itself
    // is a legitimate way to double a dataset, and silent duplication is not.
    // The mark is derived per commit like every other, so it is on the card
    // before a run rather than only at the moment of execution.
    const graph = createGraphStore()
    graph.syncSources([{ id: 'src:q1', name: 'Umsatz Q1' }])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id

    expect(graph.connect('src:q1', union, 0).ok).toBe(true)
    expect(graph.connect('src:q1', union, 1).ok).toBe(true)

    const mark = graph.diagnostics().find((d) => d.code === CODE.duplicateUpstream)
    expect(mark).toMatchObject({
      severity: 'warning',
      values: { id: union, upstream: 'src:q1', slots: [0, 1] },
      stepId: union,
    })
  })

  it('says nothing where two slots hold two different Steps', () => {
    const graph = createGraphStore()
    graph.syncSources([
      { id: 'src:a', name: 'A' },
      { id: 'src:b', name: 'B' },
    ])
    const union = graph.addStep('union', { name: 'Halbjahr' }).id
    graph.connect('src:a', union, 0)
    graph.connect('src:b', union, 1)

    expect(graph.diagnostics().some((d) => d.code === CODE.duplicateUpstream)).toBe(false)
  })
})
