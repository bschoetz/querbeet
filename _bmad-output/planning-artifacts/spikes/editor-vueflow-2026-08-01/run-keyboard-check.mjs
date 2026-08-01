// NFR-7 check: is any Editor interaction reachable *only* by pointer gesture?
//
// This is not an accessibility audit — the PRD targets no WCAG level and requires
// no accessibility testing. NFR-7 states one rule, and states it as a correctness
// rule: every action that has a pointer gesture also has a keyboard-reachable
// path. So the method is to enumerate the Editor's interactions and drive each
// one with the keyboard alone.
//
// No pointer event is dispatched anywhere in this file. Focus starts at the
// document, exactly as it does for a user arriving with the Tab key.
//
//   node run-keyboard-check.mjs

import { chromium, firefox } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const url = pathToFileURL(resolve(here, 'app/dist/index.html')).href
const results = { engines: {} }

for (const [engine, driver] of [
  ['chromium', chromium],
  ['firefox', firefox],
]) {
  const browser = await driver.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const out = { engine, version: browser.version(), errors, interactions: {} }
  results.engines[engine] = out

  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { tag: 'body', node: null }
      const isWrapper = el.classList?.contains('vue-flow__node') ?? false
      return {
        tag: el.tagName.toLowerCase(),
        t: el.getAttribute('data-t'),
        cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 48),
        // The wrapper carries data-id; our own frame carries data-node and sits
        // *inside* it, so closest() alone finds neither from the other.
        node:
          el.getAttribute?.('data-id') ??
          el.closest?.('.qb-node')?.dataset.node ??
          el.querySelector?.('.qb-node')?.dataset.node ??
          null,
        isNodeWrapper: isWrapper,
        isHandle: el.classList?.contains('vue-flow__handle') ?? false,
        text: (el.textContent || '').trim().slice(0, 24),
      }
    })

  // Tab until `match` is true, returning how many presses it took. Pointer-free
  // by construction. Always called on a freshly loaded page, because blur() does
  // not reset the tab sequence the same way in both engines — Chromium wraps
  // around, Firefox does not.
  const tabTo = async (match, max = 60) => {
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press('Tab')
      const a = await active()
      if (match(a)) return { found: true, presses: i, on: a }
    }
    return { found: false, presses: max, on: await active() }
  }
  const tick = () => page.evaluate(() => window.__qb.tick())
  const fresh = async () => {
    await page.goto(url)
    await page.waitForFunction(() => !!window.__qb, null, { timeout: 60000 })
    await tick()
  }

  try {
    // -- 1. Can the keyboard reach the canvas at all? --------------------
    await fresh()
    const sweep = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      sweep.push(await active())
    }
    out.interactions.reachCanvas = {
      question: 'Erreicht die Tabulatortaste die Steps auf der Fläche?',
      firstNodeAfterPresses: sweep.findIndex((a) => a.isNodeWrapper) + 1 || null,
      anyHandleFocusable: sweep.some((a) => a.isHandle),
      focusOrder: sweep.slice(0, 14),
      pass: sweep.some((a) => a.isNodeWrapper),
    }

    // -- 2. Select a Step ------------------------------------------------
    await fresh()
    const toNode = await tabTo((a) => a.isNodeWrapper && a.node === 'q1')
    await page.keyboard.press('Enter')
    await tick()
    out.interactions.select = {
      question: 'Lässt sich ein Step per Tastatur auswählen?',
      reachedAfterPresses: toNode.presses,
      selected: await page.evaluate(() => window.__qb.selectedNodeIds()),
      pass: (await page.evaluate(() => window.__qb.selectedNodeIds())).includes('q1'),
    }

    // -- 2b. Multi-selection ---------------------------------------------
    // Single selection writes node.selected straight into the store
    // (getSelectionChanges with mutateItem: true), which is why it survives
    // applyDefault: false. Multi-selection only emits changes — so it should
    // *not* survive. Measured rather than assumed.
    await fresh()
    await tabTo((a) => a.isNodeWrapper && a.node === 'q1')
    await page.keyboard.press('Enter')
    await tabTo((a) => a.isNodeWrapper && a.node === 'q2', 20)
    await page.keyboard.down('Control')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Control')
    await tick()
    const multiByKeyboard = await page.evaluate(() => window.__qb.selectedNodeIds())

    // Control test with the pointer, to tell a keyboard gap apart from a
    // design-B consequence. This is the only pointer input in this file.
    await fresh()
    await page.click('.qb-node[data-node="q1"] .qb-kind')
    await page.keyboard.down('Control')
    await page.click('.qb-node[data-node="q2"] .qb-kind')
    await page.keyboard.up('Control')
    await tick()
    const multiByPointer = await page.evaluate(() => window.__qb.selectedNodeIds())

    out.interactions.multiSelect = {
      question: 'Lassen sich mehrere Steps auswählen?',
      selectedByKeyboard: multiByKeyboard,
      selectedByPointer: multiByPointer,
      // If the pointer fails too, this is not an NFR-7 gap but a consequence of
      // applyDefault: false — multi-selection is only ever emitted as a change.
      keyboardOnlyGap: multiByPointer.length >= 2,
      pass: multiByKeyboard.length >= 2,
    }

    // -- 3. Move a Step — and does it round-trip through the model? -------
    await fresh()
    await tabTo((a) => a.isNodeWrapper && a.node === 'q1')
    await page.keyboard.press('Enter')
    await tick()
    const posBefore = await page.evaluate(() => {
      const n = window.__qb.graph().nodes.find((x) => x.id === 'q1')
      return { x: n.x, y: n.y }
    })
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
    await tick()
    const posAfterArrows = await page.evaluate(() => {
      const n = window.__qb.graph().nodes.find((x) => x.id === 'q1')
      return { x: n.x, y: n.y }
    })
    await page.keyboard.press('Shift+ArrowRight')
    await tick()
    const posAfterShift = await page.evaluate(() => {
      const n = window.__qb.graph().nodes.find((x) => x.id === 'q1')
      return { x: n.x, y: n.y }
    })
    out.interactions.move = {
      question: 'Lässt sich ein Step per Pfeiltasten verschieben — und kommt das im Modell an?',
      posBefore,
      posAfterArrows,
      stepPx: +(posAfterArrows.x - posBefore.x).toFixed(2) / 5,
      shiftStepPx: +(posAfterShift.x - posAfterArrows.x).toFixed(2),
      // The design-B question: applyDefault is false, so this only works if the
      // arrow keys travel through our own change handler into the model.
      drift: await page.evaluate(() => window.__qb.drift()),
      pass:
        posAfterArrows.x > posBefore.x &&
        posAfterArrows.y > posBefore.y &&
        (await page.evaluate(() => window.__qb.drift())).ok,
    }

    // -- 4. Add a Step from the toolbar ----------------------------------
    await fresh()
    const countBefore = await page.evaluate(() => window.__qb.graph().nodes.length)
    const toAdd = await tabTo((a) => a.t === 'add-filter')
    await page.keyboard.press('Enter')
    await tick()
    out.interactions.addStep = {
      question: 'Lässt sich ein Step per Tastatur anlegen?',
      reachedAfterPresses: toAdd.presses,
      countBefore,
      countAfter: await page.evaluate(() => window.__qb.graph().nodes.length),
      pass: (await page.evaluate(() => window.__qb.graph().nodes.length)) === countBefore + 1,
    }

    // -- 5. Designate the Result Step ------------------------------------
    await fresh()
    const toResult = await tabTo((a) => a.t === 'result-u1')
    await page.keyboard.press('Enter')
    await tick()
    out.interactions.setResult = {
      question: 'Lässt sich der Ergebnis-Step per Tastatur setzen?',
      reachedAfterPresses: toResult.presses,
      resultId: await page.evaluate(() => window.__qb.graph().resultId),
      pass: (await page.evaluate(() => window.__qb.graph().resultId)) === 'u1',
    }

    // -- 6. Edit a Step's configuration ----------------------------------
    await fresh()
    const toField = await tabTo((a) => a.t === 'file-q1')
    await page.keyboard.press('End')
    await page.keyboard.type('-neu')
    await tick()
    out.interactions.editConfig = {
      question: 'Lässt sich die Konfiguration eines Steps per Tastatur ändern?',
      reachedAfterPresses: toField.presses,
      file: await page.evaluate(
        () => window.__qb.graph().nodes.find((n) => n.id === 'q1').config.file,
      ),
      pass: (
        await page.evaluate(() => window.__qb.graph().nodes.find((n) => n.id === 'q1').config.file)
      ).endsWith('-neu'),
    }

    // -- 7. Connect two Steps — the one that matters ---------------------
    // Vue Flow ships connectOnClick: true, so connecting is modelled as
    // "activate handle A, activate handle B" rather than as a drag. The
    // question is whether a keyboard can activate a handle at all.
    await fresh()
    const handleFocus = await page.evaluate(() => {
      const handles = [...document.querySelectorAll('.vue-flow__handle')]
      return {
        total: handles.length,
        withTabindex: handles.filter((h) => h.hasAttribute('tabindex')).length,
        withRole: handles.filter((h) => h.hasAttribute('role')).length,
      }
    })
    const edgesBefore = await page.evaluate(() => window.__qb.vfEdgeCount())
    // Try the plausible keys on a focused Step, in case a path exists that the
    // documentation does not mention.
    await tabTo((a) => a.isNodeWrapper && a.node === 'kd')
    for (const key of ['Enter', 'Space', 'c', 'v', 'l']) await page.keyboard.press(key)
    await tick()
    const toHandle = await tabTo((a) => a.isHandle, 60)
    out.interactions.connect = {
      question: 'Lassen sich zwei Steps per Tastatur verbinden?',
      handles: handleFocus,
      handleReachableByTab: toHandle.found,
      edgesBefore,
      edgesAfter: await page.evaluate(() => window.__qb.vfEdgeCount()),
      connectOnClickDefault: true,
      pass: (await page.evaluate(() => window.__qb.vfEdgeCount())) > edgesBefore,
    }

    // -- 8. Delete a Step -------------------------------------------------
    await fresh()
    await tabTo((a) => a.isNodeWrapper && a.node === 'u1')
    await page.keyboard.press('Enter')
    await tick()
    const before = await page.evaluate(() => window.__qb.graph().nodes.length)
    await page.keyboard.press('Delete')
    await tick()
    out.interactions.deleteStep = {
      question: 'Lässt sich ein Step per Tastatur löschen — und wird der Nachfolger als defekt markiert?',
      countBefore: before,
      countAfter: await page.evaluate(() => window.__qb.graph().nodes.length),
      broken: await page.evaluate(() => window.__qb.broken().map((b) => b.reason)),
      drift: await page.evaluate(() => window.__qb.drift()),
      pass: (await page.evaluate(() => window.__qb.graph().nodes.length)) === before - 1,
    }

    // -- 8b. Does the focus pull the canvas after it? ---------------------
    // A Step parked far outside the visible area: focusing it must bring it
    // into view, because the canvas is transformed rather than scrolled and the
    // browser's own focus-scrolling does nothing here.
    await fresh()
    await page.evaluate(async () => {
      window.__qb.editor.move('kd', 3400, 2200)
      await window.__qb.tick()
    })
    const offscreen = await page.evaluate(() => {
      const el = document.querySelector('.qb-node[data-node="kd"]')
      const pane = document.querySelector('.qb-canvas').getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return {
        visible: r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom,
        viewport: window.__qb.viewport(),
      }
    })
    await tabTo((a) => a.node === 'kd', 60)
    await tick()
    const onscreen = await page.evaluate(() => {
      const el = document.querySelector('.qb-node[data-node="kd"]')
      const pane = document.querySelector('.qb-canvas').getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return {
        visible: r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom,
        viewport: window.__qb.viewport(),
      }
    })
    out.interactions.focusIntoView = {
      question: 'Holt der Fokus einen Step außerhalb des Sichtbereichs ins Bild?',
      wasOffscreenBefore: !offscreen.visible,
      visibleAfterFocus: onscreen.visible,
      zoomUnchanged: offscreen.viewport.zoom === onscreen.viewport.zoom,
      pass: !offscreen.visible && onscreen.visible && offscreen.viewport.zoom === onscreen.viewport.zoom,
    }

    // -- 9. Pan and zoom --------------------------------------------------
    await fresh()
    const vpBefore = await page.evaluate(() => window.__qb.viewport())
    for (const key of ['ArrowRight', 'ArrowDown', '+', '-', 'PageDown']) {
      await page.keyboard.press(key)
    }
    await tick()
    const vpAfter = await page.evaluate(() => window.__qb.viewport())
    out.interactions.panZoom = {
      question: 'Lässt sich die Fläche per Tastatur verschieben und zoomen?',
      before: vpBefore,
      after: vpAfter,
      changed: JSON.stringify(vpBefore) !== JSON.stringify(vpAfter),
      pass: JSON.stringify(vpBefore) !== JSON.stringify(vpAfter),
    }
  } catch (e) {
    out.fatal = String(e).split('\n').slice(0, 3).join(' | ')
  }

  await page.close()
  await browser.close()
}

