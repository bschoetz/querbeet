// The adapter rows of the spec's I/O matrix, under Vitest with no browser —
// the adapter is framework-free, so AD-27's Vitest envelope covers it.
// The reader receives *decoded text*; encoding fixtures live in core/types.

import { describe, expect, it } from 'vitest'
import { csvReader } from './csv-reader.js'

const read = (text, config) => csvReader.read(text, config)

describe('parsing and delimiter detection', () => {
  it('parses a comma grid into text columns', () => {
    const r = read('Name,Betrag\nAnna,10\nBernd,20\n')

    expect(r.proposal).toEqual({ delimiter: ',', headerRow: 1 })
    expect(r.table.columns.map((c) => c.name)).toEqual(['Name', 'Betrag'])
    expect(r.table.columns[0].cells).toEqual(['Anna', 'Bernd'])
    expect(r.table.rowCount).toBe(2)
    expect(r.damage.mismatches).toEqual([])
    expect(r.diagnostics).toEqual([])
  })

  it('detects the German semicolon export', () => {
    const r = read('Kunde;Betrag\nBäcker;12,50\nMetzger;80,00\n')

    expect(r.proposal.delimiter).toBe(';')
    expect(r.table.columns[1].cells).toEqual(['12,50', '80,00'])
  })

  it('never types a cell — dynamicTyping is permanently off (AD-20)', () => {
    const r = read('Nr,Datum\n007,2024-01-01\n')

    expect(r.table.columns[0].cells).toEqual(['007'])
    expect(r.table.columns.every((c) => c.domain === 'text')).toBe(true)
  })

  it('obeys an explicit delimiter instead of re-guessing', () => {
    const r = read('a;b\n1;2\n', { delimiter: ',' })

    expect(r.proposal.delimiter).toBe(',')
    expect(r.table.columns.map((c) => c.name)).toEqual(['a;b'])
    expect(r.table.columns[0].cells).toEqual(['1;2'])
  })

  it('treats an empty-string delimiter as "propose", never as a silent guess', () => {
    // '' is Papa's "auto-detect" flag; passed through as if explicit it would
    // guess with no unresolved diagnostic and report '' as the proposal.
    const r = read('a;b\n1;2\n', { delimiter: '' })

    expect(r.proposal.delimiter).toBe(';')
    expect(r.diagnostics).toEqual([])
  })

  it('reports an empty file as csv.empty — no columns, no delimiter question', () => {
    for (const text of ['', '   \n \n']) {
      const r = read(text)

      expect(r.table).toEqual({ columns: [], rowCount: 0 })
      expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['warning', 'csv.empty']])
      expect(r.damage.mismatches).toEqual([])
    }
  })

  it('survives a preamble longer than ten lines — the guess window is wider than Papa’s default', () => {
    const junk = Array.from({ length: 12 }, (_, i) => `Hinweis ${i + 1}`)
    const data = Array.from({ length: 40 }, (_, i) => `K${i};O${i};${i}`)
    const r = read([...junk, 'Kunde;Ort;Betrag', ...data].join('\n') + '\n')

    expect(r.proposal.delimiter).toBe(';')
    expect(r.proposal.headerRow).toBe(13)
    expect(r.diagnostics).toEqual([])
    expect(r.table.rowCount).toBe(40)
  })

  it('marks an undetectable delimiter unresolved and falls back to comma — a question, not a guess', () => {
    const r = read('eins\nzwei\ndrei\n')

    expect(r.proposal.delimiter).toBe(',')
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({
      severity: 'unresolved',
      code: 'csv.delimiter_undetectable',
    })
    // Still parsed and inspectable under the fallback.
    expect(r.table.columns[0].cells).toEqual(['zwei', 'drei'])
  })

  it('answers the delimiter question with an explicit choice — no more unresolved', () => {
    const r = read('eins\nzwei\ndrei\n', { delimiter: ';' })

    expect(r.diagnostics).toEqual([])
    expect(r.proposal.delimiter).toBe(';')
  })
})

describe('header proposal', () => {
  const preamble =
    'Bericht 2024\nerstellt am 01.02.\n\nName,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln,20\nClara,Essen,30\n'

  it('proposes the first row with the dominant field count, past a preamble', () => {
    const r = read(preamble)

    expect(r.proposal.headerRow).toBe(4)
    expect(r.table.columns.map((c) => c.name)).toEqual(['Name', 'Ort', 'Betrag'])
    expect(r.table.rowCount).toBe(3)
    // Preamble is out of scope by the header decision — not data, not damage.
    expect(r.damage.mismatches).toEqual([])
  })

  it('honours a corrected header row', () => {
    const r = read(preamble, { headerRow: 1 })

    expect(r.proposal.headerRow).toBe(1)
    expect(r.table.columns.map((c) => c.name)).toEqual(['Bericht 2024'])
  })
})

