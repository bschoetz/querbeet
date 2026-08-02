// Step zero (CAP-9, FR-9) — what a column is, decided by reading all of it.
//
// Every cell a CSV reader delivers is a string. `1.234` is one thousand two
// hundred thirty-four under one reading and 1.234 under another, and no Filter,
// Join or Aggregate downstream can be right until a person has settled which.
// This module produces the proposal that person answers.
//
// Three rules shape the whole file.
//
//   1. DETECTION READS EVERY VALUE. Not a sample. Every comparable engine
//      samples — DuckDB 20,480 rows, Arquero 1,000, Power Query 200,
//      Frictionless 100 — and the value that resolves `03/04/2025` is a day
//      above 12, which is decisive only inside the window that was scanned.
//      That is the documented cause of silent corruption on large files (R5).
//      A querbeet column holds at most the NFR-3 target and this is already a
//      column walk, so it walks all of it.
//
//      What it does *not* do is walk it once per candidate. Nine candidates
//      against every value is the budget the Code Map names as rows × columns ×
//      candidates, and most of those candidates cannot match a single value in
//      a given column. One pass collects the separators the column contains and
//      the rest score only against what could win. No count and no verdict
//      changes, only how long they take.
//
//      THIS IS NOT FAST, AND THE NUMBER HERE IS THE HONEST ONE. Story 4a's five
//      kinds cost roughly 1.9× the two that came before: measured at the NFR-3
//      shape of 100,000 rows by 20 columns, **2.08 s before this story and
//      3.96 s after**. The absolute figures are hardware; the regression is not,
//      and it reproduces independently. Three causes, all structural: the
//      boolean pairs are scored on every column in the table, `affixScan` adds
//      passes wherever an affix character occurs, and `marksPresent`'s early
//      break is now effectively unreachable because `MARKS` grew from **four
//      marks to eight** — `. / - ,` plus `: % € $` — and an ordinary column
//      contains four or five of them, so a loop that used to stop early now
//      walks to the end. It is deliberately **not** optimised here: the project
//      owner decided on 2026-08-02 that a committed measurement harness comes
//      before any optimisation of detection, and the open ledger entries carry
//      the candidate routes and the reason none may be chosen by feel.
//
//   2. THERE ARE TWO KINDS OF AMBIGUITY AND THEY ARE NOT THE SAME SENTENCE.
//      Either one reading carries decisive evidence and the count is nameable —
//      "47 values have a day above 12" — or every value parses under both
//      readings and *nothing in the column settles it*. No comparable tool
//      reports the second state: DuckDB documents a tie-break in which dd-mm
//      beats mm-dd silently. Here it is `unresolved`, the severity that exists
//      for exactly this, and a column in that state cannot be confirmed.
//
//      Decisive means *strictly more* exclusive evidence than the runner-up.
//      Five values that read only as dd.mm against five that read only as mm.dd
//      is not evidence for dd.mm; it is a column arguing with itself, and the
//      only honest report is that nothing settles it. Naming the winner there
//      would be DuckDB's tie-break with a real count attached, which makes it
//      more convincing and no more true.
//
//      And an ambiguity between readings that mean the same thing is not an
//      ambiguity. A column of `1`, `2`, `42` parses under both number readings
//      because neither separator appears in it — but both give the same number,
//      so there is no question to ask. Asked anyway, it would block the gate on
//      almost every real table, over the most common column type there is.
//
//   3. NOTHING HERE CONVERTS A VALUE. This module decides what a column *is*
//      and counts what would parse. Turning cells into numbers and into epoch
//      nanoseconds as a `BigInt` happens on the way into a Table (AD-21, AD-22),
//      in story 6, because the raw text has to survive for the preview and the
//      damage report to keep reading it.
//
// Pure, framework-free, browser-free (AD-1, AD-2). `Intl` is a JS built-in of
// ECMA-402, not a browser API, and it is where the separators come from — a
// hand-written table of locale separators is the kind of thing that is wrong
// about a locale nobody on the team speaks.

import {
  DATE,
  DATETIME,
  DURATION,
  TIME,
  BOOLEAN,
  NUMBER,
  TEXT,
  TYPES,
  declaredNativeType,
  isNativeType,
} from './catalog.js'

// The vocabulary is declared in catalog.js and re-exported here so a caller that
// already has typing.js in hand does not need a second import for the three
// words it has always used. Adding a type is one edit, in the catalogue.
export { TEXT, NUMBER, DATE, DATETIME, TIME, DURATION, BOOLEAN }

/** What a column reads as missing until the user says otherwise. Export
 *  formats disagree and the choice is not inferable (FR-9), so this is a
 *  starting point the user edits, never a fixed rule. */
export const DEFAULT_MISSING = Object.freeze(['', '-', '–', '—', 'n/a', 'N/A', 'k.A.', 'k. A.'])

/** The share of non-missing values a reading must cover before it is proposed
 *  over plain text. It is a proposal and the hit rate is always shown beside
 *  it, so this number decides what the user starts from, never what they get:
 *  FR-9's own example is a date column at 842 of 900. */
const PROPOSAL_THRESHOLD = 0.9

/** The two number readings, and exactly the two FR-9 names: `1.234,56` against
 *  `1,234.56`. Their separators are read from Intl rather than written down,
 *  because a hand-written separator table is the kind of thing that is wrong
 *  about a locale nobody on the team speaks.
 *
 *  A third locale is deliberately absent. de-CH's decimal mark is `.`, the same
 *  as en-US, so on any column without a grouping separator the two readings are
 *  indistinguishable — and a column reported as ambiguous between two readings
 *  that mean the same number is a question no user can answer. Adding a locale
 *  means bringing a Source that needs it, and checking it against that. */
const NUMBER_LOCALES = ['de-DE', 'en-US']

/** All-numeric date shapes. Month names are deliberately absent: they need a
 *  calendar per language, and no Source seen so far carries them. A story that
 *  needs them adds them here with its own evidence. */
