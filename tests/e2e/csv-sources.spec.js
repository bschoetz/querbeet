// Story 1 — CSV Sources, against the built artefact from file:// (AD-27), both
// engines. Everything here drives the real UI: the file dialog, the selects,
// the German sentences. No store access, no dev server.
//
// Fixture bytes are built inline as Uint8Array/Buffer — CP1252 needs exact
// bytes, and a fixture file's encoding is whatever an editor last saved it as,
// which is precisely the ambiguity these tests exist to pin down.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const CP1252 = {
  '€': 0x80,
  'ä': 0xe4,
  'ö': 0xf6,
  'ü': 0xfc,
  'Ä': 0xc4,
  'Ö': 0xd6,
  'Ü': 0xdc,
  'ß': 0xdf,
}

/** Exact CP1252 bytes — never a string round-tripped through UTF-8. */
function cp1252(text) {
  const bytes = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp < 0x80) bytes.push(cp)
    else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch])
    else throw new Error(`no CP1252 byte mapped for "${ch}" — extend the map`)
  }
  return Buffer.from(bytes)
}

// Buffer.from(string) encodes UTF-8, which is exactly what the UTF-8 fixtures want.
const csv = (name, content) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
})

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const cards = (page) => page.getByTestId('source-card')

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

test('a CP1252 semicolon export becomes a named Source — characters correct, delimiter detected, name editable', async ({
  page,
}) => {
  await pick(
    page,
    csv(
      'umsatz.csv',
      cp1252(
        'Kunde;Straße;Betrag in €\nBäcker Müller;Hauptstraße 1;1200,50\nMetzger Öz;Ringweg 9;80,00\n',
      ),
    ),
  )

  const card = cards(page)
  await expect(card).toHaveCount(1)

  // The 1252 fallback read the umlauts and the euro sign correctly. Anchored on
  // the preview grid's header row (Story 2), which carries the column names now
  // that the chips are gone — a plain text match would also accept a cell value
  // that happens to read the same.
  await expect(card.getByRole('columnheader', { name: 'Straße', exact: true })).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Betrag in €', exact: true })).toBeVisible()
  // … the semicolon was detected, the ladder verdict is visible …
  await expect(card.getByLabel('Trennzeichen')).toHaveValue(';')
  await expect(card.getByLabel('Zeichenkodierung')).toHaveValue('windows-1252')
  await expect(card.getByText('2 Zeilen')).toBeVisible()

  // … and the name is editable state, not the file name. Asserted through the
  // remove button's accessible name — rendered from the store entry — because
  // the input element itself keeps its keystrokes even when the rename command
  // is unwired, and a test reading back its own typing proves nothing.
  const name = card.getByLabel('Name')
  await expect(name).toHaveValue('umsatz')
  await name.fill('Umsatz August')
  await name.blur()
  await expect(card.getByRole('button', { name: 'Entfernen: Umsatz August' })).toBeVisible()
})

test('switching the encoding re-reads from the retained bytes and the rendered values change', async ({
  page,
}) => {
  await pick(page, csv('orte.csv', 'Ort,Bäckerei\nBerlin,42\n'))

  const card = cards(page)
  await expect(card.getByLabel('Zeichenkodierung')).toHaveValue('utf-8')
  await expect(card.getByRole('columnheader', { name: 'Bäckerei', exact: true })).toBeVisible()

  await card.getByLabel('Zeichenkodierung').selectOption('windows-1252')

  // 0xc3 0xa4 under the 1252 reading — only a re-decode of the original bytes
  // can produce this (AD-7); a cached string could not.
  await expect(card.getByRole('columnheader', { name: 'BÃ¤ckerei', exact: true })).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Bäckerei', exact: true })).toHaveCount(0)
})

test('an undetectable delimiter is an explicit question — answerable with Komma, the fallback value', async ({
  page,
}) => {
  await pick(page, csv('liste.csv', 'eins\nzwei\ndrei\n'))

  const card = cards(page)
  await expect(card.getByText('Trennzeichen nicht erkennbar')).toBeVisible()
  await expect(card.getByText('Ungeklärt', { exact: true })).toBeVisible()

  // While the question is open the select shows a placeholder, not the comma
  // fallback — otherwise choosing comma re-selects the displayed value, fires
  // no change event, and the question could never be answered "Komma".
  await expect(card.getByLabel('Trennzeichen')).toHaveValue('')

  await card.getByLabel('Trennzeichen').selectOption(',')

  // Answered: comma is now an explicit user correction and the question is gone.
  await expect(card.getByText('Trennzeichen nicht erkennbar')).toHaveCount(0)
  await expect(card.getByLabel('Trennzeichen')).toHaveValue(',')
})

