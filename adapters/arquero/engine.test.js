// The `TableEngine` adapter, under `--project core` with `environment: 'node'`.
//
// An adapter is framework-free code behind a port, which is why it is tested in
// the node envelope beside `core/` rather than through a browser (AD-27). What is
// under test here is not "does Arquero work" — it is the two things AD-19 says
// this adapter absorbs so that no Step kind ever has to: the box, and `BigInt`.
//
// The box is the harder one to test honestly, because the whole promise is that
// it is *invisible*. So every assertion about it is made from outside: through
// `rows()`, through `column()`, and through the fact that neither ever hands one
// out. Nothing here imports the box's representation, and there is nothing to
// import — which is the property.

import { describe, expect, it } from 'vitest'
import { comparisonValue, createArqueroEngine } from './engine.js'

const engine = createArqueroEngine()

/** A column as `core/exec/convert.js` hands it over: the values, plus the
 *  indices holding original text for the adapter to box. */
const column = (name, type, values, unparsed = []) => ({ name, type, values, unparsed })

describe('building a table column-wise', () => {
  it('reports its shape and its confirmed types, without materializing a row', () => {
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd']),
      column('Betrag', 'number', [1234.56, 80]),
      column('Datum', 'date', [1767139200000000000n, 1772323200000000000n]),
    ])

    expect(t.rowCount()).toBe(2)
    expect(t.schema()).toEqual([
      { name: 'Kunde', type: 'text' },
      { name: 'Betrag', type: 'number' },
      { name: 'Datum', type: 'date' },
    ])
  })

  it('keeps the column order it was given, whatever the names look like', () => {
    // A column called `1` or `07` is an ordinary header cell, and an
    // integer-like key enumerates before every string one on a plain object —
    // so a table built from key order alone would silently reorder the columns
    // of any export whose first column is a year.
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna']),
      column('2025', 'number', [1]),
      column('07', 'text', ['x']),
    ])

    expect(t.schema().map((c) => c.name)).toEqual(['Kunde', '2025', '07'])
  })

  it('holds a column whose name would collide with an object’s own machinery', () => {
    // Measured before this was fixed, and the reason the assertion goes all the
    // way to `rows()`: `schema()` reported the column and `column()` answered
    // with its values while **every row object was silently one key short** —
    // `out[name] = value` against `__proto__` is a no-op on anything inheriting
    // from `Object.prototype`, and arquero's own row builder drops it too. A test
    // that stopped at the first two assertions was shaped around the bug.
    const t = engine.fromColumns([
      column('__proto__', 'text', ['a', 'b']),
      column('constructor', 'text', ['c', 'd']),
    ])

    expect(t.schema().map((c) => c.name)).toEqual(['__proto__', 'constructor'])
    expect([...t.column('__proto__')]).toEqual(['a', 'b'])

    const rows = [...t.rows()]
    expect(rows.map((r) => Object.keys(r))).toEqual([
      ['__proto__', 'constructor'],
      ['__proto__', 'constructor'],
    ])
    expect(Object.hasOwn(rows[0], '__proto__')).toBe(true)
    expect(rows[0]['__proto__']).toBe('a')
    expect(rows[1]['__proto__']).toBe('b')
    // …and the row is still a plain object, which is what AD-5 promises: the
    // key is written with `defineProperty` rather than by moving the prototype.
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype)
    // Round-trips through JSON as the key it is. The expectation is *parsed*
    // rather than written as a literal, because `{ __proto__: 'a' }` in source
    // sets the prototype instead of creating the key — the same trap one level
    // out, and it caught this assertion on its first run.
    expect(JSON.parse(JSON.stringify(rows[0]))).toEqual(
      JSON.parse('{"__proto__":"a","constructor":"c"}'),
    )
  })

  it('boxes a `__proto__` column’s failures like any other', () => {
    // The two hazards meeting: the name that vanishes and the cell that is a box.
    const t = engine.fromColumns([column('__proto__', 'number', [1.5, 'abc'], [1])])

    expect([...t.column('__proto__')]).toEqual([1.5, 'abc'])
    expect([...t.rows()].map((r) => r['__proto__'])).toEqual([1.5, 'abc'])
  })

  it('refuses two columns of one name rather than losing one of them', () => {
    // A Table is keyed by name — `column(name)` says so — so a repeated header
    // cannot be held. Refusing names the problem; the engine's own map would
    // silently keep the second and answer for both.
    expect(() =>
      engine.fromColumns([column('Datum', 'date', [1n]), column('Datum', 'date', [2n])]),
    ).toThrow(TypeError)
  })

  it('names a column nobody asked about rather than answering `undefined`', () => {
    const t = engine.fromColumns([column('Kunde', 'text', ['Anna'])])

    expect(() => t.column('Nachname')).toThrow(TypeError)
  })

  it('holds an empty table', () => {
    const t = engine.fromColumns([])

    expect(t.rowCount()).toBe(0)
    expect(t.schema()).toEqual([])
    expect([...t.rows()]).toEqual([])
  })
})

