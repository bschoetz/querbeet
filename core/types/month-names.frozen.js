// The month table as it was measured on 2026-08-03, frozen as a literal.
//
// WHY THIS FILE EXISTS. `core/types/typing.js` derives its month names from
// `Intl` at runtime, which is right: the table then follows the engine the
// product is actually running in. What runtime derivation cannot do is notice
// that the engine changed. An ICU update that respells one month would turn a
// typed column back into text with nothing to report — the derivation would
// still be internally consistent, the values would simply stop matching.
//
// So the measurement is committed here and a unit test compares the two. A
// change in ICU is then a **failing test naming the month and both spellings**,
// which is a decision to be taken, rather than a column that silently falls back
// to text in front of a user. It is the same move `tests/fixtures/`'s workbooks
// make for the reader adapters — a fixture whose whole job is to fail the day
// something moves underneath it — and it is committed as a module rather than as
// bytes under `tests/fixtures/` because a month table is plain data an in-repo
// writer can produce.
//
// This file is imported by `typing.test.js` and by nothing else. Nothing in the
// product may read it: the day it is used as the table, the derivation stops
// being derived and this stops being an independent measurement.
//
// HOW TO RE-MEASURE. `node _bmad-output/planning-artifacts/spikes/
// intl-month-names-2026-08-03/run-spike.mjs` from the repo root re-runs the
// original apparatus across all three engines and prints a disagreement count.
// Update this file only from that run, and only together with the engine stamps
// below — a fixture whose provenance has been edited away proves nothing.

/** The three engines the product matrix runs in, and what they were when this
 *  table was measured. They are here so a failure can name what moved: a Node
 *  bump and a browser bump are different findings with different consequences,
 *  and `core/` runs under Vitest with `environment: 'node'` (AD-27), so **the
 *  table the unit tests see is Node's ICU, not the browser's**. A disagreement
 *  between Node and a browser is otherwise a test that passes green while the
 *  product fails. */
export const MEASURED_ENGINES = Object.freeze([
  Object.freeze({ name: 'node', version: 'v26.5.1', icu: '78.3', unicode: '17.0', tz: '2026a' }),
  Object.freeze({ name: 'chromium', version: '151.0.7922.34' }),
  Object.freeze({ name: 'firefox', version: '153.0' }),
])

/** The locales and widths the table is derived over — the axes of the
 *  measurement, so a fixture that matches on content while the derivation
 *  quietly dropped an axis still fails. */
export const MEASURED_LOCALES = Object.freeze(['de-DE', 'en-US', 'en-GB'])
export const MEASURED_WIDTHS = Object.freeze(['short', 'long'])

/** The normalization the union is unambiguous *under*. It is part of the
 *  measurement rather than a note about it: `Sept.` and `Sept` collapse to one
 *  spelling only because of this rule, and without it the collision count below
 *  is a claim about a different table. */
export const MEASURED_NORMALIZATION = 'toLocaleLowerCase("de-DE"), trailing "." dropped'

/**
 * Every raw CLDR spelling per month, in derivation order — locale by locale as
 * `MEASURED_LOCALES` lists them, short before long, each distinct string once.
 * Index 0 is January.
 *
 * Forty raw strings, **34 distinct once normalized, 0 of them meaning two
 * months**. The three spellings of September in one row — `Sept.` (de-DE),
 * `Sep` (en-US), `Sept` (en-GB) — are the measurement that decided this is a
 * *set* per month rather than one string per month, and they are all present
 * today rather than feared for tomorrow.
 */
export const MEASURED_SPELLINGS = Object.freeze([
  Object.freeze(['Jan.', 'Januar', 'Jan', 'January']),
  Object.freeze(['Feb.', 'Februar', 'Feb', 'February']),
  Object.freeze(['März', 'Mar', 'March']),
  Object.freeze(['Apr.', 'April', 'Apr']),
  Object.freeze(['Mai', 'May']),
  Object.freeze(['Juni', 'Jun', 'June']),
  Object.freeze(['Juli', 'Jul', 'July']),
  Object.freeze(['Aug.', 'August', 'Aug']),
  Object.freeze(['Sept.', 'September', 'Sep', 'Sept']),
  Object.freeze(['Okt.', 'Oktober', 'Oct', 'October']),
  Object.freeze(['Nov.', 'November', 'Nov']),
  Object.freeze(['Dez.', 'Dezember', 'Dec', 'December']),
])

/** Distinct spellings after normalization, and spellings meaning two months.
 *  Counted rather than eyeballed, and asserted separately from the table above
 *  so a table that grows without colliding still says by how much. */
export const MEASURED_DISTINCT_SPELLINGS = 34
export const MEASURED_COLLISIONS = 0

/** The literal `formatToParts` puts after the day part, trimmed: `". "` for
 *  de-DE, `", "` for en-US, `" "` for en-GB. The empty one is what en-GB's
 *  bare space becomes, and it is in the measurement because it is what makes
 *  `2 Aug 2026` a shape with no trailing mark at all. */
export const MEASURED_DAY_TRAILERS = Object.freeze(['.', ','])
