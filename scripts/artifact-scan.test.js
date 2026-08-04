// AD-18's gate, in the node envelope (AD-27).
//
// This is the only enforcement AD-17 has anywhere in the tree — nothing is
// fetched, nothing is lazily imported — and until this file existed its *reject*
// path was evidenced by a sentence saying somebody had once injected a fake
// chunk into a built artefact by hand. A gate whose refusal nobody can re-run is
// a gate that will rot exactly when it is loosened, which is what happened: an
// exception added for acorn's error message turned out to excuse a genuine
// dynamic import standing five bytes away from it, and the artefact still
// reported clean.
//
// So the cases below are the two that matter and the one that broke.

import { describe, expect, it } from 'vitest'
import { ACORN_IMPORT_MESSAGE, dynamicImportSites, quoteAround } from './artifact-scan.mjs'

/** A minified bundle, roughly the shape the real one has where it matters. */
const bundle = (...parts) => `!function(){${parts.join(';')}}();`

describe('the dynamic-import scan', () => {
  it('finds nothing in a bundle that has none', () => {
    expect(dynamicImportSites(bundle('var a=1', 'export{a}'))).toEqual([])
  })

  it('finds a real one, and says where', () => {
    const text = bundle('var z=()=>import("./chunk.js")')

    expect(dynamicImportSites(text)).toHaveLength(1)
    expect(text.slice(dynamicImportSites(text)[0], dynamicImportSites(text)[0] + 7)).toBe('import(')
  })

  it('excuses acorn’s message, which is a sentence about code rather than code', () => {
    // The occurrence this exception exists for, alone in a file.
    const text = bundle(`this.raiseRecoverable(t,\`${ACORN_IMPORT_MESSAGE}\`)`)

    expect(dynamicImportSites(text)).toEqual([])
  })

  it('excuses every occurrence of it, not merely the first', () => {
    const one = `\`${ACORN_IMPORT_MESSAGE}\``
    expect(dynamicImportSites(bundle(one, 'var a=1', one, one))).toEqual([])
  })

  it('catches a real one standing right beside acorn’s message — the measured hole', () => {
    // Measured against the built artefact before this was pinned: a genuine
    // `import("./chunk.js")` written directly against the sentence's closing
    // parenthesis was filtered out and the gate reported zero (byte 476,125),
    // while the identical string at byte 1,000 was caught. The old rule excused
    // every offset from the message's own start to 41 bytes past it — which is
    // exactly where a minifier puts an adjacent expression. The exception is one
    // offset per message now, not a window.
    for (const gap of ['', ';', ';var a=1;', ' '.repeat(39)]) {
      const text = bundle(`\`${ACORN_IMPORT_MESSAGE}\`${gap}var z=()=>import("./chunk.js")`)

      expect(dynamicImportSites(text), `gap of ${gap.length}`).toHaveLength(1)
    }
  })

  it('catches one abutting the sentence with no separator at all', () => {
    // The exact shape the artefact probe used: `…in import()import("./chunk.js")`.
    // `)` then `i` is a word boundary, so the regex sees it; the old window did
    // not, because the message started 41 bytes earlier.
    const text = bundle(`\`${ACORN_IMPORT_MESSAGE}import("./chunk.js")\``)

    expect(dynamicImportSites(text)).toHaveLength(1)
  })

  it('catches one standing immediately *before* the message too', () => {
    const text = bundle(`var z=()=>import("./chunk.js");\`${ACORN_IMPORT_MESSAGE}\``)

    expect(dynamicImportSites(text)).toHaveLength(1)
  })

  it('reads `import (` with a space, which is the same expression', () => {
    expect(dynamicImportSites('var z=import ("./chunk.js")')).toHaveLength(1)
  })

  it('is not fooled by a word ending in import', () => {
    expect(dynamicImportSites('var z=reimport(1)')).toEqual([])
  })
})

describe('quoting a failure', () => {
  it('shows the neighbourhood of the hit', () => {
    const text = `${'x'.repeat(100)};import("./a.js")${'y'.repeat(100)}`
    const [at] = dynamicImportSites(text)

    expect(quoteAround(text, at)).toContain('import("./a.js")')
    expect(quoteAround(text, at)).toHaveLength(80)
  })

  it('clamps at the head rather than quoting the tail under a head offset', () => {
    // `slice(-38, 42)` counts the start from the *end* of the string, so an
    // unclamped quote of a hit at byte 2 would print the end of the file beside
    // the number 2 — a wrong answer wearing a precise number.
    const text = `//import("./a.js")${'y'.repeat(500)}TAIL`
    const [at] = dynamicImportSites(text)

    expect(at).toBe(2)
    expect(quoteAround(text, at)).toContain('import("./a.js")')
    expect(quoteAround(text, at)).not.toContain('TAIL')
  })

  it('clamps at the tail as well', () => {
    const text = `${'y'.repeat(500)};import("./a.js")`
    const [at] = dynamicImportSites(text)

    expect(quoteAround(text, at).endsWith('import("./a.js")')).toBe(true)
  })
})
