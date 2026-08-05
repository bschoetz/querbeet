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
import { keyOrNull, sourceKey, stepKey } from './cache-key.js'

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
  // A clock position and a quantity, and the difference is the arithmetic. A
  // `time` is bounded by its own reader — hours 00–23, so the whole sum is under
  // 86,400 and a `Number` holds it exactly — while a `duration`'s hours field is
  // an unbounded `\d+`. So the duration widens **first** and multiplies in
  // `BigInt`: `BigInt(hours * 3600)` would round the product before it widened,
  // which is the same defect one operation later.
  [TIME]: ({ hour, minute, second }) =>
    BigInt(hour * 3600 + minute * 60 + second) * NANOS_PER_SECOND,
  [DURATION]: ({ hours, minutes, seconds }) =>
    (hours * 3600n + BigInt(minutes * 60 + seconds)) * NANOS_PER_SECOND,
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
 * A confirmed Source as a typed engine Table — `{ table, unparsed }`, or `null`
 * where there is nothing to convert.
 *
 * `unparsed` maps column name → a frozen array of row indices, in row order.
 * That is the whole of what the UI needs to mark the preview, and it crosses as
 * plain data: a box is the adapter's and is never handed out (AD-22), so the map
 * is how anything outside the engine learns which cells failed.
 *
 * **`null` has exactly one meaning: the typing is not confirmed** (AD-29's first
 * gate — nothing is computed from types nobody vouches for). It had a second
 * until 2026-08-04: a Source repeating a column name could not be converted
 * either, and a caller receiving `null` could not tell the two apart, so the
 * gate could not name what was wrong without saying something false. That state
 * no longer exists — `core/exec/source-store.js` makes column names unique on
 * ingest and reports the mapping — and the adapter's duplicate-name throw is now
 * an invariant guard nothing reaches rather than a state the UI has to explain.
 *
 * @param {object} entry a frozen registry entry
 * @param {import('../../ports/index.js').TableEngine} engine
 */
export function convertSource(entry, engine) {
  if (entry?.typing?.confirmed !== true) return null
  const columns = entry.typing.columns

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
 * **What Step zero is, as a key** — `stepKey('typing', typing, [key(source)])`,
 * or `null` for an entry that cannot be keyed.
 *
 * AD-7 says the per-column type record "is applied by the engine as Step zero of
 * every Source and caches like any other Step", and that makes the shape
 * obvious: `key(source)` is the raw parse — bytes plus how they were read — and
 * Step zero is a Step over it whose config is the typing. So this is not a
 * second key scheme beside `core/exec/execute.js`'s; it is the same one, and the
 * key this returns is *the* key of the Source node in a run. There is exactly
 * one answer anywhere to "is this stale", which is what AD-8's *Prevents* clause
 * asks for — the clause is about two invalidation schemes disagreeing, not about
 * the number of `Map`s.
 *
 * **This replaced entry identity on 2026-08-04, and the interim is worth
 * remembering rather than deleting.** Until this story the key was the frozen
 * entry object itself, which worked only because `commit` mints a new entry for
 * every change — a different object is a different answer, and nothing had to be
 * told when a type or an encoding moved. It was sound and it was narrow: it
 * could not be lifted to Steps, because `freezeStep` also mints a new object on
 * every commit, so a rename would have evicted the whole graph. A content key
 * has neither limitation, and it is also what makes `{...entry}` — the same
 * Source, spread — a hit rather than a second conversion of the same values.
 *
 * **`null` where any of the four fields a key is made of is missing, and the
 * guard is symmetric on purpose.** A Source whose bytes nobody digested has
 * nothing that distinguishes it from another such Source, and inventing a key
 * for it would let two of them collide — not caching is a miss, a collision is a
 * wrong answer. The first version of this function checked `byteDigest` alone
 * and let a missing `encoding`, `parseConfig` or `typing` reach `canonical`,
 * which throws: the same bug wearing two faces, and the second face threw out of
 * `ui/SourcesPane.vue`'s template (review round 1). Every entry the store mints
 * carries all four.
 *
 * Wrapped in `keyOrNull` beyond that, for the case no field check can see: a
 * `typing` that is present and holds something the serializer refuses. That is
 * not hypothetical for long — `core/types/typing.js` owns the column record's
 * shape and story 14 restores one from a file.
 */
export function stepZeroKey(entry) {
  if (!entry) return null
  if (typeof entry.byteDigest !== 'string') return null
  if (!entry.parseConfig || !entry.encoding || !entry.typing) return null
  return keyOrNull(() => stepKey('typing', entry.typing, [sourceKey(entry)]))
}

/**
 * The Step-zero cache — one conversion per Source, keyed by what the Source *is*.
 *
 * It is a plain `Map` in a closure, deliberately: the converted Table must not
 * enter `ref`, `reactive` or a `computed` return value (AD-6), and the only way
 * to be sure of that is for it never to be reachable from reactive state at all.
 * `ui/` holds at most a `shallowRef` to swap.
 *
 * Bounded by the number of loaded Sources rather than by rows, which is tighter
 * than the run cache's row budget and matches this cache's lifecycle: there is
 * exactly one entry per Source and it is replaced, never accumulated. An
 * unconfirmed or removed Source releases its conversion, which is what AD-29
 * asks for — a table computed from types nobody vouches for must not survive the
 * withdrawal.
 */
export function createStepZeroCache(engine) {
  /** @type {Map<string, { key: string, conversion: object|null }>} */
  const cached = new Map()

  const release = (id) => {
    cached.delete(id)
  }

  return {
    /** The conversion of `entry`, computed once per distinct Source content. */
    of(entry) {
      if (!entry) return null
      // **The release on the way out, and who drives it now.** Until story 7b this
      // branch was reached for every contributing Source on every run, because
      // execution's gate 1 tested a Source's confirmation by asking for its table.
      // The gate asks a predicate instead now (it converts nothing, which is the
      // point), so what drives this release is `ui/SourcesPane.vue` rendering the
      // Source it withdrew, plus `ui/App.vue`'s explicit `release` on removal. A
      // pane that stops asking for marks would be the thing that breaks it.
      if (entry.typing?.confirmed !== true) {
        release(entry.id)
        return null
      }
      const key = stepZeroKey(entry)
      const hit = cached.get(entry.id)
      if (key !== null && hit !== undefined && hit.key === key) return hit.conversion

      const conversion = convertSource(entry, engine)
      // Held under the id and *checked* against the key: one slot per Source, so
      // a re-parse replaces its predecessor instead of retaining both — the same
      // bound this cache always had, with the identity test swapped for a
      // content test.
      //
      // **An unkeyable entry is returned unstored**, and the release before it is
      // deliberate. Storing it under `key: null` retains a converted Table that
      // no lookup can ever match — a table at design scale, held for the life of
      // the page, for a hit that cannot happen. The release covers the transition:
      // a Source that *was* keyable and stopped being one must not keep serving
      // its old conversion out of the slot nobody will overwrite.
      if (key === null) {
        release(entry.id)
        return conversion
      }
      cached.set(entry.id, { key, conversion })
      return conversion
    },
    /** Drop a Source's conversion — on removal, where no entry arrives again. */
    release,
    /** How many Sources are held. For a test; nothing in the product asks. */
    size: () => cached.size,
  }
}
