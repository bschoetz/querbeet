// The Filter Step (CAP-15). AD-4: `(engine, inputs, config) => { table, diagnostics }`,
// pure and synchronous, with the engine arriving as a parameter and never as an
// import.
//
// **This file never touches a cell.** It reads the input's `schema()`, decides
// whether each condition's value agrees with its column's confirmed type, and
// hands the whole comparison to the engine. That is not tidiness: a box is the
// adapter's alone (AD-22) and a temporal value is a `BigInt` the adapter alone
// constructs (AD-21), so a Step kind that read a value would meet both on its
// first line.
//
// THREE RULES SHAPE THE FILE, and each is a refusal the product exists to make.
//
//   1. A TYPE DISAGREEMENT IS REFUSED, NEVER COERCED (CAP-15). A `date` column
//      compared against `1000` yields an error naming *both* types and no table;
//      the Steps downstream then refuse by name rather than computing over a
//      silently coerced comparison. The check is here, at execution, because
//      `configureStep` cannot see an input schema — it exists only once the
//      Steps upstream have run.
//
//   2. THE VALUE IS CANONICAL MACHINE FORM. A number is a `number` (`1000`,
//      never `"1.000"`), a temporal value an ISO 8601 string. The entry controls
//      in `ui/` are locale-aware; what is stored and what crosses here is not.
//
//   3. "IS EMPTY" AND "IS NOT EMPTY" ARE COMPLEMENTS OVER NON-BOXED VALUES, and
//      the exception is stated rather than discovered. A strict complement would
//      smuggle every box through `not_empty` as non-empty text, which is exactly
//      the silent pass AD-22 exists to prevent. So a box matches neither, the
//      rows it excluded are counted, and the count travels as a warning.

import { error, info, warning } from '../diagnostics/diagnostic.js'
import { CODE } from './codes.js'

/**
 * The operator vocabulary, closed here and nowhere else.
 *
 * Closed rather than open because AD-30 forbids a formula, expression, query or
 * script surface anywhere in the MVP: a Filter is a select, a select and a typed
 * input, and this list is what the first select offers. Widening it is the same
 * shape of decision as widening `core/graph/kinds.js` — every operator needs a
 * type-agreement rule, a German word and a case in the matrix.
 */
export const OPERATORS = Object.freeze([
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'empty',
  'not_empty',
])

/** The two operators that take no value at all. A value beside one is a config
 *  shape error, not a comparison nobody meant. */
export const VALUELESS_OPERATORS = Object.freeze(['empty', 'not_empty'])

const VALUELESS = new Set(VALUELESS_OPERATORS)

/** How several conditions are combined. Explicit in the config and explicit in
 *  the UI: a default nobody chose is a rule nobody can see. */
export const COMBINES = Object.freeze(['all', 'any'])

/**
 * What kind of JavaScript a column's comparison value must be.
 *
 * The four temporal types all expect a **string**, because AD-21 holds their
 * values as `BigInt` nanoseconds and `core/` may not construct one — the ISO 8601
 * string is the canonical machine form that crosses the port, and the adapter
 * converts it once. So the disagreement this map catches is the one a person can
 * act on ("that column is a date and you typed a number"), and the narrower
 * question of whether a given string *reads* as a date is the adapter's answer.
 */
const EXPECTED_KIND = Object.freeze({
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'text',
  datetime: 'text',
  time: 'text',
  duration: 'text',
})

/** The value's own kind, in the same three words the map above is written in.
 *  `null` for anything that is not a comparison value at all — an object, an
 *  array, `undefined`, `NaN` — which is a config shape error rather than a
 *  disagreement between two types. */
export function valueKind(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'text'
  return null
}

const isName = (value) => typeof value === 'string' && value !== ''

/** The empty configuration a freshly added Filter carries: no condition, so
 *  every row passes. A Step that produced nothing until it was configured would
 *  make the whole chain downstream unreadable while it was being built. */
