// Step zero's conversion, under Vitest with no browser (AD-2, AD-27).
//
// Two properties carry this file and everything else is an illustration of one
// of them.
//
//   THE COUNT AND THE CONVERSION AGREE. Per column, the converted unparsed count
//   equals `typing.counts.unparsed` — the number the card showed and the number
//   the user confirmed. This is an acceptance criterion, not a hope: the whole
//   product's promise is that a number nobody vouched for is never produced, and
//   a conversion that read even one value differently from the count would break
//   that quietly and in the direction nobody checks.
//
//   THE REPRESENTATION IS THE ONE AD-21 NAMES. Nanoseconds as a `BigInt`, one
//   unit for all four temporal types, and the calendar arithmetic done on the
//   whole value rather than on a date plus a clock.
//
// The engine here is a stub for most of it: what the conversion produces is
// columns, and asserting on the columns is more precise than asserting through a
// table. `adapters/arquero/engine.test.js` is where the real one is exercised.

import { describe, expect, it } from 'vitest'
import { BOOLEAN, DATE, DATETIME, DURATION, NUMBER, TEXT, TIME } from '../types/catalog.js'
import { bestFormat, detectColumn, scoreColumn } from '../types/typing.js'
import { convertSource, createStepZeroCache } from './convert.js'

/** An engine that hands the columns straight back, so a test can read what the
 *  conversion actually built rather than what a table lets it see again. */
const recordingEngine = () => {
  const seen = []
  return {
    seen,
    fromColumns(columns) {
      seen.push(columns)
      return { columns, rows: () => [], rowCount: () => 0, schema: () => [], column: () => [] }
    },
  }
}

/**
 * A confirmed registry entry, typed exactly as the store would type it.
 *
 * Built through `detectColumn` and `scoreColumn` rather than by hand,
 * deliberately: a hand-written typing record is a second opinion about what a
 * column is, and the equality this file exists to check would then be an equality
 * between two of my own guesses. `chosen` takes the `scoreColumn` route, exactly
 * as `setColumnTyping` does — which is the only way a `time` or `duration` column
 * exists at all, since detection can only ever report the two as an open question.
 *
 * The columns are long enough to clear the proposal threshold with a failure in
 * them, which is not padding: a four-value column with one unreadable value is 75
 * % readable and is proposed as `text`, so a fixture that short would be testing
 * the text path under a number column's name.
 */
const confirmed = (columns, { id = 'src:daten' } = {}) => ({
  id,
  table: {
    columns: columns.map((c) => ({ name: c.name, domain: c.domain ?? TEXT, cells: c.cells })),
    rowCount: columns[0]?.cells.length ?? 0,
  },
  typing: {
    columns: columns.map((c) => {
      const missingTokens = c.missingTokens
      const scored = c.chosen
        ? scoreColumn(c.cells, { ...c.chosen, missingTokens, domain: c.domain })
        : detectColumn(c.cells, { domain: c.domain, missingTokens })
      return { name: c.name, annotation: '', chosen: c.chosen ?? null, ...scored }
    }),
    confirmed: true,
  },
})

const convert = (entry) => {
  const engine = recordingEngine()
  const result = convertSource(entry, engine)
  return { result, columns: engine.seen[0] }
}

/** One column's converted values, by name. */
const valuesOf = (columns, name) => columns.find((c) => c.name === name).values

/**
 * Nine values that read, so a tenth that does not still leaves the column at the
 * proposal threshold.
 *
 * Detection proposes a type at 90 % of the non-missing values and not below, so a
 * column of nine readable amounts and one `abc` is a `number` column with one
 * unreadable value — which is the shape this file is about — while eight and one
 * is 89 % and is plain `text`. The lists are named rather than inlined because
 * every fixture below needs the same length for the same reason.
 */
