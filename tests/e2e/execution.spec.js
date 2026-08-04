// Story 6b against the built artefact from `file://` (AD-27), both engines.
//
// The promise under test is the one the product had never yet kept: a pipeline
// that *computes*. Story 5 could draw, connect and name a graph and CAP-15,
// CAP-16 and CAP-19 were all unrealized — nothing filtered, nothing selected,
// nothing previewed. So this suite drives the whole way through the real
// interface: a file, the confirmation gate, a Step on the canvas, a condition in
// the side panel, and the counts that come back.
//
// THE TRAPS THE OTHER SUITES ALREADY NAME, and they apply here too. A German
// number contains a comma, so a fixture of German numbers uses semicolons as its
// delimiter — which is what real German exports do, for the same reason. And
// detection proposes a type at 90 % of the non-missing values and not below, so a
// column needs nine readable values behind its one unreadable one; written four
// rows long the same fixture is a `text` column with nothing unreadable in it and
// every assertion here would fail somewhere far from the cause.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const csv = (name, content) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })

const NAMES = ['Anna', 'Bernd', 'Carla', 'Dora', 'Emil', 'Frida', 'Gustav', 'Heike', 'Ingo']
const AMOUNTS = ['1.234,56', '80,00', '12,50', '7,25', '0,99', '3,00', '45,10', '9,90', '100,00']
const DATES = [
  '31.12.2025',
  '01.03.2026',
  '15.06.2025',
  '02.02.2025',
  '30.11.2025',
  '01.01.2026',
  '17.04.2025',
  '28.08.2025',
  '09.09.2025',
]

/** Nine clean rows and a tenth carrying one unreadable value in each typed
 *  column — `abc` where a number belongs, `demnächst` where a date does. Three
 *  amounts are above 50, which is what the Filter below asks for. */
const REPORT = csv(
  'umsatz.csv',
  ['Kunde;Betrag;Datum']
    .concat(NAMES.map((name, i) => `${name};${AMOUNTS[i]};${DATES[i]}`))
    .concat('Jutta;abc;demnächst')
    .join('\n') + '\n',
)

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const canvas = (page) => page.getByTestId('editor-canvas')
const card = (page, label) => page.getByRole('group', { name: label, exact: true })
const panel = (page) => page.getByTestId('step-panel')
const editorStatus = (page) => page.getByTestId('editor-status')
const refusal = (page) => page.getByTestId('editor-refusal')

const idOf = (page, label) => card(page, label).getAttribute('data-node')
const wrapper = (page, id) => canvas(page).locator(`.vue-flow__node[data-id="${id}"]`)

const toEditor = async (page) => {
  await page.getByRole('button', { name: 'Editor' }).click()
  await expect(canvas(page)).toBeVisible()
  await canvas(page).scrollIntoViewIfNeeded()
  await expect(canvas(page)).toHaveAttribute('data-fitted', 'true')
}

const toSources = (page) => page.getByRole('button', { name: 'Quellen' }).click()

const confirm = async (page, name) => {
  await page.getByLabel(`Typen bestätigen: ${name}`).click()
  await expect(page.getByTestId('typing').first()).toContainText('Typen bestätigt.')
}

/** Select a Step on the canvas, the way a user does. The side panel takes its
 *  subject from the canvas's own selection — the one thing that crosses the
 *  `GraphView` port outward as of this story. */
const select = async (page, label) => {
  const id = await idOf(page, label)
  // Focus first, then click. Focusing is what pulls an off-screen Step into the
  // pane — the canvas is transformed rather than scrolled, so the browser's own
  // focus-scrolling does nothing and story 5 built the pull for exactly this.
  // Without it a Step above the visible area is clicked where the toolbar is.
  await wrapper(page, id).evaluate((el) => el.focus())
  await wrapper(page, id).click({ position: { x: 4, y: 4 } })
  await expect(panel(page)).toBeVisible()
  return id
}

/** Fill a labelled control and let the `change` event fire — `fill` alone
 *  dispatches `input`, and every control in this product commits on `change`. */
const enter = async (locator, value) => {
  await locator.fill(value)
  await locator.blur()
}

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

// ------------------------------------------------------------- the skeleton

