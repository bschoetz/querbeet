// Story 5 — the Step graph and the Editor, against the built artefact from a real
// `file://` URL (AD-27), in Chromium and Firefox. Everything here drives the real
// UI: the tab, the toolbar, the slot rows, the Delete key, a real mouse drag. No
// store access, no dev server.
//
// Three paths are driven here that no other envelope can reach, and each is here
// because the code was green without it:
//
//   the **Delete key**, on a Step and on an edge — the library reports the edges
//   a deleted node drags with it before it reports the node, so a host reading
//   them naively empties the consumer's slot and the consumer comes out
//   under-filled instead of broken-and-named;
//   a Step's **position before and after** an arrow key and a drag — a
//   remount-only assertion says "whatever is on screen survives a remount", not
//   "the key moved it";
//   the **focus pull, positively** — an off-screen Step, focused, changes the
//   viewport transform and ends up inside the pane. Asserting that the viewport
//   is *unchanged* passes more reliably with the mechanism deleted than with it;
//   the **reflow** (story 6e) — a card grown past the row pitch and the card
//   below it measured clear afterwards. happy-dom has no ResizeObserver, so this
//   is the only envelope in the tree that measures a rendered card at all.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

const csv = (name, content) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })

const TWO_SOURCES = [
  csv('Umsatz Q1.csv', 'Kunde,Betrag\nBäcker,1200\n'),
  csv('Umsatz Q2.csv', 'Kunde,Betrag\nMetzger,800\n'),
]

const pick = (page, files) => page.getByLabel('Dateien auswählen').setInputFiles(files)
const canvas = (page) => page.getByTestId('editor-canvas')
const card = (page, label) => page.getByRole('group', { name: label, exact: true })
const nodes = (page) => canvas(page).locator('.vue-flow__node')
const edges = (page) => canvas(page).locator('.vue-flow__edge')
const refusal = (page) => page.getByTestId('editor-refusal')

const toEditor = async (page) => {
  await page.getByRole('button', { name: 'Editor' }).click()
  await expect(canvas(page)).toBeVisible()
  // The page is taller than the browser viewport, and a mouse coordinate outside
  // that viewport is clamped — a drag started below the fold lands somewhere
  // other than where it was asked for. Scrolling the pane in first is what makes
  // every gesture below mean what it says.
  await canvas(page).scrollIntoViewIfNeeded()
  // The initial fit runs two frames after mount, and the adapter says when it is
  // done. Waiting on the condition rather than on a duration is what keeps the
  // geometry cases from being the first to flake on a loaded machine.
  await expect(canvas(page)).toHaveAttribute('data-fitted', 'true')
}

const toSources = (page) => page.getByRole('button', { name: 'Quellen' }).click()

const idOf = (page, label) => card(page, label).getAttribute('data-node')

const wrapper = (page, id) => canvas(page).locator(`.vue-flow__node[data-id="${id}"]`)

/**
 * Click a Step on the canvas, after bringing it into the pane.
 *
 * The focus pull is the product's own affordance for this and is asserted below
 * on its own terms — the canvas is transformed rather than scrolled, so the
 * browser's focus-scrolling does nothing. It became load-bearing here in story
 * 6b: the side panel takes width from the canvas the moment a Step is selected,
 * so a Step that was comfortably inside the pane a gesture ago may not be.
 * Without it Playwright clicks where the Step *was* and hits the toolbar.
 */
const clickNode = async (page, id, options = {}) => {
  await wrapper(page, id).evaluate((el) => el.focus())
  await wrapper(page, id).click({ position: { x: 4, y: 4 }, ...options })
}

/** The node's position **in the model** — the projection writes the transform,
 *  so this is what the graph holds and not what the pointer did. */
async function positionOf(page, id) {
  const style = await wrapper(page, id).getAttribute('style')
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(style)
  return { x: Number(m[1]), y: Number(m[2]) }
}

/** The pan and zoom in force. It is the transformation pane that carries it —
 *  `.vue-flow__viewport` has no inline style at all, so reading that one would
 *  compare `null` against `null` and pass whatever the canvas did. */
async function viewportTransform(page) {
  const style = await canvas(page).locator('.vue-flow__transformationpane').getAttribute('style')
  expect(style, 'no viewport transform on screen').toContain('translate(')
  return style
}

/** A real mouse gesture from one element to another, **held** over the target so
 *  the view's own answer can be read before the drop. Returns the release. */
async function dragOnto(page, from, to, steps = 12) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps })
  return () => page.mouse.up()
}

