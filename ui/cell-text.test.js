// The German display projection, in the `ui/` envelope (AD-27).
//
// It has no DOM in it and would run in the node envelope too — it is here because
// it is `ui/`, and because AD-13's whole point is that the German lives on this
// side of the line. What is asserted is what bare interpolation would get wrong:
// a raw nanosecond `BigInt`, an Anglo decimal point, the word `null` in an empty
// cell, and a boxed cell losing the text that is the reason the box exists.

import { describe, expect, it } from 'vitest'
import { cellText, germanNumber } from './cell-text.js'

/** UTC-midnight epoch nanoseconds for 31.12.2025 (AD-21). */
const SILVESTER = 1767139200000000000n

describe('a number', () => {
  it('is written in German convention', () => {
    expect(cellText(1234.56, 'number')).toBe('1.234,56')
    expect(cellText(-80, 'number')).toBe('-80')
    expect(cellText(0, 'number')).toBe('0')
  })

  it('is not rounded on the way to the screen', () => {
    // `Intl`'s default is three fraction digits, so this would otherwise read
    // `1.234,568` — a rounded number presented as the value, which is the class
    // of quiet wrongness this product exists to remove.
    expect(cellText(1234.5678, 'number')).toBe('1.234,5678')
  })
})

describe('a temporal value', () => {
  it('is a date rather than a nanosecond count', () => {
    // The failure this module exists for: `{{ cell }}` renders
    // `1767139200000000000` where a person expects a date.
    expect(cellText(SILVESTER, 'date')).toBe('31.12.2025')
  })

  it('is read in UTC, so no reader west of Greenwich sees the day before', () => {
    // AD-21 holds a date column as UTC-midnight epoch nanoseconds. A local-zone
    // reader would render 31 December as 30 December — the off-by-one-day class
    // AD-21 exists to prevent, reintroduced at the last possible moment.
    expect(cellText(SILVESTER, 'date')).toBe('31.12.2025')
    expect(cellText(0n, 'date')).toBe('01.01.1970')
  })

  it('shows a datetime to the minute, and further only where there is more', () => {
    const noon = SILVESTER + 14n * 3600n * 1_000_000_000n + 30n * 60n * 1_000_000_000n
    expect(cellText(noon, 'datetime')).toBe('31.12.2025 14:30')
    expect(cellText(noon + 7n * 1_000_000_000n, 'datetime')).toBe('31.12.2025 14:30:07')
    expect(cellText(noon + 500_000_000n, 'datetime')).toBe('31.12.2025 14:30:00,5')
  })

  it('shows a clock as a clock and a duration as a quantity', () => {
    const HOUR = 3_600_000_000_000n
    expect(cellText(14n * HOUR + 30n * 60_000_000_000n, 'time')).toBe('14:30')
    // A duration's hours are unbounded — that is what makes it a duration — and
    // a negative one keeps its sign: `-01:30` is ninety minutes owed, which is
    // what a time-account export writes.
    expect(cellText(36n * HOUR + 30n * 60_000_000_000n, 'duration')).toBe('36:30')
    expect(cellText(-(HOUR + 30n * 60_000_000_000n), 'duration')).toBe('-1:30')
  })

  it('places a pre-1970 instant with a fraction on the right millisecond', () => {
    // `BigInt` division truncates toward zero, so without the correction this
    // would land one millisecond late — invisible in a grid and wrong.
    expect(cellText(-1n, 'datetime')).toBe('31.12.1969 23:59:59,999999999')
  })
})

describe('the rest', () => {
  it('writes a boolean in German', () => {
    expect(cellText(true, 'boolean')).toBe('wahr')
    expect(cellText(false, 'boolean')).toBe('falsch')
  })

  it('leaves text alone', () => {
    expect(cellText('Anna', 'text')).toBe('Anna')
    expect(cellText('', 'text')).toBe('')
  })

  it('writes an absent value as an empty cell rather than as a word', () => {
    // A report is full of them, and "leer" three hundred times is noise where a
    // blank cell is information. The count of them is the typing panel's.
    for (const type of ['text', 'number', 'date', 'datetime', 'time', 'duration', 'boolean']) {
      expect(cellText(null, type)).toBe('')
      expect(cellText(undefined, type)).toBe('')
    }
  })

  it('renders a boxed cell as the file’s own text, whatever its column claims', () => {
    // A value that did not parse under its confirmed type materializes at the
    // handle's edge as the original text (AD-22). It arrives here in a `number`
    // or a `date` column and must render as that text — the fallback is
    // load-bearing rather than defensive.
    expect(cellText('ungefähr 80', 'number')).toBe('ungefähr 80')
    expect(cellText('demnächst', 'date')).toBe('demnächst')
    expect(cellText('vielleicht', 'boolean')).toBe('vielleicht')
  })

  it('falls back rather than throwing for a type it has no writer for', () => {
    expect(cellText(42, 'nonsense')).toBe('42')
  })
})

describe('a value the projection cannot render', () => {
  it('falls back to the raw value rather than showing NaN.NaN.NaN', () => {
    // A `BigInt` is unbounded and a `Date` is not: anything past ±8.64e15 ms is
    // an Invalid Date and every field read off one is `NaN`. The representation
    // can hold such a value — that is why it is a `BigInt` at all — so the
    // projection has to answer for it, with the same fallback a boxed cell gets.
    const beyond = 10n ** 30n
    expect(cellText(beyond, 'date')).toBe(String(beyond))
    expect(cellText(-beyond, 'datetime')).toBe(String(-beyond))
    expect(cellText(beyond, 'date')).not.toContain('NaN')
  })
})

describe('germanNumber — the inverse', () => {
  it('reads back what `cellText` wrote, so a preview value can be pasted into a Filter', () => {
    for (const value of [1234.56, -80, 0, 1234.5678, 1_000_000]) {
      expect(germanNumber(cellText(value, 'number'))).toBe(value)
    }
  })

  it('accepts the shapes a person types', () => {
    expect(germanNumber('1234,5')).toBe(1234.5)
    expect(germanNumber('1 000')).toBe(1000)
    expect(germanNumber(' 42 ')).toBe(42)
  })

  it('refuses a grouping that is not a grouping, which is the case the comment names', () => {
    // The loose pattern accepted exactly what it claimed to refuse: `1.234.56`
    // came back as 123456, `1.2` as 12, `12.` as 12, and a bare `.` as 0 — so a
    // stray dot became a silent number and a filter that quietly removed rows.
    // The suite was green over that because it probed `1.234.56,7,8`, which has
    // two commas and fails for a different reason entirely.
    for (const text of ['1.234.56', '1.2', '12.', '.', '...', '1.23', '1.2345', '1.', '-.']) {
      expect(germanNumber(text), `accepted ${text}`).toBeNull()
    }
  })

  it('refuses anything that is not a number at all', () => {
    for (const text of ['', 'abc', '1.234.56,7,8', '12abc', '1,2,3', '1,', ',5', '- 5']) {
      expect(germanNumber(text), `accepted ${text}`).toBeNull()
    }
  })

  it('refuses a grouping that mixes its separators', () => {
    // A number groups with dots or with spaces, never with both — the
    // backreference is what says so, and without it `1.000 000` reads as a
    // million.
    expect(germanNumber('1.000 000')).toBeNull()
    expect(germanNumber('1 000.000')).toBeNull()
    expect(germanNumber('1.000.000')).toBe(1_000_000)
    expect(germanNumber('1 000 000')).toBe(1_000_000)
  })
})
