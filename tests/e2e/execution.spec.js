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

// -------------------------------------------------------- the owner's case
//
// *Take the N largest records and carry them on.* Two Steps, because sorting
// alone only reorders — and the row that could not be read is the one this case
// exists for: it must be **last** rather than gone, and it must be said out loud
// at the Step that placed it.

test('Sortieren then Erste 3 carries the three largest on, with the unreadable row last', async ({
  page,
}) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Sortieren' }).click()
  await card(page, 'Sortieren: Sortieren')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'umsatz' })

  await select(page, 'Sortieren: Sortieren')
  // Unconfigured, so it is the identity — the chain stays readable while it is
  // being built, exactly as a freshly added Filter does.
  await expect(panel(page).getByTestId('sort-none')).toContainText(
    'die Zeilen bleiben in der Reihenfolge des Eingangs',
  )
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')

  await panel(page).getByRole('button', { name: 'Sortierung hinzufügen' }).click()
  await panel(page).getByLabel('Spalte der Sortierung 1').selectOption('Betrag')
  await panel(page).getByLabel('Richtung der Sortierung 1').selectOption('desc')

  // A Sort removes nothing.
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')
  await expect(panel(page).getByTestId('step-preview-row').first()).toContainText('1.234,56')
  // **The assertion the whole verb exists for.** `abc` is not a number, so the
  // row is placed rather than compared — and it is placed *last*, in a
  // descending order where the engine's own comparator put it in the middle and
  // dragged unrelated rows with it, differently in each browser.
  await expect(panel(page).getByTestId('step-preview-row').last()).toContainText('Jutta')
  await expect(
    panel(page).getByTestId('step-panel-mark').filter({ hasText: 'Warnung' }),
  ).toContainText('1 Zeile hat in einer Sortierspalte einen Wert')

  // …and the same row is still last the other way round, which is what makes
  // the placement a rule rather than an accident of one direction.
  await panel(page).getByLabel('Richtung der Sortierung 1').selectOption('asc')
  await expect(panel(page).getByTestId('step-preview-row').first()).toContainText('0,99')
  await expect(panel(page).getByTestId('step-preview-row').last()).toContainText('Jutta')
  await panel(page).getByLabel('Richtung der Sortierung 1').selectOption('desc')

  await page.getByRole('button', { name: '+ Erste/Letzte N' }).click()
  await card(page, 'Erste/Letzte N: Erste/Letzte N')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'Sortieren' })
  await card(page, 'Erste/Letzte N: Erste/Letzte N')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await select(page, 'Erste/Letzte N: Erste/Letzte N')
  // No count yet, so it is the identity too.
  await expect(panel(page).getByTestId('first-count-pending')).toContainText('alle Zeilen bleiben')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('10 Zeilen, 3 Spalten')

  await enter(panel(page).getByLabel('Anzahl Zeilen'), '3')

  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 3 Spalten')
  await expect(panel(page)).toContainText('7 Zeilen entfernt, 3 Zeilen übrig.')
  // 1.234,56 · 100,00 · 80,00 — the sorted order survives the limit, which is
  // what makes „die 10 neuesten“ two ordinary Steps rather than a special case.
  const shown = await panel(page).getByTestId('step-preview-row').allInnerTexts()
  expect(shown).toHaveLength(3)
  expect(shown[0]).toContain('Anna')
  expect(shown[1]).toContain('Ingo')
  expect(shown[2]).toContain('Bernd')

  // The other end of the same order, without touching the Sort upstream — and
  // it is where the row querbeet could not read has been sitting all along, so
  // the Step says so instead of letting it be discovered.
  await panel(page).getByLabel('Welche Zeilen').selectOption('last')

  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 3 Spalten')
  const last = await panel(page).getByTestId('step-preview-row').allInnerTexts()
  expect(last[2]).toContain('Jutta')
  await expect(
    panel(page).getByTestId('step-panel-mark').filter({ hasText: 'Warnung' }),
  ).toContainText('der behaltenen Zeilen enthält')

  await panel(page).getByLabel('Welche Zeilen').selectOption('first')
  await expect(
    panel(page).getByTestId('step-panel-mark').filter({ hasText: 'Warnung' }),
  ).toHaveCount(0)

  // An empty field leaves the stored count computing rather than lifting it.
  await enter(panel(page).getByLabel('Anzahl Zeilen'), '')
  await expect(panel(page).getByTestId('first-count-pending')).toContainText(
    'die vorherige bleibt in Kraft',
  )
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 3 Spalten')
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

