// The `Yield` port's one implementation (AD-9), in the node envelope (AD-27).
//
// `MessageChannel` is a platform primitive of both browser engines and of Node, so
// this adapter is testable with no browser exactly as every other adapter is. What
// it cannot assert here is the property the port exists for — that a *click* is
// delivered in the gap it opens — because there is no input queue in Node. That
// half is `tests/e2e/execution.spec.js`'s, over the built artefact from `file://`,
// in both engines.

import { describe, expect, it } from 'vitest'
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
    // sees. Observed through `dispose`: closing the pair once stops every yield,
    // which is only true if there was one pair.
    const yielder = createQueueYield()
    await yielder.next()
    await yielder.next()
    yielder.dispose()

    // Posting on a closed port delivers nothing, so this promise would hang — it
    // is `Promise.race`d against a macrotask to say so rather than to time out.
    const after = yielder.next()
    const raced = await Promise.race([
      after.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('never'), 10)),
    ])

    expect(raced).toBe('never')
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
