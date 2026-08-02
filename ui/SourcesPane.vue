<script setup>
// The Sources pane (CAP-1..3, CAP-39). ui/ unwraps browser File objects and
// issues commands carrying bytes and a name (AD-3) — a File never crosses into
// core/. Every model change below goes through a named store command (AD-10),
// and the list is re-projected after each one.
//
// German is rendered here and only here (AD-13, C-6): the store and the reader
// deliver { severity, code, values }, and every code the pane can receive has a
// sentence in the map below. The fallback is a German sentence too — `?? code`
// would be the core talking to the user.

import { shallowRef } from 'vue'
import { ENCODINGS } from '@core/types/encoding.js'
import RowWindow from '@ui/RowWindow.vue'

const props = defineProps({ store: { type: Object, required: true } })

// shallowRef, never ref/reactive/computed: the entries hold parsed tables, and
// a table must never enter deep reactivity (AD-6).
const sources = shallowRef(props.store.list())
const loadErrors = shallowRef([])

const refresh = () => {
  sources.value = props.store.list()
}

const nf = (n) => n.toLocaleString('de-DE')

// German counts one of a thing differently, and the diagnostic sentences below
// already do it — "Eine Zeile weicht ab" against "3 Zeilen weichen ab". The
// counts line was the one place that said "1 Zeilen" (AD-13).
const rowsLabel = (n) => (n === 1 ? '1 Zeile' : `${nf(n)} Zeilen`)
const colsLabel = (n) => (n === 1 ? '1 Spalte' : `${nf(n)} Spalten`)

const DELIMITERS = [
  { value: ',', label: 'Komma (,)' },
  { value: ';', label: 'Semikolon (;)' },
  { value: '\t', label: 'Tabulator' },
  { value: '|', label: 'Senkrechter Strich (|)' },
]

// Papa can guess a delimiter outside the four common ones (record/unit
// separators, for instance) — the select must show it rather than go blank.
const knownDelimiter = (d) => DELIMITERS.some((x) => x.value === d)
const delimiterLabel = (d) =>
  DELIMITERS.find((x) => x.value === d)?.label ?? `Anderes Zeichen (Code ${d.codePointAt(0)})`

// While the delimiter question is open, the select shows a placeholder instead
// of the comma fallback: re-selecting a value a select already displays fires
// no change event, so a user with a genuine comma file could never answer
// "Komma". The placeholder makes every real choice — comma included — an
// explicit user correction.
const hasDelimiterQuestion = (s) =>
  s.diagnostics.some((d) => d.code === 'csv.delimiter_undetectable')

const GERMAN = {
  'csv.field_count_mismatch': (v) =>
    v.count === 1
      ? `Eine Zeile weicht von der erwarteten Spaltenzahl (${nf(v.expected)}) ab: ` +
        `Zeile ${v.rows.map(nf).join(', Zeile ')}. Sie ist aus der Tabelle ausgeschlossen ` +
        `und unten als Rohtext einsehbar.`
      : `${nf(v.count)} Zeilen weichen von der erwarteten Spaltenzahl (${nf(v.expected)}) ab: ` +
        `Zeile ${v.rows.map(nf).join(', Zeile ')}. Sie sind aus der Tabelle ausgeschlossen ` +
        `und unten als Rohtext einsehbar.`,
  'csv.unclosed_quote': (v) =>
    `Anführungszeichen in Zeile ${nf(v.row)} wird nie geschlossen — der Rest der Datei ` +
    `wurde in dieses Feld eingelesen. Die Zeile ist ausgeschlossen und unten als ` +
    `Rohtext einsehbar.`,
  'csv.malformed_quote': (v) =>
    v.rows.length === 1
      ? `Fehlerhaft gesetzte Anführungszeichen in Zeile ${nf(v.rows[0])} — die Zeile wurde ` +
        `gelesen, ihre Werte sollten geprüft werden.`
      : `Fehlerhaft gesetzte Anführungszeichen in Zeile ${v.rows.map(nf).join(', Zeile ')} — ` +
        `die Zeilen wurden gelesen, ihre Werte sollten geprüft werden.`,
  'csv.delimiter_undetectable': (v) =>
    `Trennzeichen nicht erkennbar — die Datei wurde vorläufig mit ${delimiterLabel(v.fallback)} ` +
    `gelesen. Bitte das Trennzeichen prüfen und wählen.`,
  'csv.empty': () => 'Die Datei ist leer — keine Zeilen, keine Spalten.',
  'encoding.nul_bytes': (v) =>
    `Der gelesene Text enthält ${nf(v.count)} Null-Zeichen — das deutet auf eine falsch ` +
    `erkannte Zeichenkodierung hin (häufig UTF-16 ohne Byte-Reihenfolge-Markierung). ` +
    `Bitte die Kodierung prüfen und gegebenenfalls umstellen.`,
  'source.unsupported_format': (v) =>
    `„${v.fileName}“ hat ein nicht unterstütztes Format — gelesen werden derzeit nur CSV-Dateien.`,
  'source.unreadable': (v) => `„${v.fileName}“ konnte nicht gelesen werden.`,
}

