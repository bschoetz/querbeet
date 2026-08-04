// Every code a Step kind emits, as constants used at their own emit sites.
//
// It is `core/graph/graph.js`'s `CODE`/`GRAPH_CODES` pattern, and it is here in a
// file of its own for the one reason that pattern exists: `ui/graph-labels.js`
// owes a completeness invariant, and an invariant with nothing to check against
// is a test that cannot fail. Two Step kinds share half of these codes — an
// unknown column and an invalid config are the same finding whichever kind made
// it — so the enumeration cannot live inside either file without the other one
// importing it anyway.
//
// The rule the enumeration keeps: a code that is not in this map is a code no
// Step kind can name, because every emit site spells it as `CODE.something`.

export const CODE = Object.freeze({
  // configure time — structural, checkable without an input schema
  configInvalid: 'step.config_invalid',
  renameCollision: 'step.rename_collision',

  // execution — checkable only once the input schema exists
  unknownColumn: 'step.unknown_column',
  typeMismatch: 'step.type_mismatch',
  valueUnreadable: 'step.value_unreadable',

  // execution — what a Step did, as numbers (AD-13)
  rowsRemoved: 'step.rows_removed',
  boxedRowsDropped: 'step.boxed_rows_dropped',
})

/** The enumeration `ui/graph-labels.js` checks itself against. */
export const STEP_CODES = Object.freeze(Object.values(CODE))
