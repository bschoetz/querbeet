// The Step vocabulary — declared here and nowhere else.
//
// It is the shape `core/types/catalog.js` established one story earlier, for the
// same reason: a list that lives in four places grows a forgotten branch, and the
// branch that would be waiting here is arity. "Union takes two or more, Join
// takes exactly two, the rest take exactly one" (CAP-12) is a property of the
// data, not a rule checked afterwards — the slots exist because the kind says how
// many there are, and `connect` addresses one by position.
//
// Each record carries four facts and nothing else:
//
//   code       the machine word, which is what the graph and later a Recipe hold
//   minInputs  how many filled slots the kind needs before it is complete
//   maxInputs  how many slots it may ever have; `Infinity` for Union
//   addable    whether the Editor's toolbar may create one
//
// `addable` is false for exactly one kind. A Source node is *reconciled* from the
// Source store rather than added (see `syncSources` in `graph-store.js`): two
// stores that both mint Source nodes would disagree the first time a read fails.
//
// No labels and no configuration. German words for these codes live in `ui/`
// (AD-13), and Step bodies — a Filter's conditions, a Join's keys — belong to
// stories 6, 8 and 9. Every addition here enlarges the Recipe format at the point
// a language model must get it right (C-12), which is why widening this list is
// an Ask First rather than an edit.

export const SOURCE = 'source'
export const UNION = 'union'
export const JOIN = 'join'
export const FILTER = 'filter'
export const COLUMNS = 'columns'
export const SORT = 'sort'
export const FIRST = 'first'
export const COMPUTED = 'computed'
export const AGGREGATE = 'aggregate'

// `sort` and `first` join the list beside `columns` rather than at the end, and
// the position is the SPEC's: CAP-40 is written after CAP-16 because it is the
// same promise about rows that CAP-16 makes about columns, and this list has
// followed the capability order since it was cut. The order is what the toolbar
// offers and what `executorGaps()` reports in, so it is a visible fact rather
// than an internal one.
//
// **Two kinds rather than one**, decided 2026-08-04 with the project owner:
// sorting alone only reorders and the owner's case — *take the ten newest
// records and carry them on* — needs both, so each stays one verb and they
// compose. There is deliberately no "letzte N": descending plus *Erste N* is the
// same thing, and a second verb would be a second thing to explain.
export const KINDS = Object.freeze([
  Object.freeze({ code: SOURCE, minInputs: 0, maxInputs: 0, addable: false }),
  Object.freeze({ code: UNION, minInputs: 2, maxInputs: Infinity, addable: true }),
  Object.freeze({ code: JOIN, minInputs: 2, maxInputs: 2, addable: true }),
  Object.freeze({ code: FILTER, minInputs: 1, maxInputs: 1, addable: true }),
  Object.freeze({ code: COLUMNS, minInputs: 1, maxInputs: 1, addable: true }),
  Object.freeze({ code: SORT, minInputs: 1, maxInputs: 1, addable: true }),
  Object.freeze({ code: FIRST, minInputs: 1, maxInputs: 1, addable: true }),
  Object.freeze({ code: COMPUTED, minInputs: 1, maxInputs: 1, addable: true }),
  Object.freeze({ code: AGGREGATE, minInputs: 1, maxInputs: 1, addable: true }),
])

const BY_CODE = new Map(KINDS.map((kind) => [kind.code, kind]))

/** Every Step kind the product knows, in the order a caller may present them. */
export const kindCodes = () => Object.freeze(KINDS.map((kind) => kind.code))

/** The kinds a toolbar may offer. Source is absent: it is reconciled, not added. */
export const addableKinds = () =>
  Object.freeze(KINDS.filter((kind) => kind.addable).map((kind) => kind.code))

/**
 * The record for a kind, or `null` for a kind this list does not know.
 *
 * `null` rather than a throw, and **every caller dereferences it only after
 * guarding**. Story 14's loader builds nodes out of a file, so an unknown kind is
 * a state of the data rather than a caller's bug — and a `TypeError` out of the
 * model is not a Diagnostic anyone can render.
 */
export const kindSpec = (code) => BY_CODE.get(code) ?? null

/** Whether the toolbar may create this kind. Unknown kinds answer `false`. */
export const isAddableKind = (code) => BY_CODE.get(code)?.addable === true
