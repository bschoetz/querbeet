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
import { DIRECTIONS } from './sort.js'

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
const sort = stepKind('sort')
const first = stepKind('first')

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
    expect(hasExecutor('sort')).toBe(true)
    expect(hasExecutor('first')).toBe(true)
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
    // Two ways a value can fail to be canonical, and the second is the one that
    // is easy to leave out. `31.12.2025` is the display form — CAP-15 says a
    // stored value is never one, and guessing which of the two numbers is the
    // day is the silent reinterpretation this product exists to remove. And
    // `2025-02-30` has the *shape* of a date and is not one: without a range
    // check `Date` rolls it over to 2 March and the filter compares against a
    // day nobody named.
    const refusals = [
      '31.12.2025', // display form
      '2025-02-30', // shape right, range wrong
      '2025-13-45',
      '999999-01-01', // past what a `Date` can hold
    ]

    for (const value of refusals) {
      const { table: out, diagnostics } = filter.apply(engine, [table([DATES])], {
        combine: 'all',
        conditions: [{ column: 'Datum', op: 'gt', value }],
      })

      expect(out, `accepted ${value}`).toBeNull()
      expect(diagnostics[0]).toMatchObject({
        code: CODE.valueUnreadable,
        values: { column: 'Datum', type: 'date', value },
      })
    }
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

// ---------------------------------------------------------------------- Sort

describe('a Sort’s configuration', () => {
  it('starts empty, so a freshly added Step passes every row in input order', () => {
    const config = sort.defaultConfig()
    expect(config).toEqual({ keys: [] })
    expect(sort.validate(config).ok).toBe(true)

    const input = table([NAMES, AMOUNTS])
    const { table: out, diagnostics } = sort.apply(engine, [input], config)

    // The identity is the input handle itself: no copy, no comparator.
    expect(out).toBe(input)
    expect(diagnostics).toEqual([])
  })

  it('refuses a shape that is not a configuration, naming the field', () => {
    const refusals = (config) => sort.validate(config).diagnostics.map((d) => d.values.field)

    expect(refusals(null)).toEqual(['config'])
    expect(refusals({ keys: 'nope' })).toEqual(['keys'])
    expect(refusals({ keys: [{ column: '', direction: 'asc' }] })).toEqual(['key'])
    expect(refusals({ keys: [{ column: 'Betrag', direction: 'aufwärts' }] })).toEqual(['direction'])
  })

  it('takes an absent direction as ascending, in one reader', () => {
    expect(sort.validate({ keys: [{ column: 'Betrag' }] }).ok).toBe(true)
    // …and the same reader decides it at execution, so the two cannot disagree.
    const { table: out } = sort.apply(engine, [table([NAMES, AMOUNTS])], {
      keys: [{ column: 'Betrag' }],
    })
    expect(rowsOf(out).map((r) => r.Betrag)).toEqual([250, 500, 1000, 1000])
  })

  it('refuses two keys naming one column, naming the column', () => {
    // Refused at configure time, where the previous config stays in force and
    // the user is still looking at the control that caused it — the same place
    // CAP-16's rename collision is refused, and for the same reason: two equal
    // keys are equal whatever flows through.
    const { ok, diagnostics } = sort.validate({
      keys: [
        { column: 'Betrag', direction: 'asc' },
        { column: 'Betrag', direction: 'desc' },
      ],
    })

    expect(ok).toBe(false)
    expect(diagnostics[0]).toMatchObject({
      code: CODE.sortKeyRepeated,
      values: { column: 'Betrag', at: 1 },
    })
  })

  it('names a repeated column even where that key’s direction is wrong too', () => {
    // The column is registered before the direction is judged. Returning early
    // on the direction meant a config with both defects was refused twice,
    // naming a different defect each time — so fixing the first one produced a
    // *new* refusal, which reads as damage the fix caused.
    const { ok, diagnostics } = sort.validate({
      keys: [
        { column: 'Betrag', direction: 'asc' },
        { column: 'Betrag', direction: 'aufwärts' },
      ],
    })

    expect(ok).toBe(false)
    expect(codesOf(diagnostics)).toEqual([CODE.sortKeyRepeated, CODE.configInvalid])
    expect(diagnostics[1].values).toMatchObject({ field: 'direction', at: 1 })
  })

  it('closes its direction vocabulary, because AD-30 forbids a formula surface', () => {
    // Two words and no third: there is no "letzte N" downstream either, because
    // descending plus *Erste N* is the same thing.
    expect(DIRECTIONS).toEqual(['asc', 'desc'])
  })
})