// ------------------------------------------------------------ at report width

/** Thirty columns, which is the width the O(n)-clicks complaint is about — the
 *  four-column fixture every other case here uses is honest about nothing. The
 *  values are letters so every column types as `text`: what is under test is the
 *  form, and a detection surprise would fail far from its cause. */
const WIDE = csv(
  'breit.csv',
  [Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`).join(';')]
    .concat(
      ['a', 'b', 'c'].map((row) =>
        Array.from({ length: 30 }, (_, i) => `${row}${String(i + 1).padStart(2, '0')}`).join(';'),
      ),
    )
    .join('\n') + '\n',
)

test('keeping three of thirty columns costs four clicks, and the counts wait for the first one', async ({
  page,
}) => {
  // The whole of story 6c in one pass: "Alle abwählen" is a draft change and not
  // a config change, so nothing recomputes until a column is checked — and the
  // search finds a column in a list of thirty without reordering it.
  await pick(page, WIDE)
  await confirm(page, 'breit')
  await toEditor(page)

  await page.getByRole('button', { name: '+ Spalten' }).click()
  await card(page, 'Spalten: Spalten')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'breit' })
  await card(page, 'Spalten: Spalten')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await select(page, 'Spalten: Spalten')
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 30 Spalten')

  // One click clears all thirty…
  await panel(page).getByRole('button', { name: 'Alle abwählen' }).click()
  await expect(panel(page).getByLabel('Spalte übernehmen: S01')).not.toBeChecked()
  await expect(panel(page).getByLabel('Spalte übernehmen: S30')).not.toBeChecked()
  await expect(panel(page).getByTestId('columns-selection-pending')).toContainText(
    'die vorherige Einstellung bleibt in Kraft',
  )

  // Finding a column in thirty, without reordering anything: the order buttons
  // are disabled while the term filters, and say why.
  await panel(page).getByLabel('Spalte suchen').fill('S07')
  await expect(panel(page).getByTestId('columns-entry')).toHaveCount(1)
  await expect(panel(page).getByLabel('Nach oben: S07')).toBeDisabled()
  await expect(panel(page).getByTestId('columns-order-locked')).toContainText(
    'lässt sich die Reihenfolge nicht ändern',
  )

  // The first check is what reaches the model.
  await panel(page).getByLabel('Spalte übernehmen: S07').check()
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 1 Spalte')
  await expect(panel(page).getByTestId('columns-selection-pending')).toHaveCount(0)
  await panel(page).getByLabel('Spalte suchen').fill('')
  await expect(panel(page).getByTestId('columns-entry')).toHaveCount(30)

  // **The assertion this case exists for, and it is only falsifiable here.** A
  // stored config of one column is not the identity, so a regression that emitted
  // `{columns: []}` instead of withholding would read „30 Spalten“ at once. Over
  // a *freshly added* Step the same regression is invisible: the empty list is
  // the identity in `core/steps/columns.js` and thirty columns is what both the
  // right answer and the wrong one produce.
  await panel(page).getByRole('button', { name: 'Alle abwählen' }).click()
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 1 Spalte')
  await expect(panel(page).getByTestId('columns-selection-pending')).toBeVisible()

  await panel(page).getByLabel('Spalte übernehmen: S01').check()
  await panel(page).getByLabel('Spalte übernehmen: S07').check()
  await panel(page).getByLabel('Spalte übernehmen: S30').check()

  // 1 + 3 clicks for a selection that cost twenty-seven before this story.
  await expect(panel(page).getByTestId('step-counts')).toHaveText('3 Zeilen, 3 Spalten')
  // The list order is the output order, and the search never touched it. The
  // count is asserted first, so the order claim rests on the whole header row
  // rather than on its first three cells.
  await expect(panel(page).locator('th')).toHaveCount(3)
  await expect(panel(page).locator('th').first()).toHaveText('S01')
  await expect(panel(page).locator('th').nth(1)).toHaveText('S07')
  await expect(panel(page).locator('th').nth(2)).toHaveText('S30')
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

test('selecting a Step brings its panel into view without taking canvas away', async ({ page }) => {
  await pick(page, REPORT)
  await confirm(page, 'umsatz')
  await toEditor(page)

  const canvasBefore = await canvas(page).boundingBox()

  await page.getByRole('button', { name: '+ Filter' }).click()
  await select(page, 'Filter: Filter')

  // The panel is inside the viewport — the whole point. Before this it sat below
  // a canvas of fixed height and the user had to go looking for it.
  const viewport = page.viewportSize()
  const box = await panel(page).boundingBox()
  expect(box.y, 'the panel starts below the fold').toBeLessThan(viewport.height)
  expect(box.y + Math.min(box.height, viewport.height)).toBeGreaterThan(0)

  // And it is brought into view by *scrolling*, never by making the canvas
  // smaller: two layouts that took canvas space instead were built and measured
  // on 2026-08-04, and both cost the ability to click or drag to a Step.
  // To one decimal rather than exactly: Firefox reports the same `62vh` box a
  // few millionths of a pixel apart across two measurements, and the claim here
  // is about hundreds of pixels — a layout that made room for the panel would
  // have taken roughly half the canvas.
  const canvasAfter = await canvas(page).boundingBox()
  expect(canvasAfter.height, 'the canvas gave up height for the panel').toBeCloseTo(
    canvasBefore.height,
    1,
  )

  // `block: 'nearest'` scrolls the least that works, so the Step that was just
  // selected is still on screen above its own panel.
  const cardBox = await card(page, 'Filter: Filter').boundingBox()
  expect(cardBox.y + cardBox.height, 'the selected Step was scrolled past').toBeGreaterThan(0)
  expect(cardBox.y).toBeLessThan(viewport.height)
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

// ------------------------------------------------- the run the user can get out of
//
// **This is where story 7b's platform assumptions actually get tested.** The unit
// envelopes drive an injected yield by hand and can say nothing about whether an
// input event is delivered in the gap it opens; only an engine with an input queue
// can, and only from `file://`, which is the origin this product runs at.
//
// Measured from the built artefact on 2026-08-05, both engines, before this case
// was written (the spec's Ask First): 30 `MessageChannel` yields — one 30-Step
// run's worth — cost 0.1–0.5 ms in Chromium and 0–1 ms in Firefox, so 0.003 ms per
// yield against R4's 3.0 / 2 ms. The same 30 through `setTimeout(…, 0)` cost
// 99.9–124.2 / 110–122 ms, which is the 4 ms clamp this design refuses, measured
// here rather than cited. `SharedArrayBuffer` is `undefined` from `file://` in
// both engines, exactly as AD-9 says.

const BIG_ROWS = 500_000
const amountAt = (i) => Number(AMOUNTS[i % 9].replace(/\./g, '').replace(',', '.'))
const above = (limit) =>
  Array.from({ length: BIG_ROWS }, (_, i) => amountAt(i)).filter((a) => a > limit).length
const de = (n) => n.toLocaleString('de-DE')

const BIG = csv(
  'gross.csv',
  ['Kunde;Betrag;Datum']
    .concat(
      Array.from(
        { length: BIG_ROWS },
        (_, i) => `${NAMES[i % 9]}-${i};${AMOUNTS[i % 9]};${DATES[i % 9]}`,
      ),
    )
    .join('\n') + '\n',
)

const STEPS = 45

const progress = (page) => page.getByTestId('editor-progress')
const cancelRun = (page) => page.getByTestId('editor-cancel')

/**
 * The status band's outer box and the canvas's, read in one turn of the page's own
 * event loop — and, with `takeCancel`, the cancel control focused in the same turn.
 *
 * **One call rather than three, because the run is racing it.** The band's height
 * is the thing story 6b measured (405 px of canvas became 237 px when this region
 * was allowed to grow) and happy-dom returns an all-zero rect, so this assertion
 * can only live here — but every extra round trip while a run is walking is a
 * chance for it to end first, which is the one way this case goes flaky.
 */
const geometry = (page, { takeCancel = false } = {}) =>
  page.evaluate((take) => {
    const box = (el) => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, height: rect.height }
    }
    // The band is the fixed-height region the refusal, the status and the progress
    // line all share; it has no testid of its own because nothing else needs one.
    const band = document.querySelector('[data-testid="editor-refusal"]').parentElement
    const view = document.querySelector('[data-testid="editor-canvas"]')
    const cancel = take ? document.querySelector('[data-testid="editor-cancel"]') : null
    const measured = { band: box(band), view: box(view), tag: cancel?.tagName ?? null }
    cancel?.focus()
    return measured
  }, takeCancel)
