// Step zero's second half (CAP-9, AD-7): the confirmed types applied.
//
// `core/types/typing.js` decides what a column *is* and counts what would parse,
// and it converts nothing — the raw text has to survive for the preview and the
// damage report to keep reading it. This file is where a confirmed Source
// becomes a typed engine Table, and AD-7 says where that Table lives: "the
// Recipe's per-column type record is applied by the engine as Step zero of every
// Source and caches like any other Step". The registry keeps bytes and raw text
// and is untouched; the converted Table is Step zero's *output*, held in the
// cache below, outside the registry and outside reactivity (AD-6).
//
// FOUR RULES SHAPE THE FILE, and each of them is a defect it exists to prevent.
//
//   1. EVERY VALUE IS READ EXACTLY AS DETECTION COUNTED IT. Not "the same way" —
//      the same functions, through `partsFor`, which binds the column's affix and
//      its accounting permission the way `scoreColumn` binds them and dispatches
//      a native column to its canonical reader (AD-20). A second parser here
//      would be a second opinion about what `(1.234,56)` means, and the first
//      thing it would get wrong is the sign. What the discipline buys is
//      checkable rather than asserted: **per column, the converted unparsed count
//      equals `typing.counts.unparsed`**, and that equality is a test.
//
//   2. DISPATCH IS ON THE CONFIRMED TYPE, NEVER ON THE FORMAT. `time` and
//      `duration` carry `format: null` by construction — `candidatesFor` returns
//      an empty list for both — and they are the two types AD-21 gives distinct
//      units. A format-dispatched converter would crash on them first.
//
//   3. A DATETIME IS ONE VALUE, never a date plus separate clock arithmetic.
//      End-of-day `24:00` is the *next calendar day's* midnight, so
//      `31.12.2025 24:00` is 1 January 2026 — a different year, which is what
//      adding the clock to a finished date silently gets wrong. `datetimeParts`
//      hands over the fields unfolded, offset included, and the arithmetic
//      happens once, here.
//
//   4. MISSING IS NEVER A BOX. A token the user declared missing becomes a null
//      cell; a box exists only for a value that fails its *confirmed type*. The
//      two are different states and a reader that collapsed them would report a
//      column of empty cells as unreadable.
//
// Nothing here knows what a box *is* (AD-22). A column is handed to the engine
// split — the values, plus the indices that did not read — and the adapter boxes
// exactly those positions. `core/` cannot construct a box and does not want to.

import { BOOLEAN, DATE, DATETIME, DURATION, NUMBER, TIME } from '../types/catalog.js'
import { partsFor } from '../types/typing.js'

const NANOS_PER_MILLI = 1_000_000n
const NANOS_PER_SECOND = 1_000_000_000n
const MILLIS_PER_MINUTE = 60_000

/**
 * UTC midnight of a calendar day, in epoch milliseconds.
 *
 * `Date.UTC` maps years 0–99 onto 1900–1999, which would make `29.02.0000` a
 * date in 1900 — and 1900 is not a leap year, so it would not even be that day.
 * The fast path covers every year this product can actually meet (four-digit
 * patterns from 0100, and `expandTwoDigitYear`'s fixed pivot yields 1930–2029);
 * the slow path sets year, month and day in one call so no intermediate value
 * can roll over between them.
 */
