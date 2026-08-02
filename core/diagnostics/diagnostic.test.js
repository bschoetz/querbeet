// This file exists to prove AD-2 as much as to test AD-13: it runs under Vitest
// with no browser and no framework. A rule stated without a test that could fail
// is a rule that will rot (AD-27).

import { describe, expect, it } from 'vitest'
import { diagnostic, error, info, runStatus, unresolved, warning } from './diagnostic.js'

describe('diagnostic()', () => {
  it('carries code and structured values, not prose', () => {
    const d = warning('join.row_count_grew', { from: 4200, to: 61000, factor: 14.5 })

    expect(d.code).toBe('join.row_count_grew')
    expect(d.values.to).toBe(61000)
    expect(typeof d.values.factor).toBe('number')
  })

  it('is frozen, because a cache entry replays it (AD-8)', () => {
    const d = info('source.loaded', { rows: 100 })

    expect(Object.isFrozen(d)).toBe(true)
    expect(Object.isFrozen(d.values)).toBe(true)
  })

  it('omits origin keys that were not given', () => {
    expect('stepId' in info('x')).toBe(false)
    expect(info('x', {}, { stepId: 's1' }).stepId).toBe('s1')
  })

  it('refuses an unknown severity and an empty code', () => {
    expect(() => diagnostic('fatal', 'x')).toThrow(TypeError)
    expect(() => diagnostic('info', '')).toThrow(TypeError)
  })

  it('has a fourth severity for states awaiting a person', () => {
    // CAP-9: nothing in the column settles the reading. Not a warning, not an
    // error — undecided. Collapsing this into `warning` is the defect the
    // fourth severity exists to prevent.
    expect(unresolved('types.locale_ambiguous', { column: 'Betrag' }).severity).toBe('unresolved')
  })
})

describe('runStatus()', () => {
  it('is clean only when nothing above info was emitted', () => {
    expect(runStatus([info('a'), info('b')]).clean).toBe(true)
    expect(runStatus([info('a'), warning('b')]).clean).toBe(false)
    expect(runStatus([error('a')]).clean).toBe(false)
  })

  it('does not call a run clean while something awaits a person', () => {
    expect(runStatus([unresolved('types.locale_ambiguous')]).clean).toBe(false)
  })

  it('counts by severity so the UI can render a glance-level verdict', () => {
    const s = runStatus([info('a'), warning('b'), warning('c'), error('d')])

    expect(s.counts).toEqual({ info: 1, warning: 2, error: 1, unresolved: 0 })
    expect(s.diagnostics).toHaveLength(4)
  })
})
