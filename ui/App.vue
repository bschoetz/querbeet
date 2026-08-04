<script setup>
// The driving adapter. ui/ issues commands and renders projections; it may import
// core/ and ports/, never adapters/ (AD-1). A browser File, DragEvent or
// ClipboardEvent never reaches core/ — ui/ unwraps it and issues a command
// carrying bytes and a name (AD-3).
//
// German is rendered here and only here. core/ emits codes and structured values;
// this layer turns them into the sentences a user reads (AD-13, C-6).
//
// **The view switch is deliberate, and the two panes are switched differently on
// purpose.** The Editor is `v-if`, so it is genuinely unmounted while the Sources
// pane shows: CAP-11's "leaving and re-entering loses no Step configuration" is
// only proven if there is nothing left in memory to lose it from, and a `v-show`
// would pass that test without proving anything. The Sources pane is `v-show`,
// because its load errors and its typing refusals are its own state and are not
// held anywhere else — trading one kind of lost state for another would be no
// improvement.

import { shallowRef } from 'vue'
import { createRunCache } from '@core/exec/cache.js'
import { createStepZeroCache } from '@core/exec/convert.js'
import SourcesPane from '@ui/SourcesPane.vue'
import EditorPane from '@ui/EditorPane.vue'

const props = defineProps({
  buildVersion: { type: String, required: true },
  store: { type: Object, required: true },
  graph: { type: Object, required: true },
  /** The `TableEngine` implementation, passed through to the pane that needs it.
   *  `app/` is the only place that names one (AD-1); this layer only forwards. */
  engine: { type: Object, required: true },
  /** The `GraphView` implementation. `app/` is the only place that names one. */
  canvas: { type: [Object, Function], required: true },
})

// Step zero's cache, **one of them**, created here and handed to both panes
// (decided 2026-08-04 with the project owner, measured first).
//
// Two caches would be the cheapest edit and the most expensive result: the same
// Source converted twice at 545–555 ms and retained twice at 39.3 MB, which puts
// five Sources at ~532 MB against a 550 MB plan — and two answers to "is this
// Source converted", which is duplicate bookkeeping rather than a cache. A module
// singleton would avoid the prop and cost more: `createStepZeroCache` takes the
// engine, so a singleton needs a mutable slot for it and AD-1's "one place names
// the adapter" gets a second home no test could reset per case. `App.vue` already
// receives the engine.
//
// In `setup`, never in a `ref`: it holds converted Tables, and a table must never
// enter deep reactivity (AD-6). Release stays what it was — a Source's removal
// releases its conversion, which the Sources pane still asks for.
const stepZero = createStepZeroCache(props.engine)

// AD-8's per-Step cache, and it is created **here** for the same two reasons the
// line above it is. It must outlive the Editor: `EditorPane` is `v-if`, so it is
// genuinely unmounted on every trip to the Sources pane, and a cache owned there
// would be thrown away by a view switch — which is exactly the moment a user
// comes back to a graph they have not changed. And it holds `Table` handles, so
// it may not enter `ref`, `reactive` or a `computed` (AD-6); `setup` is where a
// value can be held without becoming reactive.
//
// The bounds are the defaults (`core/exec/cache.js` says where each number comes
// from). They are not props and not configurable: a memory plan the interface
// can dial is a memory plan nobody can reason about.
//
// It goes to **both** panes, and the second one is not a symmetry. `EditorPane`
// reads and writes it; `SourcesPane` only ever clears it, because removing a
// Source or unconfirming its typing has to withdraw the tables computed from it
// (AD-29) and a content-keyed store has no id to release by.
const runCache = createRunCache()

const view = shallowRef('sources')

// The Editor reconciles its Source nodes from this list, so it has to change when
// the Source store does — including while the Editor is the pane on screen, which
// is what a file still parsing when the user switches over does.
const sources = shallowRef(props.store.list())
const onSourcesChanged = () => {
  sources.value = props.store.list()
}

const TABS = [
  ['sources', 'Quellen'],
  ['editor', 'Editor'],
]
</script>

<template>
  <main class="p-8 font-sans text-slate-800">
    <h1 class="text-2xl font-semibold">
      querbeet
    </h1>
    <p class="mt-1 text-sm text-slate-500">
      Berichte rein, konsolidierte Tabelle raus. —
      <span data-testid="build-version">Build {{ props.buildVersion }}</span>
    </p>

    <nav
      class="mt-6 flex gap-2"
      aria-label="Ansicht"
    >
      <button
        v-for="[id, label] in TABS"
        :key="id"
        type="button"
        :aria-pressed="view === id"
        class="rounded border px-3 py-1 text-sm"
        :class="view === id ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'"
        @click="view = id"
      >
        {{ label }}
      </button>
    </nav>

    <SourcesPane
      v-show="view === 'sources'"
      :store="props.store"
      :on-changed="onSourcesChanged"
      :step-zero="stepZero"
      :run-cache="runCache"
      class="mt-8"
    />

    <EditorPane
      v-if="view === 'editor'"
      :graph="props.graph"
      :sources="sources"
      :canvas="props.canvas"
      :engine="props.engine"
      :step-zero="stepZero"
      :cache="runCache"
      class="mt-8"
    />
  </main>
</template>
