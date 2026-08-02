---
title: 'Story 2 — Source preview: bounded row window with full-Source counts'
type: 'feature'
created: '2026-08-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0695c4d9a58e415f15daf1b5b2644cbbe39e8c1f'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A loaded Source shows its column names and row count, but no cell value ever reaches the screen — the user cannot see what actually arrived (CAP-8, tabular part). The JSON/NDJSON structure view is story 17's.

**Approach:** Build the AD-24 row-window mechanism once — pure geometry in `core/view`, one Vue component in `ui/` — and render a bounded window of each Source's raw parsed table inside its card. Row and column counts shown are the Source's totals, never the window's. The Result table (story 10) will reuse the same mechanism.

## Boundaries & Constraints

**Always:**
- AD-24: fixed-height rows, a ~50-row render window, no column virtualization. The spacer height is clamped below the measured engine scroll-extent limit (Firefox collapses oversized spacers to zero at ~17.2 M px, ~614k rows at 28 px); beyond the clamp the table pages instead of scrolls. The guard ships regardless of Firefox's fate.
- AD-6: no row array and no table ever enters `ref`, `reactive` or a `computed` return value. Window slices are built by plain functions, frozen, and held in `shallowRef` only — the discipline `SourcesPane.vue` already practices.
- AD-1/AD-2: the geometry module in `core/view` is DOM-free (lint bans `window`/`document` in `core/**`); scroll measurement and event handling stay in `ui/`.
- Counts come from `table.rowCount` and `table.columns.length` — the parsed table's totals, formatted de-DE (existing `nf` helper). Damaged rows stay excluded and inspectable only via the existing damage report.
- Cells render as raw text exactly as parsed (every column is domain `text`); no trimming, typing, or value formatting — typing is Step zero (story 3).
- Preview reflects re-reads: `overrideEncoding` / `reconfigureParse` produce a new frozen entry and the existing `refresh()` re-projection updates the grid. No store event/subscription mechanism is introduced.
- AD-13: any new user-facing text is German, rendered in `ui/` only.

**Ask First:** any new dependency (no virtual-scroller library); adding a subscription mechanism to the store; deviating from the 28 px fixed row height.

**Never:** JSON/NDJSON structure view (story 17); implementing the `Table` port (AD-5, story 6) — the preview reads the reader-result value `{columns, rowCount}` as is; column virtualization; Result table, view filter/sort/search (stories 10–11); persisting scroll state.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal preview | 1,500-row CSV loaded | header row from `columns[].name`, first rows' cell values visible; counts read `1.500 Zeilen, 5 Spalten` while ≤ ~50 rows exist in the DOM | N/A |
| Scroll to end | user scrolls the preview to the bottom | the last rows' true values appear (row `i` strided from `columns[c].cells[i]`); scrollbar length reflects the full rowCount via spacers | N/A |
| Source above clamp | rowCount past the clamp threshold | preview pages: each page scrolls within the clamped extent, page controls (German) switch pages — never a silently blank table | N/A |
| Encoding override | user switches UTF-8 → 1252 | previewed cell values change to the re-decoded text | N/A |
| Header correction | user sets a different `Kopfzeile` | preview header and rows shift accordingly | N/A |
| Empty Source | `csv.empty` file (`columns: []`, `rowCount: 0`) | counts read `0 Zeilen`; a German empty-state line replaces the grid | N/A |
| Source removed | user removes the Source | preview disappears with its card, no orphaned listeners | N/A |

</frozen-after-approval>

## Code Map

