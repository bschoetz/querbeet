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
//      walks to the end.
//
//      The 2026-08-03 amendments cost another **~1.3×** on top, and this one is
//      isolated rather than inferred: measured at the same shape on a
//      report-shaped column mix, 4.75–4.96 s before against 5.97–6.41 s after,
//      and a variant with the five new two-digit date patterns removed is back
//      at 4.75 s while a variant without the always-scored ISO candidate is
//      unchanged at 6.24 s. The mirrors are the whole of it: `marksPresent`
//      narrows date candidates by separator, but the count on each separator
//      grew, and it grew by a different amount on each — **`.` from three to
//      four, `/` from two to four, `-` from three to five**, and `-` again to
//      **six** when `yy-MM-dd` joined. "Four where it scored three" was true of
//      the dot alone and was written as if it were true of all three, which
//      understated the slash by half.
//
//      Story 4b's month-name candidate cost **about +4.5 %** on top: measured on
//      the same Mix A at the same shape, four paired runs in alternating order,
//      best of three per run — **2.40/2.40/2.45/2.42 s before against
//      2.52/2.52/2.54/2.54 s after**. Re-measured after review round 1 moved the
//      four-digit year test to the front of `readsAsMonthNameDate`, which was
//      expected to buy back the three lowercasings an ordinary text value used
//      to pay: **2.39/2.39/2.41/2.38 against 2.50/2.49/2.52/2.53, +4.9 %** — the
//      same figure within the noise of two runs, so the reorder is a
//      readability and worst-case win rather than a measurable one, and it is
//      recorded that way rather than claimed. It is one candidate on a separator no date
//      pattern used before, so `MARKS` grew from eight marks to **nine** (`. / -
//      ,` plus `: % € $` plus the space) and the space is present in almost every
//      report column, which is why a single candidate costs nearly twice what the
//      `yy-MM-dd` one did (+2.5 %) — that one rode a separator three patterns
//      already narrowed on. The cost is per candidate per column it is *not*
//      skipped on, and a space is the mark an ordinary column is least likely to
//      lack. It is deliberately **not** optimised here: the project
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

/** The languages a date written with a month name may be written in, under the
 *  same rule `NUMBER_LOCALES` follows: **a locale enters with a Source that
 *  needs it.** The Source that opened this gate is a Microsoft 365 security
 *  export carrying `2. Aug. 2026` and `31. Juli 2026`, which is de-DE — and
 *  English is here from the start because the same portals ship both, so an
 *  English column would otherwise be text on the very next export.
 *
 *  `en-US` and `en-GB` are two locales rather than one because CLDR abbreviates
 *  September differently in each: `Sep` against `Sept`. That single disagreement
 *  is what forces a *set* of accepted spellings per month below, and it is
 *  measured today rather than feared for tomorrow.
 *
 *  Exported beside `MONTH_WIDTHS`: the two are the *axes* the frozen fixture
 *  claims to pin, and a fixture that names an axis only in a comment cannot fail
 *  when the derivation quietly drops one. */
export const MONTH_LOCALES = Object.freeze(['de-DE', 'en-US', 'en-GB'])

/**
 * A candidate list is a rule, and a rule is not a place to keep mutable state.
 *
 * `Object.freeze` on the array alone freezes the array: the entries stay
 * writable, and every one of these lists is *exported* — through
 * `dateCandidates` and `candidatesFor`, so a caller that only meant to render a
 * reading select holds a writable copy of the rule. Measured before this was
 * added: `dateCandidates()[2].preferred = false` flipped `['31.12.25',
 * '01.03.26']` from `decisive` to `unresolved` for the rest of the process. The
 * list is also where `preferred` lives *because* "there is no second list", so a
 * writable list is that argument's one hole. Deep, because a candidate carries a
 * nested `date` object and freezing the outside of that is the same hole one
 * level down.
 */
function freezeDeep(value) {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value)) freezeDeep(value[key])
  return Object.freeze(value)
}

// ------------------------------------------------------------- month names
//
// The month table is DERIVED, never written down — the same discipline
// `numberCandidates` applies to separators, for the same reason: a hand-written
// calendar is the kind of thing that is wrong about a language nobody on the
// team speaks. Three parts of the derivation are load-bearing and each was
// measured rather than assumed (spike `intl-month-names-2026-08-03`).
//
//   1. FORMAT CONTEXT IS THE SOURCE OF TRUTH; STANDALONE IS A SECOND ACCEPTED
//      VOCABULARY. The shape a locale actually *writes* comes from
//      `formatToParts` of a whole date, never from
//      `Intl.DateTimeFormat(locale, { month })` on its own. Measured in German
//      short, **eleven of twelve entries differ** — `Jan. Feb. März Apr. Mai
//      Juni Juli Aug. Sept. Okt. Nov. Dez.` in a date against `Jan Feb Mär Apr
//      Mai Jun Jul Aug Sep Okt Nov Dez` standalone; only `Mai` coincides. A
//      table built from standalone ALONE is not slightly wrong, it is wrong
//      nearly everywhere, and it misses both of the values the owner's Source
//      actually carries. **That finding is unchanged and this paragraph is not
//      its reversal.**
//
//      What the standalone axis adds is what an *exporter* may write, which is
//      a different question from what a locale formats. Measured 2026-08-03
//      over all three locales × both widths: adding it contributes **exactly
//      one** spelling — `Mär` — and **zero** collisions, taking the union from
//      34 to 35. Every other German standalone name already arrived, either
//      through the dropped trailing point (`Okt` ≡ `Okt.`) or through the
//      English vocabulary (`Jun`, `Jul`, `Sep`, `Mar`). So this is the same move
//      as rule 3 below — a *set* of accepted spellings rather than one exact
//      string — one axis further out, and it is emphatically not the easy table
//      being let back in as the source of truth. The day trailer is the line
//      that proves it: it stays format-context only, because a standalone
//      formatter has no day part to trail (see `dayTrailerOf`).
//
//   2. `timeZone: 'UTC'` IS PART OF THE DERIVATION. Without it the formatter
//      uses the machine's zone, a run in a negative offset shifts the day, and
//      at a month edge the month with it — which would make this table a
//      property of where the runner stood rather than of the engine's ICU.
//
//   3. A SET OF SPELLINGS PER MONTH, NOT ONE STRING. Forced by the locales
//      already in scope and independently of any future ICU drift: en-US
//      abbreviates September to `Sep`, en-GB to `Sept`, and German writes
//      `Sept.` — three spellings of one month. Normalization is case-folding
//      plus a dropped trailing point, so an exporter writing `AUG` where CLDR
//      says `Aug.` is not a second vocabulary. Measured across all three
//      locales, both widths and both contexts: **35 distinct normalized
//      spellings, 0 collisions**, which is what makes ONE union candidate sound
//      instead of a reading select nobody could answer.
//
// The runtime table follows the engine, which is right. `month-names.frozen.js`
// is the 2026-08-03 measurement committed as a literal, and the test compares
// the two — so an ICU change is a failing test naming the month and both
// spellings, rather than a column that silently falls back to text.

/** Both CLDR widths. `Sept.` has four letters, so "abbreviated" is not "three
 *  letters" and the two widths are two vocabularies, not one plus a prefix.
 *
 *  Exported beside `MONTH_LOCALES` because the two are the *axes* of the
 *  derivation, and the frozen fixture claims to pin them: a table that matched
 *  spelling for spelling while an axis had quietly been dropped would pass a
 *  comparison against a fixture that named the axis only in a comment. */
export const MONTH_WIDTHS = Object.freeze(['short', 'long'])

/**
 * The two contexts a month name is asked for in, and they are not equals.
 *
 * `format` is the name inside a whole date and is what a locale actually
 * *writes* — it is the source of truth for the shape, and for the day's trailing
 * literal, which only it can answer. `standalone` is the name on its own, and it
 * is here as a second **accepted** vocabulary: an exporter may write `2. Mär.
 * 2026` although no German formatter produces `Mär` in a date.
 *
 * Measured before it was added: over all three locales and both widths the
 * standalone context contributes exactly one spelling (`Mär`) and no collision,
 * 34 → 35. Everything else it could contribute already arrives through the
 * dropped trailing point or through English.
 *
 * The third exported axis, for the reason the other two are exported: the frozen
 * fixture claims to pin the shape of the derivation, and an axis it names only
 * in a comment is an axis the derivation can drop in silence.
 */