test('rows deviating in field count are named by number in German, excluded, and inspectable raw', async ({
  page,
}) => {
  await pick(
    page,
    csv(
      'kaputt.csv',
      'Name,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln\nClara,Hamburg,30\nDora,Essen,40,extra\nEmil,Bonn,50\n',
    ),
  )

  const card = cards(page)
  // Count and row numbers, as a German sentence (AD-13).
  await expect(card.getByText('Warnung', { exact: true })).toBeVisible()
  await expect(card.getByText('Spaltenzahl (3)')).toBeVisible()
  await expect(card.getByText('Zeile 3, Zeile 5')).toBeVisible()
  // Excluded from the table: 5 data rows minus the 2 damaged ones.
  await expect(card.getByText('3 Zeilen')).toBeVisible()

  // Kept raw, never guessed into alignment (CAP-39).
  await card.getByText('Ausgeschlossene Zeilen als Rohtext').click()
  await expect(card.getByText('Bernd,Köln')).toBeVisible()
  await expect(card.getByText('Dora,Essen,40,extra')).toBeVisible()
})

test('an unclosed quote is reported as that defect, with its row', async ({ page }) => {
  await pick(page, csv('zitat.csv', 'a,b\n1,"offen\n2,3\n'))

  const card = cards(page)
  await expect(card.getByText('Fehler', { exact: true })).toBeVisible()
  await expect(card.getByText('Anführungszeichen in Zeile 2')).toBeVisible()

  // The swallowed remainder stays inspectable raw.
  await card.getByText('Ausgeschlossene Zeilen als Rohtext').click()
  await expect(card.getByText('1,"offen')).toBeVisible()
})

test('an unsupported file errors by name while the CSV beside it loads normally', async ({
  page,
}) => {
  await pick(page, [
    {
      name: 'bericht.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    csv('umsatz.csv', 'Kunde;Betrag\nBäcker;12,50\n'),
  ])

  // The error names that file (per-file isolation) …
  await expect(page.getByText('„bericht.xlsx“ hat ein nicht unterstütztes Format')).toBeVisible()

  // … and the CSV Source beside it is loaded and usable.
  const card = cards(page)
  await expect(card).toHaveCount(1)
  await expect(card.getByRole('columnheader', { name: 'Kunde', exact: true })).toBeVisible()
  await expect(card.getByLabel('Trennzeichen')).toHaveValue(';')
})

test('three files at once become three Sources, each renamable, individually removable', async ({
  page,
}) => {
  await pick(page, [
    csv('januar.csv', 'a,b\n1,2\n'),
    csv('februar.csv', 'a,b\n3,4\n'),
    csv('maerz.csv', 'a,b\n5,6\n'),
  ])

  await expect(cards(page)).toHaveCount(3)

  const februar = cards(page).filter({ hasText: 'februar.csv' })
  await februar.getByLabel('Name').fill('Februar-Bericht')
  await februar.getByLabel('Name').blur()

  // The remove button's accessible name is rendered from the store entry, so
  // finding it under the new name proves the rename command actually ran —
  // the input's own value would keep the keystrokes even with a dead handler.
  await februar.getByRole('button', { name: 'Entfernen: Februar-Bericht' }).click()
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByText('februar.csv')).toHaveCount(0)
})

test('row counts render in German conventions — 1.500 from a 1500-row fixture', async ({
  page,
}) => {
  const lines = ['Nr,Wert']
  for (let i = 1; i <= 1500; i += 1) lines.push(`${i},${i * 3}`)
  await pick(page, csv('gross.csv', lines.join('\n')))

  await expect(cards(page).getByText('1.500 Zeilen')).toBeVisible()
})

