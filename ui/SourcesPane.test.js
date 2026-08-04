// The Step zero panel's own branches, in the ui/ envelope (AD-27, R10).
//
// What is here is what only a render function executes: the sentence chosen for
// each ambiguity verdict, and the refusal that appears when a Source cannot be
// confirmed. The store is a stub — the real one is exercised in
// core/exec/source-store.test.js, and mounting the pane against it would test
// that file twice while testing this one less.

import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { createStepZeroCache } from '@core/exec/convert.js'
import { TYPES } from '@core/types/catalog.js'
import { detectColumn } from '@core/types/typing.js'
import SourcesPane, { readingLabelGaps } from './SourcesPane.vue'
import { settableTypeLabels, typeLabel, typeLabelGaps } from './type-labels.js'

const column = (name, over = {}) => ({
  name,
  annotation: '',
  chosen: null,
  type: 'text',
  format: null,
  counts: { total: 3, missing: 0, parsed: 3, unparsed: 0 },
  verdict: 'settled',
  evidence: null,
  missingTokens: ['', '-'],
  domain: 'text',
  refusedNativeType: null,
  ...over,
})

const source = (columns, over = {}) => ({
  id: 'src:daten',
  name: 'daten',
  fileName: 'daten.csv',
  // The digest the store takes when bytes arrive (story 7a). It is on the
  // fixture because it is on every entry the store mints, and because Step
  // zero's cache is keyed through it: an entry without one is deliberately not
  // keyable, so a fixture missing it would silently convert on every render and
  // the release case below would stop being about the release.
  byteDigest: '0123456789abcdef0123456789abcdef',
  encoding: { chosen: 'utf-8', source: 'probe', override: null },
  parseConfig: { delimiter: ',', headerRow: 1 },
  proposal: { delimiter: ',', headerRow: 1 },
  table: { columns: columns.map((c) => ({ name: c.name, domain: 'text', cells: [] })), rowCount: 0 },
  typing: { columns, confirmed: false },
  damage: { mismatches: [], unclosedQuoteRow: null },
  diagnostics: [],
  ...over,
})

/** A store that records what it was told and answers what the test set up. */
const stubStore = (entry, { unresolved = [], formats = ['csv', 'xlsx', 'parquet'] } = {}) => {
  const calls = []
  return {
    calls,
    formats: () => formats,
    list: () => [entry],
    get: () => entry,
    addSource: () => ({ source: entry, diagnostics: [] }),
    removeSource: (...a) => calls.push(['removeSource', ...a]),
    renameSource: (...a) => calls.push(['renameSource', ...a]),
    overrideEncoding: (...a) => calls.push(['overrideEncoding', ...a]),
    reconfigureParse: (...a) => calls.push(['reconfigureParse', ...a]),
    setColumnTyping: (...a) => calls.push(['setColumnTyping', ...a]),
    annotateColumn: (...a) => calls.push(['annotateColumn', ...a]),
    unconfirmTyping: (...a) => calls.push(['unconfirmTyping', ...a]),
    confirmTyping: (...a) => {
      calls.push(['confirmTyping', ...a])
      return { source: entry, unresolved }
    },
  }
}

/** A `TableEngine` stub. The pane never reads a converted Table — it reads which
 *  cells failed — so what matters here is only that Step zero has *something* to
 *  hand its columns to. The real adapter is exercised in
 *  `adapters/arquero/engine.test.js`; mounting the pane against it would test
 *  that file twice and this one less, exactly as the store stub above. */
const stubEngine = () => ({ fromColumns: (columns) => ({ columns }) })

// The cache is built here rather than inside the pane: as of story 6b it is
// created once in `ui/App.vue` and shared with the Editor, so both panes mark and
// execute from the same converted Table. Counting engine calls through the real
// cache is still what the release case below asserts.
const render = async (store, engine = stubEngine(), runCache = null) => {
  const w = mount(SourcesPane, {
    props: { store, stepZero: createStepZeroCache(engine), runCache },
  })
  await nextTick()
  return w
}

/** A run cache reduced to the one method this pane may call. Story 7a's cache is
 *  content-keyed and has no Source id to release by, so `clear()` is the whole
 *  of the pane's business with it. */
const clearRecorder = () => {
  const cleared = { count: 0 }
  return { cleared, clear: () => (cleared.count += 1) }
}

const panel = (w) => w.find('[data-testid="typing"]')

describe('the two ambiguity sentences', () => {
  it('names no winner when nothing in the column settles it', async () => {
    const w = await render(
      stubStore(
        source([
          column('Datum', {
            type: 'date',
            format: { pattern: 'dd.MM.yyyy' },
            verdict: 'unresolved',
            evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
          }),
        ]),
      ),
    )

    const verdict = w.find('[data-testid="typing-verdict"]').text()
    expect(verdict).toContain('Nichts in dieser Spalte entscheidet')
    expect(verdict).toContain('TT.MM.JJJJ')
    expect(verdict).toContain('MM.TT.JJJJ')
    // The sentence must not read like a decision. "daher" is what the decisive
    // wording uses to announce one.
    expect(verdict).not.toContain('daher')
  })

  it('names the deciding count when one reading carries the evidence', async () => {
    const w = await render(
      stubStore(
        source([
          column('Datum', {
            type: 'date',
            format: { pattern: 'dd.MM.yyyy' },
            verdict: 'decisive',
            evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'], decidedBy: 47 },
          }),
        ]),
      ),
    )

    expect(w.find('[data-testid="typing-verdict"]').text()).toContain(
      '47 Werte lassen sich nur als TT.MM.JJJJ lesen',
    )
  })

  it('says nothing at all when there was never a question', async () => {
    const w = await render(stubStore(source([column('Kunde')])))

    expect(w.find('[data-testid="typing-verdict"]').exists()).toBe(false)
  })

  it('renders nothing rather than half a sentence for a record with no evidence', async () => {
    // `core/exec` reads a column's evidence through `?.` because story 14
    // restores a typing from a Recipe and a hand-edited or older record can
    // carry a verdict with nothing behind it. The same records reach here, and
    // dereferencing them unguarded took the render down — or, one field further
    // on, produced "entscheidet zwischen  und ." under an amber line.
    const w = await render(
      stubStore(
        source([
          column('Datum', { type: 'date', verdict: 'unresolved', evidence: { alternatives: [] } }),
          column('Betrag', { type: 'number', verdict: 'unresolved', evidence: {} }),
          column('Menge', {
            type: 'number',
            verdict: 'decisive',
            evidence: { alternatives: ['de-DE', 'en-US'] }, // decisive, no count
          }),
        ]),
      ),
    )

    expect(w.findAll('[data-testid="typing-verdict"]')).toHaveLength(0)
    expect(w.text()).not.toContain('entscheidet zwischen')
  })

  it('names a number reading by locale, not by its separators', async () => {
    const w = await render(
      stubStore(
        source([
          column('Betrag', {
            type: 'number',
            format: { locale: 'de-DE', group: '.', decimal: ',' },
            verdict: 'unresolved',
            evidence: { alternatives: ['de-DE', 'en-US'] },
          }),
        ]),
      ),
    )

    const verdict = w.find('[data-testid="typing-verdict"]').text()
    expect(verdict).toContain('Deutsch (1.234,56)')
    expect(verdict).toContain('Englisch (1,234.56)')
  })
})

