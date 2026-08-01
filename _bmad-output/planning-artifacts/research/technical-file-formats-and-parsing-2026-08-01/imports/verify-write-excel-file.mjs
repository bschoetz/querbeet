// Verification: does write-excel-file 4.1.1 produce a German-office-grade xlsx?
// Checks umlauts, real numbers, real dates, German number-format codes, bold header,
// column widths, and 100k-row scale + timing.
//
// NOTE: in 4.1.1 the Node entry returns a writer object {toBuffer, toStream, toFile};
// the README's documented `filePath` option is accepted and SILENTLY IGNORED.
import writeXlsxFile from 'write-excel-file/node'
import { writeFileSync } from 'node:fs'

const HEADER = [
  { value: 'Kostenstelle', fontWeight: 'bold' },
  { value: 'Bezeichnung', fontWeight: 'bold' },
  { value: 'Betrag (€)', fontWeight: 'bold' },
  { value: 'Menge', fontWeight: 'bold' },
  { value: 'Buchungsdatum', fontWeight: 'bold' },
]

const toRow = (r) => [
  { value: r[0], type: String },
  { value: r[1], type: String },
  { value: r[2], type: Number, format: '#,##0.00' },
  { value: r[3], type: Number, format: '#,##0' },
  { value: r[4], type: Date, format: 'dd.mm.yyyy' },
]

const smallRows = [
  ['0123', 'Bürobedarf Süd', 1234.56, 5, new Date(Date.UTC(2025, 11, 31))],
  ['0456', 'Möbel & Zubehör', -987.5, 10, new Date(Date.UTC(2026, 0, 15))],
  ['0789', 'Straßenreinigung', 1234567.89, 3, new Date(Date.UTC(2026, 6, 1))],
]

const columns = [{ width: 14 }, { width: 28 }, { width: 16 }, { width: 10 }, { width: 16 }]
const HERE = new URL('.', import.meta.url).pathname

// --- silent no-op check ---------------------------------------------------
const probe = await writeXlsxFile([HEADER, ...smallRows.map(toRow)], {
  columns, sheet: 'Report', filePath: HERE + 'should-not-exist.xlsx',
})
console.log('return value keys with filePath option:', Object.keys(probe))

// --- small German file ----------------------------------------------------
const small = await writeXlsxFile([HEADER, ...smallRows.map(toRow)], { columns, sheet: 'Report' })
writeFileSync(HERE + 'german-small.xlsx', await small.toBuffer())
console.log('wrote german-small.xlsx')

// --- scale ----------------------------------------------------------------
const N = 100_000
const big = []
for (let i = 0; i < N; i++) {
  big.push(toRow([
    String(i % 10000).padStart(4, '0'),
    `Posten Nr. ${i} — Größe/Maß`,
    (i * 7.13) % 100000,
    i % 97,
    new Date(Date.UTC(2025, i % 12, (i % 28) + 1)),
  ]))
}

const before = process.memoryUsage().heapUsed
const t0 = process.hrtime.bigint()
const writer = await writeXlsxFile([HEADER, ...big], { columns, sheet: 'Report' })
const buf = await writer.toBuffer()
const t1 = process.hrtime.bigint()
const after = process.memoryUsage().heapUsed

writeFileSync(HERE + 'german-100k.xlsx', buf)
console.log(`100k rows: ${(Number(t1 - t0) / 1e6).toFixed(0)} ms, output ${buf.length} bytes, heap delta ${((after - before) / 1048576).toFixed(1)} MB`)