/** The zoom in force, read off the same transform the pan is. */
async function viewportScale(page) {
  const style = await viewportTransform(page)
  return Number(/scale\((-?[\d.]+)\)/.exec(style)[1])
}

const isInside = (box, pane) =>
  box.x >= pane.x - 1 &&
  box.y >= pane.y - 1 &&
  box.x + box.width <= pane.x + pane.width + 1 &&
  box.y + box.height <= pane.y + pane.height + 1

const outHandle = (page, id) => wrapper(page, id).locator('.vue-flow__handle-right')
const inHandle = (page, id, slot) => wrapper(page, id).locator(`.vue-flow__handle[data-slot="${slot}"]`)

/** Pan the canvas by dragging its background, in steps that stay inside the pane
 *  — a mouse coordinate outside the viewport is clamped by the browser, so one
 *  long drag moves the view far less than it asks for. */
async function panLeft(page, times = 3) {
  const box = await canvas(page).boundingBox()
  const y = box.y + box.height - 12
  for (let i = 0; i < times; i += 1) {
    await page.mouse.move(box.x + box.width - 20, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 20, y, { steps: 12 })
    await page.mouse.up()
  }
}

/** Two Sources, a Union of both named Halbjahr, a Filter downstream designated as
 *  the Result. Built the way a user builds it: the toolbar and the slot rows. */
async function buildPipeline(page) {
  await pick(page, TWO_SOURCES)
  await toEditor(page)

  await page.getByRole('button', { name: '+ Union' }).click()
  const union = card(page, 'Union: Union')
  await union.getByLabel('Name').fill('Halbjahr')
  await union.getByLabel('Name').blur()

  const halbjahr = card(page, 'Union: Halbjahr')
  await halbjahr.getByLabel('Eingang 1', { exact: true }).selectOption({ label: 'Umsatz Q1' })
  await halbjahr.getByLabel('Eingang 2', { exact: true }).selectOption({ label: 'Umsatz Q2' })

  await page.getByRole('button', { name: '+ Filter' }).click()
  const filter = card(page, 'Filter: Filter')
  await filter.getByLabel('Name').fill('Nur Bestand')
  await filter.getByLabel('Name').blur()

  await card(page, 'Filter: Nur Bestand')
    .getByLabel('Eingang 1', { exact: true })
    .selectOption({ label: 'Halbjahr' })

  // The Union was designated automatically as the first Step that could be a
  // Result; the finished pipeline ends at the Filter.
  await card(page, 'Filter: Nur Bestand')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await expect(edges(page)).toHaveCount(3)
}

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(`No built artefact at ${ARTIFACT}. Run \`npm run build\` first.`)
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(ARTIFACT_URL)
})

test('entering the Editor is deliberate, and the Sources are already there as Steps', async ({
  page,
}) => {
  await pick(page, TWO_SOURCES)

  // The Editor is not open until it is asked for (CAP-11).
  await expect(canvas(page)).toHaveCount(0)

  await toEditor(page)

  await expect(nodes(page)).toHaveCount(2)
  await expect(card(page, 'Quelle: Umsatz Q1')).toBeVisible()
  await expect(card(page, 'Quelle: Umsatz Q2')).toBeVisible()
  // A Source has no inputs, so it has no slot row and no connect control at all.
  await expect(card(page, 'Quelle: Umsatz Q1').locator('[data-testid="step-slot"]')).toHaveCount(0)
  // …and the dot grid renders, which turns on one attribute being spelled the
  // way SVG spells it.
  await expect(page.getByTestId('editor-background').locator('pattern')).toHaveAttribute(
    'patternUnits',
    'userSpaceOnUse',
  )
})