describe('the question that is about a type rather than a reading', () => {
  // A column of clock times is `time` or `duration` and nothing in it says
  // which. That question is answered in the Typ select, not the Lesart one, so
  // both the sentence and the placeholder have to move with it.
  const undecidedKind = () =>
    column('Beginn', {
      type: 'duration',
      format: null,
      verdict: 'unresolved',
      evidence: { over: 'kind', alternatives: ['duration', 'time'] },
    })

  it('names the two types in German and points at the type select', async () => {
    const w = await render(stubStore(source([undecidedKind()])))

    const verdict = w.find('[data-testid="typing-verdict"]').text()
    expect(verdict).toBe(
      'Nichts in dieser Spalte entscheidet zwischen Dauer und Uhrzeit — bitte den Typ wählen.',
    )
  })

  it('shows a placeholder in the type select rather than one of the two answers', async () => {
    // The trap the reading select and the delimiter select were both fixed for:
    // re-selecting the value a select already displays fires no change event, so
    // a column proposed as `Dauer` while asking "Uhrzeit or Dauer?" could never
    // be answered with `Dauer` and the gate would stay shut for good.
    const store = stubStore(source([undecidedKind()]))
    const w = await render(store)
    const select = w.get('select[aria-label="Typ: Beginn"]')

    expect(select.element.value).toBe('')
    expect(select.text()).toContain('Bitte wählen')
    expect(select.find('option[value=""]').attributes('disabled')).toBeDefined()

    await select.setValue('duration')
    const [, id, at, patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect([id, at, patch]).toEqual(['src:daten', 0, { type: 'duration' }])
  })

  it('asks the date-or-text question the same way, with the same control', async () => {
    // A column of `01.02.03` is a date and equally a version number. Same
    // machinery, different pair of types — which is the test that the wording and
    // the placeholder key off the evidence rather than off `time`/`duration`.
    const store = stubStore(
      source([
        column('Version', {
          type: 'date',
          format: { pattern: 'dd.MM.yy' },
          verdict: 'unresolved',
          evidence: { over: 'kind', alternatives: ['date', 'text'] },
        }),
      ]),
    )
    const w = await render(store)

    expect(w.find('[data-testid="typing-verdict"]').text()).toBe(
      'Nichts in dieser Spalte entscheidet zwischen Datum und Text — bitte den Typ wählen.',
    )
    expect(w.get('select[aria-label="Typ: Version"]').element.value).toBe('')

    await w.get('select[aria-label="Typ: Version"]').setValue('text')
    expect(store.calls.find((c) => c[0] === 'setColumnTyping')[3]).toEqual({ type: 'text' })
  })

  it('offers no reading select while the type question is open, even where one exists', async () => {
    // A date-or-text column still carries `type: 'date'` and a `dd.MM.yy`
    // reading, so the Lesart select rendered beside the type placeholder — two
    // prompts, and answering *that* one sent `{type:'date', format}`, settling
    // the column and opening the gate. `over: 'kind'` exists so the card cannot
    // point at a control that fails to answer the question; one that answers it
    // wrongly is worse.
    const undecidedDate = column('Version', {
      type: 'date',
      format: { pattern: 'dd.MM.yy' },
      verdict: 'unresolved',
      evidence: { over: 'kind', alternatives: ['date', 'text'] },
    })
    const w = await render(stubStore(source([undecidedDate])))

    expect(w.find('select[aria-label="Lesart: Version"]').exists()).toBe(false)

    // It comes back the moment the type question is answered.
    const answered = await render(
      stubStore(source([{ ...undecidedDate, chosen: { type: 'date', format: { pattern: 'dd.MM.yy' } } }])),
    )
    expect(answered.find('select[aria-label="Lesart: Version"]').exists()).toBe(true)
  })

  it('offers no reading select at all, because there is no reading to choose', async () => {
    const w = await render(stubStore(source([undecidedKind()])))

    expect(w.find('select[aria-label="Lesart: Beginn"]').exists()).toBe(false)
  })

  it('names the deciding count in types once one value settles it', async () => {
    const w = await render(
      stubStore(
        source([
          column('Beginn', {
            type: 'duration',
            format: null,
            verdict: 'decisive',
            evidence: { over: 'kind', alternatives: ['duration', 'time'], decidedBy: 1, contested: 0 },
          }),
        ]),
      ),
    )

    expect(w.find('[data-testid="typing-verdict"]').text()).toBe(
      '1 Wert lässt sich nur als Dauer lesen, nicht als Uhrzeit — daher Dauer.',
    )
    // Settled by evidence, so the select shows the answer rather than a prompt.
    expect(w.get('select[aria-label="Typ: Beginn"]').element.value).toBe('duration')
  })
})

describe('the unit a number column carries', () => {
  it('shows the affix on the card, and only where there is one', async () => {
    // The stored number is the number in the field — 12,5 for `12,5 %` — so this
    // is where the percent sign went, and it has to be visible or the column
    // reads as a bare figure.
    const w = await render(
      stubStore(source([column('Quote', { type: 'number', affix: '%' }), column('Kunde')])),
    )

    const affixes = w.findAll('[data-testid="typing-affix"]')
    expect(affixes).toHaveLength(1)
    expect(affixes[0].text()).toBe('Einheit: %')
  })
})

describe('the German of a single value', () => {
  // The counts line already has its own singular test, and three entries in the
  // diagnostic map branch on a count of one. Every count in this panel can be
  // one too, and a one-row Source is the smallest thing a user can load.
  it('says one value rather than 1 Werten', async () => {
    const w = await render(
      stubStore(
        source([column('Betrag', { counts: { total: 1, missing: 0, parsed: 1, unparsed: 0 } })]),
      ),
    )

    expect(w.find('[data-testid="typing-hitrate"]').text()).toBe('1 von 1 Wert lesbar')
  })

  it('says one deciding value rather than 1 Werte', async () => {
    const w = await render(
      stubStore(
        source([
          column('Datum', {
            type: 'date',
            format: { pattern: 'dd.MM.yyyy' },
            verdict: 'decisive',
            evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'], decidedBy: 1, contested: 0 },
          }),
        ]),
      ),
    )

    expect(w.find('[data-testid="typing-verdict"]').text()).toContain(
      '1 Wert lässt sich nur als TT.MM.JJJJ lesen',
    )
  })

  it('names the evidence pointing the other way, when there is any', async () => {
    // 47 against 3 is still dd.mm, but a sentence naming only the 47 reads as
    // unanimity — and the 3 are the values that will come out wrong.
    const w = await render(
      stubStore(
        source([
          column('Datum', {
            type: 'date',
            format: { pattern: 'dd.MM.yyyy' },
            verdict: 'decisive',
            evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'], decidedBy: 47, contested: 3 },
          }),
        ]),
      ),
    )

    const verdict = w.find('[data-testid="typing-verdict"]').text()
    expect(verdict).toContain('47 Werte lassen sich nur als TT.MM.JJJJ lesen')
    expect(verdict).toContain('3 nur als MM.TT.JJJJ')
    expect(verdict).toContain('die Mehrheit spricht für TT.MM.JJJJ')
  })
})

describe('the reading select', () => {
  const undecided = () =>
    column('Datum', {
      type: 'date',
      format: { pattern: 'dd.MM.yyyy' },
      verdict: 'unresolved',
      evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
    })

  it('shows a placeholder rather than the reading detection ranked first', async () => {
    // Two reasons, and either alone would be enough. Re-selecting the value a
    // select already displays fires no change event, so a user who wants
    // TT.MM.JJJJ could never say so — the same trap the delimiter select
    // already solves this way. And a verdict whose whole content is "nothing
    // names a winner" must not name one in the control beside it.
    const w = await render(stubStore(source([undecided()])))
    const select = w.get('select[aria-label="Lesart: Datum"]')

    expect(select.element.value).toBe('')
    expect(select.text()).toContain('Bitte wählen')
  })

  it('keeps the placeholder where a chosen type left the reading open', async () => {
    // A user who answered "Datum" on a two-digit-year column has closed the
    // *kind* question and was never asked the ordering one, so the column is
    // still `unresolved` — with a choice standing. The select must be rendered
    // (the kind question is closed) and must still show the placeholder, or the
    // reading the core ranked first could never be chosen and the gate would
    // stay shut for good. Third control, same trap.
    const w = await render(
      stubStore(
        source([
          column('Version', {
            type: 'date',
            format: { pattern: 'dd.MM.yy' },
            chosen: { type: 'date', format: null },
            verdict: 'unresolved',
            evidence: { alternatives: ['dd.MM.yy', 'MM.dd.yy'] },
          }),
        ]),
        { unresolved: ['Version'] },
      ),
    )
    const select = w.get('select[aria-label="Lesart: Version"]')

    expect(select.element.value).toBe('')
    expect(select.text()).toContain('Bitte wählen')
    expect(w.get('[data-testid="typing-verdict"]').text()).toContain(
      'Nichts in dieser Spalte entscheidet zwischen TT.MM.JJ und MM.TT.JJ — bitte wählen.',
    )
    // The type select shows the answer that was given, not a placeholder: that
    // question is closed.
    expect(w.get('select[aria-label="Typ: Version"]').element.value).toBe('date')
  })

  it('takes the reading the panel was already showing as a real answer', async () => {
    const store = stubStore(source([undecided()]))
    const w = await render(store)

    await w.get('select[aria-label="Lesart: Datum"]').setValue('dd.MM.yyyy')

    const [, id, at, patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect([id, at]).toEqual(['src:daten', 0])
    expect(patch.format.pattern).toBe('dd.MM.yyyy')
  })

  it('spells every date reading in German field letters, on all three separators', async () => {
    // Completeness rather than a sample: a pattern added to the core without a
    // German rendering would reach a Source card as `dd/MM/yy`, and `d` and `y`
    // are the letters that give that away. `M` stays — it is Monat.
    const w = await render(
      stubStore(source([column('Datum', { type: 'date', format: { pattern: 'dd.MM.yyyy' } })])),
    )
    const options = w
      .get('select[aria-label="Lesart: Datum"]')
      .findAll('option')
      .map((o) => o.text())

    expect(options).toEqual([
      'TT.MM.JJJJ',
      'MM.TT.JJJJ',
      'TT.MM.JJ',
      'MM.TT.JJ',
      'TT/MM/JJJJ',
      'MM/TT/JJJJ',
      'TT/MM/JJ',
      'MM/TT/JJ',
      'TT-MM-JJJJ',
      'MM-TT-JJJJ',
      'TT-MM-JJ',
      'MM-TT-JJ',
      'JJJJ-MM-TT',
      'JJ-MM-TT',
      // Story 4b. One candidate over `2. Aug. 2026`, `Aug 2, 2026` and
      // `2 Aug 2026`, so it cannot be spelled in field letters at all — it gets
      // a German word from a map, with an example so the word is not a riddle.
      'Monatsname (2. Aug. 2026)',
    ])
    expect(options.filter((o) => /[dy]/.test(o))).toEqual([])
  })

  it('has a German word for every reading it would otherwise render in the core’s words', () => {
    // Completeness rather than a sample, and the sibling of `typeLabelGaps()`
    // one level down: `patternLabel` is a string transform, so a candidate the
    // core *names* instead of spelling — `ISO 8601`, `month name` — passes
    // through it untouched and reaches a Source card in English. Empty is the
    // rule.
    //
    // It walks every kind `candidatesFor` serves rather than the two date-shaped
    // ones: a number reading falls through `NUMBER_LABEL[locale] ?? locale` with
    // nothing watching it, and story 4b put a third locale into a locale list in
    // the same file as `NUMBER_LOCALES`. The day a third *number* locale arrives
    // this fails instead of the pane rendering a bare `en-GB`.
    expect(readingLabelGaps()).toEqual([])
  })

  it('spells the boolean pairs as the words that stand in the cells', async () => {
    // The pairs are in the label map explicitly, and the reason is the same one
    // `ISO 8601` is: they render as their own two words because the words are
    // the column's *values* rather than interface prose. Until they were entered
    // they passed the gap check by looking like patterns that spell themselves,
    // which they are not — so this is the case that keeps the entries from
    // looking redundant to whoever cleans the map next.
    const w = await render(
      stubStore(
        source([
          column('Freigegeben', { type: 'boolean', format: { pattern: 'ja/nein' } }),
        ]),
      ),
    )

    expect(
      w
        .get('select[aria-label="Lesart: Freigegeben"]')
        .findAll('option')
        .map((o) => o.text()),
    ).toEqual(['true/false', 'wahr/falsch', 'ja/nein', '1/0'])
  })

  it('spells a datetime pattern in German field letters, two-digit year included', async () => {
    // `yyyy` becomes JJJJ before `yy` becomes JJ, or `dd.MM.yyyy` would come out
    // right on its first half and as nonsense on its second.
    const w = await render(
      stubStore(
        source([
          column('Zeitpunkt', {
            type: 'datetime',
            format: { pattern: 'dd.MM.yy HH:mm' },
            chosen: { type: 'datetime', format: { pattern: 'dd.MM.yy HH:mm' } },
          }),
        ]),
      ),
    )
    const options = w.get('select[aria-label="Lesart: Zeitpunkt"]').findAll('option')

    expect(options.map((o) => o.text())).toEqual([
      'ISO 8601',
      'JJJJ-MM-TT HH:mm',
      'TT.MM.JJJJ HH:mm',
      'TT.MM.JJ HH:mm',
      // The month-name datetime is *named* rather than spelled, for the same
      // reason its date-only sibling is: one candidate over three orderings
      // cannot be written as one pattern. So it comes from the label map, with
      // the clock in the example because that is what distinguishes it from the
      // date reading in a select that shows both words.
      'Monatsname mit Uhrzeit (2. Aug. 2026 04:44:34)',
    ])
  })

  it('names a boolean pair by its two words', async () => {
    const w = await render(
      stubStore(
        source([
          column('Aktiv', {
            type: 'boolean',
            format: { pattern: 'ja/nein' },
            chosen: { type: 'boolean', format: { pattern: 'ja/nein' } },
          }),
        ]),
      ),
    )

    expect(w.get('select[aria-label="Lesart: Aktiv"]').element.value).toBe('ja/nein')
    expect(w.get('select[aria-label="Lesart: Aktiv"]').text()).toContain('wahr/falsch')
  })

  it('shows the chosen reading once the question is answered', async () => {
    const w = await render(
      stubStore(
        source([
          column('Datum', {
            type: 'date',
            format: { pattern: 'MM.dd.yyyy' },
            chosen: { type: 'date', format: { pattern: 'MM.dd.yyyy' } },
          }),
        ]),
      ),
    )

    expect(w.get('select[aria-label="Lesart: Datum"]').element.value).toBe('MM.dd.yyyy')
  })
})

describe('the confirmation', () => {
  it('reports the refusal and names the columns it is waiting for', async () => {
    const entry = source([
      column('Datum', {
        verdict: 'unresolved',
        evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
      }),
      column('Lieferdatum', {
        verdict: 'unresolved',
        evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
      }),
    ])
    const store = stubStore(entry, { unresolved: ['Datum', 'Lieferdatum'] })
    const w = await render(store)

    expect(w.find('[data-testid="typing-refusal"]').exists()).toBe(false)

    await w.get('button[aria-label="Typen bestätigen: daten"]').trigger('click')

    const refusal = w.find('[data-testid="typing-refusal"]')
    expect(refusal.exists()).toBe(true)
    expect(refusal.text()).toContain('Datum, Lieferdatum')
    // Announced, not merely coloured: without this the button appears to do
    // nothing at all to a screen reader, in the one case where it does most.
    expect(refusal.attributes('role')).toBe('status')
    expect(store.calls).toContainEqual(['confirmTyping', 'src:daten'])
  })

  it('leaves no refusal standing when the Source goes through', async () => {
    // The refusal has to be shown first. A store that only ever answers "no
    // open columns" would let this pass against a pane that renders no refusal
    // at all — which is what it is here to rule out.
    const state = { unresolved: ['Datum'] }
    const entry = source([
      column('Datum', {
        verdict: 'unresolved',
        evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
      }),
    ])
    const store = { ...stubStore(entry), confirmTyping: () => ({ source: entry, ...state }) }
    const w = await render(store)

    await w.get('button[aria-label="Typen bestätigen: daten"]').trigger('click')
    expect(w.find('[data-testid="typing-refusal"]').exists()).toBe(true)

    state.unresolved = []
    await w.get('button[aria-label="Typen bestätigen: daten"]').trigger('click')
    expect(w.find('[data-testid="typing-refusal"]').exists()).toBe(false)
  })

  it('drops the refusal as soon as the question behind it is answered', async () => {
    // Otherwise the card contradicts itself: the summary says the question is
    // answered while the amber line still says the column is open.
    const entry = source([
      column('Datum', {
        type: 'date',
        format: { pattern: 'dd.MM.yyyy' },
        verdict: 'unresolved',
        evidence: { alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
      }),
    ])
    const store = stubStore(entry, { unresolved: ['Datum'] })
    const w = await render(store)

    await w.get('button[aria-label="Typen bestätigen: daten"]').trigger('click')
    expect(w.find('[data-testid="typing-refusal"]').exists()).toBe(true)

    await w.get('select[aria-label="Lesart: Datum"]').setValue('MM.dd.yyyy')

    expect(w.find('[data-testid="typing-refusal"]').exists()).toBe(false)
  })

  it('offers to reopen a confirmed Source rather than trapping the user', async () => {
    const entry = source([column('Kunde')], {
      typing: { columns: [column('Kunde')], confirmed: true },
    })
    const store = stubStore(entry)
    const w = await render(store)

    expect(panel(w).text()).toContain('Typen bestätigt.')
    await w.get('button[aria-label="Bestätigung aufheben: daten"]').trigger('click')

    expect(store.calls).toContainEqual(['unconfirmTyping', 'src:daten'])
  })

  it('says in the summary what the card is waiting for, without opening it', async () => {
    const w = await render(
      stubStore(
        source([
          column('Kunde'),
          column('Datum', { verdict: 'unresolved', evidence: { alternatives: ['a', 'b'] } }),
        ]),
      ),
    )

    expect(panel(w).find('summary').text()).toContain('Noch offen: Datum.')
  })
})

describe('the parse controls a format actually has', () => {
  // Which controls a card renders is read off the reader's own proposal, not off
  // a list of formats kept in the pane: a control over a decision the format
  // does not have is an invitation to break a good read.

  const workbook = (over = {}) =>
    source([column('Menge', { type: 'number', domain: 'native:number' })], {
      fileName: 'bericht.xlsx',
      encoding: { chosen: null, source: null, override: null },
      parseConfig: { delimiter: null, headerRow: null, sheet: null },
      proposal: { headerRow: 1, sheet: 'Umsatz', sheets: ['Umsatz', 'Kosten', 'Notizen'] },
      ...over,
    })

  it('gives a workbook a sheet and a header row, and no encoding or delimiter', async () => {
    const w = await render(stubStore(workbook()))

    expect(w.find('select[aria-label="Tabellenblatt"]').exists()).toBe(true)
    expect(w.find('input[aria-label="Kopfzeile"]').exists()).toBe(true)
    expect(w.find('select[aria-label="Zeichenkodierung"]').exists()).toBe(false)
    expect(w.find('select[aria-label="Trennzeichen"]').exists()).toBe(false)
  })

  it('offers every sheet in the workbook and shows the one that was read', async () => {
    const w = await render(stubStore(workbook()))
    const select = w.get('select[aria-label="Tabellenblatt"]')

    expect(select.findAll('option').map((o) => o.text())).toEqual([
      'Umsatz',
      'Kosten',
      'Notizen',
    ])
    expect(select.element.value).toBe('Umsatz')
  })

  it('issues the sheet switch as a parse correction', async () => {
    const store = stubStore(workbook())
    const w = await render(store)

    await w.get('select[aria-label="Tabellenblatt"]').setValue('Kosten')

    expect(store.calls).toContainEqual(['reconfigureParse', 'src:daten', { sheet: 'Kosten' }])
  })

  it('gives a Parquet Source no parse controls at all — its schema is the answer', async () => {
    const w = await render(
      stubStore(
        workbook({
          fileName: 'umsatz.parquet',
          proposal: {},
        }),
      ),
    )

    expect(w.find('select[aria-label="Tabellenblatt"]').exists()).toBe(false)
    expect(w.find('input[aria-label="Kopfzeile"]').exists()).toBe(false)
    expect(w.find('select[aria-label="Zeichenkodierung"]').exists()).toBe(false)
    expect(w.find('select[aria-label="Trennzeichen"]').exists()).toBe(false)
  })

  it('leaves a CSV card with all three of its own controls', async () => {
    const w = await render(stubStore(source([column('Kunde')])))

    expect(w.find('select[aria-label="Zeichenkodierung"]').exists()).toBe(true)
    expect(w.find('select[aria-label="Trennzeichen"]').exists()).toBe(true)
    expect(w.find('input[aria-label="Kopfzeile"]').exists()).toBe(true)
    expect(w.find('select[aria-label="Tabellenblatt"]').exists()).toBe(false)
  })

  it('renders no sheet control for a workbook that reports no sheets', async () => {
    // An empty list is truthy; an option-less select is a control with nothing
    // to choose in it.
    const w = await render(
      stubStore(workbook({ proposal: { headerRow: null, sheet: null, sheets: [] } })),
    )

    expect(w.find('select[aria-label="Tabellenblatt"]').exists()).toBe(false)
  })

  it('disables the control that is reading, and says the card is busy', async () => {
    // A binary read takes a third of a second on a 2.4 MB workbook and much
    // longer on a slow machine. A card that stays fully interactive and
    // unchanged for that long invites a second click over the first.
    let release
    const store = stubStore(workbook())
    store.reconfigureParse = () => new Promise((resolve) => { release = resolve })
    const w = await render(store)

    const sheet = w.get('select[aria-label="Tabellenblatt"]')
    await sheet.setValue('Kosten')
    await nextTick()

    expect(sheet.attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="parse-pending"]').text()).toBe('Datei wird neu gelesen …')
    // Announced, not only shown: a screen-reader user otherwise gets no signal
    // that the card is working at all.
    expect(w.get('[data-testid="parse-pending"]').attributes('role')).toBe('status')
    // Only the control that is reading; the header row beside it stays usable.
    expect(w.get('input[aria-label="Kopfzeile"]').attributes('disabled')).toBeUndefined()

    release()
    await nextTick()
    await nextTick()

    expect(w.get('select[aria-label="Tabellenblatt"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="parse-pending"]').exists()).toBe(false)
  })

  it('re-enables the control when the command rejects, and says so instead of crashing', async () => {
    // A card left permanently disabled by one failed read is worse than the
    // overlap the disabling exists to prevent — and a rejection escaping an
    // event handler is an unhandled rejection, which is a page error in the
    // built artefact that `single-file.spec.js` asserts never happens.
    const store = stubStore(workbook())
    store.reconfigureParse = () => Promise.reject(new Error('reader broke'))
    const w = await render(store)

    await w.get('select[aria-label="Tabellenblatt"]').setValue('Kosten')
    await nextTick()
    await nextTick()

    expect(w.get('select[aria-label="Tabellenblatt"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="parse-pending"]').exists()).toBe(false)
    expect(w.text()).toContain('konnte nicht gelesen werden')
  })
})

describe('the formats this build can read', () => {
  // Two sentences name them to the user. Both come from the reader registry
  // `app/` wired up, so neither can promise a format the build cannot open —
  // the same restatement problem `core/types/catalog.js` was written to end.
  const withFormats = (formats) =>
    stubStore(
      source([column('Kunde')], {
        diagnostics: [
          {
            severity: 'error',
            code: 'source.unsupported_format',
            values: { fileName: 'bericht.ods', extension: 'ods' },
          },
        ],
      }),
      { formats },
    )

  it('names them in the drop zone and in the refusal, from one source', async () => {
    const w = await render(withFormats(['csv', 'xlsx', 'parquet']))

    expect(w.get('[data-testid="drop-zone"]').text()).toContain(
      'gelesen werden CSV-, XLSX- und Parquet-Dateien',
    )
    expect(w.text()).toContain(
      '„bericht.ods“ hat ein nicht unterstütztes Format — gelesen werden derzeit CSV-, XLSX- und Parquet-Dateien.',
    )
  })

  it('follows the registry rather than a sentence kept by hand', async () => {
    const w = await render(withFormats(['csv']))

    expect(w.get('[data-testid="drop-zone"]').text()).toContain('gelesen werden CSV-Dateien')
    expect(w.text()).not.toContain('XLSX')
  })
})

describe('the column edits', () => {
  it('sends a type change without a reading, and lets detection pick one', async () => {
    // Handing over the first candidate on the list would give an Anglo column
    // the German reading and a collapsed hit rate, with nothing on screen to
    // say the other candidate read every value.
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store)

    await w.get('select[aria-label="Typ: Betrag"]').setValue('number')

    const [, id, at, patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect([id, at]).toEqual(['src:daten', 0])
    expect(patch).toEqual({ type: 'number' })
  })

  it('offers a way back to the proposal, but only once there is a choice to withdraw', async () => {
    // Without it, overriding a type is one-way: the only route back is a
    // re-read, which takes the confirmation with it.
    const untouched = await render(stubStore(source([column('Betrag')])))
    expect(untouched.get('select[aria-label="Typ: Betrag"]').text()).not.toContain('Vorschlag')

    const store = stubStore(
      source([column('Betrag', { type: 'text', chosen: { type: 'text', format: null } })]),
    )
    const w = await render(store)
    const select = w.get('select[aria-label="Typ: Betrag"]')
    expect(select.text()).toContain('Zurück zum Vorschlag')

    await select.setValue('')

    const [, , at, patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect([at, patch]).toEqual([0, { type: null }])
  })

  it('spells the empty cell as a word, so it can be typed back in', async () => {
    // "" in a comma-separated list is invisible and untypeable. It round-trips
    // through the word instead — matched whole, so a token that merely contains
    // it stays a token.
    const store = stubStore(source([column('Betrag', { missingTokens: ['', 'k.A.'] })]))
    const w = await render(store)
    const field = w.get('input[aria-label="Fehlende Werte: Betrag"]')

    expect(field.element.value).toBe('(leer), k.A.')

    await field.setValue('(leer), n/a, x(leer), n/a')
    const [, , , patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect(patch.missingTokens).toEqual(['', 'n/a', 'x(leer)'])
  })

  it('passes an annotation through as the user’s own text', async () => {
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store)

    await w.get('input[aria-label="Notiz: Betrag"]').setValue('Netto, ohne Fracht')

    expect(store.calls).toContainEqual(['annotateColumn', 'src:daten', 0, 'Netto, ohne Fracht'])
  })

  it('addresses a repeated column name by position, in the label and in the command', async () => {
    // Two controls labelled "Typ: Datum" name the same thing to a screen reader
    // and to any locator, while addressing different columns.
    const store = stubStore(source([column('Datum'), column('Datum')]))
    const w = await render(store)

    await w.get('select[aria-label="Typ: Datum (Spalte 2)"]').setValue('date')

    const [, , at] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect(at).toBe(1)
  })

  it('leaves a type the format already decided alone, in German', async () => {
    // `native:boolean` out of an XLSX sheet. A select whose options lack the
    // current value would show "Text" and retype the column on the first
    // interaction — and the store now refuses that patch outright.
    const w = await render(
      stubStore(source([column('Aktiv', { type: 'boolean', domain: 'native:boolean' })])),
    )

    expect(w.find('select[aria-label="Typ: Aktiv"]').exists()).toBe(false)
    expect(w.find('select[aria-label="Lesart: Aktiv"]').exists()).toBe(false)
    expect(w.find('[data-testid="typing-native"]').text()).toBe(
      'Vom Format vorgegeben: Wahrheitswert',
    )
  })

  it('guards the type control by domain, not by type', async () => {
    // `native:number` has type `number`, which is perfectly settable — the old
    // type-keyed guard handed it the full select and let a user re-infer a
    // column its format had already answered for (AD-20).
    const w = await render(
      stubStore(source([column('Menge', { type: 'number', domain: 'native:number' })])),
    )

    expect(w.find('select[aria-label="Typ: Menge"]').exists()).toBe(false)
    expect(w.find('[data-testid="typing-native"]').text()).toBe('Vom Format vorgegeben: Zahl')

    // What documents the column, rather than typing it, stays editable.
    expect(w.find('input[aria-label="Fehlende Werte: Menge"]').exists()).toBe(true)
    expect(w.find('input[aria-label="Notiz: Menge"]').exists()).toBe(true)
  })

  it('keeps the select in step with the catalogue, and refuses a type it has no German word for', () => {
    // The two lists this pane used to restate are one list now. A type added to
    // the catalogue without a German word is a failing test here rather than an
    // English word on a Source card.
    expect(typeLabelGaps()).toEqual([])
    expect(settableTypeLabels()).toEqual([
      ['text', 'Text'],
      ['number', 'Zahl'],
      ['date', 'Datum'],
      ['datetime', 'Zeitstempel'],
      ['time', 'Uhrzeit'],
      ['duration', 'Dauer'],
      ['boolean', 'Wahrheitswert'],
    ])
    // …and every type the catalogue admits natively has a word too, since a
    // native column renders one and can never render a select.
    for (const type of TYPES.filter((t) => t.native)) {
      expect(typeLabel(type.code)).not.toBe(type.code)
    }
  })
})

describe('the typing diagnostics in German', () => {
  it('has a sentence for each of the three codes', async () => {
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            {
              severity: 'unresolved',
              code: 'typing.ambiguous_locale',
              values: { column: 'Datum', alternatives: ['dd.MM.yyyy', 'MM.dd.yyyy'] },
            },
            {
              severity: 'warning',
              code: 'typing.unparsed_values',
              values: { column: 'Betrag', unparsed: 58, readable: 900 },
            },
            { severity: 'unresolved', code: 'typing.unconfirmed', values: { columns: 1 } },
          ],
        }),
      ),
    )

    const text = w.text()
    expect(text).toContain('Spalte „Datum“: nichts entscheidet zwischen zwei Lesarten')
    expect(text).toContain('Spalte „Betrag“: 58 von 900 Werten lassen sich')
    expect(text).toContain('Die Spaltentypen sind noch nicht bestätigt')
    expect(text).not.toContain('Unbekannte Meldung aus dem Kern.')
  })

  it('has a sentence for the two codes story 4a added', async () => {
    // Both name what the user has to do about them: which control answers the
    // type question, and which two units the mixed column is carrying.
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            {
              severity: 'unresolved',
              code: 'typing.ambiguous_kind',
              values: { column: 'Beginn', alternatives: ['duration', 'time'] },
            },
            {
              severity: 'warning',
              code: 'typing.mixed_affixes',
              values: { column: 'Wert', affixes: ['€', '$'] },
            },
          ],
        }),
      ),
    )

    const text = w.text()
    expect(text).toContain('Spalte „Beginn“: nichts entscheidet zwischen Dauer und Uhrzeit')
    expect(text).toContain('Bitte unter „Spalten & Typen“ den Typ wählen.')
    expect(text).toContain('Spalte „Wert“ enthält Werte mit verschiedenen Einheiten (€ und $)')
    // …and it may not claim the column is read as text: the finding survives
    // whatever kind wins, and eighteen German dates beside those two amounts
    // are still a date column. What is always true is why no number is proposed.
    expect(text).toContain('deshalb schlägt querbeet für diese Spalte keinen Zahlentyp vor')
    expect(text).not.toContain('sie wird als Text gelesen')
    expect(text).not.toContain('Unbekannte Meldung aus dem Kern.')
  })

  it('has a sentence for the two boolean spellings, and does not claim text either', async () => {
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            {
              severity: 'warning',
              code: 'typing.mixed_boolean_pairs',
              values: { column: 'Freigabe', pairs: ['true/false', 'ja/nein'] },
            },
          ],
        }),
      ),
    )

    const text = w.text()
    expect(text).toContain(
      'Spalte „Freigabe“ schreibt Ja und Nein in zwei verschiedenen Schreibweisen ' +
        '(true/false und ja/nein)',
    )
    // The finding survives whatever kind wins the column — `1`, `0` beside `ja`
    // is a *number* column — so this sentence may no more claim text than its
    // mixed-unit sibling may.
    expect(text).toContain('deshalb schlägt querbeet für diese Spalte keinen Wahrheitswert vor')
    expect(text).not.toContain('wird als Text gelesen')
    expect(text).not.toContain('Unbekannte Meldung aus dem Kern.')
  })

  it('names the column even when the restored record has no alternatives to name', async () => {
    // `core/exec` reads the alternatives through `?.` because story 14 restores
    // a typing from a Recipe, and hands over the empty list where a record has
    // nothing to say. "entscheidet zwischen ." is a sentence with a hole in it.
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            {
              severity: 'unresolved',
              code: 'typing.ambiguous_kind',
              values: { column: 'Beginn', alternatives: [] },
            },
          ],
        }),
      ),
    )

    const text = w.text()
    expect(text).toContain('Spalte „Beginn“: der Typ ist ungeklärt.')
    expect(text).toContain('Bitte unter „Spalten & Typen“ den Typ wählen.')
    expect(text).not.toContain('entscheidet zwischen')
    expect(text).not.toContain('Unbekannte Meldung aus dem Kern.')
  })

  it('names the type rather than a reading control the column may not have', async () => {
    // "unter der gewählten Lesart" was true while every type that could carry an
    // unreadable value had a reading to choose. `time` and `duration` have none,
    // so on those columns the sentence sent the user looking for a control that
    // is not rendered. The whole clause is pinned, not only its prefix — the old
    // wording could be restored with the suite green.
    const w = await render(
      stubStore(
        source([column('Beginn', { type: 'duration', format: null })], {
          diagnostics: [
            {
              severity: 'warning',
              code: 'typing.unparsed_values',
              values: { column: 'Beginn', unparsed: 3, readable: 900 },
            },
          ],
        }),
      ),
    )

    expect(w.text()).toContain(
      'Spalte „Beginn“: 3 von 900 Werten lassen sich unter dem gewählten Typ nicht lesen.',
    )
    expect(w.text()).not.toContain('Lesart')
  })

  it('says where the sub-millisecond digits are lost, and it is not in querbeet', async () => {
    // querbeet holds nanoseconds (AD-21), so the loss is the reader's: the
    // Parquet library hands over a `Date`. The old clause "querbeet rechnet in
    // Millisekunden" is now false and would send someone looking in the wrong
    // place — and only the unchanged prefix of this sentence was asserted, so it
    // could be restored with everything green.
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            {
              severity: 'warning',
              code: 'parquet.timestamp_precision',
              values: { column: 'Zeitpunkt', unit: 'NANOS' },
            },
          ],
        }),
      ),
    )

    expect(w.text()).toContain(
      'Spalte „Zeitpunkt“ ist in Nanosekunden gespeichert und wird beim Einlesen auf ' +
        'Millisekunden gerundet.',
    )
    expect(w.text()).not.toContain('querbeet rechnet in Millisekunden')
  })

  it('counts a single unreadable value as one', async () => {
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            {
              severity: 'warning',
              code: 'typing.unparsed_values',
              values: { column: 'Betrag', unparsed: 1, readable: 900 },
            },
          ],
        }),
      ),
    )

    expect(w.text()).toContain('ein Wert von 900 lässt sich')
  })

  it('renders the German for every code the two binary readers can emit', async () => {
    // Each of these is produced by an adapter and rendered only here. Without a
    // case per code, a missing entry in the map surfaces as the fallback
    // sentence in front of a user rather than as a red test.
    const w = await render(
      stubStore(
        source([column('Kunde')], {
          diagnostics: [
            { severity: 'warning', code: 'xlsx.empty', values: { sheet: 'Leer' } },
            { severity: 'warning', code: 'xlsx.empty', values: { sheet: '' } },
            {
              severity: 'warning',
              code: 'xlsx.sheet_missing',
              values: { sheet: 'Vertrieb', using: 'Umsatz' },
            },
            {
              severity: 'warning',
              code: 'xlsx.mixed_types',
              values: { column: 'Wert', kinds: ['date', 'number'] },
            },
            {
              severity: 'warning',
              code: 'parquet.nested_column',
              values: { column: 'positionen' },
            },
            {
              severity: 'warning',
              code: 'parquet.unsupported_type',
              values: { column: 'Dauer', type: 'TIME_MILLIS' },
            },
            { severity: 'warning', code: 'xlsx.blank_header', values: { columns: [2] } },
            { severity: 'warning', code: 'xlsx.blank_header', values: { columns: [2, 5] } },
            { severity: 'warning', code: 'xlsx.duplicate_header', values: { columns: ['Betrag'] } },
            {
              severity: 'warning',
              code: 'parquet.unreadable_column',
              values: { column: 'dauer', type: 'INTERVAL' },
            },
            {
              severity: 'warning',
              code: 'parquet.duplicate_column_name',
              values: { column: 'Betrag', columns: 2 },
            },
            {
              severity: 'warning',
              code: 'parquet.decimal_precision',
              values: { column: 'preis', values: 1 },
            },
            {
              severity: 'warning',
              code: 'parquet.decimal_precision',
              values: { column: 'preis', values: 4 },
            },
            {
              severity: 'warning',
              code: 'parquet.timestamp_precision',
              values: { column: 'erfasst', unit: 'MICROS' },
            },
            {
              severity: 'warning',
              code: 'parquet.timestamp_precision',
              values: { column: 'erfasst', unit: 'NANOS' },
            },
            {
              severity: 'warning',
              code: 'parquet.non_finite_number',
              values: { column: 'quote', values: 1 },
            },
            {
              severity: 'warning',
              code: 'parquet.non_finite_number',
              values: { column: 'quote', values: 3 },
            },
            {
              severity: 'error',
              code: 'parquet.unsupported_codec',
              values: { fileName: 'umsatz.parquet', codec: 'GZIP' },
            },
          ],
        }),
      ),
    )

    const text = w.text()
    expect(text).toContain('Das Tabellenblatt „Leer“ ist leer')
    expect(text).toContain('Die Arbeitsmappe enthält kein Tabellenblatt')
    expect(text).toContain('Das Tabellenblatt „Vertrieb“ gibt es in dieser Datei nicht mehr')
    // The kinds come through the catalogue's German words, not as `date, number`.
    expect(text).toContain(
      'Spalte „Wert“ enthält Werte verschiedener Excel-Typen (Datum, Zahl) — sie wird als Text gelesen',
    )
    expect(text).toContain('Spalte „positionen“ ist verschachtelt (Liste, Map oder Struktur)')
    expect(text).toContain('Spalte „Dauer“ hat den Parquet-Typ TIME_MILLIS')
    // Both German numbers of each countable sentence — "eine Spalte" against a
    // list, one value against several.
    expect(text).toContain('In der Kopfzeile ist Spalte 2 leer')
    expect(text).toContain('In der Kopfzeile sind die Spalten 2, 5 leer')
    expect(text).toContain('Die Kopfzeile vergibt „Betrag“ mehrfach')
    expect(text).toContain('Spalte „dauer“ hat den Parquet-Typ INTERVAL, den querbeet nicht')
    expect(text).toContain('Die Datei enthält 2 Spalten mit dem Namen „Betrag“')
    expect(text).toContain('Spalte „preis“: ein Wert hat mehr Stellen')
    expect(text).toContain('Spalte „preis“: 4 Werte haben mehr Stellen')
    expect(text).toContain('Spalte „erfasst“ ist in Mikrosekunden gespeichert')
    expect(text).toContain('Spalte „erfasst“ ist in Nanosekunden gespeichert')
    expect(text).toContain('Spalte „quote“ enthält einen Wert, der keine Zahl ist')
    expect(text).toContain('Spalte „quote“ enthält 3 Werte, die keine Zahlen sind')
    // The codec message says the file is fine, because it is — the old sentence
    // offered three diagnoses and all three were wrong.
    expect(text).toContain('ist mit dem Verfahren GZIP komprimiert')
    expect(text).toContain('Die Datei ist in Ordnung')
    expect(text).not.toContain('Unbekannte Meldung aus dem Kern.')
  })

  it('says nothing that the rename sentence beside it contradicts', async () => {
    // The store concatenates the reader's diagnostics with its own, so these
    // render on one card. Until 2026-08-04 three of the reader sentences
    // described the state *before* the store made column names unique — "diese
    // Spalte bleibt ohne Namen", "sind aber am Namen nicht zu unterscheiden",
    // "querbeet kann sie nicht auseinanderhalten" — and each one is now the
    // opposite of what the sentence one line down reports. The earlier version
    // of this suite asserted only the prefixes and stopped exactly before the
    // clauses that became false.
    const renamed = {
      severity: 'warning',
      code: 'source.columns_renamed',
      values: { renamed: [{ from: 'Betrag', to: 'Betrag_2', at: 3 }] },
    }

    const w = await render(
      stubStore(
        source([column('Kunde'), column('Betrag'), column('Betrag_2')], {
          diagnostics: [
            renamed,
            { severity: 'warning', code: 'xlsx.duplicate_header', values: { columns: ['Betrag'] } },
            { severity: 'warning', code: 'xlsx.blank_header', values: { columns: [4] } },
          ],
        }),
      ),
    )

    const text = w.text()
    // The rename sentence names what became what, which is the whole point:
    // a user looking for `Betrag` in a Filter's column select has to find out.
    expect(text).toContain('„Betrag“ (Spalte 3) heißt jetzt „Betrag_2“')
    expect(text).toContain('Eine Tabelle kann zwei Spalten gleichen Namens nicht auseinanderhalten.')
    // …and it no longer claims the values are untouched, which is true of CSV
    // and XLSX and false of Parquet, where a duplicated column arrives empty.
    expect(text).not.toContain('die Werte selbst sind unverändert')

    // The two XLSX sentences describe the outcome rather than the old one.
    expect(text).toContain('querbeet hat die Spalten beim Einlesen eindeutig benannt')
    expect(text).not.toContain('am Namen nicht zu unterscheiden')
    expect(text).toContain('querbeet benennt sie beim Einlesen nach ihrer Position')
    expect(text).not.toContain('diese Spalte bleibt ohne Namen')
  })

  it('says of a duplicated Parquet column what is still true of it', async () => {
    // The names are distinguishable now; the values are still missing, because
    // the reader plans a duplicated column as unreadable and fills it with
    // nulls. Story 6b does not open that reader, so the sentence has to be true
    // of the file rather than repeat a premise that changed.
    const w = await render(
      stubStore(
        source([column('Betrag'), column('Betrag_2')], {
          diagnostics: [
            {
              severity: 'warning',
              code: 'source.columns_renamed',
              values: { renamed: [{ from: 'Betrag', to: 'Betrag_2', at: 2 }] },
            },
            {
              severity: 'warning',
              code: 'parquet.duplicate_column_name',
              values: { column: 'Betrag', columns: 2 },
            },
          ],
        }),
      ),
    )

    const text = w.text()
    expect(text).toContain('Die Namen sind beim Einlesen eindeutig gemacht worden')
    expect(text).toContain('die Werte dieser Spalten liest querbeet aber noch nicht')
    expect(text).not.toContain('querbeet kann sie nicht auseinanderhalten')
    expect(text).not.toContain('die Werte selbst sind unverändert')
  })

  it('names a refused native type in German, and still offers the column a type', async () => {
    // A Parquet TIME or DECIMAL column. The declaration was discarded in
    // core/types, so the column is text-domained and settable like any other —
    // and the word it was refused for is on the record as provenance, which is
    // what the sentence names.
    const store = stubStore(
      source([column('Preis', { type: 'number', domain: 'text', refusedNativeType: 'decimal' })], {
        diagnostics: [
          {
            severity: 'warning',
            code: 'typing.unknown_native_type',
            values: { column: 'Preis', type: 'decimal' },
          },
        ],
      }),
    )
    const w = await render(store)

    expect(w.text()).toContain(
      'Spalte „Preis“ wurde vom Dateiformat als „decimal“ angekündigt — diesen Typ kennt querbeet nicht',
    )
    expect(w.text()).not.toContain('Unbekannte Meldung aus dem Kern.')

    // Settable, and no "vom Format vorgegeben" claim: nothing about this column
    // was settled by its format.
    expect(w.find('[data-testid="typing-native"]').exists()).toBe(false)
    const select = w.get('select[aria-label="Typ: Preis"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual([
      'Text',
      'Zahl',
      'Datum',
      'Zeitstempel',
      'Uhrzeit',
      'Dauer',
      'Wahrheitswert',
    ])
    expect(select.element.value).toBe('number')

    await select.setValue('text')
    expect(store.calls).toContainEqual(['setColumnTyping', 'src:daten', 0, { type: 'text' }])
  })
})

