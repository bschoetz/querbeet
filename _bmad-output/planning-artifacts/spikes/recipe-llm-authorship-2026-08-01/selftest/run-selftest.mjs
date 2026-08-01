#!/usr/bin/env node
// FR-28 self-test: do Recipes written from block-template.txt alone load?
//
// WHAT THIS IS EVIDENCE FOR, AND WHAT IT IS NOT. The Recipes under cases/ were
// authored from the prompt block by the same model that wrote the block and the
// validator behind it. That makes this a consistency check on the documentation,
// not a measurement of machine authorship. It can only show the format is
// *self-consistent* — that what the block describes is what the loader accepts.
// The real test is one independent assistant, given nothing but
// prompt-block-example.txt, in a session that has never seen this repository.
// See findings.md, "What this does not show".
//
//   node run-selftest.mjs            report to stdout, write results.json
//   node run-selftest.mjs --quiet    results.json only
//
// Exit 1 if any case deviates from its expectation. Cases marked `gap` are
// expected to be ACCEPTED even though FR-28 arguably requires a rejection —
// they pass the run and are reported as gaps, not failures.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fromRecipe, toRecipe } from '../../editor-vueflow-2026-08-01/app/src/model/recipe.js'
import { edgesOf } from '../../editor-vueflow-2026-08-01/app/src/model/graph.js'

const here = dirname(fileURLToPath(import.meta.url))
const quiet = process.argv.includes('--quiet')

// `task` is the request a model would have been given; `expect` is what the
// loader must do with the answer; `match` is a substring the refusal must
// contain, because FR-28 requires the message be specific enough to paste back.
const CASES = [
  { file: 't1-linear.json', task: 'Aus der Januar-Datei nur die Zeilen der Region Süd.', expect: 'ok' },
  { file: 't2-join.json', task: 'An jede Bestellung den Kundennamen aus der Kundenliste hängen.', expect: 'ok' },
  { file: 't3-union-filter.json', task: 'Drei Monatsdateien zusammenhängen — die Kundennummer heißt im März anders — und nur Bestellungen über 1000 Euro behalten.', expect: 'ok' },
  { file: 't4-two-unions.json', task: 'Zwei Monate und zwei Kundenlisten je zusammenhängen, verbinden, dann auf Süd über 500 filtern.', expect: 'ok' },
  { file: 't5-modify.json', task: 'Die Aufgabe aus prompt-block-example.txt: bestehende Pipeline erweitern, nicht neu bauen.', expect: 'ok' },

  { file: 'x1-cycle.json', task: 'Zwei Filter, die sich gegenseitig als Eingang nennen.', expect: 'reject', match: 'enthält einen Kreis' },
  { file: 'x2-join-arity.json', task: 'Drei Tabellen in einem Join verbinden.', expect: 'reject', match: 'nimmt genau 2 Eingänge' },
  { file: 'x3-result-is-source.json', task: 'Eine Quelle als Ergebnis-Step ausweisen.', expect: 'reject', match: 'ist eine Quelle' },
  { file: 'x4-dangling.json', task: 'Auf eine Kundenliste verweisen, die nicht geladen ist.', expect: 'reject', match: 'das es nicht gibt' },
  { file: 'x5-unknown-kind.json', task: 'Summe je Region — braucht eine Step-Art, die es nicht gibt.', expect: 'reject', match: 'unbekannte Step-Art' },
  { file: 'x6-no-result.json', task: 'Rezept ohne "result".', expect: 'reject', match: 'keinen Ergebnis-Step' },
  { file: 'x7-duplicate-id.json', task: 'Zwei Quellen mit derselben Kennung.', expect: 'reject', match: 'kommt mehrfach vor' },
  { file: 'x8-broken-json.txt', task: 'Abgeschnittene Antwort mit Komma vor der schließenden Klammer.', expect: 'reject', match: 'kein gültiges JSON', raw: true },

  { file: 's1-unknown-column.json', task: 'Auf eine Spalte filtern, die keine Quelle hat.', expect: 'ok', gap: 'FR-28 requires a Recipe referencing a column that does not exist to be rejected naming the reference. Column names are never checked.' },
  { file: 's2-orphan.json', task: 'Ein zweiter Zweig, der nicht zum Ergebnis beiträgt.', expect: 'ok', gap: 'FR-28 requires a disconnected graph to be rejected naming the defect. orphans() exists but validate() does not call it.' },
  { file: 's3-no-ui.json', task: 'Rezept ohne "ui" — der häufigste Fall, wenn ein Modell die Positionen weglässt.', expect: 'ok', gap: 'Every node lands on 0,0. Accepted, and unusable until dragged apart by hand; there is no auto-layout.' },
  { file: 's4-source-in-steps.json', task: 'Eine Quelle im Abschnitt "steps" statt in "sources".', expect: 'ok', gap: 'The block says sources live only in `sources`. The loader accepts them in `steps` too, so one graph has two encodings.' },
]

