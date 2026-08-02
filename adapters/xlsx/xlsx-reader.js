// The XLSX SourceReader, on read-excel-file 9.3.5 — the library name appears
// here and in app/, nowhere else (AD-1, AD-2).
//
// The package has **no root export**; `read-excel-file/browser` is the entry.
// It returns `[{ sheet, data }]` with the rows of each sheet null-padded to a
// uniform width and empty trailing rows and columns already dropped. Cells
// arrive as real values: `number`, `Date`, `boolean`, `string`, or `null` for an
// empty cell. A `Date` is built at UTC midnight — `parseExcelDate` adds no local
// offset — so serial 45870 is `2025-08-01T00:00:00.000Z` and not the day before
// it somewhere west of Greenwich.
//
// AD-15: querbeet creates no worker here. The XML-parse worker is commented out
// in 9.3.5 (`CAN_USE_WORKER = false`); what does run is fflate's own unzip
// worker, and only for archives over 512 KB. It is a classic script from a blob
// URL built out of strings inlined in the bundle, which is the one shape
// measured to work from a `file://` page in both engines.
//
// TWO DECISIONS SHAPE EVERYTHING BELOW.
//
//   CELLS ARE CANONICAL TEXT. A number leaves here as its shortest round-trip
//   decimal, a date as `yyyy-MM-dd`, a datetime as ISO 8601 UTC, a boolean as
//   `true`/`false`, an empty cell as `''`. The typed-ness lives in the column's
//   `domain` declaration (AD-20), never in the cell values. Story 3's whole
//   machinery — the missing-value sweep, the preview, the annotations — is
//   string-based, and a `Date` object handed into it stringifies to a
//   local-zone sentence and stays mutable inside a frozen entry.
//
//   A COLUMN IS TYPED BY WHAT IS IN IT, not by its first cell. If every typed
//   (non-string) cell agrees on one kind, the column declares that kind and the
//   strings ride along verbatim — they count as missing or as unparsed, which is
//   the sweep AD-20 requires. If typed cells disagree, no declaration is
//   honest: the column is `text`, everything is canonicalized, and a warning
//   names it.

import readXlsxFile from 'read-excel-file/browser'
import { BOOLEAN, DATE, DATETIME, NUMBER, TEXT, nativeDomain } from '@core/types/catalog.js'
import { warning } from '@core/diagnostics/diagnostic.js'

/** read-excel-file wants an ArrayBuffer; the registry may hold a view. */
function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const isDate = (value) => value instanceof Date

/** Excel has one date type; the distinction AD-21 draws is time-of-day. */
const isUtcMidnight = (value) =>
  value.getUTCHours() === 0 &&
  value.getUTCMinutes() === 0 &&
  value.getUTCSeconds() === 0 &&
  value.getUTCMilliseconds() === 0

/** ISO 8601, or `''` for a `Date` outside the range JS can express. Excel's
 *  serial arithmetic reaches values `toISOString` throws a `RangeError` on, and
 *  one such cell must not cost the whole workbook: an empty cell is an absence
 *  the sweep already counts, which is what the sweep is for. */
function isoText(value, dayOnly) {
  try {
    const iso = value.toISOString()
    return dayOnly ? iso.slice(0, 10) : iso
  } catch {
    return ''
  }
}

/** What kind of typed value this is, or `null` for a string or an empty cell.
 *  Both `Date` flavours answer `date` here: whether the column is a date or a
 *  datetime is decided over the whole column, not per cell. */
function kindOf(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return NUMBER
  if (typeof value === 'boolean') return BOOLEAN
  if (isDate(value)) return DATE
  return null // a string, and anything else the library might one day deliver
}

/**
 * The canonical text of one cell, under a column that reads as `type`.
 *
 * The column's type is what decides a `Date`'s shape, not the value: a
 * `native:datetime` column whose one midnight value rendered as `yyyy-MM-dd`
 * would count that value as unparsed under its own type, which is a defect
 * dressed as a finding. Only a `text` column — the mixed case — falls back to
 * deciding per value, and nothing sweeps a text column.
 */
