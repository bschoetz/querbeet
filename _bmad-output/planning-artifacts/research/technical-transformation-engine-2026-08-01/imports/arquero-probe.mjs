// Empirical probe of Arquero behaviours that matter for querbeet.
// Run against the RELEASED package (8.0.3), not the main branch, to settle
// the "main may be ahead of the release" caveat for these specific behaviours.

import * as aq from 'arquero'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const out = {}
const note = (k, v) => { out[k] = v }

note('version', require('arquero/package.json').version)

// ---------------------------------------------------------------- 1. concat
// Does concat drop columns unique to incoming tables? What fills gaps?
{
  const a = aq.from([{ id: 1, betrag: 10 }])
  const b = aq.from([{ id: 2, betrag: 20, nur_in_b: 'x' }])
  const c = aq.from([{ id: 3 }]) // missing 'betrag' entirely
  const r = a.concat(b, c)
  note('concat', {
    result_columns: r.columnNames(),
    dropped_column_from_b: !r.columnNames().includes('nur_in_b'),
    rows: r.objects(),
  })
}

// ------------------------------------------------- 2. concat after padding
// The workaround: compute the union of column names and pad every table first.
{
  const tables = [
    aq.from([{ id: 1, betrag: 10 }]),
    aq.from([{ id: 2, betrag: 20, nur_in_b: 'x' }]),
    aq.from([{ id: 3 }]),
  ]
  const allCols = [...new Set(tables.flatMap(t => t.columnNames()))]
  const padded = tables.map(t => {
    const missing = allCols.filter(c => !t.columnNames().includes(c))
    const filled = missing.length
      ? t.derive(Object.fromEntries(missing.map(c => [c, () => null])))
      : t
    return filled.select(allCols)
  })
  const r = padded[0].concat(...padded.slice(1))
  note('concat_padded', { result_columns: r.columnNames(), rows: r.objects() })
}

// ------------------------------------------------------------- 3. null keys
// Does a null join key match another null join key?
{
  const left = aq.from([{ k: 'a', v: 1 }, { k: null, v: 2 }])
  const right = aq.from([{ k: 'a', w: 'A' }, { k: null, w: 'NULL-ROW' }])
  const def = left.join_left(right, ['k', 'k'])
  let withEqual = null
  try {
    withEqual = left
      .join_left(right, (a, b) => aq.op.equal(a.k, b.k))
      .objects()
  } catch (e) {
    withEqual = 'ERROR: ' + String(e.message).slice(0, 120)
  }
  note('null_join', { default: def.objects(), with_op_equal: withEqual })
}

// ------------------------------------------------- 4. duplicate-key blow-up
{
  const left = aq.from([{ k: 1 }, { k: 1 }])
  const right = aq.from([{ k: 1, tag: 'x' }, { k: 1, tag: 'y' }])
  const r = left.join_left(right, ['k', 'k'])
  note('duplicate_keys', { input_rows: 2, output_rows: r.numRows(), cartesian: r.numRows() === 4 })
}

