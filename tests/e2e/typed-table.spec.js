// Story 6a against the built artefact from file:// (AD-27), both engines.
//
// The promise under test is the one CAP-9 could state but not keep: the panel
// says "9 von 10 Werten lesbar" and, until this story, nothing in the interface
// could show *which* value. The count came from detection; the marks come from
// the conversion — a confirmed Source is converted as Step zero, the values that
// fail their confirmed type are boxed by the engine adapter, and the row indices
// come back as plain data. So this suite asserts the two numbers against each
// other rather than against a constant: whatever the panel claims, exactly that
// many cells are marked, and each shows the text that was in the file.
//
// Fixture bytes are built inline, as in the other suites — a fixture file on
// disk carries whatever encoding an editor last saved it as.
//
// THE TRAP THE OTHER SUITES ALREADY NAME, and it applies here twice over: a
// German number contains a comma, so a fixture of German numbers cannot use
// comma as its delimiter. Real German exports use semicolons for exactly that
// reason, so this one does too.
//
// THE SECOND TRAP IS THE PROPOSAL THRESHOLD. Detection proposes a type at 90 % of
// the non-missing values and not below, so a column needs nine readable values
// behind its one unreadable one. Written four rows long, the same fixture is a
// `text` column with nothing unreadable in it at all, and every assertion here
// would fail somewhere far from the cause.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const csv = (name, content) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const cards = (page) => page.getByTestId('source-card')

/** One column's row in the Step zero panel. Scoped, because a hit rate is a
 *  per-column claim and a card-wide locator would match every column's. */
const columnRow = (page, name) =>
  page.getByTestId('typing-column').filter({ has: page.getByLabel(`Typ: ${name}`) })

/** The two numbers in "9 von 10 Werten lesbar", as numbers. This is what the
 *  marks are asserted against — the sentence a person actually reads, rather than
 *  a constant in this file that could agree with nothing. */
const hitRate = async (page, name) => {
  const text = await columnRow(page, name).getByTestId('typing-hitrate').textContent()
  const [parsed, readable] = [...text.matchAll(/(\d+(?:\.\d+)*)/g)].map((m) =>
    Number(m[1].replaceAll('.', '')),
  )
  return { parsed, readable, unparsed: readable - parsed }
}

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
const NAMES = ['Anna', 'Bernd', 'Carla', 'Dora', 'Emil', 'Frida', 'Gustav', 'Heike', 'Ingo']

/** Nine clean rows and a tenth carrying one unreadable value in each of the two
 *  typed columns — `abc` where a number belongs, `demnächst` where a date does. */
const REPORT = csv(
  'umsatz.csv',
  ['Kunde;Betrag;Datum']
    .concat(NAMES.map((name, i) => `${name};${AMOUNTS[i]};${DATES[i]}`))
    .concat('Jutta;abc;demnächst')
    .join('\n') + '\n',
)

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

test('the count becomes the rows, once the types are confirmed', async ({ page }) => {
  await pick(page, REPORT)
  const card = cards(page)

  // What detection counted, per column, read off the sentence the user sees.
  const betrag = await hitRate(page, 'Betrag')
  const datum = await hitRate(page, 'Datum')
  expect(betrag).toEqual({ parsed: 9, readable: 10, unparsed: 1 })
  expect(datum).toEqual({ parsed: 9, readable: 10, unparsed: 1 })

  // Before the confirmation there is nothing to mark: nothing is computed from
  // types nobody has vouched for (AD-29's first gate). The preview is genuinely
  // rendered, so this is about the marks rather than about an empty grid.
  await expect(card.getByTestId('preview-mark')).toHaveCount(0)
  await expect(card.getByTestId('preview-row')).toHaveCount(10)

  await card.getByLabel('Typen bestätigen: umsatz').click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')

  // Exactly as many marks as the two sentences claim unreadable values — the
  // acceptance criterion, asserted against the panel rather than against a
  // number written here.
  const marks = card.getByTestId('preview-mark')
  await expect(marks).toHaveCount(betrag.unparsed + datum.unparsed)

  // …and each one shows the text that was in the file, which is the whole point
  // of the box: the value is not dropped, not nulled and not replaced.
  await expect(marks).toHaveText(['abc', 'demnächst'])
  await expect(marks.first()).toHaveAttribute('title', 'Unter dem bestätigten Typ nicht lesbar')
})

test('a confirmation withdrawn takes the marks with it', async ({ page }) => {
  await pick(page, REPORT)
  const card = cards(page)

  await card.getByLabel('Typen bestätigen: umsatz').click()
  await expect(card.getByTestId('preview-mark')).toHaveCount(2)

  await card.getByLabel('Bestätigung aufheben: umsatz').click()
  await expect(card.getByTestId('preview-mark')).toHaveCount(0)
  await expect(card.getByTestId('preview-row')).toHaveCount(10)
})

test('a re-read unmakes the confirmation, and the marks with it', async ({ page }) => {
  // A re-read can change every value in the table even when the column names are
  // identical, so a confirmation never survives one — and neither may a
  // conversion computed from it. Switching the encoding is the cheapest re-read
  // that leaves the values intact, which is what makes this about the *entry*
  // changing rather than about the data.
  await pick(page, REPORT)
  const card = cards(page)

  await card.getByLabel('Typen bestätigen: umsatz').click()
  await expect(card.getByTestId('preview-mark')).toHaveCount(2)

  await card.getByLabel('Zeichenkodierung').selectOption('windows-1252')
  await expect(card.getByTestId('typing')).toContainText('noch nicht bestätigt')
  await expect(card.getByTestId('preview-mark')).toHaveCount(0)
})

test('a column the user retypes is marked under the type they chose', async ({ page }) => {
  // The marks follow the *confirmed* type, not detection's proposal. Retyping the
  // date column to text makes every value in it readable — text has no reading to
  // fail — so the mark that was there disappears while the number column's stays.
  await pick(page, REPORT)
  const card = cards(page)

  await card.getByLabel('Typ: Datum').selectOption('text')
  await expect(columnRow(page, 'Datum').getByTestId('typing-hitrate')).toHaveText(
    '10 von 10 Werten lesbar',
  )

  await card.getByLabel('Typen bestätigen: umsatz').click()

  const marks = card.getByTestId('preview-mark')
  await expect(marks).toHaveCount(1)
  await expect(marks).toHaveText(['abc'])
})
