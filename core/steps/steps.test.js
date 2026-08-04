// The two Step kinds and the registry in front of them, in the node envelope
// (AD-27) — no browser, no DOM.
//
// **The engine is the real one.** A Step kind's whole contract is that it never
// touches a cell, so the interesting assertions here are about what it asks the
// engine for and what comes back — a stub would let a Step read a value with
// nothing failing, which is the one property this design exists to keep. Reaching
// the adapter from a `core/` test is the seam `core/exec/convert.test.js` already
// established: a dynamic import, so no static import points from `core/` outward
// (AD-1). The ledger carries the note that the lint rule does not see one.

import { describe, expect, it } from 'vitest'
import { CODE, executorGaps, hasExecutor, stepKind } from './index.js'
import { COMBINES, OPERATORS, valueKind } from './filter.js'

const { createArqueroEngine } = await import('../../adapters/arquero/engine.js')

const engine = createArqueroEngine()

/** A small typed table. `unparsed` positions hold the file's own text, exactly
 *  as `convertSource` hands them over, and the adapter boxes them. */
const table = (columns) =>
  engine.fromColumns(
    columns.map((c) => ({
      name: c.name,
      type: c.type,
      values: [...c.values],
      unparsed: Object.freeze(c.unparsed ?? []),
    })),
  )

const AMOUNTS = { name: 'Betrag', type: 'number', values: [1000, 500, 1000, 250] }
const NAMES = { name: 'Kunde', type: 'text', values: ['Anna', 'Bernd', 'Carla', 'Dora'] }
/** 31.12.2025, 31.12.2024, 01.03.2026, 15.06.2025 as UTC-midnight epoch ns. */
const DATES = {
  name: 'Datum',
  type: 'date',
  values: [1767139200000000000n, 1735603200000000000n, 1772323200000000000n, 1750032000000000000n],
}

const filter = stepKind('filter')
const columns = stepKind('columns')

const codesOf = (diagnostics) => diagnostics.map((d) => d.code)
const rowsOf = (t) => [...t.rows()]

describe('the registry', () => {
  it('names exactly the kinds no file here implements', () => {
    // The gap is the schedule: stories 8 and 9 close it by adding files, and
    // `core/exec/execute.js` refuses a run naming the Step and its kind until
    // they do. A Source is absent and is not a gap — its conversion is Step zero.
    expect(executorGaps()).toEqual(['union', 'join', 'computed', 'aggregate'])
    expect(hasExecutor('filter')).toBe(true)
    expect(hasExecutor('columns')).toBe(true)
    expect(hasExecutor('source')).toBe(false)
  })

  it('answers null for a kind it does not know, rather than throwing', () => {
    // The frontier of a run is data, so a kind without an executor is a state of
    // the graph rather than a caller's bug — and a TypeError out of the registry
    // is not a Diagnostic anyone can render.
    expect(stepKind('union')).toBeNull()
    expect(stepKind('nonsense')).toBeNull()
  })
})

// -------------------------------------------------------------------- Filter

describe('a Filter’s configuration', () => {
  it('starts empty, so a freshly added Step passes every row', () => {
    const config = filter.defaultConfig()
    expect(config).toEqual({ combine: 'all', conditions: [] })
    expect(filter.validate(config).ok).toBe(true)

    const { table: out, diagnostics } = filter.apply(engine, [table([NAMES, AMOUNTS])], config)
    expect(out.rowCount()).toBe(4)
    expect(codesOf(diagnostics)).toEqual([CODE.rowsRemoved])
  })

  it('refuses a shape that is not a configuration, naming the field', () => {
    const refusals = (config) => filter.validate(config).diagnostics.map((d) => d.values.field)

    expect(refusals(null)).toEqual(['config'])
    expect(refusals({ combine: 'either', conditions: [] })).toEqual(['combine'])
    expect(refusals({ combine: 'all', conditions: 'nope' })).toEqual(['conditions'])
    expect(refusals({ combine: 'all', conditions: [{ column: '', op: 'eq', value: 1 }] })).toEqual([
      'column',
    ])
    expect(
      refusals({ combine: 'all', conditions: [{ column: 'a', op: 'matches', value: 1 }] }),
    ).toEqual(['op'])
  })

  it('refuses a value beside a valueless operator, and a value that is no value', () => {
    // `ist leer` takes nothing: a stale value carried under it would store a
    // shape nothing evaluates and nothing reports.
    const withValue = { combine: 'all', conditions: [{ column: 'a', op: 'empty', value: 1 }] }
    expect(filter.validate(withValue).ok).toBe(false)

    for (const value of [undefined, null, {}, [], Number.NaN, Infinity]) {
      const config = { combine: 'all', conditions: [{ column: 'a', op: 'eq', value }] }
      expect(filter.validate(config).ok, `accepted ${String(value)} as a comparison value`).toBe(
        false,
      )
    }
  })

  it('closes its vocabulary, because AD-30 forbids a formula surface', () => {
    expect(OPERATORS).toEqual(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'empty', 'not_empty'])
    expect(COMBINES).toEqual(['all', 'any'])
    expect(valueKind('x')).toBe('text')
    expect(valueKind(1)).toBe('number')
    expect(valueKind(true)).toBe('boolean')
    expect(valueKind(Number.NaN)).toBeNull()
  })
})

