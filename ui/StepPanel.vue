<script setup>
// One Step's body: what it is configured to do (CAP-15, CAP-16) and what it
// produced (CAP-19). German is rendered here and in `ui/graph-labels.js`, nowhere
// else (AD-13), and every change leaves as one event the pane turns into the
// `configureStep` command (AD-10) — this component writes to nothing.
//
// **It is a side panel and not a card body, and the reason is measured.**
// `adapters/vueflow/StepFrame.vue` states the rule the Editor spike left behind:
// never place a Handle inside a fixed-height scrolling container, because the
// ResizeObserver that keeps the input anchors correct watches the node element's
// box and not its contents. A config form and a fifty-row grid inside the node
// body is exactly that container, so the anchors would drift away from the edges
// drawn to them. The panel therefore lives beside the canvas and takes its
// subject from the canvas's selection.
//
// **Every control is a select, a checkbox or a typed input.** AD-30 forbids a
// formula, expression, query or script surface anywhere in the MVP, and CAP-15's
// canonical form is the other half of the same rule: what the user types is
// locale-aware — `1.234,56`, a date picker — and what is *stored* is machine form
// (`1234.56`, `2025-12-31`). The two are converted here, at the one place that
// knows a locale, and never in `core/`.
//
// AD-6 shapes what this file holds. The preview cells are a row array, so they
// live in a `shallowRef` written imperatively and never in a `computed` — the
// same discipline `ui/RowWindow.vue` follows one level down.

import { computed, shallowRef, watch } from 'vue'
import { runStatus } from '@core/diagnostics/diagnostic.js'
import { hasExecutor, stepKind } from '@core/steps/index.js'
import { COLUMNS, FILTER, SOURCE } from '@core/graph/kinds.js'
import { WINDOW_SIZE, previewColumns } from '@core/view/row-window.js'
import RowWindow from '@ui/RowWindow.vue'
import { cellText, germanNumber } from '@ui/cell-text.js'
import {
  SEVERITY,
  combineLabels,
  graphText,
  kindLabel,
  operatorLabels,
  takesValue,
} from '@ui/graph-labels.js'
import { typeLabel } from '@ui/type-labels.js'

const props = defineProps({
  /** The selected Step, as the graph store's frozen projection holds it. */
  step: { type: Object, required: true },
  /** The card's accessible name, from the pane — only the pane can see whether
   *  two Steps would otherwise share one. */
  label: { type: String, required: true },
  /** `[{ name, type }]` for this Step's input, or `null` where there is no input
   *  table to read one off — an empty slot, an upstream that produced nothing, a
   *  run the gates refused. The controls that name a column are absent then,
   *  rather than offering a list built from a stale guess. */
  inputSchema: { type: Array, default: null },
  /** `{ table, rowCount, columnCount, diagnostics }` for this Step, or `null`
   *  where the run did not reach it. */
  result: { type: Object, default: null },
  /** `(id) => string` — a name resolved against the graph being rendered. */
  nameOf: { type: Function, required: true },
})

const emit = defineEmits(['configure'])

const nf = (n) => Number(n).toLocaleString('de-DE')
const rowsLabel = (n) => (n === 1 ? '1 Zeile' : `${nf(n)} Zeilen`)
const colsLabel = (n) => (n === 1 ? '1 Spalte' : `${nf(n)} Spalten`)

const configurable = computed(() => hasExecutor(props.step.kind))
const columnNames = computed(() => (props.inputSchema ?? []).map((c) => c.name))
const typeOfColumn = (name) => props.inputSchema?.find((c) => c.name === name)?.type ?? 'text'

// ------------------------------------------------------------- the draft
//
// The panel edits a draft and emits it whole; the model is still the one writer,
// and a refused command leaves the previous config in force while the draft goes
// on showing what the user typed. That combination is deliberate: CAP-16's rename
// collision has to be *correctable*, and a draft snapped back to the last
// accepted config would delete the word the refusal is about.
//
// The draft is re-read when the selected Step changes, and when the stored config
// changes identity — which a refusal never does, so a refusal cannot clobber it.

const draft = shallowRef(null)