test('a pipeline is built with the slot rows, and the Result Step is designated', async ({
  page,
}) => {
  await buildPipeline(page)

  const filter = card(page, 'Filter: Nur Bestand')
  await expect(filter.getByRole('button', { name: 'Als Ergebnis-Step setzen' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Everything reaches the Result now, so nothing is marked as contributing to
  // nothing and the graph has nothing left to say about itself.
  await expect(canvas(page).getByTestId('step-mark')).toHaveCount(0)

  // **The region is enumerated rather than sampled.** This assertion was
  // `toHaveCount(0)` until story 6b put the run's own refusals here, and
  // relaxing it to a substring check would have left any *other* spurious
  // sentence in this scenario unobserved — which is the whole thing the original
  // count was buying. So the new truth is stated exactly: three sentences, and
  // all three are about the run rather than about the graph. The two Sources were
  // never confirmed, so AD-29's first gate refuses; the Union has no executor
  // until story 8.
  await expect(page.getByTestId('editor-status')).toHaveCount(3)
  await expect(page.getByTestId('editor-status').nth(0)).toContainText(
    '„Umsatz Q1“ ist noch nicht bestätigt',
  )
  await expect(page.getByTestId('editor-status').nth(1)).toContainText(
    '„Umsatz Q2“ ist noch nicht bestätigt',
  )
  await expect(page.getByTestId('editor-status').nth(2)).toContainText(
    '„Halbjahr“ ist eine Union',
  )
})

test('re-designating the Result marks what no longer reaches it, without removing it', async ({
  page,
}) => {
  await buildPipeline(page)

  await card(page, 'Union: Halbjahr')
    .getByRole('button', { name: 'Als Ergebnis-Step setzen' })
    .click()

  await expect(card(page, 'Filter: Nur Bestand')).toContainText(
    '„Nur Bestand“ trägt nicht zum Ergebnis bei.',
  )
  // Marked, not removed and not altered.
  await expect(nodes(page)).toHaveCount(4)
  await expect(
    card(page, 'Filter: Nur Bestand').getByLabel('Eingang 1', { exact: true }),
  ).toHaveValue(await idOf(page, 'Union: Halbjahr'))
})

test('the Step that would close a cycle is absent from the list the keyboard offers', async ({
  page,
}) => {
  await buildPipeline(page)

  const options = await card(page, 'Union: Halbjahr')
    .getByLabel('Eingang 1', { exact: true })
    .locator('option')
    .allInnerTexts()

  // The guard already knows the answer, so the list does not offer a cycle only
  // to refuse it.
  expect(options).not.toContain('Nur Bestand')
  expect(options).toContain('Umsatz Q2')
})

test('a cyclic drag is refused by the view and by the model, and the graph is unchanged', async ({
  page,
}) => {
  await buildPipeline(page)
  const union = await idOf(page, 'Union: Halbjahr')
  const filter = await idOf(page, 'Filter: Nur Bestand')

  const release = await dragOnto(page, outHandle(page, filter), inHandle(page, union, 0))

  // The view's own answer, before the drop. `connecting` proves the library
  // consulted the handle at all; the absence of `valid` is the guard saying no.
  // Without this the case passes with `:is-valid-connection` taken off the
  // handles entirely — the model refuses either way, and the handle lights up
  // green on the way.
  const target = inHandle(page, union, 0)
  await expect(target).toHaveClass(/vue-flow__handle-connecting/)
  await expect(target).not.toHaveClass(/vue-flow__handle-valid/)

  await release()

  await expect(refusal(page)).toContainText('würde einen Kreis schließen')
  await expect(edges(page)).toHaveCount(3)
  await expect(card(page, 'Union: Halbjahr').getByLabel('Eingang 1', { exact: true })).toHaveValue(
    (await idOf(page, 'Quelle: Umsatz Q1')) ?? '',
  )
})

test('a drag the guard accepts creates the edge through the same command', async ({ page }) => {
  await buildPipeline(page)
  const union = await idOf(page, 'Union: Halbjahr')
  const filter = await idOf(page, 'Filter: Nur Bestand')

  // Empty the slot through the row, then fill it again with the pointer: the
  // same command, reached the other way.
  await card(page, 'Filter: Nur Bestand').getByLabel('Eingang 1', { exact: true }).selectOption('')
  await expect(edges(page)).toHaveCount(2)

  const release = await dragOnto(page, outHandle(page, union), inHandle(page, filter, 0))
  await expect(inHandle(page, filter, 0)).toHaveClass(/vue-flow__handle-valid/)
  await release()

  await expect(edges(page)).toHaveCount(3)
  await expect(
    card(page, 'Filter: Nur Bestand').getByLabel('Eingang 1', { exact: true }),
  ).toHaveValue(union)
})

test('Delete on a selected Step leaves the consumer broken and naming what it lost', async ({
  page,
}) => {
  await buildPipeline(page)
  const union = await idOf(page, 'Union: Halbjahr')

  await clickNode(page, union)
  await page.keyboard.press('Delete')

  await expect(nodes(page)).toHaveCount(3)
  // Broken and naming what vanished — never merely short of an input, which is
  // what reading the dragged edge removals as disconnects would produce.
  await expect(card(page, 'Filter: Nur Bestand')).toContainText(
    '„Nur Bestand“ hat an Eingang 1 „Halbjahr“ verloren.',
  )
  await expect(card(page, 'Filter: Nur Bestand')).not.toContainText('braucht 1 Eingang')
})

test('Delete on a selected edge is the disconnect it is, and says so differently', async ({
  page,
}) => {
  await buildPipeline(page)

  await canvas(page).locator('.vue-flow__edge-interaction').last().click({ force: true })
  await page.keyboard.press('Delete')

  await expect(edges(page)).toHaveCount(2)
  // An emptied slot is a Step the user is still building; the sentence is the
  // other one on purpose.
  await expect(card(page, 'Filter: Nur Bestand')).toContainText(
    '„Nur Bestand“ braucht 1 Eingang, hat aber 0.',
  )
  await expect(card(page, 'Filter: Nur Bestand')).not.toContainText('verloren')
})

test('Delete pressed outside the canvas leaves the selected Step alone', async ({ page }) => {
  // The library's own key handler listens on the *document* and its guard covers
  // INPUT, SELECT, TEXTAREA and contenteditable — not BUTTON. With a Step
  // selected, Delete on the toolbar, on a view tab, or anywhere in the Sources
  // pane this app keeps mounted would otherwise destroy it.
  await buildPipeline(page)
  const union = await idOf(page, 'Union: Halbjahr')

  await clickNode(page, union)
  await expect(wrapper(page, union)).toHaveClass(/selected/)

  for (const outside of [
    page.getByRole('button', { name: '+ Join' }),
    page.getByRole('button', { name: 'Editor' }),
  ]) {
    await outside.focus()
    await page.keyboard.press('Delete')
  }

  await expect(nodes(page)).toHaveCount(4)
  await expect(card(page, 'Union: Halbjahr')).toBeVisible()
})

test('Delete on a selected Source is refused, and says where a Source is removed', async ({
  page,
}) => {
  // Removing it here would take the node out, break its consumers, and let the
  // next reconciliation put both the node and its edges straight back.
  await buildPipeline(page)
  const source = await idOf(page, 'Quelle: Umsatz Q1')

  await clickNode(page, source)
  await page.keyboard.press('Delete')

  await expect(refusal(page)).toContainText('ist eine Quelle — Quellen werden unter „Quellen“ entfernt')
  await expect(nodes(page)).toHaveCount(4)
  await expect(edges(page)).toHaveCount(3)
})

test('two Steps selected together are both deleted — the selection is handed back', async ({
  page,
}) => {
  // `addSelectedNodes` takes a branch under `multiSelectionActive` that emits
  // changes and mutates nothing, so without the one line that applies `select`
  // changes back, the second selection is silently dropped — and single
  // selection keeps working, so nothing else notices.
  await buildPipeline(page)
  const union = await idOf(page, 'Union: Halbjahr')
  const filter = await idOf(page, 'Filter: Nur Bestand')

  await clickNode(page, union)
  await clickNode(page, filter, { modifiers: ['Control'] })

  await expect(canvas(page).locator('.vue-flow__node.selected')).toHaveCount(2)

  await page.keyboard.press('Delete')

  await expect(nodes(page)).toHaveCount(2)
  await expect(card(page, 'Union: Halbjahr')).toHaveCount(0)
  await expect(card(page, 'Filter: Nur Bestand')).toHaveCount(0)
})

test('a Step deleted together with its own edge still comes out named, not merely short', async ({
  page,
}) => {
  // The one gesture that puts both halves of the ordering hazard in one batch:
  // an edge removal whose source is also being removed. Read as a user
  // disconnect it empties the consumer's slot first, and the consumer comes out
  // `graph.inputs_missing` — the inversion of CAP-12's promise.
  await buildPipeline(page)
  const union = await idOf(page, 'Union: Halbjahr')

  await clickNode(page, union)
  await canvas(page)
    .locator('.vue-flow__edge-interaction')
    .last()
    .click({ force: true, modifiers: ['Control'] })
  await expect(canvas(page).locator('.vue-flow__edge.selected')).toHaveCount(1)

  await page.keyboard.press('Delete')

  await expect(nodes(page)).toHaveCount(3)
  await expect(card(page, 'Filter: Nur Bestand')).toContainText(
    '„Nur Bestand“ hat an Eingang 1 „Halbjahr“ verloren.',
  )
  await expect(card(page, 'Filter: Nur Bestand')).not.toContainText('braucht 1 Eingang')
})

test('a Step added while the view is panned away is brought into it, at the same zoom', async ({
  page,
}) => {
  // This story ships no deliberate pan, so a Step that lands outside the pane is
  // a Step nobody can go and find.
  await buildPipeline(page)
  await panLeft(page, 2)

  const scaleBefore = await viewportScale(page)
  await page.getByRole('button', { name: '+ Join' }).click()

  const paneBox = await canvas(page).boundingBox()
  const join = await idOf(page, 'Join: Join')
  await expect
    .poll(async () => isInside(await wrapper(page, join).boundingBox(), paneBox))
    .toBe(true)
  // Brought in by the shortfall pan, so the zoom the user chose survives —
  // fitting the view instead would take it away on every added Step.
  expect(await viewportScale(page)).toBe(scaleBefore)
})

test('an arrow key moves a Step — measured before and after the press', async ({ page }) => {
  await buildPipeline(page)
  const filter = await idOf(page, 'Filter: Nur Bestand')

  await clickNode(page, filter)
  const before = await positionOf(page, filter)

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await positionOf(page, filter)).x)
    .toBeGreaterThan(before.x)

  const after = await positionOf(page, filter)
  expect(after.y).toBe(before.y)
})

test('a mouse drag moves a Step — measured before and after the gesture', async ({ page }) => {
  await buildPipeline(page)
  const filter = await idOf(page, 'Filter: Nur Bestand')
  const before = await positionOf(page, filter)

  const box = await wrapper(page, filter).boundingBox()
  await page.mouse.move(box.x + 6, box.y + 6)
  await page.mouse.down()
  await page.mouse.move(box.x + 126, box.y + 86, { steps: 10 })
  await page.mouse.up()

  await expect.poll(async () => (await positionOf(page, filter)).x).toBeGreaterThan(before.x + 40)
  expect((await positionOf(page, filter)).y).toBeGreaterThan(before.y + 20)
})

test('focusing an off-screen Step pulls the canvas after it', async ({ page }) => {
  await buildPipeline(page)
  const filter = await idOf(page, 'Filter: Nur Bestand')

  // Pan the canvas until the Step is genuinely off the pane, by dragging the
  // background rather than by moving the Step.
  await panLeft(page, 3)

  const paneBox = await canvas(page).boundingBox()
  const hidden = await wrapper(page, filter).boundingBox()
  expect(hidden.x + hidden.width, 'the Step was still on screen — pan further').toBeLessThan(
    paneBox.x,
  )

  const before = await viewportTransform(page)
  await wrapper(page, filter).evaluate((el) => el.focus())

  await expect.poll(() => viewportTransform(page)).not.toBe(before)
  const shown = await wrapper(page, filter).boundingBox()
  expect(shown.x).toBeGreaterThanOrEqual(paneBox.x)
  expect(shown.x + shown.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1)
})

test('a pointer click on a control near the pane edge does not move the canvas out from under it', async ({
  page,
}) => {
  await buildPipeline(page)
  const filter = await idOf(page, 'Filter: Nur Bestand')

  // Park the Step against the left edge of the pane, inside the focus pull's own
  // 24 px margin, so a pull would fire if the pointer did not veto it. A drag
  // undershoots — the library starts following only past its drag threshold — so
  // this closes the distance rather than assuming one gesture covers it.
  const paneBox = await canvas(page).boundingBox()
  for (let i = 0; i < 8; i += 1) {
    const box = await wrapper(page, filter).boundingBox()
    const dx = paneBox.x + 8 - box.x
    if (dx > -2) break
    await page.mouse.move(box.x + 6, box.y + 6)
    await page.mouse.down()
    await page.mouse.move(box.x + 6 + dx, box.y + 6, { steps: 8 })
    await page.mouse.up()
  }

  expect((await wrapper(page, filter).boundingBox()).x - paneBox.x).toBeLessThan(24)
  const before = await viewportTransform(page)
  const badge = card(page, 'Filter: Nur Bestand').getByRole('button', {
    name: 'Als Ergebnis-Step setzen',
  })
  await badge.click()

  // The click landed on the button, and the canvas stayed where it was.
  await expect(badge).toHaveAttribute('aria-pressed', 'true')
  expect(await viewportTransform(page)).toBe(before)
})

test('a card that grows pushes the one below it clear, and its controls stay clickable', async ({
  page,
}) => {
  // The defect this closes was measured in story 6b: the row pitch is a constant,
  // a Step card has no fixed height, and the upper card then intercepted the
  // pointer aimed at the lower one's Ergebnis button.
  await pick(page, TWO_SOURCES)
  await toEditor(page)

  // Two Steps in one column — that is where `freePosition` puts them — and a
  // Union, because it is the one kind whose height a user can raise at will
  // (`maxInputs: Infinity`).
  await page.getByRole('button', { name: '+ Union' }).click()
  await card(page, 'Union: Union').getByLabel('Name').fill('Oben')
  await card(page, 'Union: Union').getByLabel('Name').blur()

  await page.getByRole('button', { name: '+ Union' }).click()
  await card(page, 'Union: Union').getByLabel('Name').fill('Unten')
  await card(page, 'Union: Union').getByLabel('Name').blur()

  const oben = await idOf(page, 'Union: Oben')
  const unten = await idOf(page, 'Union: Unten')
  expect((await positionOf(page, oben)).x).toBe((await positionOf(page, unten)).x)
  const before = await positionOf(page, unten)

  for (let i = 0; i < 3; i += 1) {
    await card(page, 'Union: Oben').getByRole('button', { name: 'Eingang hinzufügen' }).click()
  }

  // The model moved it, and it moved *down* — the horizontal position carries the
  // column and is never touched.
  await expect.poll(async () => (await positionOf(page, unten)).y).toBeGreaterThan(before.y)
  expect((await positionOf(page, unten)).x).toBe(before.x)

  // …and the rendered cards are clear of each other. Screen space rather than
  // flow space, deliberately and with no tolerance: `LAYOUT.gap` is a flow-space
  // constant and would have to be scaled to be checked here, while "does one card
  // cover the other" is the same question at any zoom and is the one the pointer
  // asks. The zoomed case below is where that distinction earns its keep.
  await expect
    .poll(async () => {
      const a = await wrapper(page, oben).boundingBox()
      const b = await wrapper(page, unten).boundingBox()
      return b.y >= a.y + a.height
    })
    .toBe(true)

  // The proof, rather than the geometry standing in for it: the control the
  // overlap used to swallow takes an ordinary click. `force` is deliberately not
  // passed — Playwright's own hit-target check is the assertion.
  await wrapper(page, unten).evaluate((el) => el.focus())
  const badge = card(page, 'Union: Unten').getByRole('button', {
    name: 'Als Ergebnis-Step setzen',
  })
  await badge.click()
  await expect(badge).toHaveAttribute('aria-pressed', 'true')
})

test('a drag starts nothing, and the next measurement separates what it overlapped', async ({
  page,
}) => {
  // **Both halves, because either one alone passes with the mechanism deleted.**
  // The trigger is narrow — a drag resizes nothing, so it reports no dimensions
  // and nothing rearranges itself behind the gesture — but the pass is graph-wide
  // and stateless, so the overlap a drag made is separated by the next
  // measurement anywhere in the graph. Decided with the project owner on
  // 2026-08-04: the operative rule is about the trigger, and an overlap left
  // standing is the swallowed pointer this story exists to close.
  await pick(page, TWO_SOURCES)
  await toEditor(page)

  await page.getByRole('button', { name: '+ Filter' }).click()
  await card(page, 'Filter: Filter').getByLabel('Name').fill('Beweglich')
  await card(page, 'Filter: Filter').getByLabel('Name').blur()

  const filter = await idOf(page, 'Filter: Beweglich')
  const quelle = await idOf(page, 'Quelle: Umsatz Q1')

  // Park the Filter on top of the Source, closing the distance rather than
  // assuming one gesture covers it — the same reason the pane-edge case below
  // loops: the library follows only past its drag threshold, and focusing the
  // node scrolls the page under the pointer, so one drag lands somewhere near.
  for (let i = 0; i < 8; i += 1) {
    const a = await wrapper(page, filter).boundingBox()
    const b = await wrapper(page, quelle).boundingBox()
    const dx = b.x + 20 - a.x
    const dy = b.y + 20 - a.y
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) break
    await page.mouse.move(a.x + 6, a.y + 6)
    await page.mouse.down()
    await page.mouse.move(a.x + 6 + dx, a.y + 6 + dy, { steps: 10 })
    await page.mouse.up()
  }

  const dropped = await positionOf(page, filter)
  // Two frames, the same wait the adapter uses before it trusts a measurement: an
  // armed reflow is a microtask and has long since run by the second one.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

  expect(await positionOf(page, filter)).toEqual(dropped)
  // Still on top of the Source: the gesture reported no measurement, so no pass
  // ran. This half is what fails if a drag ever starts one.
  const a = await wrapper(page, filter).boundingBox()
  const b = await wrapper(page, quelle).boundingBox()
  expect(a.y).toBeLessThan(b.y + b.height)
  expect(b.y).toBeLessThan(a.y + a.height)

  // Now grow a card that has nothing to do with either of them. This half is what
  // fails if `armReflow` is deleted — the assertions above would not have noticed.
  await page.getByRole('button', { name: '+ Union' }).click()
  for (let i = 0; i < 3; i += 1) {
    await card(page, 'Union: Union').getByRole('button', { name: 'Eingang hinzufügen' }).click()
  }

  await expect.poll(async () => (await positionOf(page, filter)).y).toBeGreaterThan(dropped.y)
  await expect
    .poll(async () => {
      const moved = await wrapper(page, filter).boundingBox()
      const source = await wrapper(page, quelle).boundingBox()
      return moved.y >= source.y + source.height
    })
    .toBe(true)
})