const DATE_PATTERNS = Object.freeze([
  { pattern: 'dd.MM.yyyy', separator: '.', order: 'dmy' },
  { pattern: 'MM.dd.yyyy', separator: '.', order: 'mdy' },
  { pattern: 'dd.MM.yy', separator: '.', order: 'dmy', shortYear: true },
  { pattern: 'dd/MM/yyyy', separator: '/', order: 'dmy' },
  { pattern: 'MM/dd/yyyy', separator: '/', order: 'mdy' },
  { pattern: 'dd-MM-yyyy', separator: '-', order: 'dmy' },
  { pattern: 'MM-dd-yyyy', separator: '-', order: 'mdy' },
  { pattern: 'yyyy-MM-dd', separator: '-', order: 'ymd' },
])

/** The date shapes on offer, for a caller that has to render a choice. */
export const dateCandidates = () => DATE_PATTERNS

/**
 * What a two-digit year means — a rule this product owns, not one the code
 * chose for itself.
 *
 * `00–29` is `20yy`, `30–99` is `19yy`. That is Excel's fixed pivot, so the
 * office ecosystem querbeet replaces agrees with it, and every Recipe re-run
 * reads the same date. A sliding window relative to the current year is
 * deliberately refused: it would make a Recipe produce a different table in
 * 2031 than it produced in 2026, over data that never changed.
 */
export const expandTwoDigitYear = (yy) => (yy <= 29 ? 2000 + yy : 1900 + yy)

/** The one character every temporal shape below is built around. Named because
 *  it is also the mark the candidate narrowing keys the whole clock family on. */
const TIME_SEPARATOR = ':'

/**
 * The datetime shapes, a closed list this story.
 *
 * A candidate is a **date part and what separates it from the clock**, and
 * nothing else. Everything optional is optional on every one of them: seconds, a
 * fractional second of 1–9 digits written with `.` or `,`, a zone offset, and a
 * one- or two-digit hour. That is not generosity, it is the finding of review
 * round 1 — the previous cut allowed a fraction on the ISO candidate alone, so
 * `2026-02-13 15:57:35.461` (SQL Server, .NET) and `2026-02-13
 * 15:57:35.461+02:00` (Postgres `timestamptz`) were text while their `T`-spelled
 * twins were datetimes, and `31.12.2025 9:05` was text while `9:05` standing
 * alone read perfectly well as a time. A clock does not change its rules because
 * a date is in front of it, so there is exactly one clock reader below and both
 * kinds go through it.
 *
 * The `MM/dd` mirror is deliberately absent — a candidate enters with a real
 * Source that needs it, the same rule `NUMBER_LOCALES` already follows.
 *
 * The ISO candidate is named for the standard rather than spelled as a pattern,
 * because it is not one shape, and **a candidate named `ISO 8601` has to accept
 * ISO 8601**: lowercase `t` and `z`, a comma decimal, and a two-digit offset are
 * all in the standard. Naming a strict subset after it puts the same lie in the
 * reading select that spelling it `yyyy-MM-dd'T'HH:mm:ss` would.
 */
const DATETIME_PATTERNS = Object.freeze([
  { pattern: 'ISO 8601', date: { separator: '-', order: 'ymd' }, iso: true },
  { pattern: 'yyyy-MM-dd HH:mm', date: { separator: '-', order: 'ymd' } },
  { pattern: 'dd.MM.yyyy HH:mm', date: { separator: '.', order: 'dmy' } },
  { pattern: 'dd.MM.yy HH:mm', date: { separator: '.', order: 'dmy', shortYear: true } },
])

/**
 * The boolean pairs, and the rule that a pair never mixes with another.
 *
 * Each pair is scored on its own, so `ja` beside `false` is 50 % under two pairs
 * and text under both — which is the answer, because a column that spells its
 * yes two ways has not been exported by one system. The word pairs match
 * case-insensitively: German Excel writes `WAHR`/`FALSCH` and that is the same
 * pair as `wahr`/`falsch`, not a fifth one.
 */
const BOOLEAN_PAIRS = Object.freeze([
  { pattern: 'true/false', truthy: 'true', falsy: 'false', words: true },
  { pattern: 'wahr/falsch', truthy: 'wahr', falsy: 'falsch', words: true },
  { pattern: 'ja/nein', truthy: 'ja', falsy: 'nein', words: true },
  { pattern: '1/0', truthy: '1', falsy: '0', words: false },
])

/** The longest token any pair carries — derived, like `MARKS`, so a fifth pair
 *  cannot leave it behind. It is a cheap gate in front of the lowercasing, which
 *  is otherwise an allocation per value on every column in the table; hand-set,
 *  it would silently stop matching the day someone added a longer word. */
const BOOLEAN_TOKEN_MAX = Math.max(
  ...BOOLEAN_PAIRS.flatMap((pair) => [pair.truthy.length, pair.falsy.length]),
)

/**
 * `time` and `duration` are one kind with two candidates, not two kinds.
 *
 * Every time-readable value is duration-readable, so scoring them as separate
 * kinds would produce a permanent tie that the cross-kind rule ("a tie goes to
 * number") has no answer for. As two candidates of one kind they go through the
 * same machinery story 3 built for dd.mm against MM.dd: a value at or past
 * `24:00` reads only as a duration and is decisive evidence with a nameable
 * count, and a column where nothing passes `24:00` is `unresolved` — the state
 * that blocks the gate until a person answers.
 */
const CLOCK_CANDIDATES = Object.freeze([{ type: TIME }, { type: DURATION }])

/**
 * The affixes a number may carry (piece 5).
 *
 * Decisive markers with no second reading: `12,5 %` is 12,5 percent and nothing
 * else, and the argument that it might mean 0,125 was a storage question rather
 * than an ambiguity. The stored number is the number in the field; the affix
 * rides on the column record and never alters a cell.
 */
const AFFIXES = Object.freeze(['%', '€', '$'])

/** Number separators for one locale, taken from Intl rather than assumed. */
function separatorsOf(locale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.8)
  const group = parts.find((p) => p.type === 'group')?.value ?? ''
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  return { locale, group, decimal }
}

/** The distinct number readings to try. Two locales that agree on both
 *  separators are one reading, not two — otherwise a column would report an
 *  ambiguity between de-DE and de-AT, which is not a question anyone can
 *  answer. */