function utcMidnightMillis(year, month, day) {
  if (year >= 100 && year <= 9999) return Date.UTC(year, month - 1, day)
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

/** The clock as plain milliseconds since midnight. Added rather than passed to
 *  `Date.UTC`, so `hour: 24` rolls into the next calendar day by arithmetic —
 *  which is what ISO 8601 says end-of-day means. */
const clockMillis = (hour, minute, second) => ((hour * 60 + minute) * 60 + second) * 1000

/** A fractional second, as written, in nanoseconds. Nine digits is the
 *  representation's own resolution (AD-21), and `.5` and `.500000000` are the
 *  same quantity — so the digits are right-padded rather than parsed as a
 *  decimal, which is also what keeps this in integer range. */
const fractionNanos = (fraction) => (fraction === '' ? 0 : Number(fraction.padEnd(9, '0')))

/**
 * The number a reading found.
 *
 * Two shapes arrive, because two readers do. A locale reading answers `{ digits,
 * fraction, negative }` — the three that together *are* the value, so `12,5` and
 * `12` are different returns — and it is rebuilt through the JS number parser,
 * which is where the rounding named in the Boundaries happens: a fractional part
 * beyond float precision rounds to the nearest double, and the ledger entry about
 * that asymmetry stays open as the owner's scope question. A canonical reading
 * (AD-20) answers `{ value }` outright, because a canonical number may be written
 * exponentially and has no digit string to hand back.
 */
const numberOf = (parts) =>
  parts.value !== undefined
    ? parts.value
    : Number(
        `${parts.negative ? '-' : ''}${parts.digits}${parts.fraction === '' ? '' : `.${parts.fraction}`}`,
      )

/** AD-21 — one unit for all four temporal types, and it is nanoseconds as a
 *  `BigInt`. A split rule would make a date-against-datetime join a unit
 *  conversion, which is the class of error the decision exists to prevent. */
const CELL = Object.freeze({
  [NUMBER]: numberOf,
  [DATE]: ({ year, month, day }) => BigInt(utcMidnightMillis(year, month, day)) * NANOS_PER_MILLI,
  [DATETIME]: ({ year, month, day, hour, minute, second, fraction, offsetMinutes }) =>
    BigInt(
      utcMidnightMillis(year, month, day) +
        clockMillis(hour, minute, second) -
        offsetMinutes * MILLIS_PER_MINUTE,
    ) *
      NANOS_PER_MILLI +
    BigInt(fractionNanos(fraction)),
  [TIME]: ({ hour, minute, second }) =>
    BigInt(hour * 3600 + minute * 60 + second) * NANOS_PER_SECOND,
  [DURATION]: ({ hours, minutes, seconds }) =>
    BigInt(hours * 3600 + minutes * 60 + seconds) * NANOS_PER_SECOND,
  [BOOLEAN]: (parts) => parts.value,
})

/**
 * One column, converted: `{ values, unparsed }`.
 *
 * `values` holds the typed value at every index that read, `null` at every
 * missing one, and — at exactly the indices in `unparsed` — the cell's **original
 * text**, which is what the adapter boxes (AD-22). The array is handed over to
 * the engine and must not be reused afterwards.
 *
 * The missing test runs against the trimmed cell because `sift` trims, and the
 * two have to draw the line in the same place or the count the user confirmed
 * stops describing the conversion. What is *preserved* is untrimmed, because
 * "the original text" means the text that was there.
 */
function convertColumn(cells, column) {
  const read = partsFor(cells, column)
  const toCell = read === null ? null : CELL[column.type]
  const missing = new Set(column.missingTokens)

  const values = new Array(cells.length)
  const unparsed = []

  for (let i = 0; i < cells.length; i += 1) {
    const raw = typeof cells[i] === 'string' ? cells[i] : String(cells[i] ?? '')
    if (missing.has(raw.trim())) {
      values[i] = null
      continue
    }
    // A `text` column has no reading: every cell is already its own value, and
    // nothing about it can fail to parse.
    if (read === null) {
      values[i] = raw
      continue
    }
    const parts = read(raw.trim())
    if (parts === null) {
      values[i] = raw
      unparsed.push(i)
      continue
    }
    values[i] = toCell(parts)
  }

  return { values, unparsed: Object.freeze(unparsed) }
}

/**
 * Whether this Source can be converted at all, and the one reason it cannot.
 *
 * A Table is keyed by column name — the `Table` interface's own `column(name)`
 * says so (AD-5) — and a header may repeat a name: a CSV passes header cells
 * through verbatim, XLSX reports `xlsx.duplicate_header`, Parquet reports
 * `parquet.duplicate_column_name`. Two columns called `Datum` cannot both be in
 * one engine table, and marking the preview from a name-keyed `unparsed` would
 * mark the *wrong* cells rather than none — the first `Datum` wearing the
 * second's failures.
 *
 * So a Source with a repeated name is not converted, and the panel's count stays
 * a count for it. That is exactly the state before this story rather than a
 * regression, and it is a ledger entry rather than a silent branch.
 */
const repeatsAColumnName = (columns) => new Set(columns.map((c) => c.name)).size !== columns.length

/**
 * A confirmed Source as a typed engine Table — `{ table, unparsed }`, or `null`
 * where there is nothing to convert.
 *
 * `unparsed` maps column name → a frozen array of row indices, in row order.
 * That is the whole of what the UI needs to mark the preview, and it crosses as
 * plain data: a box is the adapter's and is never handed out (AD-22), so the map
 * is how anything outside the engine learns which cells failed.
 *
 * `null` means the entry is not convertible — its typing is unconfirmed (AD-29's
 * first gate: nothing is computed from unconfirmed types), or it repeats a column
 * name. Both are states of the data rather than caller bugs, so both are a return
 * value.
 *
 * @param {object} entry a frozen registry entry
 * @param {import('../../ports/index.js').TableEngine} engine
 */
export function convertSource(entry, engine) {
  if (entry?.typing?.confirmed !== true) return null
  const columns = entry.typing.columns
  if (repeatsAColumnName(columns)) return null

  const engineColumns = new Array(columns.length)
  const unparsed = Object.create(null)

  for (let c = 0; c < columns.length; c += 1) {
    const column = columns[c]
    const converted = convertColumn(entry.table.columns[c].cells, column)
    engineColumns[c] = {
      name: column.name,
      type: column.type,
      values: converted.values,
      unparsed: converted.unparsed,
    }
    unparsed[column.name] = converted.unparsed
  }

  return Object.freeze({
    table: engine.fromColumns(engineColumns),
    unparsed: Object.freeze(unparsed),
  })
}

/**
 * The Step-zero cache — one conversion per Source, keyed by the frozen entry
 * itself.
 *
 * AD-7: Step zero "caches like any other Step". What makes the key sound here is
 * that `commit` freezes every entry and mints a new one for every change, so
 * **entry identity is the invalidation rule** and nothing has to be told when a
 * type, a missing token or an encoding moved: a different object is a different
 * answer. A Source id alone would not do — CAP-2, CAP-3 and CAP-7 all re-parse
 * without changing the id, which is the same argument AD-8 makes for the general
 * cache.
 *
 * It is a plain `Map` in a closure, deliberately: the converted Table must not
 * enter `ref`, `reactive` or a `computed` return value (AD-6), and the only way
 * to be sure of that is for it never to be reachable from reactive state at all.
 * `ui/` holds at most a `shallowRef` to swap.
 *
 * Bounded by the number of loaded Sources rather than by rows: there is exactly
 * one entry per Source and it is replaced, never accumulated. An unconfirmed or
 * removed Source releases its conversion, which is what AD-29 asks for — a table
 * computed from types nobody vouches for must not survive the withdrawal.
 */
export function createStepZeroCache(engine) {
  /** @type {Map<string, { entry: object, conversion: object|null }>} */
  const cached = new Map()

  const release = (id) => {
    cached.delete(id)
  }

  return {
    /** The conversion of `entry`, computed once per frozen entry. */
    of(entry) {
      if (!entry) return null
      if (entry.typing?.confirmed !== true) {
        release(entry.id)
        return null
      }
      const hit = cached.get(entry.id)
      if (hit !== undefined && hit.entry === entry) return hit.conversion

      const conversion = convertSource(entry, engine)
      cached.set(entry.id, { entry, conversion })
      return conversion
    },
    /** Drop a Source's conversion — on removal, where no entry arrives again. */
    release,
    /** How many Sources are held. For a test; nothing in the product asks. */
    size: () => cached.size,
  }
}