function canonical(value, type) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (isDate(value)) {
    if (type === DATE) return isoText(value, true)
    if (type === DATETIME) return isoText(value, false)
    return isoText(value, isUtcMidnight(value))
  }
  return String(value)
}

const isEmptyCell = (value) => value === null || value === undefined || String(value).trim() === ''

/** Most frequent non-empty cell count; ties go to the wider row, since a report
 *  preamble is typically narrower than the table it precedes. This is the CSV
 *  rule restated over null-padded rows — same shape, same tie-break. */
function dominantWidth(counts) {
  const freq = new Map()
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1)

  let dominant = 0
  let best = 0
  for (const [count, n] of freq) {
    if (n > best || (n === best && count > dominant)) {
      dominant = count
      best = n
    }
  }
  return dominant
}

const clampRow = (n, rowCount) => Math.min(Math.max(1, Math.trunc(n)), Math.max(rowCount, 1))

const EMPTY_RESULT = (proposal, diagnostics) =>
  Object.freeze({
    table: Object.freeze({ columns: Object.freeze([]), rowCount: 0 }),
    proposal: Object.freeze(proposal),
    damage: Object.freeze({ mismatches: Object.freeze([]), unclosedQuoteRow: null }),
    diagnostics: Object.freeze(diagnostics),
  })

