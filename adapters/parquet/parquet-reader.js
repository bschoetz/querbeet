// The Parquet SourceReader, on hyparquet 1.27.1 — the library name appears here
// and in app/, nowhere else (AD-1, AD-2).
//
// Pure JavaScript, no WebAssembly, nothing fetched: the alternative class
// (`parquet-wasm`, DuckDB-WASM) fails AD-17 and AD-18 outright on a multi-MB
// payload loaded at runtime. Only the package index is imported, so the
// `fetch`-bearing URL helpers (`asyncBufferFromUrl`, `byteLengthFromUrl`)
// tree-shake out and the single-file gate stays green.
//
// FOUR THINGS ABOUT THE LIBRARY THAT DECIDED THE CODE BELOW.
//
//   `parquetRead` with `rowFormat: 'array'`, not `parquetReadObjects`. Object
//   rows are keyed by column name, so two columns of one name would occupy one
//   key and the second would be lost — the same care the CSV reader already
//   takes over a repeated header.
//
//   A partial `parsers` option replaces all defaults rather than merging, which
//   crashes inside `stringFromBytes`. None is passed. What the defaults deliver,
//   measured: INT64 → `BigInt`, DOUBLE/FLOAT/INT32 → `number`, UTF8 → `string`,
//   TIMESTAMP_MILLIS → `Date` with the instant preserved, DATE → `Date` at UTC
//   midnight, BOOLEAN → `boolean`, null → `null`.
//
//   **A DECIMAL arrives already multiplied, in floating point.** hyparquet
//   computes `parseDecimal(bytes) * 10 ** -scale`, and measured, an unscaled
//   `123456789` at scale 2 comes back as `1234567.8900000001`. Written out as it
//   arrives, that is a wrong amount on the screen that the canonical sweep
//   *accepts* — the shortest round-trip form of a corrupted double is still a
//   round-trip form. The schema declares the scale, so `decimalText` recovers
//   the exact figure from it; that is arithmetic against a declared scale, not
//   a guess about a value.
//
//   **Compression comes from `hyparquet-compressors`, and its snappy is WASM.**
//   The WASM is base64-inlined in `hysnappy` and instantiated with `atob` plus
//   `new WebAssembly.Module` — no fetch, no second file, which is why the AD-18
//   gate survives it, and why this is not the multi-MB runtime-fetched payload
//   the spine rejected `parquet-wasm` and DuckDB-WASM over. It carries one
//   measured hazard instead: Chrome refuses a synchronous `new
//   WebAssembly.Module` above 4,096 bytes on the main thread, and the module is
//   3,458. `scripts/assert-single-file.mjs` asserts that margin on every build.
//
//   **Two converted types take the whole file down.** `INTERVAL` and `BSON`
//   throw inside hyparquet's own row conversion, so one column of either would
//   cost the entire Source — against this file's own rule that an unrecognised
//   column degrades to `text`. They are identified from the schema and left out
//   of the read.
//
// The type map is closed on the reading side too. Parquet carries TIME, UUID and
// more besides, and a column this map does not recognise becomes `text` with a
// warning naming the column and the Parquet type, rather than a `native:<word>`
// nothing downstream knows.

import { parquetMetadata, parquetRead } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { BOOLEAN, DATE, DATETIME, NUMBER, TEXT, nativeDomain } from '@core/types/catalog.js'
import { warning } from '@core/diagnostics/diagnostic.js'

/** hyparquet wants an ArrayBuffer; the registry may hold a view. */
function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** A read that cannot start, told apart from a corrupt file. The store turns a
 *  thrown `code` into that diagnostic instead of the generic one, so the card
 *  says what is actually wrong rather than offering three wrong guesses. */
function unreadable(code, values) {
  const failure = new Error(code)
  failure.code = code
  failure.values = Object.freeze(values)
  return failure
}

/**
 * What this build can decompress: everything `hyparquet-compressors` supplies,
 * plus the uncompressed case that needs nobody.
 *
 * Derived from the map rather than written out, so a codec the package gains or
 * loses cannot leave this list behind. Bare `hyparquet` ships UNCOMPRESSED and
 * SNAPPY only, which made a gzip Parquet — an ordinary default in the Spark,
 * pandas and DuckDB ecosystems — unreadable; the dependency was put to the
 * project owner as an Ask First and approved on 2026-08-02.
 *
 * **`parquet.unsupported_codec` is not dead code.** It used to be the wrong
 * answer for ZSTD and gzip; it is now the right answer for LZO and for whatever
 * the format adds next — the codec set is open-ended and this is what keeps a
 * file querbeet cannot read from being called corrupt.
 */
