// How a typed cell is written for a German reader (AD-13, C-6).
//
// It exists because a typed Table holds **machine values** and a preview that
// interpolated them would be wrong in two visible ways and one invisible one. A
// temporal cell is nanoseconds as a `BigInt` (AD-21), so `{{ cell }}` renders
// `1767139200000000000` where a person expects `31.12.2025`. A number is a plain
// JavaScript number, so it renders `1234.56` in a German interface. And `null` —
// an absent value, which every report has — renders the word `null` where an
// empty cell belongs.
//
// **A boxed cell renders as its original text, unmarked, and that is a stated
// gap rather than an omission.** A value that did not parse under its confirmed
// type is held as a box carrying the file's own text (AD-22), and the engine
// materializes it as that text at the edge — so it *reads* correctly here and is
// indistinguishable from a text value. Marking it would need a positional
// channel, and none crosses the four-method `Table` after a filter has moved the
// rows. Story 10 owns CAP-31's marking and the gap is in the deferred-work
// ledger; what this module does not do is pretend otherwise.
//
// It is written to be story 10's seam: the Result table renders the same cells
// through the same projection, and a second formatter beside this one would be
// two answers to "what does 31 December look like".
//
// Nothing here parses. Every input is a value the engine produced under a type
// the schema names, so the type decides the branch and no value is inspected to
// guess what it might be. That is the same discipline `core/exec/convert.js`
// follows in the other direction.

/**
 * German grouping and decimal marks, with no rounding of its own.
 *
 * `maximumFractionDigits: 20` is the ceiling `Intl` allows and it is set
 * deliberately: the default is **three**, so `1234.5678` would render as
 * `1.234,568` — a rounded number presented as the value, which is the class of
 * quiet wrongness this whole product exists to remove. What a double cannot hold
 * is already lost before this module sees it, and is reported at typing time.
 */
const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 20 })

const NANOS_PER_MILLI = 1_000_000n
const NANOS_PER_SECOND = 1_000_000_000n
const NANOS_PER_MINUTE = 60n * NANOS_PER_SECOND
const NANOS_PER_HOUR = 60n * NANOS_PER_MINUTE

const pad = (n, width = 2) => String(n).padStart(width, '0')

/**
 * The calendar fields of an epoch-nanosecond instant, read in **UTC** — or
 * `null` for an instant no `Date` can hold.
 *
 * UTC because that is what the value is (AD-21: a date column holds UTC-midnight
 * epoch nanoseconds). A local-zone reader would render 31 December as 30
 * December for every reader west of Greenwich — the off-by-one-day class AD-21
 * exists to prevent, reintroduced at the last possible moment.
 *
 * The nanosecond remainder is taken with `BigInt` arithmetic before the value is
 * narrowed to a `Number`, so nothing is rounded on the way into `Date`.
 *
 * **`null` rather than `NaN.NaN.NaN`.** A `BigInt` is unbounded and a `Date` is
 * not — anything past ±8.64e15 ms is an Invalid Date, and every field read off
 * one is `NaN`. The representation can hold such a value (that is why it is a
 * `BigInt` at all), so the projection has to answer for it, and the answer is the
 * same one a boxed cell already gets: fall back to what the value literally is.
 */
function utcFields(nanos) {
  let millis = nanos / NANOS_PER_MILLI
  let sub = nanos - millis * NANOS_PER_MILLI
  // `BigInt` division truncates toward zero, so a pre-1970 instant with a
  // fractional millisecond would otherwise land one millisecond late.
  if (sub < 0n) {
    millis -= 1n
    sub += NANOS_PER_MILLI
  }
  const d = new Date(Number(millis))
  if (Number.isNaN(d.getTime())) return null
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    milli: d.getUTCMilliseconds(),
    nano: Number(sub),
  }
}

/** `31.12.2025` — the German date, in German field order. */
const dateText = (nanos) => {
  const f = utcFields(nanos)
  return f === null ? null : `${pad(f.day)}.${pad(f.month)}.${f.year}`
}

/**
 * `31.12.2025 14:30`, and `:ss` only where there is a second to show.
 *
 * Seconds are conditional rather than always printed because a report's
 * timestamps are overwhelmingly whole minutes, and a grid of `14:30:00` spends
 * three characters per cell saying nothing. Where a second or a fraction *is*
 * there, hiding it would be the projection deciding the value is not worth
 * reading.
 */
function datetimeText(nanos) {
  const f = utcFields(nanos)
  if (f === null) return null
  const clock = `${pad(f.hour)}:${pad(f.minute)}`
  const fraction = f.milli * 1_000_000 + f.nano
  const seconds =
    fraction > 0
      ? `:${pad(f.second)},${String(fraction).padStart(9, '0').replace(/0+$/, '')}`
      : f.second > 0
        ? `:${pad(f.second)}`
        : ''
  return `${pad(f.day)}.${pad(f.month)}.${f.year} ${clock}${seconds}`
}

/** `14:30` — nanoseconds since midnight, as a clock position. Seconds appear
 *  only where there are any, for the reason above. */
