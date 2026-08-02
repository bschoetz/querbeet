// Story 2 — the Source preview, against the built artefact from file:// (AD-27),
// both engines. What is under test is the AD-24 promise in its user-visible
// form: the counts are the Source's totals while the DOM holds a bounded window
// of rows, and the rows the user scrolls to are the file's real rows.
//
// Fixture bytes are built inline, as in csv-sources.spec.js: CP1252 needs exact
// bytes, and a fixture file on disk carries whatever encoding an editor last
// saved it as — the exact ambiguity these tests exist to pin down.
//
// The clamp above ~571,000 rows is NOT tested here and cannot affordably be: the
// fixture alone would be half a gigabyte of CSV and the run would be measuring
// the generator. The geometry that guards it is proven in
// core/view/row-window.test.js, where the threshold is a number rather than a
// file. That gap is deliberate and stated.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const CP1252 = { 'ä': 0xe4, 'ö': 0xf6, 'ü': 0xfc, 'ß': 0xdf }

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

const csv = (name, content) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
})

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const cards = (page) => page.getByTestId('source-card')
const previewRows = (page) => page.getByTestId('preview-row')

/** A CSV with `n` data rows, whose values are unmistakably per-row. */
function generated(n, name = 'gross.csv', factor = 3) {
  const lines = ['Nr,Wert']
  for (let i = 1; i <= n; i += 1) lines.push(`${i},${i * factor}`)
  return csv(name, lines.join('\n'))
}

// The two AD-24 constants, restated here because this suite tests the built
// artefact from outside and cannot import from core/. A change to either that
// forgets this file should fail here rather than pass quietly.
const ROW_HEIGHT_PX = 28
const WINDOW_SIZE = 50

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

test('cell values reach the screen — the header row carries the column names', async ({ page }) => {
  await pick(page, csv('umsatz.csv', 'Kunde;Ort;Betrag\nBäcker Müller;Köln;1200,50\n'))

  const card = cards(page)
  await expect(card.getByRole('columnheader', { name: 'Kunde', exact: true })).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Betrag', exact: true })).toBeVisible()

  // The point of the story: a value, not just a name (CAP-8).
  await expect(card.getByRole('cell', { name: 'Bäcker Müller', exact: true })).toBeVisible()
  await expect(card.getByRole('cell', { name: '1200,50', exact: true })).toBeVisible()

  // Raw text exactly as parsed — no trimming, no typing, no thousands separator
  // applied to a value. Typing is Step zero, Story 3.
  await expect(card.getByRole('cell', { name: '1.200,50', exact: true })).toHaveCount(0)
})

test('the counts are the Source totals while the DOM holds a bounded window', async ({ page }) => {
  await pick(page, generated(1500))

  const card = cards(page)
  // German conventions, and both totals (CAP-8): 1.500 rows, 2 columns.
  await expect(card.getByText('1.500 Zeilen, 2 Spalten')).toBeVisible()

  // … and the window is bounded regardless (AD-24). Written as a ceiling
  // because the exact window size is the mechanism's to choose, while
  // "not 1,500" is the property that must hold.
  const rendered = await previewRows(page).count()
  expect(rendered, 'the preview rendered the whole table instead of a window').toBeLessThanOrEqual(
    WINDOW_SIZE,
  )
  expect(rendered, 'the preview rendered no rows at all').toBeGreaterThan(0)

  // The viewport must stay under the window, and this is the only place that
  // can check it. The window starts at the first visible row and extends
  // downward only, so a container taller than WINDOW_SIZE rows renders a blank
  // band below the data while the scrollbar says there is more — and every
  // other assertion in this suite would still pass. The height lives in a
  // stylesheet, which is exactly where it would drift unobserved.
  const clientHeight = await page.getByTestId('preview').evaluate((el) => el.clientHeight)
  expect(
    clientHeight,
    'the preview viewport is taller than the row window can fill',
  ).toBeLessThanOrEqual(WINDOW_SIZE * ROW_HEIGHT_PX)

  // The first row rendered is the file's first row, cell for cell.
  await expect(previewRows(page).first().getByRole('cell')).toHaveText(['1', '3'])
  // A row far past the window is genuinely absent, not merely off-screen.
  await expect(card.getByRole('cell', { name: '900', exact: true })).toHaveCount(0)

  // The grid tells assistive technology the Source's totals too, not the
  // window's: 1,500 data rows plus the header row, and row 1 of the file
  // carries table coordinate 2.
  await expect(card.getByRole('table')).toHaveAttribute('aria-rowcount', '1501')
  await expect(previewRows(page).first()).toHaveAttribute('aria-rowindex', '2')
})

