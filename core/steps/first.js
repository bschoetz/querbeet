// The First-N Step (CAP-40): keep the first — or the last — N rows of the order
// in force. AD-4's signature, and — like `columns.js` — not one line of it reads
// a cell.
//
// **One verb, so it composes with the Sort rather than absorbing it.** *Take the
// ten newest records* is *Sortieren* by a date descending, then *Erste 10*: the
// order is a decision about rows and the limit is a decision about how many, and
// a single Step carrying both would make the second one impossible to state
// without the first.
//
// **Which end is a flag on this Step and not a second kind** (asked for by the
// project owner, 2026-08-04, after the story shipped without it). The story's
// original reasoning — descending plus *Erste N* is the same thing — is true of
// the *rows* and false of the *work*: reversing an order to reach its other end
// means editing the Step upstream, which is a different Step than the one the
// user is looking at, and it silently reverses everything downstream of it too.
// A flag costs one word in one form.
//
// **The two ends are not mirror images, and that is why this Step warns.** Every
// order the adapter produces places empty and unreadable values last (AD-22), so
// *Letzte N* is the end that meets them: „die letzten 3" after a sort is quite
// likely three rows querbeet could not read. It is a legitimate thing to ask for
// — inspecting exactly those rows is a real use — so it is reported rather than
// refused (C-10), for whichever end the kept rows happen to carry one.
//
// **The limit is not a cost.** The engine holds it as a `BitSet` over the rows
// the order already produced, so the columns stay shared with the input: 50,000
// of 100,000 rows was measured at 0.8 ms and ~12.5 kB, against a `slice` whose
// `reify` is a full copy of every column. That is the same memory rule the
// Filter follows and the reason a chain of Steps costs ~0.0 MB.

import { error, info, warning } from '../diagnostics/diagnostic.js'
import { CODE } from './codes.js'

/**
 * Which end of the order the rows are taken from, closed here and nowhere else —
 * `DIRECTIONS` in `sort.js` and `COMBINES` in `filter.js` for their reason: a
 * vocabulary a select offers is a list `ui/` reads rather than restates, and
 * `endLabelGaps()` is what fails when a word is added without a German one.
 */
export const ENDS = Object.freeze(['first', 'last'])

/**
 * The empty configuration a freshly added First-N carries.
 *
 * `null` rather than a number, and it is the identity: every row through. A Step
 * that emptied its table until it was configured would make the chain downstream
 * unreadable exactly while it is being built — the decision `columns.js` makes
 * for `[]` and `filter.js` for no conditions.
 *
 * **`null` rather than `0`**, because `0` would have to mean either "no rows" or
 * "not set" and only one of those can be true. There is no upper bound either:
 * one would be an invented constant, and the honest limit is the row count,
 * which the Step reports rather than refuses.
 *
 * `end` starts at `'first'` and is always written out, so a stored config never
 * relies on a reader's default — the field a user did not touch still says which
 * rows the Step keeps.
 */
export const defaultConfig = () => Object.freeze({ count: null, end: 'first' })

/**
 * Structural validation. No input table is needed for any of it: whether `3` is
 * a count is a fact about `3`.
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
  // The end is judged whatever the count is, and before it: a config carrying a
  // word this Step does not know is wrong even while no limit is set, and a
  // count-less config that returned early would store it unseen.
  if (config.end !== undefined && !ENDS.includes(config.end)) {
    refuse('end', { value: String(config.end) })
  }

  const { count } = config
  // `null` and an absent field are both "no limit set", which is the identity.
  // Everything else has to be a count a person could have meant: `0`, `-1` and
  // `2.5` are all shapes a Recipe out of a language model produces, and each of
  // them would otherwise reach the engine as a row range nobody asked for.
  if (count !== null && count !== undefined) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      refuse('count', { value: String(count) })
    }
  }

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
  const count = config?.count ?? null
  // No count is the identity, and the identity is the input handle itself. The
  // end decides nothing then — there is no window to place.
  if (count === null) return { table: input, diagnostics: Object.freeze([]) }

  // One reader for the optional field, so a stored config written before the end
  // existed keeps meaning what it meant: the first N.
  const outcome = engine.firstRows(input, count, config?.end ?? 'first')

  // `rows_removed` is reused rather than given a code of its own: the German
  // already reads „N Zeilen entfernt, M übrig." and a limit that took nothing
  // away — N at or above the row count — reads „Keine Zeile entfernt", which is
  // the sentence that case needs. A second code would be a second wording for
  // one fact.
  const diagnostics = [
    info(CODE.rowsRemoved, { removed: outcome.removed, kept: outcome.table.rowCount() }),
  ]
  // The rows that were kept, not the rows that went: a limit does not compare
  // anything, so a box costs nothing here — but *Letzte N* over a sorted table
  // lands exactly where the unreadable values were placed, and a user reading
  // three rows is entitled to know that is why they are the last three.
  if (outcome.boxed > 0) {
    diagnostics.push(warning(CODE.boxedRowsKept, { rows: outcome.boxed }))
  }

  return {
    table: outcome.table,
    diagnostics: Object.freeze(diagnostics),
  }
}

export const firstKind = Object.freeze({ defaultConfig, validate, apply })