export function numberCandidates() {
  const seen = new Map()
  for (const locale of NUMBER_LOCALES) {
    const sep = separatorsOf(locale)
    const key = `${sep.group}|${sep.decimal}`
    if (!seen.has(key)) seen.set(key, Object.freeze(sep))
  }
  return Object.freeze([...seen.values()])
}

/**
 * Every character any candidate uses to tell one reading from another.
 *
 * Derived rather than written down, so adding a date shape or a locale cannot
 * leave this list behind and silently disable the narrowing below.
 */
const MARKS = Object.freeze(
  [
    ...new Set([
      ...DATE_PATTERNS.map((p) => p.separator),
      ...numberCandidates().flatMap((c) => [c.group, c.decimal]),
      TIME_SEPARATOR, // every datetime, time and duration shape is built on it
      ...AFFIXES, // an affixed reading is only worth scoring where one occurs
    ]),
  ].filter((mark) => mark !== ''), // a locale without a grouping separator
)

/**
 * Which of those characters this column actually contains.
 *
 * One pass, and it pays for several. Nine candidates against every value is
 * nine column walks — the budget the Code Map names as rows × columns ×
 * candidates — and most of those candidates cannot match a single value:
 * `readsAsDate` splits on its separator and requires exactly three parts, so a
 * pattern whose separator appears nowhere scores zero without being asked.
 * Narrowing on this is arithmetic, not a heuristic; it changes no count and no
 * verdict, only how long they take. Detection still reads every value (FR-9).
 */
function marksPresent(values) {
  const present = new Set()
  for (const value of values) {
    if (present.size === MARKS.length) break
    for (const mark of MARKS) {
      if (!present.has(mark) && value.includes(mark)) present.add(mark)
    }
  }
  return present
}

/**
 * The number readings this column can tell apart.
 *
 * Two readings are the same reading here when the separators that differ
 * between them appear in no value: what is left is a signed digit string, and
 * both make it the same integer. So a column of `1`, `2`, `42` gets one
 * candidate rather than two — which is why it is never reported as an
 * ambiguity, and why it costs one walk instead of two. The user is not asked a
 * question whose two answers are identical.
 */
function numberReadings(present) {
  const seen = new Map()
  for (const candidate of numberCandidates()) {
    const key = [candidate.group, candidate.decimal]
      .map((mark) => (present.has(mark) ? mark : ''))
      .join('|')
    if (!seen.has(key)) seen.set(key, candidate)
  }
  return [...seen.values()]
}

const DIGITS = /^\d+$/

/**
 * Peel the accounting sign off a value (piece 6).
 *
 * `(1.234,56)` and `1.234,56-` are both negative in the exports every ERP and
 * every accounting package writes. Two sign marks on one value — `(1.234,56-)`,
 * or a parenthesised value that also carries a leading minus — is not a number
 * at all rather than a doubly-negated one.
 *
 * The sign is returned, never discarded. Stripping the parentheses and dropping
 * what they meant is the one wrong-number defect this story could produce, and
 * story 6 converts through this same function precisely so the peeling and the
 * carrying cannot come apart.
 */
/** Peel one affix off either end, with or without one space between it and the
 *  digits. At most one, and exactly one space — `12  %` keeps the second space
 *  in the body and does not read as a number, which is what a stray double
 *  space in an export deserves. */
function peelAffix(text) {
  for (const affix of AFFIXES) {
    if (text.startsWith(affix)) {
      const rest = text.slice(affix.length)
      return { affix, body: rest.startsWith(' ') ? rest.slice(1) : rest }
    }
    if (text.endsWith(affix)) {
      const rest = text.slice(0, -affix.length)
      return { affix, body: rest.endsWith(' ') ? rest.slice(0, -1) : rest }
    }
  }
  return { affix: null, body: text }
}

/**
 * Peel the wrappers off a value — the sign and the unit — from the outside in.
 *
 * **The sign is counted and carried, never merely removed.** Three spellings say
 * negative and each is one *sign mark*: `(1.234,56)`, `1.234,56-`, and an
 * ordinary leading `-`. A value carrying two of them — `(1.234,56-)`,
 * `(-1.234,56)` — is not a doubly-negated number, it is not a number at all.
 * This is the one wrong-number defect the story can produce, so the peeling and
 * the carrying happen in one place and neither can be done without the other.
 *
 * **The order the two nest in is not fixed, because exporters do not fix it.**
 * `-$1,234.56` is Excel's own default rendering of a negative dollar amount and
 * `-1.234,56 €` is its German twin; `(€1.234,56)` and `€ (1.234,56)` are both in
 * the wild. A fixed sign-outside-affix reading made half of those text while the
 * other half read — the flagship "amount out of any ERP export" failing on one
 * of its two spellings. So this loops from both ends until nothing more peels,
 * which makes the composition order-independent by construction rather than by
 * enumerating the nestings someone thought of.
 *
 * It terminates: every branch either shortens the body or claims the one affix,
 * and the affix can be claimed once.
 */
function peelWrappers(text) {
  let body = text
  let affix = null
  let negative = false
  let marks = 0

  for (;;) {
    if (body.length >= 2 && body.startsWith('(') && body.endsWith(')')) {
      body = body.slice(1, -1)
      negative = true
      marks += 1
      continue
    }
    if (body.length >= 2 && body.endsWith('-')) {
      body = body.slice(0, -1)
      negative = true
      marks += 1
      continue
    }
    if (body.startsWith('-') || body.startsWith('+')) {
      negative = negative || body.startsWith('-')
      body = body.slice(1)
      marks += 1
      continue
    }
    if (affix === null) {
      const peeled = peelAffix(body)
      if (peeled.affix !== null) {
        affix = peeled.affix
        body = peeled.body
        continue
      }
    }
    break
  }

  return marks > 1 ? null : { body, affix, negative }
}

/**
 * The one number reading rule: the wrappers outside, the digits at the centre.
 *
 * Returns the integer digits with the grouping removed — which is what the
 * overflow guard compares, digit by digit — **and whether the value is
 * negative**, or `null` where the value is not a number under this reading.
 * Grouping, if present, must be consistent: `1.23.456` is not a German number,
 * and accepting it would let a malformed column look fully readable.
 *
 * `affix` is the affix the *column* carries, and every parsed value must carry
 * it: a bare number in a percent column counts unparsed rather than quietly
 * joining a column of percentages.
 *
 * **Exported for story 6**, which converts a confirmed column into a Table and
 * must read every value exactly as detection counted it. A second parser there
 * would be a second opinion about what `(1.234,56)` means, and the first thing
 * it would get wrong is the sign.
 */
