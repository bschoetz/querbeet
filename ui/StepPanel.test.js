// The side panel's own execution, in the `ui/` envelope (AD-27, R10).
//
// What is here is what only a render function does: which control a column's
// type gets, what a locale-aware entry stores, what the counts say when a Step
// produced nothing, and the one refusal this component owns rather than the
// model. The Step kinds themselves are exercised in `core/steps/steps.test.js`
// and the whole chain in `tests/e2e/execution.spec.js`; mounting the panel
// against them would test those files twice and this one less.

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { error, info, warning } from '@core/diagnostics/diagnostic.js'
import StepPanel from './StepPanel.vue'

const step = (over = {}) => ({
  id: 's1',
  kind: 'filter',
  name: 'Nur Große',
  x: 0,
  y: 0,
  inputs: ['src:a'],
  config: null,
  ...over,
})

const SCHEMA = [
  { name: 'Kunde', type: 'text' },
  { name: 'Betrag', type: 'number' },
  { name: 'Datum', type: 'date' },
]

/** A `Table` handle just wide enough for the preview: `previewColumns` calls
 *  `schema()`, `rowCount()` and `rows()`, and nothing else. */
const handle = (schema, rows) => ({
  rowCount: () => rows.length,
  schema: () => schema,
  column: () => {
    throw new Error('the preview must not copy a whole column')
  },
  *rows() {
    for (const row of rows) yield row
  },
})

const result = (over = {}) => ({
  table: handle(SCHEMA, [
    { Kunde: 'Anna', Betrag: 1234.56, Datum: 1767139200000000000n },
    { Kunde: 'Bernd', Betrag: 80, Datum: null },
  ]),
  rowCount: 2,
  columnCount: 3,
  diagnostics: [],
  ...over,
})

const render = async (props = {}) => {
  const w = mount(StepPanel, {
    props: {
      step: step(),
      label: 'Filter: Nur Große',
      inputSchema: SCHEMA,
      result: null,
      nameOf: (id) => id,
      ...props,
    },
  })
  await nextTick()
  return w
}

const configured = (w) => w.emitted('configure')?.at(-1)?.[0] ?? null
const conditions = (w) => w.findAll('[data-testid="filter-condition"]')
const entries = (w) => w.findAll('[data-testid="columns-entry"]')
const field = (w, label) => w.find(`[aria-label="${label}"]`)
/** The Columns list as it reads on screen, in list order. The `<span>` carries
 *  the input name, which is the column's identity whatever it is renamed to. */
const listed = (w) => entries(w).map((row) => row.find('span').text())
const press = (w, text) => w.findAll('button').find((b) => b.text() === text)

// -------------------------------------------------------------------- Filter

