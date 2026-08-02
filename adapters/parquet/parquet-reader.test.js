// The Parquet reader against real file bytes, under Vitest with no browser
// (AD-27). Fixtures are written here with `hyparquet-writer` (a devDependency)
// rather than committed as binaries — the schema is the thing every case turns
// on, and in a hand-written schema it is readable in the diff.
//
// Where a case needs a type the writer's convenience API cannot express — DATE,
// TIME, a real LIST — the whole flat schema is handed over instead. That is the
// only way to produce the columns this reader has to refuse, and refusing them
// is the point: Parquet carries more types than querbeet has conversions for.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { parquetWriteBuffer } from 'hyparquet-writer'
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { detectColumn } from '@core/types/typing.js'
import { parquetReader } from './parquet-reader.js'

const file = (columnData, schema, over = {}) =>
  parquetWriteBuffer({ columnData, ...(schema ? { schema } : {}), ...over })
const read = (bytes) => parquetReader.read(bytes)

const byName = (table, name) => table.columns.find((c) => c.name === name)
const codes = (result) => result.diagnostics.map((x) => [x.severity, x.code])
const utc = (...parts) => new Date(Date.UTC(...parts))

describe('the type map', () => {
  it('reads the whole sweep, and counts a null as an absence rather than a value', async () => {
    const result = await read(
      file([
        { name: 'id', data: [1n, 2n, null], type: 'INT64' },
        { name: 'wert', data: [1.5, null, -0.25], type: 'DOUBLE' },
        { name: 'name', data: ['Anna', 'Bernd', null], type: 'STRING' },
        { name: 'erfasst', data: [utc(2025, 7, 1, 14, 30), null, utc(1970, 0, 1)], type: 'TIMESTAMP' },
        { name: 'aktiv', data: [true, false, null], type: 'BOOLEAN' },
      ]),
    )

    expect(result.table.columns.map((c) => [c.name, c.domain])).toEqual([
      ['id', 'native:number'],
      ['wert', 'native:number'],
      ['name', 'text'],
      ['erfasst', 'native:datetime'],
      ['aktiv', 'native:boolean'],
    ])

    // Every cell is canonical text; a null is `''`, which the default missing
    // tokens already read as an absence.
    expect(byName(result.table, 'id').cells).toEqual(['1', '2', ''])
    expect(byName(result.table, 'wert').cells).toEqual(['1.5', '', '-0.25'])
    expect(byName(result.table, 'erfasst').cells).toEqual([
      '2025-08-01T14:30:00.000Z',
      '',
      '1970-01-01T00:00:00.000Z',
    ])
    expect(byName(result.table, 'aktiv').cells).toEqual(['true', 'false', ''])
    expect(result.table.rowCount).toBe(3)
    expect(codes(result)).toEqual([])
  })

  it('reads a DATE column as a calendar day, not an epoch offset', async () => {
    const result = await read(
      file([{ name: 'tag', data: [20301, 19782, null] }], [
        { name: 'root', num_children: 1 },
        { name: 'tag', type: 'INT32', converted_type: 'DATE', repetition_type: 'OPTIONAL' },
      ]),
    )

    expect(byName(result.table, 'tag')).toMatchObject({ domain: 'native:date' })
    expect(byName(result.table, 'tag').cells).toEqual(['2025-08-01', '2024-02-29', ''])
  })

  const decimalFile = (data, scale = 2, precision = 18) =>
    file([{ name: 'preis', data }], [
      { name: 'root', num_children: 1 },
      {
        name: 'preis',
        type: 'INT64',
        converted_type: 'DECIMAL',
        scale,
        precision,
        repetition_type: 'OPTIONAL',
      },
    ])

  it('recovers a DECIMAL from its declared scale rather than trusting the double', async () => {
    // hyparquet computes `parseDecimal(bytes) * 10 ** -scale` in floating point.
    // Measured, an unscaled `123456789` at scale 2 comes back as
    // `1234567.8900000001` — and that *round-trips*, so writing it out as it
    // arrives puts a wrong amount on the screen that the canonical sweep
    // accepts. The three values the first version of this test used
    // (`123.45`, `67.89`, `0`) all happen to survive the multiply, so the suite
    // certified the corruption.
    const result = await read(decimalFile([1234567.89, 123.45, 0.05, -123.45, 0, null]))

    expect(byName(result.table, 'preis')).toMatchObject({ domain: 'native:number' })
    expect(byName(result.table, 'preis').cells).toEqual([
      '1234567.89',
      '123.45',
      '0.05',
      '-123.45',
      '0',
      '',
    ])
    expect(codes(result)).toEqual([])
  })

  it('writes every recovered DECIMAL in a form its own type can read', async () => {
    // A trailing zero is not part of a shortest round-trip decimal, so `12.30`
    // would be counted unparsed under the column's own type — a defect that
    // looks like a finding.
    const result = await read(decimalFile([12.3, 12, 0.1]))

    expect(byName(result.table, 'preis').cells).toEqual(['12.3', '12', '0.1'])
    for (const cell of byName(result.table, 'preis').cells) {
      expect(String(Number(cell))).toBe(cell)
    }
  })

  it('does not invent digits for a DECIMAL past 2^53, and says so', async () => {
    // The unscaled integer is beyond what a double can hold, so the figure was
    // lost before this adapter saw it. The cell carries the double's own exact
    // expansion — everything that arrived, nothing added — which fails the
    // canonical round trip and is therefore counted unparsed, the same
    // discipline as an oversized INT64.
    // Written through `Number` because the literal itself is past what a double
    // can hold — which is the whole point of the case.
    const result = await read(decimalFile([Number('99999999999999.99'), 1.5]))
    const cells = byName(result.table, 'preis').cells

    expect(cells[0]).toBe('99999999999999.984375')
    expect(String(Number(cells[0]))).not.toBe(cells[0]) // the sweep will reject it
    expect(cells[1]).toBe('1.5') // its neighbour is unaffected

    expect(codes(result)).toEqual([['warning', 'parquet.decimal_precision']])
    expect(result.diagnostics[0].values).toEqual({ column: 'preis', values: 1 })
  })

  it('keeps an INT64 past 2^53 digit for digit', async () => {
    // The reader writes the exact digits; the sweep in core/types is what names
    // them as unreadable. Rounding them here would be the silent loss C-10 is
    // about, dressed as a clean read.
    const result = await read(
      file([{ name: 'auftrag', data: [9007199254740993n, 1n, -9007199254740993n], type: 'INT64' }]),
    )

    expect(byName(result.table, 'auftrag').cells).toEqual([
      '9007199254740993',
      '1',
      '-9007199254740993',
    ])
  })
})