- `core/exec/source-store.js:227-235` — read-only: `get`/`list`, frozen entries. Table shape is columnar: `{columns: [{name, domain: 'text', cells}], rowCount}` (built in `adapters/csv/csv-reader.js:262-268`); `rowCount === columns[0].cells.length`. No store change.
- `core/view/row-window.js` — new (new dir; precedent: AD-24 places FR-32's view predicate in `core/`): pure geometry. Constants `ROW_HEIGHT_PX = 28`, `WINDOW_SIZE = 50`, clamp derived from the measured 17.2 M px Firefox limit with a safety margin. Functions: window bounds + spacer heights from `(scrollTop, rowCount)`; page count/offset math past the clamp; a `sliceRows(table, start, end)` that strides across columns and returns frozen row arrays. Unit-testable under the existing `core/**` Vitest include (node env — keep it DOM-free).
- `ui/RowWindow.vue` — new: scroll container + `<table>`, fixed 28 px rows, top/bottom spacers, scroll handler updating a frozen window slice held in `shallowRef` (imperative update, no `computed` — AD-6), page controls when paging engages. Receives the table as a plain prop value. Tailwind utilities, no `<style>` block (repo convention).
- `ui/SourcesPane.vue:247-259` — the column-name chips are replaced by the preview grid (its header row now carries the names); the counts line (L247) extends to `{rows} Zeilen, {cols} Spalten` via `nf` (L26). `refresh()` (L22) already re-projects after every command — reuse.
- `app/main.js` — unchanged.
- `tests/e2e/csv-sources.spec.js:46-47` — helpers `pick`/`cards`; any assertion anchored on the column chips must be re-anchored to the grid header.
- `tests/e2e/source-preview.spec.js` — new; fixture bytes inline as in `csv-sources.spec.js:29-47` (no fixture files on disk); suite runs against `dist/index.html` from `file://`, both engines.

## Tasks & Acceptance

**Execution:**
- [x] `core/view/row-window.js` + `row-window.test.js` — geometry + slicing — bounds at start/middle/end, spacers summing to true extent, clamp threshold, page math; edges: 0 rows, fewer rows than window, exactly the clamp boundary.
- [x] `ui/RowWindow.vue` — the reusable AD-24 component — story 10 must be able to adopt it unchanged.
- [x] `ui/SourcesPane.vue` — embed the preview per Source card, replace chips, extend counts line — CAP-8 surface.
- [x] `tests/e2e/csv-sources.spec.js` — re-anchor chip-based assertions to the grid header.
- [x] `tests/e2e/source-preview.spec.js` — cover the I/O matrix rows: totals vs. DOM row ceiling, scroll-to-end values, override re-read, header correction, empty Source, German count formatting.

**Acceptance Criteria:**
- Given a generated 1,500-row fixture, when its card renders, then the DOM holds at most ~50 preview rows while the counts line shows `1.500`.
- Given the preview is scrolled to the bottom, when the window updates, then the visible cells equal the last rows of the parsed table.
- Given `npm run verify`, then lint, Vitest and Playwright (Chromium + Firefox, `file://`) pass.
- Given a reviewer greps `ui/`, then no `ref(`, `reactive(` or `computed(` holds rows or tables (AD-6).

## Spec Change Log

## Design Notes

- The table is columnar; a row window is materialized by striding `columns[c].cells[i]` for `i` in `[start, end)` — never materialize all rows.
- Clamp/paging: `pageRows = floor(SAFE_EXTENT_PX / ROW_HEIGHT_PX)`; below the threshold exactly one page exists and the controls stay hidden, so the common case looks like plain scrolling. The e2e envelope cannot afford a 614k-row fixture — the guard is proven by the geometry unit tests; the constant carries a comment citing the measurement.
- No store events exist (deliberately); the preview updates because commands mint new frozen entries and `refresh()` swaps the `shallowRef`.

## Verification

**Commands:**
- `npm run lint` — clean; proves `core/view` respects the no-DOM wall.
- `npm test` — geometry suite green alongside existing suites.
- `npm run test:e2e` — builds `dist/` and runs both engines from `file://`.

## Suggested Review Order

**The mechanism — what a scroll offset means**

- The whole projection in one pure call; the component below is two lines of glue.
  [`row-window.js:189`](../../core/view/row-window.js#L189)

- Scroll offset to row index, plus the two spacer heights that make the scrollbar honest.
  [`row-window.js:106`](../../core/view/row-window.js#L106)

- A row is a stride across columns — the whole table is never materialized.
  [`row-window.js:152`](../../core/view/row-window.js#L152)

- The clamp: why 16 M px, and why paging is the guard past it.
  [`row-window.js:50`](../../core/view/row-window.js#L50)

**The surface — DOM on one side of the wall only**

- Imperative update into a `shallowRef`; no rows in `ref`/`reactive`/`computed` (AD-6).
  [`RowWindow.vue:68`](../../ui/RowWindow.vue#L68)

- Every height bound from `ROW_HEIGHT_PX`, so the CSS and the constant cannot drift.
  [`RowWindow.vue:112`](../../ui/RowWindow.vue#L112)

- Row coordinates for assistive tech: the table announces its totals, not its window.
  [`RowWindow.vue:126`](../../ui/RowWindow.vue#L126)

- A re-read mints a new frozen table; identity change resets the window, no subscription.
  [`RowWindow.vue:85`](../../ui/RowWindow.vue#L85)

- Page controls, hidden for every table below the clamp.
  [`RowWindow.vue:200`](../../ui/RowWindow.vue#L200)

**The Source card — CAP-8**

- Counts are the Source's totals, never the window's.
  [`SourcesPane.vue:251`](../../ui/SourcesPane.vue#L251)

- Chips replaced by the grid, whose header row now carries the column names.
  [`SourcesPane.vue:257`](../../ui/SourcesPane.vue#L257)

**Tests**

- The paged case, unit-tested where the fixture is a number rather than 500 MB of CSV.
  [`row-window.test.js:241`](../../core/view/row-window.test.js#L241)

- Totals versus the DOM row ceiling — the story's headline promise.
  [`source-preview.spec.js:87`](../../tests/e2e/source-preview.spec.js#L87)

- The 28 px row survives a browser font size that is not 16 px.
  [`source-preview.spec.js:192`](../../tests/e2e/source-preview.spec.js#L192)

- Chip-anchored assertions re-anchored to the grid's header role.
  [`csv-sources.spec.js:76`](../../tests/e2e/csv-sources.spec.js#L76)
