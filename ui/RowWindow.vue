<script setup>
// The AD-24 row window, rendered. This is the reusable half of the mechanism:
// the Source preview embeds it today, the Result table (Story 10) embeds the
// same component. It receives a columnar table `{ columns, rowCount }` and
// renders a bounded window of it.
//
// AD-6 is the rule that shapes this file. No row array and no table enters
// `ref`, `reactive` or a `computed` return value: the window slice is built by
// the plain functions in core/view, frozen there, and held in a `shallowRef`
// that is replaced wholesale. The scroll handler updates it imperatively —
// a `computed` over `scrollTop` would be the same data in deep reactivity
// wearing a different name.
//
// AD-1/AD-2 split the mechanism: everything that decides *which* rows and how
// tall is DOM-free and lives in core/view/row-window.js, down to composing the
// page offset with the window bounds — that arithmetic is invisible to any
// fixture a browser test can afford, so it belongs where a node test can see
// it. What is left here is genuinely a browser concern: reading a scroll
// offset off an element and painting the numbers. German is rendered here
// (AD-13).
//
// The fixed 28 px row is load-bearing, not cosmetic — every offset the geometry
// computes is a multiple of it, and a row that renders taller drifts the window
// away from the rows the user is looking at, further with every screen scrolled
// and invisibly, because the rows shown are still real rows. So the heights are
// bound from ROW_HEIGHT_PX itself rather than from a utility class: `h-7` is
// 1.75rem, this project omits Tailwind's preflight and sets no root font size,
// and a user whose browser default is not 16 px would silently get rows the
// geometry does not know about. The `py-0` matters for the same reason — the UA
// stylesheet gives a table cell 1 px of padding — as does `whitespace-nowrap`
// and the absence of a per-row border.
//
// The zebra stripe is keyed to the row's index in the *table*, not to its
// position in the window — `odd:` would restripe every row each time the window
// slid, which reads as the whole grid flickering while scrolling.
//
// Marks are a projection *alongside* the rows, never a change to them: `core/
// view` answers which cells of the window are marked and this file renders that
// as a class plus a `title`. Story 6a marks the cells that did not parse under a
// confirmed type; nothing here knows that, which is what lets a later caller mark
// something else without touching the geometry.
//
// aria-rowcount / aria-rowindex are in table coordinates for the same reason
// the counts line is: this story's promise is that what is reported is the
// Source's total. A virtualized grid that stays silent tells a screen reader it
// holds fifty rows whose numbering restarts on every scroll.

import { onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { ROW_HEIGHT_PX, buildWindow, pageRowCount } from '@core/view/row-window.js'

const props = defineProps({
  table: { type: Object, required: true },
  /** Accessible name for the scroll region — a preview and a Result table are
   *  not the same thing to someone navigating by landmark. */
  label: { type: String, default: 'Tabellenvorschau' },
  /** One entry per column: a `Set` of row indices to mark, or `null`. Story 6a
   *  passes the cells that did not parse under the confirmed type; this
   *  component only knows that some cells are marked and what to call them. It
   *  is a render, not a search — `core/view` projects the window's marked state
   *  alongside its rows and the windowing arithmetic is untouched. */
  marks: { type: Array, default: null },
  /** What a marked cell says on hover. German lives in `ui/` (AD-13), and the
   *  sentence belongs to whoever knows *why* the cell is marked, which is not
   *  this component. It is rendered as `title`, which is a pointer affordance —
   *  see the note at the cell for what that does and does not reach. */
  markTitle: { type: String, default: '' },
})

const scroller = useTemplateRef('scroller')

/** Rows of viewport, not of window. The container must stay well under
 *  WINDOW_SIZE rows: the window starts at the first visible row and extends
 *  downward only, so a taller container would show a blank band under the data
 *  while the scrollbar claims there is more. Asserted in the e2e suite against
 *  the rendered element, because a stylesheet is where this would drift. */
const VIEWPORT_ROWS = 10

// shallowRef, never ref/reactive/computed: `rows` holds parsed cell values, and
// the whole projection is one frozen value from core/view (AD-6).
const view = shallowRef(buildWindow({ columns: [], rowCount: 0 }, 0, 0))
const page = shallowRef(0)

const nf = (n) => n.toLocaleString('de-DE')

// The last page can carry a single row, and German counts that differently.
const rowsLabel = (n) => (n === 1 ? '1 Zeile' : `${nf(n)} Zeilen`)

function update() {
  view.value = buildWindow(props.table, page.value, scroller.value?.scrollTop ?? 0, props.marks)
  page.value = view.value.page
}

function goToPage(next) {
  page.value = next
  if (scroller.value) scroller.value.scrollTop = 0
  update()
}

onMounted(update)

// A re-read — an encoding override, a corrected header row — mints a new frozen
// table (AD-7). Row i is then a different row than it was, so the window starts
// over rather than pretending the scroll position survived. No subscription is
// involved: the parent re-projects and this prop changes identity.
watch(
  () => props.table,
  () => {
    page.value = 0
    if (scroller.value) scroller.value.scrollTop = 0
    update()
  },
)

// Confirming a type mints a new entry but not a new *table* — the values did not
// change, only what they are read as — so the watcher above cannot see it and
// the marks would appear only after the next scroll. This one repaints in place:
// no page reset and no scroll reset, because nothing about which rows the user is
// looking at has moved.
watch(
  () => props.marks,
  () => update(),
)
</script>

<template>
  <div>
    <p
      v-if="props.table.columns.length === 0"
      data-testid="preview-empty"
      class="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500"
    >
      Nichts anzuzeigen — diese Quelle hat keine Spalten.
    </p>

    <template v-else>
      <!-- The sticky header plus ten whole rows, so the viewport never cuts a
           row in half — and, more importantly, stays far under the 50-row
           window. Sized from ROW_HEIGHT_PX so there is one place a row height
           is written down. -->
      <div
        ref="scroller"
        data-testid="preview"
        role="region"
        :aria-label="props.label"
        tabindex="0"
        class="overflow-auto rounded border border-slate-200"
        :style="{ maxHeight: (VIEWPORT_ROWS + 1) * ROW_HEIGHT_PX + 'px' }"
        @scroll="update"
      >
        <!-- aria-rowcount counts the header row with the data rows; the DOM
             holds a window of them and says so, rather than reporting its own
             size as the table's. -->
        <table
          class="min-w-full border-collapse text-left text-xs"
          :style="{ lineHeight: ROW_HEIGHT_PX + 'px' }"
          :aria-rowcount="props.table.rowCount + 1"
        >
          <thead>
            <tr aria-rowindex="1">
              <th
                v-for="(col, c) in props.table.columns"
                :key="c"
                scope="col"
                class="sticky top-0 z-10 whitespace-nowrap bg-slate-100 px-2 py-0 font-semibold text-slate-700"
                :style="{ height: ROW_HEIGHT_PX + 'px' }"
              >
                {{ col.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-if="view.topPx > 0"
              aria-hidden="true"
              :style="{ height: view.topPx + 'px' }"
            >
              <td
                :colspan="props.table.columns.length"
                class="p-0"
                :style="{ height: view.topPx + 'px' }"
              />
            </tr>

            <tr
              v-for="(row, i) in view.rows"
              :key="view.firstRow + i"
              data-testid="preview-row"
              :aria-rowindex="view.firstRow + i + 2"
              :class="(view.firstRow + i) % 2 === 1 ? 'bg-slate-50' : ''"
              :style="{ height: ROW_HEIGHT_PX + 'px' }"
            >
              <!-- A marked cell keeps its original text and says why it stands
                   out: amber, a wavy underline, and the reason in `title`.
                   **`title` is a pointer affordance and not much more, and
                   claiming otherwise here would be claiming coverage the
                   attribute does not give.** On a `<td>` it is exposed
                   inconsistently — several common screen-reader configurations
                   announce it not at all — and it is unreachable by keyboard and
                   by touch. So the underline carries the mark for a reader who
                   cannot see the colour, the text itself is unchanged for
                   everyone, and non-visual exposure of the *reason* is deferred
                   work rather than something this attribute quietly provides. -->
              <td
                v-for="(cell, c) in row"
                :key="c"
                :data-testid="view.marked[i]?.[c] ? 'preview-mark' : null"
                class="whitespace-nowrap px-2 py-0"
                :class="
                  view.marked[i]?.[c]
                    ? 'bg-amber-100 text-amber-900 underline decoration-amber-500 decoration-wavy'
                    : 'text-slate-700'
                "
                :title="view.marked[i]?.[c] ? props.markTitle : null"
                :style="{ height: ROW_HEIGHT_PX + 'px' }"
              >
                {{ cell }}
              </td>
            </tr>

            <tr
              v-if="view.bottomPx > 0"
              aria-hidden="true"
              :style="{ height: view.bottomPx + 'px' }"
            >
              <td
                :colspan="props.table.columns.length"
                class="p-0"
                :style="{ height: view.bottomPx + 'px' }"
              />
            </tr>
          </tbody>
        </table>
      </div>

      <p
        v-if="props.table.rowCount === 0"
        data-testid="preview-no-rows"
        class="mt-1 text-xs text-slate-500"
      >
        Keine Datenzeilen — nur die Kopfzeile.
      </p>

      <!-- Hidden for every table below the clamp, which is every table this
           product will realistically meet; past it the view pages instead of
           scrolling, because Firefox collapses an oversized spacer to zero. -->
      <div
        v-if="view.pages > 1"
        data-testid="preview-pages"
        class="mt-2 flex items-center gap-2 text-xs text-slate-600"
      >
        <button
          type="button"
          :disabled="view.page === 0"
          class="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
          @click="goToPage(view.page - 1)"
        >
          Zurück
        </button>
        <span>Seite {{ nf(view.page + 1) }} von {{ nf(view.pages) }}</span>
        <button
          type="button"
          :disabled="view.page + 1 >= view.pages"
          class="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
          @click="goToPage(view.page + 1)"
        >
          Weiter
        </button>
        <span class="text-slate-400">
          {{ rowsLabel(pageRowCount(view.page, props.table.rowCount)) }} auf dieser Seite
        </span>
      </div>
    </template>
  </div>
</template>
