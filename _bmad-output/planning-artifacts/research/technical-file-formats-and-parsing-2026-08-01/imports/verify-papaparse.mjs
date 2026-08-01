// Verification harness for D1 load-bearing claims about PapaParse 5.5.4.
// Run: node verify-papaparse.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Papa = require('./papaparse.min.js')

import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('./papaparse.min.js', import.meta.url), 'utf8')
console.log('artefact: papaparse.min.js fetched from https://cdn.jsdelivr.net/npm/papaparse@5.5.4/papaparse.min.js')
console.log('artefact bytes:', Buffer.byteLength(src), '(jsDelivr serves 19476 for 5.5.4)')
console.log('node:', process.version, '| DefaultDelimiter:', JSON.stringify(Papa.DefaultDelimiter))

const show = (v) => `${JSON.stringify(v)} (${typeof v})`

// --- Claim 17/18: dynamicTyping vs German number formats -------------------
const german = [
  'Kostenstelle;Betrag;Menge;Preis',
  '0123;1.234;5;1.234,56',
  '0456;999;10;12,50',
  '0789;1.234.567;3;0,99',
].join('\n')

const dyn = Papa.parse(german, { header: true, delimiter: ';', dynamicTyping: true })
console.log('\n=== dynamicTyping: true, German data ===')
for (const row of dyn.data) {
  console.log(Object.entries(row).map(([k, v]) => `${k}=${show(v)}`).join('  '))
}

const nodyn = Papa.parse(german, { header: true, delimiter: ';', dynamicTyping: false })
console.log('\n=== dynamicTyping: false (control) ===')
console.log(Object.entries(nodyn.data[0]).map(([k, v]) => `${k}=${show(v)}`).join('  '))

// --- Claim 9: delimiter guessing with a preamble before the header ---------
const withPreamble = [
  'Monatsreport Vertrieb',
  'Erstellt am 31.12.2025',
  '',
  'Kunde;Umsatz;Region',
  'Meier GmbH;1.234,56;Nord',
  'Schulze AG;987,00;Sued',
].join('\n')

const guessed = Papa.parse(withPreamble, { header: false })
console.log('\n=== delimiter guess WITH preamble (no delimiter given) ===')
console.log('guessed delimiter:', JSON.stringify(guessed.meta.delimiter), '| fields in row 3:', guessed.data[3]?.length)

const clean = ['Kunde;Umsatz;Region', 'Meier GmbH;1.234,56;Nord', 'Schulze AG;987,00;Sued'].join('\n')
console.log('\n=== delimiter guess WITHOUT preamble ===')
console.log('guessed delimiter:', JSON.stringify(Papa.parse(clean, { header: false }).meta.delimiter))

console.log('\n=== delimiter guess with skipFirstNLines: 3 ===')
const skipped = Papa.parse(withPreamble, { header: true, skipFirstNLines: 3 })
console.log('guessed delimiter:', JSON.stringify(skipped.meta.delimiter), '| fields:', JSON.stringify(skipped.meta.fields))

// --- Two-column semicolon file: the avgFieldCount > 1.99 edge -------------
const twoCol = ['A;B', '1;2', '3;4'].join('\n')
console.log('\n=== two-column semicolon file ===')
console.log('guessed delimiter:', JSON.stringify(Papa.parse(twoCol, { header: false }).meta.delimiter))

// --- Single-column file ---------------------------------------------------
const oneCol = ['Kunde', 'Meier', 'Schulze'].join('\n')
console.log('\n=== single-column file ===')
const oc = Papa.parse(oneCol, { header: false })
console.log('guessed delimiter:', JSON.stringify(oc.meta.delimiter), '| aborted:', oc.errors.length ? JSON.stringify(oc.errors[0]) : 'no errors')

// --- Comma-decimal file where comma is NOT the delimiter -------------------
const ambiguous = ['Kunde;Umsatz', 'Meier;1,50', 'Schulze;2,75'].join('\n')
console.log('\n=== semicolon file whose values contain commas ===')
const amb = Papa.parse(ambiguous, { header: true })
console.log('guessed delimiter:', JSON.stringify(amb.meta.delimiter), '| fields:', JSON.stringify(amb.meta.fields), '| row0:', JSON.stringify(amb.data[0]))
