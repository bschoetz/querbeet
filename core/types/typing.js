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
//   2. THERE ARE TWO KINDS OF AMBIGUITY AND THEY ARE NOT THE SAME SENTENCE.
//      Either one reading carries decisive evidence and the count is nameable —
//      "47 values have a day above 12" — or every value parses under both
//      readings and *nothing in the column settles it*. No comparable tool
//      reports the second state: DuckDB documents a tie-break in which dd-mm
//      beats mm-dd silently. Here it is `unresolved`, the severity that exists
//      for exactly this, and a column in that state cannot be confirmed.
//
//   3. NOTHING HERE CONVERTS A VALUE. This module decides what a column *is*
//      and counts what would parse. Turning cells into numbers and UTC-midnight
//      epoch milliseconds happens on the way into a Table (AD-21, AD-22), in
//      story 6, because the raw text has to survive for the preview and the
//      damage report to keep reading it.
//
// Pure, framework-free, browser-free (AD-1, AD-2). `Intl` is a JS built-in of
// ECMA-402, not a browser API, and it is where the separators come from — a
// hand-written table of locale separators is the kind of thing that is wrong
// about a locale nobody on the team speaks.

export const TEXT = 'text'
export const NUMBER = 'number'
export const DATE = 'date'

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
  { pattern: 'dd/MM/yyyy', separator: '/', order: 'dmy' },
  { pattern: 'MM/dd/yyyy', separator: '/', order: 'mdy' },
  { pattern: 'dd-MM-yyyy', separator: '-', order: 'dmy' },
  { pattern: 'MM-dd-yyyy', separator: '-', order: 'mdy' },
  { pattern: 'yyyy-MM-dd', separator: '-', order: 'ymd' },
])

/** The date shapes on offer, for a caller that has to render a choice. */
export const dateCandidates = () => DATE_PATTERNS

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

const DIGITS = /^\d+$/

/** Does `text` read as a number under these separators? Grouping, if present,
 *  must be consistent — `1.23.456` is not a German number, and accepting it
 *  would let a malformed column look fully readable. */
function readsAsNumber(text, { group, decimal }) {
  let body = text
  if (body.startsWith('+') || body.startsWith('-')) body = body.slice(1)
  if (body === '') return false

  let integer = body
  if (decimal !== '') {
    const at = body.indexOf(decimal)
    if (at !== -1) {
      if (body.indexOf(decimal, at + 1) !== -1) return false // two decimal marks
      integer = body.slice(0, at)
      if (!DIGITS.test(body.slice(at + decimal.length))) return false
    }
  }

  if (integer === '') return false
  if (group !== '' && integer.includes(group)) {
    const parts = integer.split(group)
    if (parts.length < 2) return false
    if (!DIGITS.test(parts[0]) || parts[0].length === 0 || parts[0].length > 3) return false
    return parts.slice(1).every((p) => p.length === 3 && DIGITS.test(p))
  }
  return DIGITS.test(integer)
}

/** A leading zero is information — an article number, a postcode, a cost
 *  centre — and reading it as a number destroys it. FR-9: such a column stays
 *  text unless the user says otherwise. */
