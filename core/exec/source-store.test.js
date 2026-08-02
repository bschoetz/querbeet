// The registry and its commands, under Vitest with no browser (AD-2, AD-27).
//
// The readers here are stubs defined inline — a core test may not import an
// adapter (AD-1), and the store's contract is the injection point, not any
// particular format. The store × PapaParse integration is exercised end to end
// by tests/e2e/csv-sources.spec.js.

import { describe, expect, it } from 'vitest'
import { createSourceStore } from './source-store.js'

const utf8 = (s) => new TextEncoder().encode(s)

/** A trivial text reader: one column, one cell per line. */
const lineReader = {
  media: 'text',
  read(text, config) {
    const cells = text.split('\n')
    return {
      table: { columns: [{ name: 'zeile', domain: 'text', cells }], rowCount: cells.length },
      proposal: { delimiter: config.delimiter ?? ',', headerRow: config.headerRow ?? 1 },
      damage: { mismatches: [], unclosedQuoteRow: null },
      diagnostics: [],
    }
  },
}

/** Same shape, but records every config it was called with. */
const recordingReader = () => {
  const calls = []
  return {
    calls,
    reader: {
      media: 'text',
      read(text, config) {
        calls.push(config)
        return lineReader.read(text, config)
      },
    },
  }
}

describe('addSource', () => {
  it('registers a named Source with retained bytes and the ladder verdict', () => {
    const store = createSourceStore({ csv: lineReader })
    const bytes = utf8('a\nb')

    const { source } = store.addSource({ bytes, fileName: 'umsatz.csv' })

    expect(source).toMatchObject({
      id: 'src:umsatz',
      name: 'umsatz',
      fileName: 'umsatz.csv',
      encoding: { chosen: 'utf-8', source: 'probe', override: null },
      parseConfig: { delimiter: null, headerRow: null },
    })
    expect(source.bytes).toBe(bytes) // the original bytes, not a copy of a copy
    expect(source.table.columns[0].cells).toEqual(['a', 'b'])
    expect(store.get('src:umsatz')).toBe(source)
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('reports the fallback rung for CP1252 bytes', () => {
    const store = createSourceStore({ csv: lineReader })

    const { source } = store.addSource({
      bytes: new Uint8Array([0xe4]), // ä in CP1252, invalid as UTF-8
      fileName: 'alt.csv',
    })

    expect(source.encoding).toEqual({ chosen: 'windows-1252', source: 'fallback', override: null })
    expect(source.table.columns[0].cells).toEqual(['ä'])
  })

  it('slugs a German file name into a readable id (AD-14)', () => {
    const store = createSourceStore({ csv: lineReader })

    const { source } = store.addSource({ bytes: utf8('x'), fileName: 'Umsätze 2024.csv' })

    expect(source.id).toBe('src:umsatze-2024')
    expect(source.name).toBe('Umsätze 2024')
  })

  it('keeps ids unique across same-named files', () => {
    const store = createSourceStore({ csv: lineReader })

    const a = store.addSource({ bytes: utf8('1'), fileName: 'umsatz.csv' }).source
    const b = store.addSource({ bytes: utf8('2'), fileName: 'umsatz.csv' }).source

    expect(a.id).toBe('src:umsatz')
    expect(b.id).toBe('src:umsatz-2')
    expect(store.list()).toHaveLength(2)
  })

  it('never reuses an id after a removal (AD-14)', () => {
    const store = createSourceStore({ csv: lineReader })

    const first = store.addSource({ bytes: utf8('1'), fileName: 'umsatz.csv' }).source
    store.removeSource(first.id)
    const second = store.addSource({ bytes: utf8('2'), fileName: 'umsatz.csv' }).source

    expect(second.id).toBe('src:umsatz-2')
    expect(store.get('src:umsatz')).toBeNull()
  })

  it('refuses an unsupported extension with a named error and no Source', () => {
    const store = createSourceStore({ csv: lineReader })

    const { source, diagnostics } = store.addSource({ bytes: utf8('x'), fileName: 'bericht.xlsx' })

    expect(source).toBeNull()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'source.unsupported_format',
      values: { fileName: 'bericht.xlsx', extension: 'xlsx' },
    })
  })

  it('isolates failure per file — the Sources beside it stay loaded and loadable', () => {
    const store = createSourceStore({ csv: lineReader })

    store.addSource({ bytes: utf8('a'), fileName: 'erste.csv' })
    store.addSource({ bytes: utf8('x'), fileName: 'bericht.xlsx' })
    const after = store.addSource({ bytes: utf8('b'), fileName: 'zweite.csv' }).source

    expect(store.list().map((s) => s.fileName)).toEqual(['erste.csv', 'zweite.csv'])
    expect(after.table.columns[0].cells).toEqual(['b'])
  })

  it('turns a throwing reader into source.unreadable, not a crash', () => {
    const store = createSourceStore({
      csv: {
        media: 'text',
        read() {
          throw new Error('binary garbage')
        },
      },
    })

    const { source, diagnostics } = store.addSource({ bytes: utf8('x'), fileName: 'kaputt.csv' })

    expect(source).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'source.unreadable',
      values: { fileName: 'kaputt.csv' },
    })
  })
})

