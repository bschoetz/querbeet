// Step zero's detection, under Vitest with no browser (AD-2, AD-27).
//
// The cases that matter here are not the happy ones. They are: a column that is
// fully readable under two readings at once, which is the state FR-9 says no
// comparable tool reports; and a decisive value that sits past the row where
// every other engine would have stopped looking.

import { describe, expect, it } from 'vitest'
import {
  BOOLEAN,
  DATE,
  DATETIME,
  DEFAULT_MISSING,
  DURATION,
  NUMBER,
  TEXT,
  TIME,
  bestFormat,
  candidatesFor,
  canonicalTypeGaps,
  detectColumn,
  detectTable,
  expandTwoDigitYear,
  numberCandidates,
  scorableTypeGaps,
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

describe('narrowing the candidates before scoring', () => {
  // Nine candidates against every value is nine column walks. Most of them
  // cannot match anything: `readsAsDate` splits on its separator and requires
  // three parts, so a pattern whose separator appears nowhere scores zero. The
  // narrowing is arithmetic, not a heuristic — these cases exist so that a
  // later candidate with a different shape cannot quietly break the argument.

  it('still weighs every pattern whose separator does occur', () => {
    // Both slash patterns must still be in the running, or the ambiguity below
    // would be "settled" by never having been asked.
    expect(detectColumn(['03/04/2025', '05/06/2025', '01/02/2024']).verdict).toBe('unresolved')
    expect(detectColumn(['03.04.2025', '05.06.2025', '01.02.2024']).verdict).toBe('unresolved')
    expect(detectColumn(['03-04-2025', '05-06-2025', '01-02-2024']).verdict).toBe('unresolved')
  })

  it('reaches the same verdict when a second separator is in the column', () => {
    // A column carrying both `.` and `/` keeps every pattern in play, so the
    // unreadable half is reported rather than narrowed away.
    const mixed = [...Array.from({ length: 20 }, () => '31.12.2025'), '03/04/2025', '05/06/2025']
    const r = detectColumn(mixed)

    expect(r.type).toBe(DATE)
    expect(r.format.pattern).toBe('dd.MM.yyyy')
    expect(r.counts).toMatchObject({ parsed: 20, unparsed: 2 })
  })

  it('does not let a separator inside a missing token widen the field', () => {
    // The tokens the user declared absent are not values, so they cannot put a
    // candidate back in the running that no real value could match.
    const r = detectColumn(['1', '2', 'n/a', '42'], { missingTokens: ['n/a'] })

    expect(r).toMatchObject({ type: NUMBER, verdict: 'settled' })
    expect(r.counts).toMatchObject({ missing: 1, parsed: 3, unparsed: 0 })
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

  it('sweeps every cell against the canonical form of its own type', () => {
    // Until story 4 this branch scored every non-missing cell as parsed, which
    // only holds for a homogeneous column — and a real XLSX column is not one.
    // The gate is not a rubber stamp for the natively typed formats.
    //
    // Every cell is named as readable or not, one at a time, and the aggregate
    // is checked against the same list. A count on its own cannot tell a sweep
    // that rejects the right two from one that rejects the wrong two.
    const cases = [
      { domain: 'native:number', reads: ['1234.5', '-0.25', '0', '1e+30'], rejects: [] },
      // `' 12'` is not in either list: the shared sift trims every cell before
      // the sweep sees it, exactly as it does for an inferred column, so padding
      // is not a sweep concern.
      { domain: 'native:number', reads: ['12'], rejects: ['x', '1.10', '', '0x0c'] },
      { domain: 'native:number', reads: [], rejects: ['Infinity', 'NaN', '1,5', '007'] },
      { domain: 'native:date', reads: ['2025-08-01', '2024-02-29'], rejects: [] },
      {
        domain: 'native:date',
        reads: ['1970-01-01'],
        rejects: ['2025-02-30', '01.08.2025', '2025-8-1', '2025-08-01T00:00:00.000Z'],
      },
      {
        domain: 'native:datetime',
        reads: ['2025-08-01T14:30:00.000Z', '1970-01-01T00:00:00.000Z'],
        rejects: [],
      },
      {
        domain: 'native:datetime',
        reads: [],
        rejects: ['2025-08-01T14:30:00+02:00', '2025-08-01', '2025-08-01T14:30:00Z'],
      },
      { domain: 'native:boolean', reads: ['true', 'false'], rejects: ['True', 'ja', '1', 'TRUE'] },
    ]

    for (const { domain, reads, rejects } of cases) {
      // Per cell, so the verdict on each one is named rather than summed away.
      // `''` is a missing token by default, so it is checked as an absence.
      for (const cell of reads) {
        expect([domain, cell, detectColumn([cell], { domain }).counts]).toEqual([
          domain,
          cell,
          { total: 1, missing: 0, parsed: 1, unparsed: 0 },
        ])
      }
      for (const cell of rejects) {
        const counts = detectColumn([cell], { domain }).counts
        const verdict = counts.missing === 1 ? 'missing' : counts.unparsed === 1 ? 'rejected' : 'read'
        expect([domain, cell, verdict]).toEqual([domain, cell, cell === '' ? 'missing' : 'rejected'])
      }

      // …and the aggregate agrees with the per-cell verdicts.
      const cells = [...reads, ...rejects]
      const expectedUnparsed = rejects.filter((cell) => cell !== '').length
      expect(detectColumn(cells, { domain }).counts).toMatchObject({
        parsed: reads.length,
        unparsed: expectedUnparsed,
      })
    }
  })

  it('has a canonical form for every type a reader may declare', () => {
    // Without the invariant, a type added to the catalogue leaves the sweep's
    // lookup undefined, the `TypeError` is swallowed into a failed read, and a
    // perfectly good file is reported to the user as unreadable. Story 4a adds
    // six types and would land on exactly that. This is what `typeLabelGaps()`
    // already does for the German words.
    expect(canonicalTypeGaps()).toEqual([])
  })

  it('counts the strings riding along in a mixed column, without retyping it', () => {
    // XLSX delivers `k.A.` and a stray `x` inside a column of real numbers. The
    // declaration stands — every typed cell agrees — and the two strings are one
    // absence and one unreadable value, which is a different fact each.
    const r = detectColumn(['1234.5', 'k.A.', 'x', '80'], { domain: 'native:number' })

    expect(r).toMatchObject({ type: NUMBER, domain: 'native:number', verdict: 'settled' })
    expect(r.counts).toMatchObject({ total: 4, missing: 1, parsed: 2, unparsed: 1 })
  })

  it('names an INT64 whose digits no JS number can hold (C-10)', () => {
    // The cell keeps the exact digits — the Parquet reader is careful to write
    // them out — but `Number` cannot round-trip them, so story 6's conversion
    // would silently change the value. Counted as unparsed is what makes the
    // loss visible instead of silent.
    const r = detectColumn(['9007199254740993', '9007199254740992', '1'], {
      domain: 'native:number',
    })

    expect(r.counts).toMatchObject({ parsed: 2, unparsed: 1 })
    // The digits themselves are untouched — the finding is the point, not a repair.
    expect(r.type).toBe(NUMBER)
  })

  it('discards a native declaration the catalogue does not admit, down to text', () => {
    // Parquet has TIME, INTERVAL and DECIMAL columns. Taking the word after
    // `native:` verbatim put one of them through a confirmed typing and into a
    // conversion nothing implements — and the domain is the part that travels:
    // story 14 serializes it into the Recipe and story 6 reads it as the
    // instruction. So the declaration is dropped rather than retained, and the
    // column is text-domained, detected and settable like any other.
    const r = detectColumn(['1.234,56', '80,00'], { domain: 'native:decimal' })

    expect(r).toMatchObject({ type: NUMBER, domain: TEXT, verdict: 'settled' })
    expect(r.format.locale).toBe('de-DE')

    // The word survives as provenance only — a bare type word, never spelled
    // `native:…`, so no reader of a column record can convert against it.
    expect(r.refusedNativeType).toBe('decimal')
    expect(r.domain).not.toContain('native')

    // A column whose values read as nothing is still plain text, both ways.
    const words = detectColumn(['Anna', 'Bernd'], { domain: 'native:time' })
    expect(words).toMatchObject({ type: TEXT, domain: TEXT, refusedNativeType: 'time' })

    // …and so is one that is nothing but missing values.
    const empty = detectColumn(['', '-'], { domain: 'native:interval' })
    expect(empty).toMatchObject({ type: TEXT, domain: TEXT, refusedNativeType: 'interval' })
  })

  it('leaves an admissible declaration and a plain text column with no refusal to report', () => {
    expect(detectColumn(['1'], { domain: 'native:number' }).refusedNativeType).toBeNull()
    expect(detectColumn(['Anna']).refusedNativeType).toBeNull()
  })

  it('discards a refused declaration on the re-score path too', () => {
    // `scoreColumn` is the other way into a column record — the one a chosen
    // type takes. A declaration discarded on one route and kept on the other
    // would put the unknown word back on the record on the user's next edit.
    const scored = scoreColumn(['1.234,56'], {
      type: NUMBER,
      format: numberCandidates().find((c) => c.locale === 'de-DE'),
      domain: 'native:decimal',
    })

    expect(scored.domain).toBe(TEXT)
    expect(scored.refusedNativeType).toBe('decimal')
  })

  it('does not offer a native column a reading to choose', () => {
    // `format` is what a locale question is asked through, and a format already
    // answered the question. A reading here would be a second, contradictory one.
    for (const domain of ['native:number', 'native:date', 'native:datetime', 'native:boolean']) {
      expect(detectColumn(['x'], { domain }).format).toBeNull()
    }
  })
})

// ------------------------------------------------------------- story 4a
//
// Six pieces, in the order their risk falls. What each of them is for is the
// same sentence: a column that could only ever be `text` before is now the type
// it actually is — and the one that was reported as a `number` and was not.

describe('piece 1 — the overflow guard', () => {
  it('leaves a column of 19-digit order numbers as text, whole', () => {
    // Reported as `number`, `settled`, 100 % readable, this column loses its
    // last digits the moment story 6 converts it. Story 4 already names the
    // same defect for a Parquet INT64 (C-10); this is it arriving through the
    // text path, where nothing was watching at all.
    const r = detectColumn(['1234567890123456789', '1234567890123456780', '5'])

    expect(r.type).toBe(TEXT)
    expect(r.counts).toMatchObject({ parsed: 3, unparsed: 0 })
  })

  it('sees through the grouping separator to the digits underneath', () => {
    // `9.007.199.254.740.993` is a German number of sixteen integer digits, and
    // the last one of them is the one no float can hold.
    expect(detectColumn(['9.007.199.254.740.993', '1.000,00']).type).toBe(TEXT)
  })

  it('compares as digits rather than through a float round trip', () => {
    // `Number('9007199254740993') === Number('9007199254740992')` is exactly the
    // equality that loses the information, so the float is the wrong witness to
    // ask. One digit apart, one on each side of the boundary.
    expect(detectColumn(['9007199254740991', '12']).type).toBe(NUMBER)
    expect(detectColumn(['9007199254740992', '12']).type).toBe(TEXT)
  })

  it('disqualifies the whole column, exactly as one leading zero does', () => {
    // Not "98 % readable with two unparsed values". The column *is* identifiers,
    // and a proposal of `number` at 98 % would invite confirming precision loss
    // on the other 2 %.
    const mostly = [...Array.from({ length: 50 }, (_, i) => `${i + 1}`), '12345678901234567890']

    expect(detectColumn(mostly).type).toBe(TEXT)
  })

  it('is not fooled by leading zeros inside the digits', () => {
    // `0009007199254740993` has nineteen characters and sixteen significant
    // digits. It is also a leading-zero column, so it is text twice over — the
    // case exists so the digit comparison is not silently length-based.
    expect(detectColumn(['0009007199254740993']).type).toBe(TEXT)
  })
})

describe('piece 2 — datetime, and the two-digit year', () => {
  it('reads the ISO family under one name, because it is one', () => {
    // Seconds optional, a fraction of 1–9 digits optional, `Z` / `±HH:mm` /
    // `±HHmm` all accepted. Spelling that as `yyyy-MM-dd'T'HH:mm:ss` would put a
    // lie in front of the user, so the candidate is named for the standard.
    const r = detectColumn([
      '2025-12-31T14:30:00Z',
      '2025-01-01T00:00+02:00',
      '2024-02-29T23:59:59.123456789-0500',
      '2025-06-15T08:00:00',
    ])

    expect(r).toMatchObject({ type: DATETIME, verdict: 'settled' })
    expect(r.format.pattern).toBe('ISO 8601')
    expect(r.counts.parsed).toBe(4)
  })

  it('refuses an impossible instant as firmly as an impossible day', () => {
    for (const cell of [
      '2025-02-30T12:00:00Z',
      '2025-12-31T24:00:00Z',
      '2025-12-31T12:60:00Z',
      '2025-12-31T12:00:60Z',
      '2025-12-31T12:00:00+25:00',
      '2025-12-31T12:00:00.1234567890Z',
      '2025-12-31 T12:00',
    ]) {
      expect([cell, detectColumn([cell, ...Array(9).fill('2025-01-01T00:00Z')]).counts.parsed]).toEqual([cell, 9])
    }
  })

  it('reads the three shapes an office export actually writes', () => {
    const cases = [
      [['2025-12-31 14:30:00', '2025-01-01 00:00'], 'yyyy-MM-dd HH:mm'],
      [['31.12.2025 14:30', '01.03.2026 08:00:59'], 'dd.MM.yyyy HH:mm'],
      [['31.12.25 14:30', '01.03.26 08:00'], 'dd.MM.yy HH:mm'],
    ]

    for (const [cells, pattern] of cases) {
      const r = detectColumn(cells)
      expect([pattern, r.type, r.format.pattern, r.counts.parsed]).toEqual([
        pattern,
        DATETIME,
        pattern,
        cells.length,
      ])
    }
  })

  it('offers no MM/dd datetime mirror, and says so on purpose', () => {
    // A candidate enters with a real Source that needs it — the rule
    // `NUMBER_LOCALES` already follows. Nothing seen so far carries an American
    // datetime, so `12/31/2025 14:30` is text rather than a guess.
    expect(candidatesFor(DATETIME).map((c) => c.pattern)).toEqual([
      'ISO 8601',
      'yyyy-MM-dd HH:mm',
      'dd.MM.yyyy HH:mm',
      'dd.MM.yy HH:mm',
    ])
    expect(detectColumn(['12/31/2025 14:30', '01/02/2026 08:00']).type).toBe(TEXT)
  })

  it('reads a two-digit year as its own pattern, not as a loose four-digit one', () => {
    const r = detectColumn(['31.12.25', '01.03.26', '15.06.99'])

    expect(r.type).toBe(DATE)
    expect(r.format.pattern).toBe('dd.MM.yy')
    expect(r.verdict).toBe('settled')
    // Strict widths still: the two patterns cannot blur into each other.
    expect(detectColumn(['31.12.25', '31.12.2025']).type).toBe(TEXT)
  })

  it('pivots the century at Excel’s fixed boundary, never at a sliding one', () => {
    // 00–29 is 20yy, 30–99 is 19yy. A sliding window relative to the current
    // year would make a Recipe read a different date in 2031 than it read in
    // 2026, over data that never changed.
    expect([0, 29, 30, 99].map(expandTwoDigitYear)).toEqual([2000, 2029, 1930, 1999])

    // Visible in a verdict rather than only in the helper: 2028 is a leap year
    // and 1930 is not, so the same `29.02.` is a real day under one and not
    // under the other.
    expect(detectColumn(['29.02.28', '01.01.28']).type).toBe(DATE)
    expect(detectColumn(['29.02.30', '01.01.30', '02.02.30']).type).toBe(TEXT)
  })
})

describe('piece 3 — time against duration', () => {
  it('cannot settle a column of clock times, and does not pretend to', () => {
    // Every time-readable value is duration-readable, so a column that never
    // passes 24:00 carries no evidence at all. This is story 3's second
    // ambiguity state, over types rather than over readings — and the gate stays
    // shut until a person answers.
    const r = detectColumn(['08:15', '17:20', '9:05'])

    expect(r.verdict).toBe('unresolved')
    expect(r.evidence).toEqual({ over: 'kind', alternatives: [DURATION, TIME] })
    expect(r.counts.parsed).toBe(3)
    expect(r.format).toBeNull() // there is no reading to choose, only a type
  })

  it('is settled by one value past 24:00, and names the count', () => {
    const r = detectColumn(['08:15', '17:20', '36:15'])

    expect(r.type).toBe(DURATION)
    expect(r.verdict).toBe('decisive')
    expect(r.evidence).toMatchObject({ over: 'kind', decidedBy: 1, contested: 0 })

    // 24:00 itself is the boundary, and it is duration-only evidence too.
    expect(detectColumn(['08:15', '17:20', '24:00']).type).toBe(DURATION)
    expect(detectColumn(['136:15', '08:00']).type).toBe(DURATION)
  })

  it('reads neither for a value no clock has', () => {
    // 60 minutes is not a time and not a duration — it is a typo, and it counts
    // as one. Nine good values carry the column past the threshold so the
    // finding is a count rather than a collapse to text.
    const r = detectColumn([...Array.from({ length: 9 }, () => '08:15'), '12:60'])

    expect(r.counts).toMatchObject({ parsed: 9, unparsed: 1 })
    expect(detectColumn(['12:60', '1:5', '25']).type).toBe(TEXT)
  })

  it('accepts a one-digit hour for a time and any number of them for a duration', () => {
    expect(scoreColumn(['9:05', '08:15', '23:59:59'], { type: TIME }).counts.unparsed).toBe(0)
    expect(scoreColumn(['24:00', '99:59', '136:15'], { type: TIME }).counts.unparsed).toBe(3)
    expect(scoreColumn(['24:00', '99:59', '136:15'], { type: DURATION }).counts.unparsed).toBe(0)
  })

  it('offers neither of them a reading, because the question is the type', () => {
    expect(candidatesFor(TIME)).toEqual([])
    expect(candidatesFor(DURATION)).toEqual([])
    expect(bestFormat(['08:15'], TIME)).toBeNull()
  })
})

describe('piece 4 — boolean pairs', () => {
  it('reads the four pairs, word pairs case and all', () => {
    // German Excel writes WAHR/FALSCH. That is the same pair as wahr/falsch, not
    // a fifth one — a case-sensitive match would leave every German workbook's
    // boolean column as text.
    const cases = [
      [['true', 'FALSE', 'True'], 'true/false'],
      [['WAHR', 'FALSCH', 'wahr'], 'wahr/falsch'],
      [['ja', 'Nein', 'JA'], 'ja/nein'],
    ]

    for (const [cells, pattern] of cases) {
      const r = detectColumn(cells)
      expect([pattern, r.type, r.format.pattern]).toEqual([pattern, BOOLEAN, pattern])
    }
  })

  it('counts a declared missing token as an absence, not as a broken flag', () => {
    const r = detectColumn(['ja', 'Nein', 'k.A.', 'ja'])

    expect(r).toMatchObject({ type: BOOLEAN, verdict: 'settled' })
    expect(r.counts).toMatchObject({ total: 4, missing: 1, parsed: 3, unparsed: 0 })
  })

  it('never mixes one pair with another', () => {
    // A column that spells its yes two ways was not exported by one system, and
    // reading it as a boolean would decide which half is wrong.
    expect(detectColumn(['ja', 'false']).type).toBe(TEXT)
    expect(detectColumn(['wahr', 'nein']).type).toBe(TEXT)
  })

  it('proposes number for 1/0 — the reading that loses less — and keeps boolean settable', () => {
    // `1`/`0` is a perfectly good number, and a tie across kinds goes to number.
    // Nothing is lost by that: the user is one choice away, and the choice is
    // scored the moment it is made.
    const r = detectColumn(['1', '0', '1', '0'])
    expect(r).toMatchObject({ type: NUMBER, verdict: 'settled' })

    const chosen = scoreColumn(['1', '0', '1', '0'], {
      type: BOOLEAN,
      format: bestFormat(['1', '0'], BOOLEAN),
    })
    expect(chosen.format.pattern).toBe('1/0')
    expect(chosen.counts).toMatchObject({ parsed: 4, unparsed: 0 })

    // A stray `2` is not a flag under that pair.
    expect(detectColumn(['1', '0', '2']).type).toBe(NUMBER)
  })
})

describe('pieces 5 and 6 — affixed numbers and accounting signs', () => {
  it('reads a percent column as a number and puts the sign on the column', () => {
    // The stored number is the number in the field: 12,5 for `12,5 %`, never
    // 0,125. Percent is a decisive marker with no second reading — the argument
    // that it might mean 0,125 was a storage question, and this is the answer.
    const r = detectColumn(['12,5 %', '80,0 %', '7,25 %'])

    expect(r).toMatchObject({ type: NUMBER, affix: '%' })
    expect(r.counts.parsed).toBe(3)
    expect(r.format.locale).toBe('de-DE')
  })

  it('takes an affix on either side, with or without one space', () => {
    for (const cells of [
      ['12,5 %', '80,0 %'],
      ['12,5%', '80,0%'],
      ['€ 1.234,56', '€ 80,00'],
      ['1.234,56 €', '80,00 €'],
      ['$1,234.56', '$80.00'],
    ]) {
      expect([cells[0], detectColumn(cells).type]).toEqual([cells[0], NUMBER])
    }

    // Exactly one space. A second one stays in the body and is not a number.
    expect(detectColumn(['12,5  %', '80,0  %']).type).toBe(TEXT)
  })

  it('requires the column’s affix of every value it counts readable', () => {
    // A bare number in a percent column is not a percentage, and counting it
    // readable would put an unmarked figure into a column of marked ones.
    const r = detectColumn([...Array.from({ length: 20 }, () => '12,5 %'), '13'])

    expect(r).toMatchObject({ type: NUMBER, affix: '%' })
    expect(r.counts).toMatchObject({ parsed: 20, unparsed: 1 })
  })

  it('does not let one stray marked value make a plain column an affixed one', () => {
    // The bare reading and the affixed one are both scored, and the one that
    // covers more values wins. Without the comparison a single `1.000,00 €` in a
    // thousand plain numbers would count the other 999 unparsed.
    const r = detectColumn([...Array.from({ length: 40 }, (_, i) => `${i + 1},00`), '1.000,00 €'])

    expect(r).toMatchObject({ type: NUMBER, affix: null })
    expect(r.counts).toMatchObject({ parsed: 40, unparsed: 1 })
  })

  it('refuses a column that mixes two affixes, and names both', () => {
    // Two currencies in one column cannot be summed, and a proposal of `number`
    // would invite exactly that sum.
    const r = detectColumn(['12 €', '12 $'])

    expect(r.type).toBe(TEXT)
    expect(r.mixedAffixes).toEqual(['€', '$'])
  })

  it('does not read an affix out of prose', () => {
    // The finding is "two units are in use", not "two symbols occur". A text
    // column mentioning both reads as a number under neither, so neither is used.
    const r = detectColumn(['Preis in €', 'Preis in $'])

    expect(r).toMatchObject({ type: TEXT, mixedAffixes: null })
  })

  it('reads both accounting negatives, under both locales', () => {
    for (const cells of [
      ['(1.234,56)', '1.234,56-', '80,00'],
      ['(1,234.56)', '1,234.56-', '80.00'],
    ]) {
      const r = detectColumn(cells)
      expect([cells[0], r.type, r.counts.unparsed]).toEqual([cells[0], NUMBER, 0])
      expect(r.verdict).not.toBe('unresolved') // one warning-free column
    }
  })

  it('combines an accounting sign with an affix', () => {
    expect(detectColumn(['(1.234,56 €)', '80,00 €']).affix).toBe('€')
    expect(detectColumn(['($1,234.56)', '$80.00']).affix).toBe('$')
  })

  it('reads two sign marks as no number at all', () => {
    // `(1.234,56-)` is negated twice, or it is a typo. Either way it is not a
    // figure this product will silently pick a sign for.
    const r = detectColumn([...Array.from({ length: 20 }, () => '(1.234,56)'), '(1.234,56-)'])

    expect(r.counts).toMatchObject({ parsed: 20, unparsed: 1 })
    expect(detectColumn(['(-1.234,56)', '(-80,00)']).type).toBe(TEXT)
  })

  it('still sees a leading zero through a sign and an affix', () => {
    // The zeros are the information wherever they sit. `(0123)` is an article
    // number in parentheses, not minus one hundred and twenty-three.
    expect(detectColumn(['(0123)', '(0456)', '789']).type).toBe(TEXT)
    expect(detectColumn(['0123 €', '0456 €']).type).toBe(TEXT)
  })
})

describe('the cross-kind competition', () => {
  it('scores the kinds independently and proposes the highest hit rate', () => {
    const cases = [
      [['1.234,56', '80,00'], NUMBER],
      [['31.12.2025', '01.03.2026'], DATE],
      [['31.12.2025 14:30', '01.03.2026 08:00'], DATETIME],
      [['36:15', '08:00'], DURATION],
      [['ja', 'nein'], BOOLEAN],
      [['Anna', 'Bernd'], TEXT],
    ]

    for (const [cells, type] of cases) {
      expect([cells[0], detectColumn(cells).type]).toEqual([cells[0], type])
    }
  })

  it('holds the 0.9 threshold across every new kind, not only the old two', () => {
    // Two of three readable is not a datetime column any more than it is a
    // number one — and once it is text there is nothing unreadable left in it.
    const r = detectColumn(['31.12.2025 14:30', 'demnächst', 'unbekannt'])

    expect(r).toMatchObject({ type: TEXT, verdict: 'settled' })
    expect(r.counts).toMatchObject({ parsed: 3, unparsed: 0 })
  })

  it('can score every type a user may choose', () => {
    // The sibling of `canonicalTypeGaps`, for the other half of the vocabulary.
    // A type added to the catalogue and forgotten in the reader dispatch would
    // count every value readable and put a 100 % hit rate on a column nothing
    // had read — a rubber stamp with a number on it.
    expect(scorableTypeGaps()).toEqual([])
    expect(canonicalTypeGaps()).toEqual([])
  })

  it('gives a tie to number', () => {
    // `1`/`0` reads fully as both. Number is the reading that loses less if it
    // is wrong, and the rule is the declaration order rather than a special case.
    expect(detectColumn(['1', '0']).type).toBe(NUMBER)
  })
})

describe('the story-3 verdicts, unchanged', () => {
  // Five new kinds compete for every column now. This block is the guard that
  // none of them quietly took one of story 3's columns away from it — the
  // regressions would be silent, and each of these is a shape a real German
  // export carries.
  it('still reads what it read before, with the same counts and the same evidence', () => {
    expect(detectColumn(['1.234,56', '80,00', '7', '-12,5'])).toMatchObject({
      type: NUMBER,
      verdict: 'decisive', // `1.234,56` reads only as German, and says so
      counts: { parsed: 4, unparsed: 0 },
    })
    expect(detectColumn(['0123', '0456', '789']).type).toBe(TEXT)
    expect(detectColumn(['3.4.2025', '5.6.2025']).type).toBe(TEXT)
    expect(detectColumn([...Array.from({ length: 20 }, (_, i) => `${i + 1}.234,00`), '1.23.456']))
      .toMatchObject({ type: NUMBER, counts: { parsed: 20, unparsed: 1 } })

    const ambiguous = detectColumn(['03.04.2025', '05.06.2025', '01.02.2024'])
    expect(ambiguous.verdict).toBe('unresolved')
    // The reading ambiguity's evidence keeps exactly the shape it shipped with,
    // field for field: `over` marks the *type* question and nothing else.
    expect(ambiguous.evidence).toEqual({ alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] })

    const numbers = detectColumn(['1.234', '5.678', '9.012'])
    expect(numbers.evidence).toEqual({ alternatives: ['de-DE', 'en-US'] })
    expect(detectColumn(['1', '2', '42', '2019'])).toMatchObject({
      type: NUMBER,
      verdict: 'settled',
      evidence: null,
    })
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