describe('the Filter form', () => {
  it('offers the combination rule explicitly, in German', async () => {
    // The rule is explicit in the config and explicit in the UI: a default
    // nobody chose is a rule nobody can see.
    const w = await render()
    const options = field(w, 'Verknüpfung').findAll('option').map((o) => o.text())

    expect(options).toEqual([
      'Alle Bedingungen müssen zutreffen',
      'Mindestens eine Bedingung muss zutreffen',
    ])
  })

  it('says out loud that no condition means every row stays', async () => {
    const w = await render()
    expect(conditions(w)).toHaveLength(0)
    expect(w.text()).toContain('Keine Bedingung — alle Zeilen bleiben stehen.')
  })

  it('adds a condition over the first column, and does not send it until it has a value', async () => {
    // A condition awaiting its value is not a condition with a bad value. It
    // shows on screen, says so, and reaches the model the moment a value is
    // entered — the same treatment an unreadable number entry already gets.
    const w = await render()
    await w.findAll('button').find((b) => b.text() === 'Bedingung hinzufügen').trigger('click')

    expect(conditions(w)).toHaveLength(1)
    expect(configured(w)).toEqual({ combine: 'all', conditions: [] })
    expect(w.find('[data-testid="filter-value-pending"]').text()).toContain('Noch ohne Wert')

    await field(w, 'Wert der Bedingung 1').setValue('Anna')
    expect(configured(w)).toEqual({
      combine: 'all',
      conditions: [{ column: 'Kunde', op: 'eq', value: 'Anna' }],
    })
    expect(w.find('[data-testid="filter-value-pending"]').exists()).toBe(false)
  })

  it('never sends an empty temporal value, which is what broke every date column', async () => {
    // `emptyValue` has no neutral instant to offer a `date`, `datetime`, `time`
    // or `duration` column the way `0` serves a number — so the condition used
    // to reach the engine as `''`, come back `step.value_unreadable`, and leave
    // the Step with no table on the *first* click. Number and boolean columns
    // did not break, so it looked like a temporal bug rather than a state bug.
    const w = await render()
    await w.findAll('button').find((b) => b.text() === 'Bedingung hinzufügen').trigger('click')
    await field(w, 'Spalte der Bedingung 1').setValue('Datum')

    expect(configured(w).conditions).toEqual([])
    expect(w.find('[data-testid="filter-value-pending"]').exists()).toBe(true)

    await field(w, 'Wert der Bedingung 1').setValue('2025-12-31')
    expect(configured(w).conditions).toEqual([
      { column: 'Datum', op: 'eq', value: '2025-12-31' },
    ])
  })

  it('keeps a valueless operator sendable, because it needs no value at all', async () => {
    const w = await render()
    await w.findAll('button').find((b) => b.text() === 'Bedingung hinzufügen').trigger('click')
    await field(w, 'Vergleich der Bedingung 1').setValue('empty')

    expect(configured(w)).toEqual({
      combine: 'all',
      conditions: [{ column: 'Kunde', op: 'empty' }],
    })
  })

  it('stores a German number as a machine number (CAP-15)', async () => {
    const w = await render({
      step: step({ config: { combine: 'all', conditions: [{ column: 'Betrag', op: 'gt', value: 0 }] } }),
    })

    // What the user reads back is German…
    expect(field(w, 'Wert der Bedingung 1').element.value).toBe('0')
    await field(w, 'Wert der Bedingung 1').setValue('1.234,56')

    // …and what is stored is not.
    expect(configured(w).conditions[0].value).toBe(1234.56)
  })

  it('refuses an entry that is no number, beside the field and not in the config', async () => {
    const w = await render({
      step: step({ config: { combine: 'all', conditions: [{ column: 'Betrag', op: 'gt', value: 0 }] } }),
    })

    await field(w, 'Wert der Bedingung 1').setValue('viel')

    expect(w.emitted('configure')).toBeUndefined()
    const refusal = w.find('[data-testid="filter-value-refusal"]')
    expect(refusal.attributes('role')).toBe('status')
    expect(refusal.text()).toContain('1.234,56')
  })

  it('gives a date column a date picker, so what is typed is already canonical', async () => {
    // `<input type="date">` is locale-aware in the browser and hands back ISO
    // 8601 — the canonical form the config stores — which is why it is used
    // rather than a text field with a placeholder somebody could ignore.
    const w = await render({
      step: step({
        config: { combine: 'all', conditions: [{ column: 'Datum', op: 'gte', value: '2025-12-31' }] },
      }),
    })

    expect(field(w, 'Wert der Bedingung 1').attributes('type')).toBe('date')
    expect(field(w, 'Wert der Bedingung 1').element.value).toBe('2025-12-31')
  })

  it('renders no value control at all for a valueless operator', async () => {
    const w = await render({
      step: step({ config: { combine: 'all', conditions: [{ column: 'Kunde', op: 'empty' }] } }),
    })

    expect(field(w, 'Wert der Bedingung 1').exists()).toBe(false)
    // …and the operator says what it matches, because three cell contents match
    // this one and a label reading only „ist leer" hides two of them.
    expect(w.text()).toContain('ist leer (auch nur Leerzeichen)')
  })

  it('drops the value when the operator stops taking one, and waits for a new one after', async () => {
    const w = await render({
      step: step({ config: { combine: 'all', conditions: [{ column: 'Kunde', op: 'eq', value: 'Anna' }] } }),
    })

    await field(w, 'Vergleich der Bedingung 1').setValue('not_empty')
    expect(configured(w).conditions[0]).toEqual({ column: 'Kunde', op: 'not_empty' })

    // Back to an operator that takes a value: the old one does not return —
    // carrying `Anna` under a comparison the user has just re-chosen would be
    // the panel deciding what they meant — so the condition waits again.
    await field(w, 'Vergleich der Bedingung 1').setValue('eq')
    expect(configured(w).conditions).toEqual([])
    expect(w.find('[data-testid="filter-value-pending"]').exists()).toBe(true)
  })

  it('moves a value refusal down with the condition above it when that one is removed', async () => {
    // `numberRefusals` is keyed by position and positions shift. Without the
    // re-keying the „das ist keine Zahl" message stayed on the index it was
    // raised at and appeared under a different condition than the one that
    // earned it.
    const w = await render({
      step: step({
        config: {
          combine: 'all',
          conditions: [
            { column: 'Kunde', op: 'eq', value: 'Anna' },
            { column: 'Betrag', op: 'gt', value: 0 },
          ],
        },
      }),
    })

    await field(w, 'Wert der Bedingung 2').setValue('viel')
    expect(conditions(w)[1].find('[data-testid="filter-value-refusal"]').exists()).toBe(true)

    await field(w, 'Bedingung entfernen: 1').trigger('click')
    await nextTick()

    expect(conditions(w)).toHaveLength(1)
    expect(conditions(w)[0].find('[data-testid="filter-value-refusal"]').exists()).toBe(true)
  })

  it('resets the value when the column changes, so no disagreement is inherited', async () => {
    const w = await render({
      step: step({ config: { combine: 'all', conditions: [{ column: 'Kunde', op: 'eq', value: 'Anna' }] } }),
    })

    await field(w, 'Spalte der Bedingung 1').setValue('Betrag')
    expect(configured(w).conditions[0]).toEqual({ column: 'Betrag', op: 'eq', value: 0 })
  })

  it('removes a condition through the same one command', async () => {
    const w = await render({
      step: step({ config: { combine: 'all', conditions: [{ column: 'Kunde', op: 'eq', value: 'Anna' }] } }),
    })

    await field(w, 'Bedingung entfernen: 1').trigger('click')
    expect(configured(w)).toEqual({ combine: 'all', conditions: [] })
  })
})

