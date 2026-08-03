// Runs probe.mjs in every engine this project can reach and compares the
// results. Run from the repo root: node <this file>
//
// Three engines matter, not two. AD-27 makes Chromium the lead and Firefox
// measured-rather-than-assumed — but it also puts core/ under Vitest with
// environment: 'node', and typing.js lives in core/. So Node's ICU is the one
// the unit tests see, and a disagreement between it and a browser is a test
// that passes where the product fails. WebKit is measured too; it is not in
// the product's matrix and nothing is decided on it, but it is a third
// independent ICU and it costs one line.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import { measureIntlMonths } from './probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const engines = []

engines.push({
  name: 'node',
  inMatrix: true,
  identity: {
    version: process.version,
    icu: process.versions.icu,
    unicode: process.versions.unicode,
    tz: process.versions.tz,
  },
  result: measureIntlMonths(),
})

for (const [name, launcher, inMatrix] of [
  ['chromium', chromium, true],
  ['firefox', firefox, true],
  ['webkit', webkit, false],
]) {
  let browser
  try {
    browser = await launcher.launch()
  } catch (error) {
    // An engine outside the product matrix is a bonus data point, not a
    // dependency: if it is not installed, the spike still answers its
    // question and says which engine it did not reach. An engine inside
    // the matrix is a dependency and its absence is fatal.
    if (inMatrix) throw error
    engines.push({ name, inMatrix, skipped: String(error).split('\n')[0] })
    continue
  }
  try {
    const page = await browser.newPage()
    // about:blank is honest here: Intl is a language built-in and does not
    // depend on the document. This spike measures the engine, not the
    // artefact — the artefact is what tests/e2e covers, from a file:// URL.
    const userAgent = await page.evaluate(() => navigator.userAgent)
    engines.push({
      name,
      inMatrix,
      identity: { version: browser.version(), userAgent },
      result: await page.evaluate(measureIntlMonths),
    })
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------- comparison

const measured = engines.filter((e) => e.result)
const keys = Object.keys(measured[0].result.formatContext)
const matrix = measured.filter((e) => e.inMatrix)
const disagreements = []
const outOfMatrixOnly = []

for (const key of keys) {
  for (let m = 0; m < 12; m++) {
    const seen = new Map()
    for (const engine of measured) {
      const value = engine.result.formatContext[key][m]
      if (!seen.has(value)) seen.set(value, [])
      seen.get(value).push(engine.name)
    }
    if (seen.size === 1) continue
    const matrixValues = new Set(
      matrix.map((e) => e.result.formatContext[key][m]),
    )
    const record = { key, month: m + 1, spellings: Object.fromEntries(seen) }
    if (matrixValues.size > 1) disagreements.push(record)
    else outOfMatrixOnly.push(record)
  }
}

const cellsCompared = keys.length * 12
const say = (label, value) => console.log(`${label.padEnd(34)} ${value}`)

console.log('\n=== engines ===')
for (const e of engines) {
  const tag = e.inMatrix ? '' : '  (not in the product matrix)'
  if (!e.result) { say(`${e.name}${tag}`, `SKIPPED — ${e.skipped}`); continue }
  const id = e.name === 'node'
    ? `${e.identity.version}  ICU ${e.identity.icu}  Unicode ${e.identity.unicode}  tz ${e.identity.tz}`
    : e.identity.version
  say(`${e.name}${tag}`, id)
}

console.log('\n=== locale data present, not fallen back ===')
for (const e of measured) {
  const bad = keys.filter((k) => {
    const asked = k.split('/')[0]
    const got = e.result.resolved[k]
    return got !== asked && !asked.startsWith(got)
  })
  say(e.name, bad.length === 0 ? `OK (${keys.length}/${keys.length})` : `FALLBACK: ${bad.join(', ')}`)
}

console.log('\n=== the owner\'s two values, de-DE/short ===')
for (const e of measured) {
  const v = e.result.ownerValues['de-DE/short']
  say(e.name, `${v.augustSecond}   |   ${v.julyThirtyFirst}`)
}

console.log('\n=== format context vs standalone, de-DE/short ===')
for (const e of measured) {
  say(`${e.name} in a date`, e.result.formatContext['de-DE/short'].join(' '))
  say(`${e.name} standalone`, e.result.standalone['de-DE/short'].join(' '))
}

console.log('\n=== English ordinal suffix emitted by Intl ===')
for (const e of measured) say(e.name, e.result.ordinalSuffixSeen ? 'YES' : 'no')

console.log('\n=== cross-engine agreement (format context) ===')
say('cells compared per engine', cellsCompared)
say('engines in the matrix', matrix.map((e) => e.name).join(', '))
say('disagreements within the matrix', disagreements.length)
say('out-of-matrix-only differences', outOfMatrixOnly.length)
for (const d of [...disagreements, ...outOfMatrixOnly]) {
  console.log(`   ${d.key} month ${d.month}: ${JSON.stringify(d.spellings)}`)
}

// ------------------------------------------------- the union, and its safety
//
// The story proposes ONE candidate over the union of both vocabularies rather
// than a reading select nobody can answer, on the argument that a month name
// identifies its own shape. That holds only if no spelling means two different
// months, so it is computed here rather than eyeballed. Normalization is the
// one an implementation will plausibly apply: case-folded, trailing point
// dropped — an exporter writing "AUG" or "Aug" where CLDR says "Aug." must
// not become a second vocabulary.

const normalize = (s) => s.toLocaleLowerCase('de-DE').replace(/\.$/, '')
const lead = matrix.find((e) => e.name === 'chromium') ?? matrix[0]

const spellingsByMonth = Array.from({ length: 12 }, () => new Set())
const monthsBySpelling = new Map()
for (const key of keys) {
  lead.result.formatContext[key].forEach((raw, m) => {
    spellingsByMonth[m].add(raw)
    const n = normalize(raw)
    if (!monthsBySpelling.has(n)) monthsBySpelling.set(n, new Set())
    monthsBySpelling.get(n).add(m + 1)
  })
}
const collisions = [...monthsBySpelling]
  .filter(([, months]) => months.size > 1)
  .map(([spelling, months]) => ({ spelling, months: [...months] }))

console.log('\n=== the union vocabulary, de-DE + en-US + en-GB ===')
say('distinct spellings, normalized', monthsBySpelling.size)
say('spellings meaning two months', collisions.length)
for (const c of collisions) console.log(`   ${c.spelling} -> months ${c.months.join(', ')}`)
for (let m = 0; m < 12; m++) {
  const set = [...spellingsByMonth[m]]
  say(`  month ${String(m + 1).padStart(2)}  (${set.length} spellings)`, set.join('  '))
}

writeFileSync(
  join(HERE, 'measurements.json'),
  JSON.stringify(
    {
      engines,
      cellsCompared,
      disagreements,
      outOfMatrixOnly,
      union: {
        normalization: 'toLocaleLowerCase("de-DE"), trailing "." dropped',
        distinctSpellings: monthsBySpelling.size,
        collisions,
        spellingsByMonth: spellingsByMonth.map((s) => [...s]),
      },
    },
    null,
    2,
  ) + '\n',
)
console.log('\nwrote measurements.json\n')
