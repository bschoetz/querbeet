// The half of the Step card that only a render function can execute: the `v-if`
// that decides which controls a kind gets, the interpolated German, and the slot
// row that turns connecting into choosing a value in a form.
//
// happy-dom, `--project ui` (AD-27). Nothing here needs geometry.

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { createGraphStore } from '@core/graph/graph-store.js'
import { error, info, warning } from '@core/diagnostics/diagnostic.js'
import { CODE } from '@core/steps/index.js'
import { CODE as EXEC_CODE } from '@core/exec/execute.js'
import {
  directionLabelGaps,
  endLabelGaps,
  graphLabelGaps,
  graphText,
  kindLabelGaps,
  operatorLabelGaps,
  progressText,
} from '@ui/graph-labels.js'
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
    // Story 6b added two more producers behind the same invariant — the Step
    // kinds and the executor, both enumerated from their own emit sites — plus
    // the Filter's closed operator and combination vocabulary, which reaches the
    // screen as select options rather than as diagnostics.
    expect(operatorLabelGaps()).toEqual([])
    // Story 6d added a fourth closed vocabulary behind the same invariant: a
    // sort key's direction, which reaches the screen as a select option, so a
    // missing word here would put a raw `asc` in front of the user.
    expect(directionLabelGaps()).toEqual([])
    // …and a fifth when the limit gained its flag: which end the rows come from
    // is a select option too, and `first`/`last` is machine vocabulary.
    expect(endLabelGaps()).toEqual([])
  })

  it('says which rows a limit kept were unreadable, and why they were at that end', () => {
    // The one thing a person cannot see for themselves: „die letzten 3" after a
    // sort lands exactly where the unreadable values were placed. Reported
    // rather than refused — inspecting those rows is a real reason to ask.
    const one = graphText(warning(CODE.boxedRowsKept, { rows: 1 }))
    expect(one).toContain('1 der behaltenen Zeilen enthält')
    expect(one).toContain('am Ende')

    // German counts one of a thing differently, and the verb follows the number.
    const many = graphText(warning(CODE.boxedRowsKept, { rows: 4 }))
    expect(many).toContain('4 der behaltenen Zeilen enthalten')
  })

  it('names the column in the Sort’s refusal, and never the core’s own field name', () => {
    // CAP-40's configure-time refusal is the one a loaded Recipe reaches: the
    // form never offers a column another key already sorts by, so this sentence
    // is what a Recipe out of a language model meets. It has to name the column,
    // because "already taken" alone says nothing about what to change.
    const said = graphText(error(CODE.sortKeyRepeated, { column: 'Betrag', at: 1 }))

    expect(said).toContain('„Betrag“')
    expect(said).toContain('bleibt in Kraft')

    // The two kinds share `step.config_invalid`, and `at` alone cannot tell a
    // sort key from a filter condition — so the field decides the word, and the
    // field itself never reaches the screen (NFR-6).
    const key = graphText(error(CODE.configInvalid, { field: 'key', at: 1 }))
    expect(key).toContain('Sortierung 2')
    expect(key).toContain('unvollständig')
    expect(key).not.toContain('key')

    // A key with no column has not finished; a key whose direction is neither
    // word is complete and *wrong*, which is the shape a loaded Recipe arrives
    // in. „Unvollständig" over the second would send its author looking for
    // something missing — so the two states get two sentences.
    const direction = graphText(error(CODE.configInvalid, { field: 'direction', at: 0, value: 'up' }))
    expect(direction).toContain('Sortierung 1')
    expect(direction).toContain('keine gültige Richtung')
    expect(direction).not.toContain('unvollständig')
    expect(direction).not.toMatch(/\b(asc|desc|direction|up)\b/)

    const count = graphText(error(CODE.configInvalid, { field: 'count', value: '0' }))
    expect(count).toContain('ganze Zahl ab 1')
    expect(count).not.toContain('count')
  })

  // ------------------------------------------- what a cancelled run says (7b)
  //
  // Three branches, three cases. Round 1 wrote all three and asserted the text of
  // one, which is how „Von 1 Steps" and a hard-coded „1" both shipped — and how a
  // sentence that counts Quellen as Steps shipped with them.

  it('says how far a cancelled run got, in all three of its branches', () => {
    const said = (done, total) =>
      graphText(info(EXEC_CODE.runCancelled, { done, total }))

    // Nothing finished. „war noch keiner" and not „waren 0", which reads as a
    // count of a thing that did not happen.
    expect(said(0, 12)).toContain('Von 12 Arbeitsschritten (Quellen mitgezählt) war noch keiner')
    // Exactly one, and the verb follows the number — the shape every count in this
    // file has.
    expect(said(1, 12)).toContain('war 1 fertig gerechnet')
    // More than one, with the German thousands separator the rest of the file uses.
    expect(said(1234, 5678)).toContain('waren 1.234 fertig gerechnet')
    expect(said(1234, 5678)).toContain('Von 5.678 Arbeitsschritten')

    // Every branch says the two things that decide whether cancelling is safe to
    // press: the work is kept, and the screen is still the previous run's.
    for (const text of [said(0, 12), said(1, 12), said(3, 12)]) {
      expect(text).toContain('Der Lauf wurde abgebrochen')
      expect(text).toContain('bleiben gespeichert')
      expect(text).toContain('vorherigen Laufs')
    }
  })

  it('counts a walk of one without putting a plural on it', () => {
    // „Von 1 Steps war noch keiner gerechnet" is what round 1 rendered for the
    // shortest run there is, which for a single Quelle is also the commonest one.
    const one = graphText(info(EXEC_CODE.runCancelled, { done: 0, total: 1 }))

    expect(one).toContain('Von 1 Arbeitsschritt ')
    expect(one).not.toContain('1 Arbeitsschritten')
  })

  it('never calls the walk’s positions Steps, because Quellen are among them', () => {
    // A 45-Step chain over one Source walks 46 nodes. „Von 46 Steps" in front of a
    // Pipeline the user can count 45 Steps in is the interface being wrong about
    // the one number it is reporting.
    const said = graphText(info(EXEC_CODE.runCancelled, { done: 3, total: 46 }))

    expect(said).not.toMatch(/\bSteps\b/)
    expect(said).toContain('Quellen mitgezählt')
  })

  it('names the kind of the node a run is working on, rather than calling it a Step', () => {
    // The same defect on the progress line: round 1 rendered „Rechnet Step 1 von
    // 46: „gross““ for a Quelle. The kind comes from the walk itself.
    const source = progressText(
      { done: 0, total: 46, stepId: 'src:gross', kind: 'source' },
      () => 'gross',
    )
    expect(source).toBe('Rechnet Quelle „gross“ (1 von 46)')

    const filter = progressText(
      { done: 3, total: 46, stepId: 's3', kind: 'filter' },
      () => 'Nur Große',
    )
    expect(filter).toBe('Rechnet Filter „Nur Große“ (4 von 46)')

    // A kind with no German word falls back to naming the node alone rather than
    // to printing the core's code — the rule the whole of this file exists for.
    expect(progressText({ done: 0, total: 2, stepId: 'x', kind: 'wat' }, () => 'X')).toBe(
      'Rechnet „X“ (1 von 2)',
    )
  })
})

