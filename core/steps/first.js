// The First-N Step (CAP-40): keep the first N rows of the order in force.
// AD-4's signature, and — like `columns.js` — not one line of it reads a cell.
//
// **One verb, so it composes with the Sort rather than absorbing it.** *Take the
// ten newest records* is *Sortieren* by a date descending, then *Erste 10*: the
// order is a decision about rows and the limit is a decision about how many, and
// a single Step carrying both would make the second one impossible to state
// without the first. It is also why there is no "letzte N" — descending plus
// *Erste N* is the same thing, and a second verb would be a second thing to
// explain.
//
// **The limit is not a cost.** The engine holds it as a `BitSet` over the rows
// the order already produced, so the columns stay shared with the input: 50,000
// of 100,000 rows was measured at 0.8 ms and ~12.5 kB, against a `slice` whose
// `reify` is a full copy of every column. That is the same memory rule the
// Filter follows and the reason a chain of Steps costs ~0.0 MB.

import { error, info } from '../diagnostics/diagnostic.js'
import { CODE } from './codes.js'

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
 */
export const defaultConfig = () => Object.freeze({ count: null })

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
  const { count } = config
  // `null` and an absent field are both "no limit set", which is the identity.
  // Everything else has to be a count a person could have meant: `0`, `-1` and
  // `2.5` are all shapes a Recipe out of a language model produces, and each of
  // them would otherwise reach the engine as a row range nobody asked for.
  if (count === null || count === undefined) return { ok: true, diagnostics: Object.freeze(out) }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    refuse('count', { value: String(count) })
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
  // No count is the identity, and the identity is the input handle itself.
  if (count === null) return { table: input, diagnostics: Object.freeze([]) }

  const outcome = engine.firstRows(input, count)

  // `rows_removed` is reused rather than given a code of its own: the German
  // already reads „N Zeilen entfernt, M übrig." and a limit that took nothing
  // away — N at or above the row count — reads „Keine Zeile entfernt", which is
  // the sentence that case needs. A second code would be a second wording for
  // one fact.
  return {
    table: outcome.table,
    diagnostics: Object.freeze([
      info(CODE.rowsRemoved, { removed: outcome.removed, kept: outcome.table.rowCount() }),
    ]),
  }
}

export const firstKind = Object.freeze({ defaultConfig, validate, apply })
