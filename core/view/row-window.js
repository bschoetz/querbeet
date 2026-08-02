// AD-24 — the row window, as pure geometry. Every table this product shows a
// person renders through fixed-height row windowing: the Source preview here,
// the Result table in Story 10. The mechanism is built once, and this file is
// the half of it that has no DOM in it.
//
// Nothing below touches `window`, `document` or an element (AD-2). The caller
// in ui/ measures a scroll offset and applies the pixel heights; what those
// numbers *mean* is decided here, where it can be tested under Vitest with no
// browser (AD-27).
//
// Three facts drive the whole file:
//
//   1. Rows are a fixed height, so the row a scroll offset lands on is a
//      division, not a measurement.
//   2. Only a window of rows exists in the DOM; the rows above and below it are
//      represented by two spacers whose heights sum to the extent the absent
//      rows would have occupied. The scrollbar therefore describes the whole
//      table while the DOM holds ~50 rows.
//   3. A spacer cannot be arbitrarily tall. Firefox collapses an oversized
//      spacer to *zero* height at roughly 17.2 M px — about 614,000 rows at
//      28 px — where Chromium clamps and keeps working. A table that silently
//      renders nothing at the design target is exactly the failure AD-24
//      exists to prevent, so past the clamp the view pages instead of
//      scrolling. The guard ships regardless of whether Firefox stays a target.
//
//      The measurement is AD-24 in the architecture spine
//      (_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/
//      ARCHITECTURE-SPINE.md), which is where to go with a Firefox release that
//      claims to have moved the limit — a number here that nobody can trace back
//      to a measurement is a number nobody will dare change.
//
// There is no column virtualization here and none is planned (AD-24).

/** Fixed row height. Deviating from it is an "ask first" per the story spec:
 *  every offset below is a multiple of this number, and a row that renders
 *  taller than it drifts the window away from what the user actually sees. */
export const ROW_HEIGHT_PX = 28

/** Rows materialized into the DOM at once. It must exceed the number of rows a
 *  scroll container can show at once — the window starts at the first visible
 *  row and extends downward, so a container taller than WINDOW_SIZE rows would
 *  show empty space below the window. At 28 px that is 1,400 px of viewport;
 *  the preview container is a fraction of that. */
export const WINDOW_SIZE = 50

/** The tallest spacer extent we are willing to emit, with a margin below the
 *  ~17.2 M px measured Firefox collapse point. The margin is deliberate: the
 *  limit is a measurement of one engine on one day, not a specified constant,
 *  and being 7 % under it costs nothing. */
export const SAFE_EXTENT_PX = 16_000_000

/** Rows per page. Below one page the controls stay hidden and the view is
 *  plain scrolling, which is every real Source this product will ever see —
 *  paging is the guard, not the interaction. */
export const PAGE_ROWS = Math.floor(SAFE_EXTENT_PX / ROW_HEIGHT_PX)

/** A count arriving from outside is normalized rather than trusted: NaN or a
 *  negative would otherwise propagate into a pixel height and blank the view. */
const count = (n) => {
  const i = Math.trunc(n)
  return Number.isFinite(i) && i > 0 ? i : 0
}

/** How many pages a table of `rowCount` rows occupies. Always at least one, so
 *  callers never special-case the empty table. */
export function pageCount(rowCount) {
  const total = count(rowCount)
  return Math.max(1, Math.ceil(total / PAGE_ROWS))
}

/** A page index forced into range — the only way a caller should change pages,
 *  since a re-read can shrink a table under a page the user is standing on. */
export function clampPage(page, rowCount) {
  const p = Math.trunc(page)
  if (!Number.isFinite(p) || p < 0) return 0
  return Math.min(p, pageCount(rowCount) - 1)
}

/** The index, in the whole table, of the first row on `page`. Callers pass a
 *  page they already clamped; a stray negative is floored rather than trusted. */
export function pageOffset(page) {
  return count(page) * PAGE_ROWS
}

/** How many rows sit on `page` — the last page carries the remainder. */
export function pageRowCount(page, rowCount) {
  const total = count(rowCount)
  const offset = clampPage(page, total) * PAGE_ROWS
  return Math.max(0, Math.min(PAGE_ROWS, total - offset))
}

/**
 * The window a scroll offset selects, and the two spacer heights around it.
 *
 * `rowCount` is the row count *of the current page*, not of the table — which
 * is what keeps `bottomPx` under SAFE_EXTENT_PX by construction rather than by
 * a second clamp that could be forgotten.
 *
 * `topPx + (end - start) * ROW_HEIGHT_PX + bottomPx` is always the true extent
 * of `rowCount` rows, which is what makes the scrollbar honest.
 *
 * @param {number} scrollTop pixels scrolled inside the container
 * @param {number} rowCount rows on the current page
 * @returns {{ start: number, end: number, topPx: number, bottomPx: number }}
 */