test('no raw core vocabulary reaches the screen while diagnostics are showing', async ({
  page,
}) => {
  // The static-page scan in single-file.spec.js runs with zero diagnostics
  // rendered, where a `?? code` leak is invisible. This one runs with a
  // warning, an error and an unresolved question all on screen at once.
  await pick(page, [
    csv('kaputt.csv', 'Name,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln\nClara,Hamburg,30\n'),
    csv('liste.csv', 'eins\nzwei\ndrei\n'),
    csv('zitat.csv', 'a,b\n1,"offen\n2,3\n'),
  ])
  await expect(cards(page)).toHaveCount(3)
  await expect(page.getByText('Warnung', { exact: true })).toBeVisible()
  await expect(page.getByText('Fehler', { exact: true })).toBeVisible()
  await expect(page.getByText('Ungeklärt', { exact: true })).toBeVisible()

  // Scanned with the preview grids hidden. Since Story 2 the body also holds
  // parsed cell values, and this scan looks for a `namespace.some_code` shape
  // that a cell can innocently contain — a fixture with a value like
  // `foo.bar_baz` would be reported as a leak that never happened. User data is
  // not core vocabulary. The grids are hidden rather than the text subtracted,
  // so `innerText` keeps its visibility semantics; the style is restored before
  // the evaluate returns.
  const shown = (
    await page.evaluate(() => {
      const grids = [...document.querySelectorAll('[data-testid="preview"]')]
      const before = grids.map((g) => g.style.display)
      for (const g of grids) g.style.display = 'none'
      const text = document.body.innerText
      grids.forEach((g, i) => {
        g.style.display = before[i]
      })
      return text
    })
  ).toLowerCase()
  for (const enumValue of ['info', 'warning', 'error', 'unresolved']) {
    expect(shown, `severity "${enumValue}" reached the screen untranslated`).not.toMatch(
      new RegExp(`\\b${enumValue}\\b`),
    )
  }
  expect(shown, 'a diagnostic code reached the screen instead of a sentence').not.toMatch(
    /\b[a-z]+\.[a-z]+_[a-z_]+\b/,
  )
})

test('a corrected header row re-reads: columns and row count follow', async ({ page }) => {
  await pick(
    page,
    csv(
      'bericht.csv',
      'Bericht 2024\nerstellt am 01.02.\n\nName,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln,20\n',
    ),
  )

  const card = cards(page)
  // Proposed past the preamble …
  await expect(card.getByLabel('Kopfzeile')).toHaveValue('4')
  await expect(card.getByRole('columnheader', { name: 'Ort', exact: true })).toBeVisible()
  await expect(card.getByText('2 Zeilen')).toBeVisible()

  // … and correctable: header at line 5 makes that row the columns and leaves
  // one data row.
  await card.getByLabel('Kopfzeile').fill('5')
  await card.getByLabel('Kopfzeile').blur()

  await expect(card.getByRole('columnheader', { name: 'Berlin', exact: true })).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Ort', exact: true })).toHaveCount(0)
  await expect(card.getByText('1 Zeile,')).toBeVisible()
})

test('a file dropped on the drop zone becomes a Source', async ({ page }) => {
  // The advertised gesture ("Dateien hierher ziehen"), not just the dialog: a
  // page without the drop handler would let the browser navigate to the file.
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['Ort,Wert\nBerlin,1\n'], 'gezogen.csv', { type: 'text/csv' }))
    return dt
  })
  await page.getByTestId('drop-zone').dispatchEvent('drop', { dataTransfer })

  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByText('gezogen.csv')).toBeVisible()
  await expect(cards(page).getByRole('columnheader', { name: 'Ort', exact: true })).toBeVisible()
})

test('BOM-less UTF-16 surfaces the NUL question and the override resolves it', async ({
  page,
}) => {
  // ASCII in BOM-less UTF-16LE is valid UTF-8, so the ladder cannot see the
  // trap — the unresolved question and the override list are the answer.
  await pick(page, csv('roh.csv', Buffer.from('Ort,Wert\nBerlin,1\n', 'utf16le')))

  const card = cards(page)
  await expect(card.getByText('Null-Zeichen')).toBeVisible()
  await expect(card.getByText('Ungeklärt', { exact: true })).toBeVisible()

  await card.getByLabel('Zeichenkodierung').selectOption('utf-16le')

  await expect(card.getByText('Null-Zeichen')).toHaveCount(0)
  await expect(card.getByRole('columnheader', { name: 'Ort', exact: true })).toBeVisible()
  await expect(card.getByText('1 Zeile,')).toBeVisible()
})
