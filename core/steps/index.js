// The Step kind registry — one file per kind under `core/steps/`, and this is
// where they are declared to exist.
//
// It is deliberately a *second* table beside `core/graph/kinds.js` rather than a
// widening of it. `kinds.js` is arity and nothing else — how many slots a kind
// has is a property of the graph and is what `connect` addresses by position —
// while this table is behaviour: what a kind does with its inputs, what a valid
// configuration for it looks like, and what a fresh one starts as. Merging them
// would put an executor inside the module the graph reads on every commit, and
// would make "which kinds can run" a fact about a list nobody can query.
//
// **The gap between the two tables is the answer to a real question**, which is
// why `executorGaps()` is exported rather than derived at the call site: story
// 6b's frontier can contain a Union, and the run has to refuse *naming the Step
// and its kind* rather than crash on a missing function. Stories 8 and 9 close
// the gap by adding files here; nothing else changes.
//
// Each record is AD-4's contract:
//
//   defaultConfig()               what a freshly added Step of this kind carries
//   validate(config)              structural shape, checkable with no input table
//   apply(engine, inputs, config) `{ table, diagnostics }`, pure and synchronous

import { COLUMNS, FILTER, FIRST, SORT, SOURCE, kindCodes } from '../graph/kinds.js'
import { columnsKind } from './columns.js'
import { filterKind } from './filter.js'
import { firstKind } from './first.js'
import { sortKind } from './sort.js'

export { CODE, STEP_CODES } from './codes.js'

const REGISTRY = new Map([
  [FILTER, filterKind],
  [COLUMNS, columnsKind],
  [SORT, sortKind],
  [FIRST, firstKind],
])

/** The executor for a kind, or `null` for a kind no file here implements.
 *
 *  `null` rather than a throw, and every caller guards before dereferencing: the
 *  frontier of a run is data, so a kind without an executor is a state of the
 *  graph rather than a caller's bug — and a `TypeError` out of the executor is
 *  not a Diagnostic anyone can render. */
export const stepKind = (code) => REGISTRY.get(code) ?? null

/** Whether this kind can be executed at all. */
export const hasExecutor = (code) => REGISTRY.has(code)

/**
 * Every Step kind the graph knows that no file here implements, in catalogue
 * order.
 *
 * A Source is absent and is not a gap: its conversion is Step zero (AD-7), which
 * runs through `core/exec/convert.js` and the cache in front of it rather than
 * through a Step kind. What is left after that is exactly the stories still to
 * come, which is what makes this list a schedule as much as an invariant.
 */
export const executorGaps = () =>
  Object.freeze(kindCodes().filter((code) => code !== SOURCE && !REGISTRY.has(code)))
