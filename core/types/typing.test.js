// Step zero's detection, under Vitest with no browser (AD-2, AD-27).
//
// The cases that matter here are not the happy ones. They are: a column that is
// fully readable under two readings at once, which is the state FR-9 says no
// comparable tool reports; and a decisive value that sits past the row where
// every other engine would have stopped looking.

import { describe, expect, it } from 'vitest'
import {
  DATE,
  DEFAULT_MISSING,
  NUMBER,
  TEXT,
  bestFormat,
  detectColumn,
  detectTable,
  numberCandidates,
  scoreColumn,
  unresolvedColumns,
} from './typing.js'

const column = (name, cells, domain = 'text') => ({ name, domain, cells })

describe('the number readings', () => {
  it('are the two FR-9 names, taken from Intl rather than written down', () => {
    const candidates = numberCandidates()

    expect(candidates).toHaveLength(2)
    expect(candidates.find((c) => c.locale === 'de-DE')).toMatchObject({ group: '.', decimal: ',' })
    expect(candidates.find((c) => c.locale === 'en-US')).toMatchObject({ group: ',', decimal: '.' })
  })
})

describe('numbers', () => {
  it('reads a German column and says which reading it chose', () => {
    const r = detectColumn(['1.234,56', '80,00', '7', '-12,5'])

    expect(r.type).toBe(NUMBER)
    expect(r.format.locale).toBe('de-DE')
    expect(r.counts).toMatchObject({ total: 4, missing: 0, parsed: 4, unparsed: 0 })
  })

  it('reads an Anglo column just as well', () => {
    const r = detectColumn(['1,234.56', '80.00', '7'])

    expect(r.type).toBe(NUMBER)
    expect(r.format.locale).toBe('en-US')
  })

  it('refuses inconsistent grouping rather than calling the column readable', () => {
    // `1.23.456` is not a German number. Accepting it would let a malformed
    // column report a 100 % hit rate, which is the opposite of this file's job.
    // Twenty good values carry the column past the proposal threshold, so the
    // one bad value is reported as unreadable rather than dragging the whole
    // column back to text — which is the distinction this case exists to make.
    const r = detectColumn([...Array.from({ length: 20 }, (_, i) => `${i + 1}.234,00`), '1.23.456'])

    expect(r.type).toBe(NUMBER)
    expect(r.counts).toMatchObject({ parsed: 20, unparsed: 1 })
  })

  it('leaves a column with leading zeros as text, whole', () => {
    // Article numbers, postcodes, cost centres. The zeros are the information.
    const r = detectColumn(['0123', '0456', '789'])

    expect(r.type).toBe(TEXT)
  })
})

describe('dates', () => {
  it('names the count that decided it', () => {
    // 47 values with a day above 12, among values that read either way. This is
    // FR-9's own example sentence, as a number.
    const cells = [
      ...Array.from({ length: 47 }, (_, i) => `${13 + (i % 15)}.03.2025`),
      ...Array.from({ length: 20 }, () => '03.04.2025'),
    ]
    const r = detectColumn(cells)

    expect(r.type).toBe(DATE)
    expect(r.format.pattern).toBe('dd.MM.yyyy')
    expect(r.verdict).toBe('decisive')
    expect(r.evidence.decidedBy).toBe(47)
    expect(r.evidence.alternatives).toEqual(['dd.MM.yyyy', 'MM.dd.yyyy'])
  })

  it('finds the deciding value past the row where every other engine stops', () => {
    // DuckDB scans 20,480 rows, Arquero 1,000, Power Query 200, Frictionless
    // 100. The one value that settles this column sits past all of them, and
    // R5 found a reproduction of the resulting corruption on a real file.
    const cells = Array.from({ length: 25_000 }, () => '03/04/2025')
    cells[24_999] = '31/03/2025'

    const r = detectColumn(cells)

    expect(r.verdict).toBe('decisive')
    expect(r.format.pattern).toBe('dd/MM/yyyy')
    expect(r.evidence.decidedBy).toBe(1)
  })

  it('rejects a day a calendar does not have', () => {
    expect(detectColumn(['30.02.2025', '31.04.2025', '31.06.2025']).type).toBe(TEXT)
    // … and accepts the leap day that does exist.
    expect(detectColumn(['29.02.2024', '29.02.2020', '01.03.2024']).type).toBe(DATE)
  })

  it('is strict about width, so two patterns cannot blur into one', () => {
    const r = detectColumn(['3.4.2025', '5.6.2025', '7.8.2025'])

    expect(r.type).toBe(TEXT)
  })

  it('reads ISO dates without inventing an ambiguity', () => {
    const r = detectColumn(['2025-12-31', '2024-02-29', '2025-01-01'])

    expect(r.type).toBe(DATE)
    expect(r.format.pattern).toBe('yyyy-MM-dd')
    expect(r.verdict).toBe('settled')
  })
})

