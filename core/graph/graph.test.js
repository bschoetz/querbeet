// The model, under `--project core` with `environment: 'node'` (AD-27). Nothing
// here needs a DOM, and needing one would mean AD-2 broke upstream of the test.

import { describe, expect, it } from 'vitest'
import {
  CODE,
  GRAPH_CODES,
  addInputSlot,
  addNode,
  brokenNodes,
  checkConnect,
  cloneGraph,
  connect,
  connectableInto,
  contributingTo,
  disconnect,
  edgeId,
  edgesOf,
  emptyGraph,
  findCycle,
  findNode,
  freePosition,
  graphDiagnostics,
  makeNode,
  moveNode,
  orphans,
  parseEdgeId,
  removeInputSlot,
  removeNode,
  renameNode,
  setResult,
  wouldCycle,
} from './graph.js'
import { kindCodes, kindSpec } from './kinds.js'

/** The spike's six-Step graph: three Sources, a Union of two, a Filter, a Join. */
function seeded() {
  const g = emptyGraph()
  addNode(g, makeNode('source', { id: 'src:q1', name: 'Umsatz Q1', x: 40, y: 40 }))
  addNode(g, makeNode('source', { id: 'src:q2', name: 'Umsatz Q2', x: 40, y: 190 }))
  addNode(g, makeNode('source', { id: 'src:kd', name: 'Kunden', x: 40, y: 340 }))
  addNode(g, makeNode('union', { id: 'u1', name: 'Halbjahr', inputs: ['src:q1', 'src:q2'] }))
  addNode(g, makeNode('filter', { id: 'f1', name: 'Nur Bestand', inputs: ['u1'] }))
  addNode(g, makeNode('join', { id: 'j1', name: 'Mit Kunden', inputs: ['f1', 'src:kd'] }))
  setResult(g, 'j1')
  return g
}

const snapshot = (g) => JSON.stringify(cloneGraph(g))
const codesOf = (result) => result.diagnostics.map((d) => d.code)

describe('the kind catalogue', () => {
  it('states arity as a property of the kind, not as a rule checked later', () => {
    expect(kindSpec('source')).toMatchObject({ minInputs: 0, maxInputs: 0 })
    expect(kindSpec('union')).toMatchObject({ minInputs: 2, maxInputs: Infinity })
    expect(kindSpec('join')).toMatchObject({ minInputs: 2, maxInputs: 2 })
    for (const code of ['filter', 'columns', 'computed', 'aggregate']) {
      expect(kindSpec(code), code).toMatchObject({ minInputs: 1, maxInputs: 1 })
    }
  })

  it('answers null for a kind it does not know, so a caller can guard', () => {
    // Story 14's loader builds nodes out of a file; a TypeError out of the model
    // is not a Diagnostic anyone can render.
    expect(kindSpec('pivot')).toBeNull()
    expect(kindSpec('constructor')).toBeNull()
  })

  it('names exactly the seven kinds the SPEC allows', () => {
    expect(kindCodes()).toEqual([
      'source',
      'union',
      'join',
      'filter',
      'columns',
      'computed',
      'aggregate',
    ])
  })
})

describe('a new node', () => {
  it('opens with as many empty slots as its kind needs to be complete', () => {
    expect(makeNode('union', { id: 'u' }).inputs).toEqual([null, null])
    expect(makeNode('join', { id: 'j' }).inputs).toEqual([null, null])
    expect(makeNode('filter', { id: 'f' }).inputs).toEqual([null])
    expect(makeNode('source', { id: 's' }).inputs).toEqual([])
  })

  it('carries ids and positions and nothing else — no table, no row, no handle', () => {
    expect(Object.keys(makeNode('filter', { id: 'f' })).sort()).toEqual([
      'id',
      'inputs',
      'kind',
      'name',
      'x',
      'y',
    ])
  })
})

