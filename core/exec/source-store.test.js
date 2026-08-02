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
    expect(updated.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['error', 'source.unreadable'],
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