test('scrolled to the bottom, the window shows the last rows of the parsed table', async ({
  page,
}) => {
  await pick(page, generated(1500))

  const card = cards(page)
  await expect(card.getByRole('cell', { name: '1', exact: true })).toBeVisible()

  // The scrollbar describes the whole table: its extent is the spacers, not the
  // rendered rows, so scrolling to the end reaches row 1,500.
  const extent = await page.getByTestId('preview').evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollHeight
  })
  expect(
    extent,
    'the scroll extent describes the window rather than the table',
  ).toBeGreaterThanOrEqual(1500 * ROW_HEIGHT_PX)

  // Row 1,500 is `1500,4500` — a value pair that exists nowhere else in the
  // fixture, so finding it proves the window really moved to the end.
  await expect(card.getByRole('cell', { name: '1500', exact: true })).toBeVisible()
  await expect(card.getByRole('cell', { name: '4500', exact: true })).toBeVisible()
  // … and the first rows left the DOM, which is what "windowed" means.
  await expect(card.getByRole('cell', { name: '1', exact: true })).toHaveCount(0)

  // The last row is row 1,500 of the file in table coordinates, so a screen
  // reader at the end of the grid is told where it actually is.
  await expect(previewRows(page).last()).toHaveAttribute('aria-rowindex', '1501')

  const rendered = await previewRows(page).count()
  expect(rendered, 'the window grew while scrolling').toBeLessThanOrEqual(WINDOW_SIZE)

  // The counts never described the window (AD-24).
  await expect(card.getByText('1.500 Zeilen, 2 Spalten')).toBeVisible()
})

test('the fixed row height keeps the window aligned with the scrollbar mid-scroll', async ({
  page,
}) => {
  await pick(page, generated(1500))
  await expect(previewRows(page).first()).toBeVisible()

  // The 28 px row is load-bearing, not cosmetic: every offset the geometry
  // computes is a multiple of it, so a row one pixel taller drifts the window
  // away from the rows the user is looking at — further with every screen
  // scrolled, and invisibly, because the rows shown are still real rows.
  // Measured rather than assumed, because two independent things can break it:
  // a UA stylesheet gives a table cell 1 px of padding (this project omits
  // Tailwind's preflight), and a height written in rem is a browser font-size
  // setting away from not being 28 px at all.
  const heights = await previewRows(page).evaluateAll((rows) => [
    ...new Set(rows.map((r) => r.getBoundingClientRect().height)),
  ])
  expect(heights, 'a preview row is not exactly one ROW_HEIGHT_PX tall').toEqual([ROW_HEIGHT_PX])

  // 700 rows down the scrollbar, the window shows row 701 — not row 690-something.
  await page.getByTestId('preview').evaluate((el, rowHeight) => {
    el.scrollTop = 700 * rowHeight
  }, ROW_HEIGHT_PX)
  await expect(previewRows(page).first().getByRole('cell')).toHaveText(['701', '2103'])
  await expect(previewRows(page).last().getByRole('cell')).toHaveText(['750', '2250'])
  await expect(previewRows(page).first()).toHaveAttribute('aria-rowindex', '702')
})

test('the row height survives a browser font size that is not 16 px', async ({ page }) => {
  // A row height written as a Tailwind spacing utility is 1.75rem. This project
  // omits preflight and sets no root font size, so `h-7` is 28 px only for a
  // user who never touched their browser's default text size — and for everyone
  // else the geometry silently divides by a number the page does not use. The
  // rows are therefore sized in px, and this is what says so.
  await page.addStyleTag({ content: 'html { font-size: 20px }' })
  await pick(page, generated(1500))
  await expect(previewRows(page).first()).toBeVisible()

  const heights = await previewRows(page).evaluateAll((rows) => [
    ...new Set(rows.map((r) => r.getBoundingClientRect().height)),
  ])
  expect(heights, 'the row height follows the root font size instead of the constant').toEqual([
    ROW_HEIGHT_PX,
  ])

  // And the window still lands where the scrollbar says it does.
  await page.getByTestId('preview').evaluate((el, rowHeight) => {
    el.scrollTop = 700 * rowHeight
  }, ROW_HEIGHT_PX)
  await expect(previewRows(page).first().getByRole('cell')).toHaveText(['701', '2103'])
})