describe('edges', () => {
  it('are derived from the slots, so no second representation can disagree', () => {
    const g = seeded()
    expect(edgesOf(g).map((e) => e.id)).toEqual([
      'src:q1->u1#0',
      'src:q2->u1#1',
      'u1->f1#0',
      'f1->j1#0',
      'src:kd->j1#1',
    ])
    disconnect(g, 'u1', 1)
    expect(edgesOf(g).map((e) => e.id)).not.toContain('src:q2->u1#1')
  })

  it('round-trip through the one owner of the id grammar', () => {
    // Both readers of that grammar are exercised here: the adapter parses an id
    // back with `parseEdgeId`, and changing the separator in `edgeId` must not
    // silently turn edge removal from the canvas into a no-op.
    for (const [source, target, slot] of [
      ['src:umsatz-q1', 'u1', 0],
      ['s12', 's3', 7],
    ]) {
      expect(parseEdgeId(edgeId(source, target, slot))).toEqual({ source, target, slot })
    }
  })

  it('refuse an id nothing here minted', () => {
    for (const id of [null, undefined, '', 'a->b', 'a->b#x', 42]) {
      expect(parseEdgeId(id), String(id)).toBeNull()
    }
  })

  it('read the source unambiguously — two greedy groups would not', () => {
    // Nothing mints an id like this today, and this file declares itself the one
    // owner of the grammar; story 14's loader reads ids out of a file.
    expect(parseEdgeId('a->b->c#0')).toEqual({ source: 'a', target: 'b->c', slot: 0 })
  })
})

describe('the connect guard', () => {
  it('refuses a cycle and leaves the graph byte-identical', () => {
    const g = seeded()
    const before = snapshot(g)

    expect(wouldCycle(g, 'j1', 'u1')).toBe(true)
    const result = connect(g, 'j1', 'u1', 0)

    expect(result.ok).toBe(false)
    expect(codesOf(result)).toEqual([CODE.cycle])
    expect(result.diagnostics[0].values).toEqual({ sourceId: 'j1', targetId: 'u1' })
    expect(snapshot(g)).toBe(before)
  })

  it('refuses a self-connection', () => {
    const g = seeded()
    const result = connect(g, 'f1', 'f1', 0)
    expect(codesOf(result)).toEqual([CODE.selfConnection])
    expect(result.diagnostics[0].values).toEqual({ id: 'f1' })
  })

  it('refuses a Source as a target', () => {
    const g = seeded()
    const result = connect(g, 'f1', 'src:q1', 0)
    expect(codesOf(result)).toEqual([CODE.sourceTakesNoInput])
    expect(result.diagnostics[0].values).toEqual({ targetId: 'src:q1' })
  })

  it('refuses what is already at that slot, with the slot named', () => {
    const g = seeded()
    const result = connect(g, 'f1', 'j1', 0)
    expect(codesOf(result)).toEqual([CODE.alreadyConnected])
    expect(result.diagnostics[0].values).toEqual({ sourceId: 'f1', targetId: 'j1', slot: 0 })
    expect(edgesOf(g).filter((e) => e.id === 'f1->j1#0')).toHaveLength(1)
  })

  it('refuses a slot the target does not have, and never on a NaN', () => {
    const g = seeded()
    for (const slot of [-1, 2, 1.5, Number.NaN, undefined]) {
      const result = connect(g, 'src:q1', 'j1', slot)
      expect(codesOf(result), String(slot)).toEqual([CODE.noSuchSlot])
    }
  })

  it('refuses an unknown Step on either end', () => {
    const g = seeded()
    expect(codesOf(connect(g, 'nope', 'j1', 0))).toEqual([CODE.unknownStep])
    expect(codesOf(connect(g, 'f1', 'nope', 0))).toEqual([CODE.unknownStep])
  })

  it('asks without changing anything — which is what lets the pointer path ask', () => {
    const g = seeded()
    const before = snapshot(g)
    expect(checkConnect(g, 'j1', 'u1', 0).ok).toBe(false)
    expect(checkConnect(g, 'src:q1', 'j1', 1).ok).toBe(true)
    expect(snapshot(g)).toBe(before)
  })
})

describe('the candidate list', () => {
  it('is built from the same guard, so it can never offer a refused Step', () => {
    const g = seeded()
    const candidates = connectableInto(g, 'u1', 0)

    // Everything downstream of u1 would close a cycle and is absent rather than
    // offered and then turned down.
    expect(candidates).not.toContain('f1')
    expect(candidates).not.toContain('j1')
    expect(candidates).not.toContain('u1')
    // And what is offered is accepted, every one of it.
    for (const id of candidates) expect(checkConnect(g, id, 'u1', 0).ok, id).toBe(true)
    expect(candidates).toEqual(['src:q2', 'src:kd'])
  })

  it('is empty for a Source, which has no slot to offer anything into', () => {
    expect(connectableInto(seeded(), 'src:q1', 0)).toEqual([])
  })
})