function shape(graph) {
  return {
    nodes: graph.nodes.length,
    edges: edgesOf(graph).map((e) => e.id).sort(),
    result: graph.resultId,
    positions: graph.nodes.map((n) => `${n.id}@${n.x},${n.y}`).sort(),
  }
}

const results = []
let failures = 0

for (const c of CASES) {
  const path = resolve(here, 'cases', c.file)
  const text = readFileSync(path, 'utf8')
  const parsed = fromRecipe(c.raw ? text : JSON.parse(text))
  const row = { case: c.file, task: c.task, expect: c.expect, bytes: Buffer.byteLength(text) }

  if (parsed.ok) {
    row.accepted = true
    const s = shape(parsed.graph)
    row.nodes = s.nodes
    row.edges = s.edges.length
    row.result = s.result
    row.allAtOrigin = s.positions.every((p) => p.endsWith('@0,0'))

    // Round trip: what the loader accepted must serialize back to something
    // that loads to the identical graph. This is the Q4 property re-checked
    // against machine-shaped input rather than editor-shaped input.
    const back = fromRecipe(toRecipe(parsed.graph, { name: 'rt' }))
    row.roundTrip = back.ok && JSON.stringify(shape(back.graph)) === JSON.stringify(s)
    if (!row.roundTrip) row.roundTripErrors = back.errors || ['shape differs after round trip']
  } else {
    row.accepted = false
    row.errors = parsed.errors
  }

  if (c.expect === 'ok') {
    row.pass = row.accepted && row.roundTrip !== false
    if (c.gap) row.gap = c.gap
  } else {
    row.matched = !row.accepted && parsed.errors.some((e) => e.includes(c.match))
    row.expectedSubstring = c.match
    row.pass = row.matched
  }
  if (!row.pass) failures++
  results.push(row)
}

const valid = results.filter((r) => r.expect === 'ok' && !r.gap)
const summary = {
  cases: results.length,
  authored: valid.length,
  authoredAccepted: valid.filter((r) => r.accepted).length,
  roundTripped: valid.filter((r) => r.roundTrip).length,
  rejections: results.filter((r) => r.expect === 'reject').length,
  rejectionsNamed: results.filter((r) => r.expect === 'reject' && r.matched).length,
  gaps: results.filter((r) => r.gap).length,
  failures,
  evidenceClass: 'weak — same model authored the format, the documentation and these cases',
}

writeFileSync(resolve(here, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n')

if (!quiet) {
  const mark = (r) => (r.pass ? ' ok ' : 'FAIL')
  console.log('\nAuthored from the block — expected to load\n')
  for (const r of results.filter((x) => x.expect === 'ok' && !x.gap))
    console.log(`  [${mark(r)}] ${r.case.padEnd(24)} ${r.nodes} Steps, ${r.edges} Kanten, result=${r.result}, round trip ${r.roundTrip ? 'identisch' : 'ABWEICHEND'}`)

  console.log('\nDefects the block warns about — expected to be refused by name\n')
  for (const r of results.filter((x) => x.expect === 'reject'))
    console.log(`  [${mark(r)}] ${r.case.padEnd(24)} ${r.accepted ? 'ANGENOMMEN' : r.errors[0]}`)

  console.log('\nAccepted, but arguably should not be — FR-28 gaps\n')
  for (const r of results.filter((x) => x.gap))
    console.log(`  [${mark(r)}] ${r.case.padEnd(24)} ${r.gap}`)

  console.log(
    `\n${summary.authoredAccepted}/${summary.authored} authored Recipes load and round-trip; ` +
      `${summary.rejectionsNamed}/${summary.rejections} defects refused by name; ${summary.gaps} gaps.`,
  )
  console.log(`Evidence class: ${summary.evidenceClass}.\n`)
}

process.exit(failures ? 1 : 0)
