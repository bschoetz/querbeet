// The fixture generator. Run: `node tests/fixtures/generate.mjs`
//
// WHY THESE FILES ARE COMMITTED RATHER THAN BUILT AT TEST TIME. Every other
// fixture in this repo is written by `write-excel-file` or `hyparquet-writer`
// inside the test that reads it, which is the better arrangement when it is
// possible: the shape under test is stated in the test itself. These five are
// the ones neither writer can produce at all. Committing the bytes *and* this
// script answers the only real objection to a checked-in binary — that nobody
// can see what is inside it or make another one.
//
// WHAT EACH FILE IS, AND WHAT MADE IT.
//
//   parquet-int96-timestamp.parquet              pyarrow 25.0.0
//     One INT96 timestamp column (the legacy Impala/older-Spark encoding) and
//     one UTF8 column. pyarrow writes INT96 only behind
//     `use_deprecated_int96_timestamps=True`; no JavaScript writer emits it.
//
//   parquet-decimal-fixed-len-byte-array.parquet pyarrow 25.0.0
//     `decimal128(38, 2)`. The physical backing of a DECIMAL follows its
//     precision — <= 9 is INT32, <= 18 INT64, beyond that FIXED_LEN_BYTE_ARRAY —
//     and `hyparquet-writer` supports only the two integer backings.
//
//   parquet-duplicate-column-name.parquet        pyarrow 25.0.0
//     Two top-level columns both named `Betrag`, one INT64 and one UTF8. Legal
//     Parquet, and unwritable with `hyparquet-writer`, which resolves its
//     `columnData` against the schema by name. The differing physical types are
//     deliberate: a reader that confuses the two is caught by the values.
//
//   xlsx-password-protected.xlsx                 LibreOffice 25.x via UNO
//     A real OOXML-encrypted workbook, password `geheim`. Not a zip at all — an
//     encrypted workbook is a CFB container starting `D0 CF 11 E0`. Verified
//     encrypted and decryptable with `msoffcrypto-tool` when it was made.
//     LibreOffice's `--convert-to` filter options silently ignore a password for
//     xlsx; the UNO media descriptor is the route that works.
//
//   xlsx-zero-sheets.xlsx                        this script, via fflate
//     A workbook whose `xl/workbook.xml` declares `<sheets/>` — no sheet at all.
//     Built by unzipping an ordinary workbook, rewriting that one element and
//     rezipping. Excel will not produce one; it exists to exercise the reader's
//     empty-workbook branch, and what it actually proves is recorded in the
//     test that reads it.
//
// PREREQUISITES, and they are deliberately not project dependencies:
//   * pyarrow, in a throwaway venv — `pip install` is PEP-668-blocked system
//     wide on this machine, so: `python3 -m venv /tmp/qb && /tmp/qb/bin/pip
//     install pyarrow`, then point PYARROW_PYTHON at /tmp/qb/bin/python.
//   * a system `python3` carrying the `uno` module (ships with LibreOffice) and
//     `soffice` on PATH.
//   * `fflate`, used here only, and reached through `read-excel-file`'s own
//     dependency rather than added to package.json. If that ever stops being
//     true this script needs its own install line; nothing shipped depends on it.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import writeXlsxFile from 'write-excel-file/node'

const OUT = dirname(fileURLToPath(import.meta.url))
const PYARROW_PYTHON = process.env.PYARROW_PYTHON ?? '/tmp/qb/bin/python'
const SYSTEM_PYTHON = process.env.SYSTEM_PYTHON ?? 'python3'

const run = (what, interpreter, mode) => {
  try {
    execFileSync(interpreter, [join(OUT, 'generate.py'), mode, OUT], { stdio: 'inherit' })
  } catch (failure) {
    console.error(`\n${what} failed (${interpreter}). See the prerequisites at the top.\n`, failure.message)
    process.exitCode = 1
  }
}

run('Parquet fixtures', PYARROW_PYTHON, 'parquet')
run('Password-protected workbook', SYSTEM_PYTHON, 'protected-xlsx')

// The zero-sheet workbook. Written here rather than in Python because the whole
// operation is three lines against a zip, and because it is the one fixture that
// starts from a workbook this repo's own writer produced.
{
  const writer = await writeXlsxFile(
    [[{ value: 'Kunde', type: String }], [{ value: 'Anna', type: String }]],
    { sheet: 'Umsatz' },
  )
  const buffer = await writer.toBuffer()
  const entries = unzipSync(new Uint8Array(buffer))
  const workbook = strFromU8(entries['xl/workbook.xml'])
  if (!/<sheets>/.test(workbook)) throw new Error('no <sheets> element to strip — writer changed')
  entries['xl/workbook.xml'] = strToU8(workbook.replace(/<sheets>.*?<\/sheets>/s, '<sheets/>'))
  writeFileSync(join(OUT, 'xlsx-zero-sheets.xlsx'), zipSync(entries))
  console.log('generate.mjs: xlsx-zero-sheets.xlsx done')
}

for (const name of [
  'parquet-int96-timestamp.parquet',
  'parquet-decimal-fixed-len-byte-array.parquet',
  'parquet-duplicate-column-name.parquet',
  'xlsx-password-protected.xlsx',
  'xlsx-zero-sheets.xlsx',
]) {
  const path = join(OUT, name)
  const state = existsSync(path) ? `${readFileSync(path).byteLength} bytes` : 'MISSING'
  console.log(`  ${name.padEnd(46)} ${state}`)
}