describe('the state no comparable tool reports', () => {
  it('says nothing settles a fully ambiguous date column, and names no winner', () => {
    const r = detectColumn(['03.04.2025', '05.06.2025', '01.02.2024'])

    expect(r.verdict).toBe('unresolved')
    expect(r.evidence.decidedBy).toBeUndefined()
    expect(r.evidence.alternatives).toHaveLength(2)
    expect(r.counts.parsed).toBe(3)
  })

  it('says the same for a fully ambiguous number column', () => {
    // `1.234` is one thousand two hundred thirty-four, or it is 1.234.
    const r = detectColumn(['1.234', '5.678', '9.012'])

    expect(r.type).toBe(NUMBER)
    expect(r.verdict).toBe('unresolved')
    expect(r.evidence.alternatives).toEqual(['de-DE', 'en-US'])
  })

  it('is not the same thing as a partial hit rate', () => {
    // A column can be 100 % readable under both readings — which is why the hit
    // rate cannot carry the ambiguity, and why this state needs its own words.
    const ambiguous = detectColumn(['1.234', '5.678'])
    const partial = detectColumn([...Array.from({ length: 90 }, () => '31.12.2025'), 'kaputt'])

    expect(ambiguous.counts.unparsed).toBe(0)
    expect(ambiguous.verdict).toBe('unresolved')
    expect(partial.verdict).toBe('settled')
    expect(partial.counts).toMatchObject({ parsed: 90, unparsed: 1 })
  })

  it('is not the same thing as two readings that mean the same number', () => {
    // Nothing in `1`, `2`, `42` tells de-DE from en-US either — but both make
    // it the same number, so there is no question, and asking one would hold
    // the gate shut over every count, quantity and identifier column there is.
    for (const cells of [
      ['1', '2', '42'],
      ['2019', '2020', '2021'],
      ['-5', '12', '-7'],
      ['7'],
    ]) {
      const r = detectColumn(cells)
      expect(r).toMatchObject({ type: NUMBER, verdict: 'settled', evidence: null })
      expect(r.counts.unparsed).toBe(0)
    }

    // One separator anywhere is enough to make the readings disagree again.
    expect(detectColumn(['1', '2', '1.234']).verdict).toBe('unresolved')
  })

  it('reports no winner where the evidence points both ways in equal measure', () => {
    // Five values readable only as dd.mm against five readable only as mm.dd is
    // a column arguing with itself. Naming a winner is DuckDB's silent
    // tie-break with a real count attached, which makes it more convincing and
    // no more true.
    const both = [
      ...Array.from({ length: 100 }, () => '01.01.2025'),
      ...Array.from({ length: 5 }, (_, i) => `25.0${i + 1}.2025`),
      ...Array.from({ length: 5 }, (_, i) => `0${i + 1}.25.2025`),
    ]
    const r = detectColumn(both)

    expect(r.verdict).toBe('unresolved')
    expect(r.evidence).toEqual({ alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] })

    // One more value on one side and there is a majority — which the sentence
    // then has to name on both sides, not only its own.
    const tipped = detectColumn([...both, '26.07.2025'])
    expect(tipped.verdict).toBe('decisive')
    expect(tipped.evidence).toMatchObject({ decidedBy: 6, contested: 5 })
  })
})

describe('missing values', () => {
  it('counts declared tokens as missing rather than as unreadable', () => {
    const cells = ['1.234,56', 'k.A.', '-', '', '80,00']
    const r = detectColumn(cells)

    expect(r.counts).toMatchObject({ total: 5, missing: 3, parsed: 2, unparsed: 0 })
    expect(r.type).toBe(NUMBER)
  })

  it('takes the user’s tokens over the defaults', () => {
    const cells = [...Array.from({ length: 20 }, (_, i) => `${i + 1},50`), 'entfällt']

    // Undeclared, `entfällt` is a value the column cannot read …
    expect(detectColumn(cells).counts).toMatchObject({ missing: 0, parsed: 20, unparsed: 1 })
    // … declared, it is an absence. The distinction is not cosmetic: it decides
    // null shares, grouping, join matching and what "is empty" means (FR-9).
    expect(detectColumn(cells, { missingTokens: ['entfällt'] }).counts).toMatchObject({
      missing: 1,
      parsed: 20,
      unparsed: 0,
    })
  })

  it('a column that falls below the proposal threshold is text, and text reads everything', () => {
    // Two of three readable is not a number column. Once it is text there is
    // nothing unreadable left in it — "unparsed" is always relative to a type.
    const r = detectColumn(['1,50', 'entfällt', 'unbekannt'])

    expect(r.type).toBe(TEXT)
    expect(r.counts).toMatchObject({ parsed: 3, unparsed: 0 })
  })

  it('a column of nothing but missing values is text and settled', () => {
    const r = detectColumn(['', '-', 'n/a'])

    expect(r).toMatchObject({ type: TEXT, verdict: 'settled' })
    expect(r.counts).toMatchObject({ total: 3, missing: 3, parsed: 0, unparsed: 0 })
  })

  it('ships a default token set the user can see and edit', () => {
    expect(DEFAULT_MISSING).toContain('k.A.')
    expect(Object.isFrozen(DEFAULT_MISSING)).toBe(true)
  })
})