test('an encoding override re-reads the bytes and the previewed cell values change', async ({
  page,
}) => {
  // The umlaut sits in a *cell*, not in a column name: the preview is what is
  // under test, and a header-only assertion would pass with no cells rendered.
  await pick(page, csv('orte.csv', 'Ort,Betrieb\nKöln,Bäckerei Süß\n'))

  const card = cards(page)
  await expect(card.getByLabel('Zeichenkodierung')).toHaveValue('utf-8')
  await expect(card.getByRole('cell', { name: 'Bäckerei Süß', exact: true })).toBeVisible()

  await card.getByLabel('Zeichenkodierung').selectOption('windows-1252')

  // The 1252 reading of the UTF-8 bytes. Only a re-decode of the retained bytes
  // (AD-7) reaching the preview can produce this — a cached slice could not.
  await expect(card.getByRole('cell', { name: 'BÃ¤ckerei SÃ¼ÃŸ', exact: true })).toBeVisible()
  await expect(card.getByRole('cell', { name: 'Bäckerei Süß', exact: true })).toHaveCount(0)
})

test('a CP1252 file previews its cells correctly without any override', async ({ page }) => {
  await pick(page, csv('kunden.csv', cp1252('Kunde;Ort\nMüller;Köln\nSchröder;Lübeck\n')))

  const card = cards(page)
  await expect(card.getByRole('cell', { name: 'Müller', exact: true })).toBeVisible()
  await expect(card.getByRole('cell', { name: 'Lübeck', exact: true })).toBeVisible()
})

test('a corrected header row shifts the preview header and its rows', async ({ page }) => {
  await pick(
    page,
    csv(
      'bericht.csv',
      'Bericht 2024\nerstellt am 01.02.\n\nName,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln,20\n',
    ),
  )

  const card = cards(page)
  // Proposed past the preamble: the header row carries the names, the two data
  // rows carry values, and the preamble lines are in neither.
  await expect(card.getByLabel('Kopfzeile')).toHaveValue('4')
  await expect(card.getByRole('columnheader', { name: 'Ort', exact: true })).toBeVisible()
  await expect(previewRows(page)).toHaveCount(2)
  await expect(card.getByRole('cell', { name: 'Berlin', exact: true })).toBeVisible()
  await expect(card.getByRole('cell', { name: 'Bericht 2024', exact: true })).toHaveCount(0)
  await expect(card.getByText('2 Zeilen, 3 Spalten')).toBeVisible()

  // Header one line later: that row becomes the names and leaves one data row.
  await card.getByLabel('Kopfzeile').fill('5')
  await card.getByLabel('Kopfzeile').blur()

  await expect(card.getByRole('columnheader', { name: 'Berlin', exact: true })).toBeVisible()
  await expect(card.getByRole('columnheader', { name: 'Ort', exact: true })).toHaveCount(0)
  await expect(previewRows(page)).toHaveCount(1)
  await expect(card.getByRole('cell', { name: 'Köln', exact: true })).toBeVisible()
  await expect(card.getByText('1 Zeile, 3 Spalten')).toBeVisible()

  // Header on the last line: columns remain, no data row is left, and the grid
  // says so in German rather than rendering an unexplained empty body.
  await card.getByLabel('Kopfzeile').fill('6')
  await card.getByLabel('Kopfzeile').blur()

  await expect(card.getByText('0 Zeilen, 3 Spalten')).toBeVisible()
  await expect(previewRows(page)).toHaveCount(0)
  await expect(card.getByText('Keine Datenzeilen')).toBeVisible()
})

test('a Source of one row and one column counts in the German singular', async ({ page }) => {
  // "1 Zeilen, 1 Spalten" is what a plural-only counts line produces, and it is
  // the shape a German reader notices first (AD-13). The damage sentences in
  // this pane already decline correctly; the counts line did not.
  await pick(page, csv('einzel.csv', 'Ort\nBerlin\n'))

  const card = cards(page)
  await expect(card.getByText('1 Zeile, 1 Spalte')).toBeVisible()
  await expect(card.getByText('Zeilen')).toHaveCount(0)
  await expect(card.getByText('Spalten')).toHaveCount(0)
})

