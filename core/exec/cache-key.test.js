// What a Step is, as a key (AD-8), under Vitest with no browser (AD-2, AD-27).
//
// Two properties carry this file.
//
//   DIFFERENT VALUES ARE DIFFERENT KEYS. Every case that matters is a pair that
//   a lazier encoding would collide: `1` against `"1"`, a string ending in a
//   tag character against the next field, two objects whose fields were merely
//   written in a different order. A collision here is not a slow path — it is
//   one Step's table served as another's.
//
//   THE SAME VALUE IS THE SAME KEY, whatever it is called and wherever it sits.
//   A Source id, a Step name and a position are absent from every key by
//   construction, and the matrix row this suite owns outright — *a different
//   file read into the same Source id* — is a property of `sourceKey` and is
//   tested here, because no store command can produce that state: a new file is
//   a new `addSource` with a newly minted id, and AD-14 never reuses one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CanonicalRefusal,
  canonical,
  digest,
  digestBytes,
  forgetRefusals,
  keyOrNull,
  sourceKey,
  stepKey,
} from './cache-key.js'

const utf8 = (s) => new TextEncoder().encode(s).buffer

const PARSE = Object.freeze({ delimiter: ',', headerRow: 1, sheet: null })
const UTF8 = Object.freeze({ chosen: 'utf-8', source: 'probe', override: null })

const entry = (over = {}) => ({
  byteDigest: digestBytes(utf8('Kunde,Betrag\nAnna,1000')),
  parseConfig: PARSE,
  encoding: UTF8,
  ...over,
})

describe('canonical', () => {
  it('gives every kind of value its own tag, so three spellings of one are three keys', () => {
    const keys = new Set([canonical(1), canonical('1'), canonical(true), canonical(null)])
    expect(keys.size).toBe(4)
  })

  it('is unambiguous where a naive concatenation is not', () => {
    // The classic pair: without a length in front of a string, `['b1', null]`
    // and `['b', '1n']` are one flat string apart from each other by luck.
    expect(canonical(['b1', null])).not.toBe(canonical(['b', '1n']))
    expect(canonical({ a: 'b', c: 'd' })).not.toBe(canonical({ ab: '', cd: '' }))
  })

  it('sorts object keys, so two configs that differ only in write order are one', () => {
    expect(canonical({ combine: 'all', conditions: [] })).toBe(
      canonical({ conditions: [], combine: 'all' }),
    )
  })

  it('keeps array order, because a slot order is not a set', () => {
    expect(canonical(['a', 'b'])).not.toBe(canonical(['b', 'a']))
  })

  it('walks a whole Filter config, nested arrays and all', () => {
    const config = {
      combine: 'all',
      conditions: [
        { column: 'Betrag', op: 'gt', value: 1000 },
        { column: 'Kunde', op: 'eq', value: 'Anna' },
      ],
    }
    const copy = () => JSON.parse(JSON.stringify(config))
    expect(canonical(config)).toBe(canonical(copy()))
    const moved = copy()
    moved.conditions[0].value = 1001
    expect(canonical(moved)).not.toBe(canonical(config))
  })

  it('renders a number the one way every engine renders it', () => {
    expect(canonical(0.1 + 0.2)).toBe(canonical(0.30000000000000004))
    expect(canonical(1e21)).toBe('#1e+21;')
    // `-0` and `0` are one key, and that is a merge rather than a fault: they
    // compute the same table everywhere a config can hold a number.
    expect(canonical(-0)).toBe(canonical(0))
  })

  it('refuses what it cannot encode deterministically, naming the path', () => {
    expect(() => canonical({ conditions: [{ value: new Date(0) }] })).toThrow(
      /Date at \$\.conditions\[0\]\.value/,
    )
    expect(() => canonical({ n: 1n })).toThrow(/BigInt at \$\.n/)
    expect(() => canonical({ a: [undefined] })).toThrow(/undefined at \$\.a\[0\]/)
    expect(() => canonical(NaN)).toThrow(/NaN at \$/)
    expect(() => canonical(Infinity)).toThrow(/Infinity at \$/)
    expect(() => canonical({ f: () => 1 })).toThrow(/function at \$\.f/)
  })

  it('refuses a class instance rather than treating it as its fields', () => {
    class Condition {}
    expect(() => canonical({ c: new Condition() })).toThrow(/instance of Condition at \$\.c/)
  })

  it('takes a null-prototype object, which is what `Object.create(null)` is for', () => {
    const bare = Object.create(null)
    bare.a = 1
    expect(canonical(bare)).toBe(canonical({ a: 1 }))
  })
})