export function numberParts(text, { group, decimal }, affix = null) {
  const peeled = peelWrappers(text)
  if (peeled === null || peeled.affix !== affix) return null

  const body = peeled.body
  if (body === '') return null

  let integer = body
  if (decimal !== '') {
    const at = body.indexOf(decimal)
    if (at !== -1) {
      if (body.indexOf(decimal, at + 1) !== -1) return null // two decimal marks
      integer = body.slice(0, at)
      if (!DIGITS.test(body.slice(at + decimal.length))) return null
    }
  }

  if (integer === '') return null
  if (group !== '' && integer.includes(group)) {
    const parts = integer.split(group)
    if (parts.length < 2) return null
    if (!DIGITS.test(parts[0]) || parts[0].length === 0 || parts[0].length > 3) return null
    if (!parts.slice(1).every((p) => p.length === 3 && DIGITS.test(p))) return null
    return { digits: parts.join(''), negative: peeled.negative }
  }
  return DIGITS.test(integer) ? { digits: integer, negative: peeled.negative } : null
}

/** Does `text` read as a number under these separators and this affix? */
const readsAsNumber = (text, candidate, affix = null) =>
  numberParts(text, candidate, affix) !== null

/** The digits `Number` can still tell apart, as digits. */
const MAX_SAFE_DIGITS = String(Number.MAX_SAFE_INTEGER)

/**
 * Is this value's integer part past what a JS number can hold (piece 1)?
 *
 * Compared as digits, never through a float round trip: `Number('…993') ===
 * Number('…992')` is exactly the equality that loses the information, so asking
 * the float whether it lost anything is asking the wrong witness. A 19-digit
 * order number is the case — reported as `number`, `settled`, 100 % readable, it
 * would lose its last digits at story 6's conversion (C-10, arriving through the
 * text path story 4 already guards from the Parquet side).
 */
function exceedsSafeInteger(digits) {
  const significant = digits.replace(/^0+(?=\d)/, '')
  return (
    significant.length > MAX_SAFE_DIGITS.length ||
    (significant.length === MAX_SAFE_DIGITS.length && significant > MAX_SAFE_DIGITS)
  )
}

/** A leading zero is information — an article number, a postcode, a cost
 *  centre — and reading it as a number destroys it. FR-9: such a column stays
 *  text unless the user says otherwise. Read through the sign and the affix, so
 *  `(0123)` and `0123 €` are the same finding as a bare `0123`. */
function hasLeadingZero(text) {
  const peeled = peelWrappers(text)
  return /^0\d/.test(peeled === null ? text : peeled.body)
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const max = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]
  return day <= max
}

/** Does `text` read as a date under this pattern? Deliberately strict about
 *  width: `3.4.2025` is not `dd.MM.yyyy`, because accepting a loose width would
 *  make two patterns agree on values that distinguish them. A two-digit year is
 *  its own pattern with its own width, never a loosening of the four-digit one. */
function readsAsDate(text, { separator, order, shortYear = false }) {
  const parts = text.split(separator)
  if (parts.length !== 3) return false

  const yearWidth = shortYear ? 2 : 4
  const widths = order === 'ymd' ? [yearWidth, 2, 2] : [2, 2, yearWidth]
  for (let i = 0; i < 3; i += 1) {
    if (parts[i].length !== widths[i] || !DIGITS.test(parts[i])) return false
  }

  const [a, b, c] = parts.map(Number)
  if (order === 'ymd') return isRealDate(shortYear ? expandTwoDigitYear(a) : a, b, c)
  const year = shortYear ? expandTwoDigitYear(c) : c
  if (order === 'dmy') return isRealDate(year, b, a)
  return isRealDate(year, a, b)
}

// ------------------------------------------------- datetime, time, duration
//
// AD-21 is amended by this story: every temporal column holds **nanoseconds as a
// `BigInt`** — a date UTC-midnight epoch nanoseconds, a datetime UTC epoch
// nanoseconds, a `time` nanoseconds since midnight, a `duration` plain
// nanoseconds. One unit for all four, because a split rule would make a
// date-against-datetime join a unit conversion. Nothing here converts anything —
// this is what a column *is* — but the representation decides two things that do
// live here: that `duration` is a type a user can choose at all, and that a
// fractional second is read rather than rounded away.

/** `HH:mm(:ss)`, hours 00–23 in one or two digits, minutes and seconds two
 *  digits at most 59. This is the `time` type, standing alone. */
const CLOCK_TIME = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/

/** The same shape with the hours unbounded — every time is a duration, which is
 *  exactly why the two need a question rather than a preference. */
const CLOCK_DURATION = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/

/**
 * The clock that rides behind a date: `CLOCK_TIME` plus the two things only a
 * timestamp carries — a fractional second of 1–9 digits alongside seconds,
 * spelled with `.` **or** `,` because ISO 8601 allows both, and a zone offset of
 * `Z`, `z`, `±HH`, `±HHmm` or `±HH:mm`.
 *
 * The hour is `\d{1,2}` here for exactly the reason it is `\d{1,2}` there.
 * `31.12.2025 9:05` is an ordinary German export, and it read as text while
 * `9:05` standing alone read as a time — an hour that is two-digit behind a date
 * and one-or-two in front of nothing is two clocks wearing one name. Everything
 * this reader adds is additive, so the promise "the clock behind a date reads
 * what the clock reads alone" is structural rather than remembered.
 *
 * Nine fractional digits is the representation's own resolution (AD-21, epoch
 * nanoseconds), not an arbitrary cap: every digit that matches here survives
 * into a Table, and a tenth is counted unreadable rather than quietly dropped —
 * which is the C-10 rule applied to the other end of a number.
 */
const DATETIME_CLOCK =
  /^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/

/**
 * Does `text` read as a clock? `offsets` is what separates the two callers: the
 * standalone `time` type takes the bare shape, a datetime's clock takes the
 * fraction and the zone as well.
 */