const AMOUNTS = ['1.234,56', '80,00', '12,50', '7,25', '0,99', '3,00', '45,10', '9,90', '100,00']
const DATES = [
  '31.12.2025',
  '01.03.2026',
  '15.06.2025',
  '02.02.2025',
  '30.11.2025',
  '01.01.2026',
  '17.04.2025',
  '28.08.2025',
  '09.09.2025',
]
const FLAGS = ['ja', 'nein', 'ja', 'ja', 'nein', 'nein', 'ja', 'nein', 'ja']
const NAMES = ['Anna', 'Bernd', 'Carla', 'Dora', 'Emil', 'Frida', 'Gustav', 'Heike', 'Ingo']

describe('the count and the conversion agree', () => {
  it('holds per column over a mixed report', () => {
    const entry = confirmed([
      { name: 'Kunde', cells: [...NAMES, 'Jutta'] },
      { name: 'Betrag', cells: [...AMOUNTS, 'abc'] },
      { name: 'Datum', cells: [...DATES, 'demnächst'] },
      { name: 'Aktiv', cells: [...FLAGS, 'vielleicht'] },
    ])

    const { columns } = convert(entry)

    for (const [at, column] of entry.typing.columns.entries()) {
      expect(columns[at].unparsed.length, column.name).toBe(column.counts.unparsed)
    }
    // Not vacuous, and the types are the ones the equality is about: three of
    // the four columns really do carry a failure, under three different readers.
    expect(columns.map((c) => c.type)).toEqual([TEXT, NUMBER, DATE, BOOLEAN])
    expect(columns.map((c) => c.unparsed.length)).toEqual([0, 1, 1, 1])
  })

  it('holds on the affixed and accounting shapes, which are column-level rules', () => {
    // The affix and the accounting permission are not part of a format and do
    // not ride on the record — they are re-derived from the values, and a
    // conversion deriving them differently would count a different number of
    // values readable than the card did. The bare `9` in a percent column is the
    // case that makes the affix load-bearing: it counts unparsed rather than
    // quietly joining a column of percentages.
    const entry = confirmed([
      {
        name: 'Anteil',
        cells: [...AMOUNTS.map((a) => `${a} %`), '9'],
      },
      {
        name: 'Saldo',
        cells: ['(1.234,56)', '1.000,00-', ...AMOUNTS.slice(0, 7), 'unklar'],
      },
    ])

    const { columns } = convert(entry)

    for (const [at, column] of entry.typing.columns.entries()) {
      expect(columns[at].unparsed.length, column.name).toBe(column.counts.unparsed)
    }
    expect(valuesOf(columns, 'Anteil').slice(0, 2)).toEqual([1234.56, 80])
    expect(columns[0].unparsed).toEqual([9])
    // The two accounting spellings, both negative, and only because this column
    // vouches for them: `(1)` on its own is a footnote marker.
    expect(valuesOf(columns, 'Saldo').slice(0, 3)).toEqual([-1234.56, -1000, 1234.56])
  })

  it('holds on a natively typed column, which is read canonically (AD-20)', () => {
    const entry = confirmed([
      { name: 'Menge', domain: 'native:number', cells: ['1234.5', 'Anna', '0.5'] },
    ])

    const { columns } = convert(entry)

    expect(entry.typing.columns[0].counts.unparsed).toBe(1)
    expect(columns[0].unparsed).toEqual([1])
    expect(valuesOf(columns, 'Menge')).toEqual([1234.5, 'Anna', 0.5])
  })
})