const renderText = (d) => GERMAN[d.code]?.(d.values) ?? 'Unbekannte Meldung aus dem Kern.'

// Every severity gets a German label and its own colour: CAP-34 requires a
// glance-level distinction, and an enum rendered raw is the core talking to
// the user (C-6).
const SEVERITY = {
  info: { label: 'Hinweis', tone: 'text-slate-500' },
  warning: { label: 'Warnung', tone: 'text-amber-600' },
  error: { label: 'Fehler', tone: 'text-red-600' },
  unresolved: { label: 'Ungeklärt', tone: 'text-violet-600' },
}

const ENCODING_LABEL = {
  'utf-8': 'UTF-8',
  'windows-1252': 'Windows-1252',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
}

const ENCODING_SOURCE = {
  bom: 'an der Byte-Reihenfolge-Markierung erkannt',
  probe: 'geprüft: gültiges UTF-8',
  fallback: 'Rückfall auf Windows-1252',
  override: 'von Hand gewählt',
}

async function addFiles(files) {
  const failures = []
  for (const file of files) {
    // AD-3: the File is unwrapped here; the command carries bytes and a name.
    // Per-file try/catch: a File whose backing store is gone (deleted between
    // pick and read, a dropped directory) rejects arrayBuffer(), and the
    // remaining files must still load.
    try {
      const bytes = await file.arrayBuffer()
      const { source, diagnostics } = props.store.addSource({ bytes, fileName: file.name })
      if (!source) {
        for (const d of diagnostics) failures.push({ ...SEVERITY[d.severity], text: renderText(d) })
      }
    } catch {
      failures.push({
        ...SEVERITY.error,
        text: GERMAN['source.unreadable']({ fileName: file.name }),
      })
    }
  }
  // Functional append at the end — no start-of-call snapshot that would
  // clobber a concurrent batch's errors.
  if (failures.length > 0) loadErrors.value = [...loadErrors.value, ...failures]
  refresh()
}

const dismissErrors = () => {
  loadErrors.value = []
}

function onPick(event) {
  addFiles([...event.target.files])
  event.target.value = ''
}

function onDrop(event) {
  addFiles([...(event.dataTransfer?.files ?? [])])
}

const rename = (id, name) => {
  props.store.renameSource(id, name)
  refresh()
}
const remove = (id) => {
  props.store.removeSource(id)
  refresh()
}
const setEncoding = (id, chosen) => {
  props.store.overrideEncoding(id, chosen)
  refresh()
}
const setDelimiter = (id, delimiter) => {
  if (delimiter) props.store.reconfigureParse(id, { delimiter })
  refresh()
}
const setHeaderRow = (id, raw) => {
  const headerRow = Number(raw)
  if (Number.isInteger(headerRow) && headerRow >= 1) {
    props.store.reconfigureParse(id, { headerRow })
  }
  // Refresh in every case: on invalid input the bound value snaps the DOM
  // back to the state the application actually holds.
  refresh()
}
</script>