describe('connecting', () => {
  it('reports the replacement rather than dropping it on the floor', () => {
    const g = seeded()
    const result = connect(g, 'src:q1', 'j1', 0)

    expect(result.ok).toBe(true)
    expect(codesOf(result)).toEqual([CODE.inputReplaced])
    expect(result.diagnostics[0].values).toEqual({ id: 'j1', slot: 0, replaced: 'f1' })
    expect(findNode(g, 'j1').inputs).toEqual(['src:q1', 'src:kd'])
  })

  it('says nothing extra when the slot was empty', () => {
    const g = seeded()
    disconnect(g, 'j1', 0)
    expect(codesOf(connect(g, 'f1', 'j1', 0))).toEqual([])
  })
})

describe('disconnecting', () => {
  it('empties the slot', () => {
    const g = seeded()
    expect(disconnect(g, 'j1', 1).ok).toBe(true)
    expect(findNode(g, 'j1').inputs).toEqual(['f1', null])
  })

  it('refuses a slot that is already empty', () => {
    const g = seeded()
    disconnect(g, 'j1', 1)
    expect(codesOf(disconnect(g, 'j1', 1))).toEqual([CODE.slotEmpty])
  })

  it('refuses a slot that does not exist and an unknown Step', () => {
    const g = seeded()
    expect(codesOf(disconnect(g, 'j1', 9))).toEqual([CODE.noSuchSlot])
    expect(codesOf(disconnect(g, 'nope', 0))).toEqual([CODE.unknownStep])
  })
})

describe('removing a Step', () => {
  it('marks the consumer broken and names what it lost, by the name it had', () => {
    const g = seeded()
    renameNode(g, 'u1', 'Erstes Halbjahr')
    removeNode(g, 'u1')

    const broken = brokenNodes(g)
    expect(broken).toEqual([{ id: 'f1', lost: [{ slot: 0, name: 'Erstes Halbjahr' }], filled: 0, required: 1 }])
    // Neither deleted nor silently re-wired: the reference stays in place.
    expect(findNode(g, 'f1').inputs).toEqual(['u1'])
  })

  it('gives up the Result designation with the Step', () => {
    const g = seeded()
    removeNode(g, 'j1')
    expect(g.resultId).toBeNull()
  })

  it('refuses an unknown id rather than throwing — a stale canvas report is not a bug', () => {
    expect(codesOf(removeNode(emptyGraph(), 'ghost'))).toEqual([CODE.unknownStep])
  })
})

describe('renaming', () => {
  it('refuses an empty name as a refusal, not as a silent decline', () => {
    // Returning `ok` after declining to apply it clears the refusal region and
    // leaves the input showing text the model does not hold.
    const g = seeded()
    for (const name of ['', '   ', null, undefined]) {
      const result = renameNode(g, 'f1', name)
      expect(result.ok, String(name)).toBe(false)
      expect(codesOf(result)).toEqual([CODE.emptyName])
    }
    expect(findNode(g, 'f1').name).toBe('Nur Bestand')
  })

  it('trims what it does accept', () => {
    const g = seeded()
    renameNode(g, 'f1', '  Nur Lager  ')
    expect(findNode(g, 'f1').name).toBe('Nur Lager')
  })
})

describe('moving', () => {
  it('writes the position through', () => {
    const g = seeded()
    moveNode(g, 'f1', 1024, 247)
    expect(findNode(g, 'f1')).toMatchObject({ x: 1024, y: 247 })
  })

  it('refuses an unknown id and throws on a position that is not two numbers', () => {
    const g = seeded()
    expect(codesOf(moveNode(g, 'ghost', 1, 2))).toEqual([CODE.unknownStep])
    expect(() => moveNode(g, 'f1', 'x', 2)).toThrow(TypeError)
    expect(() => moveNode(g, 'f1', Number.NaN, 2)).toThrow(TypeError)
  })
})