// --------------------------------------- the canonical readers, by their values
//
// Every XLSX and Parquet `native:date` and `native:datetime` column converts
// through these, and until this block existed **nothing observed what they
// returned** — only how many values they read. Mutation-proven before it was
// written: emitting `d.getUTCMonth()` without the `+ 1`, so every native datetime
// landed a month early, left all 655 tests green; transposing day and month left
// all 655 green. That is the shape a `parts !== null` suite has by construction —
// the pair-agreement property drives `domain: TEXT` only, and a wrong *value*
// still parses.
//
// So these assert the nanoseconds, derived here from the calendar fields rather
// than from `Date.parse` of the same string the reader parses — a check that
// re-runs the implementation is not one.
describe('a natively typed column’s values', () => {
  it('makes a canonical date UTC midnight, with the month where the month goes', () => {
    const entry = confirmed([
      {
        name: 'Buchungstag',
        domain: 'native:date',
        cells: ['2025-12-31', 'kein Datum', '2026-03-01', '2024-02-29'],
      },
    ])

    const { columns } = convert(entry)

    expect(columns[0].type).toBe(DATE)
    expect(valuesOf(columns, 'Buchungstag')).toEqual([
      BigInt(Date.UTC(2025, 11, 31)) * 1_000_000n,
      'kein Datum',
      BigInt(Date.UTC(2026, 2, 1)) * 1_000_000n,
      BigInt(Date.UTC(2024, 1, 29)) * 1_000_000n,
    ])
    expect(columns[0].unparsed).toEqual([1])
  })

  it('tells 1 March from 3 January, which a transposed reader could not', () => {
    // The day and the month are both small and both plausible on 03-01, so a
    // transposition is invisible in every count and in every "does it parse".
    const { columns } = convert(
      confirmed([{ name: 'Tag', domain: 'native:date', cells: ['2026-03-01'] }]),
    )

    expect(valuesOf(columns, 'Tag')[0]).toBe(BigInt(Date.UTC(2026, 2, 1)) * 1_000_000n)
    expect(valuesOf(columns, 'Tag')[0]).not.toBe(BigInt(Date.UTC(2026, 0, 3)) * 1_000_000n)
  })

  it('makes a canonical datetime UTC epoch nanoseconds, fraction included', () => {
    // `toISOString` is millisecond-resolution by construction, so the fraction is
    // exactly three digits — and the `padStart(3, '0')` that writes it and the
    // `padEnd(9, '0')` that widens it to nanoseconds have to agree. `.007` is the
    // case that catches either of them dropping a zero: read as `7` it would be
    // 700 milliseconds instead of 7.
    const entry = confirmed([
      {
        name: 'Zeitpunkt',
        domain: 'native:datetime',
        cells: [
          '2026-02-13T15:57:35.461Z',
          '2026-02-13T15:57:35.007Z',
          '2026-02-13T15:57:35.000Z',
          'gestern',
        ],
      },
    ])

    const { columns } = convert(entry)
    const second = BigInt(Date.UTC(2026, 1, 13, 15, 57, 35)) * 1_000_000n

    expect(columns[0].type).toBe(DATETIME)
    expect(valuesOf(columns, 'Zeitpunkt')).toEqual([
      second + 461_000_000n,
      second + 7_000_000n,
      second,
      'gestern',
    ])
    expect(columns[0].unparsed).toEqual([3])
  })

  it('reads a native datetime in the month it was written in', () => {
    // The mutation that stayed green: `getUTCMonth()` without the `+ 1` puts
    // every native timestamp a month early, and a whole year of reports with it.
    const { columns } = convert(
      confirmed([{ name: 'Zeitpunkt', domain: 'native:datetime', cells: ['2026-02-13T00:00:00.000Z'] }]),
    )

    expect(valuesOf(columns, 'Zeitpunkt')[0]).toBe(BigInt(Date.UTC(2026, 1, 13)) * 1_000_000n)
    expect(valuesOf(columns, 'Zeitpunkt')[0]).not.toBe(BigInt(Date.UTC(2026, 0, 13)) * 1_000_000n)
  })

  it('crosses a year boundary in the right direction', () => {
    // 1 January is where a month-off-by-one and a year-off-by-one look identical
    // from inside a single value, so the two ends of the year are asserted
    // together rather than one of them.
    const { columns } = convert(
      confirmed([
        {
          name: 'Zeitpunkt',
          domain: 'native:datetime',
          // The canonical form a reader writes is `toISOString()`, which always
          // carries three fractional digits — `…T00:00:00Z` does not round-trip
          // and is counted unreadable, which is story 4's rule and not this
          // story's to relax.
          cells: ['2026-01-01T00:00:00.000Z', '2025-12-31T23:59:59.000Z'],
        },
      ]),
    )

    expect(valuesOf(columns, 'Zeitpunkt')).toEqual([
      BigInt(Date.UTC(2026, 0, 1)) * 1_000_000n,
      BigInt(Date.UTC(2025, 11, 31, 23, 59, 59)) * 1_000_000n,
    ])
  })
})

