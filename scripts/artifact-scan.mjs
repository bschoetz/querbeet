// The text scans AD-18's gate is made of, separated from the script that runs
// them so that they can be tested.
//
// `assert-single-file.mjs` reads `dist/`, prints and exits — it is a program, and
// a program's reject path is not observable from a test. These are the parts with
// an answer: a string goes in, a verdict comes out. AD-17 has no other
// enforcement anywhere in this tree, so "the gate would have caught it" needs to
// be a failing test rather than a sentence about a probe somebody once ran.

/**
 * acorn's parse-error message for a trailing comma, which contains the
 * characters `import(` inside a string literal.
 *
 * `acorn` ships inside Arquero — `table/Table.js` reaches it through
 * `regroup.js` and the three verbs that file imports, so it is in the artefact
 * whichever table class the engine adapter builds against. The bundle contains
 * no dynamic import; a text scan cannot tell code from a sentence about code.
 */
export const ACORN_IMPORT_MESSAGE = 'Trailing comma is not allowed in import()'

/** Where this message's own `import(` stands inside it. The exception is pinned
 *  to that one offset and to nothing else — see below. */
const ACORN_IMPORT_AT = ACORN_IMPORT_MESSAGE.indexOf('import(')

/**
 * Every `import(` in `text` that is a dynamic import rather than acorn's
 * sentence — as offsets, so a failure can quote itself.
 *
 * **The exception is one offset per occurrence of the message, not a
 * neighbourhood**, and the difference is a hole rather than a nicety. A first cut
 * excused any `import(` whose ±41-byte window contained the message, which works
 * out to *every* offset from the message's own start to 41 bytes past it.
 * Measured on the built artefact: a genuine `import("./chunk.js")` written
 * directly against the sentence's closing parenthesis was **filtered out and the
 * gate reported zero**, while the identical string at byte 1,000 was caught. A
 * gate that is blind in a 41-byte window around a string a dependency happens to
 * ship is a gate that cannot be reasoned about — and the blind spot sits exactly
 * where a minifier would put an adjacent expression.
 *
 * So: find each occurrence of the exact sentence, compute the absolute offset of
 * the `import(` *inside it*, and excuse those offsets. Anything else — adjacent,
 * overlapping or far away — is a real occurrence. If acorn ever stops shipping
 * the message, nothing is excused and nothing else changes.
 */
export function dynamicImportSites(text) {
  const excused = new Set()
  for (
    let at = text.indexOf(ACORN_IMPORT_MESSAGE);
    at !== -1;
    at = text.indexOf(ACORN_IMPORT_MESSAGE, at + 1)
  ) {
    excused.add(at + ACORN_IMPORT_AT)
  }

  return [...text.matchAll(/\bimport\s*\(/g)]
    .map((m) => m.index)
    .filter((at) => !excused.has(at))
}

/** A window of `text` around `at`, for quoting a failure. Clamped at both ends:
 *  a negative `start` makes `slice` count from the *end* of the string, so a hit
 *  in the first forty bytes would be reported by quoting the file's tail under a
 *  head offset — a wrong answer wearing a precise number. */
export const quoteAround = (text, at, radius = 40) =>
  text.slice(Math.max(0, at - radius), Math.min(text.length, at + radius))
