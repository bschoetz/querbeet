// The window geometry under Vitest with no browser (AD-2, AD-27). Everything
// AD-24 promises about the scroll extent is asserted here, because the e2e
// envelope cannot afford the fixture that would prove the clamp: the threshold
// is over half a million rows, and a Playwright run that built one would be
// measuring the fixture generator.

import { describe, expect, it } from 'vitest'
import {
  PAGE_ROWS,
  ROW_HEIGHT_PX,
  SAFE_EXTENT_PX,
  WINDOW_SIZE,
  buildWindow,
  clampPage,
  pageCount,
  pageOffset,
  pageRowCount,
  sliceMarks,
  sliceRows,
  windowBounds,
} from './row-window.js'

/** A columnar table exactly like the one a SourceReader delivers. */
const table = (columnNames, rowCount, cell = (c, i) => `${columnNames[c]}${i}`) =>
  Object.freeze({
    columns: Object.freeze(
      columnNames.map((name, c) =>
        Object.freeze({
          name,
          domain: 'text',
          cells: Object.freeze(Array.from({ length: rowCount }, (_, i) => cell(c, i))),
        }),
      ),
    ),
    rowCount,
  })

const extent = (b) => b.topPx + (b.end - b.start) * ROW_HEIGHT_PX + b.bottomPx

describe('the constants', () => {
  it('are the AD-24 numbers', () => {
    expect(ROW_HEIGHT_PX).toBe(28)
    expect(WINDOW_SIZE).toBe(50)
  })

  it('keep a page under the measured Firefox collapse point', () => {
    // ~17.2 M px is where Firefox collapses an oversized spacer to zero height.
    // The safe extent must sit under it with room, and a full page of rows must
    // fit inside the safe extent — otherwise the guard guards nothing.
    expect(SAFE_EXTENT_PX).toBeLessThan(17_200_000)
    expect(PAGE_ROWS * ROW_HEIGHT_PX).toBeLessThanOrEqual(SAFE_EXTENT_PX)
  })
})

describe('window bounds', () => {
  it('starts at the top with a full window and the rest as bottom spacer', () => {
    const b = windowBounds(0, 1500)

    expect(b).toMatchObject({ start: 0, end: 50, topPx: 0 })
    expect(b.bottomPx).toBe((1500 - 50) * ROW_HEIGHT_PX)
  })

  it('tracks the middle: the first visible row is the first row rendered', () => {
    const b = windowBounds(25 * ROW_HEIGHT_PX, 1500)

    expect(b).toMatchObject({ start: 25, end: 75 })
    expect(b.topPx).toBe(25 * ROW_HEIGHT_PX)
    expect(b.bottomPx).toBe((1500 - 75) * ROW_HEIGHT_PX)
  })

  it('a partial row scrolled past still counts as the row above', () => {
    // 27 px into row 0 is still row 0 — flooring, not rounding, or the window
    // would start below the row the user is looking at.
    expect(windowBounds(27, 1500).start).toBe(0)
    expect(windowBounds(28, 1500).start).toBe(1)
  })

  it('pins the last window at the end so the last rows are the ones shown', () => {
    const b = windowBounds(1500 * ROW_HEIGHT_PX, 1500)

    expect(b).toMatchObject({ start: 1450, end: 1500, bottomPx: 0 })
    expect(b.topPx).toBe(1450 * ROW_HEIGHT_PX)
  })

  it('spacers plus rendered rows always sum to the true extent', () => {
    for (const rowCount of [0, 1, 49, 50, 51, 1500, PAGE_ROWS]) {
      for (const fraction of [0, 0.25, 0.5, 0.99, 1, 2]) {
        const b = windowBounds(rowCount * ROW_HEIGHT_PX * fraction, rowCount)
        expect(extent(b), `rowCount ${rowCount} at ${fraction}`).toBe(
          rowCount * ROW_HEIGHT_PX,
        )
      }
    }
  })

  it('an empty table is an empty window with no spacers', () => {
    expect(windowBounds(0, 0)).toMatchObject({ start: 0, end: 0, topPx: 0, bottomPx: 0 })
    expect(windowBounds(9999, 0)).toMatchObject({ start: 0, end: 0, topPx: 0, bottomPx: 0 })
  })

  it('fewer rows than the window renders all of them and never scrolls away', () => {
    const b = windowBounds(0, 7)
    expect(b).toMatchObject({ start: 0, end: 7, topPx: 0, bottomPx: 0 })

    // A container cannot scroll past content it fully shows, but a stale offset
    // from a re-read that shrank the table can arrive here anyway.
    expect(windowBounds(10_000, 7)).toMatchObject({ start: 0, end: 7, bottomPx: 0 })
  })

  it('exactly one window of rows is one window', () => {
    expect(windowBounds(0, WINDOW_SIZE)).toMatchObject({
      start: 0,
      end: WINDOW_SIZE,
      topPx: 0,
      bottomPx: 0,
    })
    expect(windowBounds(9999, WINDOW_SIZE)).toMatchObject({ start: 0, end: WINDOW_SIZE })
  })

  it('normalizes a nonsensical offset instead of flooring it into a negative index', () => {
    // Chromium and Firefox both clamp scrollTop at zero, so neither of these
    // arrives from a scroll event in a targeted engine — the rubber-band
    // overscroll that produces a negative offset is Safari/iOS. What this pins
    // is that the *function* survives a bad number from any caller, since a
    // negative start index slices nothing and blanks the view silently.
    expect(windowBounds(-120, 1500)).toMatchObject({ start: 0, end: 50 })
    expect(windowBounds(Number.NaN, 1500)).toMatchObject({ start: 0, end: 50 })
  })

  it('never emits a spacer taller than the safe extent, at either end of a full page', () => {
    for (const rowCount of [PAGE_ROWS, PAGE_ROWS - 1, Math.floor(PAGE_ROWS / 2)]) {
      // Both ends, because each spacer is the tall one at exactly one of them:
      // at the top `bottomPx` carries the whole table, at maximum scroll
      // `topPx` does. Asserting only at scrollTop 0 compares 0 to the limit and
      // passes for any implementation whatsoever.
      const top = windowBounds(0, rowCount)
      const bottom = windowBounds(rowCount * ROW_HEIGHT_PX, rowCount)

      expect(top.topPx).toBe(0)
      expect(top.bottomPx).toBeLessThan(SAFE_EXTENT_PX)

      expect(bottom.bottomPx).toBe(0)
      expect(bottom.topPx).toBeGreaterThan(0)
      expect(bottom.topPx).toBeLessThan(SAFE_EXTENT_PX)
    }
  })
})