const cardIds = (page) =>
  page
    .locator('[data-testid="step-card"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-node')))
const byId = (page, id) => page.locator(`[data-testid="step-card"][data-node="${id}"]`)
const selectById = async (page, id) => {
  await wrapper(page, id).evaluate((el) => el.focus())
  await wrapper(page, id).click({ position: { x: 4, y: 4 } })
  await expect(panel(page)).toBeVisible()
}

test('a long run says where it is, and stops between two Steps when it is told to', async ({
  page,
}) => {
  // Well past the 30 s default, and it has to be: half a million rows to ingest,
  // forty-five Steps to wire, and a run long enough to be interrupted. Measured
  // 2026-08-05 at ~27 s (Chromium) and ~24 s (Firefox) end to end.
  test.setTimeout(180_000)

  await pick(page, BIG)
  await confirm(page, 'gross')
  await toEditor(page)

  // Forty-five Steps. R4's shape is thirty, and thirty was tried first: Chromium
  // passed, and Firefox passed once and failed once — the run finished between the
  // control appearing and the pointer reaching it, so the German sentence never
  // came. Forty-five is the same shape with margin. The margin is the honest price
  // of asserting an interaction the product wins by design rather than by timing,
  // and it is bought twice: with more Steps, and by taking the control from the
  // keyboard, which is both cheaper to deliver and what AD-30 asks for anyway.
  //
  // They are added by id rather than by name: forty-five Steps of one kind share
  // one accessible name, and the pane qualifies each with its own id precisely so
  // they can still be told apart.
  const chain = []
  let upstream = null
  for (let i = 0; i < STEPS; i += 1) {
    const before = await cardIds(page)
    await page.getByRole('button', { name: '+ Filter' }).click()
    const after = await cardIds(page)
    const id = after.find((each) => !before.includes(each))
    chain.push(id)
    await byId(page, id)
      .getByLabel('Eingang 1', { exact: true })
      .selectOption(upstream ?? (await idOf(page, 'Quelle: gross')))
    upstream = id

    if (i === 0) {
      // The first Step carries the only condition in the chain, and it starts
      // *narrow*: the identity Filters below it then cost almost nothing to wire
      // up, and the edit at the end of this case widens it so that every one of
      // them has half a million rows to walk instead of a ninth of them.
      await selectById(page, id)
      await panel(page).getByRole('button', { name: 'Bedingung hinzufügen' }).click()
      await panel(page).getByLabel('Spalte der Bedingung 1').selectOption('Betrag')
      await panel(page).getByLabel('Vergleich der Bedingung 1').selectOption('gt')
      await enter(panel(page).getByLabel('Wert der Bedingung 1'), '100')
    }
  }
  await byId(page, chain.at(-1))
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await selectById(page, chain.at(-1))
  await expect(panel(page).getByTestId('step-counts')).toHaveText(
    `${de(above(100))} Zeilen, 3 Spalten`,
  )

  // **The geometry, measured before the run starts.** The status band's `h-20` is
  // load-bearing rather than tidy: letting the region grow shrank the canvas from
  // 405 px to 237 px over three commands in story 6b, which moves every Step on
  // screen out from under the pointer aimed at it. The progress line and the cancel
  // control live *inside* that band for exactly this reason, and nothing asserted
  // it until now — happy-dom returns an all-zero rect, so this assertion can only
  // exist here.
  //
  // 96 px and not 80: `h-20` is 5rem of *content* height, and this project omits
  // Tailwind's preflight (the stack table says so), so nothing sets
  // `box-sizing: border-box` and the `py-2` above and below is outside it. The
  // number worth pinning is the one a user's canvas is displaced by, which is the
  // outer box.
  const idle = await geometry(page)
  expect(Math.round(idle.band.height)).toBe(96) // h-20 + py-2, content-box

  // The edit that starts the run this case is about: every Step in the chain
  // recomputes, and each of them now walks half a million rows.
  await selectById(page, chain[0])
  await enter(panel(page).getByLabel('Wert der Bedingung 1'), '0')

  // It outlives the 150 ms reveal delay, so it says where it is…
  await expect(progress(page)).toContainText(`von ${STEPS + 1}`)

  // …and offers a way out. It is a real `<button>`, so it is reachable and
  // operable from the keyboard for free (AD-30, which forbids an interaction that
  // exists only as a pointer gesture) — and taking it that way is also the
  // cheapest possible delivery, which keeps this case about the run rather than
  // about how long a headless engine takes to hit-test a moving band.
  await expect(cancelRun(page)).toBeVisible()

  // **The geometry and the control, in one turn of the page's own event loop.**
  // Every round trip from here is a chance for the run to finish before the
  // control is taken — a 45-Step chain over half a million rows walks in well
  // under a second — so the measurements ride along with the focus rather than
  // costing three calls of their own. That the call lands at all, while the walk
  // is walking, is the message queue doing what this story bought it for.
  const running = await geometry(page, { takeCancel: true })
  expect(running.tag).toBe('BUTTON')
  await expect(cancelRun(page)).toBeFocused()
  await page.keyboard.press('Enter')

  // …and the band it was given did not grow, so the canvas kept its size and its
  // place. The distance between the two is measured in the same frame each time,
  // so the page having scrolled in between cancels out; an absolute `y` would not,
  // because selecting a Step scrolls the panel into view.
  expect(Math.round(running.band.height)).toBe(96)
  expect(Math.round(running.view.height)).toBe(Math.round(idle.view.height))
  const gap = (at) => Math.round(at.view.y - at.band.y)
  expect(gap(running)).toBe(gap(idle))

  // The keypress was *delivered while the walk was still walking*, which is the
  // whole reason the yield goes through the message queue rather than the microtask
  // queue: a microtask yield drains before the engine processes input, so this
  // sentence would never have appeared.
  await expect(editorStatus(page)).toContainText('Der Lauf wurde abgebrochen')
  // Arbeitsschritte and not Steps: the walk has one node per Step *and* one for
  // the Quelle, so „Von 46 Steps" in front of a 45-Step chain would be the
  // interface being wrong about the one number it reports.
  await expect(editorStatus(page)).toContainText(
    `Von ${STEPS + 1} Arbeitsschritten (Quellen mitgezählt)`,
  )
  await expect(progress(page)).toHaveCount(0)
  await expect(cancelRun(page)).toHaveCount(0)

  // **The assertion the story exists for.** Some of these Steps had already
  // finished under the new condition when the run was stopped, and their answers
  // are still not on screen: a partly computed graph presented as the current
  // result is the failure this product is built to prevent. What the panel shows is
  // the previous run's number, unchanged.
  await selectById(page, chain.at(-1))
  await expect(panel(page).getByTestId('step-counts')).toHaveText(
    `${de(above(100))} Zeilen, 3 Spalten`,
  )
})