describe('damage detection (CAP-39)', () => {
  const damaged =
    'Name,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln\nClara,Hamburg,30\nDora,Essen,40,extra\nEmil,Bonn,50\n'

  it('excludes deviating rows, names them by number, and keeps them raw', () => {
    const r = read(damaged)

    expect(r.table.rowCount).toBe(3)
    expect(r.table.columns[0].cells).toEqual(['Anna', 'Clara', 'Emil'])

    expect(r.damage.mismatches).toEqual([
      { row: 3, fields: 2, raw: 'Bernd,Köln' },
      { row: 5, fields: 4, raw: 'Dora,Essen,40,extra' },
    ])

    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0].severity).toBe('warning')
    expect(r.diagnostics[0].code).toBe('csv.field_count_mismatch')
    expect(r.diagnostics[0].values).toMatchObject({ expected: 3, rows: [3, 5], count: 2 })
  })

  it('reports an unclosed quote as that defect, with its row, and keeps the swallowed raw', () => {
    const r = read('a,b\n1,"offen\n2,3\n')

    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['error', 'csv.unclosed_quote'],
    ])
    expect(r.diagnostics[0].values).toEqual({ row: 2 })
    expect(r.damage.unclosedQuoteRow).toBe(2)

    // The swallowed remainder never enters the table — even though its field
    // count happens to match — but stays inspectable raw.
    expect(r.table.rowCount).toBe(0)
    expect(r.damage.mismatches).toHaveLength(1)
    expect(r.damage.mismatches[0].row).toBe(2)
    expect(r.damage.mismatches[0].raw).toContain('2,3')
  })

  it('names a quote defect Papa parses through — the row stays, the defect is visible', () => {
    // `"x"y",2` — trailing quote inside a quoted field. Papa recovers with a
    // defined parse (InvalidQuotes, no MissingQuotes); silent recovery would be
    // a silently changed value.
    const r = read('a,b\n"x"y",2\n3,4\n')

    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'csv.malformed_quote'],
    ])
    expect(r.diagnostics[0].values).toEqual({ rows: [2] })
    // The row is in the table — its parse is defined, unlike an unclosed quote.
    expect(r.table.rowCount).toBe(2)
    expect(r.table.columns[0].cells).toEqual(['x"y', '3'])
    expect(r.damage.unclosedQuoteRow).toBeNull()
  })

  it('keeps an unclosed quote at the header row inspectable in the damage report', () => {
    // The quote opens on line 1 and swallows the whole file; the exclusion loop
    // never visits rows at or before the header, but "als Rohtext einsehbar"
    // must hold wherever the defect sits.
    const r = read('"Name,Ort\nAnna,Berlin\n')

    expect(r.damage.unclosedQuoteRow).toBe(1)
    expect(r.diagnostics.map((d) => d.code)).toContain('csv.unclosed_quote')
    expect(r.damage.mismatches).toHaveLength(1)
    expect(r.damage.mismatches[0].row).toBe(1)
    expect(r.damage.mismatches[0].raw).toContain('Anna,Berlin')
  })

  it('reports damage by file line, not record index — quoted newlines shift the two apart', () => {
    // Record 2 legitimately spans lines 2–3; the damaged single-field record is
    // record 3 but *file line 4*, which is the number a text editor shows.
    const r = read('a,b\n"x\ny",2\nc\nd,e\n')

    expect(r.table.rowCount).toBe(2)
    expect(r.damage.mismatches).toEqual([{ row: 4, fields: 1, raw: 'c' }])
    expect(r.diagnostics[0].values).toMatchObject({ expected: 2, rows: [4], count: 1 })
  })

  it('freezes what it returns — these structures land in the registry (AD-6)', () => {
    const r = read('a,b\n1,2\n')

    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.table)).toBe(true)
    expect(Object.isFrozen(r.table.columns)).toBe(true)
    expect(Object.isFrozen(r.table.columns[0].cells)).toBe(true)
    expect(Object.isFrozen(r.damage.mismatches)).toBe(true)
  })
})