describe('paging past the clamp', () => {
  it('is one page for every table below the threshold, so the controls stay hidden', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(1)).toBe(1)
    expect(pageCount(1500)).toBe(1)
    expect(pageCount(PAGE_ROWS)).toBe(1)
  })

  it('engages exactly one row past the threshold', () => {
    expect(pageCount(PAGE_ROWS + 1)).toBe(2)
    expect(pageCount(PAGE_ROWS * 2)).toBe(2)
    expect(pageCount(PAGE_ROWS * 2 + 1)).toBe(3)
  })

  it('offsets pages by whole pages and gives the last page the remainder', () => {
    expect(pageOffset(0)).toBe(0)
    expect(pageOffset(2)).toBe(2 * PAGE_ROWS)

    expect(pageRowCount(0, PAGE_ROWS + 17)).toBe(PAGE_ROWS)
    expect(pageRowCount(1, PAGE_ROWS + 17)).toBe(17)
  })

  it('forces a page back into range when a re-read shrinks the table', () => {
    expect(clampPage(5, PAGE_ROWS + 1)).toBe(1)
    expect(clampPage(3, 1500)).toBe(0)
    expect(clampPage(-2, 1500)).toBe(0)
    expect(pageRowCount(9, 1500)).toBe(1500)
  })

  it('covers every row across its pages, leaving none unreachable', () => {
    const rowCount = PAGE_ROWS * 2 + 42
    let covered = 0
    for (let p = 0; p < pageCount(rowCount); p += 1) covered += pageRowCount(p, rowCount)

    expect(covered).toBe(rowCount)
    expect(pageOffset(pageCount(rowCount) - 1) + pageRowCount(2, rowCount)).toBe(rowCount)
  })
})

