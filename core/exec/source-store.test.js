// The registry and its commands, under Vitest with no browser (AD-2, AD-27).
//
// The readers here are stubs defined inline — a core test may not import an
// adapter (AD-1), and the store's contract is the injection point, not any
// particular format. The store × PapaParse integration is exercised end to end
// by tests/e2e/csv-sources.spec.js.

import { describe, expect, it } from 'vitest'
import { createSourceStore, typingDiagnostics } from './source-store.js'

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
  it('registers a named Source with retained bytes and the ladder verdict', async () => {
    const store = createSourceStore({ csv: lineReader })
    const bytes = utf8('a\nb')

    const { source } = await store.addSource({ bytes, fileName: 'umsatz.csv' })

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

  it('reports the fallback rung for CP1252 bytes', async () => {
    const store = createSourceStore({ csv: lineReader })

    const { source } = await store.addSource({
      bytes: new Uint8Array([0xe4]), // ä in CP1252, invalid as UTF-8
      fileName: 'alt.csv',
    })

    expect(source.encoding).toEqual({ chosen: 'windows-1252', source: 'fallback', override: null })
    expect(source.table.columns[0].cells).toEqual(['ä'])
  })

  it('slugs a German file name into a readable id (AD-14)', async () => {
    const store = createSourceStore({ csv: lineReader })

    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'Umsätze 2024.csv' })

    expect(source.id).toBe('src:umsatze-2024')
    expect(source.name).toBe('Umsätze 2024')
  })

  it('keeps ids unique across same-named files', async () => {
    const store = createSourceStore({ csv: lineReader })

    const a = (await store.addSource({ bytes: utf8('1'), fileName: 'umsatz.csv' })).source
    const b = (await store.addSource({ bytes: utf8('2'), fileName: 'umsatz.csv' })).source

    expect(a.id).toBe('src:umsatz')
    expect(b.id).toBe('src:umsatz-2')
    expect(store.list()).toHaveLength(2)
  })

  it('never reuses an id after a removal (AD-14)', async () => {
    const store = createSourceStore({ csv: lineReader })

    const first = (await store.addSource({ bytes: utf8('1'), fileName: 'umsatz.csv' })).source
    store.removeSource(first.id)
    const second = (await store.addSource({ bytes: utf8('2'), fileName: 'umsatz.csv' })).source

    expect(second.id).toBe('src:umsatz-2')
    expect(store.get('src:umsatz')).toBeNull()
  })

  it('refuses an unsupported extension with a named error and no Source', async () => {
    const store = createSourceStore({ csv: lineReader })

    const { source, diagnostics } = await store.addSource({ bytes: utf8('x'), fileName: 'bericht.ods' })

    expect(source).toBeNull()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'source.unsupported_format',
      values: { fileName: 'bericht.ods', extension: 'ods' },
    })
  })

  it('isolates failure per file — the Sources beside it stay loaded and loadable', async () => {
    const store = createSourceStore({ csv: lineReader })

    await store.addSource({ bytes: utf8('a'), fileName: 'erste.csv' })
    await store.addSource({ bytes: utf8('x'), fileName: 'bericht.ods' })
    const after = (await store.addSource({ bytes: utf8('b'), fileName: 'zweite.csv' })).source

    expect(store.list().map((s) => s.fileName)).toEqual(['erste.csv', 'zweite.csv'])
    expect(after.table.columns[0].cells).toEqual(['b'])
  })

  it('turns a throwing reader into source.unreadable, not a crash', async () => {
    const store = createSourceStore({
      csv: {
        media: 'text',
        read() {
          throw new Error('binary garbage')
        },
      },
    })

    const { source, diagnostics } = await store.addSource({ bytes: utf8('x'), fileName: 'kaputt.csv' })

    expect(source).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'source.unreadable',
      values: { fileName: 'kaputt.csv' },
    })
  })
})

describe('the NUL-byte trap (BOM-less UTF-16)', () => {
  it('flags NUL-riddled decoded text as an unresolved encoding question', async () => {
    // ASCII content in BOM-less UTF-16LE is *valid* UTF-8 — the frozen ladder
    // passes it — so the trap must surface as a question, not parse silently.
    const store = createSourceStore({ csv: lineReader })
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00]) // 'AB' in UTF-16LE

    const { source } = await store.addSource({ bytes, fileName: 'roh.csv' })

    expect(source.encoding.chosen).toBe('utf-8') // the ladder itself is unchanged
    expect(source.diagnostics.map((d) => [d.severity, d.code])).toContainEqual([
      'unresolved',
      'encoding.nul_bytes',
    ])
    expect(source.diagnostics.find((d) => d.code === 'encoding.nul_bytes').values).toEqual({
      count: 2,
    })
  })

  it('clears the question when the override names the real encoding', async () => {
    const store = createSourceStore({ csv: lineReader })
    const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x00])
    const { source } = await store.addSource({ bytes, fileName: 'roh.csv' })

    const updated = await store.overrideEncoding(source.id, 'utf-16le')

    expect(updated.diagnostics.map((d) => d.code)).not.toContain('encoding.nul_bytes')
    expect(updated.table.columns[0].cells).toEqual(['AB'])
  })
})

describe('renameSource / removeSource', () => {
  it('renames without touching id, bytes or table', async () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    const renamed = store.renameSource(source.id, 'Umsatz August')

    expect(renamed.name).toBe('Umsatz August')
    expect(renamed.id).toBe('src:umsatz')
    expect(renamed.table).toBe(source.table)
    expect(store.get('src:umsatz').name).toBe('Umsatz August')
  })

  it('throws on an unknown id — a programming error, not a Diagnostic', async () => {
    const store = createSourceStore({ csv: lineReader })

    expect(() => store.renameSource('src:nichts', 'x')).toThrow()
    expect(() => store.removeSource('src:nichts')).toThrow()
  })

  it('trims the name, and keeps the current one when the new name trims to nothing', async () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    expect(store.renameSource(source.id, '  Neu  ').name).toBe('Neu')

    const unchanged = store.renameSource(source.id, '   ')
    expect(unchanged.name).toBe('Neu')
    expect(store.get(source.id).name).toBe('Neu')
  })
})

