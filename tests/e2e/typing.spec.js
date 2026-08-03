// Story 3 — Step zero against the built artefact from file:// (AD-27), both
// engines. What is under test is the product's strongest correctness promise in
// its user-visible form: a Source is not confirmable while a column is
// genuinely undecided, and the interface says which column and why.
//
// Fixture bytes are built inline, as in the other suites — a fixture file on
// disk carries whatever encoding an editor last saved it as.
//
// ONE TRAP, WORTH KNOWING BEFORE WRITING A FIXTURE HERE: a German number
// contains a comma, so a fixture of German numbers cannot use comma as its
// delimiter. Written that way, `Anna,1.234,56` is three fields against a
// two-column header, the row is excluded as structurally damaged (CAP-39), and
// the test fails somewhere far from the cause — a missing column control rather
// than a parse complaint. Real German exports use semicolons for exactly this
// reason, so the fixtures do too.

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
  // evidence rather than by a silent preference — and it says so, in the
  // singular, because exactly one value carries the evidence.
  await expect(card.getByTestId('typing-verdict')).toContainText(
    '1 Wert lässt sich nur als TT.MM.JJJJ lesen, nicht als MM.TT.JJJJ — daher TT.MM.JJJJ.',
  )
})

test('a column of plain integers is not a question', async ({ page }) => {
  // Both number readings make `42` the same number, so there is nothing to
  // decide. Reported as an ambiguity — which is what a literal reading of "every
  // value parses under both readings" produces — this would hold the gate shut
  // over the most common column type in any table.
  await pick(page, csv('menge.csv', 'Artikel;Menge;Jahr\nSchraube;42;2019\nMutter;7;2020\n'))

  const card = cards(page)
  await expect(card.getByLabel('Typ: Menge')).toHaveValue('number')
  await expect(card.getByTestId('typing-verdict')).toHaveCount(0)
  await expect(card.getByTestId('typing')).toContainText('Typen noch nicht bestätigt.')

  await card.getByRole('button', { name: 'Typen bestätigen: menge' }).click()

  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
  await expect(card.getByTestId('typing-refusal')).toHaveCount(0)
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

  // The control beside the verdict must not name a winner either. Detection
  // ranks dd.MM.yyyy first here, and a select showing it as the selected option
  // could never receive it as an answer: re-selecting the displayed value fires
  // no change event, so the user would be forced to pick the wrong reading and
  // correct it. The delimiter select already solves this the same way.
  await expect(card.getByLabel('Lesart: Termin')).toHaveValue('')

  await card.getByRole('button', { name: 'Typen bestätigen: termine' }).click()

  await expect(card.getByTestId('typing-refusal')).toContainText('Termin')
  await expect(card.getByTestId('typing')).not.toContainText('Typen bestätigt.')

  // Answering the question is what unblocks it — and the refusal goes with the
  // answer, not with the next press of the button.
  await card.getByLabel('Lesart: Termin').selectOption('dd.MM.yyyy')
  await expect(card.getByTestId('typing-refusal')).toHaveCount(0)
  await expect(card.getByTestId('typing')).toContainText('Typen noch nicht bestätigt.')

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

test('an overridden type can be handed back to detection', async ({ page }) => {
  // Overriding used to be one-way: nothing in the pane returned a column to the
  // proposal, and the only route back was a re-read, which drops the
  // confirmation with it.
  await pick(page, csv('umsatz.csv', 'Kunde;Betrag\nAnna;1.234,56\nBernd;80,00\n'))

  const card = cards(page)
  const betrag = columnRow(page, 'Betrag')
  await expect(card.getByLabel('Typ: Betrag')).toHaveValue('number')

  await card.getByLabel('Typ: Betrag').selectOption('text')
  await expect(betrag.getByTestId('typing-hitrate')).toHaveText('2 von 2 Werten lesbar')
  await expect(card.getByLabel('Typ: Betrag')).toHaveValue('text')

  // The way back appears only now, because only now is there a choice to
  // withdraw — and it restores the reading as well as the type.
  await card.getByLabel('Typ: Betrag').selectOption({ label: 'Zurück zum Vorschlag' })

  await expect(card.getByLabel('Typ: Betrag')).toHaveValue('number')
  await expect(card.getByLabel('Lesart: Betrag')).toHaveValue('de-DE')
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

test('an ERP export is typed past text, and the type question blocks the gate', async ({ page }) => {
  // Story 4a's whole reason to exist, as one journey. Before it, every column
  // below was `text`: a timestamp, a clock time, a ja/nein flag, a percentage
  // and an accounting negative — and the 19-digit order number was worse than
  // text, because it was `number`, `settled` and one confirmation away from
  // losing its last four digits.
  await pick(
    page,
    csv(
      'auftraege.csv',
      'Auftrag;Zeitpunkt;Beginn;Freigegeben;Marge;Saldo\n' +
        '1234567890123456789;31.12.2025 14:30;08:15;ja;12,5 %;(1.234,56)\n' +
        '1234567890123456780;01.03.2026 08:00;17:20;Nein;80,0 %;1.234,56-\n',
    ),
  )

  const card = cards(page)

  // The digits are the information — the whole column stays text rather than
  // being proposed as a number nobody can convert without losing it.
  await expect(card.getByLabel('Typ: Auftrag')).toHaveValue('text')

  await expect(card.getByLabel('Typ: Zeitpunkt')).toHaveValue('datetime')
  await expect(card.getByLabel('Lesart: Zeitpunkt')).toHaveValue('dd.MM.yyyy HH:mm')
  await expect(card.getByLabel('Typ: Freigegeben')).toHaveValue('boolean')
  await expect(card.getByLabel('Lesart: Freigegeben')).toHaveValue('ja/nein')

  // The number keeps its digits and the sign rides on the column beside it.
  await expect(card.getByLabel('Typ: Marge')).toHaveValue('number')
  await expect(columnRow(page, 'Marge').getByTestId('typing-affix')).toHaveText('Einheit: %')
  await expect(card.getByLabel('Typ: Saldo')).toHaveValue('number')
  await expect(columnRow(page, 'Saldo').getByTestId('typing-hitrate')).toHaveText(
    '2 von 2 Werten lesbar',
  )

  // Nothing in a column of clock times says whether it is a time of day or a
  // span, so the question is asked as a type — and the select must not already
  // show one of the two answers, or it could never receive it as one.
  await expect(columnRow(page, 'Beginn').getByTestId('typing-verdict')).toContainText(
    'zwischen Dauer und Uhrzeit — bitte den Typ wählen',
  )
  await expect(card.getByLabel('Typ: Beginn')).toHaveValue('')
  await expect(card.getByTestId('typing')).toContainText('Noch offen: Beginn.')

  await card.getByRole('button', { name: 'Typen bestätigen: auftraege' }).click()
  await expect(card.getByTestId('typing-refusal')).toContainText('Beginn')

  await card.getByLabel('Typ: Beginn').selectOption('time')

  await expect(card.getByLabel('Typ: Beginn')).toHaveValue('time')
  await expect(card.getByTestId('typing-refusal')).toHaveCount(0)

  await card.getByRole('button', { name: 'Typen bestätigen: auftraege' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
})

test('a duration column settles itself, and a mixed unit refuses to be a number', async ({
  page,
}) => {
  await pick(
    page,
    csv(
      'zeiten.csv',
      'Dauer;Betrag\n08:15;12 €\n17:20;12 $\n36:15;7 €\n',
    ),
  )

  const card = cards(page)

  // One value past 24:00 is evidence no clock time can carry, so this column is
  // decided rather than asked about — and the count that decided it is named.
  await expect(card.getByLabel('Typ: Dauer')).toHaveValue('duration')
  await expect(columnRow(page, 'Dauer').getByTestId('typing-verdict')).toContainText(
    '1 Wert lässt sich nur als Dauer lesen, nicht als Uhrzeit — daher Dauer.',
  )

  // Two currencies in one column cannot be summed, so it is text and both are
  // named. The card says so in German; the code never reaches the screen.
  await expect(card.getByLabel('Typ: Betrag')).toHaveValue('text')
  await expect(card).toContainText(
    'Spalte „Betrag“ enthält Werte mit verschiedenen Einheiten (€ und $)',
  )

  // A duration needs no reading, so nothing offers one.
  await expect(card.getByLabel('Lesart: Dauer')).toHaveCount(0)
})

test('the timestamps a real database writes are typed, not text', async ({ page }) => {
  // Every one of these read as `text` at some point during this story, each for
  // its own reason, and each is what a named producer actually writes.
  await pick(
    page,
    csv(
      'protokoll.csv',
      'SqlServer;Postgres;Deutsch;Iso\n' +
        '2026-02-13 15:57:35.4616727;2026-02-13 15:57:35.461+02:00;31.12.2025 9:05;2025-12-31t14:30:00z\n' +
        '2026-02-14 08:01:02.1000000;2026-02-14 08:01:02.100+02:00;01.03.2026 8:00;2025-01-01T00:00:00,461+02\n',
    ),
  )

  const card = cards(page)
  for (const name of ['SqlServer', 'Postgres', 'Deutsch', 'Iso']) {
    await expect(card.getByLabel(`Typ: ${name}`)).toHaveValue('datetime')
    await expect(columnRow(page, name).getByTestId('typing-hitrate')).toHaveText(
      '2 von 2 Werten lesbar',
    )
  }

  await expect(card.getByLabel('Lesart: Iso')).toHaveValue('ISO 8601')
  await expect(card.getByLabel('Lesart: Deutsch')).toHaveValue('dd.MM.yyyy HH:mm')

  await card.getByRole('button', { name: 'Typen bestätigen: protokoll' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
})

test('a column of version numbers is asked about, not silently dated', async ({ page }) => {
  // The regression review round 1 found. `01.02.03` is a date under `dd.MM.yy`
  // and equally a version number — and before this story such a column read as
  // text, so a settled date is a worse answer than the one it already had.
  await pick(page, csv('kapitel.csv', 'Version;Datum\n01.02.03;31.12.25\n04.05.06;01.03.26\n'))

  const card = cards(page)

  await expect(columnRow(page, 'Version').getByTestId('typing-verdict')).toContainText(
    'zwischen Datum und Text — bitte den Typ wählen',
  )
  await expect(card.getByLabel('Typ: Version')).toHaveValue('')
  await expect(card.getByTestId('typing')).toContainText('Noch offen: Version.')

  // The neighbour is the shape the two-digit year was asked for, and `31` is no
  // month — so that column decides for itself and raises no question at all.
  await expect(card.getByLabel('Typ: Datum')).toHaveValue('date')
  await expect(card.getByLabel('Lesart: Datum')).toHaveValue('dd.MM.yy')

  await card.getByRole('button', { name: 'Typen bestätigen: kapitel' }).click()
  await expect(card.getByTestId('typing-refusal')).toContainText('Version')

  // Answering `Datum` closes the question that was asked and cannot close the
  // one behind it: `03.04.25` reads the same under TT.MM.JJ and MM.TT.JJ, so the
  // reading select comes back — with the placeholder, still asking — and the
  // gate stays shut. A chosen type settles a column only where nothing else in
  // it is open.
  await card.getByLabel('Typ: Version').selectOption('date')
  await expect(card.getByLabel('Lesart: Version')).toHaveValue('')
  await expect(columnRow(page, 'Version').getByTestId('typing-verdict')).toContainText(
    'zwischen TT.MM.JJ und MM.TT.JJ — bitte wählen',
  )
  await card.getByRole('button', { name: 'Typen bestätigen: kapitel' }).click()
  await expect(card.getByTestId('typing-refusal')).toContainText('Version')

  // Text is the answer those columns used to get for free, and it is one click.
  await card.getByLabel('Typ: Version').selectOption('text')
  await expect(columnRow(page, 'Version').getByTestId('typing-hitrate')).toHaveText(
    '2 von 2 Werten lesbar',
  )

  await card.getByRole('button', { name: 'Typen bestätigen: kapitel' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
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
