// The measurement, written once and run unchanged in every engine.
//
// It must stay self-contained. run-spike.mjs hands this exact function to
// Playwright's page.evaluate, which serializes its source and evaluates it
// inside the browser; a reference to anything in module scope would arrive
// undefined there. So everything it needs is declared inside it, and it
// returns plain JSON-safe data rather than touching the outside world.

export function measureIntlMonths() {
  const LOCALES = ['de-DE', 'en-US', 'en-GB']
  const WIDTHS = ['short', 'long']

  // Formatting is pinned to UTC on purpose. Without an explicit timeZone the
  // formatter uses the machine's, and a run in a negative offset shifts the
  // day — at a month edge, the month with it. That would make the table a
  // property of where the runner stood rather than of the engine's ICU.
  const at = (month, day) => new Date(Date.UTC(2026, month, day))

  const monthPart = (dtf, date) => {
    const part = dtf.formatToParts(date).find((p) => p.type === 'month')
    return part ? part.value : null
  }

  const result = {
    // Whether the engine actually has the locale, or silently fell back.
    // A fallback would hand back an English table under a German tag and
    // every value below would look plausible and be wrong.
    resolved: {},
    // The table as an implementation must derive it: from a whole date, in
    // format context, via formatToParts.
    formatContext: {},
    // The same option asked the easy way, standalone. Kept because the
    // difference between the two is the thing worth proving, not asserting.
    standalone: {},
    // The full parts sequence of one reference date — this is what carries
    // the field order and the literal separators a parser has to accept.
    skeleton: {},
    // The two values from the Source that opened the gate, and the English
    // shapes, each rendered by the same formatter the table comes from.
    ownerValues: {},
    // Intl is not supposed to emit an English ordinal suffix. Measured
    // rather than assumed, because the whole point is what the engine does.
    ordinalSuffixSeen: false,
  }

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const key = `${locale}/${width}`
      const dtf = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: width,
        year: 'numeric',
        timeZone: 'UTC',
      })
      const standaloneDtf = new Intl.DateTimeFormat(locale, {
        month: width,
        timeZone: 'UTC',
      })

      result.resolved[key] = dtf.resolvedOptions().locale
      result.formatContext[key] = Array.from({ length: 12 }, (_, m) =>
        monthPart(dtf, at(m, 15)),
      )
      result.standalone[key] = Array.from({ length: 12 }, (_, m) =>
        monthPart(standaloneDtf, at(m, 15)),
      )
      result.skeleton[key] = dtf
        .formatToParts(at(7, 2))
        .map((p) => ({ type: p.type, value: p.value }))

      // Every day of every month formatted whole. This is both the
      // byte-for-byte check against the owner's two values and the corpus
      // the ordinal-suffix check runs over.
      const rendered = []
      for (let m = 0; m < 12; m++) {
        for (let d = 1; d <= 28; d++) rendered.push(dtf.format(at(m, d)))
      }
      if (rendered.some((v) => /\d(st|nd|rd|th)\b/.test(v))) {
        result.ordinalSuffixSeen = true
      }

      result.ownerValues[key] = {
        // "2. Aug. 2026" and "31. Juli 2026" in de-DE/short.
        augustSecond: dtf.format(at(7, 2)),
        julyThirtyFirst: dtf.format(at(6, 31)),
      }
    }
  }

  return result
}
