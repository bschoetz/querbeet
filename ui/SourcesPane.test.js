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
import SourcesPane from './SourcesPane.vue'

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
const stubStore = (entry, { unresolved = [] } = {}) => {
  const calls = []
  return {
    calls,
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

  it('leaves a type the format already decided alone', async () => {
    // `native:boolean` from an XLSX sheet, once story 4 lands. A select whose
    // options lack the current value would show "Text" and retype the column on
    // the first interaction.
    const w = await render(
      stubStore(source([column('Aktiv', { type: 'boolean', domain: 'native:boolean' })])),
    )

    expect(w.find('select[aria-label="Typ: Aktiv"]').exists()).toBe(false)
    expect(w.find('[data-testid="typing-native"]').text()).toContain('boolean')
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
})
