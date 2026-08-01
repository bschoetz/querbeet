// Probe 3: does Arquero's type inference, which samples only the first
// `autoMax` (default 1000) values, silently corrupt values that appear later?
// This is the hazard that matters for 100k-row report files.

import * as aq from 'arquero'
const out = {}

// Build a CSV whose first 1000 data rows are plain integers, then one row
// carrying a German-formatted value, then more plain integers.
const rows = ['id,betrag']
for (let i = 0; i < 1000; i++) rows.push(`${i},${100 + i}`)
rows.push('9001,"1.234,56"')   // German decimal, appears AFTER the sample window
rows.push('9002,"7.500"')      // German thousands separator, also after
rows.push('9003,555')
const csv = rows.join('\n')

const inspect = (label, table) => {
  const objs = table.objects()
  const late = objs.filter(r => r.id >= 9001)
  out[label] = {
    total_rows: table.numRows(),
    type_of_early_value: typeof table.get('betrag', 0),
    late_rows: late,
    count_vs_valid: {
      count: table.rollup({ n: aq.op.count() }).get('n', 0),
      valid: table.rollup({ v: aq.op.valid('betrag') }).get('v', 0),
    },
    sum: table.rollup({ s: aq.op.sum('betrag') }).get('s', 0),
  }
}

try { inspect('default_autoType', aq.fromCSV(csv)) }
catch (e) { out.default_autoType = 'ERROR: ' + String(e.message).slice(0, 140) }

try { inspect('autoMax_raised', aq.fromCSV(csv, { autoMax: 200000 })) }
catch (e) { out.autoMax_raised = 'ERROR: ' + String(e.message).slice(0, 140) }

try { inspect('autoType_false', aq.fromCSV(csv, { autoType: false })) }
catch (e) { out.autoType_false = 'ERROR: ' + String(e.message).slice(0, 140) }

const germanNumber = v => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return null
  return Number(s.replace(/\./g, '').replace(',', '.'))
}
try { inspect('explicit_parser', aq.fromCSV(csv, { parse: { betrag: germanNumber } })) }
catch (e) { out.explicit_parser = 'ERROR: ' + String(e.message).slice(0, 140) }

console.log(JSON.stringify(out, null, 2))