describe('what a converted cell is', () => {
  it('reads a German number as the number in the field', () => {
    const { columns } = convert(
      confirmed([{ name: 'Betrag', cells: ['1.234,56', '-500', '0', '80,00'] }]),
    )

    expect(valuesOf(columns, 'Betrag')).toEqual([1234.56, -500, 0, 80])
  })

  it('rounds a fractional part past float precision rather than refusing it', () => {
    // Named in the Boundaries rather than discovered, and the ledger entry about
    // the asymmetry with the *integer* overflow guard stays open: this story does
    // not decide it.
    const { columns } = convert(
      confirmed([{ name: 'Wert', cells: ['1,2345678901234567890', '2,0'] }]),
    )

    expect(valuesOf(columns, 'Wert')[0]).toBe(Number('1.2345678901234567890'))
    expect(columns[0].unparsed).toEqual([])
  })

  it('makes a date UTC midnight in epoch nanoseconds', () => {
    const { columns } = convert(confirmed([{ name: 'Datum', cells: ['31.12.2025', '01.03.2026'] }]))

    expect(valuesOf(columns, 'Datum')).toEqual([
      BigInt(Date.UTC(2025, 11, 31)) * 1_000_000n,
      BigInt(Date.UTC(2026, 2, 1)) * 1_000_000n,
    ])
  })

  it('expands a two-digit year through the fixed pivot', () => {
    const { columns } = convert(
      confirmed([{ name: 'Datum', cells: ['31.12.25', '01.03.26', '15.07.24'] }]),
    )

    expect(valuesOf(columns, 'Datum')[0]).toBe(BigInt(Date.UTC(2025, 11, 31)) * 1_000_000n)
  })

  it('rolls end-of-day `24:00` into the next calendar day, year included', () => {
    // The frozen example, and the reason a datetime is parsed as one value: a
    // date part plus separate clock arithmetic puts this in the wrong *year*.
    const { columns } = convert(
      confirmed([{ name: 'Zeitpunkt', cells: ['31.12.2025 24:00', '01.03.2026 09:15'] }]),
    )

    expect(valuesOf(columns, 'Zeitpunkt')[0]).toBe(
      BigInt(Date.UTC(2026, 0, 1, 0, 0, 0)) * 1_000_000n,
    )
  })

  it('applies a zone offset on the way in', () => {
    const { columns } = convert(
      confirmed([
        { name: 'Zeitpunkt', cells: ['2025-06-15T12:00:00+02:00', '2025-06-15T10:00:00Z'] },
      ]),
    )

    const [offset, utc] = valuesOf(columns, 'Zeitpunkt')
    expect(offset).toBe(BigInt(Date.UTC(2025, 5, 15, 10, 0, 0)) * 1_000_000n)
    expect(offset).toBe(utc)
  })

  it('keeps all nine fractional digits, which a `Number` could not have held', () => {
    const { columns } = convert(
      confirmed([
        { name: 'Zeitpunkt', cells: ['2026-02-13T15:57:35.4616727Z', '2026-02-13T15:57:35Z'] },
      ]),
    )

    const [precise, whole] = valuesOf(columns, 'Zeitpunkt')
    expect(precise - whole).toBe(461_672_700n)
    expect(Number(precise)).toBe(Number(precise + 1n)) // why the unit is BigInt
  })

  it('makes a time nanoseconds since midnight and a duration plain nanoseconds', () => {
    // Both columns are a *choice* — every time-readable value is
    // duration-readable, so detection can only ever report the pair as an open
    // question and a person answers it in the type select (AD-21).
    const times = convert(
      confirmed([
        { name: 'Beginn', cells: ['14:30', '00:00', '23:59:59'], chosen: { type: TIME } },
      ]),
    )
    const durations = convert(
      confirmed([
        { name: 'Dauer', cells: ['25:00', '01:30', '00:00'], chosen: { type: DURATION } },
      ]),
    )

    expect(times.columns[0].type).toBe(TIME)
    expect(durations.columns[0].type).toBe(DURATION)
    expect(valuesOf(times.columns, 'Beginn')).toEqual([
      52_200_000_000_000n,
      0n,
      86_399_000_000_000n,
    ])
    expect(valuesOf(durations.columns, 'Dauer')[0]).toBe(90_000_000_000_000n)
  })

  it('holds a duration whose hours are past what a `Number` can count', () => {
    // `CLOCK_DURATION` leaves the hours field unbounded, so the arithmetic has to
    // be `BigInt` from the digits onward. Multiplying in `Number` first —
    // `BigInt(hours * 3600)` — rounds the product before it widens, and the cell
    // comes out a plausible wrong number with nothing to say so.
    const hours = 9_007_199_254_740_993n
    const { columns } = convert(
      confirmed([{ name: 'Dauer', cells: [`${hours}:00`], chosen: { type: DURATION } }]),
    )

    expect(columns[0].unparsed).toEqual([])
    expect(valuesOf(columns, 'Dauer')[0]).toBe(hours * 3600n * 1_000_000_000n)
    // The same sum done the wrong way, named so the assertion above is not just
    // a big number agreeing with itself.
    expect(valuesOf(columns, 'Dauer')[0]).not.toBe(
      BigInt(Number(hours) * 3600) * 1_000_000_000n,
    )
  })

  it('makes a boolean a boolean, whichever pair the column spells it in', () => {
    const { columns } = convert(confirmed([{ name: 'Aktiv', cells: ['ja', 'NEIN', 'ja'] }]))

    expect(columns[0].type).toBe(BOOLEAN)
    expect(valuesOf(columns, 'Aktiv')).toEqual([true, false, true])
  })

  it('leaves a text column as its own text', () => {
    const { columns } = convert(confirmed([{ name: 'Kunde', cells: ['Anna', 'Bernd'] }]))

    expect(columns[0].type).toBe(TEXT)
    expect(valuesOf(columns, 'Kunde')).toEqual(['Anna', 'Bernd'])
    expect(columns[0].unparsed).toEqual([])
  })
})

