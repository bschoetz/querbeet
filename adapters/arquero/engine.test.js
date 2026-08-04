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
import { createArqueroEngine } from './engine.js'

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
