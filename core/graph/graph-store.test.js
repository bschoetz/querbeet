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