writeFileSync(resolve(here, 'keyboard-results.json'), JSON.stringify(results, null, 1))

const yn = (b) => (b ? 'JA  ' : 'NEIN')
for (const [engine, r] of Object.entries(results.engines)) {
  console.log(`\n===== ${engine} ${r.version}`)
  if (r.fatal) {
    console.log('  FATAL:', r.fatal)
    continue
  }
  console.log(`  Seitenfehler: ${r.errors.length ? JSON.stringify(r.errors.slice(0, 3)) : 'keine'}`)
  for (const [name, i] of Object.entries(r.interactions)) {
    console.log(`  ${yn(i.pass)} ${name} — ${i.question}`)
  }
  const i = r.interactions
  console.log(`\n  Details:`)
  console.log(`    erster Step per Tab nach ${i.reachCanvas.firstNodeAfterPresses} Anschlägen; Handles fokussierbar: ${yn(i.reachCanvas.anyHandleFocusable)}`)
  console.log(`    Verschieben: ${i.move.stepPx} px je Pfeiltaste, Shift ${i.move.shiftStepPx} px, Drift sauber ${yn(i.move.drift.ok)}`)
  console.log(`    Verbinden: ${i.connect.handles.total} Handles, davon mit tabindex ${i.connect.handles.withTabindex}, per Tab erreichbar ${yn(i.connect.handleReachableByTab)}, Kanten ${i.connect.edgesBefore}→${i.connect.edgesAfter}`)
  console.log(
    `    Mehrfachauswahl: Tastatur ${JSON.stringify(i.multiSelect.selectedByKeyboard)}, Zeiger ${JSON.stringify(i.multiSelect.selectedByPointer)}` +
      (i.multiSelect.pass ? '' : ` → ${i.multiSelect.keyboardOnlyGap ? 'reine Tastaturlücke' : 'beide Wege betroffen, also keine NFR-7-Lücke'}`),
  )
  console.log(`    Löschen: ${i.deleteStep.countBefore}→${i.deleteStep.countAfter} Steps, defekt: ${JSON.stringify(i.deleteStep.broken)}`)
  console.log(`    Fokus ins Bild: vorher außerhalb ${yn(i.focusIntoView.wasOffscreenBefore)}, danach sichtbar ${yn(i.focusIntoView.visibleAfterFocus)}, Zoom unverändert ${yn(i.focusIntoView.zoomUnchanged)}`)
  console.log(`    Fläche: ${JSON.stringify(i.panZoom.before)} → ${JSON.stringify(i.panZoom.after)}`)
}

const gaps = Object.entries(results.engines).flatMap(([e, r]) =>
  r.fatal ? [`${e}: FATAL`] : Object.entries(r.interactions).filter(([, i]) => !i.pass).map(([n]) => `${e}: ${n}`),
)
console.log(`\nLücken nach NFR-7: ${gaps.length ? gaps.join(', ') : 'keine'}`)
