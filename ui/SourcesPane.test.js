// The Step zero panel's own branches, in the ui/ envelope (AD-27, R10).
//
// What is here is what only a render function executes: the sentence chosen for
// each ambiguity verdict, and the refusal that appears when a Source cannot be
// confirmed. The store is a stub — the real one is exercised in
// core/exec/source-store.test.js, and mounting the pane against it would test
// that file twice while testing this one less.

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { TYPES } from '@core/types/catalog.js'
import SourcesPane from './SourcesPane.vue'
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

const render = async (store) => {
  const w = mount(SourcesPane, { props: { store } })
  await nextTick()
  return w
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

  it('takes the reading the panel was already showing as a real answer', async () => {
    const store = stubStore(source([undecided()]))
    const w = await render(store)

    await w.get('select[aria-label="Lesart: Datum"]').setValue('dd.MM.yyyy')

    const [, id, at, patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect([id, at]).toEqual(['src:daten', 0])
    expect(patch.format.pattern).toBe('dd.MM.yyyy')
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
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Text', 'Zahl', 'Datum'])
    expect(select.element.value).toBe('number')

    await select.setValue('text')
    expect(store.calls).toContainEqual(['setColumnTyping', 'src:daten', 0, { type: 'text' }])
  })
})
