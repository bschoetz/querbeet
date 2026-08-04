// Runs probe.mjs in the three engines that decide this product, and writes
// measurements.json beside itself. Run from the repo root: node <this file>
//
// AD-27 makes Chromium the lead engine and Firefox measured rather than assumed,
// and C-3's interactivity claim is about a browser rather than about Node. Node
// is measured too because `core/`, `ports/` and `adapters/` run their unit tests
// under `environment: 'node'` — a semantic that differs between Node and a
// browser would be a test that passes green while the product is wrong.
//
// The browsers get the probe as a single inlined HTML file, built with the same
// vite + vite-plugin-singlefile the product itself is built with, and loaded from
// `file://` — the origin the artefact actually runs at.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { chromium, firefox } from 'playwright'
import { measureOrdering } from './probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')

const engines = []

engines.push({
  name: 'node',
  identity: { version: process.version, icu: process.versions.icu },
  result: measureOrdering(),
})

// --- the same probe, inlined into one HTML file -----------------------------

const stage = mkdtempSync(join(tmpdir(), 'arquero-order-'))
writeFileSync(
  join(stage, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>probe</title><script type="module" src="/entry.js"></script>',
)
writeFileSync(
  join(stage, 'entry.js'),
  `import { measureOrdering } from ${JSON.stringify(join(HERE, 'probe.mjs'))}
window.__RESULT__ = measureOrdering()
`,
)

await build({
  root: stage,
  logLevel: 'warn',
  resolve: { preserveSymlinks: false },
  plugins: [viteSingleFile()],
  build: { outDir: join(stage, 'dist'), emptyOutDir: true, target: 'es2022' },
})

const pageUrl = pathToFileURL(join(stage, 'dist', 'index.html')).href

for (const [name, launcher] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await launcher.launch()
  try {
    const page = await browser.newPage()
    await page.goto(pageUrl)
    await page.waitForFunction(() => window.__RESULT__ !== undefined, null, { timeout: 120_000 })
    engines.push({
      name,
      identity: { version: browser.version() },
      // BigInt never reaches the boundary — the probe returns numbers and
      // strings only — so the default serialization is enough.
      result: await page.evaluate(() => window.__RESULT__),
    })
  } finally {
    await browser.close()
  }
}

rmSync(stage, { recursive: true, force: true })

const measurements = { rows: engines[0].result.rows, engines }
writeFileSync(join(HERE, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`)

// --- what the run says out loud ---------------------------------------------

const row = (label, pick) =>
  `${label.padEnd(30)} ${engines.map((e) => String(pick(e.result)).padStart(10)).join('')}`

console.log(`\nrows: ${measurements.rows}`)
console.log(`${''.padEnd(30)}${engines.map((e) => e.name.padStart(10)).join('')}`)
for (const key of Object.keys(engines[0].result.cost)) {
  console.log(row(`${key} (ms)`, (r) => r.cost[key]))
}
console.log()
console.log('code-unit order :', engines[0].result.collation.codeUnit.join(' | '))
console.log('collated order  :', engines[0].result.collation.collated.join(' | '))
console.log('one box, engine :', engines[0].result.box.engineOrderby.join(' '))
console.log('one box, ours   :', engines[0].result.box.ownComparatorAsc.join(' '))
console.log('agreement across engines:', JSON.stringify(engines[0].result.collation.collated) ===
  JSON.stringify(engines.at(-1).result.collation.collated) ? 'yes' : 'NO')
