// Opens each built single-file artifact from a real file:// URL in Chromium and
// Firefox, headless, and collects the shared assertion contract.
import { chromium, firefox } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'

const CANDIDATES = ['vueflow', 'baklava', 'handbuilt']
const out = {}

// static gate: what does the built artifact itself contain?
const HAZARDS = [
  ['dynamic import', /\bimport\s*\(/],
  ['fetch(', /\bfetch\s*\(/],
  ['new Worker', /new\s+Worker\s*\(/],
  ['importScripts', /importScripts\s*\(/],
  ['@font-face', /@font-face/],
  ['XMLHttpRequest', /XMLHttpRequest/],
]

for (const c of CANDIDATES) {
  const file = resolve(c, 'dist/index.html')
  const html = readFileSync(file, 'utf8')
  const hazards = {}
  for (const [name, re] of HAZARDS) {
    const m = html.match(new RegExp(re.source, 'g'))
    hazards[name] = m ? m.length : 0
  }
  const urls = [...html.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)]
    .map((m) => m[2]).filter((u) => !u.startsWith('data:') && !u.startsWith('#'))
  const externalSrc = [...html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)=["']([^"']+)["']/g)]
    .map((m) => m[1]).filter((u) => !u.startsWith('data:') && !u.startsWith('#'))
  const distFiles = readdirSync(resolve(c, 'dist'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile()).map((d) => d.name)
  out[c] = { distFiles, distFileCount: distFiles.length, bytes: statSync(file).size, hazards, nonDataUrls: urls, externalSrc, browsers: {} }
}

for (const [name, driver, args] of [
  ['chromium', chromium, ['--enable-precise-memory-info', '--js-flags=--expose-gc']],
  ['firefox', firefox, []],
]) {
  const browser = await driver.launch({ args })
  for (const c of CANDIDATES) {
    const url = pathToFileURL(resolve(c, 'dist/index.html')).href
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const errors = []
    const requests = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
    page.on('request', (r) => requests.push(r.url()))
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')))
    let results = null
    try {
      await page.goto(url)
      await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 120000 })
      results = await page.evaluate(() => window.__RESULTS__)
    } catch (e) {
      errors.push('TIMEOUT/ERROR: ' + String(e).split('\n')[0])
      try { results = await page.evaluate(() => window.__RESULTS__ || null) } catch {}
    }
    out[c].browsers[name] = {
      version: browser.version(),
      errors,
      // any request beyond the document itself is a runtime fetch
      extraRequests: requests.filter((r) => r !== url),
      results,
    }
    await page.close()
  }
  await browser.close()
}

writeFileSync('graph-probe-results.json', JSON.stringify(out, null, 1))
for (const c of CANDIDATES) {
  console.log('\n=====', c, out[c].bytes, 'B')
  console.log('  hazards:', JSON.stringify(out[c].hazards))
  console.log('  non-data url():', JSON.stringify(out[c].nonDataUrls))
  console.log('  external src/href:', JSON.stringify(out[c].externalSrc))
  for (const b of ['chromium', 'firefox']) {
    const r = out[c].browsers[b]
    console.log(` --- ${b} ${r.version}`)
    console.log('     errors:', r.errors.length ? JSON.stringify(r.errors.slice(0, 4)) : 'none')
    console.log('     extra requests:', JSON.stringify(r.extraRequests))
    console.log('     results:', JSON.stringify(r.results, null, 1))
  }
}
