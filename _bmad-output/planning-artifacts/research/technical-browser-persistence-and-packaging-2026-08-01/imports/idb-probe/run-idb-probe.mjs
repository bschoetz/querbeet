// Does IndexedDB work from a file:// origin, and does the data survive a browser restart?
// Uses a PERSISTENT profile so "across sessions" means what PRD FR-25 means by it.
import { chromium, firefox } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = (p) => pathToFileURL(resolve(p)).href
const out = {}

async function runPage(ctx, path, label) {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  let R = null
  try {
    await page.goto(url(path))
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 180000 })
    R = await page.evaluate(() => window.__R__)
  } catch (e) {
    errors.push('TIMEOUT/ERROR: ' + String(e).split('\n')[0])
    try { R = await page.evaluate(() => window.__R__ || null) } catch {}
  }
  await page.close()
  return { label, errors, R }
}

for (const [name, driver, args] of [
  ['chromium', chromium, []],
  ['firefox', firefox, []],
]) {
  const profile = mkdtempSync(join(tmpdir(), `idbprobe-${name}-`))
  const res = { profile }
  // --- session 1: write, plus same-dir and cross-dir readers ---
  let ctx = await driver.launchPersistentContext(profile, { args })
  res.version = ctx.browser() ? ctx.browser().version() : 'persistent-context'
  res.s1_write = await runPage(ctx, 'dirA/write.html', 'session1 write dirA')
  res.s1_readSameDir = await runPage(ctx, 'dirA/read.html', 'session1 read dirA (same file, same dir)')
  res.s1_readOtherDir = await runPage(ctx, 'dirB/read.html', 'session1 read dirB (different dir)')
  await ctx.close()

  // --- session 2: fresh browser process, same on-disk profile ---
  ctx = await driver.launchPersistentContext(profile, { args })
  res.s2_readAfterRestart = await runPage(ctx, 'dirA/read.html', 'session2 read dirA AFTER RESTART')
  await ctx.close()

  out[name] = res
  rmSync(profile, { recursive: true, force: true })
}

writeFileSync('idb-probe-results.json', JSON.stringify(out, null, 1))

for (const eng of Object.keys(out)) {
  const r = out[eng]
  console.log('\n==========', eng)
  for (const k of ['s1_write', 's1_readSameDir', 's1_readOtherDir', 's2_readAfterRestart']) {
    const s = r[k]
    console.log(` --- ${s.label}`)
    console.log('     errors:', s.errors.length ? JSON.stringify(s.errors.slice(0, 2)) : 'none')
    console.log('     result:', JSON.stringify(s.R))
  }
}