describe('the types querbeet has no conversion for', () => {
  it('degrades an INTERVAL to text with a warning instead of losing the file', async () => {
    // hyparquet throws `parquet interval not supported` *during the row read*,
    // so a file carrying one INTERVAL column would fail entirely — one column
    // costing a Source, against this reader's own rule. The column is
    // identified from the schema and left out of the read.
    const result = await read(
      file(
        [
          { name: 'id', data: [1, 2] },
          { name: 'dauer', data: [new Uint8Array(12), new Uint8Array(12)] },
          { name: 'name', data: ['Anna', 'Bernd'] },
        ],
        [
          { name: 'root', num_children: 3 },
          { name: 'id', type: 'INT32', repetition_type: 'OPTIONAL' },
          {
            name: 'dauer',
            type: 'FIXED_LEN_BYTE_ARRAY',
            type_length: 12,
            converted_type: 'INTERVAL',
            repetition_type: 'OPTIONAL',
          },
          { name: 'name', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
        ],
      ),
    )

    // Everything else in the file is read in full, and the table stays
    // rectangular: the unreadable column contributes an empty cell per row.
    expect(result.table.columns.map((c) => [c.name, c.domain])).toEqual([
      ['id', 'native:number'],
      ['dauer', 'text'],
      ['name', 'text'],
    ])
    expect(result.table.columns[0].cells).toEqual(['1', '2'])
    expect(result.table.columns[1].cells).toEqual(['', ''])
    expect(result.table.columns[2].cells).toEqual(['Anna', 'Bernd'])
    expect(result.table.rowCount).toBe(2)

    expect(codes(result)).toEqual([['warning', 'parquet.unreadable_column']])
    expect(result.diagnostics[0].values).toEqual({ column: 'dauer', type: 'INTERVAL' })
  })

  it('does the same for a BSON column', async () => {
    const result = await read(
      file([{ name: 'roh', data: [new Uint8Array([1, 2, 3])] }], [
        { name: 'root', num_children: 1 },
        { name: 'roh', type: 'BYTE_ARRAY', converted_type: 'BSON', repetition_type: 'OPTIONAL' },
      ]),
    )

    expect(result.table.columns[0]).toMatchObject({ name: 'roh', domain: 'text' })
    expect(result.table.columns[0].cells).toEqual([''])
    expect(codes(result)).toEqual([['warning', 'parquet.unreadable_column']])
  })

  it('reads a TIME column as text and names the Parquet type', async () => {
    // TIME, INTERVAL, INT96 and friends come out of real files. Declaring one
    // `native:time` would carry a word nothing downstream knows through a
    // confirmed typing and into story 6.
    const result = await read(
      file([{ name: 'dauer', data: [1000, 2000, null] }], [
        { name: 'root', num_children: 1 },
        { name: 'dauer', type: 'INT32', converted_type: 'TIME_MILLIS', repetition_type: 'OPTIONAL' },
      ]),
    )

    expect(byName(result.table, 'dauer').domain).toBe('text')
    expect(codes(result)).toEqual([['warning', 'parquet.unsupported_type']])
    expect(result.diagnostics[0].values).toEqual({ column: 'dauer', type: 'TIME_MILLIS' })
  })

  it('reads a nested column as compact JSON, one warning for the column', async () => {
    // Flattening a LIST, a MAP or a STRUCT into columns is story 17's
    // vocabulary. What this owes it meanwhile is a cell that keeps every byte.
    const result = await read(
      file(
        [
          { name: 'id', data: [1, 2, 3] },
          { name: 'positionen', data: [[1, 2], [3], null] },
        ],
        [
          { name: 'root', num_children: 2 },
          { name: 'id', type: 'INT32', repetition_type: 'OPTIONAL' },
          {
            name: 'positionen',
            repetition_type: 'OPTIONAL',
            converted_type: 'LIST',
            num_children: 1,
          },
          { name: 'list', repetition_type: 'REPEATED', num_children: 1 },
          { name: 'element', type: 'INT32', repetition_type: 'OPTIONAL' },
        ],
      ),
    )

    // The nested subtree is one column, not three: the walk skips what a group
    // owns, however deep it nests.
    expect(result.table.columns.map((c) => c.name)).toEqual(['id', 'positionen'])
    expect(byName(result.table, 'positionen').domain).toBe('text')
    expect(byName(result.table, 'positionen').cells).toEqual(['[1,2]', '[3]', ''])
    expect(codes(result)).toEqual([['warning', 'parquet.nested_column']])
    expect(result.diagnostics[0].values).toEqual({ column: 'positionen' })
  })

  it('reads a STRUCT and a MAP the same way, one warning naming each column', async () => {
    // The matrix row names LIST *and* STRUCT and says one warning **per
    // column**. With a single nested column in the fixture, a reader that
    // emitted one warning per file would have passed the case above green.
    const result = await read(
      file(
        [
          { name: 'id', data: [1, 2] },
          { name: 'adresse', data: [{ ort: 'Kiel', plz: 24103 }, { ort: 'Ulm', plz: null }] },
          { name: 'attribute', data: [{ farbe: 1 }, { groesse: 2 }] },
        ],
        [
          { name: 'root', num_children: 3 },
          { name: 'id', type: 'INT32', repetition_type: 'OPTIONAL' },
          // A STRUCT: a group with two ordinary leaves under it.
          { name: 'adresse', repetition_type: 'OPTIONAL', num_children: 2 },
          { name: 'ort', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
          { name: 'plz', type: 'INT32', repetition_type: 'OPTIONAL' },
          // A MAP: a group over a repeated key/value pair.
          { name: 'attribute', repetition_type: 'OPTIONAL', converted_type: 'MAP', num_children: 1 },
          { name: 'key_value', repetition_type: 'REPEATED', num_children: 2 },
          { name: 'key', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
          { name: 'value', type: 'INT32', repetition_type: 'OPTIONAL' },
        ],
      ),
    )

    // Three top-level columns out of nine schema elements: the walk skips each
    // group's whole subtree, and the leaves inside are not columns of their own.
    expect(result.table.columns.map((c) => [c.name, c.domain])).toEqual([
      ['id', 'native:number'],
      ['adresse', 'text'],
      ['attribute', 'text'],
    ])
    expect(result.table.columns[1].cells).toEqual([
      '{"ort":"Kiel","plz":24103}',
      '{"ort":"Ulm","plz":null}',
    ])
    expect(result.table.columns[2].cells).toEqual(['{"farbe":1}', '{"groesse":2}'])

    // One warning per nested column, each naming its own.
    expect(codes(result)).toEqual([
      ['warning', 'parquet.nested_column'],
      ['warning', 'parquet.nested_column'],
    ])
    expect(result.diagnostics.map((d) => d.values.column)).toEqual(['adresse', 'attribute'])
  })
})

describe('the edges of a file', () => {
  it('gives a zero-row file its columns from the schema, and nothing else', async () => {
    const result = await read(
      file([
        { name: 'kunde', data: [], type: 'STRING' },
        { name: 'betrag', data: [], type: 'DOUBLE' },
      ]),
    )

    expect(result.table.columns.map((c) => [c.name, c.domain])).toEqual([
      ['kunde', 'text'],
      ['betrag', 'native:number'],
    ])
    expect(result.table.rowCount).toBe(0)
    expect(result.table.columns.every((c) => c.cells.length === 0)).toBe(true)
  })

  it('throws on bad magic or a truncated footer, so the store can refuse the Source', async () => {
    await expect(read(new Uint8Array(16).buffer)).rejects.toThrow()

    const good = file([{ name: 'a', data: [1], type: 'INT32' }])
    await expect(read(good.slice(0, good.byteLength - 8))).rejects.toThrow()
  })

  it('has no parse decision to propose — the schema is the answer', async () => {
    const result = await read(file([{ name: 'a', data: [1], type: 'INT32' }]))

    expect(result.proposal).toEqual({})
    expect(result.damage).toEqual({ mismatches: [], unclosedQuoteRow: null })
    expect(Object.isFrozen(result.table.columns[0].cells)).toBe(true)
  })

  it('keeps distinct column names in schema order, addressed by position', async () => {
    const buffer = file([
      { name: 'Betrag', data: [1n, 2n], type: 'INT64' },
      { name: 'Kunde', data: ['Anna', 'Bernd'], type: 'STRING' },
    ])

    const result = await read(buffer)
    expect(result.table.columns.map((c) => c.name)).toEqual(['Betrag', 'Kunde'])
    expect(result.table.columns[0].cells).toEqual(['1', '2'])
    expect(result.table.columns[1].cells).toEqual(['Anna', 'Bernd'])
  })

  it('reports the file’s own height, not column zero’s', async () => {
    // A schema with no top-level children still has rows under it, and a card
    // that reported 0 would be describing the schema rather than the file.
    const empty = file([])
    const result = await read(empty)

    expect(result.table.columns).toEqual([])
    expect(result.table.rowCount).toBe(0)
  })

  it('names a number that is not one', async () => {
    // `Infinity` and `NaN` are legal doubles. They fail the canonical sweep, and
    // the sentence the sweep produces is the one meant for a stray string —
    // this says what they actually are.
    const result = await read(
      file([{ name: 'quote', data: [Infinity, 1.5, NaN, -Infinity], type: 'DOUBLE' }]),
    )

    expect(result.table.columns[0].cells).toEqual(['Infinity', '1.5', 'NaN', '-Infinity'])
    expect(codes(result)).toEqual([['warning', 'parquet.non_finite_number']])
    expect(result.diagnostics[0].values).toEqual({ column: 'quote', values: 3 })
  })

  it('names the sub-millisecond digits a timestamp loses', async () => {
    // A `Date` holds milliseconds, so MICROS and NANOS are already gone by the
    // time the value reaches this adapter. INT64 precision loss got a test, a
    // warning and a matrix row; this one had nothing.
    const result = await read(
      file([{ name: 'erfasst', data: [1n, 2n] }], [
        { name: 'root', num_children: 1 },
        {
          name: 'erfasst',
          type: 'INT64',
          converted_type: 'TIMESTAMP_MICROS',
          repetition_type: 'OPTIONAL',
        },
      ]),
    )

    expect(result.table.columns[0].domain).toBe('native:datetime')
    expect(codes(result)).toEqual([['warning', 'parquet.timestamp_precision']])
    expect(result.diagnostics[0].values).toEqual({ column: 'erfasst', unit: 'MICROS' })
  })

  it('names a compression codec it cannot unpack, instead of calling the file corrupt', async () => {
    // Still the honest answer, and no longer a wrong one. Before
    // `hyparquet-compressors` this branch caught GZIP and ZSTD — ordinary
    // defaults across the Spark, pandas and DuckDB ecosystems — and told the
    // user their perfectly good file was "damaged, password-protected, or not
    // the format its extension claims". Those are read now; what is left for it
    // is LZO and whatever the format adds next, which is what the branch is for.
    const lzo = file([{ name: 'a', data: [1], type: 'INT32' }], undefined, {
      codec: 'LZO',
      compressors: { LZO: (bytes) => bytes },
    })

    await expect(read(lzo)).rejects.toMatchObject({
      code: 'parquet.unsupported_codec',
      values: { codec: 'LZO' },
    })
  })
})

describe('the shapes hyparquet-writer cannot write', () => {
  // Real files under `tests/fixtures/`, made by pyarrow 25.0.0 and reproducible
  // with `node tests/fixtures/generate.mjs` — which says what each one contains.
  // These three were carried in the ledger as "unreachable" on the strength of
  // the *writer's* limits; the bytes always could exist, and now do. Two of the
  // three behaved better than the ledger feared. The third was a live defect.
  const fixture = (name) => {
    const bytes = readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }

  it('reads an INT96 timestamp as a datetime, at the instant the file holds', async () => {
    // The ledger's `risk:` note said INT96 would fall through `compactJson` into
    // a natively typed column and count 100 % unparsed. Measured against the
    // real file, it does not: hyparquet's default parsers turn INT96 into a
    // `Date`, so the mapping and the canonicalization both hold.
    const result = await read(fixture('parquet-int96-timestamp.parquet'))

    expect(result.table.columns.map((c) => [c.name, c.domain])).toEqual([
      ['Erfasst', 'native:datetime'],
      ['Kunde', 'text'],
    ])
    expect(byName(result.table, 'Erfasst').cells).toEqual([
      '2025-08-01T14:30:00.000Z',
      '',
      '2024-02-29T00:00:00.000Z',
    ])
    expect(result.table.rowCount).toBe(3)
    expect(codes(result)).toEqual([])

    // …and the column is genuinely readable under its own type, which is the
    // half the ledger was most worried about.
    const swept = detectColumn(byName(result.table, 'Erfasst').cells, { domain: 'native:datetime' })
    expect(swept.counts).toMatchObject({ missing: 1, parsed: 2, unparsed: 0 })
  })

  it('reads a DECIMAL backed by a byte array as the amount it holds', async () => {
    // `decimal128(38, 2)` is stored as FIXED_LEN_BYTE_ARRAY, the backing
    // `hyparquet-writer` cannot emit. hyparquet still hands over the multiplied
    // double, so the same scale recovery applies and the same float artefact
    // would appear without it — `1234567.8900000001` is what arrives.
    const result = await read(fixture('parquet-decimal-fixed-len-byte-array.parquet'))

    expect(byName(result.table, 'Preis')).toMatchObject({ domain: 'native:number' })
    expect(byName(result.table, 'Preis').cells).toEqual(['1234567.89', '-0.05', ''])
    expect(codes(result)).toEqual([])

    const swept = detectColumn(byName(result.table, 'Preis').cells, { domain: 'native:number' })
    expect(swept.counts).toMatchObject({ missing: 1, parsed: 2, unparsed: 0 })
  })

  it('refuses a repeated column name rather than showing one column’s values under another’s header', async () => {
    // THE DEFECT THIS FIXTURE FOUND. `rowgroup.js` maps an array slot back to a
    // column with `findIndex(c => c.pathInSchema[0] === name)`, which answers
    // with the *first* match for both duplicates. Measured against the real
    // file, the second `Betrag` — a UTF8 column of `brutto`/`netto` — came back
    // holding the INT64 column's `1`/`2`, silently, under its own header. That
    // is the plausible-table-from-a-damaged-file failure the product exists to
    // refuse, and array rows had been documented as the cure for it.
    //
    // There is no by-position accessor in hyparquet's public API, so neither
    // column is read. Blanking both rather than keeping the first is deliberate:
    // first-wins is an implementation detail, and two columns of one name *and*
    // one physical type would be indistinguishable anyway.
    const result = await read(fixture('parquet-duplicate-column-name.parquet'))

    expect(result.table.columns.map((c) => c.name)).toEqual(['Betrag', 'Betrag'])
    expect(result.table.columns[0].cells).toEqual(['', ''])
    expect(result.table.columns[1].cells).toEqual(['', ''])
    // Emphatically not `['1','2']` in the second column, which is what shipped
    // before this fixture existed.
    expect(result.table.columns[1].cells).not.toContain('1')
    expect(result.table.rowCount).toBe(2)

    expect(codes(result)).toEqual([['warning', 'parquet.duplicate_column_name']])
    expect(result.diagnostics[0].values).toEqual({ column: 'Betrag', columns: 2 })
  })

  it('reads every other column of a file that has a repeated name in it', async () => {
    // The refusal is per column, not per file — the same rule INTERVAL follows.
    const buffer = file([
      { name: 'Kunde', data: ['Anna', 'Bernd'], type: 'STRING' },
      { name: 'Betrag', data: [1n, 2n], type: 'INT64' },
    ])
    const withDuplicate = await read(fixture('parquet-duplicate-column-name.parquet'))
    const withoutDuplicate = await read(buffer)

    expect(withDuplicate.diagnostics).toHaveLength(1)
    expect(withoutDuplicate.diagnostics).toHaveLength(0)
    expect(withoutDuplicate.table.columns[0].cells).toEqual(['Anna', 'Bernd'])
  })

  it('is still keyed by name in hyparquet’s object rows, which is why array rows were chosen', async () => {
    // The original reason for `parquetRead` over `parquetReadObjects`, now
    // measured on a file that actually has the duplicate: object rows lose one
    // of the two columns outright rather than duplicating the other.
    const objects = await parquetReadObjects({
      file: fixture('parquet-duplicate-column-name.parquet'),
      compressors,
    })

    expect(Object.keys(objects[0])).toEqual(['Betrag'])
  })
})

describe('compression', () => {
  // Approved as an Ask First on 2026-08-02: `hyparquet-compressors` supplies
  // GZIP, BROTLI, ZSTD, LZ4 and LZ4_RAW, and replaces hyparquet's pure-JS snappy
  // with `hysnappy`'s WASM one.
  //
  // FOUR OF THE SIX CODECS ARE FIXTURES HERE, AND THE OTHER TWO CANNOT BE.
  // `hyparquet-writer` compresses with a *synchronous* function the caller
  // supplies, and Node's own `zlib` provides one for gzip and brotli. Nothing in
  // this tree can compress zstd or lz4 — `fzstd` decompresses only, and no lz4
  // compressor is present — so those two are decompress-paths with no fixture,
  // and this suite does not imply otherwise. They are logged in deferred-work.md.
  const compressed = (codec, compress) =>
    file(
      [
        { name: 'Kunde', data: ['Anna', 'Bernd', 'Clara'], type: 'STRING' },
        { name: 'Betrag', data: [1.5, -0.25, 1234.5], type: 'DOUBLE' },
      ],
      undefined,
      { codec, ...(compress ? { compressors: { [codec]: compress } } : {}) },
    )

  const CASES = [
    ['SNAPPY', undefined],
    ['UNCOMPRESSED', undefined],
    ['GZIP', (bytes) => new Uint8Array(gzipSync(bytes))],
    ['BROTLI', (bytes) => new Uint8Array(brotliCompressSync(bytes))],
  ]

  it.each(CASES)('reads a %s file back to the same cells', async (codec, compress) => {
    const result = await read(compressed(codec, compress))

    expect(byName(result.table, 'Kunde').cells).toEqual(['Anna', 'Bernd', 'Clara'])
    expect(byName(result.table, 'Betrag').cells).toEqual(['1.5', '-0.25', '1234.5'])
    expect(codes(result)).toEqual([])
  })

  it('really is compressed — otherwise these cases prove nothing', async () => {
    // A codec recorded in the metadata but applied by an identity function would
    // read back perfectly and test nothing at all.
    for (const [codec, compress] of CASES) {
      const buffer = compressed(codec, compress)
      const recorded = parquetMetadata(buffer).row_groups[0].columns[0].meta_data.codec
      expect([codec, recorded]).toEqual([codec, codec])
    }
  })
})