describe('a Filter’s execution', () => {
  it('keeps what a number condition admits, and counts what it removed', () => {
    const { table: out, diagnostics } = filter.apply(engine, [table([NAMES, AMOUNTS])], {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 1000 }],
    })

    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Anna', 'Carla'])
    // AD-13 — the count travels as a number, never inside a sentence.
    expect(diagnostics[0]).toMatchObject({
      severity: 'info',
      code: CODE.rowsRemoved,
      values: { removed: 2, kept: 2 },
    })
  })

  it('compares a date against an ISO 8601 string, converted once on the far side', () => {
    const { table: out } = filter.apply(engine, [table([NAMES, DATES])], {
      combine: 'all',
      conditions: [{ column: 'Datum', op: 'gt', value: '2025-12-31' }],
    })

    // Strictly after 31.12.2025: only 01.03.2026.
    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Carla'])
  })

  it('combines conditions by the rule the config names, and the rule is explicit', () => {
    const input = table([NAMES, AMOUNTS])
    const conditions = [
      { column: 'Betrag', op: 'gte', value: 500 },
      { column: 'Kunde', op: 'eq', value: 'Anna' },
    ]

    expect(
      rowsOf(filter.apply(engine, [input], { combine: 'all', conditions }).table).map((r) => r.Kunde),
    ).toEqual(['Anna'])
    expect(
      rowsOf(filter.apply(engine, [input], { combine: 'any', conditions }).table).map((r) => r.Kunde),
    ).toEqual(['Anna', 'Bernd', 'Carla'])
  })

  it('refuses a type disagreement naming both types, and produces no table', () => {
    // CAP-15's refusal, and the reason it lives here rather than at configure
    // time: `configureStep` cannot see an input schema.
    const { table: out, diagnostics } = filter.apply(engine, [table([NAMES, DATES])], {
      combine: 'all',
      conditions: [{ column: 'Datum', op: 'gt', value: 1000 }],
    })

    expect(out).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: CODE.typeMismatch,
      values: { column: 'Datum', columnType: 'date', valueType: 'number' },
    })
  })

  it('names every wrong condition rather than the first it tripped over', () => {
    const { diagnostics } = filter.apply(engine, [table([NAMES, AMOUNTS])], {
      combine: 'all',
      conditions: [
        { column: 'Betrag', op: 'eq', value: 'tausend' },
        { column: 'Umsatz', op: 'eq', value: 1 },
      ],
    })

    expect(codesOf(diagnostics)).toEqual([CODE.typeMismatch, CODE.unknownColumn])
  })

  it('refuses a temporal value that is not canonical, rather than guessing at it', () => {
    // `31.12.2025` is the display form, and CAP-15 says a stored value is never
    // one. Guessing which of the two numbers is the day is exactly the silent
    // reinterpretation this product exists to remove.
    const { table: out, diagnostics } = filter.apply(engine, [table([DATES])], {
      combine: 'all',
      conditions: [{ column: 'Datum', op: 'gt', value: '31.12.2025' }],
    })

    expect(out).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      code: CODE.valueUnreadable,
      values: { column: 'Datum', type: 'date', value: '31.12.2025' },
    })
  })

  it('matches null, the empty string and whitespace alike under "is empty"', () => {
    const text = { name: 'Notiz', type: 'text', values: [null, '', '   ', 'x'] }
    const empty = filter.apply(engine, [table([text])], {
      combine: 'all',
      conditions: [{ column: 'Notiz', op: 'empty' }],
    })

    expect(empty.table.rowCount()).toBe(3)
  })

  it('makes "is not empty" the exact complement over non-boxed values', () => {
    // A strict complement would smuggle every box through as non-empty text,
    // which is the silent pass AD-22 exists to prevent. So the box is in neither
    // half and is counted instead.
    const text = { name: 'Notiz', type: 'number', values: [null, '', 12, 'ungefähr'], unparsed: [3] }
    const input = table([text])

    const empty = filter.apply(engine, [input], {
      combine: 'all',
      conditions: [{ column: 'Notiz', op: 'empty' }],
    })
    const notEmpty = filter.apply(engine, [input], {
      combine: 'all',
      conditions: [{ column: 'Notiz', op: 'not_empty' }],
    })

    expect(empty.table.rowCount()).toBe(2)
    expect(notEmpty.table.rowCount()).toBe(1)
    // Two halves plus the box is the whole table, and the box is in neither.
    expect(empty.table.rowCount() + notEmpty.table.rowCount() + 1).toBe(4)
    expect(notEmpty.diagnostics.map((d) => d.code)).toContain(CODE.boxedRowsDropped)
  })

  it('drops a boxed comparison cell from every operator and says how many', () => {
    const withBox = {
      name: 'Betrag',
      type: 'number',
      values: [1000, 'ungefähr 500', 1000, 'ca. 250'],
      unparsed: [1, 3],
    }
    const { table: out, diagnostics } = filter.apply(engine, [table([NAMES, withBox])], {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'gte', value: 0 }],
    })

    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Anna', 'Carla'])
    expect(diagnostics.find((d) => d.code === CODE.boxedRowsDropped)).toMatchObject({
      severity: 'warning',
      values: { rows: 2 },
    })
  })

  it('does not count a boxed row that another condition admitted', () => {
    // Under `any` a row with a box in one column and a match in another is kept,
    // and reporting it as dropped would be a number about nothing.
    const withBox = { name: 'Betrag', type: 'number', values: [1000, 'ungefähr'], unparsed: [1] }
    const { table: out, diagnostics } = filter.apply(engine, [table([NAMES, withBox])], {
      combine: 'any',
      conditions: [
        { column: 'Betrag', op: 'gt', value: 0 },
        { column: 'Kunde', op: 'eq', value: 'Bernd' },
      ],
    })

    expect(out.rowCount()).toBe(2)
    expect(codesOf(diagnostics)).not.toContain(CODE.boxedRowsDropped)
  })

  it('never matches a null under an ordering operator', () => {
    // `null < 5` is `true` in JavaScript, so an absent value would otherwise join
    // every "smaller than" filter in the product.
    const sparse = { name: 'Betrag', type: 'number', values: [1, null, 3] }
    const { table: out } = filter.apply(engine, [table([sparse])], {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'lt', value: 5 }],
    })

    expect(out.rowCount()).toBe(2)
  })
})