describe('slicing rows out of a columnar table', () => {
  const t = table(['Ort', 'Wert'], 100)

  it('strides across the columns at each index', () => {
    expect(sliceRows(t, 0, 3)).toEqual([
      ['Ort0', 'Wert0'],
      ['Ort1', 'Wert1'],
      ['Ort2', 'Wert2'],
    ])
  })

  it('builds only the window it was asked for', () => {
    const rows = sliceRows(t, 90, 95)

    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual(['Ort90', 'Wert90'])
    expect(rows[4]).toEqual(['Ort94', 'Wert94'])
  })

  it('freezes what it produces — rows are frozen where produced (AD-6)', () => {
    const rows = sliceRows(t, 0, 2)

    expect(Object.isFrozen(rows)).toBe(true)
    expect(Object.isFrozen(rows[0])).toBe(true)
  })

  it('clamps bounds a shrinking re-read can leave behind', () => {
    expect(sliceRows(t, 98, 140)).toHaveLength(2)
    expect(sliceRows(t, 200, 250)).toHaveLength(0)
    expect(sliceRows(t, -5, 2)).toEqual([
      ['Ort0', 'Wert0'],
      ['Ort1', 'Wert1'],
    ])
    expect(sliceRows(t, 40, 10)).toHaveLength(0)
  })

  it('a table with no columns has no rows to slice', () => {
    expect(sliceRows(table([], 0), 0, 50)).toHaveLength(0)
  })

  it('keeps cell values exactly as parsed — no trimming, no typing', () => {
    const raw = table(['a'], 3, () => '')
    const odd = Object.freeze({
      columns: Object.freeze([
        Object.freeze({ name: 'a', domain: 'text', cells: Object.freeze(['  1,50  ', '', 'x']) }),
      ]),
      rowCount: 3,
    })

    expect(sliceRows(odd, 0, 3)).toEqual([['  1,50  '], [''], ['x']])
    expect(sliceRows(raw, 0, 3)).toEqual([[''], [''], ['']])
  })
})

describe('the whole projection', () => {
  const t = table(['Ort', 'Wert'], 1500)

  it('is what a view renders, in table coordinates', () => {
    const w = buildWindow(t, 0, 0)

    expect(w).toMatchObject({ firstRow: 0, topPx: 0, page: 0, pages: 1 })
    expect(w.rows).toHaveLength(WINDOW_SIZE)
    expect(w.rows[0]).toEqual(['Ort0', 'Wert0'])
    expect(w.bottomPx).toBe((1500 - WINDOW_SIZE) * ROW_HEIGHT_PX)
  })

  it('is frozen through, so ui/ may hold it as one value in a shallowRef', () => {
    const w = buildWindow(t, 0, 0)

    expect(Object.isFrozen(w)).toBe(true)
    expect(Object.isFrozen(w.rows)).toBe(true)
    expect(Object.isFrozen(w.rows[0])).toBe(true)
  })

  it('follows the scroll offset and pins the last window at the end', () => {
    expect(buildWindow(t, 0, 700).firstRow).toBe(25)
    expect(buildWindow(t, 0, 1500 * ROW_HEIGHT_PX)).toMatchObject({ firstRow: 1450, bottomPx: 0 })
    expect(buildWindow(t, 0, 1500 * ROW_HEIGHT_PX).rows[49]).toEqual(['Ort1499', 'Wert1499'])
  })

  // The paged case, which no fixture a browser test can afford ever reaches:
  // 571,438 rows is two pages. The cell array is sparse — the window only ever
  // touches the indices it slices, so the holes cost nothing — and the four
  // values below are placed exactly where a correct page offset must land.
  describe('past the clamp, where only this envelope can look', () => {
    const cells = []
    cells[0] = 'first of page 0'
    cells[PAGE_ROWS - 1] = 'last of page 0'
    cells[PAGE_ROWS] = 'first of page 1'
    cells[PAGE_ROWS + 9] = 'last of page 1'
    cells.length = PAGE_ROWS + 10

    const big = Object.freeze({
      columns: Object.freeze([Object.freeze({ name: 'Nr', domain: 'text', cells })]),
      rowCount: PAGE_ROWS + 10,
    })

    it('page 0 is the first PAGE_ROWS rows and reports two pages', () => {
      const w = buildWindow(big, 0, 0)

      expect(w).toMatchObject({ page: 0, pages: 2, firstRow: 0, topPx: 0 })
      expect(w.rows[0]).toEqual(['first of page 0'])
      expect(w.bottomPx).toBe((PAGE_ROWS - WINDOW_SIZE) * ROW_HEIGHT_PX)
      expect(w.bottomPx).toBeLessThan(SAFE_EXTENT_PX)
    })

    it('the end of page 0 is the row before the page boundary, not the end of the table', () => {
      const w = buildWindow(big, 0, PAGE_ROWS * ROW_HEIGHT_PX)

      expect(w).toMatchObject({ page: 0, firstRow: PAGE_ROWS - WINDOW_SIZE, bottomPx: 0 })
      expect(w.rows[WINDOW_SIZE - 1]).toEqual(['last of page 0'])
    })

    // The assertion the whole function exists for: drop the page offset and
    // this reads 'first of page 0' at firstRow 0 while `page` still says 1.
    it('page 1 starts at row PAGE_ROWS and carries the remainder', () => {
      const w = buildWindow(big, 1, 0)

      expect(w).toMatchObject({ page: 1, pages: 2, firstRow: PAGE_ROWS, topPx: 0, bottomPx: 0 })
      expect(w.rows).toHaveLength(10)
      expect(w.rows[0]).toEqual(['first of page 1'])
      expect(w.rows[9]).toEqual(['last of page 1'])
    })

    it('a page past the end is forced back onto the last one', () => {
      expect(buildWindow(big, 7, 0)).toMatchObject({ page: 1, firstRow: PAGE_ROWS })
    })

    it('every row of the table is reachable across the pages', () => {
      let seen = 0
      for (let p = 0; p < buildWindow(big, 0, 0).pages; p += 1) {
        seen += pageRowCount(p, big.rowCount)
      }
      expect(seen).toBe(big.rowCount)
    })
  })

  it('an empty table projects to an empty window on one page', () => {
    const w = buildWindow(table([], 0), 0, 0)

    expect(w).toMatchObject({ firstRow: 0, topPx: 0, bottomPx: 0, page: 0, pages: 1 })
    expect(w.rows).toHaveLength(0)
  })

  it('a table with columns but no rows keeps its one page', () => {
    const w = buildWindow(table(['a', 'b'], 0), 0, 0)

    expect(w.rows).toHaveLength(0)
    expect(w.pages).toBe(1)
  })
})