const SUPPORTED_CODECS = new Set(['UNCOMPRESSED', ...Object.keys(compressors)])

/** The converted types hyparquet refuses in its own `convert.js`. Reading a file
 *  containing one throws, so these columns are left out of the read entirely. */
const UNREADABLE_CONVERTED = new Set(['INTERVAL', 'BSON'])

const DATE_CONVERTED = new Set(['DATE'])
const DATETIME_CONVERTED = new Set(['TIMESTAMP_MILLIS', 'TIMESTAMP_MICROS'])
const NUMBER_CONVERTED = new Set([
  'DECIMAL',
  'INT_8',
  'INT_16',
  'INT_32',
  'INT_64',
  'UINT_8',
  'UINT_16',
  'UINT_32',
  'UINT_64',
])
const TEXT_CONVERTED = new Set(['UTF8', 'ENUM'])
const NUMERIC_PHYSICAL = new Set(['INT32', 'INT64', 'FLOAT', 'DOUBLE'])
const BINARY_PHYSICAL = new Set(['BYTE_ARRAY', 'FIXED_LEN_BYTE_ARRAY'])

const isDecimal = (element) =>
  element.converted_type === 'DECIMAL' || element.logical_type?.type === 'DECIMAL'

/** Sub-millisecond timestamp units. A `Date` holds milliseconds, so anything
 *  finer is already gone by the time the value reaches this adapter — named
 *  here rather than dropped in silence (AD-21; story 4a owns the
 *  representation). */
function timestampUnit(element) {
  if (element.converted_type === 'TIMESTAMP_MICROS') return 'MICROS'
  const unit = element.logical_type?.type === 'TIMESTAMP' ? element.logical_type.unit : undefined
  if (unit === undefined || unit === null) return null
  const name = typeof unit === 'string' ? unit : Object.keys(unit)[0]
  return /micro/i.test(name) ? 'MICROS' : /nano/i.test(name) ? 'NANOS' : null
}

/**
 * What a leaf column reads as, from its schema alone.
 *
 * Returns the type, or `null` when the map does not recognise the column — a
 * TIME, a UUID, a JSON blob, a raw byte array. `null` is not a failure: it is a
 * `text` column and a warning, which is the honest answer for a value story 6
 * has no conversion for.
 */
function typeOfLeaf(element) {
  const converted = element.converted_type
  const logical = element.logical_type?.type
  const physical = element.type

  if (physical === 'BOOLEAN') return BOOLEAN
  if (physical === 'INT96') return DATETIME // the legacy nanosecond timestamp
  if (DATE_CONVERTED.has(converted) || logical === 'DATE') return DATE
  if (DATETIME_CONVERTED.has(converted) || logical === 'TIMESTAMP') return DATETIME
  if (isDecimal(element)) return NUMBER
  if (TEXT_CONVERTED.has(converted) || logical === 'STRING' || logical === 'ENUM') return TEXT
  if (NUMERIC_PHYSICAL.has(physical) && (converted === undefined || NUMBER_CONVERTED.has(converted))) {
    return NUMBER
  }
  if (BINARY_PHYSICAL.has(physical) && converted === undefined && logical === undefined) {
    // A byte array with nothing declared about it. hyparquet decodes it as a
    // string, which is the only readable thing to do with it, but it is not a
    // declared string and the column says so.
    return null
  }
  return null
}

/** How a column names the shape it refused, so a warning can be specific. */
const describe = (element) =>
  element.logical_type?.type ?? element.converted_type ?? element.type ?? 'GROUP'

/** Compact JSON for a value hyparquet returns as a structure — a LIST, a MAP, a
 *  STRUCT, a JSON blob. Flattening these into columns is story 17's vocabulary;
 *  what this owes them is a cell that keeps every byte of what was there. */
const compactJson = (value) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v,
  ) ?? ''

/** Trailing fractional zeros are not part of a shortest round-trip decimal, and
 *  a cell carrying them would be counted unparsed under its own type. */