describe('the NUL-byte trap (BOM-less UTF-16)', () => {
  it('flags NUL-riddled decoded text as an unresolved encoding question', () => {
    // ASCII content in BOM-less UTF-16LE is *valid* UTF-8 — the frozen ladder
    // passes it — so the trap must surface as a question, not parse silently.
    const store = createSourceStore({ csv: lineReader })
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00]) // 'AB' in UTF-16LE

    const { source } = store.addSource({ bytes, fileName: 'roh.csv' })

    expect(source.encoding.chosen).toBe('utf-8') // the ladder itself is unchanged
    expect(source.diagnostics.map((d) => [d.severity, d.code])).toContainEqual([
      'unresolved',
      'encoding.nul_bytes',
    ])
    expect(source.diagnostics.find((d) => d.code === 'encoding.nul_bytes').values).toEqual({
      count: 2,
    })
  })

  it('clears the question when the override names the real encoding', () => {
    const store = createSourceStore({ csv: lineReader })
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00])
    const { source } = store.addSource({ bytes, fileName: 'roh.csv' })

    const updated = store.overrideEncoding(source.id, 'utf-16le')

    expect(updated.diagnostics.map((d) => d.code)).not.toContain('encoding.nul_bytes')
    expect(updated.table.columns[0].cells).toEqual(['AB'])
  })
})

describe('renameSource / removeSource', () => {
  it('renames without touching id, bytes or table', () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    const renamed = store.renameSource(source.id, 'Umsatz August')

    expect(renamed.name).toBe('Umsatz August')
    expect(renamed.id).toBe('src:umsatz')
    expect(renamed.table).toBe(source.table)
    expect(store.get('src:umsatz').name).toBe('Umsatz August')
  })

  it('throws on an unknown id — a programming error, not a Diagnostic', () => {
    const store = createSourceStore({ csv: lineReader })

    expect(() => store.renameSource('src:nichts', 'x')).toThrow()
    expect(() => store.removeSource('src:nichts')).toThrow()
  })

  it('trims the name, and keeps the current one when the new name trims to nothing', () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    expect(store.renameSource(source.id, '  Neu  ').name).toBe('Neu')

    const unchanged = store.renameSource(source.id, '   ')
    expect(unchanged.name).toBe('Neu')
    expect(store.get(source.id).name).toBe('Neu')
  })
})

describe('overrideEncoding', () => {
  it('re-reads from the retained bytes — the rendered values change', () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = store.addSource({ bytes: utf8('ä'), fileName: 'umsatz.csv' })
    expect(source.table.columns[0].cells).toEqual(['ä'])

    const updated = store.overrideEncoding(source.id, 'windows-1252')

    // 0xc3 0xa4 read as CP1252 — proof the parse started from the bytes again.
    expect(updated.table.columns[0].cells).toEqual(['Ã¤'])
    expect(updated.encoding).toEqual({
      chosen: 'windows-1252',
      source: 'override',
      override: 'windows-1252',
    })
    expect(updated.bytes).toBe(source.bytes)
  })

  it('refuses an encoding outside the override list', () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = store.addSource({ bytes: utf8('x'), fileName: 'a.csv' })

    expect(() => store.overrideEncoding(source.id, 'koi8-r')).toThrow(TypeError)
  })
})