export const MONTH_CONTEXTS = Object.freeze(['format', 'standalone'])

/** The formatter options one context asks for. `format` carries `day` and
 *  `year` because the name it wants is the one that stands in a whole date;
 *  `standalone` carries neither, which is exactly what makes it standalone —
 *  and is why `dayTrailerOf` can find nothing in it. */
const monthFormatOptions = (context, width) =>
  context === 'format'
    ? { day: 'numeric', month: width, year: 'numeric', timeZone: 'UTC' }
    : { month: width, timeZone: 'UTC' }

/** Case-fold, then drop one trailing point. CLDR abbreviates only the *long*
 *  names, so `Jan. Feb. Apr. Aug. Sept. Okt. Nov. Dez.` carry a point while
 *  `März Mai Juni Juli` stand in full without one — and an exporter that
 *  upper-cases its headers or loses the point has not invented a new month.
 *
 *  **Exported because the dropped point was measured to be unobservable.**
 *  Deleting `.replace(/\.$/, '')` once left the whole suite green: every case
 *  that exercised the normalization used a month with an undotted English twin
 *  (`Aug.` beside `Aug`), so the rule was never load-bearing where it was
 *  tested, while `2. Okt 2026` and `2. Dez 2026` had quietly stopped reading. A
 *  test now walks every derived spelling through this function rather than
 *  re-implementing it, because a local copy in a test is a second rule that
 *  agrees with the first until someone edits one of them.
 *
 *  **What the rule carries alone moved when the standalone axis landed, and it
 *  is worth saying so rather than leaving the old sentence to rot.** `Okt` and
 *  `Dez` are now derived spellings in their own right, so the point-dropping is
 *  no longer what rescues them. What it carries alone today is the other
 *  direction: an exporter writing a point on a spelling CLDR gives without one —
 *  `2. Mär. 2026`, which is exactly what a German export does with a standalone
 *  abbreviation — and that is the case that fails when the rule is deleted. */
export const normalizeMonthToken = (token) => token.toLocaleLowerCase('de-DE').replace(/\.$/, '')

/**
 * The mark that follows the day, trimmed — `". "` for de-DE gives `.`, `", "`
 * for en-US gives `,`, and en-GB's `" "` gives nothing at all.
 *
 * Derived for the same reason the names are: writing those two punctuation marks
 * by hand would be the hand-written table one screen up, one field over.
 *
 * **It answers `null` for a standalone formatter, and that is structural rather
 * than remembered.** A standalone formatter is `{ month, timeZone }` — it has no
 * `day` part at all, so "what follows the day" is a question it cannot answer,
 * and the function says so by *looking for the part* rather than by a caller
 * knowing which context it is in. The loop below therefore calls it on every
 * formatter and the standalone axis contributes no trailer by construction. The
 * distinction matters: the standalone context is an accepted *vocabulary*, not a
 * second source of truth for the shape a locale writes.
 *
 * **The explicit `dayAt === -1` line is refused twice over, and it is kept as a
 * statement rather than deleted to reach coverage** — the same treatment two
 * branches in `readsAsMonthNameDate` got, and measured the same way. A standalone
 * formatter under these options emits exactly one part, the month, so there is
 * no `literal` anywhere in it to mistake for a trailer: strike the line and the
 * function still answers `null`, and the whole suite stays green. What is
 * genuinely load-bearing is the `findIndex` above it, and what makes *both* safe
 * is a property of `Intl`'s output rather than of this code — which is precisely
 * why the line is written down. The day these options gain a field, "the part
 * after index 0" and "the part after the day" stop being the same part.
 */
function dayTrailerOf(format) {
  const parts = format.formatToParts(new Date(Date.UTC(2026, 7, 2)))
  const dayAt = parts.findIndex((part) => part.type === 'day')
  if (dayAt === -1) return null

  const after = parts[dayAt + 1]
  const trailer = after?.type === 'literal' ? after.value.trim() : ''
  return trailer === '' ? null : trailer
}

/**
 * Ask `Intl` for the month names, the day's trailing literal, and whether the
 * engine actually had each locale.
 *
 * Over three axes — locale, width, and context — because a month name is asked
 * for in two contexts and an exporter may write either. `format` is the source
 * of truth for the shape; `standalone` is a second accepted vocabulary worth
 * exactly one spelling (`Mär`) and no collision. See `MONTH_CONTEXTS`.
 *
 * A locale the engine falls back on is the one failure worth being loud about:
 * it hands back an English table under a German tag, and every value in it looks
 * plausible and is wrong. `resolvedOptions().locale` is therefore checked per
 * formatter — all twelve of them — and a mismatch is *collected* rather than
 * thrown, the same empty-is-the-rule shape `canonicalTypeGaps` has, so it fails
 * a test instead of a user's file read.
 */
function deriveMonthNames(locales = MONTH_LOCALES) {
  const spellings = Array.from({ length: 12 }, () => [])
  const byName = new Map()
  const collisions = []
  const fallbacks = []
  const dayTrailers = new Set()

  for (const locale of locales) {
    for (const width of MONTH_WIDTHS) {
      for (const context of MONTH_CONTEXTS) {
        const format = new Intl.DateTimeFormat(locale, monthFormatOptions(context, width))
        if (format.resolvedOptions().locale !== locale) {
          fallbacks.push(`${locale}/${width}/${context}`)
          continue
        }

        const trailer = dayTrailerOf(format)
        if (trailer !== null) dayTrailers.add(trailer)

        for (let month = 0; month < 12; month += 1) {
          // The 15th, so no zone or calendar edge can move the month even if the
          // `timeZone` above were ever dropped by a careless edit.
          const named = format
            .formatToParts(new Date(Date.UTC(2026, month, 15)))
            .find((part) => part.type === 'month')?.value
          if (named === undefined) continue

          if (!spellings[month].includes(named)) spellings[month].push(named)

          const key = normalizeMonthToken(named)
          const seen = byName.get(key)
          if (seen === undefined) byName.set(key, month + 1)
          else if (seen !== month + 1) collisions.push({ spelling: key, months: [seen, month + 1] })
        }
      }
    }
  }

  // `byName` and `dayTrailers` are built as a `Map` and a `Set` because that is
  // what building them wants, and neither survives this return in that form.
  // `MONTHS` is module state, and `Object.freeze` does nothing to a `Map` —
  // `.set` still works on a frozen one — so handing those two back raw would be
  // exactly the hole `freezeDeep`'s docblock exists for, one screen up, whose
  // own measured example is a mutated rule flipping a column's verdict. The
  // lookup becomes a **null-prototype** frozen object rather than a plain one so
  // a month spelled `constructor` or `toString` cannot inherit an answer.
  const lookup = Object.create(null)
  for (const [key, month] of byName) lookup[key] = month

  return Object.freeze({
    spellings: freezeDeep(spellings),
    byName: Object.freeze(lookup),
    collisions: freezeDeep(collisions),
    fallbacks: freezeDeep(fallbacks),
    dayTrailers: freezeDeep([...dayTrailers]),
  })
}

const MONTHS = deriveMonthNames()

/** Every accepted spelling per month, in derivation order — locale by locale,
 *  short before long, each raw CLDR string once. This is what the frozen fixture
 *  is compared against, and exporting it is what makes that comparison possible
 *  without a second derivation to disagree with the first. */
export const monthNameSpellings = () => MONTHS.spellings

