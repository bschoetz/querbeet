// The CSV SourceReader, on PapaParse 5.5.4 — the library name appears here and
// in app/, nowhere else (AD-1, AD-2).
//
// Two settings are permanent, not defaults:
//
//   header: false — Papa emits its FieldMismatch errors only in header mode, so
//   the field-count check below is own code (R3). The raw grid is also what
//   AD-7's registry wants: values as delivered, header a *proposal* over them.
//
//   dynamicTyping: false — typing is Step zero (Story 3). Every cell leaves this
//   file as text and every column declares domain 'text' (AD-20).
//
// Damage is reported by *file line number* and kept raw (CAP-39): a row whose
// field count deviates, and the row whose quote never closes, are excluded from
// the table and surface in `damage.mismatches` with their raw text — never
// padded or guessed into alignment, because a plausible table built from a
// damaged file is the C-10 failure this product exists to avoid. A quote defect
// Papa can still parse through (a stray trailing quote) keeps its row in the
// table but is named in a diagnostic — silent recovery is the same C-10
// failure wearing a smaller hat.

import Papa from 'papaparse'
import { error, unresolved, warning } from '@core/diagnostics/diagnostic.js'

/** Most frequent field count; ties go to the wider row, since preamble junk is
 *  typically narrower than the data it precedes. */
