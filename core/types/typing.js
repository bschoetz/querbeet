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
//      changes; measured at the NFR-3 shape of 100,000 rows by 20 columns, it
//      is 991 ms rather than 1,499 ms.
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
  const { tokens: missingTokens, values, missing } = sift(cells, options.missingTokens)

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

  // Which readings this column could even distinguish. Everything below scores
  // against that set rather than against all nine candidates.
  const present = marksPresent(values)

  // One leading zero anywhere disqualifies the whole column: the zeros are the
  // information, and a column of article numbers is not half numeric (FR-9).
  const numbers = values.some(hasLeadingZero)
    ? []
    : score(values, numberReadings(present), readsAsNumber)
  const dates = score(
    values,
    DATE_PATTERNS.filter((p) => present.has(p.separator)),
    readsAsDate,
  )

  // Number and date are scored independently and the higher hit rate wins; a
  // tie goes to number. The two barely overlap in practice — `31.12.2025` has
  // two decimal marks under en-US and a two-digit group under de-DE, so it is
  // not a number under either reading — and where they do overlap, as in a
  // column of bare four-digit years, "number" is the reading that loses less if
  // it is wrong, because a year is a number and a number is not a date.
  const bestNumber = numbers[0]?.parsed ?? 0
  const bestDate = dates[0]?.parsed ?? 0
  const winner = bestDate > bestNumber ? { kind: DATE, hits: dates } : { kind: NUMBER, hits: numbers }
  const best = winner.hits[0]

  if (!best || best.parsed / values.length < PROPOSAL_THRESHOLD) return asText

  const runnerUp = winner.hits[1] ?? null

  // The ambiguity states. A runner-up that reads nothing is no contest at all;
  // a reading that reads more exclusively than the other is decisive and the
  // count is nameable; anything else is the state where nothing settles it, and
  // saying so is the whole point (FR-9).
  //
  // There is no case here for two readings that mean the same thing. That is
  // handled where it belongs and where it is also cheapest — `numberReadings`
  // never offers them as two, so there is no runner-up to argue with.
  let verdict = 'settled'
  let evidence = null

  if (runnerUp && runnerUp.parsed > 0) {
    const reads = winner.kind === DATE ? readsAsDate : readsAsNumber
    const { only, contested } = exclusive(values, best.candidate, runnerUp.candidate, reads)
    const alternatives = Object.freeze([keyOf(best.candidate), keyOf(runnerUp.candidate)])

    if (only > contested) {
      verdict = 'decisive'
      evidence = Object.freeze({ alternatives, decidedBy: only, contested })
    } else {
      verdict = 'unresolved'
      evidence = Object.freeze({ alternatives })
    }
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

/** The candidates a type offers, in the order a caller may present them. */
export const candidatesFor = (type) =>
  type === NUMBER ? numberCandidates() : type === DATE ? DATE_PATTERNS : []

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
  const reads = type === DATE ? readsAsDate : readsAsNumber
  return score(values, candidates, reads)[0].candidate
}

/** Re-score a column under a type and format the user chose. The verdict is
 *  `settled` by construction: a person answered the question, so the column is
 *  no longer waiting on one. */
export function scoreColumn(cells, { type, format, missingTokens, domain }) {
  const { tokens, values, missing } = sift(cells, missingTokens)

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
    domain: domain ?? TEXT,
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