describe('missing, and the box', () => {
  it('makes a missing token a null cell — never a box, never counted unparsed', () => {
    const entry = confirmed([{ name: 'Betrag', cells: ['n/a', '', ...AMOUNTS, 'abc'] }])

    const { columns, result } = convert(entry)

    expect(valuesOf(columns, 'Betrag').slice(0, 4)).toEqual([null, null, 1234.56, 80])
    expect(columns[0].unparsed).toEqual([11])
    expect(result.unparsed.Betrag).toEqual([11])
    expect(entry.typing.columns[0].counts).toMatchObject({ missing: 2, parsed: 9, unparsed: 1 })
  })

  it('draws the missing line where `sift` draws it, whitespace and all', () => {
    // The token match runs against the trimmed cell because detection's does. A
    // conversion that compared the raw cell would count ` n/a ` unreadable while
    // the card counted it empty.
    const entry = confirmed([{ name: 'Betrag', cells: [' n/a ', ' 80,00 ', ...AMOUNTS] }])

    const { columns } = convert(entry)

    expect(valuesOf(columns, 'Betrag').slice(0, 3)).toEqual([null, 80, 1234.56])
    expect(columns[0].unparsed).toEqual([])
  })

  it('hands the adapter the original text at exactly the unparsed indices', () => {
    // `core/` never constructs a box (AD-22) — it hands the column split, and the
    // adapter boxes those positions. What is preserved is the text that was
    // there, untrimmed: "the original text" means the original.
    const { columns } = convert(
      confirmed([{ name: 'Betrag', cells: [...AMOUNTS, ' ungefähr 80 '] }]),
    )

    expect(columns[0].unparsed).toEqual([9])
    expect(valuesOf(columns, 'Betrag')[9]).toBe(' ungefähr 80 ')
  })

  it('freezes the index list, because it crosses to the UI as plain data', () => {
    const { result } = convert(
      confirmed([{ name: 'Betrag', cells: ['1,5', '2,5', '3,5', '4,5', '5,5', '6,5', '7,5'] }]),
    )

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.unparsed)).toBe(true)
    expect(Object.isFrozen(result.unparsed.Betrag)).toBe(true)
  })
})