// ------------------------------------------------------------------- Columns

describe('the Columns form', () => {
  const columnsStep = (config = null) => step({ kind: 'columns', name: 'Nur Kunde', config })

  /** The width a report actually has, which is what story 6c is about: keeping
   *  three of thirty columns cost twenty-seven clicks. */
  const WIDE = Array.from({ length: 30 }, (_, i) => ({
    name: `S${String(i + 1).padStart(2, '0')}`,
    type: 'text',
  }))
  const THREE = [
    { from: 'S01', to: 'S01' },
    { from: 'S07', to: 'S07' },
    { from: 'S30', to: 'S30' },
  ]

  it('opens with every input column checked, in input order', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten: Nur Kunde' })

    expect(entries(w)).toHaveLength(3)
    for (const name of ['Kunde', 'Betrag', 'Datum']) {
      expect(field(w, `Spalte übernehmen: ${name}`).element.checked).toBe(true)
    }
  })

  it('writes the explicit list as soon as a column is unchecked', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Spalte übernehmen: Betrag').setValue(false)

    expect(configured(w)).toEqual({
      columns: [
        { from: 'Kunde', to: 'Kunde' },
        { from: 'Datum', to: 'Datum' },
      ],
    })
  })

  it('lets the last one be unchecked, and sends nothing while none is selected', async () => {
    // The inverse of what this case asserted until story 6c. An empty selection
    // is not a config meaning "no columns" — `[]` is the identity in
    // `core/steps/columns.js` — it is an unfinished edit, so it is simply not
    // committed and the stored config stays in force. That is what lets „Alle
    // abwählen“ exist without inventing a zero-column table.
    const w = await render({
      step: columnsStep({ columns: [{ from: 'Kunde', to: 'Kunde' }] }),
      label: 'Spalten',
    })

    expect(field(w, 'Spalte übernehmen: Kunde').attributes('disabled')).toBeUndefined()

    await field(w, 'Spalte übernehmen: Kunde').setValue(false)

    expect(w.emitted('configure')).toBeUndefined()
    const pending = w.find('[data-testid="columns-selection-pending"]')
    expect(pending.text()).toContain('die vorherige Einstellung bleibt in Kraft')
    // A refusal is a command the model rejected; this never reached the model at
    // all, so it is a hint like the Filter's pending line and not `role="status"`.
    expect(pending.attributes('role')).toBeUndefined()
  })

  it('clears thirty checkboxes in one click and sends nothing at all', async () => {
    const w = await render({
      step: columnsStep({ columns: THREE }),
      inputSchema: WIDE,
      label: 'Spalten',
    })

    await press(w, 'Alle abwählen').trigger('click')

    expect(entries(w)).toHaveLength(30)
    for (const column of WIDE) {
      expect(field(w, `Spalte übernehmen: ${column.name}`).element.checked).toBe(false)
    }
    // The Step goes on computing with the stored three, because nothing left.
    expect(w.emitted('configure')).toBeUndefined()
    expect(w.find('[data-testid="columns-selection-pending"]').exists()).toBe(true)
  })

  it('sends exactly the first column checked after a bulk deselect — 1 + k, not n − k', async () => {
    const w = await render({
      step: columnsStep({ columns: THREE }),
      inputSchema: WIDE,
      label: 'Spalten',
    })

    await press(w, 'Alle abwählen').trigger('click')
    await field(w, 'Spalte übernehmen: S07').setValue(true)

    expect(configured(w)).toEqual({ columns: [{ from: 'S07', to: 'S07' }] })
    expect(w.find('[data-testid="columns-selection-pending"]').exists()).toBe(false)
  })

  it('selects every entry in one click, in the list order the list already had', async () => {
    // The list order *is* the config order (CAP-16), so a bulk verb may not
    // reorder as a side effect — here the stored order differs from the input's.
    const w = await render({
      step: columnsStep({ columns: [{ from: 'Datum', to: 'Datum' }, { from: 'Kunde', to: 'Kunde' }] }),
      label: 'Spalten',
    })
    expect(listed(w)).toEqual(['Datum', 'Kunde', 'Betrag'])

    await press(w, 'Alle auswählen').trigger('click')

    expect(configured(w).columns.map((c) => c.from)).toEqual(['Datum', 'Kunde', 'Betrag'])
    expect(listed(w)).toEqual(['Datum', 'Kunde', 'Betrag'])
  })

  it('sends nothing for a bulk verb that moves no checkbox', async () => {
    // A freshly added Step already has everything checked, so „Alle auswählen“
    // is a no-op — and a `configure` for it would cost a `configureStep` and a
    // full recompute of the graph for a click that changed nothing.
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await press(w, 'Alle auswählen').trigger('click')

    expect(w.emitted('configure')).toBeUndefined()
    expect(listed(w)).toEqual(['Kunde', 'Betrag', 'Datum'])
  })

  it('acts on the visible entries only under a search, and its label names them', async () => {
    const w = await render({ step: columnsStep(), inputSchema: WIDE, label: 'Spalten' })

    await field(w, 'Spalte suchen').setValue('s0')

    // S01…S09 — nine of thirty, and the term is matched case-insensitively.
    expect(entries(w)).toHaveLength(9)
    // Both verbs are renamed for the visible set, not just the one under test.
    expect(press(w, 'Alle abwählen')).toBeUndefined()
    expect(press(w, 'Alle auswählen')).toBeUndefined()
    expect(press(w, 'Angezeigte auswählen')).toBeDefined()
    await press(w, 'Angezeigte abwählen').trigger('click')

    // The nine are cleared; the other twenty-one keep their state and their order.
    for (const column of WIDE.slice(0, 9)) {
      expect(field(w, `Spalte übernehmen: ${column.name}`).element.checked).toBe(false)
    }
    expect(configured(w).columns.map((c) => c.from)).toEqual(WIDE.slice(9).map((c) => c.name))
  })

  it('keeps an unselected column between its input neighbours, not at the end', async () => {
    // Its position is recorded nowhere — the stored config lists the chosen
    // columns and nothing else — so the input schema is the only other source of
    // order. Appending it moved a merely unchecked column to the bottom at the
    // next rebuild.
    const w = await render({
      step: columnsStep({ columns: [{ from: 'Kunde', to: 'Kunde' }, { from: 'Datum', to: 'Datum' }] }),
      label: 'Spalten',
    })

    expect(listed(w)).toEqual(['Kunde', 'Betrag', 'Datum'])
    expect(field(w, 'Spalte übernehmen: Betrag').element.checked).toBe(false)
  })

  it('places a dropped column after the neighbour it follows in the input, even when reordered', async () => {
    // Input [A,B,C,D] with config [C,A] reads [C,D,A,B]: each unselected column
    // sits directly behind the nearest input column already placed.
    const w = await render({
      step: columnsStep({ columns: [{ from: 'C', to: 'C' }, { from: 'A', to: 'A' }] }),
      inputSchema: ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'text' })),
      label: 'Spalten',
    })

    expect(listed(w)).toEqual(['C', 'D', 'A', 'B'])
  })

  it('filters visibility only: the order returns unchanged and nothing was sent', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })
    const before = listed(w)

    await field(w, 'Spalte suchen').setValue('at')
    expect(listed(w)).toEqual(['Datum'])

    await field(w, 'Spalte suchen').setValue('')
    expect(listed(w)).toEqual(before)
    expect(w.emitted('configure')).toBeUndefined()
  })

  it('searches the input name, not the new one — the column is what is being found', async () => {
    // Matching the rename field too would make a row vanish the moment it was
    // renamed to something the term no longer contains.
    const w = await render({ step: columnsStep(), label: 'Spalten' })
    await field(w, 'Neuer Name: Betrag').setValue('Summe')

    await field(w, 'Spalte suchen').setValue('Betrag')
    expect(listed(w)).toEqual(['Betrag'])
    expect(field(w, 'Neuer Name: Betrag').element.value).toBe('Summe')

    await field(w, 'Spalte suchen').setValue('Summe')
    expect(entries(w)).toHaveLength(0)
    expect(w.find('[data-testid="columns-no-match"]').exists()).toBe(true)
  })

  it('ignores space around the term, which is what a paste leaves behind', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Spalte suchen').setValue('  Betrag  ')

    expect(listed(w)).toEqual(['Betrag'])
    expect(w.find('[data-testid="columns-no-match"]').exists()).toBe(false)
  })

  it('disables the order buttons while a term filters the list, and states the reason', async () => {
    // `moveColumn` swaps neighbours of the *full* list, so under a filter the
    // swap would be correct in the config and invisible on screen.
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Spalte suchen').setValue('Betrag')

    expect(field(w, 'Nach oben: Betrag').attributes('disabled')).toBeDefined()
    expect(field(w, 'Nach unten: Betrag').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="columns-order-locked"]').text()).toContain(
      'lässt sich die Reihenfolge nicht ändern',
    )
  })

  it('says no column matches rather than showing an empty list', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Spalte suchen').setValue('Zahlungsziel')

    expect(entries(w)).toHaveLength(0)
    expect(w.find('[data-testid="columns-no-match"]').text()).toContain('Zahlungsziel')
    // The bulk verbs stay pressable and act on nothing rather than on the hidden
    // twenty-seven — and acting on nothing sends nothing.
    await press(w, 'Angezeigte abwählen').trigger('click')
    expect(listed(w)).toEqual([])
    expect(w.emitted('configure')).toBeUndefined()
  })

  it('clears the term when another Step is selected under it', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })
    await field(w, 'Spalte suchen').setValue('Betrag')
    expect(entries(w)).toHaveLength(1)

    await w.setProps({ step: step({ id: 's2', kind: 'columns', name: 'Andere', config: null }) })
    await nextTick()

    expect(field(w, 'Spalte suchen').element.value).toBe('')
    expect(entries(w)).toHaveLength(3)
  })

  it('clears the term when the input schema changes under it', async () => {
    // The watcher's other trigger, and the one a user reaches without leaving
    // the panel: a Step upstream stops passing a column on.
    const w = await render({ step: columnsStep(), label: 'Spalten' })
    await field(w, 'Spalte suchen').setValue('Betrag')
    expect(entries(w)).toHaveLength(1)

    await w.setProps({ inputSchema: SCHEMA.filter((column) => column.name !== 'Datum') })
    await nextTick()

    expect(field(w, 'Spalte suchen').element.value).toBe('')
    expect(listed(w)).toEqual(['Kunde', 'Betrag'])
  })

  it('names every new control, so the form is traversable by keyboard alone (C-7, NFR-6)', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    // The search field is named by its `aria-label`, as the Filter's selects are;
    // the two buttons are named by their own text, as „Bedingung hinzufügen“ is.
    expect(field(w, 'Spalte suchen').exists()).toBe(true)
    expect(field(w, 'Spalte suchen').attributes('disabled')).toBeUndefined()
    for (const text of ['Alle auswählen', 'Alle abwählen']) {
      expect(press(w, text), text).toBeDefined()
      expect(press(w, text).attributes('disabled'), text).toBeUndefined()
    }
  })

  it('offers no bulk verb and no search where the input has no columns', async () => {
    const w = await render({ step: columnsStep(), inputSchema: [], label: 'Spalten' })

    expect(w.find('[data-testid="step-panel-no-columns"]').text()).toContain('keine Spalten')
    expect(w.find('[data-testid="step-config-columns"]').exists()).toBe(false)
    expect(field(w, 'Spalte suchen').exists()).toBe(false)
    expect(press(w, 'Alle abwählen')).toBeUndefined()
  })

  it('makes the list order the output order (CAP-16)', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Nach oben: Datum').trigger('click')

    expect(configured(w).columns.map((c) => c.from)).toEqual(['Kunde', 'Datum', 'Betrag'])
    expect(w.text()).toContain('Reihenfolge hier ist die Reihenfolge im Ergebnis.')
  })

  it('cannot move past either end', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    expect(field(w, 'Nach oben: Kunde').attributes('disabled')).toBeDefined()
    expect(field(w, 'Nach unten: Datum').attributes('disabled')).toBeDefined()
  })

  it('renames through the same command, and disables the field for a dropped column', async () => {
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Neuer Name: Kunde').setValue('Name')
    expect(configured(w).columns[0]).toEqual({ from: 'Kunde', to: 'Name' })

    await field(w, 'Spalte übernehmen: Betrag').setValue(false)
    expect(field(w, 'Neuer Name: Betrag').attributes('disabled')).toBeDefined()
  })

  it('keeps a refused rename on screen, so it can be corrected', async () => {
    // The model refuses a collision and the previous config stays in force
    // (CAP-16). A draft snapped back to the accepted config would delete the very
    // word the refusal is about.
    const w = await render({ step: columnsStep(), label: 'Spalten' })

    await field(w, 'Neuer Name: Betrag').setValue('Kunde')
    expect(configured(w).columns[1].to).toBe('Kunde')

    // The command refused, so the stored config never changed.
    await w.setProps({ step: columnsStep() })
    await nextTick()
    expect(field(w, 'Neuer Name: Betrag').element.value).toBe('Kunde')
  })
})

