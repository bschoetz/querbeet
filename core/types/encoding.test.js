// The ladder under Vitest with no browser (AD-2, AD-27). The fixtures are exact
// bytes, because encoding tests through string literals test the editor's
// save-encoding rather than the ladder.

import { describe, expect, it } from 'vitest'
import { ENCODINGS, decode, decodeBytes, detectEncoding } from './encoding.js'

const utf8 = (s) => new TextEncoder().encode(s)
const bytes = (...b) => new Uint8Array(b)

describe('the ladder', () => {
  it('a UTF-8 BOM decides outright and is stripped', () => {
    const r = decode(bytes(0xef, 0xbb, 0xbf, 0xc3, 0xa4))

    expect(r.chosen).toBe('utf-8')
    expect(r.source).toBe('bom')
    expect(r.text).toBe('ä')
    expect(r.text).not.toContain('﻿')
  })

  it('a UTF-16LE BOM decides outright and is stripped', () => {
    const r = decode(bytes(0xff, 0xfe, 0xe4, 0x00, 0xac, 0x20))

    expect(r).toMatchObject({ chosen: 'utf-16le', source: 'bom', text: 'ä€' })
  })

  it('a UTF-16BE BOM decides outright and is stripped', () => {
    const r = decode(bytes(0xfe, 0xff, 0x00, 0xe4, 0x20, 0xac))

    expect(r).toMatchObject({ chosen: 'utf-16be', source: 'bom', text: 'ä€' })
  })

  it('valid UTF-8 without a BOM passes the strict probe', () => {
    const r = decode(utf8('Bäcker, 12 €'))

    expect(r).toMatchObject({ chosen: 'utf-8', source: 'probe', text: 'Bäcker, 12 €' })
  })

  it('invalid UTF-8 falls back to Windows-1252 — ä and € land correctly', () => {
    // 0xe4 = ä, 0x80 = € in CP1252; as UTF-8 the sequence is invalid.
    const r = decode(bytes(0x42, 0xe4, 0x63, 0x6b, 0x65, 0x72, 0x20, 0x80))

    expect(r).toMatchObject({ chosen: 'windows-1252', source: 'fallback', text: 'Bäcker €' })
  })

  it('accepts an ArrayBuffer, which is what ui/ hands over (AD-3)', () => {
    const buffer = utf8('ä').buffer

    expect(decode(buffer).text).toBe('ä')
    expect(detectEncoding(buffer).source).toBe('probe')
  })
})

describe('the override', () => {
  it('re-reads the same bytes under a different encoding', () => {
    const b = utf8('ä') // 0xc3 0xa4

    expect(decodeBytes(b, 'utf-8')).toBe('ä')
    expect(decodeBytes(b, 'windows-1252')).toBe('Ã¤')
  })

  it('refuses a label outside the override list', () => {
    // ISO-8859-1 is the WHATWG label for the 1252 decoder — the list carries
    // windows-1252 once instead of two spellings of the same thing.
    expect(() => decodeBytes(utf8('x'), 'iso-8859-1')).toThrow(TypeError)
    expect(() => decodeBytes(utf8('x'), 'utf-32')).toThrow(TypeError)
  })

  it('offers a fixed, frozen list for the UI to render', () => {
    expect(Object.isFrozen(ENCODINGS)).toBe(true)
    expect(ENCODINGS).toEqual(['utf-8', 'windows-1252', 'utf-16le', 'utf-16be'])
  })
})