describe('the digest', () => {
  it('is 32 lowercase hex characters — 128 bits', () => {
    expect(digest('anything')).toMatch(/^[0-9a-f]{32}$/)
    expect(digestBytes(utf8('anything'))).toMatch(/^[0-9a-f]{32}$/)
  })

  it('gives four different lanes rather than one repeated four times', () => {
    // The trap the offset bases are chosen against: lanes whose bases agree
    // modulo 2^k agree modulo 2^k forever, and four equal lanes would be a
    // 32-bit hash wearing a 128-bit costume.
    const lanes = digest('Betrag').match(/.{8}/g)
    expect(new Set(lanes).size).toBe(4)
  })

  it('separates one byte from another and one position from another', () => {
    expect(digestBytes(utf8('ab'))).not.toBe(digestBytes(utf8('ba')))
    expect(digestBytes(utf8('a'))).not.toBe(digestBytes(utf8('aa')))
    expect(digest('ä')).not.toBe(digest('a'))
  })

  it('reads a view of a buffer as the bytes of that view, not of the whole buffer', () => {
    const whole = new Uint8Array([1, 2, 3, 4])
    expect(digestBytes(whole.subarray(1, 3))).toBe(digestBytes(new Uint8Array([2, 3])))
    expect(digestBytes(whole.subarray(1, 3))).not.toBe(digestBytes(whole))
  })

  it('reads an empty input without pretending it read something', () => {
    expect(digestBytes(new ArrayBuffer(0))).toBe(digest(''))
  })

  it('refuses anything that is not bytes — a programming error, not a Diagnostic', () => {
    expect(() => digestBytes('not bytes')).toThrow(TypeError)
  })

  it('collides on nothing across 20,000 near-identical inputs', () => {
    // Not a proof and not meant as one. It is the shape a real cache sees — a
    // config edited one digit at a time — and it is what turns red if a lane is
    // wired to the wrong base or the loop stops mixing.
    const keys = new Set()
    for (let i = 0; i < 20000; i += 1) keys.add(digest(canonical({ value: i })))
    expect(keys.size).toBe(20000)
  })
})

describe('key(source)', () => {
  it('is the same key for the same bytes read the same way', () => {
    expect(sourceKey(entry())).toBe(sourceKey(entry()))
  })

  it('changes when the delimiter, the header row or the sheet changes', () => {
    const base = sourceKey(entry())
    expect(sourceKey(entry({ parseConfig: { ...PARSE, delimiter: ';' } }))).not.toBe(base)
    expect(sourceKey(entry({ parseConfig: { ...PARSE, headerRow: 2 } }))).not.toBe(base)
    expect(sourceKey(entry({ parseConfig: { ...PARSE, sheet: 'Q2' } }))).not.toBe(base)
  })

  it('changes when only the encoding changes — the field AD-8 does not name', () => {
    // `entry.parseConfig` is exactly `{ delimiter, headerRow, sheet }` here and
    // the encoding is a separate frozen field, so a key over `parseConfig` alone
    // would serve a UTF-8 parse for a CP1252 one. `overrideEncoding` is one of
    // the three commands that re-parse, so this is a route a user takes.
    expect(
      sourceKey(
        entry({ encoding: { chosen: 'windows-1252', source: 'override', override: 'windows-1252' } }),
      ),
    ).not.toBe(sourceKey(entry()))
  })

  it('changes when a different file is read into the same Source id', () => {
    // The I/O matrix row this suite owns. No store command produces that state —
    // a new file is a new `addSource` with a newly minted id (AD-14) — so it is
    // pinned here, as the property of `sourceKey` that it is: the id is not in
    // the key at all, and the bytes are.
    const other = entry({ byteDigest: digestBytes(utf8('Kunde,Betrag\nAnna,2000')) })
    expect(sourceKey(other)).not.toBe(sourceKey(entry()))
  })

  it('is not a function of the Source id, its name or its file name', () => {
    const dressed = { ...entry(), id: 'src:etwas-anderes', name: 'Anders', fileName: 'x.csv' }
    expect(sourceKey(dressed)).toBe(sourceKey(entry()))
  })

  it('refuses an entry with no digest rather than keying around it', () => {
    expect(() => sourceKey(entry({ byteDigest: undefined }))).toThrow(TypeError)
  })
})