export const defaultConfig = () =>
  Object.freeze({ combine: 'all', conditions: Object.freeze([]) })

/**
 * Structural validation — the half that can be answered without an input table.
 *
 * Shape and vocabulary only: is `combine` one of two words, is `op` one of eight,
 * is `column` a name, does a valueless operator carry no value. Whether the value
 * *agrees with the column* is checked in `apply`, where the schema exists and the
 * refusal can name both types truthfully.
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
  if (!COMBINES.includes(config.combine)) refuse('combine', { value: String(config.combine) })
  if (!Array.isArray(config.conditions)) {
    refuse('conditions')
    return { ok: false, diagnostics: Object.freeze(out) }
  }

  config.conditions.forEach((condition, at) => {
    if (condition === null || typeof condition !== 'object') {
      refuse('condition', { at })
      return
    }
    if (!isName(condition.column)) refuse('column', { at })
    if (!OPERATORS.includes(condition.op)) {
      refuse('op', { at, value: String(condition.op) })
      return
    }
    if (VALUELESS.has(condition.op)) {
      if (condition.value !== undefined) refuse('value', { at, value: String(condition.value) })
    } else if (valueKind(condition.value) === null) {
      refuse('value', { at, value: String(condition.value) })
    }
  })

  return { ok: out.length === 0, diagnostics: Object.freeze(out) }
}

/**
 * AD-4's signature. `inputs` carries exactly one Table — the arity is the graph's
 * business (`core/graph/kinds.js` says a Filter takes one input) and the executor
 * has already refused a Step whose slot is empty.
 *
 * @param {import('../../ports/index.js').TableEngine} engine
 * @param {ReadonlyArray<import('../../ports/index.js').Table>} inputs
 * @param {object} config
 * @returns {{ table: object|null, diagnostics: ReadonlyArray<object> }}
 */
export function apply(engine, inputs, config) {
  const input = inputs[0]
  const typeOf = new Map(input.schema().map((column) => [column.name, column.type]))
  const conditions = config.conditions ?? []

  // Every condition is checked before any is evaluated, so a Filter with two
  // wrong conditions names both rather than the first one it tripped over.
  const refusals = []
  for (const condition of conditions) {
    const columnType = typeOf.get(condition.column)
    if (columnType === undefined) {
      refusals.push(error(CODE.unknownColumn, { column: condition.column }))
      continue
    }
    if (VALUELESS.has(condition.op)) continue
    const expected = EXPECTED_KIND[columnType]
    const actual = valueKind(condition.value)
    if (actual !== expected) {
      refusals.push(
        error(CODE.typeMismatch, {
          column: condition.column,
          columnType,
          valueType: actual ?? 'unknown',
        }),
      )
    }
  }
  if (refusals.length > 0) return { table: null, diagnostics: Object.freeze(refusals) }

  const outcome = engine.filter(input, { conditions, combine: config.combine ?? 'all' })

  // A temporal value that is not readable as ISO 8601 under its column's type.
  // The adapter is what discovers it, because the adapter is what converts — and
  // a filter nobody can evaluate produces no table rather than a different one.
  if (outcome.unreadable.length > 0) {
    return {
      table: null,
      diagnostics: Object.freeze(
        outcome.unreadable.map((at) =>
          error(CODE.valueUnreadable, { column: at.column, type: at.type, value: at.value }),
        ),
      ),
    }
  }

  const diagnostics = [
    info(CODE.rowsRemoved, { removed: outcome.removed, kept: outcome.table.rowCount() }),
  ]
  // The box never silently passes as text: the rows it excluded are counted and
  // said out loud, at this Step, beside its own preview.
  if (outcome.boxed > 0) diagnostics.push(warning(CODE.boxedRowsDropped, { rows: outcome.boxed }))

  return { table: outcome.table, diagnostics: Object.freeze(diagnostics) }
}

export const filterKind = Object.freeze({ defaultConfig, validate, apply })
