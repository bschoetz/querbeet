#!/usr/bin/env node
// Fills the FR-27 block template from a context file and writes the paste-ready
// block. The template is the single source of truth: the example is generated,
// never hand-edited, so the two cannot drift.
//
//   node render-block.mjs                       -> writes prompt-block-example.txt
//   node render-block.mjs --check               -> exits 1 if the file on disk is stale
//   node render-block.mjs ctx.json out.txt      -> render any other context
//
// This is what the app itself has to do at FR-27 time; here it stands in for
// the app so the block can be produced and tested without a browser.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2).filter((a) => a !== '--check')
const check = process.argv.includes('--check')
const ctxPath = resolve(here, args[0] || 'example-context.json')
const outPath = resolve(here, args[1] || 'prompt-block-example.txt')

const de = (n) => n.toLocaleString('de-DE')
const pct = (share) => `${(share * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`

// A fixed-width table, because the block is plain text: it has to survive being
// pasted into a chat window that will not render markdown tables reliably.
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => [...r[i]].length)))
  return rows
    .map((r) => '    ' + r.map((cell, i) => cell.padEnd(i === r.length - 1 ? 0 : widths[i] + 2)).join('').trimEnd())
    .join('\n')
}

export function renderProfile(sources) {
  return sources
    .map((s) => {
      const head = `### ${s.name} — id: ${s.id}, Datei: ${s.file}, ${de(s.rows)} Zeilen`
      const rows = [['Spalte', 'Typ', 'Format', 'verschiedene', 'leer', 'Notiz']]
      for (const c of s.columns)
        rows.push([c.name, c.type, c.locale || '—', de(c.distinct), pct(c.nullShare), c.annotation || '—'])
      return `${head}\n\n${table(rows)}`
    })
    .join('\n\n')
}

export function renderPipeline(pipeline) {
  if (!pipeline || !pipeline.steps || pipeline.steps.length === 0)
    return 'Die Pipeline ist leer. Es sind nur die Quellen oben geladen, noch kein Step.'
  return [
    'Das ist das Rezept, das gerade geladen ist. Bau darauf auf und gib mir das',
    'ganze geänderte Rezept zurück, nicht nur die neuen Steps.',
    '',
    '```json',
    JSON.stringify(pipeline, null, 2),
    '```',
  ].join('\n')
}

export function renderBlock(template, ctx) {
  return template
    .replace('{{FRAGE}}', ctx.question.trim())
    .replace('{{PROFIL}}', renderProfile(ctx.sources))
    .replace('{{PIPELINE}}', renderPipeline(ctx.pipeline))
}

// The blocks that live in this directory. `--check` with no arguments verifies
// all of them, so a template edit cannot leave one of the three stale.
const PAIRS = [
  ['example-context.json', 'prompt-block-example.txt'],
  ['context-no-annotations.json', 'prompt-block-no-annotations.txt'],
  ['context-aggregate.json', 'prompt-block-aggregate.txt'],
]

const template = readFileSync(resolve(here, 'block-template.txt'), 'utf8')
const pairs = check && args.length === 0 ? PAIRS : [[ctxPath, outPath]]
let stale = 0

for (const [ctxFile, outFile] of pairs) {
  const ctxAbs = resolve(here, ctxFile)
  const outAbs = resolve(here, outFile)
  const out = renderBlock(template, JSON.parse(readFileSync(ctxAbs, 'utf8')))

  for (const ph of ['{{FRAGE}}', '{{PROFIL}}', '{{PIPELINE}}'])
    if (out.includes(ph)) {
      console.error(`Placeholder ${ph} survived rendering of ${outFile}.`)
      process.exit(1)
    }

  if (check) {
    if (readFileSync(outAbs, 'utf8') !== out) {
      console.error(`STALE: ${outFile} does not match block-template.txt + ${ctxFile}. Re-run: node render-block.mjs ${ctxFile} ${outFile}`)
      stale++
    } else {
      console.log(`fresh: ${outFile} (${Buffer.byteLength(out)} B)`)
    }
  } else {
    writeFileSync(outAbs, out)
    console.log(`wrote ${outFile} (${Buffer.byteLength(out)} B)`)
  }
}

if (stale) process.exit(1)
