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

  // The independent test. Written by an assistant with no access to this
  // repository, from prompt-block-example.txt and nothing else. These are the
  // only cases in this file that are evidence about machine authorship rather
  // than about the documentation's self-consistency.
  { file: 'i1-gemini.json', task: 'Unabhängig, Gemini: prompt-block-example.txt, sonst nichts.', measured: 'ok', independent: 'gemini', round: 1, block: 'example', requires: () => [...FULL_TASK, REQ.unionPreserved] },
  { file: 'i2-sonnet5.json', task: 'Unabhängig, Sonnet 5: derselbe Block, anderer Anbieter.', measured: 'ok', independent: 'sonnet5', round: 1, block: 'example', requires: () => [...FULL_TASK, REQ.unionPreserved] },
  { file: 'i3-gemini-noannotations.json', task: 'Unabhängig, Gemini: derselbe Block ohne Spaltennotizen — findet es den Join-Schlüssel ohne Wegweiser?', measured: 'ok', independent: 'gemini', round: 1, block: 'no-annotations', requires: () => [...FULL_TASK, REQ.unionPreserved] },
  // The aggregate probe is not about the JSON. Its question needs a Step kind
  // that does not exist, so the pass condition lives in the prose: say so
  // rather than invent a kind. The Recipe it returned is the unchanged Union.
  { file: 'i4-gemini-block-aggregate.json', task: 'Unabhängig, Gemini: eine Frage, die die drei Step-Arten nicht beantworten können.', measured: 'ok', independent: 'gemini', round: 1, block: 'aggregate', requires: () => [REQ.unionPreserved, REQ.marchColumnReconciled] },
  // The sharpest probe: no annotations AND no Pipeline, so neither the join key
  // nor the March spelling is handed over. Nothing here may be copied.
  { file: 'i5-gemini-empty-pipeline.json', task: 'Unabhängig, Gemini: leere Pipeline, keine Spaltennotizen — findet es Join-Schlüssel und März-Umbenennung selbst?', measured: 'ok', independent: 'gemini', round: 1, block: 'empty-pipeline', requires: () => FULL_TASK },
]

// A foreign assistant must not invent a Step kind — the block forbids it and
// `x5` proves the loader catches it, but instruction-following is the thing
// under test in the aggregate probe.
const IMPLEMENTED_KINDS = ['union', 'join', 'filter']

// --- did the answer actually solve the task? -----------------------------
//
// "It loads" is a weak thing to measure. A Recipe can be structurally perfect
// and answer a different question — and for a model-authored Recipe that is the
// interesting failure, not a malformed one. So each independent case carries
// named requirements evaluated against the loaded graph.
//
// They are deliberately loose about *how*: the March column can be reconciled by
// mapping either spelling onto the other, and the Join may take its inputs in
// either order. What they are strict about is *that* it happened.
//
// A missed requirement does not fail the run. It is a research finding — the
// model may have chosen differently and still be right — so it is reported
// loudly and counted, while pass/fail keeps meaning "loads / does not load".

const of = (g, kind) => g.nodes.filter((n) => n.kind === kind)
const wired = (g, id) => g.nodes.find((n) => n.id === id)

const REQ = {
  unionOverThreeMonths: [
    'Union über alle drei Monatsdateien',
    (g) => of(g, 'union').some((u) => u.inputs.filter(Boolean).length >= 3),
  ],
  marchColumnReconciled: [
    'März-Spalte „Kunden-Nr“ vereinheitlicht',
    (g) =>
      of(g, 'union').some((u) =>
        (u.config?.mappings || []).some((m) => [m?.from, m?.target].includes('Kunden-Nr')),
      ),
  ],
  joinOnCustomerKey: [
    'Join über KundenNr = Nr',
    (g) =>
      of(g, 'join').some((j) =>
        (j.config?.keys || []).some((k) => {
          const pair = [k?.left, k?.right].sort().join('|')
          return pair === 'KundenNr|Nr'
        }),
      ),
  ],
  joinIsLeft: ['Left Join, damit keine Bestellung verlorengeht', (g) => of(g, 'join').some((j) => j.config?.type === 'left')],
  filterAboveThousand: [
    'Filter Betrag > 1000',
    (g) =>
      of(g, 'filter').some((f) =>
        (f.config?.conditions || []).some(
          (c) => c?.column === 'Betrag' && c.op === 'gt' && String(c.value) === '1000',
        ),
      ),
  ],
  resultIsTheFilter: ['Ergebnis-Step ist der Filter', (g) => wired(g, g.resultId)?.kind === 'filter'],
  everythingPlaced: ['Positionen gesetzt, nichts liegt auf 0,0', (g) => !g.nodes.every((n) => n.x === 0 && n.y === 0)],
  unionPreserved: ['Die vorgegebene Union unverändert übernommen', (g) => of(g, 'union').some((u) => u.id === 'u1')],
}