test('a confirmed Source flows through a Filter and a Columns Step, and every Step counts itself', async ({
  page,
}) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  // Nothing is computed while no Step is designated as the Result — there is no
  // Pipeline yet, and `graph.no_result` is what says so.
  await select(page, 'Quelle: umsatz')
  await expect(panel(page).getByTestId('step-counts')).toContainText('Nicht gerechnet')

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })

  // A Source is a Step too, and CAP-19 says *every* contributing Step shows its
  // own counts — so the Source's own panel is the first thing that must be true.
  await select(page, 'Quelle: umsatz')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')

  await select(page, 'Filter: Filter')
  // Unconfigured, so it is the identity: the chain stays readable while it is
  // being built rather than emptying until every control has been touched.
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')

  // One condition, entered the way a person enters it: three selects and a
  // German number.
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await panel(page).getByLabel('Spalte der Bedingung 1').selectOption('Betrag')
  await panel(page).getByLabel('Vergleich der Bedingung 1').selectOption('gt')
  await enter(panel(page).getByLabel('Wert der Bedingung 1'), '50')

  // 1.234,56 / 80,00 / 100,00 are above 50; six amounts are below and `abc` is
  // not a number at all.
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 3 Spalten')
  await expect(panel(page)).toContainText('7 Zeilen entfernt, 3 Zeilen übrig.')

  // The box never silently passes as text (AD-22): the row it excluded is
  // counted and said out loud, at this Step.
  await expect(panel(page).getByTestId('step-panel-mark').filter({ hasText: 'Warnung' })).toContainText(
    '1 Zeile wurde nicht verglichen',
  )

  // The cells render through the German projection — a date is a date, not a
  // raw nanosecond value, and a number carries a German decimal comma.
  await expect(panel(page).getByTestId('step-preview-row').first()).toContainText('31.12.2025')
  await expect(panel(page).getByTestId('step-preview-row').first()).toContainText('1.234,56')

  // …and a Columns Step downstream, with the order and the rename it is given.
  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'Filter' })
  await card(page, 'Spalten: Spalten')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await select(page, 'Spalten: Spalten')
  await panel(page).getByLabel('Spalte übernehmen: Kunde').uncheck()
  await enter(panel(page).getByLabel('Neuer Name: Datum'), 'Buchungstag')
  await panel(page).getByRole('button', { name: 'Nach oben: Datum' }).click()

  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 2 Spalten')
  // Config order is output order (CAP-16), and the rename travelled with it.
  await expect(panel(page).locator('th').first()).toHaveText('Buchungstag')
  await expect(panel(page).locator('th').nth(1)).toHaveText('Betrag')
})

test('a Step keeps its own preview while another Step is the Result', async ({ page }) => {
  // CAP-19's actual promise: not "the Result has a preview" but "every
  // contributing Step shows the row and column count of its full output".
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })
  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'Filter' })
  await card(page, 'Spalten: Spalten')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await select(page, 'Quelle: umsatz')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
  await select(page, 'Filter: Filter')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
})

// ------------------------------------------------------------- the refusals

test('a Step whose column vanished refuses by name, and the Step downstream names it', async ({
  page,
}) => {
  // **What this case does and does not cover, stated because its predecessor
  // did not.** The type disagreement of CAP-15 — a `date` column compared
  // against a number — is **not reachable through this interface**, and that is
  // a property rather than a gap: the value control follows the column's type,
  // so a date column renders `<input type="date">` and a number cannot be typed
  // into it, and changing a condition's column resets its value. It arrives with
  // story 14, which loads a Recipe somebody else wrote, and it is pinned at unit
  // level in `core/steps/steps.test.js`. The predecessor of this case claimed to
  // test it and actually reached an *empty* temporal value, which is now not
  // sent to the model at all.
  //
  // What *is* reachable is the other half of the same promise, and it is the
  // half a real editing session produces: a Filter configured against a column
  // that a Columns Step upstream stops passing on.
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })
  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'Spalten' })
  await card(page, 'Filter: Filter')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  // The Filter is configured while every column is still coming through.
  await select(page, 'Filter: Filter')
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await panel(page).getByLabel('Spalte der Bedingung 1').selectOption('Betrag')
  await panel(page).getByLabel('Vergleich der Bedingung 1').selectOption('gt')
  await enter(panel(page).getByLabel('Wert der Bedingung 1'), '50')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 3 Spalten')

  // Now the column it names stops arriving.
  await select(page, 'Spalten: Spalten')
  await panel(page).getByLabel('Spalte übernehmen: Betrag').uncheck()

  await select(page, 'Filter: Filter')
  await expect(panel(page).getByTestId('step-counts')).toContainText('Kein Ergebnis')
  await expect(panel(page)).toContainText('Es gibt keine Spalte „Betrag“ mehr im Eingang')
})

