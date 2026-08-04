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

const NO_MARKS = Object.freeze([])

/**
 * The marked state of the same window, cell for cell — `marked[r][c]` beside
 * `rows[r][c]`.
 *
 * `marks` is one entry per column: a set of row indices, or `null`/absent for a
 * column with nothing marked. It is a *projection alongside* the table, not a
 * change to it — `sliceRows` still reads `columns[c].cells[i]` and the windowing
 * arithmetic above is untouched, which is the whole reason the two are separate
 * functions. Story 6a's marks are the cells that did not parse under a confirmed
 * type; nothing here knows that, and a later caller marking something else needs
 * no change.
 *
 * Row indices are **table coordinates**, the same ones `firstRow` is in, so a
 * mark on row 60,000 lands on the right row on the right page.
 *
 * @param {ReadonlyArray<ReadonlySet<number>|null>|null} marks per column
 * @param {number} columnCount
 * @param {number} start inclusive, in table coordinates
 * @param {number} end exclusive
 * @returns {ReadonlyArray<ReadonlyArray<boolean>>} empty where nothing is marked
 */
export function sliceMarks(marks, columnCount, start, end) {
  // An array of nothing but `null`s is the same answer as no array, and it is
  // the *common* one — a Source where every value read. Without this line the
  // window builds and freezes one all-`false` boolean row per rendered row on
  // every scroll event, for a table with nothing to mark. The caller answers the
  // question too, once per entry; this is the half that makes the early return
  // true of its own argument rather than of its caller's discipline.
  if (!marks || columnCount === 0 || marks.every((set) => set == null)) return NO_MARKS

  const from = count(start)
  const to = Math.max(from, count(end))

  const out = new Array(to - from)
  for (let i = from; i < to; i += 1) {
    const row = new Array(columnCount)
    for (let c = 0; c < columnCount; c += 1) row[c] = marks[c]?.has(i) === true
    out[i - from] = Object.freeze(row)
  }
  return Object.freeze(out)
}

/**
 * A bounded columnar view of an engine `Table`, for a Step's own preview.
 *
 * `buildWindow` above reads a **columnar** table — `{ columns: [{ name, cells }],
 * rowCount }` — which is what a `SourceReader` delivers and what the Sources pane
 * has always handed it. A Step's output is a `Table` handle instead (AD-5), whose
 * only row-shaped door is `rows()`, so something has to bridge the two.
 *
 * **It is bounded, and the bound is the whole design.** `column(name)` re-extracts
 * and re-copies a whole column on every call, so building a columnar view of a
 * 100,000-row output would copy the entire table once per Step per render; and
 * `rows()` is a generator, so reading the first `limit` rows of a hundred thousand
 * costs `limit` rows. The counts CAP-19 asks for are the Step's **full** output
 * and are read off `rowCount()` and `schema()` without materializing anything —
 * so the numbers are complete while the grid shows a window, which is exactly the
 * split AD-5 puts on the interface.
 *
 * Values are machine values, not text: a temporal cell is a `BigInt` and a box has
 * already materialized as its original text at the handle's edge. `ui/cell-text.js`
 * is what turns either into German — the projection is a `ui/` concern, and a
 * German string produced here would be the core talking to the user (AD-13).
 *
 * @param {import('../../ports/index.js').Table} table
 * @param {number} limit how many rows to materialize
 * @returns {{ columns: ReadonlyArray<{ name: string, type: string, cells: ReadonlyArray<unknown> }>,
 *            rowCount: number, totalRows: number }}
 *   `rowCount` is what the grid may address — the rows actually here — while
 *   `totalRows` is the Step's own count, so a caller can say which is which.
 */
export function previewColumns(table, limit = WINDOW_SIZE) {
  const schema = table.schema()
  const total = count(table.rowCount())
  const wanted = Math.min(count(limit), total)

  const cells = schema.map(() => new Array(wanted))
  let r = 0
  if (wanted > 0) {
    for (const row of table.rows()) {
      for (let c = 0; c < schema.length; c += 1) cells[c][r] = row[schema[c].name]
      r += 1
      if (r >= wanted) break
    }
  }

  return Object.freeze({
    columns: Object.freeze(
      schema.map((column, c) =>
        Object.freeze({ name: column.name, type: column.type, cells: Object.freeze(cells[c]) }),
      ),
    ),
    rowCount: r,
    totalRows: total,
  })
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
 * @param {ReadonlyArray<ReadonlySet<number>|null>|null} [marks] per column, in
 *   table coordinates; omitted or `null` marks nothing
 * @returns {{ rows: ReadonlyArray<ReadonlyArray<string>>,
 *            marked: ReadonlyArray<ReadonlyArray<boolean>>, firstRow: number,
 *            topPx: number, bottomPx: number, page: number, pages: number }}
 */
export function buildWindow(table, page, scrollTop, marks = null) {
  const total = count(table.rowCount)
  const current = clampPage(page, total)
  const offset = pageOffset(current)
  const bounds = windowBounds(scrollTop, pageRowCount(current, total))

  // `firstRow` is a table coordinate, not a page or window coordinate: it is
  // what the view renders as aria-rowindex and what keys the rows, and both
  // have to mean the same thing on page 2 as on page 1.
  const firstRow = offset + bounds.start
  const lastRow = offset + bounds.end

  return Object.freeze({
    rows: sliceRows(table, firstRow, lastRow),
    // Same bounds as the rows, so `marked[r][c]` and `rows[r][c]` are the same
    // cell by construction rather than by two clamps agreeing. `bounds.end` is
    // already inside the page and the page is already inside the table, so
    // neither needs a second clamp here.
    marked: sliceMarks(marks, table.columns.length, firstRow, lastRow),
    firstRow,
    topPx: bounds.topPx,
    bottomPx: bounds.bottomPx,
    page: current,
    pages: pageCount(total),
  })
}