describe('the box, from outside (AD-22)', () => {
  const boxed = () =>
    engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd', 'Carla']),
      column('Betrag', 'number', [1234.56, 'ungefähr 80', 42], [1]),
    ])

  it('materializes as the original text through `column()`', () => {
    expect([...boxed().column('Betrag')]).toEqual([1234.56, 'ungefähr 80', 42])
  })

  it('materializes as the original text through `rows()`', () => {
    expect([...boxed().rows()]).toEqual([
      { Kunde: 'Anna', Betrag: 1234.56 },
      { Kunde: 'Bernd', Betrag: 'ungefähr 80' },
      { Kunde: 'Carla', Betrag: 42 },
    ])
  })

  it('is not observable as a wrapper at either edge', () => {
    // The promise is that no consumer can learn the representation and then
    // depend on it. A plain-value test is what a consumer could actually write.
    const t = boxed()
    const cell = [...t.rows()][1].Betrag

    expect(typeof cell).toBe('string')
    expect(cell).toBe('ungefähr 80')
    expect(Object.keys([...t.rows()][1])).toEqual(['Kunde', 'Betrag'])
  })

  it('boxes exactly the indices it was handed, and nothing that merely looks alike', () => {
    // A text column full of strings and a boxed number column full of the same
    // strings are indistinguishable at the edge — which is correct — so what is
    // asserted is that the adapter boxed by *index* rather than by inspecting a
    // value, since the values it boxed are strings a text column holds happily.
    const t = engine.fromColumns([column('Betrag', 'number', ['a', 'b', 'c'], [0, 2])])

    expect([...t.column('Betrag')]).toEqual(['a', 'b', 'c'])
  })
})

describe('what crosses at an edge', () => {
  it('yields plain frozen row objects (AD-5)', () => {
    const t = engine.fromColumns([column('Kunde', 'text', ['Anna'])])
    const [row] = [...t.rows()]

    expect(Object.isFrozen(row)).toBe(true)
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
  })

  it('yields rows one at a time rather than building the whole table', () => {
    // `rows()` is the edge, and an edge that materialized a hundred thousand
    // rows to show fifty would be a silent copy of the dataset. Taking two rows
    // of a hundred is what a preview does.
    const t = engine.fromColumns([
      column('n', 'number', Array.from({ length: 100 }, (_, i) => i)),
    ])

    const iterator = t.rows()[Symbol.iterator]()
    expect(iterator.next().value).toEqual({ n: 0 })
    expect(iterator.next().value).toEqual({ n: 1 })
  })

  it('hands out a frozen column array', () => {
    const t = engine.fromColumns([column('n', 'number', [1, 2, 3])])

    expect(Object.isFrozen(t.column('n'))).toBe(true)
  })

  it('carries a temporal column as `BigInt` all the way out (AD-21)', () => {
    // One unit for all four temporal types, and it is nanoseconds as a `BigInt`
    // — because a `datetime2(7)` timestamp is already past MAX_SAFE_INTEGER.
    // What matters at the edge is that the value is not quietly a `Number`.
    const ns = 1_770_998_255_461_672_700n
    const t = engine.fromColumns([column('Zeitpunkt', 'datetime', [ns])])

    expect(t.column('Zeitpunkt')[0]).toBe(ns)
    expect(typeof [...t.rows()][0].Zeitpunkt).toBe('bigint')

    // And the reason the unit is `BigInt` rather than a number, stated as the
    // measurement rather than as a claim: this value and the next nanosecond are
    // the same `Number`, so a temporal column held as one has already lost.
    expect(Number(ns)).toBe(Number(ns + 1n))
  })
})

// ------------------------------------------------------ the two verbs (6b)
//
// What is under test here is again not "does Arquero filter" — it is the three
// things this side of the port owns and no Step kind may learn: that a box
// matches no operator and is counted, that an ISO 8601 comparison value becomes
// nanoseconds on this side, and that a filtered or reordered table still reads
// correctly at its edges.