// ---------------------------------------------------------------- Sortieren

describe('the Sort form', () => {
  const sortStep = (config = null) => step({ kind: 'sort', name: 'Neueste zuerst', config })
  const keys = (w) => w.findAll('[data-testid="sort-key"]')

  it('opens with no key at all, and says the rows keep their input order', async () => {
    const w = await render({ step: sortStep(), label: 'Sortieren: Neueste zuerst' })

    expect(keys(w)).toHaveLength(0)
    expect(w.find('[data-testid="sort-none"]').text()).toContain(
      'die Zeilen bleiben in der Reihenfolge des Eingangs',
    )
    expect(w.emitted('configure')).toBeUndefined()
  })

  it('adds a key over the first column, ascending, and sends it at once', async () => {
    // Unlike a Filter condition there is nothing left to wait for: a key is a
    // column and a direction, and both are chosen the moment it exists.
    const w = await render({ step: sortStep(), label: 'Sortieren' })
    await press(w, 'Sortierung hinzufügen').trigger('click')

    expect(keys(w)).toHaveLength(1)
    expect(configured(w)).toEqual({ keys: [{ column: 'Kunde', direction: 'asc' }] })
  })

  it('offers the two directions in German, never a raw `asc`', async () => {
    const w = await render({
      step: sortStep({ keys: [{ column: 'Betrag', direction: 'desc' }] }),
      label: 'Sortieren',
    })

    const options = field(w, 'Richtung der Sortierung 1').findAll('option')
    expect(options.map((o) => o.text())).toEqual([
      'Aufsteigend (A–Z, klein → groß, alt → neu)',
      'Absteigend (Z–A, groß → klein, neu → alt)',
    ])
    expect(field(w, 'Richtung der Sortierung 1').element.value).toBe('desc')
  })

  it('changes a key’s column and its direction through the same one command', async () => {
    const w = await render({
      step: sortStep({ keys: [{ column: 'Kunde', direction: 'asc' }] }),
      label: 'Sortieren',
    })

    await field(w, 'Richtung der Sortierung 1').setValue('desc')
    expect(configured(w)).toEqual({ keys: [{ column: 'Kunde', direction: 'desc' }] })

    await field(w, 'Spalte der Sortierung 1').setValue('Datum')
    expect(configured(w)).toEqual({ keys: [{ column: 'Datum', direction: 'desc' }] })
  })

  it('never offers a column another key already sorts by', async () => {
    // A second key on one column is refused by the model, so the form does not
    // offer the gesture: a control whose only outcome is a refusal should not be
    // there. Each select still offers its *own* column, which is otherwise
    // "used" and would vanish from the control showing it.
    const w = await render({
      step: sortStep({ keys: [{ column: 'Kunde', direction: 'asc' }] }),
      label: 'Sortieren',
    })
    await press(w, 'Sortierung hinzufügen').trigger('click')

    const offered = (n) =>
      field(w, `Spalte der Sortierung ${n}`).findAll('option').map((o) => o.text())

    // Key 2 took Betrag, the first column key 1 had left. So key 1 offers
    // everything but Betrag, key 2 everything but Kunde, and each keeps its own.
    expect(offered(1)).toEqual(['Kunde', 'Datum'])
    expect(offered(2)).toEqual(['Betrag', 'Datum'])
  })

  it('shows the column the config holds, even after that column stopped arriving', async () => {
    // A `<select>` whose value matches no option falls back to showing the first
    // one — so a key naming a column an upstream rename took away put a
    // *different* column on screen than the model held, and editing the
    // direction beside it committed the invisible one. The Step already refuses
    // by name at execution; this is the control the user has to fix it in.
    const w = await render({
      step: sortStep({ keys: [{ column: 'Umsatz', direction: 'desc' }] }),
      label: 'Sortieren',
    })

    const select = field(w, 'Spalte der Sortierung 1')
    expect(select.element.value).toBe('Umsatz')
    expect(select.findAll('option').map((o) => o.text())).toContain('Umsatz')

    // …and changing the direction sends the column that is on screen.
    await field(w, 'Richtung der Sortierung 1').setValue('asc')
    expect(configured(w)).toEqual({ keys: [{ column: 'Umsatz', direction: 'asc' }] })
  })

  it('disables the add button and states the reason once every column is a key', async () => {
    const w = await render({
      step: sortStep({
        keys: [
          { column: 'Kunde', direction: 'asc' },
          { column: 'Betrag', direction: 'asc' },
          { column: 'Datum', direction: 'asc' },
        ],
      }),
      label: 'Sortieren',
    })

    expect(press(w, 'Sortierung hinzufügen').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="sort-columns-exhausted"]').text()).toContain(
      'bereits Sortierschlüssel',
    )
  })

  it('removes a key through the same command, and an empty list is a real setting', async () => {
    // `{ keys: [] }` is the identity in `core/steps/sort.js` — every row through
    // in input order — which is exactly what "no sorting" means. So unlike the
    // Columns Step's empty selection it is sent rather than withheld.
    const w = await render({
      step: sortStep({ keys: [{ column: 'Kunde', direction: 'asc' }] }),
      label: 'Sortieren',
    })

    await field(w, 'Sortierung entfernen: 1').trigger('click')
    expect(configured(w)).toEqual({ keys: [] })
  })

  it('names where an empty and an unreadable value land, in the form itself', async () => {
    // An empty cell is data the user can see, so a diagnostic about it would be
    // a warning about nothing — the rule belongs beside the control instead.
    const w = await render({ step: sortStep(), label: 'Sortieren' })

    const note = w.find('[data-testid="sort-placement-note"]').text()
    expect(note).toContain('in beiden Richtungen hinter den lesbaren Werten')
    expect(note).toContain('deutscher Sortierung')
  })

  it('names every new control, so the form is traversable by keyboard alone (C-7, NFR-6)', async () => {
    const w = await render({
      step: sortStep({ keys: [{ column: 'Kunde', direction: 'asc' }] }),
      label: 'Sortieren',
    })

    for (const label of [
      'Spalte der Sortierung 1',
      'Richtung der Sortierung 1',
      'Sortierung entfernen: 1',
    ]) {
      expect(field(w, label).exists(), label).toBe(true)
    }
    expect(press(w, 'Sortierung hinzufügen').attributes('disabled')).toBeUndefined()
  })
})