describe('overrideEncoding', () => {
  it('re-reads from the retained bytes — the rendered values change', async () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = await store.addSource({ bytes: utf8('ä'), fileName: 'umsatz.csv' })
    expect(source.table.columns[0].cells).toEqual(['ä'])

    const updated = await store.overrideEncoding(source.id, 'windows-1252')

    // 0xc3 0xa4 read as CP1252 — proof the parse started from the bytes again.
    expect(updated.table.columns[0].cells).toEqual(['Ã¤'])
    expect(updated.encoding).toEqual({
      chosen: 'windows-1252',
      source: 'override',
      override: 'windows-1252',
    })
    expect(updated.bytes).toBe(source.bytes)
  })

  it('refuses an encoding outside the override list', async () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'a.csv' })

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

  it('turns a throwing reader on overrideEncoding into a Diagnostic, keeping the table', async () => {
    const { state, reader } = flakyReader()
    const store = createSourceStore({ csv: reader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    state.shouldThrow = true
    const updated = await store.overrideEncoding(source.id, 'windows-1252')

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

  it('guards reconfigureParse the same way', async () => {
    const { state, reader } = flakyReader()
    const store = createSourceStore({ csv: reader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    state.shouldThrow = true
    const updated = await store.reconfigureParse(source.id, { delimiter: ';' })

    expect(updated.table).toBe(source.table)
    expect(updated.parseConfig.delimiter).toBe(';')
    expect(updated.diagnostics[0].code).toBe('source.unreadable')
  })

  it('lets a reader say what is actually wrong instead of guessing three times', async () => {
    // `source.unreadable` reads "damaged, password-protected, or not the format
    // its extension claims" — three guesses, all three wrong for a valid Parquet
    // written with a codec this build cannot decompress. A reader that knows
    // better attaches a code, and that becomes the diagnostic.
    const store = createSourceStore({
      parquet: {
        media: 'binary',
        read() {
          const failure = new Error('parquet.unsupported_codec')
          failure.code = 'parquet.unsupported_codec'
          failure.values = { codec: 'GZIP' }
          throw failure
        },
      },
    })

    const { source, diagnostics } = await store.addSource({
      bytes: utf8('x'),
      fileName: 'umsatz.parquet',
    })

    expect(source).toBeNull()
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'parquet.unsupported_codec',
      values: { fileName: 'umsatz.parquet', codec: 'GZIP' },
    })
  })

  it('falls back to the generic failure for a throw that names nothing', async () => {
    const store = createSourceStore({
      csv: {
        media: 'text',
        read() {
          throw new TypeError('undefined is not a function')
        },
      },
    })

    const { diagnostics } = await store.addSource({ bytes: utf8('x'), fileName: 'kaputt.csv' })

    expect(diagnostics[0].code).toBe('source.unreadable')
  })
})

describe('the parse decisions that were actually in force', () => {
  // A reader does not always honour what it was sent: a header row past the end
  // of the sheet is clamped, and a named sheet that no longer exists falls back
  // to the first. Keeping the unhonoured value splits the truth in two — the
  // control shows one thing, the config holds another.
  const workbookReader = {
    media: 'binary',
    read: async (_bytes, config) => {
      const sheets = ['Eins', 'Zwei']
      const sheet = sheets.includes(config.sheet) ? config.sheet : sheets[0]
      const headerRow = Math.min(config.headerRow ?? 1, 2) // the sheet is 2 rows tall
      return {
        table: { columns: [{ name: 'Wert', domain: 'text', cells: ['x'] }], rowCount: 1 },
        proposal: { headerRow, sheet, sheets },
        damage: { mismatches: [], unclosedQuoteRow: null },
        diagnostics: [],
      }
    },
  }

  const workbook = async () => {
    const store = createSourceStore({ xlsx: workbookReader })
    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'bericht.xlsx' })
    return { store, source }
  }

  it('adopts a clamped header row instead of remembering the one it refused', async () => {
    // Otherwise `parseConfig.headerRow` stays 99 while the bound control shows
    // 2, and a later re-read against a taller sheet resurrects the 99.
    const { store, source } = await workbook()

    const clamped = await store.reconfigureParse(source.id, { headerRow: 99 })

    expect(clamped.proposal.headerRow).toBe(2)
    expect(clamped.parseConfig.headerRow).toBe(2)
  })

  it('adopts the sheet that was read when the named one is gone', async () => {
    // The dead name in the config is what made the fallback unclearable: the
    // select shows the sheet actually read, and re-selecting a displayed value
    // fires no change event, so there was no single action back to a good state.
    const { store, source } = await workbook()

    const fallen = await store.reconfigureParse(source.id, { sheet: 'Vertrieb' })

    expect(fallen.proposal.sheet).toBe('Eins')
    expect(fallen.parseConfig.sheet).toBe('Eins')

    // And the next choice is an ordinary one, not a fight with a stale name.
    const switched = await store.reconfigureParse(fallen.id, { sheet: 'Zwei' })
    expect(switched.parseConfig.sheet).toBe('Zwei')
  })

  it('names the sheet from the first read, so choosing it again is not a switch', async () => {
    // `null` and the name of the very same sheet were two spellings of one
    // state, and the comparison that decides whether to drop the header row
    // read them as different — so selecting the sheet already on screen threw
    // away a header-row correction.
    const { store, source } = await workbook()
    expect(source.parseConfig.sheet).toBe('Eins')

    const corrected = await store.reconfigureParse(source.id, { headerRow: 2 })
    const reselected = await store.reconfigureParse(corrected.id, { sheet: 'Eins' })

    expect(reselected.parseConfig).toMatchObject({ sheet: 'Eins', headerRow: 2 })
  })

  it('leaves a decision the user never made as null', async () => {
    // Adoption is about corrections that were not honoured, not about freezing
    // a proposal into a correction the user never issued.
    const { source } = await workbook()

    expect(source.parseConfig.headerRow).toBeNull()
    expect(source.parseConfig.delimiter).toBeNull()
  })
})