test('the preview sits below the correction controls, not above them', async ({ page }) => {
  // Order is the whole point of the placement: the knobs that correct the read
  // come first, the grid is the payoff you look at once they are right. Above
  // them, a ~310 px scroll region per card pushed the controls a screen apart
  // on a three-Source pane. Asserted geometrically, since a reader sees
  // position rather than DOM order.
  await pick(page, generated(200))

  const card = cards(page)
  const header = await card.getByLabel('Kopfzeile').boundingBox()
  const grid = await card.getByTestId('preview').boundingBox()

  expect(grid.y, 'the preview moved back above the correction controls').toBeGreaterThan(header.y)
})

test('an empty Source reads 0 Zeilen and shows a German empty state instead of a grid', async ({
  page,
}) => {
  await pick(page, csv('leer.csv', '\n\n'))

  const card = cards(page)
  await expect(card.getByText('0 Zeilen, 0 Spalten')).toBeVisible()
  await expect(card.getByTestId('preview')).toHaveCount(0)
  await expect(card.getByTestId('preview-empty')).toBeVisible()
  await expect(card.getByText('Nichts anzuzeigen')).toBeVisible()
})

test('removing a Source takes its preview with it and leaves the others working', async ({
  page,
}) => {
  // What this test does NOT check, stated plainly so nobody trusts it for it:
  // it cannot observe an orphaned scroll listener. Vue binds the handler from
  // the template and removes it on unmount, and a listener that somehow
  // outlived its component would be bound to a detached node nothing scrolls —
  // unobservable from here by construction. Proving that would need a
  // component-test envelope this project does not have.
  //
  // What it does check is the I/O-matrix row — the preview disappears with its
  // card — plus the part that could really break: after a removal re-projects
  // the whole list, the *surviving* preview is still wired to its own table,
  // not to the removed one's rows or to a stale window.
  await pick(page, [generated(200, 'gross.csv'), generated(200, 'klein.csv', 7)])

  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByTestId('preview')).toHaveCount(2)

  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.getByRole('button', { name: 'Entfernen: gross' }).click()

  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByTestId('preview')).toHaveCount(1)
  await expect(page.getByText('gross.csv')).toHaveCount(0)

  // The survivor is klein.csv, whose Wert column is i×7 — a value the removed
  // Source never held, so a preview still projecting the old table shows it.
  const survivor = cards(page)
  await expect(survivor.getByText('klein.csv')).toBeVisible()
  await expect(previewRows(page).first().getByRole('cell')).toHaveText(['1', '7'])

  // … and its own scroll handler still updates its own window.
  await page.getByTestId('preview').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(previewRows(page).last().getByRole('cell')).toHaveText(['200', '1400'])
  await expect(previewRows(page).last()).toHaveAttribute('aria-rowindex', '201')

  expect(pageErrors, 'removing a Source threw').toEqual([])
  expect(consoleErrors, 'removing a Source logged an error').toEqual([])
})

test('the page controls stay hidden below the clamp — the common case is plain scrolling', async ({
  page,
}) => {
  await pick(page, generated(1500))

  await expect(cards(page).getByTestId('preview-pages')).toHaveCount(0)
})

test('damaged rows stay out of the preview and inspectable in the report', async ({ page }) => {
  await pick(
    page,
    csv('kaputt.csv', 'Name,Ort,Betrag\nAnna,Berlin,10\nBernd,Köln\nClara,Hamburg,30\n'),
  )

  const card = cards(page)
  await expect(card.getByText('2 Zeilen, 3 Spalten')).toBeVisible()
  await expect(previewRows(page)).toHaveCount(2)
  await expect(card.getByRole('cell', { name: 'Anna', exact: true })).toBeVisible()
  await expect(card.getByRole('cell', { name: 'Bernd', exact: true })).toHaveCount(0)

  await card.getByText('Ausgeschlossene Zeilen als Rohtext').click()
  await expect(card.getByText('Bernd,Köln')).toBeVisible()
})
