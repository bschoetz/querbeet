// Story 4 — XLSX and Parquet Sources, against the built artefact from file://
// (AD-27), both engines. Everything here drives the real UI: the file dialog,
// the selects, the German sentences.
//
// Two things this suite exists for that no unit test can reach.
//
//   THE WORKER PATH. `read-excel-file` hands archives over 512 KB to fflate's
//   asynchronous unzipper, which constructs a classic Worker from a blob URL
//   built out of strings inlined in the bundle. That is the one worker shape
//   measured to survive a `file://` page in both engines (AD-15), and it is a
//   property of the *built artefact* in a *real browser* — Node never takes
//   that branch. The large fixture below is what makes it take it.
//
//   THE NATIVE RE-READ. A sheet switch re-reads the retained bytes (AD-7). The
//   native domains and the annotations follow their columns by name, and the
//   confirmation does not — a confirmation carried across would be a person
//   vouching for values they never saw.
//
// Fixtures are generated here rather than committed: an `.xlsx` is a zip and a
// `.parquet` is a binary, and neither is readable in a diff, while what every
// case turns on is which type a cell was written as.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import writeXlsxFile from 'write-excel-file/node'
import { parquetWriteBuffer } from 'hyparquet-writer'
import { parquetMetadata } from 'hyparquet'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const s = (value) => ({ value, type: String })
const n = (value) => ({ value, type: Number })
const b = (value) => ({ value, type: Boolean })
const d = (value) => ({ value, type: Date, format: 'dd.mm.yyyy' })
const dt = (value) => ({ value, type: Date, format: 'dd.mm.yyyy hh:mm' })
const utc = (...parts) => new Date(Date.UTC(...parts))

/** A workbook file for `setInputFiles`, from `[{ name, rows }]`. */
async function xlsx(fileName, sheets) {
  const writer = await writeXlsxFile(sheets.map(({ name, rows }) => ({ data: rows, sheet: name })))
  const buffer = await writer.toBuffer()
  return { name: fileName, mimeType: 'application/vnd.ms-excel', buffer }
}

const parquet = (fileName, columnData, schema) => ({
  name: fileName,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(parquetWriteBuffer(schema ? { columnData, schema } : { columnData })),
})

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const cards = (page) => page.getByTestId('source-card')

/** One column's row in the Step zero panel — a hit rate is a per-column claim. */
const columnRow = (page, name) =>
  page.getByTestId('typing-column').filter({ hasText: new RegExp(`^${name}`) })

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

