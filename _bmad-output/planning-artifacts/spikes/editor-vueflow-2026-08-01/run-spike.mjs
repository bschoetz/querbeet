// Drives the built single-file Editor from a real file:// URL in Chromium and
// Firefox, headless, and answers the spike's four questions with measurements
// rather than with reading. Everything it asserts, it asserts against the same
// build a user would open.
//
//   node run-spike.mjs        (expects app/dist/index.html to exist)

import { chromium, firefox } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, 'app/dist')
const distFile = resolve(distDir, 'index.html')

// --- the build gate, before any browser opens ---------------------------
const HAZARDS = [
  ['dynamic import', /\bimport\s*\(/],
  ['fetch(', /\bfetch\s*\(/],
  ['new Worker', /new\s+Worker\s*\(/],
  ['importScripts', /importScripts\s*\(/],
  ['@font-face', /@font-face/],
  ['XMLHttpRequest', /XMLHttpRequest/],
]

const html = readFileSync(distFile, 'utf8')
const distFiles = readdirSync(distDir, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => d.name)
const build = {
  distFiles,
  singleFile: distFiles.length === 1,
  bytes: statSync(distFile).size,
  hazards: Object.fromEntries(
    HAZARDS.map(([name, re]) => [name, (html.match(new RegExp(re.source, 'g')) || []).length]),
  ),
  externalSrc: [...html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)=["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:') && !u.startsWith('#')),
  nonDataUrls: [...html.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)]
    .map((m) => m[2])
    .filter((u) => !u.startsWith('data:') && !u.startsWith('#')),
}

const url = pathToFileURL(distFile).href
const results = { build, engines: {} }

const ANCHOR_TOLERANCE = 2.0 // screen px

for (const [engine, driver] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await driver.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  const requests = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`)
  })
  page.on('request', (r) => requests.push(r.url()))
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`))

  const out = { engine, version: browser.version(), errors, extraRequests: [] }
  results.engines[engine] = out

  try {
    await page.goto(url)
    await page.waitForFunction(() => !!window.__qb, null, { timeout: 60000 })
    const tick = () => page.evaluate(() => window.__qb.tick())

    // =====================================================================
    // Q1 — do connection anchors survive variable-height node bodies?
    // =====================================================================
    const anchorCase = async (label, action) => {
      const before = await page.evaluate(() => ({
        heights: window.__qb.nodeHeights(),
        anchors: window.__qb.measureAnchors(),
      }))
      await action()
      await tick()
      const after = await page.evaluate(() => ({
        heights: window.__qb.nodeHeights(),
        anchors: window.__qb.measureAnchors(),
      }))
      const delta = await page.evaluate(
        ([b, a]) => window.__qb.offsetDelta(b, a),
        [before.anchors, after.anchors],
      )
      const grew = Object.keys(after.heights).filter(
        (id) => Math.abs((after.heights[id] || 0) - (before.heights[id] || 0)) > 1,
      )
      // How far did the handles actually travel? If they did not move, the case
      // proves nothing and must not be counted as a pass.
      const handleTravelPx = Math.max(
        0,
        ...after.anchors.map((a) => {
          const b = before.anchors.find((x) => x.id === a.id)
          return b ? Math.abs((a.targetHandleY ?? 0) - (b.targetHandleY ?? 0)) : 0
        }),
      )
      return {
        label,
        nodesThatChangedHeight: grew,
        heightDeltas: Object.fromEntries(
          grew.map((id) => [id, +(after.heights[id] - (before.heights[id] || 0)).toFixed(1)]),
        ),
        handleTravelPx: +handleTravelPx.toFixed(1),
        anchorMoved: handleTravelPx > 1,
        offsetDeltaPx: delta.worstPx,
        pass: delta.worstPx <= ANCHOR_TOLERANCE && handleTravelPx > 1,
        anchors: after.anchors,
      }
    }

    const click = (t, times = 1) => async () => {
      for (let i = 0; i < times; i++) await page.click(`[data-t="${t}"]`)
    }

    const q1 = { tolerancePx: ANCHOR_TOLERANCE, cases: [] }
    q1.baseline = await page.evaluate(() => ({
      anchors: window.__qb.measureAnchors(),
      convention: window.__qb.anchorConvention(),
      heights: window.__qb.nodeHeights(),
    }))
    q1.cases.push(await anchorCase('Filter: +3 Bedingungen (Anker mittig, wandert um halbe Höhe)', click('add-cond-f1', 3)))
    q1.cases.push(await anchorCase('Join: +3 Schlüssel (zwei Anker bei 1/3 und 2/3)', click('add-key-j1', 3)))
    q1.cases.push(await anchorCase('Union: +4 Zuordnungen', click('add-mapping-u1', 4)))
    // The hard half: a new input both grows the node and adds a handle that has
    // never been measured, and it moves the two existing handles.
    q1.cases.push(await anchorCase('Union: +1 Eingang (neuer Anker, bestehende wandern)', click('add-input-u1', 1)))
    // A brand-new handle carrying a brand-new edge: nothing about it has ever
    // been measured, so its anchor is the strictest case in the set.
    q1.newHandleConnect = await page.evaluate(async () => {
      const before = window.__qb.measureAnchors()
      const r = window.__qb.editor.connect('kd', 'u1', 2)
      await window.__qb.tick()
      const after = window.__qb.measureAnchors()
      const fresh = after.find((a) => a.id === 'kd->u1#2')
      return {
        ...r,
        existingEdgeDeltaPx: window.__qb.offsetDelta(before, after).worstPx,
        newEdgeOffset: fresh ? { dx: fresh.targetDx, dy: fresh.targetDy } : null,
        newEdgeRendered: !!fresh,
      }
    })
    // ...and shrinking again, which is the direction the closed bug reports miss.
    q1.cases.push(await anchorCase('Join: −2 Schlüssel (Höhe schrumpft)', async () => {
      await page.click('[data-t="key-j1-3"] button')
      await page.click('[data-t="key-j1-2"] button')
    }))
    // The fixed offset the anchors are measured against, stated rather than
    // assumed: the edge meets the handle's outer face, half a handle wide.
    const conventionDx = q1.baseline.anchors[0]?.targetDx ?? 0
    q1.anchorConvention = { ...q1.baseline.convention, observedOffsetPx: conventionDx }
    q1.newEdgeMatchesConvention =
      !!q1.newHandleConnect.newEdgeRendered &&
      Math.abs(q1.newHandleConnect.newEdgeOffset.dy) <= ANCHOR_TOLERANCE &&
      Math.abs(q1.newHandleConnect.newEdgeOffset.dx - conventionDx) <= ANCHOR_TOLERANCE
    q1.worstOffsetDeltaPx = Math.max(
      ...q1.cases.map((c) => c.offsetDeltaPx),
      q1.newHandleConnect.existingEdgeDeltaPx,
    )
    q1.pass =
      q1.worstOffsetDeltaPx <= ANCHOR_TOLERANCE &&
      q1.cases.every((c) => c.anchorMoved) &&
      q1.newEdgeMatchesConvention
    // The app must never call updateNodeInternals for this to be a fair test.
    q1.remeasureCallsInAppSource = (
      readFileSync(resolve(here, 'app/src/App.vue'), 'utf8') +
      readFileSync(resolve(here, 'app/src/nodes/StepFrame.vue'), 'utf8') +
      readFileSync(resolve(here, 'app/src/editor.js'), 'utf8')
    ).match(/updateNodeInternals/g)?.length ?? 0
    if (!q1.pass) {
      q1.withForcedRemeasure = await page.evaluate(async () => {
        const before = window.__qb.measureAnchors()
        window.__qb.forceRemeasure()
        await window.__qb.tick()
        return window.__qb.offsetDelta(before, window.__qb.measureAnchors()).worstPx
      })
    }
    out.q1 = q1

    // =====================================================================
    // Q2 — is the cycle guard in front of every mutation?
    // =====================================================================
    const q2 = {}

    // (a) the programmatic path: the door the Recipe loader and FR-28 use
    q2.programmatic = await page.evaluate(async () => {
      const before = JSON.stringify(window.__qb.graph())
      const r = window.__qb.editor.connect('j1', 'u1', 0)
      await window.__qb.tick()
      return {
        refused: !r.ok,
        reason: r.reason || null,
        graphUnchanged: JSON.stringify(window.__qb.graph()) === before,
        refusalShownInUi: !!document.querySelector('[data-t="refusal"]'),
        refusalText: document.querySelector('[data-t="refusal"]')?.textContent.trim() || null,
      }
    })
    q2.selfConnect = await page.evaluate(() => {
      const r = window.__qb.editor.connect('u1', 'u1', 0)
      return { refused: !r.ok, reason: r.reason || null }
    })

    // (b) the pointer path: a real drag from the Result Step's output back to
    //     an upstream Step's input
    const handleBox = async (nodeId, handleId) =>
      page
        .locator(`.vue-flow__handle[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`)
        .boundingBox()
    const from = await handleBox('j1', 'out')
    const to = await handleBox('u1', 'in-0')
    const edgesBeforeDrag = await page.evaluate(() => window.__qb.vfEdgeCount())
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
    await page.mouse.up()
    await tick()
    q2.pointer = await page.evaluate(
      (edgesBefore) => ({
        edgeCountBefore: edgesBefore,
        edgeCountAfter: window.__qb.vfEdgeCount(),
        refused: window.__qb.vfEdgeCount() === edgesBefore,
        refusalShownInUi: !!document.querySelector('[data-t="refusal"]'),
        refusalText: document.querySelector('[data-t="refusal"]')?.textContent.trim() || null,
        modelInputOfU1Slot0: window.__qb.graph().nodes.find((n) => n.id === 'u1').inputs[0],
      }),
      edgesBeforeDrag,
    )

    // (c) a valid drag, so (b) is not passing because dragging does not work
    const from2 = await handleBox('q2', 'out')
    const to2 = await handleBox('f1', 'in-0')
    await page.mouse.move(from2.x + from2.width / 2, from2.y + from2.height / 2)
    await page.mouse.down()
    await page.mouse.move(to2.x + to2.width / 2, to2.y + to2.height / 2, { steps: 20 })
    await page.mouse.up()
    await tick()
    q2.pointerControl = await page.evaluate(() => ({
      f1Input: window.__qb.graph().nodes.find((n) => n.id === 'f1').inputs[0],
      accepted: window.__qb.graph().nodes.find((n) => n.id === 'f1').inputs[0] === 'q2',
    }))
    // put it back, so later stages start from the seeded shape
    await page.evaluate(async () => {
      window.__qb.editor.connect('u1', 'f1', 0)
      await window.__qb.tick()
    })

    // (d) the library's own door — R6 [M8] measured addEdges creating a cycle
    //     silently. What does it do here, and why?
    const CYCLE = { id: 'cyc', source: 'j1', target: 'u1', targetHandle: 'in-0' }
    q2.libraryDoor = await page.evaluate(async (edge) => {
      const before = window.__qb.vfEdgeCount()
      window.__qb.clearChangeLog()
      window.__qb.rawAddEdges([edge])
      await window.__qb.tick()
      const log = window.__qb.changeLog()
      return {
        // Did the library object to the cycle at all? An emitted 'add' change
        // means it ran no cycle check — R6 [M8]'s finding, reconfirmed.
        emittedAddChange: log.some((c) => c.from === 'edges' && c.type === 'add' && c.id === edge.id),
        changeLog: log,
        edgeCountBefore: before,
        edgeCountAfter: window.__qb.vfEdgeCount(),
        landedInStore: window.__qb.vfEdgeCount() > before,
        modelUntouched: !JSON.stringify(window.__qb.graph()).includes('"cyc"'),
      }
    }, CYCLE)

    // ...and the mechanism, measured rather than read off the source: with the
    // default appliers switched back on, the same call does land.
    q2.mechanism = await page.evaluate(async (edge) => {
      const before = window.__qb.vfEdgeCount()
      window.__qb.setApplyDefault(true)
      // the subscription happens in a watcher, so it is one tick away
      await window.__qb.tick()
      window.__qb.rawAddEdges([edge])
      await window.__qb.tick()
      const withDefault = window.__qb.vfEdgeCount()
      window.__qb.setApplyDefault(false)
      await window.__qb.tick()

      // Does the projection re-assert itself? Only when the projection's own
      // inputs change. A rename touches neither position nor structure, so
      // nothing re-projects — correct, and worth knowing.
      window.__qb.editor.rename('u1', 'Halbjahr (umbenannt)')
      await window.__qb.tick()
      const afterRename = window.__qb.vfEdgeCount()

      // A structural change does re-project, and the phantom edge is gone.
      const n = window.__qb.graph().nodes.find((x) => x.id === 'f1')
      window.__qb.editor.move('f1', n.x + 1, n.y)
      await window.__qb.tick()
      const afterMove = window.__qb.vfEdgeCount()

      window.__qb.editor.rename('u1', 'Halbjahr')
      window.__qb.editor.move('f1', n.x, n.y)
      await window.__qb.tick()
      return {
        landsWhenApplyDefaultIsOn: withDefault > before,
        edgeCountBefore: before,
        edgeCountWithDefaultOn: withDefault,
        afterRename,
        healedByRename: afterRename === before,
        afterMove,
        healedByStructuralChange: afterMove === before,
      }
    }, CYCLE)

    // (e) FR-28: a cyclic Recipe is rejected naming the defect
    q2.cyclicRecipe = await page.evaluate(() => {
      const r = window.__qb.fromRecipe({
        format: 'querbeet/recipe@1',
        name: 'zyklisch',
        sources: [{ id: 'a', name: 'A', file: 'a.csv', columns: ['x'] }],
        steps: [
          { id: 'f', kind: 'filter', name: 'Filter', inputs: 'g', config: {} },
          { id: 'g', kind: 'filter', name: 'Filter 2', inputs: 'f', config: {} },
        ],
        result: 'f',
      })
      return { rejected: !r.ok, errors: r.errors || [] }
    })

    q2.pass =
      q2.programmatic.refused &&
      q2.programmatic.graphUnchanged &&
      !!q2.programmatic.reason &&
      q2.pointer.refused &&
      !!q2.pointer.refusalText &&
      q2.pointerControl.accepted &&
      q2.cyclicRecipe.rejected &&
      !q2.libraryDoor.landedInStore &&
      q2.libraryDoor.modelUntouched
    out.q2 = q2

    // =====================================================================
    // Q4 — does the Recipe format survive a round trip?
    // (run before the destructive Q3 edits, on the grown bodies from Q1)
    // =====================================================================
    const q4 = await page.evaluate(async () => {
      const canon = (g) => JSON.stringify({ nodes: g.nodes, resultId: g.resultId })
      const before = canon(window.__qb.graph())
      const recipe = window.__qb.toRecipe('Spike-Rezept')
      const text = JSON.stringify(recipe)

      window.__qb.clear()
      await window.__qb.tick()
      const clearedTo = window.__qb.graph().nodes.length

      const loaded = window.__qb.loadRecipe(text)
      await window.__qb.tick()
      const after = canon(window.__qb.graph())

      // A Recipe contains no data — here structurally, because tables never
      // live in the graph at all.
      const leaks = /v\d+_\d+/.test(text)

      // The linear case must be trivially writable: `inputs` as a bare string,
      // no ui block, no config beyond what the Step needs.
      const linear = window.__qb.fromRecipe({
        format: 'querbeet/recipe@1',
        name: 'linear',
        sources: [{ id: 'roh', name: 'Rohdaten', file: 'roh.csv', columns: ['a', 'b'] }],
        steps: [
          { id: 's1', kind: 'filter', name: 'Nur 2026', inputs: 'roh', config: { conditions: [{ column: 'a', op: 'equals', value: '2026' }], combine: 'and' } },
          { id: 's2', kind: 'filter', name: 'Ohne leere', inputs: 's1', config: { conditions: [{ column: 'b', op: 'contains', value: 'x' }], combine: 'and' } },
        ],
        result: 's2',
      })

      const bad = {
        json: window.__qb.fromRecipe('{ das ist kein json'),
        danglingRef: window.__qb.fromRecipe({
          format: 'querbeet/recipe@1',
          sources: [],
          steps: [{ id: 's1', kind: 'filter', name: 'F', inputs: 'gibtsnicht', config: {} }],
          result: 's1',
        }),
        wrongArity: window.__qb.fromRecipe({
          format: 'querbeet/recipe@1',
          sources: [{ id: 'a', name: 'A', file: 'a.csv', columns: [] }],
          steps: [{ id: 'j', kind: 'join', name: 'J', inputs: 'a', config: {} }],
          result: 'j',
        }),
        unknownKind: window.__qb.fromRecipe({
          format: 'querbeet/recipe@1',
          sources: [{ id: 'a', name: 'A', file: 'a.csv', columns: [] }],
          steps: [{ id: 'p', kind: 'pivot', name: 'P', inputs: 'a', config: {} }],
          result: 'p',
        }),
        noResult: window.__qb.fromRecipe({
          format: 'querbeet/recipe@1',
          sources: [{ id: 'a', name: 'A', file: 'a.csv', columns: [] }],
          steps: [],
        }),
        resultIsSource: window.__qb.fromRecipe({
          format: 'querbeet/recipe@1',
          sources: [{ id: 'a', name: 'A', file: 'a.csv', columns: [] }],
          steps: [],
          result: 'a',
        }),
      }

      return {
        clearedTo,
        loadedOk: loaded.ok,
        roundTripIdentical: before === after,
        beforeLength: before.length,
        recipeBytes: text.length,
        containsCellValues: leaks,
        // the table stayed behind, as it must: a Recipe has no data to restore
        tableStillAttached: window.__qb.tableRows('q1'),
        linear: { ok: linear.ok, errors: linear.errors || [], steps: linear.ok ? linear.graph.nodes.length : 0 },
        rejections: Object.fromEntries(
          Object.entries(bad).map(([k, v]) => [k, { rejected: !v.ok, errors: v.errors || [] }]),
        ),
        recipe,
      }
    })
    q4.pass =
      q4.roundTripIdentical &&
      q4.loadedOk &&
      !q4.containsCellValues &&
      q4.linear.ok &&
      Object.values(q4.rejections).every((r) => r.rejected)
    out.q4 = q4

    // =====================================================================
    // Q3 — does the ownership design hold under real edits?
    // =====================================================================
    const q3 = { design: 'B — das Modell ist maßgeblich, Vue Flow ist Ansicht', steps: [] }
    const driftNow = async (label) => {
      const d = await page.evaluate(() => window.__qb.drift())
      q3.steps.push({ label, ...d })
      return d
    }
    await driftNow('nach dem Laden des Rezepts')

    // a pointer drag of a node: the position must travel model-wards and back
    const nodeBox = await page.locator('.qb-node[data-node="f1"] .qb-kind').boundingBox()
    const posBefore = await page.evaluate(() => {
      const n = window.__qb.graph().nodes.find((x) => x.id === 'f1')
      return { x: n.x, y: n.y }
    })
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 130, nodeBox.y + nodeBox.height / 2 + 70, { steps: 25 })
    await page.mouse.up()
    await tick()
    q3.dragged = await page.evaluate((before) => {
      const n = window.__qb.graph().nodes.find((x) => x.id === 'f1')
      return {
        modelMoved: Math.abs(n.x - before.x) > 20 && Math.abs(n.y - before.y) > 20,
        modelPos: { x: Math.round(n.x), y: Math.round(n.y) },
        drift: window.__qb.drift(),
      }
    }, posBefore)
    await driftNow('nach dem Ziehen eines Steps mit der Maus')

    await page.click('[data-t="add-filter"]')
    await tick()
    await driftNow('nach dem Hinzufügen eines Steps')

    q3.afterConnectDisconnect = await page.evaluate(async () => {
      window.__qb.editor.connect('j1', 'fil3', 0)
      await window.__qb.tick()
      const connected = window.__qb.drift()
      window.__qb.editor.disconnect('fil3', 0)
      await window.__qb.tick()
      return { connected, disconnected: window.__qb.drift() }
    })
    await driftNow('nach Verbinden und Trennen')

    // removing a Step: the downstream Step must be marked broken and name what
    // it lost, rather than being silently re-wired (FR-12)
    q3.removal = await page.evaluate(async () => {
      window.__qb.editor.removeNode('u1')
      await window.__qb.tick()
      return {
        broken: window.__qb.broken(),
        orphans: window.__qb.orphans(),
        drift: window.__qb.drift(),
      }
    })
    await driftNow('nach dem Löschen eines Steps mit Nachfolger')

    // the frozen table survived all of it, by reference and still frozen
    q3.dataset = await page.evaluate(() => ({
      rows: window.__qb.tableRows('q1'),
      frozen: window.__qb.tableFrozen('q1'),
    }))

    q3.pass =
      q3.steps.every((s) => s.ok) &&
      q3.dragged.modelMoved &&
      q3.dragged.drift.ok &&
      q3.removal.broken.length > 0 &&
      q3.dataset.frozen
    out.q3 = q3

    out.extraRequests = requests.filter((r) => r !== url)
  } catch (e) {
    out.fatal = String(e).split('\n').slice(0, 3).join(' | ')
  }

  await page.close()
  await browser.close()
}

writeFileSync(resolve(here, 'spike-results.json'), JSON.stringify(results, null, 1))

// --- console summary ----------------------------------------------------
const yn = (b) => (b ? 'JA ' : 'NEIN')
console.log(`\nBuild: ${build.bytes} B, dist-Dateien: ${build.distFiles.length} (${build.singleFile ? 'Gate bestanden' : 'GATE VERLETZT'})`)
console.log(`  Hazards: ${JSON.stringify(build.hazards)}`)
console.log(`  externe src/href: ${JSON.stringify(build.externalSrc)}  url(): ${JSON.stringify(build.nonDataUrls)}`)

for (const [engine, r] of Object.entries(results.engines)) {
  console.log(`\n===== ${engine} ${r.version}`)
  if (r.fatal) { console.log('  FATAL:', r.fatal); continue }
  console.log(`  Seitenfehler: ${r.errors.length ? JSON.stringify(r.errors.slice(0, 5)) : 'keine'}`)
  console.log(`  Zusatz-Requests: ${JSON.stringify(r.extraRequests)}`)
  console.log(`  Q1 Anker  ${yn(r.q1.pass)} — größte Versatzänderung ${r.q1.worstOffsetDeltaPx} px (Toleranz ${r.q1.tolerancePx}), updateNodeInternals im App-Code: ${r.q1.remeasureCallsInAppSource}`)
  console.log(`      Ankerkonvention: fester Versatz ${r.q1.anchorConvention.observedOffsetPx} px = halbe Handle-Breite ${r.q1.anchorConvention.halfHandlePx} px bei Zoom ${r.q1.anchorConvention.zoom}`)
  for (const c of r.q1.cases)
    console.log(`      ${c.pass ? 'ok  ' : 'FEHL'} ${c.label}: Höhe ${JSON.stringify(c.heightDeltas)}, Anker wanderte ${c.handleTravelPx} px, Versatzänderung ${c.offsetDeltaPx} px`)
  console.log(`      ${r.q1.newEdgeMatchesConvention ? 'ok  ' : 'FEHL'} neuer Handle + neue Kante: Versatz ${JSON.stringify(r.q1.newHandleConnect.newEdgeOffset)}, bestehende Kanten ${r.q1.newHandleConnect.existingEdgeDeltaPx} px`)
  if (r.q1.withForcedRemeasure !== undefined)
    console.log(`      erzwungenes Nachmessen ändert: ${r.q1.withForcedRemeasure} px`)
  console.log(`  Q2 Zyklus ${yn(r.q2.pass)}`)
  console.log(`      programmatisch: abgelehnt ${yn(r.q2.programmatic.refused)} — ${r.q2.programmatic.reason}`)
  console.log(`      Zeiger:         abgelehnt ${yn(r.q2.pointer.refused)} — ${r.q2.pointer.refusalText}`)
  console.log(`      gültiger Zug:   angenommen ${yn(r.q2.pointerControl.accepted)}`)
  console.log(`      addEdges prüft keinen Zyklus (add-Change kam): ${yn(r.q2.libraryDoor.emittedAddChange)}, landete im Store: ${yn(r.q2.libraryDoor.landedInStore)}, Modell unberührt: ${yn(r.q2.libraryDoor.modelUntouched)}`)
  console.log(`      dieselbe Kante mit applyDefault: true landet: ${yn(r.q2.mechanism.landsWhenApplyDefaultIsOn)} (${r.q2.mechanism.edgeCountBefore}→${r.q2.mechanism.edgeCountWithDefaultOn}); geheilt durch Umbenennen ${yn(r.q2.mechanism.healedByRename)}, durch Strukturänderung ${yn(r.q2.mechanism.healedByStructuralChange)}`)
  console.log(`      zyklisches Rezept abgelehnt: ${yn(r.q2.cyclicRecipe.rejected)} — ${JSON.stringify(r.q2.cyclicRecipe.errors)}`)
  console.log(`  Q3 Besitz ${yn(r.q3.pass)} — Drift-Prüfungen: ${r.q3.steps.filter((s) => s.ok).length}/${r.q3.steps.length} sauber`)
  for (const s of r.q3.steps) if (!s.ok) console.log(`      DRIFT ${s.label}: ${JSON.stringify(s.problems)}`)
  console.log(`      Maus-Zug ins Modell: ${yn(r.q3.dragged.modelMoved)} → ${JSON.stringify(r.q3.dragged.modelPos)}`)
  console.log(`      nach Löschen: ${JSON.stringify(r.q3.removal.broken.map((b) => b.reason))}`)
  console.log(`      Datensatz: ${r.q3.dataset.rows} Zeilen, eingefroren ${yn(r.q3.dataset.frozen)}`)
  console.log(`  Q4 Rezept ${yn(r.q4.pass)} — Rundlauf identisch ${yn(r.q4.roundTripIdentical)}, ${r.q4.recipeBytes} B, Zellwerte enthalten: ${yn(r.q4.containsCellValues)}`)
  console.log(`      linear trivial: ${yn(r.q4.linear.ok)} (${r.q4.linear.steps} Knoten)`)
  for (const [k, v] of Object.entries(r.q4.rejections))
    console.log(`      ${v.rejected ? 'ok  ' : 'FEHL'} ${k}: ${JSON.stringify(v.errors)}`)
}

const allPass = Object.values(results.engines).every(
  (r) => !r.fatal && r.q1?.pass && r.q2?.pass && r.q3?.pass && r.q4?.pass,
)
console.log(`\nGesamt: ${allPass ? 'alle vier Fragen beantwortet und bestanden' : 'mindestens eine Frage nicht bestanden — siehe oben'}`)