const trimDecimal = (text) =>
  text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text

/**
 * The exact figure behind a DECIMAL, recovered from the declared scale.
 *
 * hyparquet hands over `unscaled * 10 ** -scale` as a double, which is not the
 * figure the file holds: measured, `123456789` at scale 2 arrives as
 * `1234567.8900000001`. Multiplying back by the *declared* scale and rounding
 * recovers the unscaled integer exactly whenever that integer is representable,
 * which is arithmetic against the schema rather than a guess about the value.
 *
 * Where the unscaled integer is past `Number.MAX_SAFE_INTEGER` it cannot be
 * recovered — those digits were lost before this adapter saw the value. The cell
 * then carries the double's own exact expansion: the whole truth about what
 * arrived, nothing invented, and a form that fails the canonical round trip and
 * is therefore counted unparsed, the same discipline as an oversized INT64. The
 * column is warned about as well, because a value that happens to survive the
 * round trip must not make the loss look like a clean read.
 */
function decimalText(value, scale) {
  const unscaled = scale <= 15 ? Math.round(value * 10 ** scale) : NaN
  if (!Number.isSafeInteger(unscaled)) {
    // 20 fractional digits is exact here: a double this large has an ulp far
    // above 1e-20, so nothing is rounded away and nothing is added.
    return { text: trimDecimal(value.toFixed(20)), exact: false }
  }
  const digits = String(Math.abs(unscaled)).padStart(scale + 1, '0')
  const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
  return { text: (unscaled < 0 ? '-' : '') + trimDecimal(body), exact: true }
}

/** ISO 8601, or `''` for a `Date` outside the range JS can express. One cell the
 *  platform cannot render must not cost the whole file: `toISOString` throws a
 *  `RangeError`, and an empty cell is an absence the sweep already counts. */
function isoText(value, dayOnly) {
  try {
    const iso = value.toISOString()
    return dayOnly ? iso.slice(0, 10) : iso
  } catch {
    return ''
  }
}