// ------------------------------------------------------------------ Erste N

describe('the First-N form', () => {
  const firstStep = (config = null) => step({ kind: 'first', name: 'Top 10', config })

  it('opens without a count, and says every row stays', async () => {
    const w = await render({ step: firstStep(), label: 'Erste N: Top 10' })

    expect(field(w, 'Anzahl Zeilen').element.value).toBe('')
    expect(w.find('[data-testid="first-count-pending"]').text()).toContain(
      'Noch keine Anzahl — alle Zeilen bleiben stehen.',
    )
    expect(w.emitted('configure')).toBeUndefined()
  })

  it('sends a count the moment one whole number is entered', async () => {
    const w = await render({ step: firstStep(), label: 'Erste N' })

    await field(w, 'Anzahl Zeilen').setValue('10')

    expect(configured(w)).toEqual({ count: 10 })
    expect(w.find('[data-testid="first-count-pending"]').exists()).toBe(false)
  })

  it('refuses an entry that is no count, beside the field and not in the config', async () => {
    // `type="number"` keeps letters out; `0`, `-1` and `2.5` it does not. The
    // precedent is the Filter's number field one screen up: an entry that has
    // not finished is not a change to the config.
    for (const entry of ['0', '-1', '2,5', '2.5']) {
      const w = await render({ step: firstStep({ count: 5 }), label: 'Erste N' })
      await field(w, 'Anzahl Zeilen').setValue(entry)

      expect(w.emitted('configure'), `sent ${entry} to the model`).toBeUndefined()
      const refusal = w.find('[data-testid="first-count-refusal"]')
      expect(refusal.attributes('role')).toBe('status')
      expect(refusal.text()).toContain('ganze Zahl ab 1')
    }
  })

  it('emits nothing when the field is cleared, and says the stored count stays in force', async () => {
    const w = await render({ step: firstStep({ count: 5 }), label: 'Erste N' })

    await field(w, 'Anzahl Zeilen').setValue('')

    expect(w.emitted('configure')).toBeUndefined()
    // The sentence differs from a freshly added Step's on purpose: there the
    // Step really does let every row through, here a stored count goes on
    // computing, and one sentence covering both would be true of neither.
    expect(w.find('[data-testid="first-count-pending"]').text()).toContain(
      'die vorherige bleibt in Kraft',
    )
  })

  it('offers its form even where the input has no columns — it names none', async () => {
    // The one kind whose form is not about a column, so the guard that withholds
    // the Filter's and the Columns' controls does not apply to it.
    const w = await render({ step: firstStep(), inputSchema: [], label: 'Erste N' })

    expect(w.find('[data-testid="step-config-first"]').exists()).toBe(true)
    expect(w.find('[data-testid="step-panel-no-columns"]').exists()).toBe(false)
    expect(field(w, 'Anzahl Zeilen').exists()).toBe(true)
  })

  it('names its one control, so the form is traversable by keyboard alone (C-7, NFR-6)', async () => {
    const w = await render({ step: firstStep(), label: 'Erste N' })

    expect(field(w, 'Anzahl Zeilen').attributes('type')).toBe('number')
    expect(field(w, 'Anzahl Zeilen').attributes('min')).toBe('1')
    expect(field(w, 'Anzahl Zeilen').attributes('disabled')).toBeUndefined()
  })
})