describe('filter', () => {
  const REPORT = () => [
    column('Kunde', 'text', ['Anna', 'Bernd', 'Carla', 'Dora']),
    column('Betrag', 'number', [1000, 500, 1000, 250]),
  ]

  const names = (t) => [...t.rows()].map((r) => r.Kunde)

  it('shares its columns with the input rather than copying them', () => {
    // The whole memory argument for `ColumnTable`: CAP-19 retains every Step's
    // output, so a chain that copied twenty column arrays per link would cost
    // 19.8 MB at the design shape where sharing costs a BitSet.
    const t = engine.fromColumns(REPORT())
    const out = engine.filter(t, { conditions: [{ column: 'Betrag', op: 'gt', value: 400 }] })

    expect(out.table.rowCount()).toBe(3)
    // The input is untouched — a Step may not mutate its inputs (AD-4).
    expect(t.rowCount()).toBe(4)
  })

  it('counts what it removed and what a box excluded, separately', () => {
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd', 'Carla']),
      column('Betrag', 'number', [1000, 'ungefähr 500', 250], [1]),
    ])

    const out = engine.filter(t, { conditions: [{ column: 'Betrag', op: 'gt', value: 400 }] })

    expect(names(out.table)).toEqual(['Anna'])
    expect(out.removed).toBe(2)
    expect(out.boxed).toBe(1)
  })

  it('lets no box match any operator, `not_empty` included (AD-22)', () => {
    const t = engine.fromColumns([column('Betrag', 'number', ['ungefähr'], [0])])

    for (const op of ['eq', 'ne', 'lt', 'lte', 'gt', 'gte']) {
      expect(engine.filter(t, { conditions: [{ column: 'Betrag', op, value: 0 }] }).table.rowCount(),
        `a box matched ${op}`).toBe(0)
    }
    expect(engine.filter(t, { conditions: [{ column: 'Betrag', op: 'empty' }] }).table.rowCount()).toBe(0)
    expect(
      engine.filter(t, { conditions: [{ column: 'Betrag', op: 'not_empty' }] }).table.rowCount(),
    ).toBe(0)
  })

  it('converts an ISO 8601 comparison value to nanoseconds, on this side', () => {
    // AD-21 — `core/` may not construct a `BigInt` temporal value, so the string
    // is the canonical machine form that crosses the port. 31.12.2025, 31.12.2024
    // and 01.03.2026 as UTC-midnight epoch ns.
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd', 'Carla']),
      column('Datum', 'date', [1767139200000000000n, 1735603200000000000n, 1772323200000000000n]),
    ])

    expect(
      names(engine.filter(t, { conditions: [{ column: 'Datum', op: 'gte', value: '2025-12-31' }] }).table),
    ).toEqual(['Anna', 'Carla'])
    expect(
      names(engine.filter(t, { conditions: [{ column: 'Datum', op: 'eq', value: '2025-12-31' }] }).table),
    ).toEqual(['Anna'])
  })

  it('refuses a component out of range instead of letting `Date` roll it over', () => {
    // `Date.UTC(2025, 1, 30)` is 2 March and `Date.UTC(2025, 12, 45)` is 14
    // February 2026 — silently, with no signal of any kind. This file's contract
    // is that a value which is not a canonical form is refused rather than
    // guessed at, and a pattern match alone only ever checks the *shape*.
    for (const value of [
      '2025-02-30', // February has 28 days in 2025
      '2025-13-45',
      '2025-00-00',
      '2025-01-32',
      '999999-01-01', // past what a `Date` can hold at all
    ]) {
      expect(comparisonValue('date', value), `accepted ${value} as a date`).toBeNull()
    }
    // …and the leap day itself still reads, so the guard is a range check rather
    // than a blanket refusal of the 29th.
    expect(comparisonValue('date', '2024-02-29')).not.toBeNull()
    expect(comparisonValue('date', '2025-02-29')).toBeNull()

    for (const value of ['14:99', '23:59:99', '24:00', '99:00']) {
      expect(comparisonValue('time', value), `accepted ${value} as a time`).toBeNull()
    }
    for (const value of [
      '2025-01-01T29:99:99',
      '2025-01-01T23:60',
      '2025-02-30T12:00',
      '2025-01-01T12:00+99:99',
    ]) {
      expect(comparisonValue('datetime', value), `accepted ${value} as a datetime`).toBeNull()
    }
    // A real offset is still read, so the offset guard is a bound rather than a
    // refusal of zones.
    expect(comparisonValue('datetime', '2025-12-31T16:30:00+02:00')).toBe(
      comparisonValue('datetime', '2025-12-31T14:30:00Z'),
    )
  })

  it('never throws for a value it cannot read — `null` is the whole vocabulary', () => {
    // `999999-01-01` produced `RangeError: The number NaN cannot be converted to
    // a BigInt`, and both callers of the executor are on a render path, so a
    // throw here reached the user as a blank Editor.
    for (const type of ['date', 'datetime', 'time', 'duration']) {
      for (const value of ['999999-01-01', '2025-02-30', '', 'nonsense', '2025-01-01T99:99']) {
        expect(() => comparisonValue(type, value)).not.toThrow()
      }
    }
  })

  it('reads the four temporal shapes it accepts, and refuses everything else', () => {
    const at = (type, values) => engine.fromColumns([column('v', type, values)])
    const kept = (type, values, value, op = 'eq') =>
      engine.filter(at(type, values), { conditions: [{ column: 'v', op, value }] })

    // A datetime with an offset, a clock, and a signed duration.
    expect(kept('datetime', [1767191400000000000n], '2025-12-31T14:30:00Z').table.rowCount()).toBe(1)
    expect(kept('datetime', [1767191400000000000n], '2025-12-31 16:30:00+02:00').table.rowCount()).toBe(1)
    expect(kept('time', [52200000000000n], '14:30').table.rowCount()).toBe(1)
    expect(kept('duration', [-5400000000000n], '-01:30').table.rowCount()).toBe(1)

    // A display form is not a canonical value, and is reported rather than guessed.
    const refused = kept('date', [0n], '31.12.2025')
    expect(refused.table).toBeNull()
    expect(refused.unreadable).toEqual([{ column: 'v', type: 'date', value: '31.12.2025' }])
  })

  it('honours a filter already in force, so a chain narrows rather than restarts', () => {
    const t = engine.fromColumns(REPORT())
    const first = engine.filter(t, { conditions: [{ column: 'Betrag', op: 'gte', value: 500 }] }).table
    const second = engine.filter(first, { conditions: [{ column: 'Kunde', op: 'ne', value: 'Anna' }] })

    expect(names(second.table)).toEqual(['Bernd', 'Carla'])
    expect(second.removed).toBe(1)
  })

  it('counts a boxed row the same whichever order the conditions were added in', () => {
    // Short-circuiting on the first failing condition made this number depend on
    // the order a form happened to be filled in: a row failing condition 1
    // normally and holding a box in condition 2 was not counted, and swapping
    // the two counted it. A number the user is asked to trust may not do that.
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd']),
      column('Betrag', 'number', [1000, 'ungefähr'], [1]),
    ])
    const byName = { column: 'Kunde', op: 'eq', value: 'Anna' }
    const byAmount = { column: 'Betrag', op: 'gt', value: 0 }

    const first = engine.filter(t, { conditions: [byName, byAmount], combine: 'all' })
    const second = engine.filter(t, { conditions: [byAmount, byName], combine: 'all' })

    // Bernd is excluded by the name condition *and* holds a box in the amount
    // column; the count is the same read either way round.
    expect(first.boxed).toBe(second.boxed)
    expect(first.boxed).toBe(1)
    expect(first.table.rowCount()).toBe(second.table.rowCount())
  })

  it('refuses a combination rule outside the closed vocabulary', () => {
    // The silent default was `any`, so a typo in a stored config would have
    // *widened* a result set with nothing on screen to say so.
    const t = engine.fromColumns(REPORT())
    expect(() => engine.filter(t, { conditions: [], combine: 'either' })).toThrow(
      /unknown combination rule/,
    )
  })

  it('keeps every row when there is no condition at all', () => {
    const out = engine.filter(engine.fromColumns(REPORT()), { conditions: [], combine: 'all' })
    expect(out.table.rowCount()).toBe(4)
    expect(out.removed).toBe(0)
  })

  it('throws for a column no table has — a refusal one layer up, a bug here', () => {
    const t = engine.fromColumns(REPORT())
    expect(() => engine.filter(t, { conditions: [{ column: 'Umsatz', op: 'eq', value: 1 }] })).toThrow(
      /no column Umsatz/,
    )
  })

  it('refuses a handle another engine produced', () => {
    const other = createArqueroEngine()
    const t = other.fromColumns(REPORT())
    expect(() => engine.filter(t, { conditions: [] })).toThrow(/not produced by this engine/)
  })
})