/** All-numeric date shapes, and — since 2026-08-03 — one shape written with a
 *  month name. Month names were "deliberately absent" here on the rule this file
 *  states, that a calendar enters with the Source that needs it; that Source
 *  arrived (a Microsoft 365 security export carrying `2. Aug. 2026` and
 *  `31. Juli 2026`), so the gate opened rather than the rule breaking.
 *
 *  Its month table is **derived from `Intl` in format context** — `formatToParts`
 *  of a whole date, never `{ month: 'short' }` standalone — and that is not a
 *  refinement: measured in German short, eleven of twelve entries differ between
 *  the two, and only `Mai` coincides. A table built the easy way misses both of
 *  the values the Source above actually carries. The derivation and its two
 *  other load-bearing details are one screen up.
 *
 *  It is **one** candidate over the union of both vocabularies and all three
 *  orderings, not three and not a reading select: the month name's position
 *  inside a value identifies that value's shape, and the union was measured to
 *  hold 34 spellings with 0 collisions, so no value reads as two different
 *  dates. An ambiguity between readings that mean the same thing is not an
 *  ambiguity, and here there is not even that.
 *
 *  Its `separator` is `' '`, and that is true of the shape rather than a trick:
 *  all three orderings are exactly three space-separated tokens. It also buys
 *  the narrowing for free, because `MARKS` is derived from these separators and
 *  a column with no space never scores the candidate at all.
 *
 *  **One rule in that candidate is hand-written, and it is the English ordinal
 *  suffix** (`Aug 2nd, 2026`). `Intl` emits none — measured over 2,016 rendered
 *  values per engine in three engines — so it cannot be derived from anything,
 *  and it is here because the project owner decided on 2026-08-03 that exporters
 *  write it. It is marked as such where it is read (`readsAsDayToken`); nothing
 *  else in this table is written by hand.
 *
 *  Every dmy and mdy pattern has its two-digit mirror, and that symmetry is the
 *  rule rather than a convenience: six four-digit patterns against one two-digit
 *  one was the century rule reaching German dot dates and nothing else, which is
 *  a separator deciding whether a rule applies. `yyyy-MM-dd` has its mirror too,
 *  `yy-MM-dd`, and dash-only — see `expandTwoDigitYear`. **The month-name
 *  candidate has none, deliberately:** `Intl` with `year: 'numeric'` produces no
 *  two-digit year at all, so `2. Aug. 26` has no derivation behind it and would
 *  reopen the century question where no Source has shown it. Ledger entry.
 *
 *  **`preferred` is the two-digit tie-break, and it lives on the list rather
 *  than in the code that reads it.** With both orders mirrored, `31.12.25` and
 *  `01.13.03` became the same shape: a date under exactly one part order and
 *  nonsense under the other. Nothing in the values tells a German date from a
 *  padded part number, because there is nothing there to tell them apart — so
 *  the tie-break is a *declared preference*, the same shape as the cross-kind
 *  rule that a tie goes to the kind declared first. `dmy` is the declared
 *  preference: the three patterns carrying the flag settle their columns as
 *  they always did, and a column whose only date reading is an mdy mirror is
 *  asked about instead of typed — see `shortYearVerdict`.
 *
 *  Only the two-digit mirrors carry it, and that is the whole point. At four
 *  digits a part of `2025` is a year and nothing else, so `03.04.2025` raises an
 *  ordering question the user is *shown* and answers on the reading select;
 *  three two-digit parts raise a kind question in front of it, and the reading
 *  select is suppressed while that one is open. A preference is needed exactly
 *  where the question cannot be asked. `yy-MM-dd` does **not** carry it: it is a
 *  mirror owed to a four-digit pattern, not a declared preference, so a column
 *  whose only reading is `yy-MM-dd` is the kind question like any other
 *  non-preferred two-digit reading. */