describe('the Result Step', () => {
  it('refuses a Source', () => {
    const g = seeded()
    const result = setResult(g, 'src:kd')
    expect(codesOf(result)).toEqual([CODE.resultIsSource])
    expect(g.resultId).toBe('j1')
  })

  it('re-designating leaves what no longer reaches it marked, not removed', () => {
    const g = seeded()
    setResult(g, 'u1')

    const marked = orphans(g)
    expect(marked).toEqual(['src:kd', 'f1', 'j1'])
    // Marked, not altered: every Step is still there with its slots intact.
    expect(g.nodes).toHaveLength(6)
    expect(findNode(g, 'j1').inputs).toEqual(['f1', 'src:kd'])
  })

  it('walks contributions upstream from whichever Step is designated', () => {
    const g = seeded()
    expect([...contributingTo(g)].sort()).toEqual(['f1', 'j1', 'src:kd', 'src:q1', 'src:q2', 'u1'])
    expect([...contributingTo(g, 'u1')].sort()).toEqual(['src:q1', 'src:q2', 'u1'])
  })
})

describe('input slots', () => {
  it('refuse to grow past the maximum, naming it', () => {
    const g = seeded()
    const result = addInputSlot(g, 'j1')
    expect(codesOf(result)).toEqual([CODE.maxInputs])
    expect(result.diagnostics[0].values).toEqual({ id: 'j1', max: 2 })
    expect(findNode(g, 'j1').inputs).toHaveLength(2)
  })

  it('grow on a Union, which has no maximum', () => {
    const g = seeded()
    expect(addInputSlot(g, 'u1').ok).toBe(true)
    expect(findNode(g, 'u1').inputs).toEqual(['src:q1', 'src:q2', null])
  })

  it('refuse to shrink below the minimum, naming it', () => {
    const g = seeded()
    const result = removeInputSlot(g, 'u1', 1)
    expect(codesOf(result)).toEqual([CODE.minInputs])
    expect(result.diagnostics[0].values).toEqual({ id: 'u1', min: 2 })
  })

  it('refuse to take away a slot that holds a connection', () => {
    // Without this the `−` beside a connected select destroys the edge with no
    // diagnostic at all.
    const g = seeded()
    addInputSlot(g, 'u1')
    connect(g, 'src:kd', 'u1', 2)

    const result = removeInputSlot(g, 'u1', 2)
    expect(codesOf(result)).toEqual([CODE.slotConnected])
    expect(findNode(g, 'u1').inputs).toEqual(['src:q1', 'src:q2', 'src:kd'])
  })

  it('take away an empty one above the minimum', () => {
    const g = seeded()
    addInputSlot(g, 'u1')
    expect(removeInputSlot(g, 'u1', 2).ok).toBe(true)
    expect(findNode(g, 'u1').inputs).toEqual(['src:q1', 'src:q2'])
  })

  it('refuse a slot index the Step does not have', () => {
    const g = seeded()
    addInputSlot(g, 'u1')
    expect(codesOf(removeInputSlot(g, 'u1', 9))).toEqual([CODE.noSuchSlot])
  })
})