function timeText(nanos) {
  const hour = nanos / NANOS_PER_HOUR
  const minute = (nanos % NANOS_PER_HOUR) / NANOS_PER_MINUTE
  const second = (nanos % NANOS_PER_MINUTE) / NANOS_PER_SECOND
  const base = `${pad(Number(hour))}:${pad(Number(minute))}`
  return second > 0n ? `${base}:${pad(Number(second))}` : base
}

/**
 * `36:30` — a span, not a clock position, so the hours are unbounded and a
 * negative one keeps its sign.
 *
 * `-01:30` is ninety minutes owed, which is what a schedule-variance export
 * writes, and dropping the sign would turn a deficit into a surplus.
 */
function durationText(nanos) {
  const negative = nanos < 0n
  const magnitude = negative ? -nanos : nanos
  const hour = magnitude / NANOS_PER_HOUR
  const minute = (magnitude % NANOS_PER_HOUR) / NANOS_PER_MINUTE
  const second = (magnitude % NANOS_PER_MINUTE) / NANOS_PER_SECOND
  const base = `${negative ? '-' : ''}${hour}:${pad(Number(minute))}`
  return second > 0n ? `${base}:${pad(Number(second))}` : base
}

const BY_TYPE = Object.freeze(
  Object.assign(Object.create(null), {
    number: (value) => NUMBER.format(value),
    boolean: (value) => (value ? 'wahr' : 'falsch'),
    date: dateText,
    datetime: datetimeText,
    time: timeText,
    duration: durationText,
  }),
)

/**
 * One cell, as a German reader sees it.
 *
 * An absent value renders as the empty string rather than as a word: a report is
 * full of them, and "leer" repeated three hundred times is noise where a blank
 * cell is information. The count of them is what the typing panel reports.
 *
 * **A value whose JavaScript shape disagrees with its column's type falls back to
 * `String(value)` rather than throwing.** That is a box: a boxed cell in a
 * `number` column arrives here as the file's own text, which is the whole point
 * of the box, and it must render as that text. The fallback is therefore load-
 * bearing rather than defensive.
 *
 * @param {unknown} value the machine value the engine produced
 * @param {string} type the column's type, from `schema()`
 */
export function cellText(value, type) {
  if (value === null || value === undefined) return ''
  const write = BY_TYPE[type]
  if (write === undefined) return String(value)

  // The typed writers each want one JavaScript shape and no other. Handing a
  // temporal writer a string — which is exactly what a boxed cell is — would
  // produce `NaN` fields and a date nobody can trace back to a file.
  const wanted = type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'bigint'
  if (typeof value !== wanted) return String(value)
  // A writer answers `null` for a value of the right *shape* that it still
  // cannot render — an instant outside what a `Date` can hold. Same fallback,
  // and for the same reason: showing the value is always better than showing
  // `NaN.NaN.NaN`, which is a rendering bug wearing the costume of data.
  return write(value) ?? String(value)
}

/**
 * What a German number field may contain.
 *
 * An optional sign, then **either** a plain run of digits **or** a properly
 * grouped one — one to three digits followed by groups of exactly three, every
 * separator the same character — then at most one decimal comma with at least
 * one digit behind it.
 *
 * **The grouping has to be positionally valid, and the loose version of this
 * pattern accepted exactly the input its own comment named as the case to
 * refuse.** `^-?[\d.\s]*(,\d*)?$` matched `1.234.56` (→ 123456), `1.2` (→ 12),
 * `12.` (→ 12) and even `.` (→ 0), so a stray dot became a silent number and a
 * filter that quietly removed rows. Guessing which dot was meant is the silent
 * reinterpretation CAP-15 refuses, and the refusal has to be in the pattern
 * rather than in a sentence about it.
 *
 * The backreference is what keeps `1.000 000` out: a number groups with dots or
 * with spaces, not with both. U+00A0 is in the class because that is what a
 * paste out of Excel or a browser's own number formatting carries.
 */
const GERMAN_NUMBER =
  /^-?(?:\d+|\d{1,3}(?:([.\u0020\u00a0\u202f])\d{3})(?:\1\d{3})*)(?:,\d+)?$/

/**
 * A number as a German reader writes it, as the machine number a config stores —
 * the inverse of `cellText(value, 'number')`, so a value copied out of a preview
 * can be pasted back into a Filter.
 *
 * `null` where the text is not a number at all, which is a state of what someone
 * typed rather than a caller's bug: the control refuses it beside the field and
 * the config never hears about it. CAP-15's whole point is that the entry is
 * locale-aware and the *stored* value is not — `1.234,56` is what is typed and
 * `1234.56` is what is kept.
 */
export function germanNumber(text) {
  const trimmed = String(text).trim()
  if (trimmed === '' || !GERMAN_NUMBER.test(trimmed)) return null
  const value = Number(trimmed.replaceAll(/[.\u0020\u00a0\u202f]/g, '').replace(',', '.'))
  return Number.isFinite(value) ? value : null
}
