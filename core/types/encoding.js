// CAP-2 — the encoding ladder. ui/ hands over an ArrayBuffer and a name (AD-3);
// deciding what those bytes say happens here in core/, so the decision is
// testable without a browser and identical for every path a file enters through.
//
// The ladder has three rungs and no library (R3):
//
//   1. A BOM decides outright and is stripped.
//   2. A strict UTF-8 probe — TextDecoder('utf-8', { fatal: true }) — accepts or
//      rejects the whole byte sequence. UTF-8 is self-validating; random CP1252
//      umlaut bytes are invalid UTF-8, so a pass is strong evidence.
//   3. Everything else reads as Windows-1252, the encoding of the German Excel
//      export this product exists for.
//
// A heuristic detection library fails as a confident wrong answer, which is
// exactly what CAP-2's visible override exists to avoid — so the ladder is
// deliberately this small and the override list below is the escape hatch.
// TextDecoder is a JS primitive, not a browser API; AD-2 allows it here.
//
// ISO-8859-1 is deliberately absent from the override list: WHATWG maps that
// label onto the Windows-1252 decoder, and real files labelled ISO-8859-1 are
// almost always 1252 in practice — one list entry, not two spellings of it.

/** The encodings a user may override to (CAP-2). */
export const ENCODINGS = Object.freeze(['utf-8', 'windows-1252', 'utf-16le', 'utf-16be'])

const BOMS = [
  { encoding: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
  { encoding: 'utf-16le', bytes: [0xff, 0xfe] },
  { encoding: 'utf-16be', bytes: [0xfe, 0xff] },
]

const toView = (bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))

/**
 * Rungs 1–3, without decoding: which encoding, and which rung decided.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ chosen: string, source: 'bom' | 'probe' | 'fallback' }}
 */
export function detectEncoding(bytes) {
  const view = toView(bytes)

  for (const { encoding, bytes: bom } of BOMS) {
    if (view.length >= bom.length && bom.every((b, i) => view[i] === b)) {
      return { chosen: encoding, source: 'bom' }
    }
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(view)
    return { chosen: 'utf-8', source: 'probe' }
  } catch {
    // Windows-1252 maps every byte value, so this rung cannot fail.
    return { chosen: 'windows-1252', source: 'fallback' }
  }
}

/**
 * Decode with a named encoding from the override list. A BOM matching the
 * encoding is stripped by the decoder itself; under a non-matching override the
 * BOM bytes render as characters — visible rather than wrong, since the user
 * asked to see these bytes under that reading.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {string} encoding  one of ENCODINGS
 * @returns {string}
 */
export function decodeBytes(bytes, encoding) {
  if (!ENCODINGS.includes(encoding)) {
    throw new TypeError(`unknown encoding: ${encoding}`)
  }
  return new TextDecoder(encoding).decode(toView(bytes))
}

/**
 * The whole ladder: detect, decode, report which rung decided.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ text: string, chosen: string, source: 'bom' | 'probe' | 'fallback' }}
 */
export function decode(bytes) {
  const { chosen, source } = detectEncoding(bytes)
  return { text: decodeBytes(bytes, chosen), chosen, source }
}
