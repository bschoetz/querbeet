// The bounded cache (AD-8), under Vitest with no browser (AD-2, AD-27).
//
// One property carries the file: **an eviction is a miss, never a wrong
// answer.** Everything here is either that rule or the accounting that decides
// which entry leaves — and the accounting is in rows, because rows are what the
// memory plan is written in (R4: 30 intermediates at half a million rows, 180
// MB, against ~550 MB).

import { describe, expect, it } from 'vitest'
import { createRunCache, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_ROWS } from './cache.js'

/** What `record()` in `core/exec/execute.js` builds — the whole entry, because
 *  the table and its diagnostics travel together or the cache is not AD-8's. */
const entry = (rowCount, diagnostics = []) =>
  Object.freeze({
    kind: 'filter',
    table: { rowCount: () => rowCount },
    rowCount,
    columnCount: 2,
    diagnostics: Object.freeze(diagnostics),
  })

describe('the run cache', () => {
  it('answers what it was given, unchanged', () => {
    const cache = createRunCache()
    const stored = entry(10, [{ severity: 'warning', code: 'filter.rows_removed' }])

    cache.set('k', stored)

    expect(cache.get('k')).toBe(stored) // the same object, diagnostics and all
    expect(cache.get('nothing')).toBeUndefined()
  })

  it('counts rows rather than entries, since rows are what memory costs', () => {
    const cache = createRunCache()
    cache.set('a', entry(100))
    cache.set('b', entry(250))

    expect(cache.size()).toBe(2)
    expect(cache.rows()).toBe(350)
  })

  it('does not double-count a key written twice', () => {
    const cache = createRunCache()
    cache.set('a', entry(100))
    cache.set('a', entry(40))

    expect(cache.size()).toBe(1)
    expect(cache.rows()).toBe(40)
  })

  it('costs nothing for an entry with no rows to retain', () => {
    const cache = createRunCache()
    cache.set('a', Object.freeze({ table: null, rowCount: null, diagnostics: [] }))
    expect(cache.rows()).toBe(0)
  })

  it('evicts the least recently used until the bound holds', () => {
    const cache = createRunCache({ maxRows: 100 })
    cache.set('a', entry(50))
    cache.set('b', entry(50))
    cache.set('c', entry(50)) // 150 > 100

    expect(cache.get('a')).toBeUndefined() // the oldest went
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.rows()).toBe(100)
  })

  it('counts a read as a use, which is the whole of least-recently-*used*', () => {
    // A first-in-first-out cache throws away the Step at the top of the chain
    // the user is editing below — read on every single run and never written
    // again. That is the one entry that must not go.
    const cache = createRunCache({ maxRows: 100 })
    cache.set('a', entry(50))
    cache.set('b', entry(50))
    cache.get('a') // a is now the most recent
    cache.set('c', entry(50))

    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('evicts as many as it takes, not one per store', () => {
    const cache = createRunCache({ maxRows: 100 })
    cache.set('a', entry(30))
    cache.set('b', entry(30))
    cache.set('c', entry(30))
    cache.set('d', entry(100))

    expect(cache.size()).toBe(1)
    expect(cache.get('d')).toBeDefined()
    expect(cache.rows()).toBe(100)
  })

  it('evicts only as far as it has to, so the entries under the bound survive', () => {
    // The partial case, which the all-or-one cases either side of it do not
    // cover: three entries in, one out, two still answering.
    const cache = createRunCache({ maxRows: 100 })
    cache.set('a', entry(40))
    cache.set('b', entry(40))
    cache.set('c', entry(40)) // 120 > 100 — one eviction is enough

    expect(cache.size()).toBe(2)
    expect(cache.rows()).toBe(80)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('keeps a single entry larger than the whole bound, as the only entry', () => {
    // Refusing it would mean a table that never caches while every eviction pass
    // around it still ran — all of the bookkeeping and none of the hit. The bound
    // is a plan for a session, not an admission test per Step.
    const cache = createRunCache({ maxRows: 100 })
    cache.set('a', entry(50))
    const huge = entry(1000)
    cache.set('b', huge)

    expect(cache.get('b')).toBe(huge)
    expect(cache.size()).toBe(1)
    expect(cache.rows()).toBe(1000)
  })

  it('lets everything go on clear', () => {
    const cache = createRunCache()
    cache.set('a', entry(10))
    cache.clear()

    expect(cache.size()).toBe(0)
    expect(cache.rows()).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('defaults to the bound the memory plan licenses', () => {
    // R4 measured 30 retained intermediates at half a million rows — 15 million
    // rows — at 180 MB against a ~550 MB plan. The constant is that measurement
    // and moving it is the project owner's call.
    expect(DEFAULT_MAX_ROWS).toBe(15_000_000)
    const cache = createRunCache()
    cache.set('a', entry(1_000_000))
    cache.set('b', entry(1_000_000))
    expect(cache.size()).toBe(2)
  })

  it('refuses a bound that is not a positive number — a programming error', () => {
    expect(() => createRunCache({ maxRows: -1 })).toThrow(TypeError)
    expect(() => createRunCache({ maxRows: 'viel' })).toThrow(TypeError)
    // Zero is refused with the rest: eviction keeps the last entry standing, so a
    // cache of zero would store every entry and evict it before anything could
    // read it — all of the cost and none of the hit. Passing no cache at all is
    // how this is turned off.
    expect(() => createRunCache({ maxRows: 0 })).toThrow(TypeError)
    expect(() => createRunCache({ maxEntries: 0 })).toThrow(TypeError)
    expect(() => createRunCache({ maxEntries: -1 })).toThrow(TypeError)
    expect(() => createRunCache({ maxEntries: Infinity })).toThrow(TypeError)
  })
})

// ------------------------------------------------- the second ceiling (7a r1)
//
// Rows bound what memory costs when a table is real. They bound nothing about
// the `Map`: an entry retaining zero rows never pushes `rows()` past `maxRows`,
// so before review round 1 the eviction loop never ran for one and `held` grew a
// permanent slot per distinct config a user typed. An empty Filter result is an
// ordinary state, and at a keystroke's frequency it was a leak.

describe('the entry ceiling', () => {
  it('evicts on entry count even when every entry retains no rows at all', () => {
    const cache = createRunCache({ maxEntries: 3 })
    for (let i = 0; i < 50; i += 1) cache.set(`k${i}`, entry(0))

    expect(cache.rows()).toBe(0) // the row ceiling never noticed a thing
    expect(cache.size()).toBe(3)
    expect(cache.get('k0')).toBeUndefined()
    expect(cache.get('k49')).toBeDefined()
  })

  it('evicts the least recently used, on this ceiling as on the other', () => {
    const cache = createRunCache({ maxEntries: 2 })
    cache.set('a', entry(0))
    cache.set('b', entry(0))
    cache.get('a')
    cache.set('c', entry(0))

    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('honours whichever ceiling is exceeded, not both at once', () => {
    // Rows alone would hold all four; entries alone would hold two of any size.
    const cache = createRunCache({ maxRows: 1_000_000, maxEntries: 2 })
    cache.set('a', entry(10))
    cache.set('b', entry(10))
    cache.set('c', entry(10))

    expect(cache.size()).toBe(2)
    expect(cache.rows()).toBe(20)
  })

  it('does not bind before the row ceiling in any shape the research describes', () => {
    // 30 retained intermediates at half a million rows is the design scale (R4)
    // and is 15 million rows — the row bound exactly, at 30 entries. This
    // ceiling only ever binds on entries that cost no rows.
    expect(DEFAULT_MAX_ENTRIES).toBe(1_000)
    const cache = createRunCache()
    for (let i = 0; i < 30; i += 1) cache.set(`k${i}`, entry(500_000))
    expect(cache.size()).toBe(30)
    expect(cache.rows()).toBe(15_000_000)
  })
})