test('a Filter awaiting a value filters nothing, and says so instead of failing', async ({
  page,
}) => {
  // A freshly added condition on a temporal column has no value yet — there is
  // no neutral instant the way `0` is a neutral number — and it used to reach
  // the engine as an empty string, come back unreadable, and leave the Step with
  // no table on the first click. Every date column broke; number and boolean
  // columns did not, so it read as a temporal bug rather than a state bug.
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })

  await select(page, 'Filter: Filter')
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await panel(page).getByLabel('Spalte der Bedingung 1').selectOption('Datum')

  await expect(panel(page).getByTestId('filter-value-pending')).toContainText('Noch ohne Wert')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')

  // …and it takes effect the moment a value is there.
  await enter(panel(page).getByLabel('Wert der Bedingung 1'), '2026-01-01')
  await expect(panel(page).getByTestId('filter-value-pending')).toHaveCount(0)
  await expect(panel(page).getByTestId('step-counts')).toHaveText('1 Zeile, 3 Spalten')
})

test('a run that produced no result says so where a user with nothing selected can see it', async ({
  page,
}) => {
  // The cards deliberately carry the graph's marks and not the run's, so a Step
  // error lives in that Step's panel. With nothing selected there is no panel —
  // and without this sentence there would be no reason on screen at all.
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })
  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'Spalten' })
  await card(page, 'Filter: Filter')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await select(page, 'Filter: Filter')
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await panel(page).getByLabel('Spalte der Bedingung 1').selectOption('Betrag')
  await enter(panel(page).getByLabel('Wert der Bedingung 1'), '50')
  await select(page, 'Spalten: Spalten')
  await panel(page).getByLabel('Spalte übernehmen: Betrag').uncheck()

  // Deselect by clicking the canvas background, so nothing is selected at all.
  await canvas(page).click({ position: { x: 6, y: 6 } })
  await expect(page.getByTestId('step-panel-empty')).toBeVisible()

  await expect(editorStatus(page)).toContainText('Der Lauf hat kein Ergebnis')
  await expect(editorStatus(page)).toContainText('„Filter“')
})

test('an unconfirmed Source refuses the whole run, naming the Source (AD-29 gate 1)', async ({
  page,
}) => {
  await pick(page, REPORT)
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })

  await expect(editorStatus(page)).toContainText('„umsatz“ ist noch nicht bestätigt')
  // Nothing executed — not even the Source, whose conversion is Step zero.
  await select(page, 'Filter: Filter')
  await expect(panel(page).getByTestId('step-counts')).toContainText('Nicht gerechnet')

  // …and the gate opens the moment the confirmation lands, with nothing else
  // changed.
  await toSources(page)
  await confirm(page, 'umsatz')
  await toEditor(page)
  await select(page, 'Filter: Filter')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
})

test('a Union in the frontier refuses the run naming the Step and its kind', async ({ page }) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Union' }).click()
  const union = card(page, 'Union: Union')
  await union.getByLabel('Eingang 1', { exact: true }).selectOption({ label: 'umsatz' })
  await union.getByLabel('Eingang 2', { exact: true }).selectOption({ label: 'umsatz' })

  await expect(editorStatus(page)).toContainText(
    '„Union“ ist eine Union — diese Step-Art kann querbeet noch nicht ausführen.',
  )

  // …and the same Step carries the duplicate-upstream warning, on the canvas,
  // *before* any run — decided 2026-08-04: allow with a warning, because a Union
  // of a table with itself is a legitimate way to double a dataset and silent
  // duplication is not.
  await expect(union.getByTestId('step-mark')).toContainText(
    '„Union“ nimmt „umsatz“ an Eingang 1 und Eingang 2',
  )

  // The panel says so too, rather than showing an empty form.
  await select(page, 'Union: Union')
  await expect(panel(page).getByTestId('step-panel-unconfigurable')).toBeVisible()
})