<template>
  <section>
    <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
      Quellen
    </h2>

    <label
      data-testid="drop-zone"
      class="mt-3 flex max-w-2xl cursor-pointer flex-col gap-2 rounded border-2 border-dashed border-slate-300 p-6 text-sm text-slate-600 hover:border-slate-400"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <span>Dateien hierher ziehen oder per Klick auswählen — gelesen werden CSV-Dateien.</span>
      <input
        type="file"
        multiple
        aria-label="Dateien auswählen"
        class="text-sm"
        @change="onPick"
      >
    </label>

    <div
      v-if="loadErrors.length"
      class="mt-4 max-w-2xl"
    >
      <ul class="space-y-2">
        <li
          v-for="(err, i) in loadErrors"
          :key="i"
          class="flex gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm"
        >
          <span
            class="w-24 shrink-0 font-semibold"
            :class="err.tone"
          >
            {{ err.label }}
          </span>
          <span>{{ err.text }}</span>
        </li>
      </ul>
      <button
        type="button"
        class="mt-2 rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
        @click="dismissErrors"
      >
        Schließen
      </button>
    </div>

    <ul class="mt-4 max-w-2xl space-y-4">
      <li
        v-for="s in sources"
        :key="s.id"
        data-testid="source-card"
        class="rounded border border-slate-200 p-4"
      >
        <div class="flex items-center gap-3">
          <input
            :value="s.name"
            aria-label="Name"
            class="w-full rounded border border-slate-200 px-2 py-1 text-sm font-semibold"
            @change="rename(s.id, $event.target.value)"
          >
          <button
            type="button"
            :aria-label="'Entfernen: ' + s.name"
            class="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
            @click="remove(s.id)"
          >
            Entfernen
          </button>
        </div>

        <!-- The counts are the Source's totals, never the preview window's:
             the grid further down holds ~50 rows whatever this says (AD-24). -->
        <p class="mt-2 text-sm text-slate-500">
          {{ s.fileName }} — {{ rowsLabel(s.table.rowCount) }}, {{ colsLabel(s.table.columns.length) }}
        </p>

        <div class="mt-3 flex flex-wrap items-end gap-4 text-sm">
          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">Zeichenkodierung</span>
            <select
              :value="s.encoding.chosen"
              aria-label="Zeichenkodierung"
              class="rounded border border-slate-200 px-2 py-1"
              @change="setEncoding(s.id, $event.target.value)"
            >
              <option
                v-for="enc in ENCODINGS"
                :key="enc"
                :value="enc"
              >
                {{ ENCODING_LABEL[enc] }}
              </option>
            </select>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">Trennzeichen</span>
            <select
              :value="hasDelimiterQuestion(s) ? '' : s.proposal.delimiter"
              aria-label="Trennzeichen"
              class="rounded border border-slate-200 px-2 py-1"
              @change="setDelimiter(s.id, $event.target.value)"
            >
              <option
                v-if="hasDelimiterQuestion(s)"
                disabled
                value=""
              >
                Bitte wählen …
              </option>
              <option
                v-for="d in DELIMITERS"
                :key="d.value"
                :value="d.value"
              >
                {{ d.label }}
              </option>
              <option
                v-if="!hasDelimiterQuestion(s) && !knownDelimiter(s.proposal.delimiter)"
                :value="s.proposal.delimiter"
              >
                {{ delimiterLabel(s.proposal.delimiter) }}
              </option>
            </select>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs text-slate-500">Kopfzeile</span>
            <input
              type="number"
              min="1"
              :value="s.proposal.headerRow"
              aria-label="Kopfzeile"
              class="w-20 rounded border border-slate-200 px-2 py-1"
              @change="setHeaderRow(s.id, $event.target.value)"
            >
          </label>

          <span class="pb-1 text-xs text-slate-400">{{ ENCODING_SOURCE[s.encoding.source] }}</span>
        </div>

        <ul
          v-if="s.diagnostics.length"
          class="mt-3 space-y-2"
        >
          <li
            v-for="(d, i) in s.diagnostics"
            :key="i"
            class="flex gap-3 rounded border border-slate-200 p-3 text-sm"
          >
            <span
              class="w-24 shrink-0 font-semibold"
              :class="SEVERITY[d.severity].tone"
            >
              {{ SEVERITY[d.severity].label }}
            </span>
            <span>{{ renderText(d) }}</span>
          </li>
        </ul>

        <!-- The preview sits below the correction controls, not above them.
             Everything that explains or corrects the read comes first — the
             knobs, then what went wrong — and the grid is the payoff you look
             at once those are right. Above the knobs it pushed them a screen
             apart on a three-Source pane. The column names are this grid's
             header row now; the chips that used to carry them would have been
             the same names twice. Damaged rows stay out of the table and
             inspectable in the report directly below it (CAP-39). -->
        <RowWindow
          class="mt-3"
          :table="s.table"
          :label="'Vorschau: ' + s.name"
        />

        <details
          v-if="s.damage.mismatches.length"
          class="mt-3 text-sm"
        >
          <summary class="cursor-pointer text-slate-600">
            Ausgeschlossene Zeilen als Rohtext
          </summary>
          <pre
            class="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs"
          ><template
            v-for="m in s.damage.mismatches"
            :key="m.row"
          >Zeile {{ m.row }}: {{ m.raw }}&#10;</template></pre>
        </details>
      </li>
    </ul>
  </section>
</template>