/**
 * The one refusal this component owns rather than the model: a number field whose
 * text is not a number at all. It is held per condition so the field can say so
 * beside itself, and it never reaches the store — an unreadable entry is not a
 * config change, it is an entry that has not finished.
 *
 * Declared here rather than beside the Filter controls because the draft watcher
 * below clears it, and that watcher is `immediate`.
 */
const numberRefusals = shallowRef({})

const readDraft = () => {
  const kind = stepKind(props.step.kind)
  if (!kind) return null
  const config = props.step.config ?? kind.defaultConfig()
  if (props.step.kind === FILTER) {
    return {
      combine: config.combine ?? 'all',
      conditions: (config.conditions ?? []).map((c) => ({ ...c })),
    }
  }
  // Columns: one row per *input* column, so unchecking and rechecking is
  // symmetrical and the order controls have something to move. An empty stored
  // config means "every column, unchanged", which is what a freshly added Step
  // carries — see `core/steps/columns.js`.
  const chosen = config.columns ?? []
  const listed = chosen.map((entry) => ({
    from: entry.from,
    to: entry.to ?? entry.from,
    selected: true,
  }))
  const seen = new Set(listed.map((entry) => entry.from))
  const rest = columnNames.value
    .filter((name) => !seen.has(name))
    .map((name) => ({ from: name, to: name, selected: chosen.length === 0 }))
  return { entries: [...listed, ...rest] }
}

/**
 * What the draft is rebuilt for, and what it is deliberately **not** rebuilt for.
 *
 * The subject changing (another Step selected) and the input's columns changing
 * are the two events a draft cannot survive. A change to the *stored* config is
 * not one of them, and that is the point: after a refusal the stored config is
 * unchanged while the draft holds the word the refusal is about, and after an
 * accepted change the stored config *is* the draft, so rebuilding from it would
 * only shuffle the Columns list — an unchecked column would jump to the bottom,
 * because a stored config lists the chosen columns and nothing else.
 *
 * The schema is compared by content rather than by identity: the pane derives it
 * on every projection, so a rename two Steps away would otherwise reset a form
 * somebody is typing in.
 */
const schemaKey = computed(() =>
  (props.inputSchema ?? []).map((column) => `${column.name}:${column.type}`).join('|'),
)

watch(
  [() => props.step.id, schemaKey],
  () => {
    draft.value = readDraft()
    numberRefusals.value = {}
  },
  { immediate: true },
)

/** The config the current draft means, in canonical machine form. */
function configOf(state) {
  if (props.step.kind === FILTER) {
    return {
      combine: state.combine,
      conditions: state.conditions.map((c) =>
        takesValue(c.op) ? { column: c.column, op: c.op, value: c.value } : { column: c.column, op: c.op },
      ),
    }
  }
  return {
    columns: state.entries
      .filter((entry) => entry.selected)
      .map((entry) => ({ from: entry.from, to: entry.to })),
  }
}

/** Replace the draft and issue the command. One function, so no control can
 *  change the draft without the model hearing about it. */
function commit(next) {
  draft.value = next
  emit('configure', configOf(next))
}

// ------------------------------------------------------------- the Filter
//
// The value control follows the *column's* type, which is what keeps the stored
// value canonical without asking the user to write one. A date picker hands back
// `2025-12-31`; a German number field hands back `1234.56`; a boolean is two
// words in a select. None of them is a text field someone could put a formula in.

/** How a stored value is written back into its control. The number field is the
 *  only one that differs from the machine form, and it differs on purpose. */
const fieldValue = (condition) => {
  if (condition.value === undefined || condition.value === null) return ''
  return typeOfColumn(condition.column) === 'number'
    ? cellText(condition.value, 'number')
    : String(condition.value)
}

/** Which HTML control a column's type gets. `date`, `datetime-local` and `time`
 *  are locale-aware in the browser and hand back ISO 8601 — the canonical form
 *  the config stores — which is why they are used rather than a text field with
 *  a placeholder. */
const fieldKind = (condition) => {
  const type = typeOfColumn(condition.column)
  if (type === 'date') return 'date'
  if (type === 'datetime') return 'datetime-local'
  if (type === 'time') return 'time'
  if (type === 'boolean') return 'boolean'
  return 'text'
}

/** The neutral value for a column's type, used when a condition is added or its
 *  column changes — a value left over from the previous column would be a type
 *  disagreement the user never made. */
