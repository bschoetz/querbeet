// Probe 4: CSV export shaped for German Excel.
// Import safety is only half the problem — the result has to come back out in
// a form a German Excel opens without mangling it again.

import * as aq from 'arquero'
const out = {}

const t = aq.from([
  { kunde: 'Müller GmbH', betrag: 1234.56, menge: 7500, notiz: null, datum: new Date(Date.UTC(2025, 11, 31)) },
  { kunde: 'Schmidt; Co', betrag: -8.5, menge: 12, notiz: 'mit "Zitat"', datum: new Date(Date.UTC(2026, 0, 1)) },
  { kunde: 'Zeilen\numbruch', betrag: 0, menge: 0, notiz: '', datum: null },
])

out.default_toCSV = t.toCSV()

out.semicolon = t.toCSV({ delimiter: ';' })

const de = n => (n === null || n === undefined || Number.isNaN(n)) ? '' : String(n).replace('.', ',')
const deDate = d => d ? String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear() : ''
out.german_excel = t.toCSV({
  delimiter: ';',
  format: { betrag: de, menge: de, datum: deDate },
})

// Round-trip: does what we wrote read back as the same numbers?
const germanNumber = v => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return null
  return Number(s.replace(/\./g, '').replace(',', '.'))
}
try {
  const back = aq.fromCSV(out.german_excel, {
    delimiter: ';',
    parse: { betrag: germanNumber, menge: germanNumber },
  })
  out.round_trip = {
    rows: back.objects(),
    betrag_matches: JSON.stringify(back.array('betrag')) === JSON.stringify(t.array('betrag')),
    menge_matches: JSON.stringify(back.array('menge')) === JSON.stringify(t.array('menge')),
  }
} catch (e) {
  out.round_trip = 'ERROR: ' + String(e.message).slice(0, 160)
}

out.notes = {
  has_bom: out.german_excel.charCodeAt(0) === 0xFEFF,
  line_ending: out.german_excel.includes('\r\n') ? 'CRLF' : 'LF',
}

console.log(JSON.stringify(out, null, 2))
