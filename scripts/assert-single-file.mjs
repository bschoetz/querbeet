// AD-18 — the build emits exactly one file, asserted where the assertion can fail.
//
// This is a filesystem and text check, deliberately independent of any browser.
// The browser-side network assertion is a separate, Chromium-only thing: measured,
// Playwright's Firefox reports 1 of 5 requests from a file:// page because it
// observes HTTP channels and file:// is not one, so a split bundle would pass
// green there. A green Firefox network check is not evidence.
//
// Run: node scripts/assert-single-file.mjs   (chained from `npm run build`)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const failures = []
const notes = []

const fail = (rule, detail) => failures.push({ rule, detail })
const note = (label, value) => notes.push([label, value])

// ---------------------------------------------------------------- one entry

let entries = []
try {
  entries = readdirSync(DIST)
} catch {
  fail('dist/ is readable', `no ${DIST}/ directory — run the build first`)
}

if (entries.length && entries.length !== 1) {
  fail(
    'dist/ contains exactly one entry',
    `found ${entries.length}: ${entries.join(', ')}\n` +
      '    A split bundle is the documented silent failure: an idiomatic module\n' +
      '    worker or a lazy import splits it with no build-time signal (AD-15, AD-17).',
  )
}

const only = entries.length === 1 ? entries[0] : null

if (only && !only.endsWith('.html')) {
  fail('the single entry is an HTML document', `found ${only}`)
}

if (only && statSync(join(DIST, only)).isDirectory()) {
  fail('the single entry is a file, not a directory', only)
}

// ------------------------------------------------------- nothing is fetched

if (only && only.endsWith('.html')) {
  const path = join(DIST, only)
  const html = readFileSync(path, 'utf8')

  note('artifact', path)
  note('bytes', readFileSync(path).byteLength.toLocaleString('en-US'))

  const count = (re) => (html.match(re) ?? []).length

  // A dynamic import in the output means a chunk that is not in this file.
  const dynamicImports = count(/\bimport\s*\(/g)
  if (dynamicImports) {
    fail(
      'no dynamic import',
      `${dynamicImports} occurrence(s) of \`import(\` — a lazy chunk cannot be` +
        ' loaded from an opaque origin (AD-17).',
    )
  }

  // AD-17: no fetch, from anywhere in the bundle including dependencies.
  const fetches = count(/\bfetch\s*\(/g)
  if (fetches) {
    fail(
      'no fetch',
      `${fetches} occurrence(s) of \`fetch(\` — a file:// page has an opaque` +
        ' origin and anything it fetches fails CORS (AD-17).',
    )
  }

  // A url() that is not a data: URI is an external asset request.
  const externalUrls = [...html.matchAll(/url\(\s*['"]?(?!data:|#)([^)'"]{1,120})/g)].map(
    (m) => m[1].trim(),
  )
  if (externalUrls.length) {
    fail(
      'every CSS url() is a data: URI',
      `${externalUrls.length} external reference(s): ${[...new Set(externalUrls)].slice(0, 5).join(', ')}`,
    )
  }

  // A <script src> or <link href> pointing anywhere but a data: URI is the same
  // defect one level up from CSS.
  const externalTags = [
    ...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["'](?!data:|#)([^"']+)/gi),
  ].map((m) => m[1])
  if (externalTags.length) {
    fail(
      'no external <script src> or <link href>',
      `${externalTags.length}: ${[...new Set(externalTags)].slice(0, 5).join(', ')}`,
    )
  }

  // Reported, never asserted. AD-15: a dependency may construct its own worker
  // — read-excel-file spawns fflate blob-URL workers on the import path — so
  // this count constrains nothing. It is here so a change in it is visible.
  note('`new Worker` occurrences (informational — not a gate, AD-15)', count(/new\s+Worker\s*\(/g))
  note('`@font-face` rules (legitimate only with a data: src)', count(/@font-face/g))
}

// ------------------------------------------------------------------ verdict

const pad = Math.max(0, ...notes.map(([l]) => l.length))
for (const [label, value] of notes) console.log(`  ${label.padEnd(pad)}  ${value}`)

if (failures.length === 0) {
  console.log('\n✓ AD-18: one file, nothing fetched at runtime.')
  process.exit(0)
}

console.error(`\n✗ AD-18: ${failures.length} assertion(s) failed.\n`)
for (const { rule, detail } of failures) console.error(`  • ${rule}\n    ${detail}\n`)
process.exit(1)