// ------------------------------------------- the count, followed to the rows
//
// CAP-9's panel says how many values are unreadable; until story 6 it could not
// show which. What only a render function executes is the hand-off: the pane asks
// Step zero for the conversion of a *confirmed* Source and passes the failing row
// indices to the preview. The conversion itself is core's and is tested there;
// what is asserted here is that the pane asks at all, that it stops asking when
// the Source is not confirmed, and that the sentence on a marked cell is German.

describe('the unreadable values, marked in the preview', () => {
  const AMOUNTS = ['1.234,56', '80,00', '12,50', '7,25', '0,99', '3,00', '45,10', '9,90', '100,00']

  /** A Source whose `Betrag` column carries nine readable amounts and one that
   *  is not — 90 %, which is the threshold, so the column really is a `number`
   *  column with one failure rather than a `text` column. */
  const withOneUnreadable = (confirmed) => {
    const cells = [...AMOUNTS, 'abc']
    const typed = detectColumn(cells)
    return source([{ ...column('Betrag'), ...typed, annotation: '', chosen: null }], {
      table: { columns: [{ name: 'Betrag', domain: 'text', cells }], rowCount: cells.length },
      typing: {
        columns: [{ name: 'Betrag', annotation: '', chosen: null, ...typed }],
        confirmed,
      },
    })
  }

  it('marks exactly the value the count is about, and shows its original text', async () => {
    const entry = withOneUnreadable(true)
    expect(entry.typing.columns[0].counts.unparsed).toBe(1)

    const w = await render(stubStore(entry))
    const marked = w.findAll('[data-testid="preview-mark"]')

    expect(marked).toHaveLength(1)
    expect(marked[0].text()).toBe('abc')
    expect(marked[0].attributes('title')).toBe('Unter dem bestätigten Typ nicht lesbar')
  })

  it('marks nothing until the types are confirmed — AD-29’s first gate', async () => {
    const w = await render(stubStore(withOneUnreadable(false)))

    expect(w.findAll('[data-testid="preview-mark"]')).toHaveLength(0)
    // …and the preview is genuinely rendered, so the assertion above is about
    // the marks rather than about a component that drew nothing.
    expect(w.findAll('[data-testid="preview-row"]').length).toBe(10)
  })
})

