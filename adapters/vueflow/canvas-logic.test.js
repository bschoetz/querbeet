// The adapter's arithmetic, under `--project core` with `environment: 'node'`.
//
// This file is the whole reason `canvas-logic.js` exists as a plain module: the
// `core` project reaches `adapters/**/*.test.js` but cannot compile an SFC, and
// the `ui` project can compile one but never looks in `adapters/`. Logic left
// inside `GraphCanvas.vue` is reachable only from Playwright.

import { describe, expect, it, vi } from 'vitest'
import { edgeId } from '@core/graph/graph.js'
import {
  createFocusGate,
  createRemovalRouter,
  edgeRemovalAt,
  handleOfSlot,
  hasDimensionChange,
  isTypingTarget,
  LAYOUT,
  panShortfall,
  positionChanges,
  reflowMoves,
  removalPlan,
  slotOfHandle,
  viewStateChanges,
} from './canvas-logic.js'

const rect = (left, top, right, bottom) => ({ left, top, right, bottom })

describe('the handle-to-slot parse', () => {
  it('reads the slot out of an input handle', () => {
    expect(slotOfHandle('in-0')).toBe(0)
    expect(slotOfHandle('in-7')).toBe(7)
    expect(slotOfHandle(handleOfSlot(12))).toBe(12)
  })

  it('refuses anything else rather than yielding NaN', () => {
    // A NaN slot index reaches `checkConnect` as a refusal nobody can read, and
    // `Number('') === 0` would silently address slot zero.
    for (const handle of [null, undefined, '', 'out', 'in-', 'in-x', 'input-1', 3, {}]) {
      expect(slotOfHandle(handle), JSON.stringify(handle)).toBeNull()
    }
  })
})

describe('where an edge removal landed', () => {
  it('reads the endpoints the change already carries', () => {
    // `createEdgeRemoveChange(id, source, target, sourceHandle, targetHandle)` —
    // so nothing has to parse an id to find out which slot was emptied.
    expect(
      edgeRemovalAt({
        id: 'u1->j1#1',
        source: 'u1',
        target: 'j1',
        sourceHandle: 'out',
        targetHandle: 'in-1',
        type: 'remove',
      }),
    ).toEqual({ source: 'u1', target: 'j1', slot: 1 })
  })

  it('falls back to the id grammar, through the core that owns it', () => {
    expect(edgeRemovalAt({ id: edgeId('src:umsatz-q1', 's3', 2), type: 'remove' })).toEqual({
      source: 'src:umsatz-q1',
      target: 's3',
      slot: 2,
    })
  })

  it('answers null for a change that names nothing this tree minted', () => {
    expect(edgeRemovalAt({ id: 'vueflow__edge-a-b' })).toBeNull()
    expect(edgeRemovalAt({})).toBeNull()
    expect(edgeRemovalAt(null)).toBeNull()
  })
})

describe('a node removal is not a set of disconnects', () => {
  it('drops the edges the removal dragged along, on both sides of the node', () => {
    // The library reports these *before* the node itself. Read as user
    // disconnects they empty the consumer's slot, and the consumer comes out
    // under-filled instead of broken-and-named — the inversion of CAP-12.
    const plan = removalPlan(
      [
        { id: 'src:q1->u1#0', source: 'src:q1', target: 'u1', targetHandle: 'in-0', type: 'remove' },
        { id: 'u1->f1#0', source: 'u1', target: 'f1', targetHandle: 'in-0', type: 'remove' },
      ],
      ['u1'],
    )

    expect(plan.removals).toEqual(['u1'])
    expect(plan.disconnects).toEqual([])
  })

  it('keeps the disconnects a user actually asked for', () => {
    const plan = removalPlan(
      [{ id: 'f1->j1#0', source: 'f1', target: 'j1', targetHandle: 'in-0', type: 'remove' }],
      [],
    )
    expect(plan.disconnects).toEqual([{ source: 'f1', target: 'j1', slot: 0 }])
  })

  it('tells them apart inside one batch', () => {
    const plan = removalPlan(
      [
        { id: 'u1->f1#0', source: 'u1', target: 'f1', targetHandle: 'in-0', type: 'remove' },
        { id: 'src:kd->j1#1', source: 'src:kd', target: 'j1', targetHandle: 'in-1', type: 'remove' },
      ],
      ['u1'],
    )
    expect(plan.removals).toEqual(['u1'])
    expect(plan.disconnects).toEqual([{ source: 'src:kd', target: 'j1', slot: 1 }])
  })
})

