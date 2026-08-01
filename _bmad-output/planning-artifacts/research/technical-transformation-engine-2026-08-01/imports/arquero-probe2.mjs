// Follow-up probe: the two results from probe.mjs that need pinning down.
//   A. Null join keys — find a workaround that actually matches null to null.
//   B. German thousands separators — the silent-corruption case.

import * as aq from 'arquero'
const out = {}

// ------------------------------------------------------------ A. null joins
{
  const left = aq.from([{ k: 'a', v: 1 }, { k: null, v: 2 }])
  const right = aq.from([{ k: 'a', w: 'A' }, { k: null, w: 'NULL-ROW' }])

  const attempts = {}

  attempts['keys_array'] = (() => {
    try { return left.join_left(right, ['k', 'k']).objects() }
    catch (e) { return 'ERROR: ' + String(e.message).slice(0, 140) }
  })()

  attempts['predicate_op_equal'] = (() => {
    try { return left.join_left(right, (a, b) => aq.op.equal(a.k, b.k)).objects() }
    catch (e) { return 'ERROR: ' + String(e.message).slice(0, 140) }
  })()

  attempts['predicate_explicit_null'] = (() => {
    try {
      return left.join_left(right, (a, b) => a.k === b.k || (a.k == null && b.k == null)).objects()
    } catch (e) { return 'ERROR: ' + String(e.message).slice(0, 140) }
  })()

  // The pragmatic workaround: substitute a sentinel for null before joining.
  attempts['sentinel_substitution'] = (() => {
    try {
      const S = '__NULL__'
      const l = left.derive({ _k: aq.escape(d => d.k == null ? S : d.k) })
      const r = right.derive({ _k: aq.escape(d => d.k == null ? S : d.k) })
      return l.join_left(r.select({ _k: '_k', w: 'w' }), ['_k', '_k']).select(aq.not('_k')).objects()
    } catch (e) { return 'ERROR: ' + String(e.message).slice(0, 140) }
  })()

  out.null_join_attempts = attempts
}

// ------------------------------------------- B. German thousands separators
{
  // The dangerous case: "1.234" is 1234 in German but parses as 1.234 in JS.
  const csv = [
    'kunde,a,b,c,d',
    'Alpha,1.234,"1.234","1.234,56",1234',
    'Beta,2.500,"2.500","2.500,00",2500',
  ].join('\n')

  const shapes = {}
  for (const [label, opts] of [
    ['default', undefined],
    ['autoType_false', { autoType: false }],
  ]) {
    try {
      const t = opts ? aq.fromCSV(csv, opts) : aq.fromCSV(csv)
      shapes[label] = { rows: t.objects(), types: t.columnNames().map(c => c + ':' + typeof t.get(c, 0)) }
    } catch (e) { shapes[label] = 'ERROR: ' + String(e.message).slice(0, 140) }
  }

  // Per-column parser that understands German formatting.
  const germanNumber = v => {
    if (v === null || v === undefined || v === '') return null
    const s = String(v).trim()
    if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return null
    return Number(s.replace(/\./g, '').replace(',', '.'))
  }
  try {
    const t = aq.fromCSV(csv, { parse: { a: germanNumber, b: germanNumber, c: germanNumber, d: germanNumber } })
    shapes['german_parser'] = { rows: t.objects() }
  } catch (e) { shapes['german_parser'] = 'ERROR: ' + String(e.message).slice(0, 140) }

  out.german_numbers = shapes
}

// --------------------------------------------- C. what aq.from does to types
{
  // Data arriving already parsed by another CSV library (the likely real path).
  const rows = [{ betrag: '1.234', datum: '31.12.2025' }, { betrag: '2.500', datum: '01.01.2026' }]
  const t = aq.from(rows)
  out.aq_from_preserves_strings = {
    values: t.objects(),
    type_of_first: typeof t.get('betrag', 0),
  }
}

console.log(JSON.stringify(out, null, 2))