describe('what the graph says about itself', () => {
  it('reports a lost input rather than a missing one — the two are different states', () => {
    const g = seeded()
    removeNode(g, 'u1')

    const lost = graphDiagnostics(g).find((d) => d.stepId === 'f1')
    expect(lost.code).toBe(CODE.inputLost)
    expect(lost.severity).toBe('warning')
    expect(lost.values).toEqual({ id: 'f1', lost: [{ slot: 0, name: 'Halbjahr' }] })
  })

  it('reports an under-filled Step with the counts as numbers', () => {
    const g = seeded()
    disconnect(g, 'u1', 1)

    const missing = graphDiagnostics(g).find((d) => d.code === CODE.inputsMissing)
    expect(missing.values).toEqual({ id: 'u1', required: 2, filled: 1 })
  })

  it('marks an orphan as info and leaves it in the graph', () => {
    const g = seeded()
    addNode(g, makeNode('filter', { id: 's9', name: 'Frei' }))

    const orphan = graphDiagnostics(g).find((d) => d.code === CODE.orphan)
    expect(orphan).toMatchObject({ severity: 'info', stepId: 's9', values: { id: 's9' } })
    expect(findNode(g, 's9')).not.toBeNull()
  })

  it('counts non-Source Steps when nothing is designated, or the sentence calls Sources Steps', () => {
    const g = seeded()
    removeNode(g, 'j1')

    const none = graphDiagnostics(g).find((d) => d.code === CODE.noResult)
    expect(none.severity).toBe('unresolved')
    expect(none.values).toEqual({ steps: 2 }) // u1 and f1; the three Sources are not Steps here
    expect(none.stepId).toBeUndefined()
  })

  it('says nothing at all about a graph of Sources alone', () => {
    // Not merely no `graph.no_result`: no orphan marks either. With nothing
    // designated, "contributes to the Result" is not yet a question, so nothing
    // can be failing it — and a card saying so on the first entry into the Editor
    // reports a state the user cannot act on.
    const g = emptyGraph()
    addNode(g, makeNode('source', { id: 'src:a', name: 'A' }))
    addNode(g, makeNode('source', { id: 'src:b', name: 'B' }))

    expect(orphans(g)).toEqual([])
    expect(graphDiagnostics(g)).toEqual([])
  })

  it('names the whole graph once when Steps exist and none is designated', () => {
    const g = seeded()
    removeNode(g, 'j1')

    // The state is named — and named once, over the Steps, rather than as a mark
    // on every node including the Sources.
    expect(graphDiagnostics(g).map((d) => d.code)).toEqual([CODE.noResult])
    expect(orphans(g)).toEqual([])
  })

  it('freezes what it emits, values and all', () => {
    const g = seeded()
    removeNode(g, 'u1')
    const d = graphDiagnostics(g).find((x) => x.code === CODE.inputLost)
    expect(Object.isFrozen(d)).toBe(true)
    expect(Object.isFrozen(d.values)).toBe(true)
    expect(Object.isFrozen(d.values.lost)).toBe(true)
    expect(Object.isFrozen(d.values.lost[0])).toBe(true)
  })
})

describe('the code enumeration', () => {
  it('is built from the constants the emit sites use, so it cannot drift', () => {
    expect(GRAPH_CODES).toEqual(Object.values(CODE))
    expect(new Set(GRAPH_CODES).size).toBe(GRAPH_CODES.length)
    for (const code of GRAPH_CODES) expect(code, code).toMatch(/^graph\.[a-z_]+$/)
  })
})

describe('findCycle', () => {
  it('names the cycle it finds, in ids', () => {
    // Unreachable from the Editor by construction; story 14's loader is what
    // meets a cycle already formed.
    const g = emptyGraph()
    addNode(g, makeNode('filter', { id: 'a', inputs: ['c'] }))
    addNode(g, makeNode('filter', { id: 'b', inputs: ['a'] }))
    addNode(g, makeNode('filter', { id: 'c', inputs: ['b'] }))
    expect(findCycle(g)).toEqual(['a', 'b', 'c', 'a'])
  })

  it('finds none in a graph the Editor built', () => {
    expect(findCycle(seeded())).toBeNull()
  })
})

describe('placement', () => {
  it('is derived from the nodes already there, never from a count', () => {
    const g = emptyGraph()
    const first = freePosition(g, 'filter')
    addNode(g, makeNode('filter', { id: 'a', ...first }))
    const second = freePosition(g, 'filter')

    expect(second).not.toEqual(first)
    expect(findNode(g, 'a')).toMatchObject(first)
  })

  it('survives a removal — a counter would put the next Step on top of an old one', () => {
    const g = emptyGraph()
    for (const id of ['a', 'b', 'c']) addNode(g, makeNode('filter', { id, ...freePosition(g, 'filter') }))
    removeNode(g, 'b')

    const next = freePosition(g, 'filter')
    for (const node of g.nodes) {
      expect(next, `landed on ${node.id}`).not.toEqual({ x: node.x, y: node.y })
    }
  })

  it('keeps Sources in their own column', () => {
    const g = emptyGraph()
    expect(freePosition(g, 'source').x).toBeLessThan(freePosition(g, 'filter').x)
  })
})

describe('cloneGraph', () => {
  it('copies the slots rather than sharing them', () => {
    const g = seeded()
    const copy = cloneGraph(g)
    copy.nodes[3].inputs[0] = 'nope'
    expect(findNode(g, 'u1').inputs[0]).toBe('src:q1')
  })
})