const emptyValue = (column) => {
  const type = typeOfColumn(column)
  if (type === 'number') return 0
  if (type === 'boolean') return true
  return ''
}

const withConditions = (conditions) => ({ ...draft.value, conditions })

const addCondition = () => {
  const column = columnNames.value[0]
  if (column === undefined) return
  commit(withConditions([...draft.value.conditions, { column, op: 'eq', value: emptyValue(column) }]))
}

const removeCondition = (at) =>
  commit(withConditions(draft.value.conditions.filter((_, i) => i !== at)))

const patchCondition = (at, patch) =>
  commit(withConditions(draft.value.conditions.map((c, i) => (i === at ? { ...c, ...patch } : c))))

const setColumn = (at, column) =>
  patchCondition(at, { column, value: emptyValue(column) })

const setOperator = (at, op) => {
  const condition = draft.value.conditions[at]
  patchCondition(at, {
    op,
    // A valueless operator carries no value at all, and the value returns as the
    // column's neutral one — carrying a stale value under `ist leer` would store
    // a shape `validate` refuses.
    value: takesValue(op) ? (takesValue(condition.op) ? condition.value : emptyValue(condition.column)) : undefined,
  })
}

function setValue(at, raw) {
  const condition = draft.value.conditions[at]
  const type = typeOfColumn(condition.column)
  if (type === 'number') {
    const value = germanNumber(raw)
    if (value === null) {
      numberRefusals.value = { ...numberRefusals.value, [at]: true }
      return
    }
    numberRefusals.value = { ...numberRefusals.value, [at]: false }
    patchCondition(at, { value })
    return
  }
  patchCondition(at, { value: type === 'boolean' ? raw === 'true' : String(raw) })
}

// ------------------------------------------------------------- the Columns

const withEntries = (entries) => ({ ...draft.value, entries })

const selectedCount = computed(
  () => draft.value?.entries?.filter((entry) => entry.selected).length ?? 0,
)

const toggleColumn = (at, selected) =>
  commit(withEntries(draft.value.entries.map((e, i) => (i === at ? { ...e, selected } : e))))

const renameColumn = (at, to) =>
  commit(withEntries(draft.value.entries.map((e, i) => (i === at ? { ...e, to: String(to).trim() } : e))))

/** Move an entry one place, which is what makes config order the output order
 *  without a second `position` field to disagree with it. */
function moveColumn(at, by) {
  const to = at + by
  const entries = [...draft.value.entries]
  if (to < 0 || to >= entries.length) return
  ;[entries[at], entries[to]] = [entries[to], entries[at]]
  commit(withEntries(entries))
}

// ------------------------------------------------------------- the preview
//
// The counts are the Step's **full** output (CAP-19) and are read off the handle
// without materializing anything; the grid below them is a bounded window, built
// from `rows()` so fifty rows of a hundred thousand cost fifty. The two are
// labelled apart so the difference is never something the reader has to infer.

const preview = shallowRef(null)

const status = computed(() => (props.result ? runStatus(props.result.diagnostics) : null))

const marks = computed(() =>
  (props.result?.diagnostics ?? []).map((d) => ({
    key: `${d.code}:${d.severity}`,
    text: graphText(d, props.nameOf),
    ...SEVERITY[d.severity],
  })),
)

watch(
  () => props.result,
  (result) => {
    if (!result?.table) {
      preview.value = null
      return
    }
    const raw = previewColumns(result.table, WINDOW_SIZE)
    preview.value = {
      columns: raw.columns.map((column) => ({
        name: column.name,
        // German is applied here rather than in `core/view`: a projection that
        // produced `31.12.2025` inside the core would be the core talking to the
        // user (AD-13), and story 10 renders the Result table through this same
        // module rather than a second one.
        cells: column.cells.map((value) => cellText(value, column.type)),
      })),
      rowCount: raw.rowCount,
      totalRows: raw.totalRows,
    }
  },
  { immediate: true },
)
</script>