// ------------------------------------- 5. filter built from a config object
// The core question for a click-together UI: can we build these from data?
{
  const data = aq.from([
    { name: 'Alpha', betrag: 100, status: 'offen', notiz: null },
    { name: 'Beta', betrag: 900, status: 'bezahlt', notiz: 'x' },
    { name: 'Gamma', betrag: 500, status: 'offen', notiz: '' },
  ])

  // (a) string expression assembled from config
  const cfgA = { column: 'betrag', operator: '>', value: 400 }
  const exprA = 'd => d.' + cfgA.column + ' ' + cfgA.operator + ' ' + JSON.stringify(cfgA.value)
  let stringExpr
  try { stringExpr = data.filter(exprA).objects() }
  catch (e) { stringExpr = 'ERROR: ' + String(e.message).slice(0, 120) }

  // (b) escape() closure built from config — no source strings at all
  const OPS = {
    eq: (a, b) => a === b,
    neq: (a, b) => a !== b,
    gt: (a, b) => a > b,
    lt: (a, b) => a < b,
    contains: (a, b) => String(a ?? '').includes(String(b)),
    empty: a => a === null || a === undefined || a === '',
    notEmpty: a => !(a === null || a === undefined || a === ''),
  }
  const build = cfg => aq.escape(d => OPS[cfg.op](d[cfg.column], cfg.value))
  let escaped = {}
  for (const cfg of [
    { column: 'status', op: 'eq', value: 'offen' },
    { column: 'name', op: 'contains', value: 'amm' },
    { column: 'notiz', op: 'empty' },
    { column: 'notiz', op: 'notEmpty' },
  ]) {
    try { escaped[cfg.column + '/' + cfg.op] = data.filter(build(cfg)).objects().map(r => r.name) }
    catch (e) { escaped[cfg.column + '/' + cfg.op] = 'ERROR: ' + String(e.message).slice(0, 120) }
  }
  note('filter_from_config', { string_expression: stringExpr, escaped })
}

// ------------------------------------ 6. computed column built from config
{
  const data = aq.from([{ preis: 10, menge: 3 }, { preis: 5, menge: 4 }])
  const cfg = { name: 'summe', left: 'preis', op: '*', right: 'menge' }
  let viaString, viaEscape
  try {
    viaString = data.derive({ [cfg.name]: 'd => d.' + cfg.left + ' ' + cfg.op + ' d.' + cfg.right }).objects()
  } catch (e) { viaString = 'ERROR: ' + String(e.message).slice(0, 120) }
  try {
    viaEscape = data.derive({ [cfg.name]: aq.escape(d => d[cfg.left] * d[cfg.right]) }).objects()
  } catch (e) { viaEscape = 'ERROR: ' + String(e.message).slice(0, 120) }
  note('derive_from_config', { viaString, viaEscape })
}

// --------------------------------- 7. join type selected at runtime + rollup
{
  const left = aq.from([{ k: 1, v: 10 }, { k: 2, v: 20 }])
  const right = aq.from([{ k: 1, w: 'A' }])
  const pick = (t, kind) => kind === 'inner' ? t.join(right, ['k', 'k']) : t.join_left(right, ['k', 'k'])
  note('join_type_runtime', {
    left_rows: pick(left, 'left').numRows(),
    inner_rows: pick(left, 'inner').numRows(),
  })

  const grouped = aq.from([
    { g: 'a', n: 1 }, { g: 'a', n: 2 }, { g: 'b', n: 5 }, { g: 'b', n: null },
  ])
  const cfg = [{ out: 'summe', fn: 'sum', col: 'n' }, { out: 'anzahl', fn: 'count' }, { out: 'gueltig', fn: 'valid', col: 'n' }]
  const spec = {}
  for (const c of cfg) {
    spec[c.out] = c.fn === 'count' ? aq.op.count() : aq.op[c.fn](c.col)
  }
  note('rollup_from_config', grouped.groupby('g').rollup(spec).objects())
}

// ---------------------------------------- 8. type inference on German data
{
  const csv = 'kunde,betrag,datum\nAlpha,"1.234,56",31.12.2025\nBeta,"2.000,00",01.01.2026'
  let auto, off
  try { auto = aq.fromCSV(csv).objects() } catch (e) { auto = 'ERROR: ' + String(e.message).slice(0, 120) }
  try { off = aq.fromCSV(csv, { autoType: false }).objects() } catch (e) { off = 'ERROR: ' + String(e.message).slice(0, 120) }
  let custom
  try {
    custom = aq.fromCSV(csv, {
      parse: { betrag: v => Number(String(v).replace(/\./g, '').replace(',', '.')) },
    }).objects()
  } catch (e) { custom = 'ERROR: ' + String(e.message).slice(0, 120) }
  note('german_types', { autoType_default: auto, autoType_false: off, custom_parse: custom })
}

console.log(JSON.stringify(out, null, 2))
