// The `Yield` port's one implementation (AD-9), in the node envelope (AD-27).
//
// `MessageChannel` is a platform primitive of both browser engines and of Node, so
// this adapter is testable with no browser exactly as every other adapter is. What
// it cannot assert here is the property the port exists for — that a *click* is
// delivered in the gap it opens — because there is no input queue in Node. That
// half is `tests/e2e/execution.spec.js`'s, over the built artefact from `file://`,
// in both engines.

import { describe, expect, it, vi } from 'vitest'
import { createQueueYield } from './queue-yield.js'

describe('the yield', () => {
  it('resolves', async () => {
    const yielder = createQueueYield()
    await expect(yielder.next()).resolves.toBeUndefined()
    yielder.dispose()
  })

  it('goes through the macrotask queue and not the microtask queue', async () => {
    // **The property the whole design rests on.** A microtask yield drains before
    // the engine processes input, so a click on the cancel control would arrive
    // after the run it was meant to stop. The observable difference here is
    // ordering: a promise resolved on the microtask queue lands *before* one
    // resolved on the macrotask queue, whatever order they were asked for in.
    const yielder = createQueueYield()
    const order = []

    const yielded = yielder.next().then(() => order.push('macrotask'))
    await Promise.resolve().then(() => order.push('microtask'))
    await yielded

    expect(order).toEqual(['microtask', 'macrotask'])
    yielder.dispose()
  })

  it('resolves each waiting yield exactly once, in the order they were asked for', async () => {
    // Two runs overlap whenever an edit lands during one: the superseded run is
    // still awaiting its own yield when the new one starts. One port pair is
    // shared between them, so the *n*-th message has to resolve the *n*-th
    // promise or one of the two runs never resumes.
    const yielder = createQueueYield()
    const order = []
    const settled = Promise.all([
      yielder.next().then(() => order.push(1)),
      yielder.next().then(() => order.push(2)),
      yielder.next().then(() => order.push(3)),
    ])

    await settled

    expect(order).toEqual([1, 2, 3])
    yielder.dispose()
  })

  it('reuses one port pair rather than building one per yield', async () => {
    // A channel per yield allocates two ports per Step and leaves the pair behind;
    // at 30 Steps per run and a run per keystroke that is the kind of cost nobody
    // sees. Counted at the constructor, which is the only place the difference is
    // observable — every other property (ordering, resolution, disposal) holds
    // either way.
    //
    // Round 1 observed it through `dispose` instead, by asserting that a yield
    // asked for afterwards never resolves. That was a real hang written down as a
    // contract; the case below says what happens now, and this one no longer
    // depends on it.
    const real = globalThis.MessageChannel
    let built = 0
    vi.stubGlobal(
      'MessageChannel',
      class extends real {
        constructor() {
          super()
          built += 1
        }
      },
    )

    try {
      const yielder = createQueueYield()
      await yielder.next()
      await yielder.next()
      await yielder.next()
      yielder.dispose()

      expect(built).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resolves rather than suspends when it is asked for a yield after disposal', async () => {
    // **A disposed yielder must not be able to hang a run.** Posting on a closed
    // port delivers nothing, so the promise round 1 handed back here never settled:
    // a scheduler awaiting it never reached another cancellation check, its
    // `completed` never resolved, and the caller's progress line stayed on screen
    // for the life of the page. Resolving costs that last run the gap it was
    // yielding for — a run being torn down anyway — and it is the lesser evil by a
    // long way.
    const yielder = createQueueYield()
    await yielder.next()
    yielder.dispose()

    const raced = await Promise.race([
      yielder.next().then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 20)),
    ])

    expect(raced).toBe('resolved')
  })

  it('lets go of everything still waiting when it is disposed', async () => {
    // A scheduler suspended on a yield that can never be delivered would never
    // reach its next cancellation check and its `completed` would never settle — a
    // hang rather than a stop. Disposal resolves what is waiting so the run can
    // end.
    const yielder = createQueueYield()
    let landed = false
    const waiting = yielder.next().then(() => {
      landed = true
    })

    yielder.dispose()
    await waiting

    expect(landed).toBe(true)
  })
})