<template>
  <aside
    data-testid="step-panel"
    :aria-label="'Einstellungen und Vorschau: ' + props.label"
    class="flex min-h-0 flex-col gap-3 overflow-auto rounded border border-slate-200 p-3 text-sm"
  >
    <header>
      <p class="text-[10px] uppercase tracking-wide text-slate-500">
        {{ kindLabel(props.step.kind) }}
      </p>
      <h3 class="font-semibold text-slate-800">
        {{ props.step.name }}
      </h3>
    </header>

    <!-- A kind stories 8 and 9 own. It says so rather than rendering an empty
         form, and the sentence names why the run does not happen either. -->
    <p
      v-if="!configurable && props.step.kind !== SOURCE"
      data-testid="step-panel-unconfigurable"
      class="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600"
    >
      Für {{ kindLabel(props.step.kind) }} gibt es noch keine Einstellungen — diese Step-Art kann
      querbeet noch nicht ausführen.
    </p>

    <!-- The controls that name a column need a column list, and the only
         truthful source of one is the input actually in hand. -->
    <p
      v-else-if="configurable && props.inputSchema === null"
      data-testid="step-panel-no-input"
      class="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600"
    >
      Kein Eingang — bitte erst einen Step an diesen anschließen und die Quellen bestätigen.
      Dann stehen hier die Spalten zur Auswahl.
    </p>

    <!-- ------------------------------------------------------ Filter -->
    <div
      v-else-if="props.step.kind === FILTER && draft"
      data-testid="step-config-filter"
      class="flex flex-col gap-2"
    >
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-500">Verknüpfung</span>
        <select
          :value="draft.combine"
          aria-label="Verknüpfung"
          class="rounded border border-slate-200 px-2 py-1"
          @change="commit({ ...draft, combine: $event.target.value })"
        >
          <option
            v-for="[code, text] in combineLabels()"
            :key="code"
            :value="code"
          >
            {{ text }}
          </option>
        </select>
      </label>

      <p
        v-if="draft.conditions.length === 0"
        class="text-xs text-slate-500"
      >
        Keine Bedingung — alle Zeilen bleiben stehen.
      </p>

      <div
        v-for="(condition, at) in draft.conditions"
        :key="at"
        data-testid="filter-condition"
        class="flex flex-wrap items-end gap-2 rounded border border-slate-100 p-2"
      >
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-500">Spalte</span>
          <select
            :value="condition.column"
            :aria-label="'Spalte der Bedingung ' + (at + 1)"
            class="rounded border border-slate-200 px-2 py-1"
            @change="setColumn(at, $event.target.value)"
          >
            <option
              v-for="name in columnNames"
              :key="name"
              :value="name"
            >
              {{ name }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-500">Vergleich</span>
          <select
            :value="condition.op"
            :aria-label="'Vergleich der Bedingung ' + (at + 1)"
            class="rounded border border-slate-200 px-2 py-1"
            @change="setOperator(at, $event.target.value)"
          >
            <option
              v-for="[code, text] in operatorLabels()"
              :key="code"
              :value="code"
            >
              {{ text }}
            </option>
          </select>
        </label>

        <label
          v-if="takesValue(condition.op)"
          class="flex flex-col gap-1"
        >
          <span class="text-xs text-slate-500">
            Wert ({{ typeLabel(typeOfColumn(condition.column)) }})
          </span>
          <select
            v-if="fieldKind(condition) === 'boolean'"
            :value="String(condition.value)"
            :aria-label="'Wert der Bedingung ' + (at + 1)"
            class="rounded border border-slate-200 px-2 py-1"
            @change="setValue(at, $event.target.value)"
          >
            <option value="true">
              wahr
            </option>
            <option value="false">
              falsch
            </option>
          </select>
          <input
            v-else
            :type="fieldKind(condition)"
            :value="fieldValue(condition)"
            :aria-label="'Wert der Bedingung ' + (at + 1)"
            class="rounded border border-slate-200 px-2 py-1"
            @change="setValue(at, $event.target.value)"
          >
        </label>

        <button
          type="button"
          :aria-label="'Bedingung entfernen: ' + (at + 1)"
          class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          @click="removeCondition(at)"
        >
          Entfernen
        </button>

        <!-- role="status" so a rejected entry says so out loud. Without it the
             field simply snaps back and the user is left guessing. -->
        <p
          v-if="numberRefusals[at]"
          role="status"
          data-testid="filter-value-refusal"
          class="w-full text-xs text-amber-700"
        >
          Das ist keine Zahl — bitte in deutscher Schreibweise eingeben, zum Beispiel 1.234,56.
        </p>
      </div>

      <div>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          @click="addCondition"
        >
          Bedingung hinzufügen
        </button>
      </div>
    </div>

    <!-- ----------------------------------------------------- Columns -->
    <div
      v-else-if="props.step.kind === COLUMNS && draft"
      data-testid="step-config-columns"
      class="flex flex-col gap-1"
    >
      <p class="text-xs text-slate-500">
        Reihenfolge hier ist die Reihenfolge im Ergebnis.
      </p>
      <div
        v-for="(entry, at) in draft.entries"
        :key="entry.from"
        data-testid="columns-entry"
        class="flex flex-wrap items-center gap-2 rounded border border-slate-100 p-2"
      >
        <!-- The last selected column cannot be unchecked: an empty selection is
             the identity in `core/steps/columns.js` — every column, unchanged —
             so unchecking the last one would show *more* columns rather than
             none, which is the opposite of what the click means. -->
        <input
          type="checkbox"
          :checked="entry.selected"
          :disabled="entry.selected && selectedCount === 1"
          :aria-label="'Spalte übernehmen: ' + entry.from"
          @change="toggleColumn(at, $event.target.checked)"
        >
        <span class="min-w-24 text-xs text-slate-500">{{ entry.from }}</span>
        <input
          :value="entry.to"
          :disabled="!entry.selected"
          :aria-label="'Neuer Name: ' + entry.from"
          class="w-40 rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-50"
          @change="renameColumn(at, $event.target.value)"
        >
        <button
          type="button"
          :aria-label="'Nach oben: ' + entry.from"
          :disabled="at === 0"
          class="rounded border border-slate-300 px-1.5 text-xs text-slate-600 disabled:opacity-40"
          @click="moveColumn(at, -1)"
        >
          ↑
        </button>
        <button
          type="button"
          :aria-label="'Nach unten: ' + entry.from"
          :disabled="at === draft.entries.length - 1"
          class="rounded border border-slate-300 px-1.5 text-xs text-slate-600 disabled:opacity-40"
          @click="moveColumn(at, 1)"
        >
          ↓
        </button>
      </div>
    </div>

    <!-- ----------------------------------------------------- the result -->

    <p
      v-if="props.result && props.result.rowCount !== null"
      data-testid="step-counts"
      class="text-slate-600"
    >
      {{ rowsLabel(props.result.rowCount) }}, {{ colsLabel(props.result.columnCount) }}
    </p>
    <p
      v-else-if="props.result"
      data-testid="step-counts"
      class="text-slate-600"
    >
      Kein Ergebnis — dieser Step hat nichts geliefert.
    </p>
    <p
      v-else
      data-testid="step-counts"
      class="text-slate-600"
    >
      Nicht gerechnet — dieser Step trägt nicht zum Ergebnis bei oder der Lauf wurde abgelehnt.
    </p>

    <!-- The Step's own warnings, beside its counts (CAP-19). `runStatus` is what
         decides whether the Step ran clean; a caller interpreting the list would
         be a second answer to the same question. -->
    <p
      v-if="status && status.clean"
      data-testid="step-status"
      class="text-xs text-slate-500"
    >
      Ohne Warnungen.
    </p>
    <ul
      v-if="marks.length"
      data-testid="step-marks"
      class="space-y-1"
    >
      <li
        v-for="mark in marks"
        :key="mark.key"
        data-testid="step-panel-mark"
        class="text-xs"
        :class="mark.tone"
      >
        <span class="font-semibold">{{ mark.label }}:</span> {{ mark.text }}
      </li>
    </ul>

    <template v-if="preview">
      <RowWindow
        :table="preview"
        :label="'Vorschau: ' + props.label"
        testid="step-preview"
      />
      <p
        v-if="preview.totalRows > preview.rowCount"
        data-testid="step-preview-bound"
        class="text-xs text-slate-500"
      >
        Vorschau: die ersten {{ nf(preview.rowCount) }} von {{ nf(preview.totalRows) }} Zeilen. Die
        Zahlen oben gelten für das ganze Ergebnis.
      </p>
    </template>
  </aside>
</template>