// ------------------------------------------------------------- what it shows

describe('what the Step produced', () => {
  it('shows the row and column count of the full output (CAP-19)', async () => {
    const w = await render({ result: result({ rowCount: 58_000, columnCount: 1 }) })

    expect(w.find('[data-testid="step-counts"]').text()).toBe('58.000 Zeilen, 1 Spalte')
  })

  it('says the Step produced nothing rather than showing a zero', async () => {
    const w = await render({ result: result({ table: null, rowCount: null, columnCount: null }) })

    expect(w.find('[data-testid="step-counts"]').text()).toContain('Kein Ergebnis')
    expect(w.find('[data-testid="step-preview"]').exists()).toBe(false)
  })

  it('says the Step was not reached at all where there is no result', async () => {
    const w = await render({ result: null })
    expect(w.find('[data-testid="step-counts"]').text()).toContain('Nicht gerechnet')
  })

  it('renders its own warnings beside its counts, in German', async () => {
    const w = await render({
      result: result({
        diagnostics: [
          info('step.rows_removed', { removed: 2, kept: 2 }, { stepId: 's1' }),
          warning('step.boxed_rows_dropped', { rows: 3 }, { stepId: 's1' }),
        ],
      }),
    })

    const marks = w.findAll('[data-testid="step-panel-mark"]').map((m) => m.text())
    expect(marks[0]).toContain('2 Zeilen entfernt, 2 Zeilen übrig.')
    expect(marks[1]).toContain('Warnung:')
    expect(marks[1]).toContain('3 Zeilen wurden nicht verglichen')
  })

  it('says a boxed row was placed, not dropped, where a Sort put it last', async () => {
    // A different sentence from the Filter's on purpose: a box in a sort key is
    // placed rather than excluded, so no row leaves the Step — and the verb has
    // to follow the number, because one unreadable value is the ordinary case.
    const one = await render({
      step: step({ kind: 'sort' }),
      result: result({ diagnostics: [warning('step.boxed_rows_last', { rows: 1 }, { stepId: 's1' })] }),
    })
    const many = await render({
      step: step({ kind: 'sort' }),
      result: result({ diagnostics: [warning('step.boxed_rows_last', { rows: 4 }, { stepId: 's1' })] }),
    })

    expect(one.find('[data-testid="step-panel-mark"]').text()).toContain(
      '1 Zeile hat in einer Sortierspalte',
    )
    expect(one.find('[data-testid="step-panel-mark"]').text()).toContain(
      'hinter die lesbaren Werte gestellt',
    )
    expect(many.find('[data-testid="step-panel-mark"]').text()).toContain(
      '4 Zeilen haben in einer Sortierspalte',
    )
    // Placed, never dropped: the Filter's wording must not have leaked in.
    expect(one.text()).not.toContain('ausgeschlossen')
  })

  it('renders every mark when one code appears twice', async () => {
    // A code is not unique per Step: a Filter with two disagreeing conditions
    // emits two `step.type_mismatch`, and a Columns Step naming two vanished
    // columns emits two `step.unknown_column`. Keyed by code alone, Vue drops or
    // reuses the second and the finding is silently not rendered.
    const w = await render({
      result: result({
        table: null,
        rowCount: null,
        columnCount: null,
        diagnostics: [
          error('step.unknown_column', { column: 'Betrag' }, { stepId: 's1' }),
          error('step.unknown_column', { column: 'Datum' }, { stepId: 's1' }),
        ],
      }),
    })

    const marks = w.findAll('[data-testid="step-panel-mark"]').map((m) => m.text())
    expect(marks).toHaveLength(2)
    expect(marks[0]).toContain('„Betrag“')
    expect(marks[1]).toContain('„Datum“')
  })

  it('says so when the Step ran clean, rather than showing nothing at all', async () => {
    const w = await render({ result: result() })
    expect(w.find('[data-testid="step-status"]').text()).toBe('Ohne Warnungen.')
  })

  it('renders every cell through the German projection', async () => {
    // A typed Table holds machine values, so bare interpolation would show a
    // date as a raw nanosecond `BigInt` and a number with an Anglo point.
    const w = await render({ result: result() })
    const first = w.findAll('[data-testid="step-preview-row"]')[0].findAll('td').map((c) => c.text())

    expect(first).toEqual(['Anna', '1.234,56', '31.12.2025'])
    // …and an absent value is an empty cell, not the word `null`.
    const second = w.findAll('[data-testid="step-preview-row"]')[1].findAll('td').map((c) => c.text())
    expect(second).toEqual(['Bernd', '80', ''])
  })

  it('carries its own test-id stem, so it cannot collide with the Sources preview', async () => {
    // `ui/SourcesPane.vue` is `v-show` and stays mounted while the Editor is on
    // screen; a second `data-testid="preview"` would match every page-scoped
    // assertion in the existing e2e suite.
    const w = await render({ result: result() })

    expect(w.find('[data-testid="step-preview"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview"]').exists()).toBe(false)
    expect(w.find('[data-testid="preview-row"]').exists()).toBe(false)
  })

  it('names the bound where the preview is shorter than the output', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ Kunde: `K${i}`, Betrag: i, Datum: null }))
    const w = await render({
      result: result({ table: handle(SCHEMA, rows), rowCount: 60, columnCount: 3 }),
    })

    expect(w.findAll('[data-testid="step-preview-row"]')).toHaveLength(50)
    expect(w.find('[data-testid="step-preview-bound"]').text()).toContain(
      'die ersten 50 von 60 Zeilen',
    )
    // …and the counts above it are still the whole output's.
    expect(w.find('[data-testid="step-counts"]').text()).toBe('60 Zeilen, 3 Spalten')
  })
})

