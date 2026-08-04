// The half of AD-24 that only a render function can execute.
//
// core/view/row-window.test.js proves the arithmetic: how many pages a row count
// occupies, where each page starts, which rows a scroll offset selects. What it
// cannot reach is what this component's template does with those numbers — the
// `v-if` that reveals the controls, the `:disabled` bindings, the interpolated
// German. Before this file, deleting the `v-if` or inverting a disabled state
// left lint, Vitest and Playwright all green.
//
// Playwright cannot reach it either, and not for want of trying: paging engages
// above PAGE_ROWS — 571,428 rows at 28 px — and that fixture is roughly half a
// gigabyte of CSV. The run would be measuring the generator.
//
// The way in is that the branch never needed a real table. `buildWindow` derives
// `pages` from `table.rowCount` alone, and `sliceRows` only ever indexes into
// the window actually shown — so a table can claim six hundred thousand rows and
// allocate none of them, which is what `pretendRows` below does. That makes this
// a props-in/DOM-out test rather than a geometry one, which in turn is why
// happy-dom's missing layout costs nothing here (R10).
//
// Every assertion below was checked by breaking the thing it names: removing the
// page offset from the slice, forcing the controls visible, and unbinding the
// last page's disabled state each fail exactly the case that claims to catch it.

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { PAGE_ROWS } from '@core/view/row-window.js'
import RowWindow from './RowWindow.vue'

/** Cells that exist at every index without occupying any of them. `sliceRows`
 *  only ever reads `cells[i]` for the ~50 indices in the window it was asked
 *  for, so a column can answer for six hundred thousand rows while allocating
 *  nothing — and the answer names its own index, which is what lets an assertion
 *  say *which* row it is looking at rather than merely that a row is there. */
const boundlessCells = (name, c) =>
  new Proxy([], {
    get: (target, key) =>
      typeof key === 'string' && /^\d+$/.test(key) ? `${name}-${c}-${key}` : Reflect.get(target, key),
  })

/** A columnar table that claims `rowCount` rows. Not frozen, unlike the real
 *  thing a reader produces — freezing a Proxy is not a thing, and the freeze is
 *  the reader's promise to the store, not something this component relies on. */
const pretendRows = (rowCount, columnNames = ['Nr', 'Wert']) => ({
  columns: columnNames.map((name, c) => ({ name, domain: 'text', cells: boundlessCells(name, c) })),
  rowCount,
})

/** Mount, then let the first window land. The component fills its window in
 *  `onMounted` — an imperative assignment to a shallowRef (AD-6), not a
 *  computed — so the DOM that assignment produces exists one tick after mount.
 *  Reading `w.html()` before that tick shows the empty initial window, and every
 *  assertion here would pass vacuously against it. */
const render = async (table, extra = {}) => {
  const w = mount(RowWindow, { props: { table, ...extra } })
  await nextTick()
  return w
}

const controls = (w) => w.find('[data-testid="preview-pages"]')
const buttons = (w) => controls(w).findAll('button')
const rowCells = (w) =>
  w.findAll('[data-testid="preview-row"]').map((r) => r.findAll('td').map((td) => td.text()))

describe('the paging controls', () => {
  it('stay hidden for every table below the clamp — the common case is plain scrolling', async () => {
    for (const rowCount of [0, 1, 1500, PAGE_ROWS]) {
      const w = await render(pretendRows(rowCount))
      expect(controls(w).exists(), `controls appeared at ${rowCount} rows`).toBe(false)
      // … and the table below them is genuinely rendered, so the assertion above
      // is about the controls rather than about a component that drew nothing.
      expect(w.findAll('[data-testid="preview-row"]').length).toBe(Math.min(rowCount, 50))
    }
  })

  it('appear one row past the clamp, and say in German where the reader is', async () => {
    const w = await render(pretendRows(PAGE_ROWS + 1))

    expect(controls(w).exists()).toBe(true)
    expect(controls(w).text()).toContain('Seite 1 von 2')
    // German thousands separators, as everywhere else in this product (AD-13).
    expect(controls(w).text()).toContain('571.428 Zeilen auf dieser Seite')
  })

  it('cannot page before the first page or past the last', async () => {
    const w = await render(pretendRows(PAGE_ROWS + 1))
    const [back, forward] = buttons(w)

    expect(back.text()).toBe('Zurück')
    expect(forward.text()).toBe('Weiter')
    expect(back.attributes('disabled')).toBeDefined()
    expect(forward.attributes('disabled')).toBeUndefined()

    await forward.trigger('click')

    expect(controls(w).text()).toContain('Seite 2 von 2')
    expect(buttons(w)[0].attributes('disabled')).toBeUndefined()
    expect(buttons(w)[1].attributes('disabled')).toBeDefined()
  })

  it('the last page carries the remainder, declined for a single row', async () => {
    const w = await render(pretendRows(PAGE_ROWS + 1))
    await buttons(w)[1].trigger('click')

    // "1 Zeilen" is what a plural-only label produces, and this is the one page
    // shape that can hit it.
    expect(controls(w).text()).toContain('1 Zeile auf dieser Seite')
  })
})