describe('the removal router', () => {
  /** The two callbacks the library fires for one Delete keypress, in the order
   *  it fires them: the dragged edges first, then the node. */
  const deletePressed = (router) => {
    router.edgeRemovals([
      { id: 'u1->f1#0', source: 'u1', target: 'f1', targetHandle: 'in-0', type: 'remove' },
    ])
    router.nodeRemovals([{ id: 'u1', type: 'remove' }])
  }

  it('holds both halves of one gesture and interprets them once', () => {
    const removeStep = vi.fn()
    const disconnect = vi.fn()
    const scheduled = []
    const router = createRemovalRouter({
      removeStep,
      disconnect,
      schedule: (fn) => scheduled.push(fn),
    })

    deletePressed(router)
    expect(removeStep).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1) // armed once, not once per batch

    scheduled[0]()
    expect(removeStep).toHaveBeenCalledExactlyOnceWith('u1')
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('reports a selected edge deleted on its own as the disconnect it is', () => {
    const disconnect = vi.fn()
    const scheduled = []
    const router = createRemovalRouter({
      removeStep: vi.fn(),
      disconnect,
      schedule: (fn) => scheduled.push(fn),
    })

    router.edgeRemovals([
      { id: 'f1->j1#0', source: 'f1', target: 'j1', targetHandle: 'in-0', type: 'remove' },
    ])
    scheduled[0]()

    expect(disconnect).toHaveBeenCalledExactlyOnceWith('j1', 0)
  })

  it('rearms for the next gesture rather than going quiet after the first', () => {
    const removeStep = vi.fn()
    const scheduled = []
    const router = createRemovalRouter({
      removeStep,
      disconnect: vi.fn(),
      schedule: (fn) => scheduled.push(fn),
    })

    deletePressed(router)
    scheduled[0]()
    router.nodeRemovals([{ id: 'f1', type: 'remove' }])
    expect(scheduled).toHaveLength(2)
    scheduled[1]()

    expect(removeStep.mock.calls).toEqual([['u1'], ['f1']])
  })

  it('ignores a batch with no removal in it at all', () => {
    const scheduled = []
    const router = createRemovalRouter({
      removeStep: vi.fn(),
      disconnect: vi.fn(),
      schedule: (fn) => scheduled.push(fn),
    })
    router.nodeRemovals([{ id: 'f1', type: 'position', position: { x: 1, y: 2 } }])
    router.edgeRemovals([{ id: 'e', type: 'select', selected: true }])
    expect(scheduled).toHaveLength(0)
  })
})

describe('the change filters', () => {
  it('take positions and leave the library its own measurements', () => {
    // Delete this branch and every Step becomes immovable by mouse **and by
    // arrow key**, with nothing else in the file changing.
    expect(
      positionChanges([
        { id: 'f1', type: 'position', position: { x: 10, y: 20 } },
        { id: 'f1', type: 'dimensions', dimensions: { width: 1, height: 2 } },
        { id: 'f1', type: 'position' }, // a drag start carries no position
        { id: 'u1', type: 'remove' },
      ]),
    ).toEqual([{ id: 'f1', x: 10, y: 20 }])
  })

  it('see the measurement that says a card grew, and nothing else', () => {
    expect(hasDimensionChange([{ id: 'f1', type: 'dimensions', dimensions: {} }])).toBe(true)
    // A drag reports positions and resizes nothing — which is what keeps the
    // reflow away from a pressed pointer.
    expect(
      hasDimensionChange([
        { id: 'f1', type: 'position', position: { x: 1, y: 2 } },
        { id: 'u1', type: 'remove' },
        { id: 'a', type: 'select', selected: true },
      ]),
    ).toBe(false)
    expect(hasDimensionChange([])).toBe(false)
  })

  it('hand back selection and only selection', () => {
    const changes = [
      { id: 'a', type: 'select', selected: true },
      { id: 'b', type: 'position', position: { x: 0, y: 0 } },
      { id: 'c', type: 'remove' },
      { id: 'd', type: 'add', item: {} },
    ]
    expect(viewStateChanges(changes)).toEqual([changes[0]])
  })
})

describe('the shortfall pan', () => {
  const pane = rect(0, 0, 1000, 600)

  it('is zero when the node is already inside the pane', () => {
    expect(panShortfall(rect(100, 100, 300, 200), pane)).toEqual({ x: 0, y: 0 })
  })

  it('brings a node in from each edge by exactly the shortfall plus the margin', () => {
    expect(panShortfall(rect(-50, 100, 150, 200), pane)).toEqual({ x: 74, y: 0 })
    expect(panShortfall(rect(900, 100, 1100, 200), pane)).toEqual({ x: -124, y: 0 })
    expect(panShortfall(rect(100, -30, 300, 70), pane)).toEqual({ x: 0, y: 54 })
    expect(panShortfall(rect(100, 550, 300, 650), pane)).toEqual({ x: 0, y: -74 })
  })

  it('aligns the start edge of a node larger than the pane rather than oscillating', () => {
    const huge = rect(-100, -100, 2000, 1400)
    expect(panShortfall(huge, pane)).toEqual({ x: 124, y: 124 })
  })

  it('takes the margin as an argument, so the rule is one number and not a habit', () => {
    expect(panShortfall(rect(-50, 100, 150, 200), pane, 0)).toEqual({ x: 50, y: 0 })
  })
})

describe('the reflow', () => {
  /**
   * A measured card.
   *
   * 282 px wide is the **node wrapper**, measured in the built artefact — not the
   * 256 px of `ui/StepCard.vue`'s `w-64`, because what the library observes is the
   * wrapper around the card and the handles on its sides. The distinction matters
   * for one case below: against `PLACEMENT.dx` of 320 the real clearance between
   * two columns is 38 px, not 64, so a fixture written at the card's width would
   * be checking a wider gutter than ships.
   *
   * The height is the interesting axis either way: it grows with every slot row
   * and every mark, which is the whole reason this function exists.
   */
  const box = (id, x, y, height, width = 282) => ({ id, x, y, width, height })

  /** Whether a settled layout keeps its own promise, asserted rather than argued.
   *  Two boxes are clear when they miss horizontally or are `gap` apart. */
  const pairwiseClear = (nodes, gap = LAYOUT.gap) =>
    nodes.every((a, i) =>
      nodes.slice(i + 1).every(
        (b) =>
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height + gap <= b.y ||
          b.y + b.height + gap <= a.y,
      ),
    )

  const applyMoves = (nodes, moves) => {
    const by = new Map(moves.map((m) => [m.id, m]))
    return nodes.map((n) => (by.has(n.id) ? { ...n, x: by.get(n.id).x, y: by.get(n.id).y } : n))
  }

  it('leaves a layout that is already clear alone', () => {
    // The grid `freePosition` opens on: one column, 200 px apart, cards that fit.
    expect(reflowMoves([box('a', 360, 40, 150), box('b', 360, 240, 150)])).toEqual([])
    expect(reflowMoves([])).toEqual([])
    expect(reflowMoves([box('only', 40, 40, 900)])).toEqual([])
  })

  it('moves the lower card down when the one above it grew past the pitch', () => {
    // 260 px is a card the pitch cannot hold — a slot row and two marks is enough.
    const moves = reflowMoves([box('upper', 360, 40, 260), box('lower', 360, 240, 150)])
    expect(moves).toEqual([{ id: 'lower', x: 360, y: 40 + 260 + LAYOUT.gap }])
  })

  it('enforces the gap on a grid cell that was merely close, not overlapping', () => {
    // The coupling `LAYOUT`'s comment states: with `dy: 200` and `gap: 24`, any
    // card over 176 px makes the pass nudge the cell the model placed on. 187 px
    // is the height story 6b measured for a slot row plus a mark, and 40+187=227
    // means the two cards did not touch — the 11 px is the clearance, not a fix.
    expect(reflowMoves([box('a', 360, 40, 187), box('b', 360, 240, 150)])).toEqual([
      { id: 'b', x: 360, y: 251 },
    ])
  })

  it('leaves a card that shrank where it is — nothing is ever pulled back up', () => {
    // Acceptance criterion 2: a layout the user is looking at does not rearrange
    // itself out from under them when a mark disappears. It holds because `y` only
    // ever increases, and this is what would fail if a compaction were added.
    const grown = [box('a', 360, 40, 400), box('b', 360, 240, 150)]
    const settled = applyMoves(grown, reflowMoves(grown))
    const shrunk = settled.map((n) => (n.id === 'a' ? { ...n, height: 100 } : n))
    expect(reflowMoves(shrunk)).toEqual([])
  })

  it('counts a clearance of exactly the gap as clear', () => {
    expect(reflowMoves([box('a', 360, 40, 150), box('b', 360, 40 + 150 + LAYOUT.gap, 150)])).toEqual(
      [],
    )
  })

  it('carries the move down the whole column rather than one pair', () => {
    const nodes = [box('a', 360, 40, 260), box('b', 360, 240, 260), box('c', 360, 440, 150)]
    expect(reflowMoves(nodes)).toEqual([
      { id: 'b', x: 360, y: 324 },
      { id: 'c', x: 360, y: 608 },
    ])
  })

  it('settles a deep cascade in one call', () => {
    // Six cards each twice the pitch, stacked on the grid. If the inner loop were
    // bounded too tightly this is where it would come out still overlapping.
    const nodes = Array.from({ length: 6 }, (_, i) => box(`n${i}`, 360, 40 + i * 200, 400))
    const settled = applyMoves(nodes, reflowMoves(nodes))
    for (let i = 1; i < settled.length; i += 1) {
      expect(settled[i].y).toBeGreaterThanOrEqual(
        settled[i - 1].y + settled[i - 1].height + LAYOUT.gap,
      )
    }
  })

  it('comes out pairwise clear over a spread of arrangements, not just one', () => {
    // The convergence argument lives in a doc comment and the function has no
    // post-condition, so the loop running out of passes would return a layout
    // violating its own contract and take idempotence with it. This is the check
    // that argument does not have: many shapes, and each result verified.
    const heights = [40, 150, 187, 260, 400, 900]
    for (let seed = 0; seed < 60; seed += 1) {
      const nodes = Array.from({ length: 7 }, (_, i) => {
        // Deterministic and spread over columns, pitches and heights alike — no
        // clock and no randomness, so a failure is reproducible from its seed.
        const column = (seed + i) % 3
        const height = heights[(seed * 3 + i * 5) % heights.length]
        return box(`n${seed}-${i}`, 40 + column * 320, 40 + ((seed * 7 + i * 11) % 5) * 200, height)
      })
      const settled = applyMoves(nodes, reflowMoves(nodes))
      expect(pairwiseClear(settled), `seed ${seed}`).toBe(true)
      expect(reflowMoves(settled), `seed ${seed}`).toEqual([])
    }
  })

  it('produces no moves over its own output', () => {
    // The library reports dimensions with `forceUpdate: true` from two watchers,
    // so this pass runs over layouts it already settled. Without this property
    // that is a loop and not a no-op.
    const nodes = [box('a', 360, 40, 260), box('b', 360, 240, 260), box('c', 360, 440, 150)]
    const settled = applyMoves(nodes, reflowMoves(nodes))
    expect(reflowMoves(settled)).toEqual([])
  })

  it('does not depend on the order the nodes arrive in', () => {
    const nodes = [box('a', 360, 40, 260), box('b', 360, 240, 260), box('c', 360, 440, 150)]
    const forwards = reflowMoves(nodes)
    const backwards = reflowMoves([...nodes].reverse())
    expect(backwards).toEqual(forwards)
  })

  it('separates two cards that start at exactly the same point, by id', () => {
    const moves = reflowMoves([box('second', 360, 40, 150), box('first', 360, 40, 150)])
    expect(moves).toEqual([{ id: 'second', x: 360, y: 40 + 150 + LAYOUT.gap }])
  })

  it('leaves a neighbouring column alone — a vertical overlap is not an overlap', () => {
    // 40 + 282 <= 360: the columns clear each other by 38 px, so nothing about
    // their heights matters. Moving one sideways would take the column meaning
    // away — and the left column is where `syncSources` keeps putting Sources.
    expect(reflowMoves([box('source', 40, 40, 600), box('step', 360, 100, 600)])).toEqual([])
  })

  it('counts two columns that exactly touch as clear — the gap is vertical only', () => {
    // `LAYOUT.gap` is stated as a stacking clearance, not a border. Two cards
    // meeting edge to edge are side by side, which is a column and not an overlap.
    expect(reflowMoves([box('left', 40, 40, 600), box('right', 322, 40, 600)])).toEqual([])
  })

  it('moves a Source exactly like a Step — the pass knows nothing about kinds', () => {
    // Sources sit in their own column and grow with their own marks. `moveStep`
    // takes one (it is `removeStep` that refuses a Source), so nothing here needs
    // to know which is which — but nothing says so anywhere else either.
    expect(reflowMoves([box('source-1', 40, 40, 400), box('source-2', 40, 240, 90)])).toEqual([
      { id: 'source-2', x: 40, y: 464 },
    ])
  })

  it('moves nothing sideways, ever', () => {
    const moves = reflowMoves([box('a', 360, 40, 400), box('b', 360, 240, 150)])
    expect(moves.every((m) => m.x === 360)).toBe(true)
  })

  it('ignores a node the library has not measured, as obstacle and as subject', () => {
    // Vue Flow leaves `dimensions` at zero until its ResizeObserver has reported,
    // and hands this function `undefined` for a node it has never seen at all.
    // Treating either as a box would stack the whole graph on the first frame.
    expect(reflowMoves([box('unmeasured', 360, 40, 0), box('b', 360, 45, 150)])).toEqual([])
    expect(reflowMoves([box('a', 360, 40, 400), box('unmeasured', 360, 45, 0, 0)])).toEqual([])
    expect(reflowMoves([{ id: 'x', x: 360, y: 40, width: undefined, height: undefined }])).toEqual(
      [],
    )
    expect(reflowMoves([{ id: 'x', x: 360, y: Number.NaN, width: 282, height: 150 }])).toEqual([])
  })

  it('takes the gap as an argument, so the rule is one number and not a habit', () => {
    expect(reflowMoves([box('a', 360, 40, 260), box('b', 360, 240, 150)], 0)).toEqual([
      { id: 'b', x: 360, y: 300 },
    ])
  })
})

describe('the focus gate', () => {
  it('lets a keyboard focus pull the canvas', () => {
    expect(createFocusGate().allows()).toBe(true)
  })

  it('refuses the focus a pointer gesture caused', () => {
    // A defect, not a preference: the control travelled out from under the
    // cursor between mousedown and mouseup, so the click landed on the pane.
    const gate = createFocusGate()
    gate.pointerDown()
    expect(gate.allows()).toBe(false)
  })

  it('survives a pointer gesture that produced no focus event at all', () => {
    // The path an earlier version got wrong by spending the veto on read: a drag
    // on the pane background focuses nothing, so nothing spends it, and the next
    // *keyboard* focus was silently not pulled into view. The host listens for
    // `pointerup` on the window instead, so the release always arrives.
    const gate = createFocusGate()
    gate.pointerDown()
    gate.pointerUp()
    expect(gate.allows()).toBe(true)
  })

  it('does not spend the veto on being read, so one gesture cannot veto two', () => {
    const gate = createFocusGate()
    gate.pointerDown()
    expect(gate.allows()).toBe(false)
    expect(gate.allows()).toBe(false)
    gate.pointerUp()
    expect(gate.allows()).toBe(true)
  })
})

describe('what the Delete key belongs to', () => {
  it('leaves the key to whatever the user is typing in', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
      expect(isTypingTarget({ tagName }), tagName).toBe(true)
    }
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('claims it everywhere else on the canvas — a button is not a text field', () => {
    // The library's own guard covers INPUT, SELECT, TEXTAREA, contenteditable and
    // `.nokey` — not BUTTON — which is why the key is owned by the pane here.
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