function dominantFieldCount(counts) {
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

const countLineBreaks = (s) => (s.match(/\r\n|\r|\n/g) ?? []).length

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Own guess, not Papa's, for two measured reasons. Papa's guesser hardcodes a
// ten-line preview (the config's `preview` never reaches it), so a realistic
// report preamble starves it. And it qualifies a candidate by *average* field
// count > 1.99, so a single damaged one-field row in an otherwise two-column
// file — (2n+1)/(n+1) < 2 for every n — makes a plain comma file read as
// undetectable. Median over a 50-line window survives both: a preamble or a
// damaged minority of rows cannot drag the median below the data's field count.
const GUESS_CANDIDATES = [',', ';', '\t', '|']
const GUESS_WINDOW = 50

function guessDelimiter(text) {
  let best = null
  let bestDelta
  let bestMedian
  for (const candidate of GUESS_CANDIDATES) {
    const preview = Papa.parse(text, {
      header: false,
      dynamicTyping: false,
      skipEmptyLines: true,
      preview: GUESS_WINDOW,
      delimiter: candidate,
    })
    const counts = preview.data.map((r) => r.length)
    if (counts.length === 0) continue

    // A median below two means the candidate splits fewer than half the rows —
    // it is not this file's delimiter, whatever the exceptions are.
    const mid = median(counts)
    if (mid < 2) continue

    let delta = 0
    for (let i = 1; i < counts.length; i += 1) delta += Math.abs(counts[i] - counts[i - 1])

    if (best === null || delta < bestDelta || (delta === bestDelta && mid > bestMedian)) {
      best = candidate
      bestDelta = delta
      bestMedian = mid
    }
  }
  return best // null = undetectable, an explicit question for a person
}

/** @type {import('@ports/index.js').SourceReader} */
export const csvReader = {
  media: 'text',

  /**
   * @param {string} text  decoded by core/types from the retained bytes (AD-7)
   * @param {{ delimiter?: string | null, headerRow?: number | null }} [config]
   *   `null` = propose; explicit values are user corrections and survive re-reads.
   */
  read(text, config = {}) {
    // `''` is not an explicit delimiter — Papa would read it as "please guess",
    // which must never happen silently. Empty means propose, exactly like null.
    const explicitDelimiter = config.delimiter ? config.delimiter : null
    const explicitHeaderRow = config.headerRow ?? null
    const diagnostics = []

    // An empty file is its own finding, not an undetectable-delimiter question —
    // there is nothing a delimiter choice could change about no content.
    if (text.trim() === '') {
      return Object.freeze({
        table: Object.freeze({ columns: Object.freeze([]), rowCount: 0 }),
        proposal: Object.freeze({ delimiter: explicitDelimiter ?? ',', headerRow: 1 }),
        damage: Object.freeze({ mismatches: Object.freeze([]), unclosedQuoteRow: null }),
        diagnostics: Object.freeze([warning('csv.empty', {})]),
      })
    }

    // Delimiter first, in a preview pass of its own (see guessDelimiter above
    // for why it is own code). The main parse below runs with skipEmptyLines:
    // false so damage rows carry file-true numbers; the guess skips empty
    // lines so the trailing-newline artefact cannot poison it.
    let delimiter = explicitDelimiter
    if (delimiter === null) {
      delimiter = guessDelimiter(text)
      if (delimiter === null) {
        // An explicit question, not a silent guess: the file is parsed with the
        // fallback so it stays inspectable, and the question awaits a person.
        delimiter = ','
        diagnostics.push(unresolved('csv.delimiter_undetectable', { fallback: ',' }))
      }
    }

    const rows = []
    const raws = []
    const fileLines = [] // fileLines[i] — the file line record i starts on (1-based)
    const stepErrors = []
    let sliceFrom = 0
    let line = 1

    // Step mode for one reason: `meta.cursor` after each row lets the raw text
    // of a damaged row be sliced out of the input exactly as it was written,
    // quoted newlines included — a re-join of parsed fields would be a
    // reconstruction, not the raw row. The same slices carry the line count: a
    // legitimately quoted newline makes record indices diverge from the lines a
    // user sees in a text editor, and `Zeile N` must mean the editor's N.
    Papa.parse(text, {
      header: false,
      dynamicTyping: false,
      skipEmptyLines: false,
      delimiter,
      step(results) {
        const row = Array.isArray(results.data[0]) ? results.data[0] : results.data
        const rawSlice = text.slice(sliceFrom, results.meta.cursor)
        rows.push(row)
        raws.push(rawSlice.replace(/\r\n$|\r$|\n$/, ''))
        fileLines.push(line)
        line += countLineBreaks(rawSlice)
        sliceFrom = results.meta.cursor
        for (const err of results.errors) stepErrors.push({ ...err, atRecord: rows.length })
      },
    })

    // A trailing newline yields a final single-empty-field row — an artefact of
    // the format, not a data row.
    const last = rows[rows.length - 1]
    if (last && last.length === 1 && last[0] === '') {
      rows.pop()
      raws.pop()
      fileLines.pop()
    }

    const quote = stepErrors.find((e) => e.code === 'MissingQuotes')
    const quoteRecord = quote ? quote.atRecord : null // 1-based record index
    const unclosedQuoteRow = quoteRecord === null ? null : (fileLines[quoteRecord - 1] ?? null)
    if (unclosedQuoteRow !== null) {
      // The remainder of the file was swallowed into one field. Using that
      // value is the C-10 failure, so this is that defect by name — an error,
      // not a generic parse failure.
      diagnostics.push(error('csv.unclosed_quote', { row: unclosedQuoteRow }))
    }

    // Every other structural complaint Papa can parse through — a stray
    // trailing quote, most prominently — leaves its row in the table (the
    // parse is defined) but must be visible: an invisible recovery is a
    // silently changed value (C-10).
    const malformedRows = [
      ...new Set(
        stepErrors
          .filter((e) => e.code !== 'MissingQuotes' && e.code !== 'UndetectableDelimiter')
          .filter((e) => e.atRecord !== quoteRecord)
          .map((e) => fileLines[e.atRecord - 1])
          .filter((n) => n !== undefined),
      ),
    ].sort((a, b) => a - b)
    if (malformedRows.length > 0) {
      diagnostics.push(warning('csv.malformed_quote', { rows: Object.freeze(malformedRows) }))
    }

    const counts = rows.map((r) => r.length)
    const proposedHeaderRow = counts.indexOf(dominantFieldCount(counts)) + 1
    const headerRow = clampRow(
      Number.isFinite(explicitHeaderRow) ? explicitHeaderRow : proposedHeaderRow,
      rows.length,
    )

    const headerCells = rows[headerRow - 1] ?? []
    const expected = headerCells.length
    const columns = headerCells.map((name) => ({ name: String(name), domain: 'text', cells: [] }))

    // Rows before the header are preamble — not data, not damage: the header
    // decision (proposed or corrected) declares them out of scope. The one
    // exception is the unclosed-quote record, handled after the loop.
    const mismatches = []
    const mismatchRows = []
    let quoteRecorded = false
    for (let i = headerRow; i < rows.length; i += 1) {
      const rowNumber = fileLines[i]
      const row = rows[i]

      if (quoteRecord !== null && i === quoteRecord - 1) {
        // Excluded even when the swallowed remainder happens to land on the
        // expected field count — its cells are not what the file said.
        mismatches.push({ row: rowNumber, fields: row.length, raw: raws[i] })
        quoteRecorded = true
        continue
      }
      if (row.length !== expected) {
        mismatches.push({ row: rowNumber, fields: row.length, raw: raws[i] })
        mismatchRows.push(rowNumber)
        continue
      }
      for (let c = 0; c < expected; c += 1) columns[c].cells.push(row[c])
    }

    // The unclosed-quote record can sit at or before the header row, where the
    // loop above never visits it. Its raw text is promised inspectable
    // wherever it sits, so it lands in the damage report regardless.
    if (quoteRecord !== null && !quoteRecorded && rows[quoteRecord - 1] !== undefined) {
      mismatches.push({
        row: fileLines[quoteRecord - 1],
        fields: rows[quoteRecord - 1].length,
        raw: raws[quoteRecord - 1],
      })
      mismatches.sort((a, b) => a.row - b.row)
    }

    if (mismatchRows.length > 0) {
      diagnostics.push(
        warning('csv.field_count_mismatch', {
          expected,
          rows: Object.freeze(mismatchRows),
          count: mismatchRows.length,
        }),
      )
    }

    // Frozen where produced (AD-6): these structures land in the registry and
    // must not be mutable by anything downstream.
    return Object.freeze({
      table: Object.freeze({
        columns: Object.freeze(
          columns.map((c) => Object.freeze({ ...c, cells: Object.freeze(c.cells) })),
        ),
        rowCount: columns.length > 0 ? columns[0].cells.length : 0,
      }),
      proposal: Object.freeze({ delimiter, headerRow }),
      damage: Object.freeze({
        mismatches: Object.freeze(mismatches.map((m) => Object.freeze(m))),
        unclosedQuoteRow,
      }),
      diagnostics: Object.freeze(diagnostics),
    })
  },
}
