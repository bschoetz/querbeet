// The type vocabulary — declared here and nowhere else.
//
// Before this file the vocabulary was spread over four places: the `TEXT` /
// `NUMBER` / `DATE` constants in `typing.js`, the `SETTABLE_TYPES` guard in
// `core/exec/source-store.js`, the `TYPE_LABEL` map in `ui/SourcesPane.vue` and
// the `isSettable` predicate beside it. Four partial copies of one list is a
// forgotten branch waiting to happen, and the branch that was waiting is the one
// this file closes: `detectColumn` took everything after `native:` verbatim, and
// `SETTABLE_TYPES` guarded only the command path, so a reader was the one
// producer that could carry an unknown type word through a confirmed typing and
// into story 6's conversion. Parquet delivers TIME, INTERVAL, DECIMAL and INT96
// from real files; the list closes here or it never closes.
//
// Each record carries three facts and nothing else:
//
//   code      the machine word, which is what a Table and a Recipe hold
//   settable  whether a *user* may choose it for a column
//   native    whether a *reader* may declare it as `native:<code>` (AD-20)
//
// The two flags are independent on purpose, and story 4a is where they come
// apart in the other direction. `datetime` and `boolean` were display-only while
// only a reader could produce them; now that detection reaches them from text
// they are settable too, and the same table is typed whether it arrives as XLSX
// or as CSV. `time` and `duration` go the other way: a user may choose either,
// and **no reader may declare one** — Parquet's TIME is still a refused
// declaration (story 4's closed list), and nothing in `adapters/` says the word.
// And `text` is never a native declaration — a reader that delivers strings
// declares the domain `text`, not `native:text`.
//
// German words for these codes live in `ui/` (AD-13). This file is the list they
// are keyed off, so a type without a word is a failing test rather than a raw
// English word on a Source card.

export const TEXT = 'text'
export const NUMBER = 'number'
export const DATE = 'date'
export const DATETIME = 'datetime'
export const TIME = 'time'
export const DURATION = 'duration'
export const BOOLEAN = 'boolean'

/** The prefix a reader's domain declaration carries in front of a type (AD-20). */
export const NATIVE_PREFIX = 'native:'

export const TYPES = Object.freeze([
  Object.freeze({ code: TEXT, settable: true, native: false }),
  Object.freeze({ code: NUMBER, settable: true, native: true }),
  Object.freeze({ code: DATE, settable: true, native: true }),
  Object.freeze({ code: DATETIME, settable: true, native: true }),
  Object.freeze({ code: TIME, settable: true, native: false }),
  Object.freeze({ code: DURATION, settable: true, native: false }),
  Object.freeze({ code: BOOLEAN, settable: true, native: true }),
])

const BY_CODE = new Map(TYPES.map((type) => [type.code, type]))

/** Every type the product knows, in the order a caller may present them. */
export const typeCodes = () => Object.freeze(TYPES.map((type) => type.code))

/** The types a user may choose, in the order a select may offer them. */
export const settableTypes = () => Object.freeze(TYPES.filter((t) => t.settable).map((t) => t.code))

/** May a command set this type on a column? */
export const isSettableType = (code) => BY_CODE.get(code)?.settable === true

/** May a reader declare this type as `native:<code>`? */
export const isNativeType = (code) => BY_CODE.get(code)?.native === true

/** How a reader spells a native declaration for a type. */
export const nativeDomain = (type) => `${NATIVE_PREFIX}${type}`

/** Whatever a domain declares after `native:`, admissible or not, or `null`. */
export function declaredNativeType(domain) {
  return typeof domain === 'string' && domain.startsWith(NATIVE_PREFIX)
    ? domain.slice(NATIVE_PREFIX.length)
    : null
}

/**
 * The native type a domain declares, **only if the catalogue admits it**.
 *
 * This is the predicate everything else guards by — the retype refusal and the
 * pane's type select. A domain the catalogue does not admit is not a native
 * column at all: `core/types/typing.js` discards the declaration down to `text`
 * on the way in, so a domain that ever reaches a column record, a Recipe or a
 * conversion is either `text` or a type this list admits.
 *
 * There is deliberately no second function for the refused case. The word a
 * declaration was refused for is carried on the column record as
 * `refusedNativeType`, set once where the declaration is read; asking a domain
 * for it again would be a second answer to a question already settled, and the
 * domain no longer holds the word to answer with.
 */
export function nativeTypeOf(domain) {
  const declared = declaredNativeType(domain)
  return declared !== null && isNativeType(declared) ? declared : null
}
