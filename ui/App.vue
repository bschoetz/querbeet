<script setup>
// The driving adapter. ui/ issues commands and renders projections; it may import
// core/ and ports/, never adapters/ (AD-1). A browser File, DragEvent or
// ClipboardEvent never reaches core/ — ui/ unwraps it and issues a command
// carrying bytes and a name (AD-3).
//
// German is rendered here and only here. core/ emits codes and structured values;
// this layer turns them into the sentences a user reads (AD-13, C-6).

import { computed } from 'vue'
import { runStatus, unresolved, warning } from '@core/diagnostics/diagnostic.js'

const props = defineProps({ buildVersion: { type: String, required: true } })

// A standing scaffold check, not a feature: it demonstrates that the core is
// reachable from the driving adapter, that a diagnostic carries numbers rather
// than a sentence, and that the German text is composed on this side of the line.
const status = runStatus([
  warning('join.row_count_grew', { from: 4200, to: 61000, factor: 14.5 }, { stepId: 's2' }),
  unresolved('types.locale_ambiguous', { column: 'Betrag' }, { sourceId: 'src:umsatz' }),
])

const GERMAN = {
  'join.row_count_grew': (v) =>
    `Doppelte Schlüssel haben Zeilen erzeugt: ${v.from.toLocaleString('de-DE')} → ` +
    `${v.to.toLocaleString('de-DE')} (Faktor ${v.factor.toLocaleString('de-DE')}).`,
  'types.locale_ambiguous': (v) =>
    `Spalte „${v.column}“: nichts in der Spalte entscheidet die Lesart.`,
}

// The severity is core vocabulary too, and it leaked onto the screen in English
// in the first build of this scaffold. C-6 is not "the sentences are German" —
// it is that the interface is German, and an enum rendered raw is still the core
// talking to the user. Every value of the type gets a label and a colour here.
//
// The colours are not decoration either: CAP-34 requires a run with warnings to
// be distinguishable at a glance from a clean one, so `error` must not share a
// colour with `unresolved`. A ternary cannot express four states, which is how
// the first version got that wrong.
const SEVERITY = {
  info: { label: 'Hinweis', tone: 'text-slate-500' },
  warning: { label: 'Warnung', tone: 'text-amber-600' },
  error: { label: 'Fehler', tone: 'text-red-600' },
  unresolved: { label: 'Ungeklärt', tone: 'text-violet-600' },
}

const lines = computed(() =>
  status.diagnostics.map((d) => ({
    ...SEVERITY[d.severity],
    text: GERMAN[d.code]?.(d.values) ?? d.code,
  })),
)
</script>

<template>
  <main class="p-8 font-sans text-slate-800">
    <h1 class="text-2xl font-semibold">
      querbeet
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Berichte rein, konsolidierte Tabelle raus. — Build {{ props.buildVersion }}
    </p>

    <section class="mt-8">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Gerüst steht
      </h2>
      <p class="mt-2 max-w-2xl text-sm">
        Der Kern läuft ohne Framework und ohne Browser. Die folgenden Meldungen stammen aus
        <code class="rounded bg-slate-100 px-1">core/diagnostics</code> als Codes mit Zahlen; der
        deutsche Text entsteht erst hier.
      </p>

      <ul class="mt-4 space-y-2">
        <li
          v-for="(line, i) in lines"
          :key="i"
          class="flex max-w-2xl gap-3 rounded border border-slate-200 p-3 text-sm"
        >
          <span
            class="w-24 shrink-0 font-semibold"
            :class="line.tone"
          >
            {{ line.label }}
          </span>
          <span>{{ line.text }}</span>
        </li>
      </ul>

      <p
        class="mt-4 text-sm"
        :class="status.clean ? 'text-emerald-700' : 'text-amber-700'"
      >
        Lauf-Status: {{ status.clean ? 'sauber' : 'mit Hinweisen' }}
      </p>
    </section>
  </main>
</template>
