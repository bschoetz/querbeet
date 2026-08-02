// The German word for every type in the catalogue (AD-13, C-6).
//
// It lives in ui/ because core/ emits codes and never prose, and it lives in its
// own file because completeness is the property worth testing: a type added to
// `core/types/catalog.js` without a word here should fail a test, not print
// `datetime` on a Source card in a German interface.
//
// Two of these words label types no user can choose. `datetime` and `boolean`
// are display-only for now — XLSX and Parquet deliver them, and a natively typed
// column still has to say what it is.

import { TYPES } from '@core/types/catalog.js'

const LABEL = Object.freeze({
  text: 'Text',
  number: 'Zahl',
  date: 'Datum',
  datetime: 'Zeitstempel',
  boolean: 'Wahrheitswert',
})

/** The German word for a type code. Falls back to the code itself, which is the
 *  state `typeLabelGaps` exists to keep out of a release. */
export const typeLabel = (code) => LABEL[code] ?? code

/** Every catalogue type this file has no German word for. Empty is the rule. */
export const typeLabelGaps = () =>
  TYPES.filter((type) => LABEL[type.code] === undefined).map((type) => type.code)

/** `[code, label]` for the types a user may choose, in catalogue order. */
export const settableTypeLabels = () =>
  TYPES.filter((type) => type.settable).map((type) => [type.code, typeLabel(type.code)])
