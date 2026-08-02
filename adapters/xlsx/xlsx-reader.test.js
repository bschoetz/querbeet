// The XLSX reader against real workbook bytes, under Vitest with no browser
// (AD-27) — an adapter is framework-free code behind a port, and only the built
// artefact needs Playwright.
//
// The fixtures are written here with `write-excel-file` (a devDependency) rather
// than committed as binaries: a checked-in `.xlsx` is opaque in a diff, and the
// one thing every case below turns on is which *type* a cell was written as.
// Nothing about the read depends on the writer — `read-excel-file` sees only a
// zip archive of XML, whoever produced it.

import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/node'
import { xlsxReader } from './xlsx-reader.js'

const s = (value) => ({ value, type: String })
const n = (value) => ({ value, type: Number })
const b = (value) => ({ value, type: Boolean })
const d = (value) => ({ value, type: Date, format: 'dd.mm.yyyy' })
const dt = (value) => ({ value, type: Date, format: 'dd.mm.yyyy hh:mm' })
const utc = (...parts) => new Date(Date.UTC(...parts))

/** @returns {Promise<ArrayBuffer>} */
async function workbook(sheets) {
  const writer = await writeXlsxFile(sheets.map(({ name, rows }) => ({ data: rows, sheet: name })))
  const buffer = await writer.toBuffer()
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

const oneSheet = (rows) => workbook([{ name: 'Umsatz', rows }])

const read = (bytes, config) => xlsxReader.read(bytes, config)

const byName = (table, name) => table.columns.find((c) => c.name === name)
const codes = (result) => result.diagnostics.map((x) => [x.severity, x.code])

describe('the type map', () => {
  it('declares a number column native, with shortest round-trip cells', async () => {
    const result = await read(
      await oneSheet([
        [s('Kunde'), s('Betrag')],
        [s('Anna'), n(1234.5)],
        [s('Bernd'), n(-0.25)],
        [s('Clara'), n(0)],
      ]),
    )

    expect(byName(result.table, 'Betrag')).toMatchObject({ domain: 'native:number' })
    expect(byName(result.table, 'Betrag').cells).toEqual(['1234.5', '-0.25', '0'])
    // The neighbouring string column is not typed by association.
    expect(byName(result.table, 'Kunde').domain).toBe('text')
    expect(result.table.rowCount).toBe(3)
  })

  it('reads a date column as yyyy-MM-dd, at the day the sheet shows', async () => {
    // The serial-to-Date conversion builds at UTC+0, so no local zone can move
    // the calendar day by one — which is the failure AD-21 exists to prevent.
    const result = await read(
      await oneSheet([[s('Datum')], [d(utc(2025, 7, 1))], [d(utc(2024, 1, 29))]]),
    )

    expect(byName(result.table, 'Datum')).toMatchObject({ domain: 'native:date' })
    expect(byName(result.table, 'Datum').cells).toEqual(['2025-08-01', '2024-02-29'])
  })

  it('makes one time-of-day turn the whole column into a datetime', async () => {
    // Excel has one date type; the distinction AD-21 draws is time-of-day, and
    // it is a property of the column rather than of a cell. Rendered per value,
    // the midnight row would come out as `2025-08-01` and then count as
    // unparsed under its own column's type.
    const result = await read(
      await oneSheet([[s('Erfasst')], [dt(utc(2025, 7, 1, 14, 30))], [dt(utc(2025, 7, 2))]]),
    )

    expect(byName(result.table, 'Erfasst')).toMatchObject({ domain: 'native:datetime' })
    expect(byName(result.table, 'Erfasst').cells).toEqual([
      '2025-08-01T14:30:00.000Z',
      '2025-08-02T00:00:00.000Z',
    ])
  })

  it('declares a boolean column native and writes true/false', async () => {
    const result = await read(await oneSheet([[s('Aktiv')], [b(true)], [b(false)]]))

    expect(byName(result.table, 'Aktiv')).toMatchObject({ domain: 'native:boolean' })
    expect(byName(result.table, 'Aktiv').cells).toEqual(['true', 'false'])
  })

  it('leaves an all-string column to detection — German numbers as text are the normal case', async () => {
    // The office case: a column formatted as text, holding `1.234,56`. Declaring
    // it native would skip the very locale question it needs asked.
    const result = await read(
      await oneSheet([[s('Betrag')], [s('1.234,56')], [s('80,00')], [s('0123')]]),
    )

    expect(byName(result.table, 'Betrag').domain).toBe('text')
    expect(byName(result.table, 'Betrag').cells).toEqual(['1.234,56', '80,00', '0123'])
  })
})

describe('a column that is not of one mind', () => {
  it('keeps the declaration when only strings ride along with the typed cells', async () => {
    // `k.A.` is an absence and `x` is an unreadable value; both are the sweep's
    // business, not a reason to abandon a declaration every number agrees with.
    const result = await read(
      await oneSheet([[s('Menge')], [n(12)], [s('k.A.')], [s('x')], [n(7)]]),
    )

    expect(byName(result.table, 'Menge')).toMatchObject({ domain: 'native:number' })
    expect(byName(result.table, 'Menge').cells).toEqual(['12', 'k.A.', 'x', '7'])
    expect(codes(result)).toEqual([])
  })

  it('falls back to text with a warning when the typed cells disagree', async () => {
    // A number and a date in one column. No declaration is true of all of it,
    // and typing the majority would type the minority into nothing.
    const result = await read(
      await oneSheet([[s('Wert')], [n(12)], [d(utc(2025, 7, 1))], [n(7)]]),
    )

    expect(byName(result.table, 'Wert').domain).toBe('text')
    expect(byName(result.table, 'Wert').cells).toEqual(['12', '2025-08-01', '7'])
    expect(codes(result)).toEqual([['warning', 'xlsx.mixed_types']])
    // The payload in full, not only the column: `ui/SourcesPane.vue` renders
    // `kinds` through the German type labels, and an unpinned payload lets the
    // sentence break without a test noticing.
    expect(result.diagnostics[0].values).toEqual({ column: 'Wert', kinds: ['date', 'number'] })
  })

  it('names every kind it found, sorted, however many disagree', async () => {
    const result = await read(
      await oneSheet([[s('Wert')], [b(true)], [n(12)], [d(utc(2025, 7, 1))]]),
    )

    expect(result.diagnostics[0].values).toEqual({
      column: 'Wert',
      kinds: ['boolean', 'date', 'number'],
    })
    // Every kind that appears is a type the catalogue has a German word for, so
    // the rendered sentence can never fall back to an English one.
    expect(byName(result.table, 'Wert').cells).toEqual(['true', '12', '2025-08-01'])
  })

  it('names one column per disagreement, not one per file', async () => {
    const result = await read(
      await oneSheet([
        [s('Links'), s('Rechts')],
        [n(12), n(1)],
        [d(utc(2025, 7, 1)), b(false)],
      ]),
    )

    expect(codes(result)).toEqual([
      ['warning', 'xlsx.mixed_types'],
      ['warning', 'xlsx.mixed_types'],
    ])
    expect(result.diagnostics.map((x) => x.values.column)).toEqual(['Links', 'Rechts'])
  })
})

describe('the header row', () => {
  it('proposes the first row carrying the sheet’s dominant cell count', async () => {
    // The CSV rule restated over null-padded rows: a report preamble is
    // narrower than the table it precedes, and is preamble rather than damage.
    const result = await read(
      await oneSheet([
        [s('Bericht 2025')],
        [s('Kunde'), s('Betrag'), s('Notiz')],
        [s('Anna'), n(1), s('ok')],
        [s('Bernd'), n(2), s('ok')],
      ]),
    )

    expect(result.proposal.headerRow).toBe(2)
    expect(result.table.columns.map((c) => c.name)).toEqual(['Kunde', 'Betrag', 'Notiz'])
    expect(result.table.rowCount).toBe(2)
  })

  it('takes a correction, and the columns follow it', async () => {
    const bytes = await oneSheet([
      [s('Bericht 2025'), s(''), s('')],
      [s('Kunde'), s('Betrag'), s('Notiz')],
      [s('Anna'), n(1), s('ok')],
    ])

    const corrected = await read(bytes, { headerRow: 2 })

    expect(corrected.proposal.headerRow).toBe(2)
    expect(corrected.table.columns.map((c) => c.name)).toEqual(['Kunde', 'Betrag', 'Notiz'])
  })

  it('clamps a header row past the end to the last row of the sheet', async () => {
    // The clamp keeps the read defined; it does not keep the table populated —
    // with the last row promoted to header there is nothing under it, which is
    // what the counts say. The proposal is what the control binds to, and the
    // store adopts it, so the refused 99 does not survive anywhere.
    const result = await read(await oneSheet([[s('Kunde')], [s('Anna')]]), { headerRow: 99 })

    expect(result.proposal.headerRow).toBe(2)
    expect(result.table.columns.map((c) => c.name)).toEqual(['Anna'])
    expect(result.table.rowCount).toBe(0)
  })

  it('canonicalizes a header cell exactly like a value', async () => {
    // `String(aDate)` yields a local-zone sentence — measured,
    // `Fri Aug 01 2025 02:00:00 GMT+0200 (Mitteleuropäische Sommerzeit)`. A
    // monthly report with dates across its header row is an ordinary shape, and
    // a column name that differs per machine and per CI timezone breaks the
    // carry-over of annotations and chosen types, which is keyed by name.
    const result = await read(
      await oneSheet([
        [s('Kunde'), d(utc(2025, 7, 1)), n(2025), b(true)],
        [s('Anna'), n(1), n(2), n(3)],
      ]),
    )

    expect(result.table.columns.map((c) => c.name)).toEqual(['Kunde', '2025-08-01', '2025', 'true'])
    for (const column of result.table.columns) {
      expect(column.name).not.toContain('GMT')
    }
  })

  it('reports a blank header cell rather than leaving a column unnamed in silence', async () => {
    // The header row is named explicitly: a row with a gap in it is by
    // definition not the row with the dominant cell count, so the proposal
    // would have moved past it.
    const result = await read(
      await oneSheet([
        [s('Kunde'), s(''), s('Betrag')],
        [s('Anna'), s('x'), n(1)],
      ]),
      { headerRow: 1 },
    )

    expect(result.table.columns.map((c) => c.name)).toEqual(['Kunde', '', 'Betrag'])
    expect(codes(result)).toEqual([['warning', 'xlsx.blank_header']])
    expect(result.diagnostics[0].values).toEqual({ columns: [2] })
  })

  it('reports a repeated header name — the columns stay two, the names do not', async () => {
    const result = await read(
      await oneSheet([
        [s('Betrag'), s('Betrag'), s('Kunde')],
        [n(1), n(2), s('Anna')],
      ]),
    )

    expect(result.table.columns.map((c) => c.name)).toEqual(['Betrag', 'Betrag', 'Kunde'])
    expect(result.table.columns[0].cells).toEqual(['1'])
    expect(result.table.columns[1].cells).toEqual(['2'])
    expect(codes(result)).toEqual([['warning', 'xlsx.duplicate_header']])
    expect(result.diagnostics[0].values).toEqual({ columns: ['Betrag'] })
  })

  it('counts the rows under the header, not the cells of column zero', async () => {
    // A sheet whose header row is entirely blank has no columns and still has a
    // height; a card reporting 0 rows over it would be describing the header
    // decision rather than the file.
    const result = await read(
      await oneSheet([[s('Bericht')], [s('Kunde')], [s('Anna')], [s('Bernd')]]),
      { headerRow: 2 },
    )

    expect(result.table.rowCount).toBe(2)
    expect(result.table.columns[0].cells).toEqual(['Anna', 'Bernd'])
  })
})

describe('more than one sheet', () => {
  const three = () =>
    workbook([
      { name: 'Umsatz', rows: [[s('Kunde')], [s('Anna')]] },
      { name: 'Kosten', rows: [[s('Position'), s('Betrag')], [s('Miete'), n(800)]] },
      { name: 'Notizen', rows: [[s('Text')], [s('nichts')]] },
    ])

  it('proposes the first sheet and lists the others', async () => {
    const result = await read(await three())

    expect(result.proposal.sheet).toBe('Umsatz')
    expect(result.proposal.sheets).toEqual(['Umsatz', 'Kosten', 'Notizen'])
    expect(result.table.columns.map((c) => c.name)).toEqual(['Kunde'])
  })

  it('reads the sheet the config names', async () => {
    const result = await read(await three(), { sheet: 'Kosten' })

    expect(result.proposal.sheet).toBe('Kosten')
    expect(result.table.columns.map((c) => c.name)).toEqual(['Position', 'Betrag'])
    expect(byName(result.table, 'Betrag').domain).toBe('native:number')
  })

  it('says so when the named sheet is gone, rather than failing or guessing quietly', async () => {
    // A newer export with a renamed tab. Reading the first sheet is the usable
    // answer; doing it silently would put another sheet's numbers under the
    // same column names.
    const result = await read(await three(), { sheet: 'Vertrieb' })

    expect(result.proposal.sheet).toBe('Umsatz')
    expect(codes(result)).toEqual([['warning', 'xlsx.sheet_missing']])
    expect(result.diagnostics[0].values).toEqual({ sheet: 'Vertrieb', using: 'Umsatz' })
  })
})

describe('nothing to read', () => {
  it('reports an empty sheet as its own finding, naming the sheet', async () => {
    // The sheet half of the matrix's "empty sheet / workbook" row. The workbook
    // half — a file carrying no sheet at all — is unreachable from any fixture
    // this repo can generate: `write-excel-file` always emits `Sheet1`, and a
    // workbook with zero sheets is not a valid `.xlsx` for Excel either. The
    // branch is defensive and is logged in deferred-work.md rather than faked
    // with a stub that would test the stub.
    const result = await read(await workbook([{ name: 'Leer', rows: [[]] }]))

    expect(result.table.columns).toEqual([])
    expect(result.table.rowCount).toBe(0)
    expect(codes(result)).toEqual([['warning', 'xlsx.empty']])
    // The German sentence branches on this, so an empty string here would be
    // the wrong one of the two.
    expect(result.diagnostics[0].values).toEqual({ sheet: 'Leer' })
    // Still a sheet the user can switch away from.
    expect(result.proposal.sheet).toBe('Leer')
  })

  it('throws on bytes that are not a workbook, so the store can refuse the Source', async () => {
    await expect(read(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer)).rejects.toThrow()
    await expect(read(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow()
  })
})

describe('what the reader promises the registry', () => {
  it('freezes everything it hands over (AD-6)', async () => {
    const result = await read(await oneSheet([[s('Kunde')], [s('Anna')]]))

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.table)).toBe(true)
    expect(Object.isFrozen(result.table.columns)).toBe(true)
    expect(Object.isFrozen(result.table.columns[0].cells)).toBe(true)
  })

  it('has no damage report to make — a sheet has no ragged rows', async () => {
    const result = await read(await oneSheet([[s('Kunde'), s('Betrag')], [s('Anna')]]))

    expect(result.damage).toEqual({ mismatches: [], unclosedQuoteRow: null })
    // The short row is padded by the library, so the missing cell is an empty
    // value rather than an excluded row.
    expect(byName(result.table, 'Betrag').cells).toEqual([''])
  })
})