describe('what is not converted at all', () => {
  it('refuses an unconfirmed Source — AD-29’s first gate', () => {
    const entry = confirmed([{ name: 'Betrag', cells: ['1,5'] }])
    const unconfirmed = { ...entry, typing: { ...entry.typing, confirmed: false } }

    expect(convertSource(unconfirmed, recordingEngine())).toBeNull()
  })

  it('has exactly one reason to answer null, so the gate can name it truthfully', () => {
    // It had two until 2026-08-04: a Source repeating a column name was not
    // converted either, and a caller receiving `null` could not tell that from an
    // unconfirmed typing — so AD-29's gate could not say which without saying
    // something false. `core/exec/source-store.js` now makes column names unique
    // on ingest, so a confirmed entry always converts, and the adapter's
    // duplicate-name throw is an invariant guard rather than a state to explain.
    const entry = confirmed([
      { name: 'Datum', cells: ['31.12.2025'] },
      { name: 'Datum_2', cells: ['nonsense'] },
    ])

    const converted = convertSource(entry, recordingEngine())
    expect(converted).not.toBeNull()
    expect(Object.keys(converted.unparsed)).toEqual(['Datum', 'Datum_2'])
  })
})

describe('the Step-zero cache', () => {
  it('converts once per frozen entry', () => {
    const engine = recordingEngine()
    const cache = createStepZeroCache(engine)
    const entry = confirmed([{ name: 'Betrag', cells: ['1,5', 'abc'] }])

    const first = cache.of(entry)
    const second = cache.of(entry)

    expect(second).toBe(first)
    expect(engine.seen).toHaveLength(1)
  })

  it('converts again when the registry hands out a different entry', () => {
    // Entry identity *is* the invalidation rule: `commit` freezes and mints a new
    // entry for every change, so a different object is a different answer and
    // nothing has to be told when a type or an encoding moved.
    const engine = recordingEngine()
    const cache = createStepZeroCache(engine)
    const entry = confirmed([{ name: 'Betrag', cells: ['1,5', 'abc'] }])

    cache.of(entry)
    cache.of({ ...entry })

    expect(engine.seen).toHaveLength(2)
    expect(cache.size()).toBe(1)
  })

  it('releases the conversion when the Source is unconfirmed', () => {
    const engine = recordingEngine()
    const cache = createStepZeroCache(engine)
    const entry = confirmed([{ name: 'Betrag', cells: ['1,5'] }])

    cache.of(entry)
    expect(cache.size()).toBe(1)

    const reopened = { ...entry, typing: { ...entry.typing, confirmed: false } }
    expect(cache.of(reopened)).toBeNull()
    expect(cache.size()).toBe(0)
  })

  it('releases on request, for a Source no entry arrives for again', () => {
    const cache = createStepZeroCache(recordingEngine())
    const entry = confirmed([{ name: 'Betrag', cells: ['1,5'] }])

    cache.of(entry)
    cache.release(entry.id)

    expect(cache.size()).toBe(0)
  })

  it('keeps one entry per Source rather than accumulating them', () => {
    const cache = createStepZeroCache(recordingEngine())

    cache.of(confirmed([{ name: 'a', cells: ['1'] }], { id: 'src:eins' }))
    cache.of(confirmed([{ name: 'a', cells: ['1'] }], { id: 'src:zwei' }))
    cache.of(confirmed([{ name: 'a', cells: ['2'] }], { id: 'src:eins' }))

    expect(cache.size()).toBe(2)
  })

  it('answers null for nothing at all', () => {
    expect(createStepZeroCache(recordingEngine()).of(null)).toBeNull()
  })
})