describe('two parse commands at once', () => {
  // Every other test in this file awaits each command before issuing the next,
  // so none of them can represent an overlap — and an overlap is ordinary use on
  // the binary formats, where a read takes seconds. The reader below resolves
  // only when the test says so, which is the only way to hold two reads open at
  // the same time.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  const deferredReader = () => {
    const pending = []
    return {
      pending,
      /** Let the queue reach its next read, then release it. Serialized
       *  commands start their read only once the one before them has committed,
       *  so a caller cannot release what has not been asked for yet. */
      async settleAll() {
        for (let waited = 0; waited < 50 && pending.length === 0; waited += 1) await tick()
        for (const resolve of pending.splice(0)) resolve()
        await tick()
      },
      reader: {
        media: 'binary',
        read(_bytes, config) {
          const seen = { ...config }
          return new Promise((resolve) => {
            pending.push(() =>
              resolve({
                table: {
                  columns: [
                    {
                      name: 'Wert',
                      domain: 'text',
                      cells: [`${seen.sheet ?? '-'}|${seen.headerRow ?? '-'}`],
                    },
                  ],
                  rowCount: 1,
                },
                proposal: { headerRow: seen.headerRow ?? 1, sheet: seen.sheet ?? 'Eins', sheets: ['Eins', 'Zwei'] },
                damage: { mismatches: [], unclosedQuoteRow: null },
                diagnostics: [],
              }),
            )
          })
        },
      },
    }
  }

  const load = async (harness) => {
    const store = createSourceStore({ xlsx: harness.reader })
    const loading = store.addSource({ bytes: utf8('x'), fileName: 'bericht.xlsx' })
    await harness.settleAll()
    const { source } = await loading
    return { store, source }
  }

  it('keeps both corrections when neither call was awaited', async () => {
    // Choose a sheet, then correct the header row before the sheet has landed.
    // Unserialized, the second command merged against the entry as it stood
    // *before* the first — so the sheet switch vanished and the file was read on
    // the wrong sheet, with a card that said otherwise.
    const harness = deferredReader()
    const { store, source } = await load(harness)

    const first = store.reconfigureParse(source.id, { sheet: 'Zwei' })
    const second = store.reconfigureParse(source.id, { headerRow: 3 })

    // Both reads are queued; releasing them lets the chain run in order.
    await harness.settleAll()
    await first
    await harness.settleAll()
    const after = await second

    expect(after.parseConfig).toMatchObject({ sheet: 'Zwei', headerRow: 3 })
    expect(after.table.columns[0].cells).toEqual(['Zwei|3'])
  })

  it('does not let a finished read commit over an edit made while it ran', async () => {
    // A read holds a snapshot of the entry for as long as it takes. An
    // annotation or a chosen type set meanwhile lives on the *current* entry,
    // and committing the snapshot would throw that edit away without a word.
    const harness = deferredReader()
    const { store, source } = await load(harness)

    const reading = store.reconfigureParse(source.id, { headerRow: 2 })
    store.annotateColumn(source.id, 0, 'Stück, nicht Kilo')
    store.setColumnTyping(source.id, 0, { missingTokens: ['-'] })

    await harness.settleAll()
    const after = await reading

    expect(after.typing.columns[0].annotation).toBe('Stück, nicht Kilo')
    expect(after.typing.columns[0].missingTokens).toEqual(['-'])
    expect(after.parseConfig.headerRow).toBe(2)
  })

  it('keeps serving the Source after a read fails, rather than wedging it', async () => {
    // The queue continues through a rejection; one bad read must not make every
    // later correction hang.
    let fail = true
    const store = createSourceStore({
      xlsx: {
        media: 'binary',
        read: async (_bytes, config) => {
          if (fail) {
            fail = false
            throw new Error('reader broke')
          }
          return {
            table: { columns: [{ name: 'Wert', domain: 'text', cells: ['ok'] }], rowCount: 1 },
            proposal: { headerRow: config.headerRow ?? 1 },
            damage: { mismatches: [], unclosedQuoteRow: null },
            diagnostics: [],
          }
        },
      },
    })

    fail = false
    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'bericht.xlsx' })
    fail = true

    const broken = await store.reconfigureParse(source.id, { headerRow: 2 })
    expect(broken.diagnostics[0].code).toBe('source.unreadable')

    const recovered = await store.reconfigureParse(source.id, { headerRow: 3 })
    expect(recovered.table.columns[0].cells).toEqual(['ok'])
  })
})