// The full task both the worked example and the empty-Pipeline probe ask for.
const FULL_TASK = [
  REQ.unionOverThreeMonths,
  REQ.marchColumnReconciled,
  REQ.joinOnCustomerKey,
  REQ.joinIsLeft,
  REQ.filterAboveThousand,
  REQ.resultIsTheFilter,
  REQ.everythingPlaced,
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

// One case through one load path. `requires` is evaluated against the graph the
// load produced, so it belongs on the *measured* path: `loadRecipe` would apply
// the fallback layout first and `everythingPlaced` would then credit the tool
// for placement the model never did.
function run(load, text, raw, requires) {
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
    requirements: (requires ? requires() : []).map(([name, test]) => ({ name, met: !!test(parsed.graph) })),
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
    measured: run(fromRecipe, text, c.raw, c.requires),
    proposed: run(loadRecipe, text, c.raw),
  }
  if (c.was) row.closedGap = c.was
  if (c.open) row.stillOpen = c.open
  if (c.independent) {
    row.independent = c.independent
    row.round = c.round
    row.block = c.block
    const doc = JSON.parse(text)
    row.invented = (doc.steps || []).map((s) => s.kind).filter((k) => !IMPLEMENTED_KINDS.includes(k))
    // The format never says what type a comparison value has. Record what each
    // author chose, because that is the evidence for making it a decision.
    row.valueTypes = [
      ...new Set(
        (doc.steps || [])
          .filter((st) => st.kind === 'filter')
          .flatMap((st) => (st.config?.conditions || []).map((c) => typeof c?.value)),
      ),
    ]
  }

  const verdict = (want, got, match) => {
    if (want === 'ok') return got.accepted && got.roundTrip
    return !got.accepted && got.errors.some((e) => e.includes(match))
  }
  row.pass =
    verdict(row.expect.measured, row.measured, c.match) &&
    verdict(row.expect.proposed, row.proposed, c.proposedMatch || c.match) &&
    (!c.expectLaidOut || row.proposed.laidOut) &&
    (row.invented || []).length === 0
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
const independent = results.filter((r) => r.independent)
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
  independentCases: independent.length,
  independentAcceptedFirstRound: independent.filter((r) => r.round === 1 && r.pass).length,
  requirementsChecked: independent.reduce((n, r) => n + (r.measured.requirements || []).length, 0),
  requirementsMet: independent.reduce((n, r) => n + (r.measured.requirements || []).filter((q) => q.met).length, 0),
  filterValueTypes: [...new Set(independent.flatMap((r) => r.valueTypes || []))],
  failures,
  evidenceClass: independent.length
    ? `t*/x*/s* weak — same model authored the format, the documentation and those cases. i* independent: ${independent.map((r) => `${r.independent} r${r.round}`).join(', ')}.`
    : 'weak — same model authored the format, the documentation and these cases',
}

writeFileSync(resolve(here, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n')

if (!quiet) {
  const mark = (r) => (r.pass ? ' ok ' : 'FAIL')
  const show = (rows, line) => rows.forEach((r) => console.log(`  [${mark(r)}] ${r.case.padEnd(38)}${line(r)}`))

  if (independent.length) {
    console.log('\nTHE INDEPENDENT TEST — written without access to this repository\n')
    for (const r of independent) {
      console.log(
        `  [${mark(r)}] ${r.case.padEnd(38)}${r.independent} / ${r.block}, Runde ${r.round}: ` +
          (r.proposed.accepted
            ? `angenommen — ${r.proposed.nodes} Steps, ${r.proposed.edges} Kanten, result=${r.proposed.result}, ` +
              `round trip ${r.proposed.roundTrip ? 'identisch' : 'ABWEICHEND'}` +
              (r.proposed.laidOut ? ', ohne ui (Layout gesetzt)' : '') +
              (r.invented.length ? `, ERFUNDENE ART: ${r.invented.join(', ')}` : '')
            : `abgelehnt — ${r.proposed.errors[0]}`),
      )
      for (const q of r.measured.requirements || [])
        console.log(`         ${q.met ? '·' : '✗ VERFEHLT'} ${q.name}`)
      if (r.valueTypes.length) console.log(`         → Filter-Vergleichswert als ${r.valueTypes.join(' und ')}`)
    }
  }

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