const DATE_PATTERNS = freezeDeep([
  { pattern: 'dd.MM.yyyy', separator: '.', order: 'dmy' },
  { pattern: 'MM.dd.yyyy', separator: '.', order: 'mdy' },
  { pattern: 'dd.MM.yy', separator: '.', order: 'dmy', shortYear: true, preferred: true },
  { pattern: 'MM.dd.yy', separator: '.', order: 'mdy', shortYear: true },
  { pattern: 'dd/MM/yyyy', separator: '/', order: 'dmy' },
  { pattern: 'MM/dd/yyyy', separator: '/', order: 'mdy' },
  { pattern: 'dd/MM/yy', separator: '/', order: 'dmy', shortYear: true, preferred: true },
  { pattern: 'MM/dd/yy', separator: '/', order: 'mdy', shortYear: true },
  { pattern: 'dd-MM-yyyy', separator: '-', order: 'dmy' },
  { pattern: 'MM-dd-yyyy', separator: '-', order: 'mdy' },
  { pattern: 'dd-MM-yy', separator: '-', order: 'dmy', shortYear: true, preferred: true },
  { pattern: 'MM-dd-yy', separator: '-', order: 'mdy', shortYear: true },
  { pattern: 'yyyy-MM-dd', separator: '-', order: 'ymd' },
  { pattern: 'yy-MM-dd', separator: '-', order: 'ymd', shortYear: true },
  // The one candidate that is not spelled in field letters, because it is not
  // one ordering: `2. Aug. 2026`, `Aug 2, 2026` and `2 Aug 2026` all read here,
  // and which of the three a value is comes from where its month name stands.
  // It carries **no `order`** on purpose — an order is what a numeric pattern
  // needs to say which digits are which, and this candidate reads that off the
  // value itself. Two invariants over `DATE_PATTERNS` are scoped to candidates
  // that carry one, each with its reason at the test.
  { pattern: 'month name', separator: ' ', monthName: true },
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
 *
 * It applies to the two-digit mirror of **every** four-digit pattern, on all
 * three separators, `yyyy-MM-dd` included: its mirror is `yy-MM-dd`.
 *
 * The argument that first excluded that one was exactly backwards, and it is
 * worth keeping the correction where the rule is. It said `yy-MM-dd` and
 * `dd-MM-yy` are the same six characters in the same three groups, so admitting
 * it would make a dash column ambiguous three ways over a shape no exporter
 * writes. Measured on the tree that shipped without it, `['25-12-31',
 * '25-01-15', '25-06-30']` read as `date` / `dd-MM-yy` / **`settled`** — 25
 * December **1931** — because `25` exceeds twelve and was therefore taken as
 * decisive *day* evidence while `MM-dd-yy` read nothing and left no runner-up to
 * argue with. Refusing the candidate did not make a truncated ISO date
 * unreadable; it made it readable *as the wrong thing*, with no question raised
 * and the gate open. Ambiguity was never the danger — it is the correct answer,
 * and story 3 built the machinery to report it.
 *
 * The mirror is dash-only because `yyyy-MM-dd` is: a mirror is owed to a
 * four-digit pattern that exists, and `yy/MM/dd` would be a new candidate rather
 * than a reflection of one. The residue that leaves is `25/12/31`, which reads
 * as `dd/MM/yy` and settles; it has a ledger entry.
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
 * ISO 8601**: lowercase `t` and `z`, a comma decimal, a two-digit offset,
 * end-of-day `24:00` and the basic format `20251231T1430` are all in the
 * standard. Naming a strict subset after it puts the same lie in the reading
 * select that spelling it `yyyy-MM-dd'T'HH:mm:ss` would. **Week dates
 * (`2025-W01-1`) are not residue — they were cut before this story**, with the
 * reason that a week is a period label rather than an instant, so it belongs to
 * whatever story first groups by period. That decision stands and is not
 * reopened by the sentence above; the standard is wide, the scope is not.
 * Ordinal dates (`2025-001`) were never weighed either way and are the one real
 * residue, with an entry: they are a day count into a year, which this file
 * already knows how to bound, but nothing here converts one.
 */
const DATETIME_PATTERNS = freezeDeep([
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
const BOOLEAN_PAIRS = freezeDeep([
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
const CLOCK_CANDIDATES = freezeDeep([{ type: TIME }, { type: DURATION }])

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
 * leave this list behind and silently disable the narrowing below. Story 4b is
 * the proof that this is worth being derived: its month-name candidate declares
 * `separator: ' '`, and the space joined this list and started narrowing the new
 * candidate **with no edit here at all**. The space is also the one mark an
 * ordinary report column is least likely to lack, which is why that one
 * candidate cost more than the previous one did — see the module header.
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
 * **`accounting` is the column's permission for the two accounting spellings,
 * and only for them.** `(1)` is a footnote marker and `4711-` is an ERP part
 * number, and read as signs both become settled, fully-readable negative numbers
 * — a *wrong* number, which is the one defect named above. So the parenthesis
 * and the trailing minus count as signs only where the column vouches for them
 * (see `carriesAccountingEvidence`); without that they stay in the body and the
 * value is not a number at all. The ordinary leading `-` is unaffected: `-500`
 * is not an accounting form and needs no column to vouch for it.
 *
 * It terminates: every branch either shortens the body or claims the one affix,
 * and the affix can be claimed once.
 */
function peelWrappers(text, accounting) {
  let body = text
  let affix = null
  let negative = false
  let marks = 0

  for (;;) {
    if (accounting && body.length >= 2 && body.startsWith('(') && body.endsWith(')')) {
      body = body.slice(1, -1)
      negative = true
      marks += 1
      continue
    }
    if (accounting && body.length >= 2 && body.endsWith('-')) {
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
 * Does this column vouch for the two accounting spellings, under this reading?
 *
 * The parenthesis and the trailing minus are the one rule in this file that can
 * produce a *wrong* number rather than an unread one, so — like the leading-zero
 * guard and the overflow guard — it is answered by the whole column and not by
 * one value. The evidence asked for is a decimal or grouping mark somewhere in
 * the column **under the candidate being scored**: a column carrying `1.234,56`
 * is money, a column of `(1)`, `(2)`, `(3)` is footnote markers, and `4711-` is
 * an ERP part number. What it costs is named in the Boundaries rather than
 * discovered: `(500)` and `(750)` with nothing else beside them are `text`.
 *
 * `present` is the column's mark set from `marksPresent`, which is the same
 * route the column's one `affix` travels — column-level state reaches the
 * per-value reader as an argument, never as a flag this module holds.
 */
const carriesAccountingEvidence = (present, { group, decimal }) =>
  (group !== '' && present.has(group)) || (decimal !== '' && present.has(decimal))

/**
 * The one number reading rule: the wrappers outside, the digits at the centre.
 *
 * Returns `{ digits, fraction, negative }`, or `null` where the value is not a
 * number under this reading. `digits` is the **integer** part with the grouping
 * removed — which is what the overflow guard compares, digit by digit;
 * `fraction` is the digits after the decimal mark, `''` where there are none;
 * `negative` is the sign, in all three spellings that say it. The three together
 * are the value: `12,5` and `12` are different returns, and so are `0,5` and
 * `0`, which is what story 6 needs to rebuild a cell without asking this file's
 * question a second time.
 *
 * Grouping, if present, must be consistent: `1.23.456` is not a German number,
 * and accepting it would let a malformed column look fully readable.
 *
 * The two arguments after the reading are the *column's*, not the value's, and
 * both must be the ones detection used or a re-read will disagree with the count
 * the user confirmed. `affix` is the affix the column carries, and every parsed
 * value must carry it: a bare number in a percent column counts unparsed rather
 * than quietly joining a column of percentages. `accounting` is the column's
 * permission for `(1.234,56)` and `1.234,56-` (see `carriesAccountingEvidence`),
 * and it defaults to **off** — a caller with no column behind it gets the
 * reading that cannot invent a negative.
 *
 * **Exported for story 6**, which converts a confirmed column into a Table and
 * must read every value exactly as detection counted it. A second parser there
 * would be a second opinion about what `(1.234,56)` means, and the first thing
 * it would get wrong is the sign.
 */
export function numberParts(text, { group, decimal }, affix = null, accounting = false) {
  const peeled = peelWrappers(text, accounting)
  if (peeled === null || peeled.affix !== affix) return null

  const body = peeled.body
  if (body === '') return null

  let integer = body
  let fraction = ''
  if (decimal !== '') {
    const at = body.indexOf(decimal)
    if (at !== -1) {
      if (body.indexOf(decimal, at + 1) !== -1) return null // two decimal marks
      integer = body.slice(0, at)
      fraction = body.slice(at + decimal.length)
      if (!DIGITS.test(fraction)) return null
    }
  }

  if (integer === '') return null
  if (group !== '' && integer.includes(group)) {
    const parts = integer.split(group)
    if (parts.length < 2) return null
    if (!DIGITS.test(parts[0]) || parts[0].length === 0 || parts[0].length > 3) return null
    if (!parts.slice(1).every((p) => p.length === 3 && DIGITS.test(p))) return null
    return { digits: parts.join(''), fraction, negative: peeled.negative }
  }
  return DIGITS.test(integer) ? { digits: integer, fraction, negative: peeled.negative } : null
}

/** Does `text` read as a number under these separators, this affix and this
 *  column's accounting permission? */
const readsAsNumber = (text, candidate, affix = null, accounting = false) =>
  numberParts(text, candidate, affix, accounting) !== null

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
 *  `(0123)` and `0123 €` are the same finding as a bare `0123` — and through the
 *  accounting spellings whether or not the column vouches for them, because this
 *  is a guard looking for hidden zeros rather than a reading looking for a
 *  number: peeling less here would only hide the zeros deeper. */
function hasLeadingZero(text) {
  const peeled = peelWrappers(text, true)
  return /^0\d/.test(peeled === null ? text : peeled.body)
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const max = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]
  return day <= max
}

/** Exactly four digits — a year written beside a month name, and the only width
 *  `Intl` produces there. */
const FOUR_DIGITS = /^\d{4}$/

/**
 * The day token of a month-name date: one or two digits, then two optional
 * things, then nothing else.
 *
 * The trailing character is the literal `formatToParts` puts after the day —
 * `.` for de-DE, `,` for en-US, nothing for en-GB — and it is checked against
 * the derived set rather than against a pair of punctuation marks written here.
 *
 * **`st|nd|rd|th` is the one hand-written rule in this whole table, and it is
 * the project owner's decision of 2026-08-03.** `Intl` emits no ordinal suffix —
 * measured, 2,016 rendered values per engine, three engines, none — so no
 * derivation can produce it and it is here because exporters write `Aug 2nd,
 * 2026`. It is stripped and deliberately **not** checked against the digits: it
 * carries nothing the digits do not, so `2th` reads as the 2nd and no wrong date
 * can come of it. Validating it would be a second spelling rule for an English
 * suffix, which is a rule about English and not about dates.
 */
const DAY_TOKEN = /^(\d{1,2})(?:st|nd|rd|th)?(.)?$/i

function readsAsDayToken(token) {
  const match = DAY_TOKEN.exec(token)
  if (match === null) return null
  if (match[2] !== undefined && !MONTHS.dayTrailers.includes(match[2])) return null
  return Number(match[1])
}

/**
 * Three space-separated tokens, exactly one of which is a month name.
 *
 * The month's position is what identifies the shape, and it is the whole reason
 * this is one candidate rather than three: `Aug 2, 2026` puts it first and is
 * month-day-year, `2. Aug. 2026` and `2 Aug 2026` put it second and are
 * day-month-year. **Position 2 is refused** — no locale in scope writes
 * `2 2026 Aug`, so admitting it would be inventing a shape rather than reading
 * one. **Two month names in one value is refused too** (`Mai Juni 2026`).
 *
 * Both of those refusals were **measured to be redundant, and both are kept as
 * statements rather than deleted to reach coverage.** With three tokens, a month
 * name at position 2 leaves a month name where the four-digit year test looks,
 * and a second month name always lands in the day slot or the year slot; either
 * way the token tests below refuse the value a second time, so a mutation
 * removing either line passes the whole suite. They stay because the rule they
 * state is the candidate's *contract* — the year is the last token, the month is
 * one of the first two — and the day the year test is widened (a two-digit year
 * has a ledger entry) is the day that contract stops being implied and starts
 * being load-bearing. This is the same treatment `readsAsDate`'s `ymd` +
 * `shortYear` branch got through the rounds it was unreachable.
 *
 * Story 4a's width strictness does not bind here: it exists so two *numeric*
 * patterns cannot agree on the values that distinguish them, and a month name
 * has no competing pattern, so a one- or two-digit day is safe.
 *
 * What the permissiveness costs, named rather than discovered: `2nd. Aug. 2026`
 * reads, and no exporter writes it. Refusing it would cost a rule and buy no
 * correctness, because the date it yields is right either way.
 */
function readsAsMonthNameDate(parts) {
  // The year test stands first because it is the cheapest thing that can refuse
  // a value, and this candidate is scored on every column carrying a space —
  // which is nearly every text column in a report. One regex against the last
  // token rejects `Anna Meier Schmidt` before three lowercasings and three map
  // lookups are paid for it.
  if (!FOUR_DIGITS.test(parts[2])) return false

  let monthAt = -1
  let month = 0
  for (let i = 0; i < 3; i += 1) {
    const found = MONTHS.byName[normalizeMonthToken(parts[i])]
    if (found === undefined) continue
    if (monthAt !== -1) return false
    monthAt = i
    month = found
  }
  if (monthAt !== 0 && monthAt !== 1) return false

  const day = readsAsDayToken(parts[monthAt === 0 ? 1 : 0])
  if (day === null) return false

  return isRealDate(Number(parts[2]), month, day)
}

/** Does `text` read as a date under this pattern? Deliberately strict about
 *  width: `3.4.2025` is not `dd.MM.yyyy`, because accepting a loose width would
 *  make two patterns agree on values that distinguish them. A two-digit year is
 *  its own pattern with its own width, never a loosening of the four-digit one. */
function readsAsDate(text, { separator, order, shortYear = false, monthName = false }) {
  const parts = text.split(separator)
  if (parts.length !== 3) return false

  // The month-name candidate splits on a space and reads its own ordering off
  // the value, so it never reaches the width table or the part order below.
  if (monthName) return readsAsMonthNameDate(parts)

  const yearWidth = shortYear ? 2 : 4
  const widths = order === 'ymd' ? [yearWidth, 2, 2] : [2, 2, yearWidth]
  for (let i = 0; i < 3; i += 1) {
    if (parts[i].length !== widths[i] || !DIGITS.test(parts[i])) return false
  }

  const [a, b, c] = parts.map(Number)
  // `shortYear` on an `ymd` candidate is `yy-MM-dd`, and it was knowingly
  // unreachable until the 2026-08-03 amendment gave `yyyy-MM-dd` its mirror. The
  // branch was kept through that whole period rather than deleted to reach
  // coverage, and this is the day it would otherwise have had to be written back.
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
 * The clock that rides behind a date: `CLOCK_TIME` plus the three things only a
 * timestamp carries — a fractional second of 1–9 digits alongside seconds,
 * spelled with `.` **or** `,` because ISO 8601 allows both; a zone offset of
 * `Z`, `z`, `±HH`, `±HHmm` or `±HH:mm`; and end-of-day `24:00`, which the
 * standard permits as a synonym for the next day's midnight.
 *
 * The hour is `\d{1,2}` here for exactly the reason it is `\d{1,2}` there.
 * `31.12.2025 9:05` is an ordinary German export, and it read as text while
 * `9:05` standing alone read as a time — an hour that is two-digit behind a date
 * and one-or-two in front of nothing is two clocks wearing one name. Everything
 * this reader adds is additive, so the promise "the clock behind a date is never
 * narrower than the clock standing alone" is structural rather than remembered,
 * and what it is *wider* by is exactly those three things.
 *
 * Nine fractional digits is the representation's own resolution (AD-21, epoch
 * nanoseconds), not an arbitrary cap: every digit that matches here survives
 * into a Table, and a tenth is counted unreadable rather than quietly dropped —
 * which is the C-10 rule applied to the other end of a number.
 */
const DATETIME_CLOCK =
  /^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/

/**
 * ISO 8601's basic format, which is the same clock with the separators left
 * out: `1430`, `143000`, `143000.461`, each with the same optional zone. The
 * capture groups stand in the same order as `DATETIME_CLOCK`'s — hour, minute,
 * second, fraction, offset — because both go through one validator, and a clock
 * whose rules depended on how it was spelled would be two clocks again.
 *
 * The standard does not allow a basic date in front of an extended clock, so
 * `20251231T14:30` reads as neither; see `readsAsDateTime`.
 */
const BASIC_CLOCK = /^(\d{2})([0-5]\d)(?:([0-5]\d)(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?:\d{2})?)?$/

/** ISO 8601's basic date, and it is read **only** behind a `T`: a bare
 *  `20251231` is eight digits and belongs to the number reading, and turning
 *  order numbers into dates is the defect this story exists to prevent, one
 *  direction over. */
const BASIC_DATE = /^(\d{4})(\d{2})(\d{2})$/

/**
 * How far from UTC an offset may be, in minutes — **the same distance in both
 * directions**, and that symmetry is the rule rather than an approximation of
 * one.
 *
 * The widest offset in use today is +14:00 (Line Islands) and the widest
 * westward one is −12:00 (Baker Island), so an argument from *current* zones
 * would cut this asymmetrically. It deliberately does not, for two reasons. The
 * bound is a **typo filter**, not a zone table: what it exists to refuse is
 * `+23:59` and `+25:00`, a mangled field read as a confident instant, and a
 * filter that has to be justified separately in each direction is a zone table
 * being written by hand — the kind of thing this file refuses for locale
 * separators one screen up. And "the widest offset any zone has" does not cut at
 * −12:00 either once zones are taken over their whole history: tzdata carries
 * Asia/Manila at LMT −15:56 before 1844 and America/Anchorage at +14:00:24
 * before 1867, both from the date line moving rather than from a typo. A rule
 * that would have to name its own exceptions is not the rule it looks like.
 *
 * So: ±14:00, symmetric, stated in the Boundaries as the spec's bound rather
 * than one the code invented. Two hours of westward slack is the price, and it
 * is named here rather than discovered — `-13:00` reads and no zone has it.
 */
const OFFSET_MAX_MINUTES = 14 * 60

/** Is the zone offset one a zone actually has? `Z` and an absent offset are UTC
 *  and need no arithmetic; everything else is minutes, bounded at ±14:00, with
 *  the minute field still 00–59 because `+02:99` is not two hours and 99.
 *
 *  `-00:00` is refused, and it is the one spelling the standard itself rules
 *  out: ISO 8601 has no negative zero, because zero is not west of anything.
 *  (RFC 3339 borrows the spelling for "offset unknown", which is a different
 *  claim in a different standard and not one a `datetime` column can carry.)
 *  `+00:00`, `-00:01` and `Z` are all unaffected. */
function readsAsOffset(offset) {
  if (offset === undefined || offset === 'Z' || offset === 'z') return true
  const digits = offset.slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = digits.length === 2 ? 0 : Number(digits.slice(2))
  if (offset[0] === '-' && hours === 0 && minutes === 0) return false
  return minutes <= 59 && hours * 60 + minutes <= OFFSET_MAX_MINUTES
}

/** Is `24` the end of the day rather than an hour no day has? ISO 8601 permits
 *  `24:00` as the next day's midnight, and only that: the minutes, the seconds
 *  and any fraction must all be zero, so `24:01` stays unreadable. */
const readsAsEndOfDay = (minute, second, fraction) =>
  minute === '00' &&
  (second === undefined || second === '00') &&
  (fraction === undefined || /^0+$/.test(fraction))

/**
 * Does `text` read as a clock, in the spelling `form` names?
 *
 * `CLOCK_TIME` is the standalone `time` type and takes the bare shape, hours
 * 00–23. The other two are a datetime's clock — `DATETIME_CLOCK` extended and
 * `BASIC_CLOCK` basic — and they take the fraction, the zone and end-of-day
 * `24:00` as well. The rule a regex cannot state is applied once, here, for all
 * three, rather than per spelling.
 */
function readsAsClockTime(text, form) {
  const m = form.exec(text)
  if (m === null) return false

  const [, hour, minute, second, fraction, offset] = m
  if (form === CLOCK_TIME) return Number(hour) <= 23
  if (Number(hour) > 23 && !(Number(hour) === 24 && readsAsEndOfDay(minute, second, fraction))) {
    return false
  }
  return readsAsOffset(offset)
}

/** Where the date stops and the clock starts. ISO 8601 separates them with `T`
 *  and permits the lowercase form; every other candidate uses a space. */
const clockStart = (text, candidate) => (candidate.iso ? text.search(/[Tt]/) : text.indexOf(' '))

/** ISO 8601 refuses a basic date in front of an extended clock and the other way
 *  round, so the two halves are read as a pair rather than each on its own. */
function readsAsDateTime(text, candidate) {
  const at = clockStart(text, candidate)
  if (at === -1) return false

  const date = text.slice(0, at)
  const clock = text.slice(at + 1)

  const basic = candidate.iso ? BASIC_DATE.exec(date) : null
  if (basic !== null) {
    return (
      isRealDate(Number(basic[1]), Number(basic[2]), Number(basic[3])) &&
      readsAsClockTime(clock, BASIC_CLOCK)
    )
  }
  return readsAsDate(date, candidate.date) && readsAsClockTime(clock, DATETIME_CLOCK)
}

const readsAsTime = (text) => readsAsClockTime(text, CLOCK_TIME)

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
      const accounting = carriesAccountingEvidence(present, reading)
      let parsed = 0
      for (const value of values) if (readsAsNumber(value, reading, affix, accounting)) parsed += 1
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

/**
 * Every normalized month spelling that means two different months. Empty is the
 * rule, and a test asserts it — the same shape as the two type gaps around it,
 * for the same reason: an invariant nothing can observe is one a change can
 * remove.
 *
 * This is what makes ONE union candidate sound. If a spelling ever meant both
 * March and May, a value carrying it would read as two different dates and the
 * single candidate would be silently picking one — the exact class of invisible
 * wrong answer this file refuses. Measured 2026-08-03 across all three locales
 * and both widths: 34 distinct spellings, none of them shared.
 */
export const monthNameCollisions = () => MONTHS.collisions

/**
 * Every locale of `MONTH_LOCALES` the engine did not actually have. Empty is the
 * rule, and a test asserts it.
 *
 * A missing locale is not a missing feature — `Intl` falls back rather than
 * failing, so it hands back a German table under a `xx-YY` tag, and every value
 * in it looks plausible and is wrong. `resolvedOptions().locale` is checked per
 * formatter and the mismatch collected here rather than thrown, so it fails a
 * test instead of a user's file read.
 *
 * **`locales` exists so the check is falsifiable, and that is the whole reason
 * for the parameter.** On an engine that has all three locales the gap is empty
 * whether the check is there or not, so deleting it would pass every other case
 * in the suite — the same hole `dayIndex`'s export closes, one file over. Handed
 * a locale no engine has, this re-derives and must report it.
 */
export const monthLocaleGaps = (locales) =>
  locales === undefined ? MONTHS.fallbacks : deriveMonthNames(locales).fallbacks

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

const SETTLED = Object.freeze({ verdict: 'settled', evidence: null })

/**
 * The verdict two scored readings leave a column in — the one place that decides
 * it, for detection and for a re-score alike.
 *
 * A runner-up that reads nothing is no contest at all; a reading that reads more
 * exclusively than the other is decisive and the count is nameable; anything
 * else is the state where nothing settles it, and saying so is the whole point
 * (FR-9). `over` is `{ over: 'kind' }` where the two alternatives are *types*
 * rather than readings, and `{}` otherwise — a reading ambiguity's evidence
 * keeps exactly the shape story 3 shipped, field for field, because that shape
 * is asserted whole in the story-3 suite.
 *
 * It is a function rather than three copies of the same `if` because the answer
 * has to be the same on every route into a column record: a re-score that had
 * its own opinion about when a reading is undecided would be a second opinion,
 * and this file's discipline is that there is one.
 */
function ambiguity(values, hits, reads, over = {}) {
  const [best, runnerUp] = hits
  if (!best || !runnerUp || runnerUp.parsed === 0) return SETTLED

  const { only, contested } = exclusive(values, best.candidate, runnerUp.candidate, reads)
  const alternatives = Object.freeze([keyOf(best.candidate), keyOf(runnerUp.candidate)])

  return only > contested
    ? Object.freeze({
        verdict: 'decisive',
        evidence: Object.freeze({ ...over, alternatives, decidedBy: only, contested }),
      })
    : Object.freeze({ verdict: 'unresolved', evidence: Object.freeze({ ...over, alternatives }) })
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
      mixedBooleanPairs: null,
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
  const readsNumber = (value, candidate) =>
    readsAsNumber(value, candidate, affix, carriesAccountingEvidence(present, candidate))

  // Which pairs the column spells its yes and its no in. Read off the scores
  // rather than walked for separately — the boolean kind below is scored over
  // every value anyway, and a second walk would buy nothing but the cost the
  // ledger already carries an entry about. Declaration order, not hit order, so
  // the warning names them the way `mixedAffixes` does.
  const booleanHits = score(values, BOOLEAN_PAIRS, readsAsBoolean)
  const pairsUsed = BOOLEAN_PAIRS.filter((pair) =>
    booleanHits.some((hit) => hit.candidate === pair && hit.parsed > 0),
  )
  // A pair never mixes with another, and the rule is unconditional rather than
  // scored: nineteen `ja` beside one `false` is the same finding as one beside
  // one. A threshold would make the guarantee true at 50/50 and false at 95/5,
  // and "a pair never mixes" is either a rule or it is a tendency. The `1`/`0`
  // pair takes part like any other — so `1`, `0` beside `ja` disqualifies
  // `boolean` while the *number* reading of `1` and `0` is untouched and `ja`
  // counts unparsed. Mirrors the affix rule field for field, including that the
  // finding is carried whatever kind ends up winning the column.
  const mixedBooleanPairs =
    pairsUsed.length > 1 ? Object.freeze(pairsUsed.map((pair) => pair.pattern)) : null

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
      const parts = numberParts(value, reading, affix, carriesAccountingEvidence(present, reading))
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

  // Three of the four datetime candidates are built on `:`, so a column without
  // one cannot match them. ISO 8601's basic format is the exception — its clock
  // carries no separator at all (`20251231T1430`) — so the ISO candidate is
  // scored whatever the column contains. It is the same arithmetic as every
  // other narrowing here: a candidate no value could match is skipped, and one
  // that could is not.
  const datetimePatterns = clocks ? DATETIME_PATTERNS : DATETIME_PATTERNS.filter((p) => p.iso)

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
      hits: score(values, datetimePatterns, readsAsDateTime),
    },
    {
      over: 'kind',
      reads: readsAsClock,
      hits: clocks ? score(values, CLOCK_CANDIDATES, readsAsClock) : EMPTY,
    },
    {
      type: BOOLEAN,
      reads: readsAsBoolean,
      hits: mixedBooleanPairs !== null ? EMPTY : booleanHits,
    },
  ]

  let winner = null
  for (const kind of kinds) {
    if ((kind.hits[0]?.parsed ?? 0) > (winner?.hits[0]?.parsed ?? 0)) winner = kind
  }
  const best = winner?.hits[0]

  /** What the column-wide scans found, on every route that can reach them.
   *  `record` says what the shape *is*; this says what this column *has*, and
   *  merging it in one place is what keeps a finding from being carried on two
   *  of three sibling returns and forgotten on the third — which is exactly how
   *  `mixedAffixes` was lost on the short-year route below. A new finding is
   *  added here and is then on every proposal by construction. */
  const found = (over) => record({ mixedAffixes, mixedBooleanPairs, ...over })

  if (!best || best.parsed / values.length < PROPOSAL_THRESHOLD) return found({})

  const overKind = winner.over === 'kind'
  const type = overKind ? best.candidate.type : winner.type

  // Three two-digit parts settle nothing. A `dd.MM.yy` column is asked about
  // rather than proposed unless something in it decides — story 3's second
  // ambiguity state, on the case it was built for, with the alternatives being
  // *types* because the choice on offer is `Datum` or `Text`.
  if (type === DATE && best.candidate.shortYear) {
    const settled = shortYearVerdict(values, best.candidate)
    if (settled === TEXT) return found({})
    if (settled === 'unresolved') {
      return found({
        type: DATE,
        format: best.candidate,
        counts: counts(best.parsed),
        verdict: 'unresolved',
        evidence: Object.freeze({ over: 'kind', alternatives: Object.freeze([DATE, TEXT]) }),
      })
    }
  }

  // The ambiguity states, from the one place that decides them (`ambiguity`).
  //
  // There is no case here for two readings that mean the same thing. That is
  // handled where it belongs and where it is also cheapest — `numberReadings`
  // never offers them as two, so there is no runner-up to argue with.
  //
  // `over: 'kind'` is set only where the alternatives are types.
  const { verdict, evidence } = ambiguity(
    values,
    winner.hits,
    winner.reads,
    overKind ? { over: 'kind' } : {},
  )

  // The two column-wide findings ride along by way of `found`, whatever kind
  // won. Eighteen German dates beside `12 €` and `12 $` propose `date`, and the
  // two amounts would otherwise survive only as an anonymous unparsed count —
  // the two-units fact is still true, still the user's to act on, and losing it
  // because a *different* kind cleared the threshold is the finding going quiet
  // exactly where it is least expected. What the sentences in `ui/` may not
  // claim is that the column is read as text, because sometimes it is not.
  return found({
    type,
    // `time` and `duration` carry no reading to choose, so they carry no format.
    format: overKind ? null : best.candidate,
    counts: counts(best.parsed),
    verdict,
    evidence,
    // Only a number column carries a unit. Without the suppression a column of
    // German dates with one `12 €` in it would render `Einheit: €` under a card
    // typed `Datum` — the affix is scanned for every column, because the scan is
    // what decides whether a *number* reading is affixed, and the finding stops
    // being about this column the moment another kind wins it.
    affix: type === NUMBER ? affix : null,
  })
}

/** Three parts of exactly two digits — the shape a version number, a chapter
 *  number and a `dd.MM.yy` date all share, and the reason none of them can be
 *  told from the others by looking at one value. */
function isTwoDigitTriple(value, separator) {
  const parts = value.split(separator)
  return parts.length === 3 && parts.every((part) => part.length === 2 && DIGITS.test(part))
}

/** Which part of a candidate's three is the day. Taken from the candidate rather
 *  than assumed to be the first: `MM.dd.yy` puts a *month* there and `yy-MM-dd`
 *  puts a *year* there, and neither can exceed twelve the way a day does.
 *
 *  It is the preferred order alone whose day-past-twelve evidence settles a
 *  column, and only the three dmy mirrors are preferred, so today this only ever
 *  decides anything at `0` — and it stays written from the candidate anyway,
 *  because that is what keeps the preference a property of `DATE_PATTERNS`.
 *  Moving `preferred` onto the mdy mirrors or onto `yy-MM-dd` is then one edit
 *  to the list and none to `shortYearVerdict`; hard-coding `parts[0]` here would
 *  make it two, with the second one silent.
 *
 *  **Exported because that last sentence is otherwise unfalsifiable.** No column
 *  reaches the `mdy` or `ymd` answer through `detectColumn` — the preference
 *  check runs in front of the day check — so `dayIndex = () => 0` passes the
 *  whole suite while quietly deleting the property the docblock claims. A
 *  derivation nothing can observe is a derivation a mutation can remove, and the
 *  test that observes it walks `dateCandidates()` rather than repeating it. */
export const dayIndex = ({ order }) => (order === 'dmy' ? 0 : order === 'mdy' ? 1 : 2)

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
 *   - a triple that **cannot** be a date under **any** candidate — `01.32.03`,
 *     where no part order makes a day of 32 — reads only as a version, and
 *     settles the column as text. The example was `01.13.03` while `dd.MM.yy`
 *     was the only two-digit pattern there was, and the mdy mirrors killed it:
 *     `MM.dd.yy` reads it as 13 January 2003, so it is a date under one order
 *     rather than nonsense under both. `01.32.03` is nonsense under all of them,
 *     which is what the rule was always about — the rule is unchanged, only its
 *     illustration. **"Any candidate" is the whole list, not the winning
 *     candidate**, and that is the Boundaries' word rather than a widening: the
 *     rule's justification is that such a value "is a version number and nothing
 *     else", which is a claim about the value and not about whichever reading
 *     happened to win the column. Asking the winner instead was measurably
 *     different — nineteen `31.12.25` beside one `01.13.03` settled as *text*,
 *     because `01.13.03` does not read under `dd.MM.yy`, although 13 January
 *     2003 is a reading it genuinely has;
 *   - a triple whose **day is past twelve** — `31.12.25`, where 31 is no
 *     month — cannot be a triple of month-sized components, and settles it as
 *     a date. This is why the shape the owner actually asked for is unaffected.
 *
 * Which part carries the day is the candidate's to say, not this function's:
 * see `dayIndex`. Reading it out of the first part was correct while `dd.MM.yy`
 * was the only two-digit pattern there was, and it is the one thing the mdy
 * mirrors cost — named in the Boundaries rather than discovered.
 *
 * **And a day past twelve settles the column only under the preferred order.**
 * `31.12.25` and `01.13.03` are the same shape once both orders are on the list
 * — each a date under exactly one of them and nonsense under the other — so a
 * day of 31 in the first part is evidence of a *German date* only if the German
 * order is what we read a two-digit triple in by default. That preference is
 * declared where it can be seen, on `DATE_PATTERNS`, and read here as
 * `candidate.preferred`; a column whose only date reading is an mdy mirror is
 * `unresolved` between `date` and `text`, and the person answers.
 *
 * The order of the three tests is the rule and must not be reordered: text
 * first. A triple that reads under **no** candidate is still a version number
 * whichever order was declared preferred, so `['01.02.03', '01.32.03',
 * '04.05.06']` settles as text and is never asked about.
 *
 * With none of them, nothing in the column decides and the person does. Only
 * values of the triple shape are asked: a column carrying `demnächst` beside
 * twenty dates is still twenty dates and one unparsed value, exactly as story 3
 * counts it — the version hypothesis needs version-shaped values to stand on.
 */
function shortYearVerdict(values, candidate) {
  const { separator } = candidate
  let decidesText = false
  let decidesDate = false

  for (const value of values) {
    if (!isTwoDigitTriple(value, separator)) continue
    // Text evidence asks the whole list; date evidence asks the candidate that
    // won, because a day is only a day under a reading that has one there.
    if (!DATE_PATTERNS.some((p) => readsAsDate(value, p))) decidesText = true
    else if (
      readsAsDate(value, candidate) &&
      Number(value.split(separator)[dayIndex(candidate)]) > 12
    ) {
      decidesDate = true
    }
  }

  if (decidesText) return TEXT
  if (!candidate.preferred) return 'unresolved'
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
          : EMPTY

/** Which reader a chosen type is scored with. Neither the affix nor the
 *  accounting evidence is part of a format — a format answers which locale reads
 *  the digits, an affix answers what unit rides on the column, and the evidence
 *  answers whether `(500)` is a negative number in *this* column — so a number
 *  reading is bound to both here rather than carrying them. `present` is the
 *  column's mark set; without one there is no column vouching for anything, and
 *  the accounting spellings do not read. */
const readerFor = (type, affix, present = null) =>
  type === NUMBER
    ? (value, candidate) =>
        readsAsNumber(
          value,
          candidate,
          affix,
          present !== null && carriesAccountingEvidence(present, candidate),
        )
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
 * The column's one boolean pair, where it has one.
 *
 * A pair never mixes with another — the frozen rule, unconditional and not
 * scored — so two pairs in a column is **not an ambiguity between two
 * readings**. It is the finding that disqualifies `boolean` for the whole
 * column, which detection reports as `text` plus a warning naming both. On the
 * re-score path the user has already answered that finding by choosing the type
 * regardless, and what is left is not a question but a property: *which* pair
 * this column is scored under. Offering it as a reading question would be
 * offering one the rule forbids, because neither answer makes a two-pair column
 * a boolean column — measured before this was added, `scoreColumn(['ja',
 * 'false'], { type: BOOLEAN, … })` came back `unresolved` between `ja/nein` and
 * `true/false`, which is the card asking the user to pick a side in a mixture.
 *
 * So the pair is picked the way the column's **affix** is picked, field for
 * field, which is what the frozen rule asks for: the one covering the most
 * values, ties to the pair declared first. What the choice costs is the unparsed
 * count, reported either way — the same sentence `scoreColumn` already carries
 * about `mixedAffixes`.
 *
 * A column no pair reads at all gets the whole list back, so a text column
 * retyped to `boolean` reports 0 of N under a named pair rather than under one
 * this function invented.
 */
function booleanReadings(values) {
  let best = null
  let bestParsed = 0
  for (const pair of BOOLEAN_PAIRS) {
    let parsed = 0
    for (const value of values) if (readsAsBoolean(value, pair)) parsed += 1
    if (parsed > bestParsed) {
      best = pair
      bestParsed = parsed
    }
  }
  return best === null ? BOOLEAN_PAIRS : [best]
}

/**
 * The candidates of a type that *this column* is scored against, in the one
 * place a re-score can reach it.
 *
 * Two types narrow and the rest do not, and the docblock used to claim the
 * narrowing for all of them — which was false for `date`, where `detectColumn`
 * filters by separator and this returns every pattern.
 *
 *   - `number` narrows for **correctness** before cost: two readings that differ
 *     only in separators no value carries are one reading, so a column of `1`,
 *     `2`, `42` is never asked a question whose two answers are the same number.
 *   - `boolean` narrows to the column's one pair, because a pair never mixes and
 *     so there is no reading question between two of them — see
 *     `booleanReadings`.
 *   - `date` and `datetime` get the full list, and that is deliberate rather
 *     than an omission: a candidate whose separator the column lacks reads
 *     nothing, and `ambiguity` already treats a runner-up that reads nothing as
 *     no contest at all. Narrowing them here would change no verdict and no
 *     count — it would only buy back a walk, on a path that runs once per user
 *     click rather than once per column — and it would cost a `marksPresent`
 *     pass this path does not otherwise make for a date.
 */
const readingsFor = (type, present, values) =>
  type === NUMBER
    ? numberReadings(present)
    : type === BOOLEAN
      ? booleanReadings(values)
      : candidatesFor(type)

/**
 * The reading a type the user just chose is scored under — **or `null` where the
 * column names none.**
 *
 * Handing over the first candidate instead would give every column switched to
 * `number` the German reading, and an Anglo column a collapsed hit rate with
 * nothing to say the other candidate scored better. The user asked for a type,
 * not for a reading; the reading is still ours to propose.
 *
 * And where nothing in the column decides between two readings, the honest
 * proposal is none at all. `03.04.25` beside `05.06.25` reads the same under
 * `dd.MM.yy` and `MM.dd.yy`, and naming one of them because it sorts first is
 * the tie-break this module's header exists to refuse — done here it would be
 * worse than in detection, because it would arrive wearing a person's answer.
 * `scoreColumn` takes `null` as "not chosen" and asks the same question again.
 *
 * A candidate that reads *nothing* is still handed back, and deliberately: the
 * counts then report 0 of N, which is the honest answer to "what does this
 * column look like as a date", and `ambiguity` says nothing is contested where
 * the runner-up reads nothing either.
 */
export function bestFormat(cells, type, missingTokens) {
  if (candidatesFor(type).length === 0) return null
  const { values } = sift(cells, missingTokens)
  const present = type === NUMBER ? marksPresent(values) : null
  const readings = readingsFor(type, present, values)
  const { affix } = present ? affixScan(values, readings, present) : { affix: null }
  const reads = readerFor(type, affix, present)

  const hits = score(values, readings, reads)
  return ambiguity(values, hits, reads).verdict === 'unresolved' ? null : hits[0].candidate
}

/**
 * Re-score a column under a type and format the user chose.
 *
 * **A chosen type settles the column only where nothing else in it is still
 * open.** The verdict was once `settled` by construction — a person answered the
 * question, so the column was no longer waiting on one — and that was true only
 * while every choice arrived with a reading attached. It does not survive the
 * two-digit mirrors: `03.04.25` beside `05.06.25` carries *two* questions, the
 * kind question (`date` or `text`, because three two-digit parts settle nothing)
 * and, behind it, the ordering question its four-digit twin already asks. The
 * kind question is asked first and the reading select is suppressed while it is
 * open, so a user who then chooses `Datum` has answered one question and has
 * never been shown the other. Settling it for them is the same defect as the
 * settled version-number column this story opened with, one question further on.
 *
 * So a chosen type with **no** reading chosen (`format` null or absent, on a type
 * that has readings) is scored exactly as detection scores it: the same
 * candidates, the same counts, the same `ambiguity`. There is no second opinion
 * here about when a reading is undecided, because there is only one.
 */
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
  //
  // The accounting evidence is re-derived from the same place and for the same
  // reason, so the two paths cannot disagree about what a value reads as: a user
  // choosing `number` on a column of `4711-` part numbers must not resurrect the
  // negatives detection refused to read.
  const present = type === NUMBER ? marksPresent(values) : null
  const readings = readingsFor(type, present, values)
  const { affix } = present ? affixScan(values, readings, present) : { affix: null }

  const reads = readerFor(type, affix, present)

  // Three shapes, and the third is what a chosen type no longer settles on its
  // own. A named reading is scored under it. A type with no readings at all
  // (`text`, `time`, `duration`) is scored under itself, or counts every value
  // readable where there is nothing to score against — the shape a native column
  // arrives in. And a type *with* readings and none named means the person
  // answered the kind question and was never asked the reading one: the
  // candidates are scored here as detection scores them, so the column comes
  // back `unresolved` over the reading rather than settled on a winner nobody
  // chose.
  const unnamed = reads !== null && format == null && candidatesFor(type).length > 0
  const hits = unnamed ? score(values, readings, reads) : EMPTY
  const scored = unnamed ? (hits[0] ?? null) : null

  let parsed = values.length
  if (unnamed) parsed = scored?.parsed ?? 0
  else if (reads !== null) parsed = values.filter((value) => reads(value, format)).length

  const { verdict, evidence } = unnamed ? ambiguity(values, hits, reads) : SETTLED

  // **A reading nobody chose is not written onto the record.** Where the column
  // came back `unresolved` over the reading, the top-scoring candidate is not a
  // proposal, it is one of two answers we are asking the user for — and the
  // record is what story 14 serializes, beside a `chosen.format` that is `null`
  // for exactly this reason. Carrying the candidate anyway made the store write
  // a record disagreeing with its own `chosen`, and a Recipe round-trip would
  // have stored a reading the user declined to give. The card never showed it,
  // because the reading select keys on the verdict — which is what kept it
  // invisible rather than what made it harmless.
  //
  // The counts are unaffected and stay honest: `ambiguity` answers `unresolved`
  // exactly when the two readings parse the same number of values (`only >
  // contested` is `best.parsed > runnerUp.parsed` rewritten), so the count
  // reported is true of *both* alternatives rather than of the one dropped here.
  //
  // Detection's own unresolved records keep their format, and that is not the
  // same case: nothing has been chosen there, so there is no `chosen` to
  // disagree with, and the shape is asserted whole by the story-3 suite.
  const unchosen = unnamed && verdict === 'unresolved'

  return Object.freeze({
    type,
    format: (unnamed ? (unchosen ? null : scored?.candidate) : format) ?? null,
    counts: Object.freeze({
      total: cells.length,
      missing,
      parsed,
      unparsed: values.length - parsed,
    }),
    verdict,
    evidence,
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
    // Never here either, and for the same reason: the two-pairs finding is a
    // reason a column was not proposed as a boolean, and the user has answered.
    mixedBooleanPairs: null,
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
 *  are equally good and nothing has picked one. Returned as names so the refusal
 *  can say which, rather than that something is wrong.
 *
 *  The record's verdict is the whole test, and a chosen type is no longer an
 *  exemption from it: `scoreColumn` now answers `unresolved` where the choice
 *  closed one question and left another open, and a column asking the user
 *  something must block the gate whether or not they have already answered
 *  something else about it. */
export function unresolvedColumns(typing) {
  return Object.freeze(typing.columns.filter((c) => c.verdict === 'unresolved').map((c) => c.name))
}
