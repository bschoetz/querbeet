// The `Clock` port's one implementation (AD-25), in the node envelope (AD-27).

import { describe, expect, it } from 'vitest'
import { createClock } from './clock.js'

describe('the clock', () => {
  it('reads a wall-clock instant in milliseconds', () => {
    const before = Date.now()
    const at = createClock().now()
    const after = Date.now()

    expect(Number.isInteger(at)).toBe(true)
    expect(at).toBeGreaterThanOrEqual(before)
    expect(at).toBeLessThanOrEqual(after)
  })

  it('answers a fresh reading each time rather than the one it was built with', async () => {
    // The prefix of an id is fixed at construction; `now()` is not, and a run's
    // start time is read per run (AD-25). A clock that froze its own instant would
    // stamp every run of a session with the same one.
    const clock = createClock()
    const first = clock.now()
    await new Promise((resolve) => setTimeout(resolve, 2))

    expect(clock.now()).toBeGreaterThan(first)
  })
})

describe('the run id', () => {
  it('never hands out the same id twice', () => {
    const clock = createClock()
    const ids = Array.from({ length: 1000 }, () => clock.runId())

    expect(new Set(ids).size).toBe(1000)
  })

  it('is a short readable string that says what it identifies', () => {
    // AD-14's shape for every id in this product: readable, prefixed by kind, and
    // not a UUID. A run id is not in a Recipe, so it is not bound by AD-14's
    // round-trip rule — but nothing is gained by looking different from `src:` and
    // `s1` in a report that carries all three.
    const id = createClock().runId()

    expect(id).toMatch(/^run:[0-9a-z]+-1$/)
    expect(id.length).toBeLessThan(24)
  })

  it('counts rather than draws, so two clocks count in step', () => {
    // No `Math.random` and no `crypto.randomUUID`: an id that depends on how a
    // generator was seeded cannot be reproduced by a test that counts the same
    // way. The counter is per instance, so two clocks hand out the same suffixes —
    // the deliberate consequence stated in the adapter, and the reason
    // `app/main.js` builds exactly one. Asserted so that a future instance-shared
    // counter, or a random one, both fail here.
    //
    // **And two clocks built inside one millisecond share the prefix as well**, so
    // their whole id streams coincide. That is not asserted here, because whether
    // two constructions land in one millisecond is the machine's business rather
    // than this adapter's — it is stated in `clock.js` instead, where the first
    // version of the comment claimed the opposite. The uniqueness this adapter
    // does promise is per instance, and the case at the top of this block is it.
    const a = createClock()
    const b = createClock()
    const suffix = (id) => id.split('-').at(-1)

    expect([suffix(a.runId()), suffix(a.runId()), suffix(a.runId())]).toEqual(['1', '2', '3'])
    expect([suffix(b.runId()), suffix(b.runId())]).toEqual(['1', '2'])
  })

  it('counts on independently of what the clock is asked for', () => {
    const clock = createClock()
    clock.runId()
    clock.now()
    clock.now()

    expect(clock.runId().endsWith('-2')).toBe(true)
  })
})
