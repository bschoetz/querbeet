// The half of the Step card that only a render function can execute: the `v-if`
// that decides which controls a kind gets, the interpolated German, and the slot
// row that turns connecting into choosing a value in a form.
//
// happy-dom, `--project ui` (AD-27). Nothing here needs geometry.

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createGraphStore } from '@core/graph/graph-store.js'
import { graphLabelGaps, kindLabelGaps } from '@ui/graph-labels.js'
import StepCard from './StepCard.vue'

const step = (over = {}) => ({
  id: 'u1',
  kind: 'union',
  name: 'Halbjahr',
  x: 0,
  y: 0,
  inputs: [null, null],
  ...over,
})

const render = (props) =>
  mount(StepCard, {
    props: {
      node: step(),
      candidates: () => [],
      nameOf: (id) => id,
      ...props,
    },
  })

const slotSelects = (w) => w.findAll('[data-testid="step-slot"] select')
const marks = (w) => w.findAll('[data-testid="step-mark"]').map((m) => m.text())

describe('the German maps', () => {
  it('have a word for every code the core emits and every kind it knows', () => {
    // The relationship `typeLabelGaps()` has to the type catalogue. `GRAPH_CODES`
    // is built out of the constants the emit sites use, so this cannot pass by
    // checking an enumeration that has drifted from what is emitted.
    expect(graphLabelGaps()).toEqual([])
    expect(kindLabelGaps()).toEqual([])
  })
})

describe('the card', () => {
  it('names the kind in German and shows the name as editable state', () => {
    const w = render()
    expect(w.text()).toContain('Union')
    expect(w.find('input[aria-label="Name"]').element.value).toBe('Halbjahr')
  })

  it('offers the Result badge to a Step and never to a Source', () => {
    expect(render().find('[aria-label="Als Ergebnis-Step setzen"]').exists()).toBe(true)
    const source = render({ node: step({ id: 'src:a', kind: 'source', inputs: [] }) })
    expect(source.find('[aria-label="Als Ergebnis-Step setzen"]').exists()).toBe(false)
    expect(source.text()).toContain('Quelle')
  })

  it('gives a Source no slot rows and no slot controls, because it has no inputs', () => {
    const w = render({ node: step({ id: 'src:a', kind: 'source', inputs: [] }) })
    expect(slotSelects(w)).toHaveLength(0)
    expect(w.text()).not.toContain('Eingang hinzufügen')
  })

  it('names a Join s two inputs rather than numbering them', () => {
    const w = render({ node: step({ id: 'j1', kind: 'join', inputs: [null, null] }) })
    expect(slotSelects(w).map((s) => s.attributes('aria-label'))).toEqual(['Links', 'Rechts'])
  })
})

describe('the marks', () => {
  it('render every one of them from the map, orphan included', () => {
    // Round 1 filtered `graph.orphan` out before it could reach a card while the
    // card hard-coded a different sentence, which inverts the gap check into
    // something that passes on a dead entry.
    const w = render({
      diagnostics: [
        {
          severity: 'warning',
          code: 'graph.input_lost',
          values: { id: 'u1', lost: [{ slot: 1, name: 'Umsatz Q2' }] },
          stepId: 'u1',
        },
        { severity: 'info', code: 'graph.orphan', values: { id: 'u1' }, stepId: 'u1' },
      ],
      nameOf: (id) => (id === 'u1' ? 'Halbjahr' : id),
    })

    expect(marks(w)[0]).toContain('„Halbjahr“ hat an Eingang 2 „Umsatz Q2“ verloren.')
    expect(marks(w)[0]).toContain('Warnung')
    expect(marks(w)[1]).toContain('„Halbjahr“ trägt nicht zum Ergebnis bei.')
    expect(marks(w)[1]).toContain('Hinweis')
  })

  it('resolve a name against the graph being rendered, not against the diagnostic', () => {
    const w = render({
      diagnostics: [
        {
          severity: 'warning',
          code: 'graph.inputs_missing',
          values: { id: 'u1', required: 2, filled: 1 },
          stepId: 'u1',
        },
      ],
      nameOf: () => 'Erstes Halbjahr',
    })
    expect(marks(w)[0]).toContain('„Erstes Halbjahr“ braucht 2 Eingänge, hat aber 1.')
  })
})

describe('the input-slot rows — the keyboard path to connecting', () => {
  it('offer the accepted Steps and leave the refused ones out entirely', () => {
    const w = render({
      candidates: (id, slot) => (slot === 0 ? ['src:q1', 'src:q2'] : []),
      nameOf: (id) => ({ 'src:q1': 'Umsatz Q1', 'src:q2': 'Umsatz Q2' })[id] ?? id,
    })

    const options = slotSelects(w)[0].findAll('option')
    expect(options.map((o) => o.text())).toEqual(['— nicht verbunden —', 'Umsatz Q1', 'Umsatz Q2'])
    // The second slot has nothing to offer and says so rather than going blank.
    expect(slotSelects(w)[1].findAll('option')).toHaveLength(1)
  })

  it('display what is attached, which a select cannot do unless it is an option', () => {
    const w = render({
      node: step({ inputs: ['src:q1', null] }),
      candidates: () => ['src:q2'],
      nameOf: (id) => id.toUpperCase(),
    })

    expect(slotSelects(w)[0].element.value).toBe('src:q1')
    expect(slotSelects(w)[0].findAll('option').map((o) => o.text())).toEqual([
      '— nicht verbunden —',
      'SRC:Q1',
      'SRC:Q2',
    ])
  })

  it('issue connect with the slot index the row stands for', () => {
    const w = render({ candidates: () => ['src:q1', 'src:q2'] })

    slotSelects(w)[1].setValue('src:q2')
    expect(w.emitted('connect')).toEqual([[1, 'src:q2']])
    expect(w.emitted('disconnect')).toBeUndefined()
  })

  it('read the empty option as the disconnect it is', () => {
    const w = render({ node: step({ inputs: ['src:q1', 'src:q2'] }), candidates: () => [] })
    slotSelects(w)[0].setValue('')
    expect(w.emitted('disconnect')).toEqual([[0]])
  })
})

describe('the slot controls', () => {
  it('are present and clickable at the limit, so the refusal is what names it', () => {
    // Hiding or disabling them makes the two matrix rows for `graph.max_inputs`
    // and `graph.min_inputs` unreachable outside a unit test.
    const join = render({ node: step({ id: 'j1', kind: 'join', inputs: ['a', 'b'] }) })
    const add = join.findAll('button').find((b) => b.text() === 'Eingang hinzufügen')

    expect(add.attributes('disabled')).toBeUndefined()
    add.trigger('click')
    expect(join.emitted('add-slot')).toHaveLength(1)

    const remove = join.find('[aria-label="Eingang entfernen: Links"]')
    expect(remove.attributes('disabled')).toBeUndefined()
    remove.trigger('click')
    expect(join.emitted('remove-slot')).toEqual([[0]])
  })

  it('reach the store s real refusals, which is what those buttons are for', () => {
    // Driven against the actual commands rather than against a stub, so the two
    // matrix rows are pinned to what a user pressing the button would get.
    const store = createGraphStore()
    const join = store.addStep('join').id
    const union = store.addStep('union').id

    expect(store.addInputSlot(join).diagnostics[0].code).toBe('graph.max_inputs')
    expect(store.removeInputSlot(union, 1).diagnostics[0].code).toBe('graph.min_inputs')
  })
})