describe('the conversion dispatches on the type, never on the format', () => {
  it('converts `time` and `duration`, which carry no format by construction', () => {
    // The two types AD-21 gives distinct units are exactly the two with
    // `format: null` — a format-dispatched converter would crash on them first.
    for (const type of [TIME, DURATION]) {
      const entry = confirmed([{ name: 'Wert', cells: ['01:30', '02:45'], chosen: { type } }])

      expect(entry.typing.columns[0].format).toBeNull()
      expect(() => convert(entry)).not.toThrow()
      expect(convert(entry).columns[0].type).toBe(type)
    }
  })

  it('carries the confirmed type onto the engine column, which is what `schema()` reports', () => {
    const entry = confirmed([
      { name: 'Kunde', cells: ['Anna'] },
      { name: 'Betrag', cells: ['1,5'] },
      { name: 'Datum', cells: ['31.12.2025'] },
    ])

    expect(convert(entry).columns.map((c) => c.type)).toEqual([TEXT, NUMBER, DATE])
  })

  it('honours a reading the user chose over the one detection ranked first', () => {
    // Nothing in this column settles the ordering, so detection proposes no
    // reading at all and the person answers. The conversion must read what they
    // answered: 3 April under dmy, 4 March under mdy.
    const cells = ['03.04.2025', '05.06.2025']
    expect(bestFormat(cells, DATE)).toBeNull()

    const entry = confirmed([
      {
        name: 'Datum',
        cells,
        chosen: { type: DATE, format: { pattern: 'MM.dd.yyyy', separator: '.', order: 'mdy' } },
      },
    ])

    expect(entry.typing.columns[0].counts).toMatchObject({ parsed: 2, unparsed: 0 })
    expect(convert(entry).columns[0].values[0]).toBe(BigInt(Date.UTC(2025, 2, 4)) * 1_000_000n)
  })
})

describe('the shape handed to the engine', () => {
  it('is one entry per column, in table order, and never a row', () => {
    const entry = confirmed([
      { name: 'Kunde', cells: ['Anna', 'Bernd'] },
      { name: 'Betrag', cells: ['1,5', '2,5'] },
    ])

    const { columns } = convert(entry)

    expect(columns.map((c) => c.name)).toEqual(['Kunde', 'Betrag'])
    expect(columns.every((c) => Array.isArray(c.values) && c.values.length === 2)).toBe(true)
    expect(columns.every((c) => 'unparsed' in c)).toBe(true)
  })

  it('fits the real engine end to end, box and all', async () => {
    // One pass through the actual adapter, so the two halves of story 6a are
    // known to fit: the conversion's columns go in, a `Table` comes out, and a
    // boxed cell materializes as its original text at the edge. The import is
    // dynamic because `core/` may not import an adapter (AD-1) — this is a test
    // reaching across the seam on purpose, and the lint rule that forbids the
    // static form is the one keeping the seam honest.
    const { createArqueroEngine } = await import('../../adapters/arquero/engine.js')
    const entry = confirmed([
      { name: 'Kunde', cells: [...NAMES, 'Jutta'] },
      { name: 'Betrag', cells: [...AMOUNTS, 'abc'] },
    ])

    const { table, unparsed } = convertSource(entry, createArqueroEngine())

    expect(table.rowCount()).toBe(10)
    expect(table.schema()).toEqual([
      { name: 'Kunde', type: TEXT },
      { name: 'Betrag', type: NUMBER },
    ])
    expect([...table.column('Betrag')].slice(0, 3)).toEqual([1234.56, 80, 12.5])
    expect(unparsed.Betrag).toEqual([9])
    // The box, from the far side of the seam: the cell is its original text.
    expect([...table.column('Betrag')][9]).toBe('abc')
    expect([...table.rows()][9]).toEqual({ Kunde: 'Jutta', Betrag: 'abc' })
  })
})