test('a workbook arrives pre-typed, with no locale question and no parse controls it cannot answer', async ({
  page,
}) => {
  await pick(
    page,
    await xlsx('bericht.xlsx', [
      {
        name: 'Umsatz',
        rows: [
          [s('Kunde'), s('Betrag'), s('Datum'), s('Erfasst'), s('Aktiv')],
          [s('Anna'), n(1234.5), d(utc(2025, 7, 1)), dt(utc(2025, 7, 1, 14, 30)), b(true)],
          [s('Bernd'), n(80), d(utc(2024, 1, 29)), dt(utc(2024, 1, 29, 9, 5)), b(false)],
        ],
      },
    ]),
  )

  const card = cards(page)
  await expect(card.getByTestId('source-counts')).toContainText('2 Zeilen, 5 Spalten')

  // Four columns the format typed: no select, a German word, and the type is
  // the one the map promises.
  const native = card.getByTestId('typing-native')
  await expect(native).toHaveText([
    'Vom Format vorgegeben: Zahl',
    'Vom Format vorgegeben: Datum',
    'Vom Format vorgegeben: Zeitstempel',
    'Vom Format vorgegeben: Wahrheitswert',
  ])
  await expect(card.getByLabel('Typ: Betrag')).toHaveCount(0)
  await expect(card.getByLabel('Lesart: Betrag')).toHaveCount(0)

  // The one string column still gets the full question.
  await expect(card.getByLabel('Typ: Kunde')).toHaveValue('text')

  // Binary Sources have no encoding and no delimiter to choose; a workbook does
  // have a header row.
  await expect(card.getByLabel('Zeichenkodierung')).toHaveCount(0)
  await expect(card.getByLabel('Trennzeichen')).toHaveCount(0)
  await expect(card.getByLabel('Kopfzeile')).toHaveValue('1')

  // Pre-typed, settled, and confirmable in one press.
  await card.getByRole('button', { name: 'Typen bestätigen: bericht' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
})

test('a German number stored as text is still a locale question', async ({ page }) => {
  // The normal office case: the column is formatted as text in the sheet, so
  // Excel hands over strings and the format decided nothing.
  await pick(
    page,
    await xlsx('text.xlsx', [
      { name: 'Blatt', rows: [[s('Betrag')], [s('1.234,56')], [s('80,00')]] },
    ]),
  )

  const card = cards(page)
  await expect(card.getByLabel('Typ: Betrag')).toHaveValue('number')
  await expect(card.getByLabel('Lesart: Betrag')).toHaveValue('de-DE')
})

test('a stray string in a native number column is counted, not waved through', async ({ page }) => {
  // AD-20: the confirmation gate must not degrade into a rubber stamp for the
  // natively typed formats. `k.A.` is an absence; `x` is a value that cannot be
  // read under the column's own type, and the card says so in German.
  await pick(
    page,
    await xlsx('gemischt.xlsx', [
      { name: 'Blatt', rows: [[s('Menge')], [n(12)], [s('k.A.')], [s('x')], [n(7)]] },
    ]),
  )

  const card = cards(page)
  await expect(card.getByTestId('typing-native')).toHaveText('Vom Format vorgegeben: Zahl')
  await expect(columnRow(page, 'Menge').getByTestId('typing-hitrate')).toHaveText(
    '2 von 3 Werten lesbar, 1 leer',
  )
  await expect(card).toContainText(
    'Spalte „Menge“: ein Wert von 3 lässt sich unter dem gewählten Typ nicht lesen.',
  )
})

test('a sheet switch re-reads the file: the domain and the note survive, the confirmation does not', async ({
  page,
}) => {
  await pick(
    page,
    await xlsx('mehrblatt.xlsx', [
      { name: 'Umsatz', rows: [[s('Menge')], [n(12)], [n(7)]] },
      { name: 'Kosten', rows: [[s('Menge'), s('Position')], [n(3)], [n(4), s('Miete')]] },
      { name: 'Notizen', rows: [[s('Text')], [s('nichts')]] },
    ]),
  )

  const card = cards(page)
  const sheet = card.getByLabel('Tabellenblatt')

  // The first sheet is proposed and the others are on offer.
  await expect(sheet).toHaveValue('Umsatz')
  await expect(sheet.locator('option')).toHaveText(['Umsatz', 'Kosten', 'Notizen'])

  await card.getByLabel('Notiz: Menge').fill('Stück, nicht Kilo')
  await card.getByLabel('Notiz: Menge').blur()
  await card.getByRole('button', { name: 'Typen bestätigen: mehrblatt' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')

  await sheet.selectOption('Kosten')

  // A different sheet is a different table — two columns now, and one of them
  // did not exist a moment ago.
  await expect(card.getByTestId('source-counts')).toContainText('2 Zeilen, 2 Spalten')
  // The domain survived by name, so `Menge` is still typed by its format …
  await expect(card.getByTestId('typing-native').first()).toHaveText('Vom Format vorgegeben: Zahl')
  // … and so did the sentence someone wrote about it.
  await expect(card.getByLabel('Notiz: Menge')).toHaveValue('Stück, nicht Kilo')
  // The confirmation did not: every value in the table just changed.
  await expect(card.getByTestId('typing')).toContainText('Typen noch nicht bestätigt.')
})

test('a Parquet file arrives typed by its schema, with nothing to correct', async ({ page }) => {
  await pick(
    page,
    parquet(
      'umsatz.parquet',
      [
        { name: 'Auftrag', data: [9007199254740993n, 12n, null], type: 'INT64' },
        { name: 'Betrag', data: [1234.5, null, 80], type: 'DOUBLE' },
        { name: 'Kunde', data: ['Anna', 'Bernd', null], type: 'STRING' },
        { name: 'Erfasst', data: [utc(2025, 7, 1, 14, 30), null, utc(2024, 1, 29)], type: 'TIMESTAMP' },
        { name: 'Aktiv', data: [true, false, null], type: 'BOOLEAN' },
      ],
    ),
  )

  const card = cards(page)
  await expect(card.getByTestId('source-counts')).toContainText('3 Zeilen, 5 Spalten')

  // The schema is authoritative: no encoding, no delimiter, no header row, no
  // sheet — there is nothing here for a person to correct.
  await expect(card.getByLabel('Zeichenkodierung')).toHaveCount(0)
  await expect(card.getByLabel('Trennzeichen')).toHaveCount(0)
  await expect(card.getByLabel('Kopfzeile')).toHaveCount(0)
  await expect(card.getByLabel('Tabellenblatt')).toHaveCount(0)

  await expect(card.getByTestId('typing-native')).toHaveText([
    'Vom Format vorgegeben: Zahl',
    'Vom Format vorgegeben: Zahl',
    'Vom Format vorgegeben: Zeitstempel',
    'Vom Format vorgegeben: Wahrheitswert',
  ])
  await expect(card.getByLabel('Typ: Kunde')).toHaveValue('text')

  // The 19-digit order number keeps its exact digits in the preview and is
  // reported as unreadable rather than quietly rounded (C-10).
  await expect(card.getByTestId('preview')).toContainText('9007199254740993')
  await expect(columnRow(page, 'Auftrag').getByTestId('typing-hitrate')).toHaveText(
    '1 von 2 Werten lesbar, 1 leer',
  )
  await expect(card).toContainText(
    'Spalte „Auftrag“: ein Wert von 2 lässt sich unter dem gewählten Typ nicht lesen.',
  )
})

test('a Parquet type querbeet cannot convert is named, and read as text', async ({ page }) => {
  // TIME, INTERVAL and DECIMAL come out of real files. A column declared with a
  // type word nothing downstream knows must never reach a confirmed typing.
  await pick(
    page,
    parquet('zeiten.parquet', [{ name: 'Dauer', data: [1000, 2000, null] }], [
      { name: 'root', num_children: 1 },
      { name: 'Dauer', type: 'INT32', converted_type: 'TIME_MILLIS', repetition_type: 'OPTIONAL' },
    ]),
  )

  const card = cards(page)
  await expect(card).toContainText('Spalte „Dauer“ hat den Parquet-Typ TIME_MILLIS')
  await expect(card.getByLabel('Typ: Dauer')).toHaveValue('number')
  await expect(card.getByTestId('typing-native')).toHaveCount(0)
})

test('a decimal amount reaches the screen as the amount, not as a float artefact', async ({
  page,
}) => {
  // hyparquet returns a DECIMAL already multiplied in floating point: unscaled
  // `123456789` at scale 2 arrives as `1234567.8900000001`. Written out as it
  // came, that is a wrong amount on the card that the canonical sweep accepts,
  // which is the C-10 failure this whole product exists to avoid.
  await pick(
    page,
    parquet('preise.parquet', [{ name: 'Preis', data: [1234567.89, 0.05, -123.45] }], [
      { name: 'root', num_children: 1 },
      {
        name: 'Preis',
        type: 'INT64',
        converted_type: 'DECIMAL',
        scale: 2,
        precision: 18,
        repetition_type: 'OPTIONAL',
      },
    ]),
  )

  const card = cards(page)
  const preview = card.getByTestId('preview')
  await expect(preview).toContainText('1234567.89')
  await expect(preview).not.toContainText('1234567.8900000001')
  await expect(card.getByTestId('typing-native')).toHaveText('Vom Format vorgegeben: Zahl')
  // Every value readable under its own type — no warning, because nothing was lost.
  await expect(columnRow(page, 'Preis').getByTestId('typing-hitrate')).toHaveText(
    '3 von 3 Werten lesbar',
  )
  await card.getByRole('button', { name: 'Typen bestätigen: preise' }).click()
  await expect(card.getByTestId('typing')).toContainText('Typen bestätigt.')
})

test('a snappy Parquet decompresses in the built artefact — the inlined WASM path', async ({
  page,
}) => {
  // THE ONE TEST THAT CAN PROVE THIS, AND WHY A VITEST CASE CANNOT.
  //
  // `hyparquet-compressors` decompresses snappy through `hysnappy`, whose WASM
  // is base64-inlined and compiled with a *synchronous* `new
  // WebAssembly.Module`. Chrome refuses that above 4,096 bytes on the main
  // thread and the module is 3,458 — 638 bytes of margin. A Vitest case would
  // pass under Node whatever Chrome does with it, and the dev server would pass
  // too; the failure would appear only in the shipped artefact opened by
  // double-click, which is the exact class of silent build-time failure AD-18
  // exists for. So the proof is the built file, from file://, in both engines,
  // asserting cells rather than the absence of an error.
  //
  // `hyparquet-writer` compresses with snappy by default, and the codec is
  // asserted below rather than assumed.
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  const written = parquetWriteBuffer({
    codec: 'SNAPPY',
    columnData: [
      { name: 'Kunde', data: ['Bäcker Müller', 'Metzger Öz', 'Straßenreinigung'], type: 'STRING' },
      { name: 'Betrag', data: [1234.5, -0.25, 80], type: 'DOUBLE' },
    ],
  })
  expect(parquetMetadata(written).row_groups[0].columns[0].meta_data.codec).toBe('SNAPPY')

  await pick(page, {
    name: 'gepackt.parquet',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(written),
  })

  const card = cards(page)
  await expect(card.getByTestId('source-counts')).toContainText('3 Zeilen, 2 Spalten')

  // The cells themselves: WASM that failed to instantiate would leave an
  // unreadable Source, and WASM that decompressed wrongly would leave rubbish.
  const preview = card.getByTestId('preview')
  await expect(preview).toContainText('Bäcker Müller')
  await expect(preview).toContainText('Straßenreinigung')
  await expect(preview).toContainText('1234.5')
  await expect(card.getByTestId('typing-native')).toHaveText('Vom Format vorgegeben: Zahl')
  expect(errors).toEqual([])
})

test('a gzip Parquet is read now, where it used to be refused', async ({ page }) => {
  // The codec the dependency was taken for: gzip is an ordinary default across
  // the Spark, pandas and DuckDB ecosystems, and before this it produced a
  // refusal naming three diagnoses that were all wrong.
  await pick(page, {
    name: 'gzip.parquet',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      parquetWriteBuffer({
        codec: 'GZIP',
        compressors: { GZIP: (bytes) => new Uint8Array(gzipSync(bytes)) },
        columnData: [
          { name: 'Kunde', data: ['Anna', 'Bernd'], type: 'STRING' },
          { name: 'Betrag', data: [1.5, 80], type: 'DOUBLE' },
        ],
      }),
    ),
  })

  const card = cards(page)
  await expect(card.getByTestId('source-counts')).toContainText('2 Zeilen, 2 Spalten')
  await expect(card.getByTestId('preview')).toContainText('Anna')
  await expect(page.getByText('ist mit dem Verfahren')).toHaveCount(0)
})

test('a compression querbeet still cannot unpack says so, instead of calling the file broken', async ({
  page,
}) => {
  // LZO is what is left after the compressors package: the generic refusal
  // offers three diagnoses — damaged, password-protected, wrong format — and
  // for a valid LZO Parquet all three are wrong and none is actionable.
  await pick(page, {
    name: 'lzo.parquet',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      parquetWriteBuffer({
        columnData: [{ name: 'a', data: [1], type: 'INT32' }],
        codec: 'LZO',
        compressors: { LZO: (bytes) => bytes },
      }),
    ),
  })

  await expect(cards(page)).toHaveCount(0)
  await expect(page.getByText('ist mit dem Verfahren LZO komprimiert')).toBeVisible()
  await expect(page.getByText('Die Datei ist in Ordnung')).toBeVisible()
  await expect(page.getByText('beschädigt, passwortgeschützt')).toHaveCount(0)
})

test('a corrupt file makes no Source and leaves the loaded ones alone', async ({ page }) => {
  await pick(page, await xlsx('gut.xlsx', [{ name: 'Blatt', rows: [[s('Kunde')], [s('Anna')]] }]))
  await expect(cards(page)).toHaveCount(1)

  await pick(page, [
    { name: 'kaputt.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK nope') },
    { name: 'kaputt.parquet', mimeType: 'application/octet-stream', buffer: Buffer.alloc(64) },
    { name: 'alt.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') },
  ])

  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByText('„kaputt.xlsx“ konnte nicht gelesen werden')).toBeVisible()
  await expect(page.getByText('„kaputt.parquet“ konnte nicht gelesen werden')).toBeVisible()
  // Legacy Excel formats stay refused by name: neither library can open one.
  await expect(page.getByText('„alt.xls“ hat ein nicht unterstütztes Format')).toBeVisible()
})