describe('key(step)', () => {
  const CONFIG = Object.freeze({ combine: 'all', conditions: [] })
  const INPUT = sourceKey(entry())

  it('is the same key for the same kind, config and inputs', () => {
    expect(stepKey('filter', CONFIG, [INPUT])).toBe(stepKey('filter', { ...CONFIG }, [INPUT]))
  })

  it('separates two kinds carrying the same config', () => {
    expect(stepKey('filter', CONFIG, [INPUT])).not.toBe(stepKey('columns', CONFIG, [INPUT]))
  })

  it('separates a changed config and a changed input', () => {
    expect(stepKey('filter', { ...CONFIG, combine: 'any' }, [INPUT])).not.toBe(
      stepKey('filter', CONFIG, [INPUT]),
    )
    expect(stepKey('filter', CONFIG, [digest('another')])).not.toBe(
      stepKey('filter', CONFIG, [INPUT]),
    )
  })

  it('keeps slot order, because a left input is not a right one', () => {
    const a = digest('a')
    const b = digest('b')
    expect(stepKey('join', CONFIG, [a, b])).not.toBe(stepKey('join', CONFIG, [b, a]))
  })

  it('is a chain: a change upstream changes every key downstream', () => {
    const upstream = stepKey('filter', CONFIG, [INPUT])
    const moved = stepKey('filter', { ...CONFIG, combine: 'any' }, [INPUT])
    expect(stepKey('columns', CONFIG, [moved])).not.toBe(stepKey('columns', CONFIG, [upstream]))
  })

  it('refuses an input with no key — a Step whose input is uncacheable is one too', () => {
    expect(() => stepKey('filter', CONFIG, [null])).toThrow(TypeError)
    expect(() => stepKey('filter', CONFIG, [undefined])).toThrow(TypeError)
  })

  it('refuses a config the serializer cannot encode, rather than sharing a key', () => {
    expect(() => stepKey('filter', { at: new Date(0) }, [INPUT])).toThrow(/Date at/)
  })
})

// ------------------------------------------- the containment (7a review r1/r2)
//
// `keyOrNull` is what keeps a `canonical` refusal from leaving the module that
// asked for a key: both callers sit on a render path, so an escape is a blank
// pane and it breaks the frozen rule that a cached run and an uncached run are
// indistinguishable except in time. It is exported, so it is tested here rather
// than only through its two callers.

describe('keyOrNull', () => {
  beforeEach(forgetRefusals)

  it('passes a key straight through', () => {
    expect(keyOrNull(() => 'abc')).toBe('abc')
  })

  it('turns a refusal into a miss and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(keyOrNull(() => canonical({ at: new Date(0) }))).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toMatch(/^querbeet: not cacheable — canonical: cannot serialize a Date at \$\.at$/)
    } finally {
      warn.mockRestore()
    }
  })

  it('says each distinct message once and no more', () => {
    // The architecture's amended logging row requires it, and the reason is
    // frequency rather than tidiness: `stepZeroKey` runs per Source per run and
    // `executeGraph` on every data-affecting command, so a warning per occurrence
    // fires at keystroke frequency and buries the errors it sits among. Round 1
    // argued for repetition and was overruled.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (let i = 0; i < 5; i += 1) keyOrNull(() => canonical({ at: new Date(0) }))
      expect(warn).toHaveBeenCalledTimes(1)

      keyOrNull(() => canonical({ somewhere: new Date(0) })) // a different path
      expect(warn).toHaveBeenCalledTimes(2)

      forgetRefusals()
      keyOrNull(() => canonical({ at: new Date(0) }))
      expect(warn).toHaveBeenCalledTimes(3)
    } finally {
      warn.mockRestore()
    }
  })

  it('does not swallow a caller bug — only a refusal is contained', () => {
    // `stepKey`'s and `sourceKey`'s guards are documented programming errors, and
    // the house rule is that the core throws only on one of those. Catching them
    // alongside a refusal made both guards unable to fail, which is round 2's
    // finding: three failure classes, one silent outcome.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(() => keyOrNull(() => stepKey('filter', {}, [null]))).toThrow(/key for every input/)
      expect(() => keyOrNull(() => stepKey(undefined, {}, []))).toThrow(/needs the Step kind/)
      expect(() => keyOrNull(() => sourceKey({ parseConfig: null, encoding: null }))).toThrow(
        /byteDigest/,
      )
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not swallow anything that is not an Error at all', () => {
    // What the round-1 blanket `catch` turned into `[object Object]` in a warning
    // and a silent `null`. Nothing throws a bare object today; the point is that
    // the containment is a statement about one class and not about `try`.
    expect(() => keyOrNull(() => { throw { why: 'not an Error' } })).toThrow()
    expect(() =>
      keyOrNull(() => {
        throw new RangeError('something else entirely')
      }),
    ).toThrow(RangeError)
  })

  it('marks a refusal as its own class, which is what makes the narrowing possible', () => {
    // A `TypeError` subclass, so every `toThrow(TypeError)` written before it
    // existed still holds.
    expect(() => canonical(undefined)).toThrow(CanonicalRefusal)
    expect(() => canonical(undefined)).toThrow(TypeError)
    expect(() => stepKey(undefined, {}, [])).not.toThrow(CanonicalRefusal)
  })
})