/** @type {import('@ports/index.js').SourceReader} */
export const xlsxReader = {
  media: 'binary',

  /**
   * @param {ArrayBuffer} bytes  the retained bytes (AD-7) — never a File
   * @param {{ headerRow?: number | null, sheet?: string | null }} [config]
   *   `null` = propose; explicit values are user corrections and survive
   *   re-reads. There is no encoding and no delimiter here: a workbook is a zip
   *   archive of UTF-8 XML and says so itself.
   * @returns {Promise<object>} the reader result. Async because the library is:
   *   fflate unzips through a callback and the XML is parsed in interruptible
   *   chunks. A throw or a rejection becomes `source.unreadable` in the store.
   */
  async read(bytes, config = {}) {
    const sheets = await readXlsxFile(toArrayBuffer(bytes))
    const available = Object.freeze(sheets.map((s) => s.sheet))
    const diagnostics = []

    // A workbook with no sheet at all is its own finding, and there is no sheet
    // name a proposal could honestly carry.
    if (sheets.length === 0) {
      return EMPTY_RESULT({ headerRow: null, sheet: null, sheets: available }, [
        warning('xlsx.empty', { sheet: '' }),
      ])
    }

    // A named sheet that is no longer in the workbook is a question, not a
    // crash: the file was replaced by a newer export and the tab was renamed.
    // The first sheet is proposed instead and the card says what happened.
    let chosen = sheets[0]
    if (config.sheet) {
      const found = sheets.find((s) => s.sheet === config.sheet)
      if (found) chosen = found
      else diagnostics.push(warning('xlsx.sheet_missing', { sheet: config.sheet, using: chosen.sheet }))
    }

    const proposalFor = (headerRow) =>
      Object.freeze({ headerRow, sheet: chosen.sheet, sheets: available })

    const rows = chosen.data
    if (rows.length === 0) {
      return EMPTY_RESULT(proposalFor(1), [...diagnostics, warning('xlsx.empty', { sheet: chosen.sheet })])
    }

    // The header row is the first row carrying the sheet's dominant non-empty
    // cell count — the CSV rule, counted over cells rather than fields, because
    // every row here is already padded to the same length.
    const widths = rows.map((row) => row.filter((cell) => !isEmptyCell(cell)).length)
    const proposedHeaderRow = widths.indexOf(dominantWidth(widths)) + 1
    const explicit = config.headerRow ?? null
    const headerRow = clampRow(Number.isFinite(explicit) ? explicit : proposedHeaderRow, rows.length)

    const headerCells = rows[headerRow - 1] ?? []
    const width = headerCells.length

    // A header cell is canonicalized exactly like a value, and for the same
    // reason. `String(aDate)` yields a local-zone sentence — measured,
    // `Fri Aug 01 2025 02:00:00 GMT+0200 (Mitteleuropäische Sommerzeit)` — which
    // differs per machine and per CI timezone. A monthly report with dates
    // across its header row is an ordinary shape, and since annotations and
    // chosen types are carried across a re-read *by name*, a column name that
    // moves with the clock silently breaks that carry-over.
    const names = headerCells.map((cell) => canonical(cell, null))

    // Structural trouble in a header is reported, never absorbed. A blank cell
    // yields a column with no name and a repeated one yields two columns a
    // person cannot tell apart — the store addresses both by position, so
    // nothing is lost, but nothing says so either unless it is said here.
    const blank = names.map((name, at) => (name.trim() === '' ? at + 1 : 0)).filter(Boolean)
    if (blank.length > 0) {
      diagnostics.push(warning('xlsx.blank_header', { columns: Object.freeze(blank) }))
    }
    const seen = new Map()
    for (const name of names) if (name !== '') seen.set(name, (seen.get(name) ?? 0) + 1)
    const repeated = [...seen].filter(([, n]) => n > 1).map(([name]) => name)
    if (repeated.length > 0) {
      diagnostics.push(warning('xlsx.duplicate_header', { columns: Object.freeze(repeated) }))
    }

    // Rows before the header are preamble — not data, not damage: the header
    // decision, proposed or corrected, declares them out of scope.
    const raw = names.map(() => [])
    for (let r = headerRow; r < rows.length; r += 1) {
      for (let c = 0; c < width; c += 1) raw[c].push(rows[r][c] ?? null)
    }

    const columns = names.map((name, at) => {
      const values = raw[at]
      const kinds = new Set()
      for (const value of values) {
        const kind = kindOf(value)
        if (kind !== null) kinds.add(kind)
      }

      // Nothing typed in it — a column of strings and blanks. That is the normal
      // office case for German numbers stored as text, so it gets the full
      // locale detection story 3 exists for, not a declaration.
      let type = null
      if (kinds.size === 1) {
        const [only] = kinds
        // Excel's one date type splits here: a column whose every value sits at
        // UTC midnight is a date; one value carrying a time makes it a datetime,
        // and a datetime column loses nothing by holding midnights.
        type =
          only === DATE
            ? values.every((v) => !isDate(v) || isUtcMidnight(v))
              ? DATE
              : DATETIME
            : only
      } else if (kinds.size > 1) {
        // Numbers and dates in one column. There is no declaration that is true
        // of all of it, and picking the majority would type the minority into
        // nothing.
        diagnostics.push(
          warning('xlsx.mixed_types', {
            column: name,
            kinds: Object.freeze([...kinds].sort()),
          }),
        )
      }

      return Object.freeze({
        name,
        domain: type === null ? TEXT : nativeDomain(type),
        cells: Object.freeze(values.map((value) => canonical(value, type))),
      })
    })

    // Frozen where produced (AD-6): these land in the registry and must not be
    // mutable by anything downstream. A sheet has no ragged rows to report —
    // the library pads them — so the damage report is empty by construction.
    return Object.freeze({
      table: Object.freeze({
        columns: Object.freeze(columns),
        // The rows below the header, counted from the sheet rather than from
        // column zero. A sheet whose header row is entirely blank has no
        // columns and still has a height, and a card that reported 0 rows over
        // it would be describing the header decision, not the file.
        rowCount: Math.max(rows.length - headerRow, 0),
      }),
      proposal: proposalFor(headerRow),
      damage: Object.freeze({ mismatches: Object.freeze([]), unclosedQuoteRow: null }),
      diagnostics: Object.freeze(diagnostics),
    })
  },
}