describe('re-read failure isolation', () => {
  /** Reads fine until told to throw — the addSource path must stay intact. */
  const flakyReader = () => {
    const state = { shouldThrow: false }
    return {
      state,
      reader: {
        media: 'text',
        read(text, config) {
          if (state.shouldThrow) throw new Error('reader broke on re-read')
          return lineReader.read(text, config)
        },
      },
    }
  }

  it('turns a throwing reader on overrideEncoding into a Diagnostic, keeping the table', () => {
    const { state, reader } = flakyReader()
    const store = createSourceStore({ csv: reader })
    const { source } = store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    state.shouldThrow = true
    const updated = store.overrideEncoding(source.id, 'windows-1252')

    // No exception escaped; the previous table survives (the bytes are still
    // there) and the failure is on record.
    expect(updated.table).toBe(source.table)
    expect(updated.encoding.chosen).toBe('windows-1252')
    // The read failure, plus the typing state the retained table is still in —
    // the entry never stops describing what it holds.
    expect(updated.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['error', 'source.unreadable'],
      ['unresolved', 'typing.unconfirmed'],
    ])
  })

  it('guards reconfigureParse the same way', () => {
    const { state, reader } = flakyReader()
    const store = createSourceStore({ csv: reader })
    const { source } = store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    state.shouldThrow = true
    const updated = store.reconfigureParse(source.id, { delimiter: ';' })

    expect(updated.table).toBe(source.table)
    expect(updated.parseConfig.delimiter).toBe(';')
    expect(updated.diagnostics[0].code).toBe('source.unreadable')
  })
})

describe('reconfigureParse', () => {
  it('passes corrections to the reader and keeps them across re-reads', () => {
    const { calls, reader } = recordingReader()
    const store = createSourceStore({ csv: reader })
    const { source } = store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    expect(calls.at(-1)).toEqual({ delimiter: null, headerRow: null })

    store.reconfigureParse(source.id, { delimiter: ';' })
    expect(calls.at(-1)).toEqual({ delimiter: ';', headerRow: null })

    // A user correction survives an encoding re-read (CAP-3).
    store.overrideEncoding(source.id, 'windows-1252')
    expect(calls.at(-1)).toEqual({ delimiter: ';', headerRow: null })

    // And a later correction merges instead of resetting.
    const updated = store.reconfigureParse(source.id, { headerRow: 4 })
    expect(calls.at(-1)).toEqual({ delimiter: ';', headerRow: 4 })
    expect(updated.parseConfig).toEqual({ delimiter: ';', headerRow: 4 })
  })

  it('validates at the command boundary — AD-10 does not rely on a polite UI', () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    expect(() => store.reconfigureParse(source.id, { delimiter: '' })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { delimiter: 7 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: 0 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: -3 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: 2.5 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: NaN })).toThrow(TypeError)

    // null is "back to propose" for both fields, and is legal.
    const back = store.reconfigureParse(source.id, { delimiter: null, headerRow: null })
    expect(back.parseConfig).toEqual({ delimiter: null, headerRow: null })
  })
})

// ---------------------------------------------------------------- Step zero

/**
 * A reader that returns whatever columns the test asked for. Typing is about
 * the shape of a column, not about any format, so the fixtures are columns.
 *
 * `columns` may be a function of the parse config. A re-read that hands back
 * the identical table cannot show what a re-read does to a typing — the cases
 * that matter are the ones where the values change underneath a choice the user
 * already made, and a fixture that ignores its config can never produce one.
 */
const columnReader = (columns) => ({
  media: 'text',
  read: (_text, config) => {
    const resolved = (typeof columns === 'function' ? columns(config) : columns).map((c) => ({
      domain: 'text',
      ...c,
    }))
    return {
      table: { columns: resolved, rowCount: resolved[0]?.cells.length ?? 0 },
      proposal: { delimiter: ',', headerRow: 1 },
      damage: { mismatches: [], unclosedQuoteRow: null },
      diagnostics: [],
    }
  },
})