describe('what a page actually renders', () => {
  it('page 2 starts at row PAGE_ROWS, not back at row 0', async () => {
    // This is the assertion the whole envelope was added for. Delete the page
    // offset from buildWindow's slice and page 2 renders page 1's rows while the
    // label still reads "Seite 2 von 2" — silently, in the one branch no other
    // test executes.
    const w = await render(pretendRows(PAGE_ROWS + 3))

    expect(rowCells(w)[0]).toEqual(['Nr-0-0', 'Wert-1-0'])

    await buttons(w)[1].trigger('click')

    const rows = rowCells(w)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual([`Nr-0-${PAGE_ROWS}`, `Wert-1-${PAGE_ROWS}`])
  })

  it('numbers its rows for assistive technology in table coordinates, across pages', async () => {
    const w = await render(pretendRows(PAGE_ROWS + 3))
    const table = w.find('table')

    // The header row is aria-rowindex 1, so a data row is its table index + 2.
    expect(table.attributes('aria-rowcount')).toBe(String(PAGE_ROWS + 4))
    expect(w.find('[data-testid="preview-row"]').attributes('aria-rowindex')).toBe('2')

    await buttons(w)[1].trigger('click')

    expect(w.find('[data-testid="preview-row"]').attributes('aria-rowindex')).toBe(
      String(PAGE_ROWS + 2),
    )
  })

  it('starts over at page 1 when a re-read mints a new table', async () => {
    const w = await render(pretendRows(PAGE_ROWS + 3))
    await buttons(w)[1].trigger('click')
    expect(controls(w).text()).toContain('Seite 2 von 2')

    // An encoding override or a corrected header row produces a new frozen entry
    // (AD-7). Row i is then a different row, so a surviving page number would be
    // a lie about where the reader is.
    await w.setProps({ table: pretendRows(PAGE_ROWS + 3, ['Ort', 'Betrag']) })

    expect(controls(w).text()).toContain('Seite 1 von 2')
    expect(rowCells(w)[0]).toEqual(['Ort-0-0', 'Betrag-1-0'])
  })
})

describe('the window inside a page', () => {
  it('follows a scroll offset within the page it is on', async () => {
    // happy-dom has no layout, but scrollTop is a genuine property — the
    // component only ever reads back the number, never asks the DOM to compute
    // one from rendered content (R10, verified against happy-dom's source).
    const w = await render(pretendRows(PAGE_ROWS + 3, ['Nr']))
    const scroller = w.find('[data-testid="preview"]')

    scroller.element.scrollTop = 100 * 28
    await scroller.trigger('scroll')

    expect(rowCells(w)[0]).toEqual(['Nr-0-100'])
    expect(w.findAll('[data-testid="preview-row"]')).toHaveLength(50)
  })
})

describe('a table with no columns', () => {
  it('says so in German instead of rendering an empty grid', async () => {
    const w = await render({ columns: [], rowCount: 0 })

    expect(w.find('[data-testid="preview"]').exists()).toBe(false)
    expect(w.find('[data-testid="preview-empty"]').text()).toContain('Nichts anzuzeigen')
  })
})

// ------------------------------------------------- the cells story 6a marks
//
// The projection is `core/view`'s and is tested there. What only a render
// function executes is the rest of it: that a marked cell keeps its own text,
// that it carries the German sentence as a `title` rather than only a colour, and
// that an unmarked cell carries neither — the three things a `:class` typo or a
// dropped binding would take away with every other test still green.

describe('a marked cell', () => {
  const marked = (w) => w.findAll('[data-testid="preview-mark"]')

  it('marks nothing at all when no marks are given', async () => {
    const w = await render(pretendRows(5))

    expect(marked(w)).toHaveLength(0)
    expect(w.findAll('[data-testid="preview-row"]')).toHaveLength(5)
  })

  it('marks exactly the cells it was given, and keeps their text', async () => {
    const w = await render(pretendRows(5), { marks: [new Set([1, 3]), null] })

    expect(marked(w)).toHaveLength(2)
    // The original text is the whole point: the count stops being a dead end
    // because the reader can see *what* did not read.
    expect(marked(w).map((td) => td.text())).toEqual(['Nr-0-1', 'Nr-0-3'])
  })

  it('carries its reason as a title, and marks with more than a colour', async () => {
    const w = await render(pretendRows(3), {
      marks: [new Set([0]), null],
      markTitle: 'Unter dem bestätigten Typ nicht lesbar',
    })

    expect(marked(w)[0].attributes('title')).toBe('Unter dem bestätigten Typ nicht lesbar')
    // `title` is a pointer affordance and is announced inconsistently, so the
    // mark may not be colour plus a tooltip and nothing else — the underline is
    // what a reader who cannot see the colour is left with.
    expect(marked(w)[0].classes().join(' ')).toContain('underline')
    // …and an unmarked cell carries no stray title, which is what a binding
    // written without the condition would produce on every cell in the grid.
    const cells = w.findAll('[data-testid="preview-row"]')[0].findAll('td')
    expect(cells[1].attributes('title')).toBeUndefined()
  })

  it('repaints when the marks arrive, without a new table and without losing the page', async () => {
    // Confirming a type mints a new entry but not a new *table* — the values did
    // not change, only what they are read as — so the table watcher cannot see
    // it. Before the marks watcher existed, the marks appeared only after the
    // next scroll.
    const table = pretendRows(5)
    const w = await render(table)
    expect(marked(w)).toHaveLength(0)

    await w.setProps({ marks: [new Set([2]), null] })
    await nextTick()

    expect(marked(w)).toHaveLength(1)
    expect(marked(w)[0].text()).toBe('Nr-0-2')
  })
})