function readsAsClockTime(text, offsets) {
  const m = (offsets ? DATETIME_CLOCK : CLOCK_TIME).exec(text)
  if (m === null || Number(m[1]) > 23) return false
  if (!offsets) return true

  const offset = m[5]
  if (offset === undefined || offset === 'Z' || offset === 'z') return true
  const digits = offset.slice(1).replace(':', '')
  return Number(digits.slice(0, 2)) <= 23 && (digits.length === 2 || Number(digits.slice(2)) <= 59)
}

/** Where the date stops and the clock starts. ISO 8601 separates them with `T`
 *  and permits the lowercase form; every other candidate uses a space. */
const clockStart = (text, candidate) => (candidate.iso ? text.search(/[Tt]/) : text.indexOf(' '))

function readsAsDateTime(text, candidate) {
  const at = clockStart(text, candidate)
  if (at === -1) return false
  return readsAsDate(text.slice(0, at), candidate.date) && readsAsClockTime(text.slice(at + 1), true)
}

const readsAsTime = (text) => readsAsClockTime(text, false)

const readsAsDuration = (text) => CLOCK_DURATION.test(text)

const readsAsClock = (text, candidate) =>
  candidate.type === TIME ? readsAsTime(text) : readsAsDuration(text)

function readsAsBoolean(text, { truthy, falsy, words }) {
  if (text.length > BOOLEAN_TOKEN_MAX) return false
  const value = words ? text.toLowerCase() : text
  return value === truthy || value === falsy
}

const EMPTY = Object.freeze([])

/**
 * Which affix this column carries, and which ones it carries at all.
 *
 * `affix` is the one the column reads best under — including `null`, which wins
 * whenever the bare reading covers more values. Without that comparison a single
 * stray `1.000,00 €` in a column of a thousand plain numbers would make the
 * whole column an affixed one and count the other 999 unparsed.
 *
 * `used` is every affix that some value genuinely carries *as a number*, which
 * is what makes the mixed-affix finding a finding rather than noise: a text
 * column mentioning `€` and `$` in prose reads as neither, so neither is used.
 */
function affixScan(values, readings, present) {
  const possible = AFFIXES.filter((affix) => present.has(affix))
  if (possible.length === 0) return { affix: null, used: EMPTY }

  const bestCount = (affix) => {
    let best = 0
    for (const reading of readings) {
      let parsed = 0
      for (const value of values) if (readsAsNumber(value, reading, affix)) parsed += 1
      if (parsed > best) best = parsed
    }
    return best
  }

  const used = []
  let affix = null
  let best = bestCount(null)
  for (const candidate of possible) {
    const parsed = bestCount(candidate)
    if (parsed > 0) used.push(candidate)
    if (parsed > best) {
      best = parsed
      affix = candidate
    }
  }
  return { affix, used }
}

// ------------------------------------------------------- the native sweep
//
// AD-20: a natively typed column skips locale inference and still passes the
// missing-value and unparsed sweep. Until this story the sweep was vacuous —
// `detectColumn` scored every non-missing cell of a native column as parsed —
// and that only holds for a homogeneous column, which a real file is not.
//
// Two shapes break it, and both are silent corruption if the sweep stays a
// rubber stamp. A mixed XLSX column carries strings alongside its numbers, and
// they are neither missing nor readable. And a Parquet INT64 past 2^53 keeps its
// exact digits in the cell — the reader is careful to write them out — but there
// is no JS number that round-trips them, so the value cannot survive story 6's
// conversion. Naming it as unparsed is what makes the loss visible instead of
// silent (C-10).
//
// What "parses" means here is the *canonical form* the readers write, not a
// locale reading: the typed-ness lives in the column's domain and the cells are
// machine-shaped text (`1234.5`, `2025-08-01`, ISO 8601 UTC, `true`/`false`).

/** Shortest round-trip decimal, and nothing else. `String(Number(text))` is
 *  exactly the form the readers emit, so requiring the round trip both rejects
 *  a stray string and catches the digits no JS number can hold. */