const withColumns = (columns) => {
  const store = createSourceStore({ csv: columnReader(columns) })
  const { source } = store.addSource({ bytes: utf8('x'), fileName: 'daten.csv' })
  return { store, source }
}

const AMBIGUOUS = { name: 'Datum', cells: ['03.04.2025', '05.06.2025'] }
const GERMAN = { name: 'Betrag', cells: ['1.234,56', '80,00'] }
const DD = { pattern: 'dd.MM.yyyy', separator: '.', order: 'dmy' }
const MM = { pattern: 'MM.dd.yyyy', separator: '.', order: 'mdy' }

const codes = (entry) => entry.diagnostics.map((d) => [d.severity, d.code])

describe('typing arrives with the Source', () => {
  it('proposes a type per column and starts unconfirmed', () => {
    const { source } = withColumns([GERMAN, { name: 'Kunde', cells: ['Anna', 'Bernd'] }])

    expect(source.typing.confirmed).toBe(false)
    expect(source.typing.columns.map((c) => [c.name, c.type])).toEqual([
      ['Betrag', 'number'],
      ['Kunde', 'text'],
    ])
    expect(Object.isFrozen(source.typing)).toBe(true)
  })

  it('does not ask a question whose two answers are the same number', () => {
    // Separator-free integers read identically under both number readings, so
    // there is nothing for a person to decide. Reported as an ambiguity, this
    // would hold the gate shut over the most common column type there is.
    const { store, source } = withColumns([{ name: 'Menge', cells: ['1', '2', '42', '2019'] }])
    const column = source.typing.columns[0]

    expect(column).toMatchObject({ type: 'number', verdict: 'settled', evidence: null })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('still asks when the two readings mean different numbers', () => {
    const { source } = withColumns([{ name: 'Wert', cells: ['1.234', '5.678'] }])

    expect(source.typing.columns[0]).toMatchObject({
      type: 'number',
      verdict: 'unresolved',
      evidence: { alternatives: ['de-DE', 'en-US'] },
    })
  })
})

describe('the typing as diagnostics (CAP-34)', () => {
  it('reports the open question, the unreadable values and the open gate', () => {
    const { store, source } = withColumns([
      AMBIGUOUS,
      {
        name: 'Datum2',
        // Ten values a day above 12 settles, and one nobody can read: enough
        // to clear the proposal threshold and still leave something unparsed.
        cells: [...Array.from({ length: 10 }, (_, i) => `${13 + i}.01.2025`), 'demnächst'],
      },
    ])

    expect(codes(source)).toEqual([
      ['unresolved', 'typing.ambiguous_locale'],
      ['warning', 'typing.unparsed_values'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    expect(source.diagnostics[0].values).toEqual({
      column: 'Datum',
      alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'],
    })
    expect(source.diagnostics[1].values).toEqual({
      column: 'Datum2',
      unparsed: 1,
      readable: 11,
    })

    // Answering the question and confirming clears all three — the summary is
    // derived from the typing, so it can never describe the typing it replaced.
    store.setColumnTyping(source.id, 0, { type: 'date', format: DD })
    store.setColumnTyping(source.id, 1, { missingTokens: ['demnächst'] })
    expect(codes(store.confirmTyping(source.id).source)).toEqual([])
  })

  it('keeps the reader’s own diagnostics as the load result', () => {
    const { store, source } = withColumns([GERMAN])

    expect(source.readDiagnostics).toEqual([])
    expect(codes(store.get(source.id))).toEqual([['unresolved', 'typing.unconfirmed']])
  })
})

describe('confirmTyping — the first of AD-29 three gates', () => {
  it('refuses while a column is undecided, and names it', () => {
    const { store, source } = withColumns([GERMAN, AMBIGUOUS])

    const refused = store.confirmTyping(source.id)

    expect(refused.unresolved).toEqual(['Datum'])
    expect(refused.source.typing.confirmed).toBe(false)
    expect(store.get(source.id).typing.confirmed).toBe(false)
  })

  it('lets the Source through once the user has answered', () => {
    const { store, source } = withColumns([GERMAN, AMBIGUOUS])
    store.setColumnTyping(source.id, 1, { type: 'date', format: DD })

    const confirmed = store.confirmTyping(source.id)

    expect(confirmed.unresolved).toEqual([])
    expect(confirmed.source.typing.confirmed).toBe(true)
  })

  it('reopens on request — the gate stops a run, it does not trap a user', () => {
    const { store, source } = withColumns([GERMAN])
    store.confirmTyping(source.id)

    expect(store.unconfirmTyping(source.id).typing.confirmed).toBe(false)
  })
})

describe('evidence on both sides', () => {
  // Five values readable only as dd.mm against five readable only as mm.dd is
  // not evidence for dd.mm. Naming a winner there is the silent tie-break this
  // story exists to refuse — the count attached to it makes it more convincing
  // and no more true.
  const symmetric = () => {
    const cells = []
    for (let i = 0; i < 100; i += 1) cells.push('01.01.2025')
    for (let i = 0; i < 5; i += 1) cells.push(`25.0${i + 1}.2025`)
    for (let i = 0; i < 5; i += 1) cells.push(`0${i + 1}.25.2025`)
    return { name: 'Termin', cells }
  }

  it('settles nothing, and the gate holds', () => {
    const { store, source } = withColumns([symmetric()])

    expect(source.typing.columns[0]).toMatchObject({
      verdict: 'unresolved',
      evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
    })
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Termin'])
  })

  it('names both counts once one side outweighs the other', () => {
    const column = symmetric()
    const { source } = withColumns([{ ...column, cells: [...column.cells, '26.07.2025'] }])

    expect(source.typing.columns[0]).toMatchObject({
      verdict: 'decisive',
      format: { pattern: 'dd.MM.yyyy' },
      evidence: { decidedBy: 6, contested: 5 },
    })
  })
})

describe('what a confirmation survives', () => {
  it('survives a rename — the name is display state, the mapping is not', () => {
    const { store, source } = withColumns([GERMAN])
    store.confirmTyping(source.id)

    expect(store.renameSource(source.id, 'Umsatz August').typing.confirmed).toBe(true)
  })

  it('does not survive a re-read, even one that leaves the columns identical', () => {
    // A different encoding changes every value in the table while the column
    // names stay put. A confirmation carried across would be a person vouching
    // for data they never saw.
    const { store, source } = withColumns([GERMAN])
    store.confirmTyping(source.id)

    expect(store.overrideEncoding(source.id, 'windows-1252').typing.confirmed).toBe(false)

    store.confirmTyping(source.id)
    expect(store.reconfigureParse(source.id, { headerRow: 2 }).typing.confirmed).toBe(false)
  })

  it('does not survive a change to the mapping it stood for', () => {
    const { store, source } = withColumns([GERMAN])
    store.confirmTyping(source.id)

    const after = store.setColumnTyping(source.id, 0, { type: 'text' })
    expect(after.typing.confirmed).toBe(false)
  })
})

describe('setColumnTyping', () => {
  it('re-scores under the choice, so a wrong one shows what it costs', () => {
    const { store, source } = withColumns([{ name: 'Datum', cells: ['31.12.2025', '01.01.2026'] }])

    const after = store.setColumnTyping(source.id, 0, { type: 'date', format: MM })
    const column = after.typing.columns[0]

    expect(column.counts).toMatchObject({ parsed: 1, unparsed: 1 })
    expect(column.chosen.format.pattern).toBe('MM.dd.yyyy')
  })

  it('takes the best-scoring reading when the user names only a type', () => {
    // The user asked for a number, not for German. Handing over the first
    // candidate would collapse the hit rate with nothing on screen to say the
    // other candidate read every value.
    const { store, source } = withColumns([{ name: 'Betrag', cells: ['1,234.56', '80.00'] }])

    const after = store.setColumnTyping(source.id, 0, { type: 'number' })
    const column = after.typing.columns[0]

    expect(column.chosen.format.locale).toBe('en-US')
    expect(column.counts).toMatchObject({ parsed: 2, unparsed: 0 })
  })

  it('returns to the proposal on type null', () => {
    const { store, source } = withColumns([GERMAN])
    store.setColumnTyping(source.id, 0, { type: 'text' })

    const back = store.setColumnTyping(source.id, 0, { type: null })

    expect(back.typing.columns[0]).toMatchObject({ type: 'number', chosen: null })
  })

  it('declaring a missing token does not settle a question nobody answered', () => {
    const { store, source } = withColumns([{ ...AMBIGUOUS, cells: [...AMBIGUOUS.cells, 'k.A.'] }])

    const after = store.setColumnTyping(source.id, 0, { missingTokens: ['k.A.'] })
    const column = after.typing.columns[0]

    expect(column.counts).toMatchObject({ missing: 1, parsed: 2 })
    expect(column.verdict).toBe('unresolved')
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Datum'])
  })

  it('validates at the command boundary', () => {
    const { store, source } = withColumns([GERMAN])

    expect(() => store.setColumnTyping(source.id, 0, { missingTokens: 'k.A.' })).toThrow(TypeError)
    expect(() => store.setColumnTyping(source.id, 9, { type: 'text' })).toThrow(RangeError)
    expect(() => store.setColumnTyping(source.id, -1, { type: 'text' })).toThrow(RangeError)

    // A type nobody can convert would be scored as fully readable and then
    // confirmed, which is worse than being refused.
    expect(() => store.setColumnTyping(source.id, 0, { type: 'banana' })).toThrow(TypeError)
    // As would a reading no candidate offers.
    expect(() =>
      store.setColumnTyping(source.id, 0, { type: 'date', format: { pattern: 'dd|MM|yyyy' } }),
    ).toThrow(TypeError)
    expect(() => store.setColumnTyping(source.id, 0, { type: 'number', format: null })).toThrow(
      TypeError,
    )
    // A reading without a type, and a command with nothing to do, are both
    // caller bugs — the second would unmake a confirmation for no reason.
    expect(() => store.setColumnTyping(source.id, 0, { format: DD })).toThrow(TypeError)
    expect(() => store.setColumnTyping(source.id, 0, {})).toThrow(TypeError)
  })
})

describe('a repeated column name', () => {
  // A CSV header may carry the same name twice, and a trailing delimiter yields
  // two columns called ''. A command keyed by name would edit the first of them
  // every time, while the second stayed unreachable — including by the gate
  // that is supposed to hold the Source shut over it.
  const twice = [
    { name: 'Datum', cells: ['31.12.2025', '01.01.2026'] },
    { name: 'Datum', cells: ['03.04.2025', '05.06.2025'] },
  ]

  it('addresses each column separately', () => {
    const { store, source } = withColumns(twice)

    const after = store.setColumnTyping(source.id, 1, { type: 'date', format: MM })

    expect(after.typing.columns[0].chosen).toBe(null)
    expect(after.typing.columns[1].chosen.format.pattern).toBe('MM.dd.yyyy')
  })

  it('holds the gate shut over the second one', () => {
    const { store, source } = withColumns(twice)

    expect(store.confirmTyping(source.id).unresolved).toEqual(['Datum'])

    store.setColumnTyping(source.id, 1, { type: 'date', format: DD })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('carries each annotation to its own column across a re-read', () => {
    const { store, source } = withColumns(twice)
    store.annotateColumn(source.id, 0, 'Rechnungsdatum')
    store.annotateColumn(source.id, 1, 'Lieferdatum')

    const after = store.overrideEncoding(source.id, 'windows-1252')

    expect(after.typing.columns.map((c) => c.annotation)).toEqual([
      'Rechnungsdatum',
      'Lieferdatum',
    ])
  })
})

describe('annotateColumn (CAP-10)', () => {
  it('is documentation, not configuration — it leaves a confirmation standing', () => {
    const { store, source } = withColumns([GERMAN])
    store.confirmTyping(source.id)

    const after = store.annotateColumn(source.id, 0, 'Netto, ohne Fracht')
    const column = after.typing.columns[0]

    expect(column.annotation).toBe('Netto, ohne Fracht')
    expect(column.type).toBe('number')
    expect(after.typing.confirmed).toBe(true)
  })

  it('follows its column across a re-read — a sentence someone wrote is theirs', () => {
    const { store, source } = withColumns([GERMAN])
    store.annotateColumn(source.id, 0, 'Netto, ohne Fracht')

    const after = store.overrideEncoding(source.id, 'windows-1252')

    expect(after.typing.columns[0].annotation).toBe('Netto, ohne Fracht')
  })

  it('is editable again, and clearable', () => {
    const { store, source } = withColumns([GERMAN])
    store.annotateColumn(source.id, 0, 'erste Fassung')
    store.annotateColumn(source.id, 0, 'zweite Fassung')

    expect(store.get(source.id).typing.columns[0].annotation).toBe('zweite Fassung')
    expect(store.annotateColumn(source.id, 0, '').typing.columns[0].annotation).toBe('')
  })
})

describe('what a re-read carries across', () => {
  /** The same column under two header rows, so a re-read genuinely changes the
   *  values a carried choice is scored against. */
  const shifting = (config) => [
    {
      name: 'Datum',
      cells: config.headerRow === 2 ? ['03.04.2025', '12/25/2025'] : ['03.04.2025', '05.06.2025'],
    },
  ]

  it('re-scores a chosen type against the new values', () => {
    const store = createSourceStore({ csv: columnReader(shifting) })
    const { source } = store.addSource({ bytes: utf8('x'), fileName: 'daten.csv' })
    store.setColumnTyping(source.id, 0, { type: 'date', format: DD })
    expect(store.get(source.id).typing.columns[0].counts).toMatchObject({ parsed: 2, unparsed: 0 })

    const after = store.reconfigureParse(source.id, { headerRow: 2 })
    const column = after.typing.columns[0]

    // The choice stands — the user answered a question and it has not changed —
    // but what it now costs is on the record rather than silent.
    expect(column.chosen.format.pattern).toBe('dd.MM.yyyy')
    expect(column.counts).toMatchObject({ parsed: 1, unparsed: 1 })
  })

  it('keeps the missing tokens the user declared', () => {
    // They are part of the typing, not a display setting: dropping them back to
    // the defaults would move the null share and the hit rate, silently.
    const { store, source } = withColumns([{ name: 'Wert', cells: ['12', '7', 'entfällt'] }])
    store.setColumnTyping(source.id, 0, { missingTokens: ['entfällt'] })
    expect(store.get(source.id).typing.columns[0].counts).toMatchObject({ missing: 1, parsed: 2 })

    const after = store.overrideEncoding(source.id, 'windows-1252')
    const column = after.typing.columns[0]

    expect(column.missingTokens).toEqual(['entfällt'])
    expect(column.counts).toMatchObject({ missing: 1, parsed: 2 })
  })

  it('keeps a native column native (AD-20)', () => {
    // No reader in the tree declares a native domain yet — XLSX is story 4 —
    // so this is the only place the branch can be held to its promise.
    const { store, source } = withColumns([
      { name: 'Menge', domain: 'native:number', cells: ['1', '2'] },
    ])
    expect(source.typing.columns[0]).toMatchObject({ domain: 'native:number', type: 'number' })

    store.setColumnTyping(source.id, 0, { type: 'text' })
    const after = store.reconfigureParse(source.id, { headerRow: 2 })
    expect(after.typing.columns[0].domain).toBe('native:number')

    // And the reset still returns it to what the format declared, rather than
    // to whatever inference makes of it.
    const back = store.setColumnTyping(source.id, 0, { type: null })
    expect(back.typing.columns[0]).toMatchObject({ domain: 'native:number', type: 'number' })
  })

  it('drops what no column of that name survives to hold', () => {
    const renaming = (config) => [
      { name: config.headerRow === 2 ? 'Summe' : 'Betrag', cells: ['1.234,56', '80,00'] },
    ]
    const store = createSourceStore({ csv: columnReader(renaming) })
    const { source } = store.addSource({ bytes: utf8('x'), fileName: 'daten.csv' })
    store.annotateColumn(source.id, 0, 'Netto, ohne Fracht')

    const after = store.reconfigureParse(source.id, { headerRow: 2 })

    expect(after.typing.columns[0]).toMatchObject({ name: 'Summe', annotation: '' })
  })
})