test('the reflow measures in flow space, so it still clears the cards when zoomed out', async ({
  page,
}) => {
  // The one rule this story marks as a `Never` — the library's unscaled
  // `offsetWidth`/`offsetHeight` rather than a client rect — is invisible at
  // scale 1, where the two numbers coincide. `fitView({ maxZoom: 1 })` zooms *out*
  // for any graph taller than the pane, so zoom < 1 is the ordinary case and not
  // an exotic one. Swap the measurement for a scaled source and this is the only
  // thing in the tree that goes red.
  await pick(page, TWO_SOURCES)
  await toEditor(page)

  await page.getByRole('button', { name: '+ Union' }).click()
  await card(page, 'Union: Union').getByLabel('Name').fill('Oben')
  await card(page, 'Union: Union').getByLabel('Name').blur()

  await page.getByRole('button', { name: '+ Union' }).click()
  await card(page, 'Union: Union').getByLabel('Name').fill('Unten')
  await card(page, 'Union: Union').getByLabel('Name').blur()

  const box = await canvas(page).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => viewportScale(page)).toBeLessThan(0.95)

  const oben = await idOf(page, 'Union: Oben')
  const unten = await idOf(page, 'Union: Unten')
  for (let i = 0; i < 3; i += 1) {
    await card(page, 'Union: Oben').getByRole('button', { name: 'Eingang hinzufügen' }).click()
  }

  await expect
    .poll(async () => {
      const a = await wrapper(page, oben).boundingBox()
      const b = await wrapper(page, unten).boundingBox()
      return b.y >= a.y + a.height
    })
    .toBe(true)

  await wrapper(page, unten).evaluate((el) => el.focus())
  const badge = card(page, 'Union: Unten').getByRole('button', {
    name: 'Als Ergebnis-Step setzen',
  })
  await badge.click()
  await expect(badge).toHaveAttribute('aria-pressed', 'true')
})

