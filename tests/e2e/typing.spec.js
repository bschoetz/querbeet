// Story 3 — Step zero against the built artefact from file:// (AD-27), both
// engines. What is under test is the product's strongest correctness promise in
// its user-visible form: a Source is not confirmable while a column is
// genuinely undecided, and the interface says which column and why.
//
// Fixture bytes are built inline, as in the other suites — a fixture file on
// disk carries whatever encoding an editor last saved it as.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const csv = (name, content) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(content),
})

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const cards = (page) => page.getByTestId('source-card')

/** One column's row in the Step zero panel. Scoped, because a hit rate is a
 *  per-column claim and a card-wide locator would match every column's. */
const columnRow = (page, name) =>
  page.getByTestId('typing-column').filter({ has: page.getByLabel(`Typ: ${name}`) })

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

test('a German export is typed on arrival, and says what it read', async ({ page }) => {
  await pick(
    page,
    // A semicolon export, which is what a German spreadsheet produces — and
    // has to be, since the values themselves contain commas.
    csv('umsatz.csv', 'Kunde;Betrag;Datum\nAnna;1.234,56;31.12.2025\nBernd;80,00;01.03.2026\n'),
  )

  const card = cards(page)
  await expect(card.getByLabel('Typ: Betrag')).toHaveValue('number')
  await expect(card.getByLabel('Lesart: Betrag')).toHaveValue('de-DE')
  await expect(card.getByLabel('Typ: Kunde')).toHaveValue('text')

  // The hit rate is per column and counted, not asserted in the abstract.
  await expect(columnRow(page, 'Betrag').getByTestId('typing-hitrate')).toHaveText(
    '2 von 2 Werten lesbar',
  )

  // 31.12. can only be a day-month reading, so this column was decided by
  // evidence rather than by a silent preference — and it says so.
  await expect(card.getByTestId('typing-verdict')).toContainText('lassen sich nur als TT.MM.JJJJ')
})

test('a fully ambiguous column names no winner and blocks confirmation', async ({ page }) => {
  // Every value reads either way. This is the state FR-9 says no comparable
  // tool reports: DuckDB documents a tie-break where dd-mm beats mm-dd
  // silently, and Power Query inherits the OS locale once.
  await pick(page, csv('termine.csv', 'Termin\n03.04.2025\n05.06.2025\n01.02.2024\n'))

  const card = cards(page)
  await expect(card.getByTestId('typing-verdict')).toContainText(
    'Nichts in dieser Spalte entscheidet',
  )
  await expect(card.getByTestId('typing')).toContainText('Noch offen: Termin.')

  await card.getByRole('button', { name: 'Typen bestätigen: termine' }).click()

  await expect(card.getByTestId('typing-refusal')).toContainText('Termin')
  await expect(card.getByTestId('typing')).not.toContainText('Typen bestätigt.')

  // Answering the question is what unblocks it — and nothing else.
  await card.getByLabel('Lesart: Termin').selectOption('dd.MM.yyyy')
  await card.getByRole('button', { name: 'Typen bestätigen: termine' }).click()

  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
  await expect(card.getByTestId('typing-refusal')).toHaveCount(0)
})

test('a confirmation does not survive a re-read, even a silent one', async ({ page }) => {
  await pick(page, csv('umsatz.csv', 'Kunde;Betrag\nAnna;1.234,56\nBernd;80,00\n'))

  const card = cards(page)
  await card.getByRole('button', { name: 'Typen bestätigen: umsatz' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')

  // A different encoding changes every value while the column names stay put.
  await card.getByLabel('Zeichenkodierung').selectOption('windows-1252')

  await expect(card.getByTestId('typing')).toContainText('Typen noch nicht bestätigt.')
})

test('a column of leading zeros stays text — the zeros are the information', async ({ page }) => {
  await pick(page, csv('artikel.csv', 'Nummer\n0123\n0456\n0789\n'))

  await expect(cards(page).getByLabel('Typ: Nummer')).toHaveValue('text')
})

test('declaring a missing token recounts the column without answering its question', async ({
  page,
}) => {
  await pick(page, csv('werte.csv', 'Kunde;Betrag\nAnna;1,50\nBernd;entfällt\nClara;2,50\n'))

  const card = cards(page)
  const betrag = columnRow(page, 'Betrag')
  await card.getByLabel('Typ: Betrag').selectOption('number')
  await expect(betrag.getByTestId('typing-hitrate')).toHaveText('2 von 3 Werten lesbar')

  await card.getByLabel('Fehlende Werte: Betrag').fill('entfällt')
  await card.getByLabel('Fehlende Werte: Betrag').blur()

  // The value did not become readable — it became an absence, which is a
  // different fact and a different number (FR-9).
  await expect(betrag.getByTestId('typing-hitrate')).toHaveText('2 von 2 Werten lesbar, 1 leer')
})

test('an annotation is the user’s own text, and it survives a re-read', async ({ page }) => {
  await pick(page, csv('umsatz.csv', 'Kunde;Betrag\nAnna;1.234,56\n'))

  const card = cards(page)
  const note = card.getByLabel('Notiz: Betrag')
  await note.fill('Netto, ohne Fracht')
  await note.blur()

  await expect(card.getByLabel('Notiz: Betrag')).toHaveValue('Netto, ohne Fracht')

  await card.getByLabel('Zeichenkodierung').selectOption('windows-1252')

  // The values were re-decoded; the sentence someone wrote is still theirs.
  await expect(card.getByLabel('Notiz: Betrag')).toHaveValue('Netto, ohne Fracht')
})
