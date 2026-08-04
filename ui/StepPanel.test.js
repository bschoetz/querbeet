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

  it('refuses to uncheck the last one, because empty means every column', async () => {
    // An empty selection is the identity in `core/steps/columns.js`, so
    // unchecking the last column would show *more* columns rather than none —
    // the opposite of what the click means.
    const w = await render({
      step: columnsStep({ columns: [{ from: 'Kunde', to: 'Kunde' }] }),
      label: 'Spalten',
    })

    expect(field(w, 'Spalte übernehmen: Kunde').attributes('disabled')).toBeDefined()
    expect(field(w, 'Spalte übernehmen: Betrag').attributes('disabled')).toBeUndefined()
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
