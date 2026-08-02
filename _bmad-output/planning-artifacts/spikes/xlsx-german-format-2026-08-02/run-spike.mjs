// Spike: do write-excel-file's format codes render as German decimal commas in a
// real German Excel? (PRD open question 6, CAP-36.)
//
// The question cannot be fully answered without a German Excel, but most of it can
// be settled before anyone opens anything. Two halves:
//
//   1. Machine-checkable here — what does the library actually write into
//      xl/styles.xml, does the file round-trip, and are the cell types real numbers
//      and dates rather than strings? A format code on a string formats nothing.
//   2. Human-checkable in Excel — which of the competing format-code strategies
//      renders as 1.234,56 and which does not.
//
// The output workbook is laid out so the human half is one look: every row states
// what it is testing and what the correct rendering would be.

import { writeFile } from 'node:fs/promises'
import writeXlsxFile from 'write-excel-file/node'
import readXlsxFile from 'read-excel-file/node'

const OUT = 'german-format-probe.xlsx'
const N = 1234.56
const BIG = 1234567.891
const NEG = -1234.56
const D = new Date(Date.UTC(2025, 11, 31)) // 31.12.2025

const header = (t) => ({ value: t, fontWeight: 'bold' })

// Each case: what it tests, the format code handed to the library, the value, and
// what a German Excel must show if the strategy is the right one.
const CASES = [
  ['N1', 'Number, locale-neutral code', '#,##0.00', N, '1.234,56'],
  ['N2', 'Number, German-looking literal code', '#.##0,00', N, '1.234,56 — expected to be WRONG'],
  ['N3', 'Number, explicit German locale prefix', '[$-407]#,##0.00', N, '1.234,56'],
  ['N4', 'Number, no format at all (General)', undefined, N, '1234,56 (no grouping)'],
  ['N5', 'Thousands, locale-neutral code', '#,##0.00', BIG, '1.234.567,89'],
  ['N6', 'Negative, locale-neutral code', '#,##0.00', NEG, '-1.234,56'],
  ['N7', 'Euro currency, locale-neutral code', '#,##0.00\\ "€"', N, '1.234,56 €'],
]

const DATE_CASES = [
  ['D1', 'Date, lowercase code', 'dd.mm.yyyy', D, '31.12.2025'],
  ['D2', 'Date, uppercase code', 'DD.MM.YYYY', D, '31.12.2025'],
  ['D3', 'Date, explicit German locale prefix', '[$-407]dd.mm.yyyy', D, '31.12.2025'],
  ['D4', 'Date, ISO code', 'yyyy-mm-dd', D, '2025-12-31'],
]

const rows = [
  [header('ID'), header('Was geprüft wird'), header('Formatcode'), header('Wert'), header('Erwartet in DE-Excel')],
]

for (const [id, what, format, value, expect] of CASES) {
  rows.push([
    { value: id },
    { value: what },
    { value: format ?? '(keiner)' },
    { value, type: Number, ...(format ? { format } : {}) },
    { value: expect },
  ])
}

for (const [id, what, format, value, expect] of DATE_CASES) {
  rows.push([
    { value: id },
    { value: what },
    { value: format },
    { value, type: Date, format },
    { value: expect },
  ])
}

// The two claims CAP-36 makes beyond number formatting.
rows.push([
  { value: 'T1' },
  { value: 'Führende Null bleibt Text' },
  { value: '(Text)' },
  { value: '0123', type: String },
  { value: '0123 — nicht 123' },
])
rows.push([
  { value: 'T2' },
  { value: 'Umlaute und Eurozeichen' },
  { value: '(Text)' },
  { value: 'Größenmaß Äöü ß — 12,50 €', type: String },
  { value: 'unverändert' },
])

// write-excel-file v4 changed this: the call returns { toBuffer, toStream, toFile }
// rather than accepting a filePath option, as v1 and v2 did. Recorded because the
// TableWriter adapter will hit the same edge, and in the browser it is toBuffer.
await writeXlsxFile(rows, { sheet: 'Formatprobe' }).toFile(OUT)

// ---------------------------------------------------------------- machine half

const zip = await import('node:child_process')
const styles = zip.execSync(`unzip -p ${OUT} xl/styles.xml`).toString()
const numFmts = [...styles.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map(
  (m) => ({ id: m[1], code: m[2] }),
)

console.log('\n=== what the library actually wrote into xl/styles.xml ===')
if (numFmts.length === 0) console.log('  (none — the library used only built-in numFmtIds)')
for (const { id, code } of numFmts) console.log(`  numFmtId ${id.padEnd(4)} formatCode  ${code}`)

// read-excel-file 9.3.5 returns [{ sheet, data }] here, not a flat grid. Recorded
// for the adapter, and it cost this spike a false green: the first version indexed
// the wrapper as if it were rows, got an empty set, and every "all cases pass"
// check passed vacuously.
const read = await readXlsxFile(OUT)
const grid = Array.isArray(read[0]) ? read : read[0].data
const body = grid.slice(1)

console.log('\n=== round-trip through read-excel-file: value and JS type per case ===')
for (const r of body) {
  const v = r[3]
  const t = v instanceof Date ? 'Date' : typeof v
  const shown = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  console.log(`  ${String(r[0]).padEnd(4)} ${t.padEnd(7)} ${shown}`)
}

const numeric = body.filter((r) => String(r[0]).startsWith('N'))
const dates = body.filter((r) => String(r[0]).startsWith('D'))
const badNum = numeric.filter((r) => typeof r[3] !== 'number')
const badDate = dates.filter((r) => !(r[3] instanceof Date))
const leadingZero = body.find((r) => r[0] === 'T1')?.[3]
const text = body.find((r) => r[0] === 'T2')?.[3]

// Every verdict states the population it ran over. An "all of them passed" that
// cannot say how many is the same sentence whether the answer is 7 or 0.
const all = (label, set, bad) =>
  console.log(
    `  ${label.padEnd(34)} ${set.length === 0 ? 'NO EVIDENCE — empty set' : bad.length === 0 ? `YES (${set.length}/${set.length})` : `NO — ${bad.map((r) => r[0]).join(', ')}`}`,
  )

console.log('\n=== verdicts the machine can give ===')
console.log(`  cases read back:                   ${body.length} (expected 13)`)
all('every N case is a real number:', numeric, badNum)
all('every D case is a real date:', dates, badDate)
console.log(
  `  leading zero survived as text:     ${leadingZero === '0123' ? 'YES' : `NO — got ${JSON.stringify(leadingZero)}`}`,
)
console.log(
  `  umlauts and euro sign survived:    ${typeof text === 'string' && text.includes('Größenmaß') && text.includes('€') ? 'YES' : `NO — got ${JSON.stringify(text)}`}`,
)
console.log(`\nWrote ${OUT}. Open it in a German Excel and read the last two columns against each other.`)

await writeFile(
  'styles.xml',
  styles.replace(/></g, '>\n<'),
  'utf8',
)