describe('what it does not offer', () => {
  it('names a kind no executor implements rather than rendering an empty form', async () => {
    const w = await render({ step: step({ kind: 'union', name: 'Halbjahr' }), label: 'Union' })

    expect(w.find('[data-testid="step-panel-unconfigurable"]').text()).toContain(
      'noch nicht ausführen',
    )
    expect(w.find('[data-testid="step-config-filter"]').exists()).toBe(false)
  })

  it('says why rather than offering a control that does nothing, for an input with no columns', async () => {
    // `[]` is not `null`: there *is* an input, it simply has nothing to
    // configure against. "Bedingung hinzufügen" was enabled and silently did
    // nothing, which is the one state a form must never be in.
    const w = await render({ inputSchema: [] })

    expect(w.find('[data-testid="step-panel-no-columns"]').text()).toContain('keine Spalten')
    expect(w.find('[data-testid="step-config-filter"]').exists()).toBe(false)
    expect(w.findAll('button').some((b) => b.text() === 'Bedingung hinzufügen')).toBe(false)
  })

  it('offers no column list where there is no input to read one off', async () => {
    // Offering a stale list would invite a config the next run refuses by name.
    const w = await render({ inputSchema: null })

    expect(w.find('[data-testid="step-panel-no-input"]').exists()).toBe(true)
    expect(w.find('[data-testid="step-config-filter"]').exists()).toBe(false)
  })

  it('rebuilds its form when the input columns change under it', async () => {
    const w = await render({ step: step({ kind: 'columns', config: null }), label: 'Spalten' })
    expect(entries(w)).toHaveLength(3)

    await w.setProps({ inputSchema: [{ name: 'Kunde', type: 'text' }] })
    await nextTick()

    expect(entries(w)).toHaveLength(1)
  })
})