describe('the card', () => {
  it('names the kind in German and shows the name as editable state', () => {
    const w = render()
    expect(w.text()).toContain('Union')
    expect(w.find('input[aria-label="Name"]').element.value).toBe('Halbjahr')
  })

  it('puts the field back to what the model holds when a rename is refused', async () => {
    // The state the refusal exists to prevent, one layer out: the model keeps the
    // old name, so Vue sees an unchanged prop and never patches the DOM, and the
    // field goes on showing text the model does not hold while the refusal beside
    // it says „der alte bleibt stehen".
    const w = render()
    const field = w.find('input[aria-label="Name"]')

    await field.setValue('')
    expect(w.emitted('rename')).toEqual([['']])
    await nextTick()

    expect(field.element.value).toBe('Halbjahr')
  })

  it('puts the trimmed name back where the user typed spaces', async () => {
    const w = render({ node: step({ name: 'Halbjahr' }) })
    const field = w.find('input[aria-label="Name"]')

    await field.setValue('  Halbjahr  ')
    await nextTick()

    // The prop did not change, so this is the same write-back doing the work.
    expect(field.element.value).toBe('Halbjahr')
  })

  it('takes its accessible name from the pane, which is the only place that can see a clash', async () => {
    const w = render({ label: 'Filter: Filter (s7)' })
    expect(w.get('[data-testid="step-card"]').attributes('aria-label')).toBe('Filter: Filter (s7)')

    // …and falls back to kind and name where nothing supplied one.
    const bare = render()
    expect(bare.get('[data-testid="step-card"]').attributes('aria-label')).toBe('Union: Halbjahr')
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

  it("names a Join's two inputs rather than numbering them", () => {
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

  it("reach the store's real refusals, which is what those buttons are for", () => {
    // Driven against the actual commands rather than against a stub, so the two
    // matrix rows are pinned to what a user pressing the button would get.
    const store = createGraphStore()
    const join = store.addStep('join').id
    const union = store.addStep('union').id

    expect(store.addInputSlot(join).diagnostics[0].code).toBe('graph.max_inputs')
    expect(store.removeInputSlot(union, 1).diagnostics[0].code).toBe('graph.min_inputs')
  })
})