describe('selectColumns', () => {
  const THREE = () => [
    column('Kunde', 'text', ['Anna', 'Bernd']),
    column('Betrag', 'number', [1000, 500]),
    column('Datum', 'date', [1767139200000000000n, 1735603200000000000n]),
  ]

  it('makes the given order the output order, and carries the types', () => {
    const out = engine.selectColumns(engine.fromColumns(THREE()), [
      { from: 'Datum', to: 'Buchungstag' },
      { from: 'Kunde', to: 'Kunde' },
    ])

    expect(out.schema()).toEqual([
      { name: 'Buchungstag', type: 'date' },
      { name: 'Kunde', type: 'text' },
    ])
    expect([...out.rows()]).toEqual([
      { Buchungstag: 1767139200000000000n, Kunde: 'Anna' },
      { Buchungstag: 1735603200000000000n, Kunde: 'Bernd' },
    ])
  })

  it('keeps the box invisible across a rename', () => {
    const t = engine.fromColumns([column('Betrag', 'number', [1000, 'ungefähr'], [1])])
    const out = engine.selectColumns(t, [{ from: 'Betrag', to: 'Summe' }])

    // The original text at the edge, exactly as before the rename — the mark is
    // what a later story adds, and the *value* is what is guaranteed here.
    expect(out.column('Summe')).toEqual([1000, 'ungefähr'])
    expect([...out.rows()][1]).toEqual({ Summe: 'ungefähr' })
  })

  it('inherits the filter of the table it selects from', () => {
    const filtered = engine.filter(engine.fromColumns(THREE()), {
      conditions: [{ column: 'Betrag', op: 'gt', value: 600 }],
    }).table
    const out = engine.selectColumns(filtered, [{ from: 'Kunde', to: 'Kunde' }])

    expect(out.rowCount()).toBe(1)
    expect([...out.rows()]).toEqual([{ Kunde: 'Anna' }])
  })

  it('throws on a collision and on an unknown column — both refused one layer up', () => {
    const t = engine.fromColumns(THREE())

    expect(() =>
      engine.selectColumns(t, [
        { from: 'Kunde', to: 'X' },
        { from: 'Betrag', to: 'X' },
      ]),
    ).toThrow(/two columns called X/)
    expect(() => engine.selectColumns(t, [{ from: 'Umsatz', to: 'Umsatz' }])).toThrow(/no column Umsatz/)
  })

  it('keeps a column called `__proto__` reachable, as `fromColumns` does', () => {
    const t = engine.fromColumns([column('__proto__', 'text', ['a', 'b'])])
    const out = engine.selectColumns(t, [{ from: '__proto__', to: '__proto__' }])

    expect(out.schema()).toEqual([{ name: '__proto__', type: 'text' }])
    expect(Object.hasOwn([...out.rows()][0], '__proto__')).toBe(true)
  })
})