/** @type {import('@ports/index.js').SourceReader} */
export const parquetReader = {
  media: 'binary',

  /**
   * @param {ArrayBuffer} bytes  the retained bytes (AD-7)
   * @returns {Promise<object>} the reader result. A bad magic number, a
   *   truncated footer or a codec hyparquet cannot decompress throws, and the
   *   store turns that into a diagnostic with no Source and no damage to the
   *   ones already loaded.
   */
  async read(bytes) {
    const buffer = toArrayBuffer(bytes)
    const metadata = parquetMetadata(buffer)
    const diagnostics = []

    // Before any page is touched: a codec hyparquet cannot decompress fails deep
    // inside the read, where the only thing left to say is "corrupt".
    for (const group of metadata.row_groups ?? []) {
      for (const column of group.columns ?? []) {
        const codec = column.meta_data?.codec
        if (codec && !SUPPORTED_CODECS.has(codec)) {
          throw unreadable('parquet.unsupported_codec', { codec })
        }
      }
    }

    // The flat schema is a preorder walk: element 0 is the root, and each
    // element carrying `num_children` owns that many of the elements after it.
    // Only the root's direct children are columns; anything below one of them is
    // a nested structure the row assembler hands back as an object.
    const [root, ...elements] = metadata.schema
    let at = 0
    const takeSubtree = () => {
      const element = elements[at]
      at += 1
      for (let i = 0; i < (element?.num_children ?? 0); i += 1) takeSubtree()
      return element
    }
    const topLevel = []
    for (let i = 0; i < (root.num_children ?? 0) && at < elements.length; i += 1) {
      topLevel.push(takeSubtree())
    }

    const columnPlan = topLevel.map((element) => {
      // A group is a LIST, a MAP or a STRUCT. It arrives as a structure and
      // leaves as compact JSON; splitting it into columns is story 17's job.
      if (element.num_children) {
        diagnostics.push(warning('parquet.nested_column', { column: element.name }))
        return { element, type: null, readable: true, scale: 0, decimal: false }
      }
      if (UNREADABLE_CONVERTED.has(element.converted_type)) {
        // hyparquet throws on these during the row read, so the column is left
        // out of it. One column must not cost the whole file.
        diagnostics.push(
          warning('parquet.unreadable_column', { column: element.name, type: describe(element) }),
        )
        return { element, type: null, readable: false, scale: 0, decimal: false }
      }

      const type = typeOfLeaf(element)
      if (type === null) {
        diagnostics.push(
          warning('parquet.unsupported_type', { column: element.name, type: describe(element) }),
        )
      }
      const unit = type === DATETIME ? timestampUnit(element) : null
      if (unit !== null) {
        diagnostics.push(warning('parquet.timestamp_precision', { column: element.name, unit }))
      }
      return {
        element,
        type: type === TEXT ? null : type,
        readable: true,
        scale: element.scale ?? 0,
        decimal: isDecimal(element),
      }
    })

    /** @type {Array<Array<unknown>>} one array per column, in schema order */
    const raw = columnPlan.map(() => [])

    // Only the columns hyparquet can decode are requested. Subsetting is by
    // name, so it is skipped where names repeat — there the whole read is the
    // only correct request, and a repeated name alongside an INTERVAL is a file
    // nobody has produced yet.
    const wanted = columnPlan.filter((plan) => plan.readable)
    const names = columnPlan.map((plan) => plan.element.name)
    const subset = wanted.length < columnPlan.length && new Set(names).size === names.length

    if (wanted.length > 0) {
      const slots = subset
        ? wanted.map((plan) => columnPlan.indexOf(plan))
        : columnPlan.map((_, index) => index)
      await parquetRead({
        file: buffer,
        rowFormat: 'array',
        // Without this, hyparquet falls back to its own two built-in codecs and
        // throws on the rest deep inside the page read.
        compressors,
        ...(subset ? { columns: wanted.map((plan) => plan.element.name) } : {}),
        onComplete(rows) {
          for (const row of rows) {
            for (let c = 0; c < slots.length; c += 1) raw[slots[c]].push(row[c] ?? null)
          }
        },
      })
    }

    // The file's own row count, not column zero's. A schema with no columns at
    // all still has a height, and a Source that under-reports it is a Source
    // whose card lies about how much was loaded.
    const rowCount = Number(metadata.num_rows ?? 0)

    const columns = columnPlan.map((plan, index) => {
      const { element, type, scale } = plan
      let inexactDecimals = 0
      let nonFinite = 0
      const cells = []

      // A column left out of the read has no values to canonicalize; every row
      // still gets a cell, so the table stays rectangular.
      const values = plan.readable ? raw[index] : new Array(rowCount).fill(null)

      for (const value of values) {
        if (value === null || value === undefined) {
          cells.push('')
        } else if (typeof value === 'string') {
          cells.push(value)
        } else if (typeof value === 'bigint') {
          cells.push(value.toString())
        } else if (typeof value === 'number') {
          if (!Number.isFinite(value)) {
            nonFinite += 1
            cells.push(String(value))
          } else if (plan.decimal) {
            const { text, exact } = decimalText(value, scale)
            if (!exact) inexactDecimals += 1
            cells.push(text)
          } else {
            cells.push(String(value))
          }
        } else if (typeof value === 'boolean') {
          cells.push(value ? 'true' : 'false')
        } else if (value instanceof Date) {
          cells.push(isoText(value, type === DATE))
        } else {
          cells.push(compactJson(value))
        }
      }

      if (inexactDecimals > 0) {
        diagnostics.push(
          warning('parquet.decimal_precision', { column: element.name, values: inexactDecimals }),
        )
      }
      if (nonFinite > 0) {
        diagnostics.push(
          warning('parquet.non_finite_number', { column: element.name, values: nonFinite }),
        )
      }

      return Object.freeze({
        name: String(element.name),
        domain: type === null ? TEXT : nativeDomain(type),
        cells: Object.freeze(cells),
      })
    })

    // Frozen where produced (AD-6). A Parquet file has no ragged rows to report:
    // the schema fixes the column set for every row group in it. A schema with
    // no rows under it still yields its columns, and is confirmable.
    return Object.freeze({
      table: Object.freeze({ columns: Object.freeze(columns), rowCount }),
      proposal: Object.freeze({}),
      damage: Object.freeze({ mismatches: Object.freeze([]), unclosedQuoteRow: null }),
      diagnostics: Object.freeze(diagnostics),
    })
  },
}