describe('a Sort’s execution', () => {
  it('orders by one key in both directions, and removes nothing', () => {
    const input = table([NAMES, AMOUNTS])

    const down = sort.apply(engine, [input], { keys: [{ column: 'Betrag', direction: 'desc' }] })
    expect(rowsOf(down.table).map((r) => r.Betrag)).toEqual([1000, 1000, 500, 250])
    expect(down.table.rowCount()).toBe(4)
    // A Sort takes nothing away, so it has nothing to report about counts.
    expect(down.diagnostics).toEqual([])

    const up = sort.apply(engine, [input], { keys: [{ column: 'Betrag', direction: 'asc' }] })
    expect(rowsOf(up.table).map((r) => r.Betrag)).toEqual([250, 500, 1000, 1000])
  })

  it('puts a boxed value last in both directions, and says how many rows that was', () => {
    const withBox = {
      name: 'Betrag',
      type: 'number',
      values: [1000, 'ungefähr 500', 250, 'ca. 40'],
      unparsed: [1, 3],
    }
    const input = table([NAMES, withBox])

    for (const direction of ['asc', 'desc']) {
      const { table: out, diagnostics } = sort.apply(engine, [input], {
        keys: [{ column: 'Betrag', direction }],
      })

      // No row leaves — this is a placement, not an exclusion.
      expect(out.rowCount()).toBe(4)
      expect(rowsOf(out).slice(-2).map((r) => r.Kunde).sort()).toEqual(['Bernd', 'Dora'])
      expect(diagnostics[0], `no warning going ${direction}`).toMatchObject({
        severity: 'warning',
        code: CODE.boxedRowsLast,
        values: { rows: 2 },
      })
    }
  })

  it('puts an empty cell last in both directions, and reports nothing about it', () => {
    // An empty cell is data the user can see in the preview and it lands where
    // the form says it lands; a diagnostic about it would be a warning about
    // nothing. `null < 1` is `true` in JavaScript, which is why it has to be
    // *placed* rather than compared all the same.
    const sparse = { name: 'Betrag', type: 'number', values: [1000, null, 250, null] }
    const input = table([NAMES, sparse])

    const up = sort.apply(engine, [input], { keys: [{ column: 'Betrag', direction: 'asc' }] })
    expect(rowsOf(up.table).map((r) => r.Betrag)).toEqual([250, 1000, null, null])
    expect(up.diagnostics).toEqual([])

    const down = sort.apply(engine, [input], { keys: [{ column: 'Betrag', direction: 'desc' }] })
    expect(rowsOf(down.table).map((r) => r.Betrag)).toEqual([1000, 250, null, null])
  })

  it('compares German text the way German reads it', () => {
    const words = { name: 'Kunde', type: 'text', values: ['Äpfel', 'Apfel', 'Zebra', 'Öl'] }
    const { table: out } = sort.apply(engine, [table([words])], {
      keys: [{ column: 'Kunde', direction: 'asc' }],
    })

    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Apfel', 'Äpfel', 'Öl', 'Zebra'])
  })

  it('lets a second key decide the ties the first one left', () => {
    const groups = { name: 'Gruppe', type: 'text', values: ['b', 'a', 'b', 'a'] }
    const { table: out } = sort.apply(engine, [table([groups, AMOUNTS])], {
      keys: [
        { column: 'Gruppe', direction: 'asc' },
        { column: 'Betrag', direction: 'desc' },
      ],
    })

    expect(rowsOf(out)).toEqual([
      { Gruppe: 'a', Betrag: 500 },
      { Gruppe: 'a', Betrag: 250 },
      { Gruppe: 'b', Betrag: 1000 },
      { Gruppe: 'b', Betrag: 1000 },
    ])
  })

  it('keeps ties in input order, and that is promised rather than hoped for', () => {
    const { table: out } = sort.apply(engine, [table([NAMES, AMOUNTS])], {
      keys: [{ column: 'Betrag', direction: 'desc' }],
    })

    // Anna and Carla both hold 1000, and Anna came first.
    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Anna', 'Carla', 'Bernd', 'Dora'])
  })

  it('orders a temporal column, which the adapter holds as `BigInt` nanoseconds', () => {
    const { table: out } = sort.apply(engine, [table([NAMES, DATES])], {
      keys: [{ column: 'Datum', direction: 'desc' }],
    })

    // 01.03.2026, 31.12.2025, 15.06.2025, 31.12.2024.
    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Carla', 'Anna', 'Dora', 'Bernd'])
  })

  it('refines the order of a Sort upstream rather than replacing it', () => {
    // Two Sort Steps in a row are an ordinary build — „nach Gruppe sortieren,
    // darin das Größte zuerst" — and the second one must tie-break on the
    // first's order rather than fall back to the input's. Without the chained
    // comparator this read `500, 250, 1000, 1000` by Gruppe: the inner order was
    // simply gone.
    const groups = { name: 'Gruppe', type: 'text', values: ['b', 'a', 'b', 'a'] }
    const inner = sort.apply(engine, [table([groups, AMOUNTS])], {
      keys: [{ column: 'Betrag', direction: 'desc' }],
    }).table
    expect(rowsOf(inner).map((r) => r.Betrag)).toEqual([1000, 1000, 500, 250])

    const { table: out } = sort.apply(engine, [inner], {
      keys: [{ column: 'Gruppe', direction: 'asc' }],
    })

    expect(rowsOf(out)).toEqual([
      { Gruppe: 'a', Betrag: 500 },
      { Gruppe: 'a', Betrag: 250 },
      { Gruppe: 'b', Betrag: 1000 },
      { Gruppe: 'b', Betrag: 1000 },
    ])

    // …and „die ersten N" over the chain is still the first N of what is on
    // screen, which is the whole reproducibility argument.
    expect(rowsOf(first.apply(engine, [out], { count: 2 }).table)).toEqual([
      { Gruppe: 'a', Betrag: 500 },
      { Gruppe: 'a', Betrag: 250 },
    ])
  })

  it('refuses a column its input no longer has, naming every one of them', () => {
    const { table: out, diagnostics } = sort.apply(engine, [table([NAMES])], {
      keys: [
        { column: 'Betrag', direction: 'asc' },
        { column: 'Datum', direction: 'asc' },
      ],
    })

    expect(out).toBeNull()
    expect(codesOf(diagnostics)).toEqual([CODE.unknownColumn, CODE.unknownColumn])
    expect(diagnostics.map((d) => d.values.column)).toEqual(['Betrag', 'Datum'])
  })
})

