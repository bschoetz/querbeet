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
    const t = engine.fromColumns([
      column('__proto__', 'text', ['a', 'b']),
      column('constructor', 'text', ['c', 'd']),
    ])

    expect(t.schema().map((c) => c.name)).toEqual(['__proto__', 'constructor'])
    expect([...t.column('__proto__')]).toEqual(['a', 'b'])
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