export function windowBounds(scrollTop, rowCount) {
  const total = count(rowCount)
  // Chromium and Firefox both clamp `scrollTop` at zero, so a scroll event in
  // the engines this product targets cannot deliver a negative offset — the
  // rubber-band overscroll that does is a Safari/iOS behaviour. The
  // normalization stays anyway: this function's input is a number a caller
  // passes, not a value only a scroll event can produce, and a negative or NaN
  // offset from anywhere would floor into a negative start index, slice nothing
  // and blank the view. Cheap guard, silent failure prevented.
  const top = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0

  // Pinning the start at `total - WINDOW_SIZE` is what makes the bottom of the
  // scroll range show the *last* rows rather than a short window followed by
  // blank space.
  const maxStart = Math.max(0, total - WINDOW_SIZE)
  const start = Math.min(Math.floor(top / ROW_HEIGHT_PX), maxStart)
  const end = Math.min(total, start + WINDOW_SIZE)

  return Object.freeze({
    start,
    end,
    topPx: start * ROW_HEIGHT_PX,
    bottomPx: (total - end) * ROW_HEIGHT_PX,
  })
}

const NO_ROWS = Object.freeze([])

/**
 * Materialize rows `[start, end)` of a columnar table.
 *
 * The table is columnar — `{ columns: [{ name, domain, cells }], rowCount }` —
 * so a row is a stride across the columns at one index. Only the window is
 * built; the whole table is never materialized as rows, which is the point of
 * the mechanism (AD-6: rows are frozen where produced and never enter reactive
 * state).
 *
 * Out-of-range bounds are clamped rather than refused: a re-read can shrink a
 * table between a scroll event and the render that follows it, and a preview
 * that throws there would be a worse answer than a shorter window.
 *
 * @param {{ columns: ReadonlyArray<{ cells: ReadonlyArray<string> }>, rowCount: number }} table
 * @param {number} start inclusive
 * @param {number} end exclusive
 * @returns {ReadonlyArray<ReadonlyArray<string>>}
 */
export function sliceRows(table, start, end) {
  const columns = table.columns
  if (columns.length === 0) return NO_ROWS

  const total = count(table.rowCount)
  const from = Math.min(count(start), total)
  const to = Math.max(from, Math.min(count(end), total))

  const rows = new Array(to - from)
  for (let i = from; i < to; i += 1) {
    const row = new Array(columns.length)
    for (let c = 0; c < columns.length; c += 1) row[c] = columns[c].cells[i]
    rows[i - from] = Object.freeze(row)
  }
  return Object.freeze(rows)
}

/**
 * The whole projection in one pure step: everything a view needs to render
 * `table` at `page` and `scrollTop`.
 *
 * This composition lives here rather than in the component for one reason: it
 * is where the page offset is applied to the window bounds, and that arithmetic
 * is invisible to any fixture small enough to test through a browser. Dropping
 * the offset makes page 2 render page 1's rows under a label reading "Seite 2",
 * which no e2e suite this product can afford would notice. Here it is one
 * assertion against a table with a sparse cell array, in the node envelope.
 *
 * The return value is frozen and holds no handle to anything mutable, so a
 * caller in ui/ may hold it in a `shallowRef` as one value (AD-6).
 *
 * @param {{ columns: ReadonlyArray<object>, rowCount: number }} table
 * @param {number} page current page index; forced into range
 * @param {number} scrollTop pixels scrolled inside the container
 * @returns {{ rows: ReadonlyArray<ReadonlyArray<string>>, firstRow: number,
 *            topPx: number, bottomPx: number, page: number, pages: number }}
 */
export function buildWindow(table, page, scrollTop) {
  const total = count(table.rowCount)
  const current = clampPage(page, total)
  const offset = pageOffset(current)
  const bounds = windowBounds(scrollTop, pageRowCount(current, total))

  // `firstRow` is a table coordinate, not a page or window coordinate: it is
  // what the view renders as aria-rowindex and what keys the rows, and both
  // have to mean the same thing on page 2 as on page 1.
  const firstRow = offset + bounds.start

  return Object.freeze({
    rows: sliceRows(table, firstRow, offset + bounds.end),
    firstRow,
    topPx: bounds.topPx,
    bottomPx: bounds.bottomPx,
    page: current,
    pages: pageCount(total),
  })
}