describe('reconfigureParse', () => {
  it('passes corrections to the reader and keeps them across re-reads', async () => {
    const { calls, reader } = recordingReader()
    const store = createSourceStore({ csv: reader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    expect(calls.at(-1)).toEqual({ delimiter: null, headerRow: null, sheet: null })

    await store.reconfigureParse(source.id, { delimiter: ';' })
    expect(calls.at(-1)).toEqual({ delimiter: ';', headerRow: null, sheet: null })

    // A user correction survives an encoding re-read (CAP-3).
    await store.overrideEncoding(source.id, 'windows-1252')
    expect(calls.at(-1)).toEqual({ delimiter: ';', headerRow: null, sheet: null })

    // And a later correction merges instead of resetting.
    const updated = await store.reconfigureParse(source.id, { headerRow: 4 })
    expect(calls.at(-1)).toEqual({ delimiter: ';', headerRow: 4, sheet: null })
    expect(updated.parseConfig).toEqual({ delimiter: ';', headerRow: 4, sheet: null })
  })

  it('carries a sheet choice to the reader, and lets go of the header row with it', async () => {
    // The sheet travels the same way a delimiter does — but a header row does
    // not travel with it. It was corrected against the sheet being left; the
    // new sheet proposes its own, exactly as a freshly loaded one would.
    const { calls, reader } = recordingReader()
    const store = createSourceStore({ xlsx: reader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'bericht.xlsx' })

    await store.reconfigureParse(source.id, { headerRow: 3 })
    expect(calls.at(-1)).toMatchObject({ headerRow: 3, sheet: null })

    const switched = await store.reconfigureParse(source.id, { sheet: 'Zwei' })
    expect(calls.at(-1)).toMatchObject({ headerRow: null, sheet: 'Zwei' })
    expect(switched.parseConfig.sheet).toBe('Zwei')

    // A correction made *on* the new sheet then sticks to it.
    await store.reconfigureParse(source.id, { headerRow: 2 })
    expect(calls.at(-1)).toMatchObject({ headerRow: 2, sheet: 'Zwei' })
  })

  it('validates at the command boundary — AD-10 does not rely on a polite UI', async () => {
    const store = createSourceStore({ csv: lineReader })
    const { source } = await store.addSource({ bytes: utf8('a'), fileName: 'umsatz.csv' })

    expect(() => store.reconfigureParse(source.id, { delimiter: '' })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { delimiter: 7 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: 0 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: -3 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: 2.5 })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { headerRow: NaN })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { sheet: '' })).toThrow(TypeError)
    expect(() => store.reconfigureParse(source.id, { sheet: 2 })).toThrow(TypeError)

    // null is "back to propose" for every field, and is legal.
    const back = await store.reconfigureParse(source.id, {
      delimiter: null,
      headerRow: null,
      sheet: null,
    })
    expect(back.parseConfig).toEqual({ delimiter: null, headerRow: null, sheet: null })
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

const withColumns = async (columns) => {
  const store = createSourceStore({ csv: columnReader(columns) })
  const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'daten.csv' })
  return { store, source }
}

const AMBIGUOUS = { name: 'Datum', cells: ['03.04.2025', '05.06.2025'] }
const GERMAN = { name: 'Betrag', cells: ['1.234,56', '80,00'] }
const DD = { pattern: 'dd.MM.yyyy', separator: '.', order: 'dmy' }
const MM = { pattern: 'MM.dd.yyyy', separator: '.', order: 'mdy' }
const DD_SHORT = { pattern: 'dd.MM.yy', separator: '.', order: 'dmy', shortYear: true }

const codes = (entry) => entry.diagnostics.map((d) => [d.severity, d.code])

describe('typing arrives with the Source', () => {
  it('proposes a type per column and starts unconfirmed', async () => {
    const { source } = await withColumns([GERMAN, { name: 'Kunde', cells: ['Anna', 'Bernd'] }])

    expect(source.typing.confirmed).toBe(false)
    expect(source.typing.columns.map((c) => [c.name, c.type])).toEqual([
      ['Betrag', 'number'],
      ['Kunde', 'text'],
    ])
    expect(Object.isFrozen(source.typing)).toBe(true)
  })

  it('does not ask a question whose two answers are the same number', async () => {
    // Separator-free integers read identically under both number readings, so
    // there is nothing for a person to decide. Reported as an ambiguity, this
    // would hold the gate shut over the most common column type there is.
    const { store, source } = await withColumns([{ name: 'Menge', cells: ['1', '2', '42', '2019'] }])
    const column = source.typing.columns[0]

    expect(column).toMatchObject({ type: 'number', verdict: 'settled', evidence: null })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('still asks when the two readings mean different numbers', async () => {
    const { source } = await withColumns([{ name: 'Wert', cells: ['1.234', '5.678'] }])

    expect(source.typing.columns[0]).toMatchObject({
      type: 'number',
      verdict: 'unresolved',
      evidence: { alternatives: ['de-DE', 'en-US'] },
    })
  })
})

describe('the typing as diagnostics (CAP-34)', () => {
  it('reports the open question, the unreadable values and the open gate', async () => {
    const { store, source } = await withColumns([
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

  it('reports unreadable values in a native column too — the gate is not a rubber stamp', async () => {
    // The same code, from the other branch. A `native:number` column's stray
    // string is exactly what AD-20's sweep exists to catch, and until story 4
    // the branch scored every non-missing cell as parsed, so this code could
    // never be emitted for one. Only the inferred branch was ever asserted.
    const { store, source } = await withColumns([
      { name: 'Menge', domain: 'native:number', cells: ['12', 'k.A.', 'x', '7'] },
    ])

    expect(codes(source)).toEqual([
      ['warning', 'typing.unparsed_values'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    // `k.A.` is a default missing token, so it is an absence rather than one of
    // the values the hit rate is a share of.
    expect(source.diagnostics[0].values).toEqual({ column: 'Menge', unparsed: 1, readable: 3 })

    // Declaring the stray absent is the way out, and it does not retype the
    // column — a native column is never retyped (AD-20).
    const after = store.setColumnTyping(source.id, 0, { missingTokens: ['k.A.', 'x'] })
    expect(after.typing.columns[0]).toMatchObject({ domain: 'native:number', type: 'number' })
    expect(codes(store.confirmTyping(source.id).source)).toEqual([])
  })

  it('keeps the reader’s own diagnostics as the load result', async () => {
    const { store, source } = await withColumns([GERMAN])

    expect(source.readDiagnostics).toEqual([])
    expect(codes(store.get(source.id))).toEqual([['unresolved', 'typing.unconfirmed']])
  })
})

describe('the questions story 4a added, as diagnostics and as a gate', () => {
  const CLOCK = { name: 'Beginn', cells: ['08:15', '17:20'] }

  it('gives the time-against-duration question its own code, not the locale one', async () => {
    // Two questions, two codes. A locale ambiguity asks which reading of the
    // digits is meant and is answered in the Lesart select; this one asks what
    // the column *is* and is answered in the Typ select. One code for both
    // would point the card at the wrong control.
    const { store, source } = await withColumns([CLOCK])

    expect(codes(source)).toEqual([
      ['unresolved', 'typing.ambiguous_kind'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    expect(source.diagnostics[0].values).toEqual({
      column: 'Beginn',
      alternatives: ['duration', 'time'],
    })

    // And it blocks the gate exactly as the locale case does.
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Beginn'])

    const answered = store.setColumnTyping(source.id, 0, { type: 'time' })
    expect(answered.typing.columns[0]).toMatchObject({
      type: 'time',
      format: null, // no reading to resolve — the choice was the type
      verdict: 'settled',
    })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('warns about a column that mixes two units, and names both', async () => {
    const { source } = await withColumns([{ name: 'Wert', cells: ['12 €', '12 $'] }])

    expect(codes(source)).toEqual([
      ['warning', 'typing.mixed_affixes'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    expect(source.diagnostics[0].values).toEqual({ column: 'Wert', affixes: ['€', '$'] })
    expect(source.typing.columns[0].type).toBe('text')
  })

  it('warns about a column that mixes two boolean pairs, and names both', async () => {
    // The sibling of the mixed-unit warning, and unconditional in the same way:
    // nineteen `ja` beside one `false` is the same finding as one beside one.
    const { source } = await withColumns([
      { name: 'Freigabe', cells: [...Array.from({ length: 19 }, () => 'ja'), 'false'] },
    ])

    expect(codes(source)).toEqual([
      ['warning', 'typing.mixed_boolean_pairs'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    expect(source.diagnostics[0].values).toEqual({
      column: 'Freigabe',
      pairs: ['true/false', 'ja/nein'],
    })
    expect(source.typing.columns[0].type).toBe('text')
  })

  it('reports two boolean pairs even when a different kind wins the column', async () => {
    // `1` and `0` are perfectly good numbers, so the contamination disqualifies
    // only the boolean reading — the column is `number` with `ja` unparsed, and
    // the finding is the column's either way.
    const cells = [...Array.from({ length: 19 }, (_, i) => (i % 2 ? '1' : '0')), 'ja']
    const { store, source } = await withColumns([{ name: 'Freigabe', cells }])

    expect(source.typing.columns[0]).toMatchObject({
      type: 'number',
      mixedBooleanPairs: ['ja/nein', '1/0'],
    })
    expect(codes(source)).toEqual([
      ['warning', 'typing.mixed_boolean_pairs'],
      ['warning', 'typing.unparsed_values'],
      ['unresolved', 'typing.unconfirmed'],
    ])

    // …and a choice made is a question closed, exactly as for the units.
    const chosen = store.setColumnTyping(source.id, 0, { type: 'text' })
    expect(chosen.typing.columns[0].mixedBooleanPairs).toBeNull()
    expect(codes(chosen)).toEqual([['unresolved', 'typing.unconfirmed']])
  })

  it('keeps the two-units warning on a column it only asks a question about', async () => {
    // Eighteen `01.02.03` are a date-or-text question, and the two amounts
    // beside them are a finding of their own. Detection dropped it on exactly
    // this one of three sibling routes.
    const cells = [...Array.from({ length: 18 }, () => '01.02.03'), '12 €', '12 $']
    const { source } = await withColumns([{ name: 'Wert', cells }])

    expect(source.typing.columns[0]).toMatchObject({
      verdict: 'unresolved',
      mixedAffixes: ['€', '$'],
    })
    expect(codes(source)).toEqual([
      ['unresolved', 'typing.ambiguous_kind'],
      ['warning', 'typing.mixed_affixes'],
      ['warning', 'typing.unparsed_values'],
      ['unresolved', 'typing.unconfirmed'],
    ])
  })

  it('resolves a reading for the kinds that have one, and none for the kinds that do not', async () => {
    const { store, source } = await withColumns([
      { name: 'Zeitpunkt', cells: ['31.12.2025 14:30', '01.03.2026 08:00'] },
      { name: 'Flag', cells: ['ja', 'nein'] },
      CLOCK,
    ])

    // Detection's own proposals first — a datetime pattern and a boolean pair
    // are formats, and `resolveFormat` has to be able to key on each of them.
    expect(source.typing.columns.map((c) => c.format?.pattern ?? null)).toEqual([
      'dd.MM.yyyy HH:mm',
      'ja/nein',
      null,
    ])

    // …and the same keys survive a round trip through the command boundary,
    // which resolves a named reading against the candidate list rather than
    // trusting it.
    const patched = store.setColumnTyping(source.id, 0, {
      type: 'datetime',
      format: { pattern: 'yyyy-MM-dd HH:mm' },
    })
    expect(patched.typing.columns[0]).toMatchObject({
      type: 'datetime',
      counts: { parsed: 0, unparsed: 2 }, // a wrong choice shows what it costs
    })
    expect(() =>
      store.setColumnTyping(source.id, 1, { type: 'boolean', format: { pattern: 'oui/non' } }),
    ).toThrow(TypeError)
  })

  it('keeps the affix on the record when the user overrides the reading', async () => {
    // The affix is not part of the format — the format answers which locale
    // reads the digits, the affix answers what unit rides on the column — so it
    // has to be re-derived on a re-score rather than carried on the choice.
    const { store, source } = await withColumns([{ name: 'Quote', cells: ['12,5 %', '80,0 %'] }])
    expect(source.typing.columns[0]).toMatchObject({ type: 'number', affix: '%' })

    const overridden = store.setColumnTyping(source.id, 0, {
      type: 'number',
      format: { locale: 'en-US' },
    })

    expect(overridden.typing.columns[0].affix).toBe('%')
    // …and it survives a re-read, where the whole record is rebuilt.
    const reread = await store.overrideEncoding(source.id, 'windows-1252')
    expect(reread.typing.columns[0].affix).toBe('%')
  })

  it('asks about a column of version numbers, and names it as blocking the gate', async () => {
    const { store, source } = await withColumns([
      { name: 'Version', cells: ['01.02.03', '04.05.06', '07.08.09'] },
    ])

    expect(codes(source)).toEqual([
      ['unresolved', 'typing.ambiguous_kind'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    expect(source.diagnostics[0].values).toEqual({
      column: 'Version',
      alternatives: ['date', 'text'],
    })
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Version'])

    // Answering it with `Text` — the answer those columns used to get for free —
    // opens the gate and leaves every value readable.
    const answered = store.setColumnTyping(source.id, 0, { type: 'text' })
    expect(answered.typing.columns[0].counts).toMatchObject({ parsed: 3, unparsed: 0 })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('does not settle the reading a chosen type was never asked about', async () => {
    // Two questions on one column: the kind question first, and behind it the
    // ordering question its four-digit twin already asks. Answering `Datum`
    // closes the first and cannot close the second, so the column comes back
    // `unresolved` over the reading — with its own code, its own alternatives,
    // and the gate still shut.
    const { store, source } = await withColumns([
      { name: 'Version', cells: ['03.04.25', '05.06.25'] },
    ])
    expect(source.typing.columns[0].verdict).toBe('unresolved')

    const chosen = store.setColumnTyping(source.id, 0, { type: 'date' })
    const column = chosen.typing.columns[0]

    expect(column).toMatchObject({
      type: 'date',
      verdict: 'unresolved',
      evidence: { alternatives: ['dd.MM.yy', 'MM.dd.yy'] },
      counts: { parsed: 2, unparsed: 0 },
    })
    expect(column.chosen).toEqual({ type: 'date', format: null })
    expect(codes(chosen)).toEqual([
      ['unresolved', 'typing.ambiguous_locale'],
      ['unresolved', 'typing.unconfirmed'],
    ])
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Version'])

    // Answering the second question is what opens the gate.
    const settled = store.setColumnTyping(source.id, 0, {
      type: 'date',
      format: { pattern: 'MM.dd.yy' },
    })
    expect(settled.typing.columns[0]).toMatchObject({ verdict: 'settled', evidence: null })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('drops the mixed-affix warning once the user has chosen a type', async () => {
    // The warning is a reason a column is *not* a number, and its German
    // sentence says the column is read as text. Carried through a re-score it
    // outlived its condition: the card showed `Zahl` and `Einheit: €` with a
    // warning underneath still claiming text, while the `$` values went unparsed
    // with no sentence of their own. A choice made is a question closed — what
    // the choice costs is the unparsed count, which is reported either way.
    const { store, source } = await withColumns([
      { name: 'Wert', cells: ['12 €', '12 $', '7 €'] },
    ])
    expect(codes(source)).toContainEqual(['warning', 'typing.mixed_affixes'])

    const chosen = store.setColumnTyping(source.id, 0, { type: 'number' })

    expect(chosen.typing.columns[0]).toMatchObject({
      type: 'number',
      affix: '€',
      mixedAffixes: null,
      counts: { parsed: 2, unparsed: 1 },
    })
    expect(codes(chosen)).toEqual([
      ['warning', 'typing.unparsed_values'],
      ['unresolved', 'typing.unconfirmed'],
    ])

    // …and handing the column back to detection brings the finding back, because
    // the finding was never the user's, it was the column's.
    const reset = store.setColumnTyping(source.id, 0, { type: null })
    expect(codes(reset)).toContainEqual(['warning', 'typing.mixed_affixes'])
  })

  it('reports two units even when a different kind wins the column', async () => {
    // Eighteen German dates beside `12 €` and `12 $` propose `date`. The two
    // amounts would otherwise survive only as an anonymous unparsed count, and
    // the finding would go quiet exactly where it is least expected — because a
    // *different* kind cleared the threshold.
    const dates = Array.from({ length: 18 }, (_, i) => `${13 + (i % 15)}.02.2025`)
    const { source } = await withColumns([{ name: 'Wert', cells: [...dates, '12 €', '12 $'] }])

    expect(source.typing.columns[0]).toMatchObject({ type: 'date', mixedAffixes: ['€', '$'] })
    expect(codes(source)).toEqual([
      ['warning', 'typing.mixed_affixes'],
      ['warning', 'typing.unparsed_values'],
      ['unresolved', 'typing.unconfirmed'],
    ])
  })

  it('refuses a nonsense reading on a type that has no readings', async () => {
    // `resolveFormat` returned early for `time` and `duration`, so a reading no
    // candidate offers was silently accepted on those two while the same
    // nonsense on a `datetime` threw. A reading nothing offers would be scored
    // as zero readable and then confirmed, which is worse than being refused.
    const { store, source } = await withColumns([{ name: 'Beginn', cells: ['08:15', '17:20'] }])

    expect(() =>
      store.setColumnTyping(source.id, 0, { type: 'time', format: { pattern: 'nonsense' } }),
    ).toThrow(TypeError)

    // …and `text`, which had the same early return and therefore the same hole.
    expect(() =>
      store.setColumnTyping(source.id, 0, { type: 'text', format: { pattern: 'nonsense' } }),
    ).toThrow(TypeError)
    expect(store.setColumnTyping(source.id, 0, { type: 'text' }).typing.columns[0]).toMatchObject({
      type: 'text',
      format: null,
    })

    // `null` stays the one legitimate reading for them: it is what `bestFormat`
    // hands back and what a stored choice round-trips as.
    expect(
      store.setColumnTyping(source.id, 0, { type: 'duration', format: null }).typing.columns[0],
    ).toMatchObject({ type: 'duration', format: null, counts: { unparsed: 0 } })
  })

  it('survives an unresolved column that carries no evidence', async () => {
    // Detection cannot produce one, but this file is not the only producer of a
    // typing: story 14 restores one from a Recipe, and a hand-edited or older
    // file would reach `evidence.over` on a null. A crash there takes the whole
    // read down over a field used only to pick between two sentences.
    const { store, source } = await withColumns([{ name: 'Datum', cells: ['03.04.2025'] }])
    const columns = [{ ...source.typing.columns[0], verdict: 'unresolved', evidence: null }]
    const restored = { ...source, typing: Object.freeze({ columns, confirmed: false }) }

    expect(() => typingDiagnostics(restored.typing)).not.toThrow()
    expect(typingDiagnostics(restored.typing).map((d) => d.code)).toEqual([
      'typing.ambiguous_locale',
      'typing.unconfirmed',
    ])
    expect(typingDiagnostics(restored.typing)[0].values).toEqual({
      column: 'Datum',
      alternatives: [],
    })
    expect(store.get(source.id)).toBeDefined()
  })

  it('leaves a 19-digit order number as text rather than confirmable digits', async () => {
    // The gate's whole purpose. Proposed as `number` at 100 % readable, this
    // column would be confirmed by anyone and lose its last digits at story 6.
    const { store, source } = await withColumns([
      { name: 'Auftrag', cells: ['1234567890123456789', '1234567890123456780'] },
    ])

    expect(source.typing.columns[0]).toMatchObject({ type: 'text', counts: { unparsed: 0 } })
    expect(codes(store.confirmTyping(source.id).source)).toEqual([])
  })
})

describe('confirmTyping — the first of AD-29 three gates', () => {
  it('refuses while a column is undecided, and names it', async () => {
    const { store, source } = await withColumns([GERMAN, AMBIGUOUS])

    const refused = store.confirmTyping(source.id)

    expect(refused.unresolved).toEqual(['Datum'])
    expect(refused.source.typing.confirmed).toBe(false)
    expect(store.get(source.id).typing.confirmed).toBe(false)
  })

  it('lets the Source through once the user has answered', async () => {
    const { store, source } = await withColumns([GERMAN, AMBIGUOUS])
    store.setColumnTyping(source.id, 1, { type: 'date', format: DD })

    const confirmed = store.confirmTyping(source.id)

    expect(confirmed.unresolved).toEqual([])
    expect(confirmed.source.typing.confirmed).toBe(true)
  })

  it('lets a Source through that has columns and no rows at all', async () => {
    // The end of the matrix's "empty Parquet" row: a schema with zero rows
    // yields its columns and is *confirmable*. Nothing about a column of no
    // values is undecided, so the gate has nothing to hold it shut over — and a
    // gate that refused it would block a report whose data arrives next month.
    const { store, source } = await withColumns([
      { name: 'Kunde', domain: 'text', cells: [] },
      { name: 'Betrag', domain: 'native:number', cells: [] },
    ])

    expect(source.table.rowCount).toBe(0)
    expect(source.typing.columns.map((c) => [c.name, c.type])).toEqual([
      ['Kunde', 'text'],
      ['Betrag', 'number'],
    ])
    expect(source.typing.columns.every((c) => c.verdict === 'settled')).toBe(true)
    expect(codes(source)).toEqual([['unresolved', 'typing.unconfirmed']])

    const { source: confirmed, unresolved: blocking } = store.confirmTyping(source.id)
    expect(blocking).toEqual([])
    expect(confirmed.typing.confirmed).toBe(true)
    expect(codes(confirmed)).toEqual([])
  })

  it('reopens on request — the gate stops a run, it does not trap a user', async () => {
    const { store, source } = await withColumns([GERMAN])
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

  it('settles nothing, and the gate holds', async () => {
    const { store, source } = await withColumns([symmetric()])

    expect(source.typing.columns[0]).toMatchObject({
      verdict: 'unresolved',
      evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
    })
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Termin'])
  })

  it('names both counts once one side outweighs the other', async () => {
    const column = symmetric()
    const { source } = await withColumns([{ ...column, cells: [...column.cells, '26.07.2025'] }])

    expect(source.typing.columns[0]).toMatchObject({
      verdict: 'decisive',
      format: { pattern: 'dd.MM.yyyy' },
      evidence: { decidedBy: 6, contested: 5 },
    })
  })
})

describe('what a confirmation survives', () => {
  it('survives a rename — the name is display state, the mapping is not', async () => {
    const { store, source } = await withColumns([GERMAN])
    store.confirmTyping(source.id)

    expect(store.renameSource(source.id, 'Umsatz August').typing.confirmed).toBe(true)
  })

  it('does not survive a re-read, even one that leaves the columns identical', async () => {
    // A different encoding changes every value in the table while the column
    // names stay put. A confirmation carried across would be a person vouching
    // for data they never saw.
    const { store, source } = await withColumns([GERMAN])
    store.confirmTyping(source.id)

    expect((await store.overrideEncoding(source.id, 'windows-1252')).typing.confirmed).toBe(false)

    store.confirmTyping(source.id)
    expect((await store.reconfigureParse(source.id, { headerRow: 2 })).typing.confirmed).toBe(false)
  })

  it('does not survive a change to the mapping it stood for', async () => {
    const { store, source } = await withColumns([GERMAN])
    store.confirmTyping(source.id)

    const after = store.setColumnTyping(source.id, 0, { type: 'text' })
    expect(after.typing.confirmed).toBe(false)
  })
})

describe('setColumnTyping', () => {
  it('re-scores under the choice, so a wrong one shows what it costs', async () => {
    const { store, source } = await withColumns([{ name: 'Datum', cells: ['31.12.2025', '01.01.2026'] }])

    const after = store.setColumnTyping(source.id, 0, { type: 'date', format: MM })
    const column = after.typing.columns[0]

    expect(column.counts).toMatchObject({ parsed: 1, unparsed: 1 })
    expect(column.chosen.format.pattern).toBe('MM.dd.yyyy')
  })

  it('takes the best-scoring reading when the user names only a type', async () => {
    // The user asked for a number, not for German. Handing over the first
    // candidate would collapse the hit rate with nothing on screen to say the
    // other candidate read every value.
    const { store, source } = await withColumns([{ name: 'Betrag', cells: ['1,234.56', '80.00'] }])

    const after = store.setColumnTyping(source.id, 0, { type: 'number' })
    const column = after.typing.columns[0]

    expect(column.chosen.format.locale).toBe('en-US')
    expect(column.counts).toMatchObject({ parsed: 2, unparsed: 0 })
  })

  it('returns to the proposal on type null', async () => {
    const { store, source } = await withColumns([GERMAN])
    store.setColumnTyping(source.id, 0, { type: 'text' })

    const back = store.setColumnTyping(source.id, 0, { type: null })

    expect(back.typing.columns[0]).toMatchObject({ type: 'number', chosen: null })
  })

  it('declaring a missing token does not settle a question nobody answered', async () => {
    const { store, source } = await withColumns([{ ...AMBIGUOUS, cells: [...AMBIGUOUS.cells, 'k.A.'] }])

    const after = store.setColumnTyping(source.id, 0, { missingTokens: ['k.A.'] })
    const column = after.typing.columns[0]

    expect(column.counts).toMatchObject({ missing: 1, parsed: 2 })
    expect(column.verdict).toBe('unresolved')
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Datum'])
  })

  it('validates at the command boundary', async () => {
    const { store, source } = await withColumns([GERMAN])

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
    // A reading without a type, and a command with nothing to do, are both
    // caller bugs — the second would unmake a confirmation for no reason.
    expect(() => store.setColumnTyping(source.id, 0, { format: DD })).toThrow(TypeError)
    expect(() => store.setColumnTyping(source.id, 0, {})).toThrow(TypeError)
  })

  it('writes a chosen shape it will accept back, on the column that produces one', async () => {
    // The round trip story 14 makes. `{ type: 'date' }` with no reading leaves
    // `bestFormat` to answer, and on a genuine tie it answers `null` — so the
    // store *writes* `{ type: 'date', format: null }` and used to throw
    // "a date column needs a reading" on being handed that exact object back.
    // A shape the store produces and refuses is a defect whichever end finds it.
    const { store, source } = await withColumns([{ name: 'Datum', cells: ['03.04.25', '05.06.25'] }])

    const first = store.setColumnTyping(source.id, 0, { type: 'date' })
    expect(first.typing.columns[0].chosen).toEqual({ type: 'date', format: null })
    // …and the column is still asking the reading question it was never asked.
    expect(first.typing.columns[0]).toMatchObject({ type: 'date', verdict: 'unresolved' })
    expect(store.confirmTyping(source.id).unresolved).toEqual(['Datum'])

    const replayed = store.setColumnTyping(source.id, 0, first.typing.columns[0].chosen)
    expect(replayed.typing.columns[0].chosen).toEqual(first.typing.columns[0].chosen)
    expect(replayed.typing.columns[0].verdict).toBe('unresolved')

    // `null` is now "no reading chosen" for every type, not only for the three
    // that have no readings at all — the same sentence on `number` and `date`.
    const numbers = await withColumns([{ name: 'Betrag', cells: ['1.234', '5.678'] }])
    const chosen = numbers.store.setColumnTyping(numbers.source.id, 0, { type: 'number' })
    expect(chosen.typing.columns[0].chosen).toEqual({ type: 'number', format: null })
    expect(chosen.typing.columns[0]).toMatchObject({ type: 'number', verdict: 'unresolved' })
    expect(numbers.store.confirmTyping(numbers.source.id).unresolved).toEqual(['Betrag'])
  })

  it('does not write a reading nobody chose onto the record', async () => {
    // The record and its `chosen` are serialized together by story 14, so a
    // record naming `dd.MM.yy` beside a `chosen.format` of `null` would store a
    // reading the user declined to give. The card never showed it, because the
    // reading select keys on the verdict — which is what kept it invisible
    // rather than what made it harmless.
    const { store, source } = await withColumns([{ name: 'Datum', cells: ['03.04.25', '05.06.25'] }])
    const column = store.setColumnTyping(source.id, 0, { type: 'date' }).typing.columns[0]

    expect(column.format).toBeNull()
    expect(column.format).toEqual(column.chosen.format)
    // The counts are still the column's, and they are true of *both* readings —
    // an unresolved verdict is exactly the state where the two parse the same
    // number of values.
    expect(column.counts).toMatchObject({ parsed: 2, unparsed: 0 })
    expect(column.evidence).toEqual({ alternatives: ['dd.MM.yy', 'MM.dd.yy'] })

    // A choice that *does* settle the reading still names it.
    const settled = store.setColumnTyping(source.id, 0, { type: 'date', format: DD_SHORT })
    expect(settled.typing.columns[0].format.pattern).toBe('dd.MM.yy')
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

  it('addresses each column separately', async () => {
    const { store, source } = await withColumns(twice)

    const after = store.setColumnTyping(source.id, 1, { type: 'date', format: MM })

    expect(after.typing.columns[0].chosen).toBe(null)
    expect(after.typing.columns[1].chosen.format.pattern).toBe('MM.dd.yyyy')
  })

  it('holds the gate shut over the second one', async () => {
    const { store, source } = await withColumns(twice)

    expect(store.confirmTyping(source.id).unresolved).toEqual(['Datum'])

    store.setColumnTyping(source.id, 1, { type: 'date', format: DD })
    expect(store.confirmTyping(source.id).source.typing.confirmed).toBe(true)
  })

  it('carries each annotation to its own column across a re-read', async () => {
    const { store, source } = await withColumns(twice)
    store.annotateColumn(source.id, 0, 'Rechnungsdatum')
    store.annotateColumn(source.id, 1, 'Lieferdatum')

    const after = await store.overrideEncoding(source.id, 'windows-1252')

    expect(after.typing.columns.map((c) => c.annotation)).toEqual([
      'Rechnungsdatum',
      'Lieferdatum',
    ])
  })
})

describe('annotateColumn (CAP-10)', () => {
  it('is documentation, not configuration — it leaves a confirmation standing', async () => {
    const { store, source } = await withColumns([GERMAN])
    store.confirmTyping(source.id)

    const after = store.annotateColumn(source.id, 0, 'Netto, ohne Fracht')
    const column = after.typing.columns[0]

    expect(column.annotation).toBe('Netto, ohne Fracht')
    expect(column.type).toBe('number')
    expect(after.typing.confirmed).toBe(true)
  })

  it('follows its column across a re-read — a sentence someone wrote is theirs', async () => {
    const { store, source } = await withColumns([GERMAN])
    store.annotateColumn(source.id, 0, 'Netto, ohne Fracht')

    const after = await store.overrideEncoding(source.id, 'windows-1252')

    expect(after.typing.columns[0].annotation).toBe('Netto, ohne Fracht')
  })

  it('is editable again, and clearable', async () => {
    const { store, source } = await withColumns([GERMAN])
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

  it('re-scores a chosen type against the new values', async () => {
    const store = createSourceStore({ csv: columnReader(shifting) })
    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'daten.csv' })
    store.setColumnTyping(source.id, 0, { type: 'date', format: DD })
    expect(store.get(source.id).typing.columns[0].counts).toMatchObject({ parsed: 2, unparsed: 0 })

    const after = await store.reconfigureParse(source.id, { headerRow: 2 })
    const column = after.typing.columns[0]

    // The choice stands — the user answered a question and it has not changed —
    // but what it now costs is on the record rather than silent.
    expect(column.chosen.format.pattern).toBe('dd.MM.yyyy')
    expect(column.counts).toMatchObject({ parsed: 1, unparsed: 1 })
  })

  it('keeps the missing tokens the user declared', async () => {
    // They are part of the typing, not a display setting: dropping them back to
    // the defaults would move the null share and the hit rate, silently.
    const { store, source } = await withColumns([{ name: 'Wert', cells: ['12', '7', 'entfällt'] }])
    store.setColumnTyping(source.id, 0, { missingTokens: ['entfällt'] })
    expect(store.get(source.id).typing.columns[0].counts).toMatchObject({ missing: 1, parsed: 2 })

    const after = await store.overrideEncoding(source.id, 'windows-1252')
    const column = after.typing.columns[0]

    expect(column.missingTokens).toEqual(['entfällt'])
    expect(column.counts).toMatchObject({ missing: 1, parsed: 2 })
  })

  it('keeps a native column native, and refuses to retype it (AD-20)', async () => {
    const { store, source } = await withColumns([
      { name: 'Menge', domain: 'native:number', cells: ['1', '2'] },
    ])
    expect(source.typing.columns[0]).toMatchObject({ domain: 'native:number', type: 'number' })

    // Guarded by domain, not by type: `number` is a settable type, and a
    // type-keyed guard let this through and re-inferred a column its format had
    // already answered for.
    expect(() => store.setColumnTyping(source.id, 0, { type: 'text' })).toThrow(TypeError)
    expect(() => store.setColumnTyping(source.id, 0, { type: 'number', format: null })).toThrow(
      TypeError,
    )

    // `type: null` is not a retype and is not refused. It withdraws a choice and
    // hands the column back to what the reader and detection propose — which,
    // for a native column, is the declaration it already carries. Story 3
    // shipped "Zurück zum Vorschlag" as the fix for a closed defect; a reset
    // that threw would be that defect again, on the columns least able to
    // recover from it.
    const reset = store.setColumnTyping(source.id, 0, { type: null })
    expect(reset.typing.columns[0]).toMatchObject({
      domain: 'native:number',
      type: 'number',
      chosen: null,
    })

    // What is still editable is what documents the column rather than typing it.
    const tokens = store.setColumnTyping(source.id, 0, { missingTokens: ['1'] })
    expect(tokens.typing.columns[0]).toMatchObject({ domain: 'native:number', type: 'number' })
    expect(tokens.typing.columns[0].counts).toMatchObject({ missing: 1, parsed: 1 })

    const after = await store.reconfigureParse(source.id, { headerRow: 2 })
    expect(after.typing.columns[0]).toMatchObject({ domain: 'native:number', type: 'number' })
  })

  it('lets the format win when a column becomes native under a chosen type', async () => {
    // A sheet switch can do exactly this: the same column name, strings on one
    // sheet and real numbers on the next. A native column is never retyped, so
    // the older answer goes rather than overriding the declaration.
    const perSheet = (config) =>
      config.sheet === 'Zwei'
        ? [{ name: 'Menge', domain: 'native:number', cells: ['1', '2'] }]
        : [{ name: 'Menge', domain: 'text', cells: ['1.234,56', '80,00'] }]

    const store = createSourceStore({ xlsx: columnReader(perSheet) })
    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'bericht.xlsx' })
    store.setColumnTyping(source.id, 0, { type: 'text' })
    store.annotateColumn(source.id, 0, 'Stück, nicht Kilo')
    expect(store.get(source.id).typing.columns[0].chosen).toMatchObject({ type: 'text' })

    const after = await store.reconfigureParse(source.id, { sheet: 'Zwei' })
    const column = after.typing.columns[0]

    expect(column).toMatchObject({ domain: 'native:number', type: 'number', chosen: null })
    // The sentence someone wrote is still theirs; the confirmation is not.
    expect(column.annotation).toBe('Stück, nicht Kilo')
    expect(after.typing.confirmed).toBe(false)
  })

  it('names a native type the catalogue does not admit, and keeps it out of the domain', async () => {
    // A reader is the one producer that can name a type nothing downstream
    // knows. Parquet has TIME, INTERVAL and DECIMAL columns; the domain is what
    // story 14 serializes into a Recipe and story 6 converts against, so the
    // declaration is discarded there and survives only as provenance.
    const { store, source } = await withColumns([
      { name: 'Preis', domain: 'native:decimal', cells: ['1.234,56', '80,00'] },
    ])
    const column = source.typing.columns[0]

    expect(column).toMatchObject({ domain: 'text', type: 'number', refusedNativeType: 'decimal' })
    expect(column.format.locale).toBe('de-DE') // full detection, not a declaration
    expect(codes(source)).toContainEqual(['warning', 'typing.unknown_native_type'])
    expect(source.diagnostics.find((d) => d.code === 'typing.unknown_native_type').values).toEqual({
      column: 'Preis',
      type: 'decimal',
    })

    // It is settable, because nothing about it was settled by its format …
    const retyped = store.setColumnTyping(source.id, 0, { type: 'text' })
    expect(retyped.typing.columns[0]).toMatchObject({ type: 'text', domain: 'text' })

    // … and the refusal is still reported after an edit that recounts the
    // column. The diagnostics are rebuilt from the records on every commit, so a
    // word that did not survive the record would go quiet here.
    expect(codes(retyped)).toContainEqual(['warning', 'typing.unknown_native_type'])
    const tokens = store.setColumnTyping(source.id, 0, { missingTokens: ['80,00'] })
    expect(tokens.typing.columns[0].refusedNativeType).toBe('decimal')
    expect(codes(tokens)).toContainEqual(['warning', 'typing.unknown_native_type'])
  })

  it('says nothing about an unknown native type once the column is confirmed clean', async () => {
    // The complement of the case above: an admissible declaration and a plain
    // text column both report no refusal, so the warning cannot become noise
    // every Source carries.
    const { source } = await withColumns([
      { name: 'Menge', domain: 'native:number', cells: ['1', '2'] },
      { name: 'Kunde', cells: ['Anna', 'Bernd'] },
    ])

    expect(source.typing.columns.map((c) => c.refusedNativeType)).toEqual([null, null])
    expect(codes(source)).not.toContainEqual(['warning', 'typing.unknown_native_type'])
  })

  it('drops what no column of that name survives to hold', async () => {
    const renaming = (config) => [
      { name: config.headerRow === 2 ? 'Summe' : 'Betrag', cells: ['1.234,56', '80,00'] },
    ]
    const store = createSourceStore({ csv: columnReader(renaming) })
    const { source } = await store.addSource({ bytes: utf8('x'), fileName: 'daten.csv' })
    store.annotateColumn(source.id, 0, 'Netto, ohne Fracht')

    const after = await store.reconfigureParse(source.id, { headerRow: 2 })

    expect(after.typing.columns[0]).toMatchObject({ name: 'Summe', annotation: '' })
  })
})
