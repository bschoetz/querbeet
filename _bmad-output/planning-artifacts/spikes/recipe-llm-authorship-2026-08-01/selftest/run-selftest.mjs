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
// Two load paths run over every case:
//   measured  — the Editor spike's `fromRecipe` exactly as it was measured
//   proposed  — `proposed/load-recipe.mjs`: the same plus the column check, the
//               Source-under-steps refusal, and the fallback layout
// Reporting both is the point. It keeps the Editor spike's finding intact and
// shows precisely what the new checks add.
//
//   node run-selftest.mjs            report to stdout, write results.json
//   node run-selftest.mjs --quiet    results.json only
//
// Exit 1 if any case deviates from its expectation on either path.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fromRecipe, toRecipe } from '../../editor-vueflow-2026-08-01/app/src/model/recipe.js'
import { edgesOf } from '../../editor-vueflow-2026-08-01/app/src/model/graph.js'
import { loadRecipe } from '../proposed/load-recipe.mjs'
import { unpropagatedKinds } from '../proposed/columns.js'

const here = dirname(fileURLToPath(import.meta.url))
const quiet = process.argv.includes('--quiet')

// `task` is the request a model would have been given. `measured` and
// `proposed` are what each load path must do with the answer; `match` is a
// substring the refusal must contain, because FR-28 requires the message be
// specific enough to paste back. `proposed` defaults to `measured`.
const CASES = [
  { file: 't1-linear.json', task: 'Aus der Januar-Datei nur die Zeilen der Region Süd.', measured: 'ok' },
  { file: 't2-join.json', task: 'An jede Bestellung den Kundennamen aus der Kundenliste hängen.', measured: 'ok' },
  { file: 't3-union-filter.json', task: 'Drei Monatsdateien zusammenhängen — die Kundennummer heißt im März anders — und nur Bestellungen über 1000 Euro behalten.', measured: 'ok' },
  { file: 't4-two-unions.json', task: 'Zwei Monate und zwei Kundenlisten je zusammenhängen, verbinden, dann auf Süd über 500 filtern.', measured: 'ok' },
  { file: 't5-modify.json', task: 'Die Aufgabe aus prompt-block-example.txt: bestehende Pipeline erweitern, nicht neu bauen.', measured: 'ok' },

  { file: 'x1-cycle.json', task: 'Zwei Filter, die sich gegenseitig als Eingang nennen.', measured: 'reject', match: 'enthält einen Kreis' },
  { file: 'x2-join-arity.json', task: 'Drei Tabellen in einem Join verbinden.', measured: 'reject', match: 'nimmt genau 2 Eingänge' },
  { file: 'x3-result-is-source.json', task: 'Eine Quelle als Ergebnis-Step ausweisen.', measured: 'reject', match: 'ist eine Quelle' },
  { file: 'x4-dangling.json', task: 'Auf eine Kundenliste verweisen, die nicht geladen ist.', measured: 'reject', match: 'das es nicht gibt' },
  { file: 'x5-unknown-kind.json', task: 'Summe je Region — braucht eine Step-Art, die es nicht gibt.', measured: 'reject', match: 'unbekannte Step-Art' },
  { file: 'x6-no-result.json', task: 'Rezept ohne "result".', measured: 'reject', match: 'keinen Ergebnis-Step' },
  { file: 'x7-duplicate-id.json', task: 'Zwei Quellen mit derselben Kennung.', measured: 'reject', match: 'kommt mehrfach vor' },
  { file: 'x8-broken-json.txt', task: 'Abgeschnittene Antwort mit Komma vor der schließenden Klammer.', measured: 'reject', match: 'kein gültiges JSON', raw: true },

  // Found by this spike as silent acceptances; three are closed by the proposed
  // path, one is closed by amending the PRD instead.
  {
    file: 's1-unknown-column.json',
    task: 'Auf eine Spalte filtern, die keine Quelle hat.',
    measured: 'ok',
    proposed: 'reject',
    proposedMatch: '„Abteilung“',
    was: 'Silent acceptance. FR-28 requires a Recipe naming a column that does not exist to be refused naming it.',
  },
  {
    file: 's2-orphan.json',
    task: 'Ein zweiter Zweig, der nicht zum Ergebnis beiträgt.',
    measured: 'ok',
    open: 'Deliberately still accepted. The Editor marks orphans in the UI rather than refusing them, and an author mid-build always has some; FR-28 is being amended to drop "disconnected" rather than the loader changed.',
  },
  {
    file: 's3-no-ui.json',
    task: 'Rezept ohne "ui" — der häufigste Fall, wenn ein Modell die Positionen weglässt.',
    measured: 'ok',
    expectLaidOut: true,
    was: 'Silent acceptance. Every Step landed on 0,0; the fallback layout now places them.',
  },
  {
    file: 's4-source-in-steps.json',
    task: 'Eine Quelle im Abschnitt "steps" statt in "sources".',
    measured: 'ok',
    proposed: 'reject',
    proposedMatch: 'gehört unter „sources“',
    was: 'Silent acceptance. One graph had two encodings and the block documents one of them.',
  },

  // Column checking, once it exists, has to bite on propagated schemas and not
  // only on what a Source declares.
  { file: 'x9-join-key-missing.json', task: 'Join über einen Schlüssel, den die rechte Tabelle nicht hat.', measured: 'ok', proposed: 'reject', proposedMatch: 'die rechte Tabelle hat sie nicht' },
  { file: 'x10-union-mapping-missing.json', task: 'Union ordnet eine Spalte zu, die kein Eingang führt.', measured: 'ok', proposed: 'reject', proposedMatch: 'keiner seiner Eingänge hat sie' },
  { file: 'x11-filter-after-union-drop.json', task: 'Filter auf eine Spalte, die die Union mit unmatched:drop verworfen hat.', measured: 'ok', proposed: 'reject', proposedMatch: '„Region“' },
  { file: 's5-source-without-columns.json', task: 'Quelle ohne Spaltenangabe, Filter darauf.', measured: 'ok', open: 'No Input Contract, so no schema and no check — silence here is correct, not a gap.' },
]