test('a rename onto a name already in use is refused, and the previous config stays in force', async ({
  page,
}) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })

  await select(page, 'Spalten: Spalten')
  await enter(panel(page).getByLabel('Neuer Name: Betrag'), 'Kunde')

  await expect(refusal(page)).toContainText('Der Name „Kunde“ ist in diesem Step bereits vergeben')
  // The previous config is what the run still uses: three columns, unrenamed.
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
  await expect(panel(page).locator('th').nth(1)).toHaveText('Betrag')
  // …and the word the refusal is about is still on screen, so it can be fixed.
  await expect(panel(page).getByLabel('Neuer Name: Betrag')).toHaveValue('Kunde')
})

test('an emptied rename field names the column, never the core’s own field name', async ({
  page,
}) => {
  // Clearing a „Neuer Name“ field is an ordinary gesture: the registry refuses
  // the config, the edit is discarded, and this sentence is what explains it.
  // It read „… sind unvollständig (to)" — `to` being the core's word for a slot
  // in a config object, on a German screen, which NFR-6 forbids.
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })

  await select(page, 'Spalten: Spalten')
  await enter(panel(page).getByLabel('Neuer Name: Betrag'), '')

  await expect(refusal(page)).toContainText('Für Spalte „Betrag“ fehlt der neue Name')
  await expect(refusal(page)).not.toContainText('(to)')
  // The previous config stays in force, so the column is still there.
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
})

test('"is empty" matches null, the empty string and whitespace alike', async ({ page }) => {
  const SPARSE = csv(
    'notizen.csv',
    ['Kunde;Notiz', 'Anna;', 'Bernd;   ', 'Carla;wichtig', 'Dora;egal'].join('\n') + '\n',
  )
  await pick(page, SPARSE)
  await confirm(page, 'notizen')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'notizen' })

  await select(page, 'Filter: Filter')
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  await panel(page).getByLabel('Spalte der Bedingung 1').selectOption('Notiz')
  await panel(page).getByLabel('Vergleich der Bedingung 1').selectOption('empty')

  // The semantics are stated in the control itself, because three different cell
  // contents match this one operator.
  await expect(panel(page)).toContainText('ist leer (auch nur Leerzeichen)')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('2 Zeilen, 2 Spalten')

  // …and the complement is exact over the rest.
  await panel(page).getByLabel('Vergleich der Bedingung 1').selectOption('not_empty')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('2 Zeilen, 2 Spalten')
})

// ------------------------------------------- the names a column is known by

test('a repeated column name is made unique on ingest, and the new name is what every control shows', async ({
  page,
}) => {
  const TWICE = csv(
    'doppelt.csv',
    ['Kunde;Betrag;Betrag']
      .concat(NAMES.map((name, i) => `${name};${AMOUNTS[i]};${AMOUNTS[i]}`))
      .join('\n') + '\n',
  )
  await pick(page, TWICE)

  await expect(page.getByTestId('source-card')).toContainText(
    '„Betrag“ (Spalte 3) heißt jetzt „Betrag_2“',
  )
  // The typing panel addresses it by the name it was given…
  await expect(page.getByLabel('Typ: Betrag_2')).toBeVisible()
  // …and so does the preview's header row.
  await expect(page.getByTestId('preview').locator('th').nth(2)).toHaveText('Betrag_2')

  // An annotation and a chosen type follow the column by name, so they have to
  // survive a re-read — which is the property the rule's determinism buys.
  await enter(page.getByLabel('Notiz: Betrag_2'), 'Zweite Spalte')
  await page.getByLabel('Zeichenkodierung').selectOption('windows-1252')
  await expect(page.getByLabel('Notiz: Betrag_2')).toHaveValue('Zweite Spalte')

  await confirm(page, 'doppelt')
  await toEditor(page)
  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'doppelt' })

  // …and the Filter's column select offers the same name, which is the point of
  // making it unique at all: a Step reads a column by name.
  await select(page, 'Filter: Filter')
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
  const columnsOffered = await panel(page)
    .getByLabel('Spalte der Bedingung 1')
    .locator('option')
    .allInnerTexts()
  expect(columnsOffered).toEqual(['Kunde', 'Betrag', 'Betrag_2'])
})