// ------------------------------------------------------------------ the marks
//
// Story 6a marks the cells that did not parse under a confirmed type. What is
// here is only the projection: which cells of the *window* are marked, in table
// coordinates, so a mark on row 600,000 lands on the right row on the right page.
// Nothing in this file knows why a cell is marked, and that is the seam — a later
// caller marking something else needs no change here.

describe('marks projected alongside the rows', () => {
  const marksOf = (perColumn) => perColumn.map((rows) => (rows === null ? null : new Set(rows)))

  it('are empty where nothing is marked, so the common case allocates nothing', () => {
    // Three ways of saying "nothing is marked", and all three have to reach the
    // early return. The third is the one that matters — a Source where every
    // value read still produces one entry per column, and only their contents
    // say so. Without it the window builds and freezes an all-`false` boolean
    // grid on every scroll event of a perfectly clean table.
    const t = table(['a', 'b'], 10)

    expect(buildWindow(t, 0, 0).marked).toEqual([])
    expect(sliceMarks(null, 2, 0, 10)).toEqual([])
    expect(sliceMarks([null, null], 2, 0, 10)).toEqual([])
    expect(buildWindow(t, 0, 0, [null, null]).marked).toEqual([])
  })

  it('are the same shape as the rows, cell for cell', () => {
    const t = table(['a', 'b', 'c'], 10)
    const w = buildWindow(t, 0, 0, marksOf([[1, 3], null, [3]]))

    expect(w.marked).toHaveLength(w.rows.length)
    expect(w.marked.every((row) => row.length === 3)).toBe(true)
    expect(w.marked[1]).toEqual([true, false, false])
    expect(w.marked[3]).toEqual([true, false, true])
    expect(w.marked[0]).toEqual([false, false, false])
  })

  it('read the row index in table coordinates, not window ones', () => {
    // The window starts at row 20 here. A mark on row 22 must land on the third
    // row of the window, and a mark on row 2 must land nowhere — which is the
    // failure a window-relative lookup would produce, silently and on every
    // scroll.
    const t = table(['a'], 200)
    const w = buildWindow(t, 0, 20 * ROW_HEIGHT_PX, marksOf([[2, 22]]))

    expect(w.firstRow).toBe(20)
    expect(w.marked[0]).toEqual([false])
    expect(w.marked[2]).toEqual([true])
    expect(w.marked.filter((row) => row[0]).length).toBe(1)
  })

  it('survive the page offset, which is where a window-relative lookup would break', () => {
    const t = table(['a'], PAGE_ROWS + 100)
    const w = buildWindow(t, 1, 0, marksOf([[PAGE_ROWS + 3]]))

    expect(w.firstRow).toBe(PAGE_ROWS)
    expect(w.marked[3]).toEqual([true])
    expect(w.marked[0]).toEqual([false])
  })

  it('are frozen, so the projection a shallowRef holds cannot be edited under it', () => {
    const w = buildWindow(table(['a'], 4), 0, 0, marksOf([[0]]))

    expect(Object.isFrozen(w.marked)).toBe(true)
    expect(Object.isFrozen(w.marked[0])).toBe(true)
  })

  it('mark nothing on a table with no columns', () => {
    expect(sliceMarks(marksOf([[0]]), 0, 0, 5)).toEqual([])
  })
})