function shape(graph) {
  return {
    nodes: graph.nodes.length,
    edges: edgesOf(graph).map((e) => e.id).sort(),
    result: graph.resultId,
  }
}

function positions(graph) {
  return graph.nodes.map((n) => `${n.id}@${n.x},${n.y}`).sort()
}

// One case through one load path.
function run(load, text, raw) {
  const parsed = load(raw ? text : JSON.parse(text))
  if (!parsed.ok) return { accepted: false, errors: parsed.errors }
  const s = shape(parsed.graph)
  const back = fromRecipe(toRecipe(parsed.graph, { name: 'rt' }))
  return {
    accepted: true,
    ...s,
    edges: s.edges.length,
    positions: positions(parsed.graph),
    allAtOrigin: positions(parsed.graph).every((p) => p.endsWith('@0,0')),
    laidOut: parsed.laidOut === true,
    notes: parsed.notes || [],
    roundTrip: back.ok && JSON.stringify(shape(back.graph)) === JSON.stringify(s),
  }
}

const results = []
let failures = 0

for (const c of CASES) {
  const text = readFileSync(resolve(here, 'cases', c.file), 'utf8')
  const row = {
    case: c.file,
    task: c.task,
    bytes: Buffer.byteLength(text),
    expect: { measured: c.measured, proposed: c.proposed || c.measured },
    measured: run(fromRecipe, text, c.raw),
    proposed: run(loadRecipe, text, c.raw),
  }
  if (c.was) row.closedGap = c.was
  if (c.open) row.stillOpen = c.open

  const verdict = (want, got, match) => {
    if (want === 'ok') return got.accepted && got.roundTrip
    return !got.accepted && got.errors.some((e) => e.includes(match))
  }
  row.pass =
    verdict(row.expect.measured, row.measured, c.match) &&
    verdict(row.expect.proposed, row.proposed, c.proposedMatch || c.match) &&
    (!c.expectLaidOut || row.proposed.laidOut)
  if (!row.pass) failures++
  results.push(row)
}

// A Step kind added without a propagation case would turn the column check off
// silently for everything downstream of it. Assert rather than assume.
const unpropagated = unpropagatedKinds()
if (unpropagated.length) {
  failures++
  results.push({ case: 'KINDS coverage', pass: false, errors: [`No column propagation for: ${unpropagated.join(', ')}`] })
}

const authored = results.filter((r) => r.case.startsWith('t'))
const refusals = results.filter((r) => r.expect?.measured === 'reject')
const closed = results.filter((r) => r.closedGap)
const summary = {
  cases: CASES.length,
  authored: authored.length,
  authoredAcceptedBoth: authored.filter((r) => r.measured.accepted && r.proposed.accepted).length,
  roundTripped: authored.filter((r) => r.proposed.roundTrip).length,
  refusals: refusals.length,
  refusalsNamed: refusals.filter((r) => r.pass).length,
  gapsClosedByProposed: closed.length,
  newRefusalsFromProposed: results.filter((r) => r.expect?.measured === 'ok' && r.expect?.proposed === 'reject').length,
  stillOpenByDecision: results.filter((r) => r.stillOpen).length,
  failures,
  evidenceClass: 'weak — same model authored the format, the documentation and these cases',
}

writeFileSync(resolve(here, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n')

if (!quiet) {
  const mark = (r) => (r.pass ? ' ok ' : 'FAIL')
  const show = (rows, line) => rows.forEach((r) => console.log(`  [${mark(r)}] ${r.case.padEnd(38)}${line(r)}`))

  console.log('\nAuthored from the block — must load on both paths\n')
  show(authored, (r) => `${r.proposed.nodes} Steps, ${r.proposed.edges} Kanten, result=${r.proposed.result}, round trip ${r.proposed.roundTrip ? 'identisch' : 'ABWEICHEND'}`)

  console.log('\nDefects the block warns about — refused by name, unchanged\n')
  show(refusals, (r) => r.measured.errors[0])

  console.log('\nWhat the proposed checks add — accepted before, refused now\n')
  show(
    results.filter((r) => r.expect?.measured === 'ok' && r.expect?.proposed === 'reject'),
    (r) => r.proposed.errors[0],
  )

  console.log('\nAccepted on both paths, by decision\n')
  show(
    results.filter((r) => r.stillOpen),
    (r) => r.stillOpen,
  )

  const s3 = results.find((r) => r.case === 's3-no-ui.json')
  console.log('\nFallback layout\n')
  console.log(`  [${mark(s3)}] ${'s3-no-ui.json'.padEnd(38)}measured: ${s3.measured.positions.join(' ')}`)
  console.log(`  ${''.padEnd(45)}proposed: ${s3.proposed.positions.join(' ')}`)

  const noted = results.filter((r) => r.proposed.notes?.length)
  if (noted.length) {
    console.log('\nNotes, not refusals\n')
    noted.forEach((r) => r.proposed.notes.forEach((n) => console.log(`  [note] ${r.case.padEnd(38)}${n}`)))
  }

  console.log(
    `\n${summary.authoredAcceptedBoth}/${summary.authored} authored Recipes load on both paths and round-trip; ` +
      `${summary.refusalsNamed}/${summary.refusals} defects refused by name; ` +
      `${summary.newRefusalsFromProposed} further defects refused only by the proposed path.`,
  )
  console.log(`Evidence class: ${summary.evidenceClass}.\n`)
}

process.exit(failures ? 1 : 0)
