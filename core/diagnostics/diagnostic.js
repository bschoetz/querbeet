// AD-13 — diagnostics have one shape, and the core emits no prose.
//
// Every Step, loader and validator emits this shape and nothing else. FR-34's run
// status is the aggregation of the stream and adds nothing of its own.
//
// `core/` emits codes and values; `ui/` renders the German text (C-6). That split
// is what keeps German strings out of a framework-free core, and what lets a row
// count travel as a number rather than inside a sentence — so the run status can
// aggregate what its Steps reported instead of re-parsing it.

/**
 * @typedef {'info' | 'warning' | 'error' | 'unresolved'} Severity
 *
 * `unresolved` is the fourth severity and it earns its place: CAP-9's "nothing in
 * this column settles the reading" and CAP-22's "doubtful" are neither warnings
 * nor errors. They are states awaiting a person, and collapsing them into
 * `warning` would let a run look merely noisy when it is in fact undecided.
 */

/**
 * @typedef {object} Diagnostic
 * @property {Severity} severity
 * @property {string}   code      Stable and machine-readable. Never a sentence.
 * @property {Readonly<Record<string, unknown>>} values  Structured, so counts stay numbers.
 * @property {string}   [stepId]
 * @property {string}   [sourceId]
 */

/** @type {ReadonlySet<Severity>} */
export const SEVERITIES = new Set(['info', 'warning', 'error', 'unresolved'])

/**
 * Mint a Diagnostic. Frozen, because it crosses Step boundaries and lands in a
 * cache entry alongside the table it describes (AD-8) — a mutable one would let a
 * cache hit replay something other than what the run emitted.
 *
 * @param {Severity} severity
 * @param {string} code
 * @param {Record<string, unknown>} [values]
 * @param {{ stepId?: string, sourceId?: string }} [origin]
 * @returns {Readonly<Diagnostic>}
 */
export function diagnostic(severity, code, values = {}, origin = {}) {
  if (!SEVERITIES.has(severity)) {
    throw new TypeError(`unknown severity: ${severity}`)
  }
  if (typeof code !== 'string' || code.length === 0) {
    throw new TypeError('a diagnostic needs a stable, machine-readable code')
  }

  /** @type {Diagnostic} */
  const d = { severity, code, values: Object.freeze({ ...values }) }
  if (origin.stepId !== undefined) d.stepId = origin.stepId
  if (origin.sourceId !== undefined) d.sourceId = origin.sourceId

  return Object.freeze(d)
}

export const info = (code, values, origin) => diagnostic('info', code, values, origin)
export const warning = (code, values, origin) => diagnostic('warning', code, values, origin)
export const error = (code, values, origin) => diagnostic('error', code, values, origin)
export const unresolved = (code, values, origin) => diagnostic('unresolved', code, values, origin)

/**
 * The run status of CAP-34 is this and nothing more: whether the run was clean,
 * and the stream that decided it. A run with warnings must be distinguishable at
 * a glance from a clean one without opening the Editor, so `clean` is computed
 * here rather than left to a caller's interpretation of the list.
 *
 * @param {ReadonlyArray<Diagnostic>} diagnostics
 */
export function runStatus(diagnostics) {
  const counts = { info: 0, warning: 0, error: 0, unresolved: 0 }
  for (const d of diagnostics) counts[d.severity] += 1

  return Object.freeze({
    clean: counts.warning === 0 && counts.error === 0 && counts.unresolved === 0,
    counts: Object.freeze(counts),
    diagnostics: Object.freeze([...diagnostics]),
  })
}