// ------------------------------------------------------ the two verbs (6d)
//
// The comparator this adapter installs rather than the one the engine has, and
// the reason is a measurement rather than a preference: `orderby` put a box in
// the middle of the order and dragged unrelated rows with it, differently per
// engine. So what is under test is placement, collation and stability — the
// three properties the port promises — plus the counts only this side can take.

describe('orderRows', () => {
  const values = (t, name) => [...t.rows()].map((r) => r[name])

  it('orders by one key, in both directions, and removes nothing', () => {
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd', 'Carla', 'Dora']),
      column('Betrag', 'number', [1000, 500, 1000, 250]),
    ])

    const down = engine.orderRows(t, [{ column: 'Betrag', direction: 'desc' }])
    expect(values(down.table, 'Betrag')).toEqual([1000, 1000, 500, 250])
    expect(down.table.rowCount()).toBe(4)
    expect(down.boxed).toBe(0)

    const up = engine.orderRows(t, [{ column: 'Betrag', direction: 'asc' }])
    expect(values(up.table, 'Betrag')).toEqual([250, 500, 1000, 1000])
    // The input is untouched — a Step may not mutate its inputs (AD-4).
    expect(values(t, 'Betrag')).toEqual([1000, 500, 1000, 250])
  })

  it('places a box last in **both** directions rather than comparing it', () => {
    // The finding this whole verb exists for. The engine's own `orderby` over
    // exactly these ten values produced `1 2 3 4 5 7 8 9 BOX 6` in Chromium and
    // `1 2 7 8 9 BOX 3 4 5 6` in Firefox — rows with nothing to do with the box
    // lost their order too, and which ones depended on the engine.
    const t = engine.fromColumns([
      column('v', 'number', [9, 8, 7, 'unlesbar', 6, 5, 4, 3, 2, 1], [3]),
    ])

    const up = engine.orderRows(t, [{ column: 'v', direction: 'asc' }])
    expect(values(up.table, 'v')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 'unlesbar'])
    expect(up.boxed).toBe(1)

    const down = engine.orderRows(t, [{ column: 'v', direction: 'desc' }])
    expect(values(down.table, 'v')).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 'unlesbar'])
    expect(down.boxed).toBe(1)
  })

  it('places an empty cell last in both directions, and does not count it as a box', () => {
    // `null < 1` is `true` in JavaScript, so an absent value sorts to the *front*
    // of every ascending order unless it is placed instead — the same accident
    // the Filter already guards for. An empty cell is data the user can see,
    // which is why it is placed but not reported.
    const t = engine.fromColumns([column('v', 'number', [3, null, 1, null, 2])])

    const up = engine.orderRows(t, [{ column: 'v', direction: 'asc' }])
    expect(values(up.table, 'v')).toEqual([1, 2, 3, null, null])
    expect(up.boxed).toBe(0)

    const down = engine.orderRows(t, [{ column: 'v', direction: 'desc' }])
    expect(values(down.table, 'v')).toEqual([3, 2, 1, null, null])
  })

  it('places a blank and a whitespace-only text cell last, as "empty" is defined everywhere else', () => {
    // The product has one definition of an empty cell — `null`, `''` and a
    // whitespace-only string alike — and the Sort form promises in as many words
    // that empty cells land behind the readable values. A narrower rule here
    // sorted `''` and `'   '` to the *front* of every ascending text order, and
    // it is reachable without a strange file: a user who removes „(leer)" from a
    // column's missing tokens gets `''` where they had `null`.
    const t = engine.fromColumns([column('w', 'text', ['', 'Beta', '   ', 'Alpha'])])

    expect(values(engine.orderRows(t, [{ column: 'w', direction: 'asc' }]).table, 'w')).toEqual([
      'Alpha',
      'Beta',
      '',
      '   ',
    ])
    expect(values(engine.orderRows(t, [{ column: 'w', direction: 'desc' }]).table, 'w')).toEqual([
      'Beta',
      'Alpha',
      '',
      '   ',
    ])
  })

  it('places a `NaN` last rather than comparing it', () => {
    // Every comparison against `NaN` is `false`, so a relational comparator
    // answers `0` for all of them — the same inconsistency the box produces and
    // this verb exists to remove. Today's converter boxes a number it could not
    // read, so this should be unreachable; nothing in the code would say so if
    // that changed.
    const t = engine.fromColumns([column('v', 'number', [3, Number.NaN, 1, 2])])

    expect(values(engine.orderRows(t, [{ column: 'v', direction: 'asc' }]).table, 'v')).toEqual([
      1,
      2,
      3,
      Number.NaN,
    ])
    // …and it is not a box, so it is not counted as one.
    expect(engine.orderRows(t, [{ column: 'v', direction: 'asc' }]).boxed).toBe(0)
  })

  it('compares text through German collation, not by code unit', () => {
    // By code unit the same eight words read
    // `Apfel | Osten | Strasse | Straße | Zebra | apfel | Äpfel | Öl`: umlauts
    // after `Z`, lowercase after uppercase. All three engines agree on both
    // orders, so this is a choice rather than an engine lottery.
    const t = engine.fromColumns([
      column('w', 'text', ['Zebra', 'Äpfel', 'Apfel', 'Öl', 'Osten', 'Straße', 'Strasse', 'apfel']),
    ])

    expect(values(engine.orderRows(t, [{ column: 'w', direction: 'asc' }]).table, 'w')).toEqual([
      'apfel',
      'Apfel',
      'Äpfel',
      'Öl',
      'Osten',
      'Strasse',
      'Straße',
      'Zebra',
    ])
  })

  it('lets the second key decide a tie the first one left', () => {
    const t = engine.fromColumns([
      column('Gruppe', 'text', ['b', 'a', 'b', 'a']),
      column('Betrag', 'number', [1, 10, 2, 20]),
    ])

    const out = engine.orderRows(t, [
      { column: 'Gruppe', direction: 'asc' },
      { column: 'Betrag', direction: 'desc' },
    ])

    expect([...out.table.rows()]).toEqual([
      { Gruppe: 'a', Betrag: 20 },
      { Gruppe: 'a', Betrag: 10 },
      { Gruppe: 'b', Betrag: 2 },
      { Gruppe: 'b', Betrag: 1 },
    ])
  })

  it('applies the unordered-last rule per key, so a second key still orders the rest', () => {
    // A row with an empty first key sits behind every row that has one — and its
    // *second* key still orders it against its equals, which is what "per key"
    // means and what a single `return 0` would have lost.
    const t = engine.fromColumns([
      column('Gruppe', 'text', [null, 'a', null, 'a']),
      column('Betrag', 'number', [1, 5, 2, 6]),
    ])

    const out = engine.orderRows(t, [
      { column: 'Gruppe', direction: 'asc' },
      { column: 'Betrag', direction: 'desc' },
    ])

    expect([...out.table.rows()]).toEqual([
      { Gruppe: 'a', Betrag: 6 },
      { Gruppe: 'a', Betrag: 5 },
      { Gruppe: null, Betrag: 2 },
      { Gruppe: null, Betrag: 1 },
    ])
  })

  it('keeps ties in input order, which is what makes "the first N" reproducible', () => {
    const t = engine.fromColumns([
      column('k', 'text', ['b', 'a', 'b', 'a', 'b', 'a']),
      column('id', 'number', [0, 1, 2, 3, 4, 5]),
    ])

    const out = engine.orderRows(t, [{ column: 'k', direction: 'asc' }])
    expect(values(out.table, 'id')).toEqual([1, 3, 5, 0, 2, 4])
  })

  it('orders a `BigInt` temporal column relationally (AD-21)', () => {
    // The unit is nanoseconds as a `BigInt` because a `datetime2(7)` timestamp is
    // already past MAX_SAFE_INTEGER — so the comparator uses `<` and `>` rather
    // than a subtraction, whose result would be a `BigInt` where `sort` wants a
    // `Number`.
    const late = 1_770_998_255_461_672_700n
    const early = 1_770_998_255_461_672_699n
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd']),
      column('Zeitpunkt', 'datetime', [early, late]),
    ])

    const out = engine.orderRows(t, [{ column: 'Zeitpunkt', direction: 'desc' }])
    expect(values(out.table, 'Kunde')).toEqual(['Bernd', 'Anna'])
    // …and the two are the same `Number`, which is the reason the unit is a
    // `BigInt` at all.
    expect(Number(early)).toBe(Number(late))
  })

  it('counts a row once however many of its keys hold a box', () => {
    const t = engine.fromColumns([
      column('a', 'number', [1, 'x', 3], [1]),
      column('b', 'number', [1, 'y', 3], [1]),
    ])

    const out = engine.orderRows(t, [
      { column: 'a', direction: 'asc' },
      { column: 'b', direction: 'asc' },
    ])

    expect(out.boxed).toBe(1)
  })

  it('shares its columns with the input rather than copying them', () => {
    // `create({ order })` hangs a comparator on a new table: the column arrays
    // are the input's, so an ordered table costs one `Uint32Array` of indices.
    // Observable from outside as the box surviving unchanged through the order.
    const t = engine.fromColumns([column('Betrag', 'number', [3, 'unlesbar', 1], [1])])
    const out = engine.orderRows(t, [{ column: 'Betrag', direction: 'asc' }])

    expect([...out.table.column('Betrag')]).toEqual([1, 3, 'unlesbar'])
  })

  it('honours a filter already in force, and counts only the rows still there', () => {
    const t = engine.fromColumns([
      column('Kunde', 'text', ['Anna', 'Bernd', 'Carla']),
      column('Betrag', 'number', [1000, 'unlesbar', 250], [1]),
    ])
    const filtered = engine.filter(t, {
      conditions: [{ column: 'Kunde', op: 'ne', value: 'Bernd' }],
    }).table

    const out = engine.orderRows(filtered, [{ column: 'Betrag', direction: 'asc' }])

    expect(values(out.table, 'Kunde')).toEqual(['Carla', 'Anna'])
    // The boxed row was filtered away upstream — reporting it here would be a
    // number about a row this Step never saw.
    expect(out.boxed).toBe(0)
  })

  it('refines an order already in force rather than replacing it', () => {
    // **`indices()` rebuilds its index in ascending *backing* row order** and
    // then sorts it with this table's comparator alone — so a second Sort used
    // to discard the first one's order among its ties. Two Sort Steps in a row
    // are an ordinary build ("by customer, and within that newest first"), and
    // without the chained tie-break this read `a2 a4 b1 b3` rather than
    // `a4 a2 b3 b1`.
    const t = engine.fromColumns([
      column('g', 'text', ['b', 'a', 'b', 'a']),
      column('d', 'number', [1, 2, 3, 4]),
    ])

    const inner = engine.orderRows(t, [{ column: 'd', direction: 'desc' }]).table
    expect(values(inner, 'd')).toEqual([4, 3, 2, 1])

    const outer = engine.orderRows(inner, [{ column: 'g', direction: 'asc' }]).table
    expect([...outer.rows()]).toEqual([
      { g: 'a', d: 4 },
      { g: 'a', d: 2 },
      { g: 'b', d: 3 },
      { g: 'b', d: 1 },
    ])

    // …and `firstRows` over the chain is the order it was handed, which is the
    // whole reproducibility argument: the first two are the first two.
    expect([...engine.firstRows(outer, 2).table.rows()]).toEqual([
      { g: 'a', d: 4 },
      { g: 'a', d: 2 },
    ])
  })

  it('keeps every row **and every order** where there is no key at all', () => {
    // The identity, and the input handle itself. Written as a branch because
    // `create({ order })` with a comparator that always answers `0` *replaces*
    // an order already in force with the backing row order: measured, a table
    // ordered `a b c` came back `c a b`. An unordered input cannot see that,
    // which is why this case starts from an ordered one.
    const t = engine.fromColumns([column('v', 'text', ['c', 'a', 'b'])])
    const ordered = engine.orderRows(t, [{ column: 'v', direction: 'asc' }]).table

    const out = engine.orderRows(ordered, [])

    expect(out.table).toBe(ordered)
    expect(values(out.table, 'v')).toEqual(['a', 'b', 'c'])
    expect(out.boxed).toBe(0)
  })

  it('throws for an unknown column and an unknown direction — both refused one layer up', () => {
    const t = engine.fromColumns([column('v', 'number', [1])])

    expect(() => engine.orderRows(t, [{ column: 'Umsatz', direction: 'asc' }])).toThrow(
      /no column Umsatz/,
    )
    // The silent default was ascending: a typo in a stored config would have
    // *reversed* an order with nothing on screen to say so.
    expect(() => engine.orderRows(t, [{ column: 'v', direction: 'aufwärts' }])).toThrow(
      /unknown sort direction/,
    )
  })

  it('refuses a handle another engine produced', () => {
    const other = createArqueroEngine()
    const t = other.fromColumns([column('v', 'number', [1])])

    expect(() => engine.orderRows(t, [])).toThrow(/not produced by this engine/)
  })
})

