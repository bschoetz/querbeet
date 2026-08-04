// The Columns Step (CAP-16): which columns leave, under which names, in which
// order. AD-4's signature, and — like `filter.js` — not one line of it reads a
// cell: the engine shares the column arrays with the input table, so a chain of
// these costs no memory at all.
//
// **Config order is output order.** That is the whole of CAP-16's reordering:
// there is no separate `position` field, because two representations of one fact
// disagree the first time a rename and a move arrive in the same commit.
//
// **A rename onto a name already in use is refused, naming the collision, and it
// is refused at configure time.** Unlike a type disagreement, this needs no input
// schema — two `to` values that are equal are equal whatever flows through — so
// the refusal happens where the previous config can stay in force and the user is
// still looking at the control that caused it.

import { error } from '../diagnostics/diagnostic.js'
import { CODE } from './codes.js'

const isName = (value) => typeof value === 'string' && value !== ''

/**
 * The empty configuration a freshly added Columns Step carries.
 *
 * An empty list means **every column, unchanged, in input order** rather than "no
 * columns". A Step that emptied its table until it was configured would make the
 * chain downstream unreadable exactly while it is being built, and a table with
 * no columns is not a state anyone wants to reach by omission. `ui/` writes the
 * explicit list as soon as the user touches a control, so `[]` is only ever the
 * state before the first interaction.
 */
export const defaultConfig = () => Object.freeze({ columns: Object.freeze([]) })

/** The entries as `{ from, to }`, with `to` defaulting to `from`. One reader for
 *  the optional field, so `validate` and `apply` cannot disagree about what an
 *  absent `to` means. */
const entries = (config) =>
  (config?.columns ?? []).map((entry) => ({
    from: entry?.from,
    to: entry?.to === undefined || entry?.to === null ? entry?.from : entry?.to,
  }))

/**
 * Structural validation. Shape, plus the one refusal CAP-16 names outright.
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
  if (!Array.isArray(config.columns)) {
    refuse('columns')
    return { ok: false, diagnostics: Object.freeze(out) }
  }

  const taken = new Set()
  entries(config).forEach((entry, at) => {
    if (!isName(entry.from)) {
      refuse('from', { at })
      return
    }
    if (!isName(entry.to)) {
      refuse('to', { at })
      return
    }
    // The collision names the name rather than the position: the user typed a
    // word and the word is what is already in use.
    if (taken.has(entry.to)) out.push(error(CODE.renameCollision, { name: entry.to, at }))
    else taken.add(entry.to)
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
  const ordered = entries(config)
  // Nothing chosen yet is the identity, and the identity is the input handle
  // itself: no copy, no new schema, and the counts downstream are the input's
  // because that is exactly what this Step is passing on.
  if (ordered.length === 0) return { table: input, diagnostics: Object.freeze([]) }

  const present = new Set(input.schema().map((column) => column.name))
  const missing = ordered.filter((entry) => !present.has(entry.from))
  if (missing.length > 0) {
    return {
      table: null,
      diagnostics: Object.freeze(
        missing.map((entry) => error(CODE.unknownColumn, { column: entry.from })),
      ),
    }
  }

  return { table: engine.selectColumns(input, ordered), diagnostics: Object.freeze([]) }
}

export const columnsKind = Object.freeze({ defaultConfig, validate, apply })
