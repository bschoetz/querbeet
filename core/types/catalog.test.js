// The type vocabulary, under Vitest with no browser (AD-2, AD-27).
//
// What is worth testing about a list of five records is the property the file
// exists for: that it is the *only* list. The cases below hold the predicates to
// the records, and `ui/SourcesPane.test.js` holds the German words to the same
// records — so a type added here without a word, or a guard that grows a second
// opinion, fails somewhere rather than nowhere.

import { describe, expect, it } from 'vitest'
import * as catalog from './catalog.js'
import {
  BOOLEAN,
  DATE,
  DATETIME,
  DURATION,
  NUMBER,
  TEXT,
  TIME,
  TYPES,
  declaredNativeType,
  isNativeType,
  isSettableType,
  nativeDomain,
  nativeTypeOf,
  settableTypes,
  typeCodes,
} from './catalog.js'

describe('the catalogue', () => {
  it('is the whole vocabulary, frozen, in one order', () => {
    expect(typeCodes()).toEqual([TEXT, NUMBER, DATE, DATETIME, TIME, DURATION, BOOLEAN])
    expect(Object.isFrozen(TYPES)).toBe(true)
    expect(TYPES.every((type) => Object.isFrozen(type))).toBe(true)
  })

  it('separates what a user may set from what a reader may declare', () => {
    // The two are not the same list and never were, and story 4a pulls them
    // apart in both directions at once. `datetime` and `boolean` became settable
    // the moment detection could reach them from text — they were display-only
    // only because no text column could ever become one. `time` and `duration`
    // go the other way: every user may choose either, and **no reader may
    // declare one**. Parquet's TIME is still a refused declaration, so a column
    // arrives as `duration` because a person said so or because the values pass
    // 24:00, never because a file announced it.
    expect(settableTypes()).toEqual([TEXT, NUMBER, DATE, DATETIME, TIME, DURATION, BOOLEAN])
    expect(TYPES.filter((t) => t.native).map((t) => t.code)).toEqual([
      NUMBER,
      DATE,
      DATETIME,
      BOOLEAN,
    ])
    expect(isNativeType(TIME)).toBe(false)
    expect(isNativeType(DURATION)).toBe(false)
  })

  it('never lets a reader declare text natively', () => {
    // A reader that delivers strings declares the domain `text`. `native:text`
    // would be a column claiming its format typed it as untyped.
    expect(isNativeType(TEXT)).toBe(false)
    expect(isSettableType(TEXT)).toBe(true)
  })

  it('answers false for a word it has never heard of', () => {
    for (const word of ['decimal', 'interval', 'int96', '', 'TEXT']) {
      expect(isSettableType(word)).toBe(false)
      expect(isNativeType(word)).toBe(false)
    }
  })
})

describe('reading a reader’s declaration (AD-20)', () => {
  it('takes the type out of an admissible declaration', () => {
    expect(nativeDomain(NUMBER)).toBe('native:number')
    expect(nativeTypeOf('native:number')).toBe(NUMBER)
    expect(nativeTypeOf('native:datetime')).toBe(DATETIME)
  })

  it('is null for a plain text domain, so a text column is never a native one', () => {
    expect(nativeTypeOf(TEXT)).toBeNull()
    expect(nativeTypeOf(undefined)).toBeNull()
    expect(declaredNativeType(TEXT)).toBeNull()
  })

  it('separates the word a domain declared from the word the catalogue admits', () => {
    // This is the whole point of the closed list. Parquet delivers TIME,
    // INTERVAL, DECIMAL and INT96 from real files, and `detectColumn` used to
    // take everything after `native:` verbatim — so an unknown word could reach
    // a confirmed typing and then story 6's conversion.
    expect(declaredNativeType('native:decimal')).toBe('decimal')
    expect(nativeTypeOf('native:decimal')).toBeNull()

    // An admissible one is both a declaration and an admission.
    expect(declaredNativeType('native:boolean')).toBe(BOOLEAN)
    expect(nativeTypeOf('native:boolean')).toBe(BOOLEAN)
  })

  it('offers exactly one way to ask whether a domain is native', () => {
    // A refused declaration is discarded in `core/types/typing.js` and never
    // reaches a column record, a Recipe or a conversion — so there is no domain
    // left to ask "what were you refused for?". The word survives on the column
    // record as `refusedNativeType`, and a second function here answering from a
    // domain would be a second, contradictory answer.
    expect(Object.keys(catalog).filter((name) => /refus/i.test(name))).toEqual([])
  })
})
