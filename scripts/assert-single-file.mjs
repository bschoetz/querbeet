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
  //
  // ONE OCCURRENCE IS NOT ONE, AND IT IS NAMED RATHER THAN TOLERATED AS A COUNT.
  // `acorn` ships inside Arquero — `Table` reaches it through `regroup.js` and
  // the three verbs that file imports, so it is in the artefact whichever table
  // class the engine adapter builds against — and one of acorn's own parse-error
  // messages is the sentence below, which contains the characters `import(`
  // inside a string literal. The bundle contains no dynamic import; this check
  // is a text scan by design, independent of any browser, and a text scan cannot
  // tell code from a sentence about code.
  //
  // The exception is pinned to that exact sentence rather than to a number, so
  // it cannot cover anything else: a real `import(` anywhere in the file is one
  // more occurrence than the sentences account for, and the assertion fails
  // naming it. If acorn ever stops shipping the message, the exception matches
  // nothing and nothing changes.
  const ACORN_IMPORT_MESSAGE = 'Trailing comma is not allowed in import()'
  const dynamicImports = [...html.matchAll(/\bimport\s*\(/g)].filter((m) => {
    const from = Math.max(0, m.index - ACORN_IMPORT_MESSAGE.length)
    return !html.slice(from, m.index + ACORN_IMPORT_MESSAGE.length).includes(ACORN_IMPORT_MESSAGE)
  })
  if (dynamicImports.length) {
    fail(
      'no dynamic import',
      `${dynamicImports.length} occurrence(s) of \`import(\` — a lazy chunk cannot be` +
        ' loaded from an opaque origin (AD-17).\n' +
        `    First at byte ${dynamicImports[0].index}: …${html.slice(dynamicImports[0].index - 40, dynamicImports[0].index + 40)}…`,
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

  // ------------------------------------------------- the synchronous WASM ceiling
  //
  // `hyparquet-compressors` decompresses snappy through `hysnappy`, whose WASM
  // is base64-inlined and instantiated with `atob` + `new WebAssembly.Module`.
  // That is the reason it passes the two assertions above at all — nothing is
  // fetched and no second file is emitted — but it brings a ceiling with it.
  //
  // **Chrome refuses a synchronous `new WebAssembly.Module` larger than 4,096
  // bytes on the main thread.** hysnappy's module is 3,458 bytes, so the margin
  // is 638. If a future version crosses it, instantiation throws — and only in
  // a real browser, never under Node, and never in the dev server. That is
  // precisely the class of silent build-time failure this whole script exists
  // for, so the margin is asserted here rather than trusted.
  //
  // A WASM binary always starts with the four bytes `\0asm`, which is `AGFzbQ`
  // in base64 — that is how the module is found in a quarter-megabyte of
  // minified JavaScript without knowing the variable it was assigned to.
  const SYNC_WASM_LIMIT = 4096
  const wasmLiterals = [...html.matchAll(/["'`](AGFzbQ[A-Za-z0-9+/=]{16,})["'`]/g)].map((m) =>
    Buffer.from(m[1], 'base64'),
  )

  if (wasmLiterals.length === 0) {
    note('inlined WebAssembly modules', 'none found')
  }
  for (const wasm of wasmLiterals) {
    note(
      `inlined WebAssembly module (limit ${SYNC_WASM_LIMIT.toLocaleString('en-US')} B)`,
      `${wasm.byteLength.toLocaleString('en-US')} B — ${(SYNC_WASM_LIMIT - wasm.byteLength).toLocaleString('en-US')} B of margin`,
    )
    if (wasm.byteLength >= SYNC_WASM_LIMIT) {
      fail(
        'every inlined WebAssembly module compiles synchronously',
        `${wasm.byteLength} bytes is at or over Chrome's ${SYNC_WASM_LIMIT}-byte limit for a\n` +
          '    synchronous `new WebAssembly.Module` on the main thread. It would throw in\n' +
          '    Chromium at runtime and nowhere else — not under Node, not in the dev server.\n' +
          '    Either move the instantiation off the main thread or take the dependency out.',
      )
    }
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
