// The Sort Step (CAP-40): a row order that is data rather than a look at a
// table. AD-4's signature — `(engine, inputs, config) => { table, diagnostics }`,
// pure and synchronous, the engine arriving as a parameter and never as an
// import.
//
// **This file never touches a cell**, exactly as `filter.js` does not. It reads
// the input's `schema()` to find out whether the columns the config names are
// there, and hands the whole ordering to the engine. That is not tidiness: where
// a box and a `null` go is a measured hazard the adapter absorbs (AD-19, AD-22),
// and a temporal value is a `BigInt` only the adapter constructs (AD-21).
//
// THREE RULES SHAPE THIS FILE, and each one is a measurement rather than a
// preference. All three are recorded in
// `_bmad-output/planning-artifacts/spikes/arquero-order-2026-08-04/findings.md`.
//
//   1. A BOX AND A `null` ARE PLACED, NEVER COMPARED, and they are placed
//      **last in both directions**. Comparing them is what the engine's own
//      `orderby` does, and it was measured reordering rows that have nothing to
//      do with the box — `1 2 3 4 5 7 8 9 BOX 6` in Chromium against
//      `1 2 7 8 9 BOX 3 4 5 6` in Firefox, from the same ten values. A box
//      compares `false` in both directions, which makes the comparator
//      inconsistent, and a sort over an inconsistent comparator is
//      implementation-defined. That is C-10's failure mode exactly: no error, a
//      plausible order, a different wrong answer per browser.
//
//   2. THE ROWS A BOX PUT AT THE END ARE COUNTED AND SAID OUT LOUD. An empty
//      cell is data — the user can see it in the preview and it lands where the
//      form says it lands — while a box is a value the product could not read
//      under a type the user confirmed, and CAP-9's remainder says those never
//      disappear quietly. So the count travels as a warning at this Step, in the
//      shape `filter.js` established, and the empty-value rule is a static
//      sentence in the form rather than a diagnostic about nothing.
//
//   3. TWO KEYS NAMING ONE COLUMN ARE REFUSED AT CONFIGURE TIME. Like CAP-16's
//      rename collision this needs no input schema — two keys that are equal are
//      equal whatever flows through — so the refusal happens where the previous
//      config stays in force and the user is still looking at the control that
//      caused it.

import { error, warning } from '../diagnostics/diagnostic.js'
import { CODE } from './codes.js'

/**
 * The direction vocabulary, closed here and nowhere else.
 *
 * Closed exactly as `COMBINES` is in `filter.js`, and short for the same reason:
 * AD-30 forbids a formula, expression or query surface anywhere in the MVP, so a
 * sort key is a select and a select. There is no third direction and no "letzte
 * N" anywhere downstream — descending plus *Erste N* is the same thing.
 */
export const DIRECTIONS = Object.freeze(['asc', 'desc'])

const isName = (value) => typeof value === 'string' && value !== ''

/**
 * The empty configuration a freshly added Sort carries: no key, so every row
 * passes in input order.
 *
 * The identity rather than a guess at a first column, and the same decision
 * `filter.js` makes for no conditions and `columns.js` for `[]`: a Step that
 * reordered the chain before anybody configured it would change a number the
 * user is reading while they are still building the thing that produces it.
 */
export const defaultConfig = () => Object.freeze({ keys: Object.freeze([]) })

/** The keys as `{ column, direction }`, with an absent direction defaulting to
 *  ascending. One reader for the optional field, so `validate` and `apply`
 *  cannot disagree about what an absent `direction` means. */
const keysOf = (config) =>
  (config?.keys ?? []).map((key) => ({
    column: key?.column,
    direction: key?.direction === undefined || key?.direction === null ? 'asc' : key?.direction,
  }))

/**
 * Structural validation — the half that can be answered with no input table.
 *
 * Shape and vocabulary, plus the one refusal CAP-40 names outright. Whether a
 * column *exists* is checked in `apply`, where the input schema exists and the
 * refusal can name the column truthfully.
 *
 * @returns {{ ok: boolean, diagnostics: ReadonlyArray<object> }}
 */
export function validate(config) {
  const out = []
  const refuse = (field, values = {}) => out.push(error(CODE.configInvalid, { field, ...values }))

  if (config === null || typeof config !== 'object') {
    refuse('config')
    return { ok: false, diagnostics: Object.freeze(out) }
  }
  if (!Array.isArray(config.keys)) {
    refuse('keys')
    return { ok: false, diagnostics: Object.freeze(out) }
  }

  const taken = new Set()
  keysOf(config).forEach((key, at) => {
    // `key` rather than `column` as the field, and it is what lets `ui/` say
    // „Sortierung 2 ist unvollständig" rather than the Filter's „Bedingung 2":
    // the two kinds share this code and `at` alone cannot tell them apart.
    if (!isName(key.column)) {
      refuse('key', { at })
      return
    }
    // **The column is registered before the direction is judged, and that order
    // matters.** Returning early on a bad direction meant a repeated column was
    // invisible until the direction was corrected — so a config with both
    // defects was refused twice, naming a different defect each time, and the
    // second refusal looked like a new problem the first fix had caused.
    //
    // The refusal names the *column*, not the position: the user chose a word
    // and the word is what is already sorted by. A second key on one column
    // cannot mean anything — the first has already decided every comparison it
    // could make — so it is a mistake rather than a redundancy.
    if (taken.has(key.column)) out.push(error(CODE.sortKeyRepeated, { column: key.column, at }))
    else taken.add(key.column)

    if (!DIRECTIONS.includes(key.direction)) {
      refuse('direction', { at, value: String(key.direction) })
    }
  })

  return { ok: out.length === 0, diagnostics: Object.freeze(out) }
}

/**
 * AD-4's signature. One input, as `core/graph/kinds.js` declares.
 *
 * @param {import('../../ports/index.js').TableEngine} engine
 * @param {ReadonlyArray<import('../../ports/index.js').Table>} inputs
 * @param {object} config
 * @returns {{ table: object|null, diagnostics: ReadonlyArray<object> }}
 */
export function apply(engine, inputs, config) {
  const input = inputs[0]
  const keys = keysOf(config)
  // No key is the identity, and the identity is the input handle itself: no
  // copy, no comparator, and the counts downstream are the input's because that
  // is exactly what this Step is passing on.
  if (keys.length === 0) return { table: input, diagnostics: Object.freeze([]) }

  const present = new Set(input.schema().map((column) => column.name))
  // Every key is checked before any is used, so a Sort naming two vanished
  // columns names both rather than the first one it tripped over.
  const missing = keys.filter((key) => !present.has(key.column))
  if (missing.length > 0) {
    return {
      table: null,
      diagnostics: Object.freeze(
        missing.map((key) => error(CODE.unknownColumn, { column: key.column })),
      ),
    }
  }

  const outcome = engine.orderRows(input, keys)

  // A Sort removes nothing, so there is no `rows_removed` here and no info-level
  // sentence at all: what CAP-19 shows beside this Step is its own row count,
  // which is its input's. The one thing worth saying is the one thing a person
  // could not otherwise see.
  const diagnostics = []
  if (outcome.boxed > 0) diagnostics.push(warning(CODE.boxedRowsLast, { rows: outcome.boxed }))

  return { table: outcome.table, diagnostics: Object.freeze(diagnostics) }
}

export const sortKind = Object.freeze({ defaultConfig, validate, apply })