describe('firstRows', () => {
  const REPORT = () => [
    column('Kunde', 'text', ['Anna', 'Bernd', 'Carla', 'Dora']),
    column('Betrag', 'number', [1000, 500, 1000, 250]),
  ]

  it('keeps the first N of the order in force, and says how many went', () => {
    const t = engine.fromColumns(REPORT())
    const ordered = engine.orderRows(t, [{ column: 'Betrag', direction: 'desc' }]).table

    const out = engine.firstRows(ordered, 2)

    expect([...out.table.rows()].map((r) => r.Betrag)).toEqual([1000, 1000])
    expect(out.removed).toBe(2)
    expect(out.table.rowCount()).toBe(2)
  })

  it('keeps the order it was handed, so a limit over a sort is not a special case', () => {
    const t = engine.fromColumns(REPORT())
    const ordered = engine.orderRows(t, [{ column: 'Betrag', direction: 'asc' }]).table

    const out = engine.firstRows(ordered, 3)
    expect([...out.table.rows()].map((r) => r.Kunde)).toEqual(['Dora', 'Bernd', 'Anna'])
    // …and a second limit over the first works, which is what makes it an
    // ordinary Step rather than a terminal one.
    expect([...engine.firstRows(out.table, 1).table.rows()]).toEqual([
      { Kunde: 'Dora', Betrag: 250 },
    ])
  })

  it('keeps every row for a count at or above the row count, and reports nothing removed', () => {
    const out = engine.firstRows(engine.fromColumns(REPORT()), 1000)

    expect(out.table.rowCount()).toBe(4)
    expect(out.removed).toBe(0)
  })

  it('shares its columns with the input, and keeps the box invisible', () => {
    // A `BitSet` over the first N ordered indices rather than a slice: the
    // engine's own `slice` ends in `reify`, which is a full copy of every
    // column. From outside that shows as the box surviving the limit unchanged.
    const t = engine.fromColumns([column('Betrag', 'number', [1000, 'unlesbar', 250], [1])])
    const out = engine.firstRows(t, 2)

    expect([...out.table.column('Betrag')]).toEqual([1000, 'unlesbar'])
  })

  it('honours a filter already in force', () => {
    const t = engine.fromColumns(REPORT())
    const filtered = engine.filter(t, {
      conditions: [{ column: 'Betrag', op: 'gte', value: 500 }],
    }).table

    const out = engine.firstRows(filtered, 2)
    expect([...out.table.rows()].map((r) => r.Kunde)).toEqual(['Anna', 'Bernd'])
    expect(out.removed).toBe(1)
  })

  it('throws for anything that is not a count — refused one layer up', () => {
    const t = engine.fromColumns(REPORT())

    for (const count of [0, -1, 2.5, null, undefined, '3']) {
      expect(() => engine.firstRows(t, count), `accepted ${String(count)} as a row count`).toThrow(
        /not a row count/,
      )
    }
  })

  it('refuses a handle another engine produced', () => {
    const other = createArqueroEngine()
    const t = other.fromColumns(REPORT())

    expect(() => engine.firstRows(t, 1)).toThrow(/not produced by this engine/)
  })
})