test('leaving and re-entering the Editor loses no Step configuration', async ({ page }) => {
  await buildPipeline(page)
  const filter = await idOf(page, 'Filter: Nur Bestand')
  const union = await idOf(page, 'Union: Halbjahr')

  await card(page, 'Union: Halbjahr').getByRole('button', { name: 'Als Ergebnis-Step setzen' }).click()
  await page.getByRole('button', { name: '+ Filter' }).click()
  const before = await positionOf(page, filter)

  await toSources(page)
  // Unmounted rather than hidden: there is nothing left in memory to lose it
  // from, which is what makes the assertion below mean anything.
  await expect(nodes(page)).toHaveCount(0)
  await toEditor(page)

  expect(await positionOf(page, filter)).toEqual(before)
  await expect(card(page, 'Filter: Nur Bestand')).toBeVisible()
  await expect(card(page, 'Filter: Nur Bestand').getByLabel('Eingang 1', { exact: true })).toHaveValue(
    union,
  )
  await expect(
    card(page, 'Union: Halbjahr').getByRole('button', { name: 'Als Ergebnis-Step setzen' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(card(page, 'Filter: Nur Bestand')).toContainText('trägt nicht zum Ergebnis bei')
  // …and the Step added last did not land on top of the one that was there.
  expect(await positionOf(page, await idOf(page, 'Filter: Filter'))).not.toEqual(before)
})

test('removing a Source in the Sources pane marks its consumer broken, by the name it had', async ({
  page,
}) => {
  await buildPipeline(page)

  await toSources(page)
  await page.getByRole('button', { name: 'Entfernen: Umsatz Q2' }).click()
  await toEditor(page)

  await expect(nodes(page)).toHaveCount(3)
  await expect(card(page, 'Union: Halbjahr')).toContainText(
    '„Halbjahr“ hat an Eingang 2 „Umsatz Q2“ verloren.',
  )
  // Neither deleted nor re-wired: the other input is exactly where it was.
  await expect(card(page, 'Union: Halbjahr').getByLabel('Eingang 1', { exact: true })).toHaveValue(
    await idOf(page, 'Quelle: Umsatz Q1'),
  )
  // …and the slot still pointing at what is gone names it in German too. The
  // projection holds only the id; the model remembers the name, which is the one
  // thing `graph.input_lost` carries and the reason it carries it.
  await expect(
    card(page, 'Union: Halbjahr')
      .getByLabel('Eingang 2', { exact: true })
      .locator('option:checked'),
  ).toHaveText('Umsatz Q2')
})

test('the Sources pane keeps its own errors across a switch to the Editor and back', async ({
  page,
}) => {
  // The `v-show`/`v-if` asymmetry is deliberate and load-bearing: the Editor is
  // unmounted so "loses no Step configuration" is provable, and the Sources pane
  // is not, because its load errors and typing refusals live nowhere else.
  await pick(page, [
    {
      name: 'bericht.ods',
      mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    ...TWO_SOURCES,
  ])
  const failure = page.getByText('„bericht.ods“ hat ein nicht unterstütztes Format')
  await expect(failure).toBeVisible()

  await toEditor(page)
  await toSources(page)

  await expect(failure).toBeVisible()
})

test('the arity limits are named by the command, not hidden by the control', async ({ page }) => {
  await buildPipeline(page)

  await card(page, 'Union: Halbjahr')
    .getByRole('button', { name: 'Eingang entfernen: Eingang 2' })
    .click()
  await expect(refusal(page)).toContainText('„Halbjahr“ braucht mindestens 2 Eingänge.')
  await expect(card(page, 'Union: Halbjahr').locator('[data-testid="step-slot"]')).toHaveCount(2)

  await page.getByRole('button', { name: '+ Join' }).click()
  await card(page, 'Join: Join').getByRole('button', { name: 'Eingang hinzufügen' }).click()
  await expect(refusal(page)).toContainText('„Join“ nimmt höchstens 2 Eingänge.')
  await expect(card(page, 'Join: Join').locator('[data-testid="step-slot"]')).toHaveCount(2)
})

test('the whole connect is reachable with the keyboard alone, and no Handle is a tab stop', async ({
  page,
}) => {
  await pick(page, TWO_SOURCES)
  await toEditor(page)
  await page.getByRole('button', { name: '+ Union' }).click()

  const union = await idOf(page, 'Union: Union')

  // Not one of the handles carries a tab stop — the whole reason the slot row is
  // the control (5 controls at the spike's six-Step graph against 11 handles).
  await expect(canvas(page).locator('.vue-flow__handle')).not.toHaveCount(0)
  await expect(canvas(page).locator('.vue-flow__handle[tabindex]')).toHaveCount(0)

  // Tab in from the document until the slot row is what has focus, and never
  // land on a handle on the way.
  await page.locator('body').press('Tab')
  let reached = false
  for (let i = 0; i < 40 && !reached; i += 1) {
    const at = await page.evaluate(() => {
      const el = document.activeElement
      return {
        label: el?.getAttribute?.('aria-label') ?? '',
        handle: !!el?.classList?.contains('vue-flow__handle'),
        node: el?.closest?.('.vue-flow__node')?.getAttribute('data-id') ?? null,
      }
    })
    expect(at.handle, 'the keyboard landed on a Handle').toBe(false)
    reached = at.label === 'Eingang 1' && at.node === union
    if (!reached) await page.keyboard.press('Tab')
  }
  expect(reached, 'the input-slot row was not reachable by Tab').toBe(true)

  // Choose from the list with the keyboard, and the edge exists.
  await page.keyboard.press('ArrowDown')
  await expect(edges(page)).toHaveCount(1)
  await expect(card(page, 'Union: Union').getByLabel('Eingang 1', { exact: true })).toHaveValue(
    await idOf(page, 'Quelle: Umsatz Q1'),
  )
})

test('no raw core vocabulary reaches the screen while the Editor is marking Steps', async ({
  page,
}) => {
  await buildPipeline(page)
  await card(page, 'Union: Halbjahr').getByRole('button', { name: 'Als Ergebnis-Step setzen' }).click()
  await page.getByRole('button', { name: '+ Join' }).click()
  await card(page, 'Join: Join').getByRole('button', { name: 'Eingang hinzufügen' }).click()

  const shown = (await canvas(page).innerText()).toLowerCase()
  for (const enumValue of ['info', 'warning', 'error', 'unresolved']) {
    expect(shown, `severity "${enumValue}" reached the screen untranslated`).not.toMatch(
      new RegExp(`\\b${enumValue}\\b`),
    )
  }
  expect(shown, 'a diagnostic code reached the screen instead of a sentence').not.toMatch(
    /\bgraph\.[a-z_]+\b/,
  )
  // A Source id is core vocabulary too, and the one place it leaks is a slot
  // still pointing at a Step that is gone: the projection has only the id there.
  await toSources(page)
  await page.getByRole('button', { name: 'Entfernen: Umsatz Q2' }).click()
  await toEditor(page)
  const after = await canvas(page).innerText()
  expect(after, 'a raw core id reached the screen instead of a name').not.toMatch(/\bsrc:/)
})