function readsAsCanonicalNumber(text) {
  if (text === '') return false
  const n = Number(text)
  return Number.isFinite(n) && String(n) === text
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function readsAsCanonicalDate(text) {
  if (!ISO_DATE.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  return isRealDate(year, month, day)
}

/** ISO 8601 in UTC, as `Date.prototype.toISOString` writes it. The round trip is
 *  the whole check: it rejects a local-zone offset, a missing `Z`, an impossible
 *  day, and the `yyyy-MM-dd` form that belongs to a date column instead. */
function readsAsCanonicalDateTime(text) {
  if (text === '') return false
  const at = Date.parse(text)
  return Number.isFinite(at) && new Date(at).toISOString() === text
}

const readsAsCanonicalBoolean = (text) => text === 'true' || text === 'false'

const CANONICAL = Object.freeze({
  [NUMBER]: readsAsCanonicalNumber,
  [DATE]: readsAsCanonicalDate,
  [DATETIME]: readsAsCanonicalDateTime,
  [BOOLEAN]: readsAsCanonicalBoolean,
})

/**
 * Every catalogue type a reader may declare natively that has no canonical form
 * here. Empty is the rule, and a test asserts it.
 *
 * Without the invariant, adding a type to the catalogue leaves `reads`
 * undefined, the sweep throws a `TypeError`, the store catches it as a failed
 * read, and a perfectly good file is reported to the user as unreadable. Story
 * 4a adds six types and would land on exactly that. This is the same treatment
 * `typeLabelGaps()` already gives the German words.
 */
export const canonicalTypeGaps = () =>
  Object.freeze(TYPES.filter((type) => type.native && !CANONICAL[type.code]).map((t) => t.code))

/** How a candidate names itself when a sentence has to mention it. A date
 *  pattern names its shape; a number reading names its locale, because
 *  "de-DE against en-US" is a distinction a person can act on and
 *  "`.,` against `,.`" is not; and a clock candidate names its type, because
 *  time against duration is a question about what the column *is*. */
const keyOf = (candidate) => candidate.pattern ?? candidate.locale ?? candidate.type

/**
 * Score every candidate of one kind over every non-missing value.
 *
 * Counts only. A set of matched row indices per candidate would be up to nine
 * of them at the NFR-3 column size, and the only thing ever asked of them is a
 * pair of counters over the top two — which `exclusive` walks for separately,
 * once the sort has said which two those are.
 */
function score(values, candidates, reads) {
  const hits = candidates.map((candidate) => {
    let parsed = 0
    for (let i = 0; i < values.length; i += 1) if (reads(values[i], candidate)) parsed += 1
    return { candidate, parsed }
  })
  hits.sort((a, b) => b.parsed - a.parsed || keyOf(a.candidate).localeCompare(keyOf(b.candidate)))
  return hits
}

/**
 * What each of two readings reads that the other cannot.
 *
 * `only` is the number FR-9 wants named ("47 values have a day above 12").
 * `contested` is the same count for the runner-up, and it is why this returns a
 * pair rather than a number: a reading is decisive only when it reads more
 * exclusively than the other, and 5 against 5 is a column arguing with itself.
 */
function exclusive(values, a, b, reads) {
  let only = 0
  let contested = 0
  for (const value of values) {
    const inA = reads(value, a)
    const inB = reads(value, b)
    if (inA && !inB) only += 1
    else if (inB && !inA) contested += 1
  }
  return { only, contested }
}


/**
 * What a reader's domain declaration actually buys, in three parts (AD-20).
 *
 * `domain` is what the column *is*, and it is the one of the three that travels:
 * story 14 serializes it into the Recipe and story 6 reads it as the instruction
 * for a conversion. So a declaration the catalogue does not admit — Parquet's
 * TIME, INTERVAL, DECIMAL, INT96 — is **discarded here**, not carried. The
 * column is `text`, exactly as if the reader had said nothing, and it is
 * detected and settable like any other text column.
 *
 * What is kept is `refusedNativeType`: the bare word, as provenance rather than
 * as a domain. It is what lets the card say *which* type was refused and on
 * which column, and it is deliberately not spelled `native:…` so that no reader
 * of a column record can mistake it for something to convert against.
 */
function readDeclaration(declared) {
  const word = declaredNativeType(declared)
  if (word === null) return { domain: declared ?? TEXT, nativeType: null, refusedNativeType: null }
  if (isNativeType(word)) return { domain: declared, nativeType: word, refusedNativeType: null }
  return { domain: TEXT, nativeType: null, refusedNativeType: word }
}

/**
 * Read a column and propose what it is.
 *
 * @param {ReadonlyArray<string>} cells every value, in order
 * @param {{ domain?: string, missingTokens?: ReadonlyArray<string> }} [options]
 *   `domain` is the reader's declaration (AD-20): `text`, or `native:<type>`
 *   for a format that carries real types. A native column skips inference and
 *   is presented pre-typed — but it is still swept for missing values and it is
 *   still confirmable, which is what keeps the gate from becoming a rubber
 *   stamp for XLSX and Parquet.
 */
export function detectColumn(cells, options = {}) {
  const { domain, nativeType, refusedNativeType } = readDeclaration(options.domain)
  const { tokens: missingTokens, values, missing } = sift(cells, options.missingTokens)

  const counts = (parsed) =>
    Object.freeze({ total: cells.length, missing, parsed, unparsed: values.length - parsed })

  /** One record shape, one place. Every early return below is a text column with
   *  something different about it, and spelling the shape out at each of them is
   *  how a field gets forgotten on one route and carried on another. */
  const record = (over) =>
    Object.freeze({
      type: TEXT,
      format: null,
      counts: counts(values.length),
      verdict: 'settled',
      evidence: null,
      missingTokens,
      domain,
      refusedNativeType,
      affix: null,
      mixedAffixes: null,
      ...over,
    })

  // AD-20: a natively typed column arrives already decided. Inferring a locale
  // for it would be inventing a question the format already answered — but the
  // sweep is real: every cell is checked against the canonical form of its type,
  // so a stray string and a digit string no JS number can hold are both counted
  // and named rather than waved through.
  //
  // A declaration the catalogue does not admit never gets here: `readDeclaration`
  // has already discarded it down to `text`, and what is left of it is the word
  // on `refusedNativeType`, which is provenance rather than a domain.
  if (nativeType !== null) {
    const reads = CANONICAL[nativeType]
    let parsed = 0
    for (const value of values) if (reads(value)) parsed += 1
    return record({ type: nativeType, counts: counts(parsed) })
  }

  if (values.length === 0) return record({})

  // Which readings this column could even distinguish. Everything below scores
  // against that set rather than against every candidate there is.
  const present = marksPresent(values)
  const readings = numberReadings(present)

  // The column's affix, and every affix it carries. A column mixing two is not a
  // number column at all: `12 €` beside `12 $` cannot be summed, and proposing a
  // number would invite exactly that sum.
  const { affix, used } = affixScan(values, readings, present)
  const mixedAffixes = used.length > 1 ? Object.freeze([...used]) : null
  const readsNumber = (value, candidate) => readsAsNumber(value, candidate, affix)

  // Three ways the number reading is disqualified for the *whole* column rather
  // than value by value. One leading zero anywhere: the zeros are the
  // information, and a column of article numbers is not half numeric (FR-9). One
  // integer past `Number.MAX_SAFE_INTEGER`: same argument, since a column of
  // 19-digit order numbers proposed as `number` at 98 % readable would invite
  // confirming precision loss on the other 2 %. And two affixes: see above.
  //
  // The length test in front of the overflow walk is free arithmetic, not a
  // heuristic — a value shorter than sixteen characters cannot hold sixteen
  // integer digits — and it keeps an ordinary column from paying for the guard.
  const overflows = (value) =>
    value.length >= MAX_SAFE_DIGITS.length &&
    readings.some((reading) => {
      const parts = numberParts(value, reading, affix)
      return parts !== null && exceedsSafeInteger(parts.digits)
    })

  const numberDisqualified =
    mixedAffixes !== null || values.some(hasLeadingZero) || values.some(overflows)

  const clocks = present.has(TIME_SEPARATOR)

  // Every kind is scored independently over every value; the highest hit rate at
  // or above the threshold proposes, and a tie goes to `number` because it is
  // the reading that loses least if it is wrong. Declaration order is the
  // tie-break, and `number` is declared first, so the rule is the loop rather
  // than a special case inside it.
  //
  // The clock kind is the one that carries two *types* rather than two readings.
  // Its ambiguity is therefore a question about the column's type, and it is
  // marked as such so the store can name it with its own code and the pane can
  // put the placeholder on the type select instead of the reading select.
  const datePatterns = DATE_PATTERNS.filter((p) => present.has(p.separator))

  const kinds = [
    {
      type: NUMBER,
      reads: readsNumber,
      hits: numberDisqualified ? EMPTY : score(values, readings, readsNumber),
    },
    { type: DATE, reads: readsAsDate, hits: score(values, datePatterns, readsAsDate) },
    {
      type: DATETIME,
      reads: readsAsDateTime,
      hits: clocks ? score(values, DATETIME_PATTERNS, readsAsDateTime) : EMPTY,
    },
    {
      over: 'kind',
      reads: readsAsClock,
      hits: clocks ? score(values, CLOCK_CANDIDATES, readsAsClock) : EMPTY,
    },
    { type: BOOLEAN, reads: readsAsBoolean, hits: score(values, BOOLEAN_PAIRS, readsAsBoolean) },
  ]

  let winner = null
  for (const kind of kinds) {
    if ((kind.hits[0]?.parsed ?? 0) > (winner?.hits[0]?.parsed ?? 0)) winner = kind
  }
  const best = winner?.hits[0]

  if (!best || best.parsed / values.length < PROPOSAL_THRESHOLD) return record({ mixedAffixes })

  const overKind = winner.over === 'kind'
  const type = overKind ? best.candidate.type : winner.type
  const runnerUp = winner.hits[1] ?? null

  // Three two-digit parts settle nothing. A `dd.MM.yy` column is asked about
  // rather than proposed unless something in it decides — story 3's second
  // ambiguity state, on the case it was built for, with the alternatives being
  // *types* because the choice on offer is `Datum` or `Text`.
  if (type === DATE && best.candidate.shortYear) {
    const settled = shortYearVerdict(values, best.candidate)
    if (settled === TEXT) return record({ mixedAffixes })
    if (settled === 'unresolved') {
      return record({
        type: DATE,
        format: best.candidate,
        counts: counts(best.parsed),
        verdict: 'unresolved',
        evidence: Object.freeze({ over: 'kind', alternatives: Object.freeze([DATE, TEXT]) }),
      })
    }
  }

  // The ambiguity states. A runner-up that reads nothing is no contest at all;
  // a reading that reads more exclusively than the other is decisive and the
  // count is nameable; anything else is the state where nothing settles it, and
  // saying so is the whole point (FR-9).
  //
  // There is no case here for two readings that mean the same thing. That is
  // handled where it belongs and where it is also cheapest — `numberReadings`
  // never offers them as two, so there is no runner-up to argue with.
  //
  // `over: 'kind'` is set only where the alternatives are types. A reading
  // ambiguity's evidence keeps exactly the shape story 3 shipped, field for
  // field, because that shape is asserted whole in the story-3 suite and this
  // story changes no verdict of it.
  let verdict = 'settled'
  let evidence = null

  if (runnerUp && runnerUp.parsed > 0) {
    const { only, contested } = exclusive(values, best.candidate, runnerUp.candidate, winner.reads)
    const alternatives = Object.freeze([keyOf(best.candidate), keyOf(runnerUp.candidate)])
    const over = overKind ? { over: 'kind' } : {}

    if (only > contested) {
      verdict = 'decisive'
      evidence = Object.freeze({ ...over, alternatives, decidedBy: only, contested })
    } else {
      verdict = 'unresolved'
      evidence = Object.freeze({ ...over, alternatives })
    }
  }

  return record({
    type,
    // `time` and `duration` carry no reading to choose, so they carry no format.
    format: overKind ? null : best.candidate,
    counts: counts(best.parsed),
    verdict,
    evidence,
    affix: type === NUMBER ? affix : null,
    // Carried whatever kind won. Eighteen German dates beside `12 €` and `12 $`
    // propose `date`, and the two amounts would otherwise survive only as an
    // anonymous unparsed count — the two-units fact is still true, still the
    // user's to act on, and losing it because a *different* kind cleared the
    // threshold is the finding going quiet exactly where it is least expected.
    // What the sentence in `ui/` may no longer claim is that the column is read
    // as text, because sometimes it is not.
    mixedAffixes,
  })
}

/** Three parts of exactly two digits — the shape a version number, a chapter
 *  number and a `dd.MM.yy` date all share, and the reason none of them can be
 *  told from the others by looking at one value. */
function isTwoDigitTriple(value, separator) {
  const parts = value.split(separator)
  return parts.length === 3 && parts.every((part) => part.length === 2 && DIGITS.test(part))
}

/**
 * What a `dd.MM.yy` column has settled about itself: `TEXT`, `'unresolved'`, or
 * `null` for "nothing special, carry on".
 *
 * `01.02.03` is a date under `dd.MM.yy` and it is equally a version number, a
 * chapter number or a part number — and before this story such a column read as
 * `text`, so a *settled* date is a worse answer than the one it already had.
 * Two kinds of value settle it, and they are story 3's exclusive evidence in
 * both directions:
 *
 *   - a triple that **cannot** be a date under the pattern — `01.13.03`, where
 *     13 is no month — reads only as a version, and settles the column as text;
 *   - a triple whose **day is past twelve** — `31.12.25`, where 31 is no
 *     month — cannot be a triple of month-sized components, and settles it as
 *     a date. This is why the shape the owner actually asked for is unaffected.
 *
 * With neither, nothing in the column decides and the person does. Only values
 * of the triple shape are asked: a column carrying `demnächst` beside twenty
 * dates is still twenty dates and one unparsed value, exactly as story 3 counts
 * it — the version hypothesis needs version-shaped values to stand on.
 */
function shortYearVerdict(values, candidate) {
  const { separator } = candidate
  let decidesText = false
  let decidesDate = false

  for (const value of values) {
    if (!isTwoDigitTriple(value, separator)) continue
    if (!readsAsDate(value, candidate)) decidesText = true
    else if (Number(value.split(separator)[0]) > 12) decidesDate = true
  }

  if (decidesText) return TEXT
  if (decidesDate) return null
  return 'unresolved'
}

/** Split a column into the values that count and the ones the user declared
 *  missing. Shared so a re-score and a detection never disagree about which
 *  cells the hit rate is a share of. */
function sift(cells, missingTokens) {
  const tokens = Object.freeze([...(missingTokens ?? DEFAULT_MISSING)])
  const missingSet = new Set(tokens)

  const values = []
  let missing = 0
  for (const cell of cells) {
    const text = String(cell ?? '').trim()
    if (missingSet.has(text)) missing += 1
    else values.push(text)
  }
  return { tokens, values, missing }
}

/** The candidates a type offers, in the order a caller may present them.
 *  `time` and `duration` offer none: the question they raise is which of the two
 *  the column is, and that is answered with the type select, not a reading. */
export const candidatesFor = (type) =>
  type === NUMBER
    ? numberCandidates()
    : type === DATE
      ? DATE_PATTERNS
      : type === DATETIME
        ? DATETIME_PATTERNS
        : type === BOOLEAN
          ? BOOLEAN_PAIRS
          : []

/** Which reader a chosen type is scored with. The affix is not part of a format
 *  — a format answers which locale reads the digits, an affix answers what unit
 *  rides on the column — so a number reading is bound to the column's own affix
 *  here rather than carrying it. */
const readerFor = (type, affix) =>
  type === NUMBER
    ? (value, candidate) => readsAsNumber(value, candidate, affix)
    : type === DATE
      ? readsAsDate
      : type === DATETIME
        ? readsAsDateTime
        : type === BOOLEAN
          ? readsAsBoolean
          : type === TIME
            ? readsAsTime
            : type === DURATION
              ? readsAsDuration
              : null

/**
 * Every settable type this file cannot score a value against. Empty is the rule,
 * and a test asserts it.
 *
 * The sibling of `canonicalTypeGaps`, for the other half of the vocabulary.
 * Without it, a type added to the catalogue and forgotten here would fall
 * through `readerFor` to `null`, `scoreColumn` would count every value readable,
 * and the card would report a 100 % hit rate for a column nothing had read —
 * which is a rubber stamp with a number on it, and worse than a red test.
 */
export const scorableTypeGaps = () =>
  Object.freeze(
    TYPES.filter(
      (type) => type.settable && type.code !== TEXT && readerFor(type.code, null) === null,
    ).map((type) => type.code),
  )

/**
 * The best-scoring format for a type the user just chose.
 *
 * Handing over the first candidate instead would give every column switched to
 * `number` the German reading — and an Anglo column a collapsed hit rate with
 * nothing to say the other candidate scored better. The user asked for a type,
 * not for a reading; the reading is still ours to propose.
 */
export function bestFormat(cells, type, missingTokens) {
  const candidates = candidatesFor(type)
  if (candidates.length === 0) return null
  const { values } = sift(cells, missingTokens)
  const { affix } =
    type === NUMBER ? affixScan(values, candidates, marksPresent(values)) : { affix: null }
  return score(values, candidates, readerFor(type, affix))[0].candidate
}

/** Re-score a column under a type and format the user chose. The verdict is
 *  `settled` by construction: a person answered the question, so the column is
 *  no longer waiting on one. */
export function scoreColumn(cells, { type, format, missingTokens, domain }) {
  const { tokens, values, missing } = sift(cells, missingTokens)
  // Same three parts as detection reads, from the same place: a refused
  // declaration must not survive one route and be discarded on the other.
  const declaration = readDeclaration(domain)

  // The affix is re-derived rather than carried on the choice, for the same
  // reason it is not part of the format: it is a property of the values, and it
  // has to survive a user overriding the reading. Scanned against *every*
  // reading rather than the chosen one, or switching a percent column from
  // German to English digits would take the percent sign off it — under en-US
  // not one of those values parses, so the chosen reading alone would report
  // that the column carries no unit at all.
  const { affix } =
    type === NUMBER && format
      ? affixScan(values, numberCandidates(), marksPresent(values))
      : { affix: null }

  const reads = readerFor(type, affix)
  // A type with candidates and no chosen reading has nothing to score against,
  // so every value counts readable — the shape a native column arrives in.
  const scorable = reads !== null && (format != null || candidatesFor(type).length === 0)

  let parsed = values.length
  if (scorable) parsed = values.filter((value) => reads(value, format)).length

  return Object.freeze({
    type,
    format: format ?? null,
    counts: Object.freeze({
      total: cells.length,
      missing,
      parsed,
      unparsed: values.length - parsed,
    }),
    verdict: 'settled',
    evidence: null,
    missingTokens: tokens,
    domain: declaration.domain,
    refusedNativeType: declaration.refusedNativeType,
    affix,
    // Never here. A mixed-affix column is a *proposal* of `text` with a reason
    // attached, and the reason's own sentence says the column is read as text.
    // Carried through a re-score it outlived its condition: the user overrides
    // to `number`, the card shows `Zahl` and `Einheit: €`, and the warning
    // underneath still claimed text while the `$` values went unparsed with no
    // sentence of their own. A choice made is a question closed — what the
    // choice costs is the unparsed count, which is reported either way.
    mixedAffixes: null,
  })
}

/**
 * The typing of a whole table: one record per column, plus whether the mapping
 * has been confirmed (AD-29's first gate). Confirmation is state in core/exec,
 * never a UI flag, so a second caller cannot reach execution around it.
 */
export function detectTable(table) {
  return Object.freeze({
    columns: Object.freeze(
      table.columns.map((column) =>
        Object.freeze({
          name: column.name,
          annotation: '',
          chosen: null,
          ...detectColumn(column.cells, { domain: column.domain }),
        }),
      ),
    ),
    confirmed: false,
  })
}

/** The columns standing in the way of confirmation — those where two readings
 *  are equally good and the user has not picked one. Returned as names so the
 *  refusal can say which, rather than that something is wrong. */
export function unresolvedColumns(typing) {
  return Object.freeze(
    typing.columns.filter((c) => c.verdict === 'unresolved' && c.chosen === null).map((c) => c.name),
  )
}
