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

describe('the confirmation', () => {
  it('reports the refusal and names the columns it is waiting for', async () => {
    const entry = source([
      column('Datum', {
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
    expect(store.calls).toContainEqual(['confirmTyping', 'src:daten'])
  })

  it('leaves no refusal standing when the Source goes through', async () => {
    const store = stubStore(source([column('Kunde')]), { unresolved: [] })
    const w = await render(store)

    await w.get('button[aria-label="Typen bestätigen: daten"]').trigger('click')

    expect(w.find('[data-testid="typing-refusal"]').exists()).toBe(false)
  })

  it('offers to reopen a confirmed Source rather than trapping the user', async () => {
    const entry = source([column('Kunde')], { typing: { columns: [column('Kunde')], confirmed: true } })
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
  it('sends a type change with a reading, never a type alone', async () => {
    // A "Zahl" column with no reading chosen would score against nothing.
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store)

    await w.get('select[aria-label="Typ: Betrag"]').setValue('number')

    const [, id, name, patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect([id, name]).toEqual(['src:daten', 'Betrag'])
    expect(patch.type).toBe('number')
    expect(patch.format.locale).toBe('de-DE')
  })

  it('spells the empty cell as a word, so it can be typed back in', async () => {
    // "" in a comma-separated list is invisible and untypeable. It round-trips
    // through the word instead.
    const store = stubStore(source([column('Betrag', { missingTokens: ['', 'k.A.'] })]))
    const w = await render(store)
    const field = w.get('input[aria-label="Fehlende Werte: Betrag"]')

    expect(field.element.value).toBe('(leer), k.A.')

    await field.setValue('(leer), n/a')
    const [, , , patch] = store.calls.find((c) => c[0] === 'setColumnTyping')
    expect(patch.missingTokens).toEqual(['', 'n/a'])
  })

  it('passes an annotation through as the user’s own text', async () => {
    const store = stubStore(source([column('Betrag')]))
    const w = await render(store)

    await w.get('input[aria-label="Notiz: Betrag"]').setValue('Netto, ohne Fracht')

    expect(store.calls).toContainEqual([
      'annotateColumn',
      'src:daten',
      'Betrag',
      'Netto, ohne Fracht',
    ])
  })
})