function hasLeadingZero(text) {
  const body = text.startsWith('+') || text.startsWith('-') ? text.slice(1) : text
  return /^0\d/.test(body)
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
 *  make two patterns agree on values that distinguish them. */
function readsAsDate(text, { separator, order }) {
  const parts = text.split(separator)
  if (parts.length !== 3) return false

  const widths = order === 'ymd' ? [4, 2, 2] : [2, 2, 4]
  for (let i = 0; i < 3; i += 1) {
    if (parts[i].length !== widths[i] || !DIGITS.test(parts[i])) return false
  }

  const [a, b, c] = parts.map(Number)
  if (order === 'ymd') return isRealDate(a, b, c)
  if (order === 'dmy') return isRealDate(c, b, a)
  return isRealDate(c, a, b)
}

/** How a candidate names itself when a sentence has to mention it. A date
 *  pattern names its shape; a number reading names its locale, because
 *  "de-DE against en-US" is a distinction a person can act on and
 *  "`.,` against `,.`" is not. */
const keyOf = (candidate) => candidate.pattern ?? candidate.locale

/**
 * Score every candidate of one kind over every non-missing value.
 *
 * `only` is the count of values this candidate reads that the runner-up does
 * not — the number FR-9 wants named ("47 values have a day above 12"). It is
 * computed against the runner-up rather than against all others, because that
 * is the comparison a sentence can carry.
 */
function score(values, candidates, reads) {
  const hits = candidates.map((candidate) => {
    const matched = []
    for (let i = 0; i < values.length; i += 1) if (reads(values[i], candidate)) matched.push(i)
    return { candidate, parsed: matched.length, matched: new Set(matched) }
  })
  hits.sort((a, b) => b.parsed - a.parsed || keyOf(a.candidate).localeCompare(keyOf(b.candidate)))
  return hits
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
  const domain = options.domain ?? TEXT
  const missingTokens = Object.freeze([...(options.missingTokens ?? DEFAULT_MISSING)])
  const missingSet = new Set(missingTokens)

  const values = []
  let missing = 0
  for (const cell of cells) {
    const text = String(cell ?? '').trim()
    if (missingSet.has(text)) missing += 1
    else values.push(text)
  }

  const counts = (parsed) =>
    Object.freeze({ total: cells.length, missing, parsed, unparsed: values.length - parsed })

  const asText = Object.freeze({
    type: TEXT,
    format: null,
    counts: counts(values.length),
    verdict: 'settled',
    evidence: null,
    missingTokens,
    domain,
  })

  // AD-20: a natively typed column arrives already decided. Inferring a locale
  // for it would be inventing a question the format already answered.
  if (domain.startsWith('native:')) {
    return Object.freeze({ ...asText, type: domain.slice('native:'.length), format: null })
  }

  if (values.length === 0) return asText

  // One leading zero anywhere disqualifies the whole column: the zeros are the
  // information, and a column of article numbers is not half numeric (FR-9).
  const numbers = values.some(hasLeadingZero) ? [] : score(values, numberCandidates(), readsAsNumber)
  const dates = score(values, DATE_PATTERNS, readsAsDate)

  const bestNumber = numbers[0]?.parsed ?? 0
  const bestDate = dates[0]?.parsed ?? 0
  const winner = bestDate > bestNumber ? { kind: DATE, hits: dates } : { kind: NUMBER, hits: numbers }
  const best = winner.hits[0]

  if (!best || best.parsed / values.length < PROPOSAL_THRESHOLD) return asText

  const runnerUp = winner.hits[1] ?? null
  const only = runnerUp ? [...best.matched].filter((i) => !runnerUp.matched.has(i)).length : 0

  // The two ambiguity states. A runner-up that reads exactly as much as the
  // winner, with nothing distinguishing them, is the state that has no winner —
  // and saying so is the whole point (FR-9).
  let verdict = 'settled'
  let evidence = null
  if (runnerUp && runnerUp.parsed === best.parsed && only === 0) {
    verdict = 'unresolved'
    evidence = Object.freeze({
      alternatives: Object.freeze([keyOf(best.candidate), keyOf(runnerUp.candidate)]),
    })
  } else if (runnerUp && runnerUp.parsed > 0) {
    verdict = 'decisive'
    evidence = Object.freeze({
      alternatives: Object.freeze([keyOf(best.candidate), keyOf(runnerUp.candidate)]),
      decidedBy: only,
    })
  }

  return Object.freeze({
    type: winner.kind,
    format: best.candidate,
    counts: counts(best.parsed),
    verdict,
    evidence,
    missingTokens,
    domain,
  })
}

/** Re-score a column under a type and format the user chose. The verdict is
 *  `settled` by construction: a person answered the question, so the column is
 *  no longer waiting on one. */
export function scoreColumn(cells, { type, format, missingTokens }) {
  const tokens = Object.freeze([...(missingTokens ?? DEFAULT_MISSING)])
  const missingSet = new Set(tokens)

  const values = []
  let missing = 0
  for (const cell of cells) {
    const text = String(cell ?? '').trim()
    if (missingSet.has(text)) missing += 1
    else values.push(text)
  }

  let parsed = values.length
  if (type === NUMBER && format) parsed = values.filter((v) => readsAsNumber(v, format)).length
  else if (type === DATE && format) parsed = values.filter((v) => readsAsDate(v, format)).length

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
    domain: TEXT,
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
