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
  panShortfall,
  positionChanges,
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

describe('the focus gate', () => {
  it('lets a keyboard focus pull the canvas', () => {
    expect(createFocusGate().claim()).toBe(true)
  })

  it('refuses the focus a pointer gesture caused', () => {
    // A defect, not a preference: the control travelled out from under the
    // cursor between mousedown and mouseup, so the click landed on the pane.
    const gate = createFocusGate()
    gate.pointerDown()
    expect(gate.claim()).toBe(false)
  })

  it('spends the veto, so a pointerup the canvas never sees cannot wedge it shut', () => {
    // The library drags the pane from a listener this element never sees the
    // release of. A veto that only a matching pointerup could lift would kill
    // the focus pull for the rest of the session, for keyboard users only.
    const gate = createFocusGate()
    gate.pointerDown()
    gate.claim()
    expect(gate.claim()).toBe(true)
  })

  it('lifts the veto on a release it does see', () => {
    const gate = createFocusGate()
    gate.pointerDown()
    gate.pointerUp()
    expect(gate.claim()).toBe(true)
  })
})