test('a workbook over 512 KB loads from file:// — the fflate worker path', async ({ page }) => {
  // The branch this exists for: over 512 KB `read-excel-file` unzips through
  // fflate's asynchronous unzipper, which constructs a classic Worker from a
  // blob URL. querbeet creates no worker of its own here (AD-15); what is under
  // test is that a dependency's does survive an opaque origin, in both engines.
  test.slow()

  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  // Identify the worker, do not merely count one. A bare count is green for any
  // blob worker at all — including the bundled-but-unreached `worker-f` the
  // build also carries — and it cannot tell the intended path from fflate's own
  // fallback to the synchronous unzipper, which it takes whenever an archive
  // compresses poorly. So the Blob handed to `createObjectURL` is kept and its
  // source read back: fflate builds its worker from a string inlined in the
  // bundle, and that string is what proves which code went off-thread.
  //
  // This also holds AD-15 to its word from the outside: every worker on the page
  // is a classic script from a blob URL, and none of them is querbeet's.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const nativeCreate = URL.createObjectURL.bind(URL)
    const sources = new Map()

    window.__workers = []
    URL.createObjectURL = (blob) => {
      const url = nativeCreate(blob)
      if (blob instanceof Blob) sources.set(url, blob.text())
      return url
    }
    window.Worker = class extends NativeWorker {
      constructor(url, options, ...rest) {
        const href = String(url)
        window.__workers.push({
          url: href,
          type: options?.type ?? 'classic',
          source: sources.get(href) ?? Promise.resolve(''),
        })
        super(url, options, ...rest)
      }
    }
    window.__workerReport = async () =>
      Promise.all(
        window.__workers.map(async (worker) => ({
          url: worker.url,
          type: worker.type,
          source: await worker.source,
        })),
      )
  })
  // `addInitScript` applies from the next navigation on, and `beforeEach`
  // already loaded the page.
  await page.goto(ARTIFACT_URL)

  const rows = [[s('Kunde'), s('Betrag'), s('Datum')]]
  for (let i = 0; i < 40_000; i += 1) {
    rows.push([
      s(`Kunde ${i} Musterfirma`),
      n(i + 0.5),
      d(utc(2025, 0, 1 + (i % 365))),
    ])
  }
  const file = await xlsx('gross.xlsx', [{ name: 'Umsatz', rows }])
  expect(file.buffer.byteLength).toBeGreaterThan(512 * 1024)

  // The bound is deliberately loose, and the looseness is the point. The
  // measurement behind this path is 326–373 ms in Chromium for these 40,001
  // rows; asserting anything near that would fail on a loaded CI runner, on
  // Firefox, and on a laptop that decided to index something. What a ceiling
  // has to catch is a *regression in kind* — the worker path silently falling
  // back to the main-thread unzipper, a per-row re-parse creeping into the type
  // sweep, an accidental O(n²) — and every one of those costs an order of
  // magnitude, not a fifth. Eight seconds is roughly twenty times the measured
  // figure and still an order of magnitude under the 30 s a bare timeout allows.
  const started = Date.now()
  await pick(page, file)

  const card = cards(page)
  await expect(card.getByTestId('source-counts')).toContainText('40.000 Zeilen, 3 Spalten', {
    timeout: 30_000,
  })
  expect(Date.now() - started).toBeLessThan(8_000)
  await expect(card.getByTestId('typing-native')).toHaveText([
    'Vom Format vorgegeben: Zahl',
    'Vom Format vorgegeben: Datum',
  ])
  expect(errors).toEqual([])

  const workers = await page.evaluate(() => window.__workerReport())

  // Every worker on the page is a classic script from a blob URL — the one form
  // measured to survive an opaque origin in both engines (AD-15).
  expect(workers.length).toBeGreaterThan(0)
  expect(workers.every((w) => w.url.startsWith('blob:'))).toBe(true)
  expect(workers.every((w) => w.type === 'classic')).toBe(true)

  // And at least one of them is fflate's own inflate worker, not some other
  // blob worker that happened to be constructed. Two markers, both chosen
  // because a minifier cannot rename them: `$e$` is the key fflate wraps a
  // worker-side error in, and the two-stage `onmessage` that copies `e.data`
  // onto `self` is its bootstrap. Were fflate to fall back to the synchronous
  // unzipper — which it does whenever an archive compresses poorly — no such
  // worker would exist and this would fail rather than pass on a bare count.
  const inflaters = workers.filter((w) => w.source.includes('$e$') && w.source.includes('onmessage'))
  expect(
    inflaters.length,
    `no fflate worker among ${workers.length}: ${workers.map((w) => w.source.slice(0, 120)).join(' | ')}`,
  ).toBeGreaterThan(0)
})