// ------------------------------------------------------------------- First N

describe('a First-N’s configuration', () => {
  it('starts without a count, so a freshly added Step lets every row through', () => {
    const config = first.defaultConfig()
    expect(config).toEqual({ count: null })
    expect(first.validate(config).ok).toBe(true)

    const input = table([NAMES, AMOUNTS])
    const { table: out, diagnostics } = first.apply(engine, [input], config)

    expect(out).toBe(input)
    expect(diagnostics).toEqual([])
  })

  it('refuses anything that is not a count, and `null` is not one of them', () => {
    // `0`, `-1` and `2.5` are shapes a Recipe out of a language model produces,
    // and each would otherwise reach the engine as a row range nobody asked for.
    // `null` says "no limit set" where `0` would have to mean either "no rows"
    // or "not set", and only one of those can be true.
    for (const count of [0, -1, 2.5, '3', Number.NaN, Infinity, {}]) {
      expect(first.validate({ count }).ok, `accepted ${String(count)} as a count`).toBe(false)
    }
    expect(first.validate({ count: null }).ok).toBe(true)
    expect(first.validate({}).ok).toBe(true)
    expect(first.validate({ count: 1 }).ok).toBe(true)
    // …and the refusal names the field the panel is showing.
    expect(first.validate({ count: 0 }).diagnostics[0]).toMatchObject({
      code: CODE.configInvalid,
      values: { field: 'count' },
    })
    expect(first.validate(null).diagnostics[0].values.field).toBe('config')
  })
})

describe('a First-N’s execution', () => {
  it('keeps the first N rows and counts what went', () => {
    const { table: out, diagnostics } = first.apply(engine, [table([NAMES, AMOUNTS])], { count: 3 })

    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Anna', 'Bernd', 'Carla'])
    expect(diagnostics[0]).toMatchObject({
      severity: 'info',
      code: CODE.rowsRemoved,
      values: { removed: 1, kept: 3 },
    })
  })

  it('keeps every row for a count at or above the row count, and says nothing went', () => {
    // Not an error: the honest limit is the data, so no upper bound is invented
    // and the Step reports rather than refuses.
    const { table: out, diagnostics } = first.apply(engine, [table([NAMES])], { count: 1000 })

    expect(out.rowCount()).toBe(4)
    expect(diagnostics[0]).toMatchObject({ code: CODE.rowsRemoved, values: { removed: 0, kept: 4 } })
  })

  it('takes the first N of the order a Sort upstream produced', () => {
    // The owner's case, as two Steps: *take the three largest and carry them on*.
    const ordered = sort.apply(engine, [table([NAMES, AMOUNTS])], {
      keys: [{ column: 'Betrag', direction: 'desc' }],
    }).table

    const { table: out } = first.apply(engine, [ordered], { count: 3 })

    expect(rowsOf(out).map((r) => r.Kunde)).toEqual(['Anna', 'Carla', 'Bernd'])
    expect(rowsOf(out).map((r) => r.Betrag)).toEqual([1000, 1000, 500])
  })
})