// ------------------------------------------------------------------- Columns

describe('a Columns configuration', () => {
  it('refuses a rename onto a name already in use, naming the collision', () => {
    const { ok, diagnostics } = columns.validate({
      columns: [
        { from: 'Kunde', to: 'Name' },
        { from: 'Betrag', to: 'Name' },
      ],
    })

    expect(ok).toBe(false)
    expect(diagnostics[0]).toMatchObject({ code: CODE.renameCollision, values: { name: 'Name' } })
  })

  it('takes an absent `to` as "unchanged", in one reader', () => {
    expect(columns.validate({ columns: [{ from: 'Kunde' }] }).ok).toBe(true)
    // …and the same reader decides it at execution, so the two cannot disagree.
    const { table: out } = columns.apply(engine, [table([NAMES, AMOUNTS])], {
      columns: [{ from: 'Kunde' }],
    })
    expect(out.schema().map((c) => c.name)).toEqual(['Kunde'])
  })

  it('refuses a shape that is not a configuration', () => {
    expect(columns.validate(null).ok).toBe(false)
    expect(columns.validate({ columns: 'nope' }).ok).toBe(false)
    expect(columns.validate({ columns: [{ from: 1 }] }).ok).toBe(false)
    expect(columns.validate({ columns: [{ from: 'a', to: '' }] }).ok).toBe(false)
  })
})

describe('a Columns execution', () => {
  it('makes config order the output order (CAP-16)', () => {
    const { table: out } = columns.apply(engine, [table([NAMES, AMOUNTS, DATES])], {
      columns: [
        { from: 'Datum', to: 'Datum' },
        { from: 'Kunde', to: 'Kunde' },
      ],
    })

    expect(out.schema()).toEqual([
      { name: 'Datum', type: 'date' },
      { name: 'Kunde', type: 'text' },
    ])
    expect(Object.keys(rowsOf(out)[0])).toEqual(['Datum', 'Kunde'])
  })

  it('carries a column’s type across a rename', () => {
    const { table: out } = columns.apply(engine, [table([DATES])], {
      columns: [{ from: 'Datum', to: 'Buchungstag' }],
    })

    expect(out.schema()).toEqual([{ name: 'Buchungstag', type: 'date' }])
  })

  it('passes the input through untouched when nothing is chosen yet', () => {
    // The identity is the input handle itself: no copy, no new schema, and the
    // counts downstream are the input's because that is what is being passed on.
    const input = table([NAMES, AMOUNTS])
    const { table: out } = columns.apply(engine, [input], columns.defaultConfig())

    expect(out).toBe(input)
  })

  it('refuses a column its input no longer has, naming it', () => {
    const { table: out, diagnostics } = columns.apply(engine, [table([NAMES])], {
      columns: [{ from: 'Betrag', to: 'Betrag' }],
    })

    expect(out).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      code: CODE.unknownColumn,
      values: { column: 'Betrag' },
    })
  })

  it('honours the filter of the table it selects from', () => {
    const filtered = filter.apply(engine, [table([NAMES, AMOUNTS])], {
      combine: 'all',
      conditions: [{ column: 'Betrag', op: 'eq', value: 1000 }],
    }).table

    const { table: out } = columns.apply(engine, [filtered], {
      columns: [{ from: 'Kunde', to: 'Kunde' }],
    })

    expect(out.rowCount()).toBe(2)
    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Anna', 'Carla'])
  })
})