// -------------------------------------------- what a removed Source lets go of
//
// The Step-zero cache and the mark memo are plain `Map`s in a closure, keyed by
// Source id, because a converted Table must never enter reactive state (AD-6).
// That is also what makes them the one thing in this pane nothing else cleans up:
// no entry ever arrives for a removed Source again, so `remove()` has to say so.
//
// Mutation-proven: deleting `stepZero.release(id)` and `markMemo.delete(id)` from
// `remove()` left every unit and every e2e test green, while a removed Source's
// converted Table stayed reachable from the closure for the life of the page.
// This is the assertion that turns red when either line goes.

describe('a Source removed lets go of its conversion', () => {
  const AMOUNTS = ['1.234,56', '80,00', '12,50', '7,25', '0,99', '3,00', '45,10', '9,90', '100,00']

  it('converts again when the same entry comes back, rather than answering from a stale cache', async () => {
    const cells = [...AMOUNTS, 'abc']
    const typed = detectColumn(cells)
    const entry = source([{ ...column('Betrag'), ...typed }], {
      table: { columns: [{ name: 'Betrag', domain: 'text', cells }], rowCount: cells.length },
      typing: {
        columns: [{ name: 'Betrag', annotation: '', chosen: null, ...typed }],
        confirmed: true,
      },
    })

    // The *same frozen entry* throughout. A fresh object would convert again on
    // its own identity and prove nothing about the release.
    let present = true
    const engine = { calls: 0, fromColumns: () => ((engine.calls += 1), {}) }
    const store = {
      ...stubStore(entry),
      list: () => (present ? [entry] : []),
      removeSource: () => {
        present = false
      },
      addSource: async () => {
        present = true
        return { source: entry, diagnostics: [] }
      },
    }

    const w = await render(store, engine)
    expect(engine.calls).toBe(1)
    expect(w.findAll('[data-testid="preview-mark"]')).toHaveLength(1)

    await w.find('[aria-label="Entfernen: daten"]').trigger('click')
    await nextTick()
    expect(w.findAll('[data-testid="source-card"]')).toHaveLength(0)

    // Load it again. If either line in `remove()` is missing, the cached
    // conversion (or the memoized marks in front of it) answers and the engine is
    // never asked a second time.
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'daten.csv', arrayBuffer: async () => new ArrayBuffer(8) }],
      configurable: true,
      writable: true,
    })
    await input.trigger('change')
    await flushPromises()
    await nextTick()

    expect(w.findAll('[data-testid="source-card"]')).toHaveLength(1)
    expect(engine.calls).toBe(2)
    expect(w.findAll('[data-testid="preview-mark"]')).toHaveLength(1)
  })
})