test('a header row ending in two extra delimiters names its columns by position, and still converts', async ({
  page,
}) => {
  // Probed 2026-08-04: `Kunde,Betrag,,` yields two columns called `''` with no
  // diagnostic at all, and the engine's refusal then read "a table cannot hold
  // two columns called " — a sentence that breaks on its own empty name.
  const RAGGED = csv(
    'ragged.csv',
    ['Kunde;Betrag;;']
      .concat(NAMES.map((name, i) => `${name};${AMOUNTS[i]};;`))
      .concat('Jutta;abc;;')
      .join('\n') + '\n',
  )
  await pick(page, RAGGED)

  await expect(page.getByTestId('source-card')).toContainText('keinen Namen')
  await expect(page.getByTestId('source-card')).toContainText('col_3')
  await expect(page.getByTestId('source-card')).toContainText('col_4')

  // It confirms and converts like any other Source, and its unparsed cell is
  // marked — which was impossible before, because the Source was not converted
  // at all.
  await confirm(page, 'ragged')
  await expect(page.getByTestId('preview-mark')).toHaveText(['abc'])
})

// ----------------------------------------------------------- the interim rule

test('renaming and moving a Step recompute nothing, while connecting does', async ({ page }) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await select(page, 'Filter: Filter')
  // Not connected yet, so the Filter is short of an input and the run says so.
  await expect(panel(page).getByTestId('step-counts')).toContainText('Kein Ergebnis')

  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')

  // A rename changes the name and nothing else — the counts are still the ones
  // the last run produced, and the panel's subject follows the new name.
  await enter(card(page, 'Filter: Filter').getByLabel('Name'), 'Nur Große')
  await expect(card(page, 'Filter: Nur Große')).toBeVisible()
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
})

test('the panel takes its subject from the canvas, and lets go of it', async ({ page }) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  // Nothing selected, nothing to show — a panel about nothing would take a third
  // of the Editor to say so.
  await expect(page.getByTestId('step-panel-empty')).toBeVisible()
  await expect(panel(page)).toHaveCount(0)

  await page.getByRole('button', { name: '+ Filter' }).click()
  const filter = await select(page, 'Filter: Filter')
  await expect(panel(page)).toContainText('Filter')

  // Deleting the selected Step closes the panel rather than leaving it showing a
  // Step that no longer exists.
  await wrapper(page, filter).click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('step-panel-empty')).toBeVisible()
})

test('no raw core vocabulary reaches the screen while a Step is configured and previewed', async ({
  page,
}) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })
  await select(page, 'Filter: Filter')
  await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()

  // **The refusal region is read too, and it is the one that matters most.**
  // `editor-refusal` is a sibling of the panel, so a guard reading only the
  // panel could not see the region where a core-minted sentence in the Editor
  // actually lands — which is exactly where `step.config_invalid` put an English
  // field name on screen. So a refusal is *provoked* here rather than hoped for:
  // a Columns Step with an emptied rename field is the cheapest one to reach.
  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })
  await select(page, 'Spalten: Spalten')
  await enter(panel(page).getByLabel('Neuer Name: Betrag'), '')
  await expect(refusal(page)).not.toBeEmpty()

  const shown = [await panel(page).innerText(), await refusal(page).innerText()].join('\n')
  for (const enumValue of ['info', 'warning', 'error', 'unresolved']) {
    expect(shown.toLowerCase(), `severity "${enumValue}" reached the screen untranslated`).not.toMatch(
      new RegExp(`\\b${enumValue}\\b`),
    )
  }
  expect(shown, 'a diagnostic code reached the screen instead of a sentence').not.toMatch(
    /\b(step|exec|graph)\.[a-z_]+\b/,
  )
  // …and no operator or combination code either — those reach the screen as
  // select options rather than as diagnostics, which is a second way to leak the
  // core's own words.
  expect(shown).not.toMatch(/\bnot_empty\b/)
})