describe('a natively typed column (AD-20)', () => {
  it('arrives pre-typed, is not inferred, and is still swept and still confirmable', () => {
    const r = detectColumn(['1', '2', ''], { domain: 'native:number' })

    expect(r.type).toBe('number')
    expect(r.format).toBeNull()
    expect(r.counts.missing).toBe(1)
    expect(r.verdict).toBe('settled')
  })
})

describe('re-scoring under what the user chose', () => {
  it('recomputes the hit rate and settles the question', () => {
    const cells = ['1.234', '5.678', '9.012']
    expect(detectColumn(cells).verdict).toBe('unresolved')

    const chosen = scoreColumn(cells, {
      type: NUMBER,
      format: numberCandidates().find((c) => c.locale === 'en-US'),
    })

    expect(chosen.verdict).toBe('settled')
    expect(chosen.counts.parsed).toBe(3)
  })

  it('reports what a wrong choice costs instead of hiding it', () => {
    const chosen = scoreColumn(['31.12.2025', '01.01.2026'], {
      type: DATE,
      format: { pattern: 'MM.dd.yyyy', separator: '.', order: 'mdy' },
    })

    expect(chosen.counts).toMatchObject({ parsed: 1, unparsed: 1 })
  })

  it('keeps the domain the reader declared (AD-20)', () => {
    // Losing it here is how a native column silently becomes an inferred one:
    // the next reset would re-derive a type the format had already stated.
    const chosen = scoreColumn(['1', '2'], { type: NUMBER, format: null, domain: 'native:number' })

    expect(chosen.domain).toBe('native:number')
  })
})

describe('the reading a chosen type is scored under', () => {
  it('is the best-scoring candidate, not the first one on the list', () => {
    // The user asked for a number, not for German. `bestFormat` is what keeps a
    // type change from collapsing an Anglo column's hit rate to nothing.
    expect(bestFormat(['1,234.56', '80.00'], NUMBER).locale).toBe('en-US')
    expect(bestFormat(['1.234,56', '80,00'], NUMBER).locale).toBe('de-DE')
    expect(bestFormat(['31.12.2025', '01.01.2026'], DATE).pattern).toBe('dd.MM.yyyy')
    expect(bestFormat(['Anna', 'Bernd'], TEXT)).toBeNull()
  })

  it('is scored against the values that count, not the missing ones', () => {
    const cells = ['1,234.56', 'k.A.', '80.00']

    expect(bestFormat(cells, NUMBER, ['k.A.']).locale).toBe('en-US')
  })
})

describe('a whole table', () => {
  const table = {
    columns: [
      column('Betrag', ['1.234,56', '80,00']),
      column('Datum', ['03.04.2025', '05.06.2025']),
      column('Kunde', ['Anna', 'Bernd']),
    ],
    rowCount: 2,
  }

  it('carries one record per column, with room for the user’s own words', () => {
    const typing = detectTable(table)

    expect(typing.columns.map((c) => c.name)).toEqual(['Betrag', 'Datum', 'Kunde'])
    expect(typing.columns.map((c) => c.type)).toEqual([NUMBER, DATE, TEXT])
    expect(typing.columns.every((c) => c.annotation === '' && c.chosen === null)).toBe(true)
    expect(typing.confirmed).toBe(false)
    expect(Object.isFrozen(typing.columns[0])).toBe(true)
  })

  it('names the columns standing in the way of confirmation', () => {
    const typing = detectTable(table)

    expect(unresolvedColumns(typing)).toEqual(['Datum'])
  })

  it('stops naming a column once the user has answered for it', () => {
    const typing = detectTable(table)
    const answered = {
      ...typing,
      columns: typing.columns.map((c) =>
        c.name === 'Datum' ? { ...c, chosen: { type: DATE, format: c.format } } : c,
      ),
    }

    expect(unresolvedColumns(answered)).toEqual([])
  })
})