// ------------------------------ what a withdrawn Source withdraws (7a review r1)
//
// AD-29: a table computed from types nobody vouches for must not survive the
// withdrawal. The Step-zero store honours that per Source id, above. Story 7a's
// run cache holds every *Step's* table computed from the same Source and cannot:
// it is content-keyed on purpose and has no id to release by, so `clear()` is
// the honest primitive and this pane owns the two commands that need it.
//
// Coarse — it throws away entries belonging to Sources nobody touched — and
// correct, which is the trade the frozen "an eviction is a miss, never a wrong
// answer" rule licenses.

describe('a withdrawn Source withdraws the run cache', () => {
  const confirmedSource = () => {
    const columns = [column('Betrag')]
    return source(columns, { typing: { columns, confirmed: true } })
  }

  it('clears it when the Source is removed', async () => {
    const runCache = clearRecorder()
    const w = await render(stubStore(source([column('Betrag')])), stubEngine(), runCache)

    await w.find('[aria-label="Entfernen: daten"]').trigger('click')

    expect(runCache.cleared.count).toBe(1)
  })

  it('clears it when the confirmation is withdrawn', async () => {
    const runCache = clearRecorder()
    const store = stubStore(confirmedSource())
    const w = await render(store, stubEngine(), runCache)

    await w.find('[aria-label="Bestätigung aufheben: daten"]').trigger('click')

    expect(store.calls).toContainEqual(['unconfirmTyping', 'src:daten'])
    expect(runCache.cleared.count).toBe(1)
  })

  it('clears it when a column is retyped, which unmakes the confirmation', async () => {
    // `setColumnTyping` commits `confirmed: false` — a type the user changed is a
    // typing nobody has vouched for yet — so it withdraws exactly as `unconfirm`
    // does. Missed in round 1 because the rule had been written down as a list of
    // two commands rather than as a rule.
    const runCache = clearRecorder()
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store, stubEngine(), runCache)

    await w.find('select[aria-label="Typ: Betrag"]').setValue('number')

    expect(store.calls).toContainEqual(['setColumnTyping', 'src:daten', 0, { type: 'number' }])
    expect(runCache.cleared.count).toBe(1)
  })

  it('clears it when the Source is re-parsed under a new delimiter', async () => {
    // A re-parse reaches `confirmed: false` through the store's `retype`, so both
    // `reconfigureParse` and `overrideEncoding` withdraw — and they withdraw the
    // *table* as well, which is the half a typing command does not.
    const runCache = clearRecorder()
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store, stubEngine(), runCache)

    await w.find('select[aria-label="Trennzeichen"]').setValue(';')
    await flushPromises()

    expect(store.calls).toContainEqual(['reconfigureParse', 'src:daten', { delimiter: ';' }])
    expect(runCache.cleared.count).toBe(1)
  })

  it('clears it when the encoding is overridden, which re-parses too', async () => {
    const runCache = clearRecorder()
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store, stubEngine(), runCache)

    await w.find('select[aria-label="Zeichenkodierung"]').setValue('windows-1252')
    await flushPromises()

    expect(store.calls).toContainEqual(['overrideEncoding', 'src:daten', 'windows-1252'])
    expect(runCache.cleared.count).toBe(1)
  })

  it('clears it for the other two re-parse controls, which round 2 left uncovered', async () => {
    // Four handlers reach `reparse` and only two had a case. A header row and a
    // sheet switch re-read the retained bytes exactly as a delimiter does, and
    // both drop the confirmation with them.
    const runCache = clearRecorder()
    const store = stubStore(
      source([column('Betrag')], { proposal: { delimiter: ',', headerRow: 1, sheets: ['Q1', 'Q2'], sheet: 'Q1' } }),
    )
    const w = await render(store, stubEngine(), runCache)

    const headerRow = w.find('input[aria-label="Kopfzeile"]')
    headerRow.element.value = '3'
    await headerRow.trigger('change')
    await flushPromises()
    expect(store.calls).toContainEqual(['reconfigureParse', 'src:daten', { headerRow: 3 }])
    expect(runCache.cleared.count).toBe(1)

    await w.find('select[aria-label="Tabellenblatt"]').setValue('Q2')
    await flushPromises()
    expect(store.calls).toContainEqual(['reconfigureParse', 'src:daten', { sheet: 'Q2' }])
    expect(runCache.cleared.count).toBe(2)
  })

  it('clears nothing when a re-parse control issued no command at all', async () => {
    // **The performance defect round 3 found, pinned.** Three of the four
    // handlers have a no-op path — an empty delimiter, an empty sheet, a header
    // row that is not a positive integer — and all three still go through
    // `reparse`, because the refresh is what snaps the bound control back to the
    // state the application holds. Ungated, a keystroke in the Kopfzeile field
    // discarded the whole cache, on the exact path this story exists to make
    // fast.
    const runCache = clearRecorder()
    const store = stubStore(
      source([column('Betrag')], { proposal: { delimiter: ',', headerRow: 1, sheets: ['Q1', 'Q2'], sheet: 'Q1' } }),
    )
    const w = await render(store, stubEngine(), runCache)

    const headerRow = w.find('input[aria-label="Kopfzeile"]')
    for (const typed of ['', '0', '-1', '2.5']) {
      headerRow.element.value = typed
      await headerRow.trigger('change')
      await flushPromises()
    }
    await w.find('select[aria-label="Trennzeichen"]').setValue('')
    await w.find('select[aria-label="Tabellenblatt"]').setValue('')
    await flushPromises()

    expect(store.calls.filter(([name]) => name === 'reconfigureParse')).toEqual([])
    expect(runCache.cleared.count).toBe(0)
  })

  it('leaves it alone for a rename and a confirmation, which withdraw nothing', async () => {
    // The complement of the rule, and it is narrower than its round-1 name
    // ("every command that withdraws nothing") claimed: these two are the
    // commands that leave a confirmation standing, and `annotateColumn` is the
    // third. Clearing on those would make the cache useless without making
    // anything safer.
    const runCache = clearRecorder()
    const w = await render(stubStore(source([column('Betrag')])), stubEngine(), runCache)

    const name = w.find('input[aria-label="Name"]')
    name.element.value = 'Umsatz'
    await name.trigger('change')
    const note = w.find('input[aria-label="Notiz: Betrag"]')
    note.element.value = 'in Euro'
    await note.trigger('change')
    await w.find('[aria-label="Typen bestätigen: daten"]').trigger('click')

    expect(runCache.cleared.count).toBe(0)
  })

  it('does not require a cache at all — the prop is optional', async () => {
    const w = await render(stubStore(source([column('Betrag')])))
    await expect(w.find('[aria-label="Entfernen: daten"]').trigger('click')).resolves.not.toThrow()
  })
})
