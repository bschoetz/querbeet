<script setup>
// The Editor (CAP-11, CAP-12). `ui/` issues named commands and renders
// projections; it never writes to the model (AD-10), and it never names a
// concrete adapter — the canvas arrives as a prop from `app/` (AD-1).
//
// German is rendered here and in `ui/graph-labels.js`, nowhere else (AD-13). The
// canvas below is handed a body per node as a scoped slot precisely so no German
// word has to cross into `adapters/`.

import { computed, shallowRef, watch } from 'vue'
import StepCard from '@ui/StepCard.vue'
import { addableKindLabels, graphText, kindLabel, SEVERITY } from '@ui/graph-labels.js'

const props = defineProps({
  /** The graph store's command surface (`createGraphStore`). */
  graph: { type: Object, required: true },
  /** `[{ id, name }]` — the Sources as the Source store holds them. */
  sources: { type: Array, default: () => [] },
  /** The `GraphView` implementation, named by `app/` and passed down. */
  canvas: { type: [Object, Function], required: true },
})

// shallowRef and an explicit refresh, the shape `ui/SourcesPane.vue` set: the
// store hands out a frozen snapshot per commit, and re-reading it after every
// command is what keeps the pane from becoming a second owner of graph state.
const projection = shallowRef(read())
const refusal = shallowRef([])

function read() {
  return {
    steps: props.graph.list(),
    edges: props.graph.edges(),
    resultId: props.graph.resultId(),
    diagnostics: props.graph.diagnostics(),
  }
}

const refresh = () => {
  projection.value = read()
}

/**
 * Run a command and show what it said.
 *
 * `quiet` is for the commands the canvas issues on its own — a position, a
 * removal, a disconnect. Under design B the canvas reports about nodes it
 * measured a frame ago, so a change for a Step that has just been deleted is a
 * race between two truthful views; putting a sentence on screen about something
 * nobody did would be the wrong half of that trade.
 */
const run = (result, { quiet = false } = {}) => {
  if (!quiet) refusal.value = result.diagnostics
  refresh()
  return result
}

const byId = computed(() => new Map(projection.value.steps.map((s) => [s.id, s])))
const nameOf = (id) => byId.value.get(id)?.name ?? id

const orphanIds = computed(
  () =>
    new Set(
      projection.value.diagnostics.filter((d) => d.code === 'graph.orphan').map((d) => d.values.id),
    ),
)

const marksFor = (id) => projection.value.diagnostics.filter((d) => d.stepId === id)

/** What the graph says about itself rather than about one Step — today that is
 *  the missing Result designation, and nothing else. */
const status = computed(() => projection.value.diagnostics.filter((d) => d.stepId === undefined))

// ------------------------------------------------------------- the canvas

const canvasNodes = computed(() =>
  projection.value.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    x: step.x,
    y: step.y,
    slots: step.inputs.length,
    dimmed: orphanIds.value.has(step.id),
  })),
)

const canvasEdges = computed(() =>
  projection.value.edges.map((edge) => ({
    ...edge,
    dimmed: orphanIds.value.has(edge.target),
  })),
)

/**
 * The pointer gesture's guard, asked of the same list the slot rows are built
 * from. One rule set, one refusal: a drop the canvas accepts is a drop the
 * command accepts, and a drop it refuses is a Step the keyboard list never
 * offered.
 */
const guard = (source, target, slot) => props.graph.candidates(target, slot).includes(source)

const onConnect = (source, target, slot) => run(props.graph.connect(source, target, slot))
const onMove = (id, x, y) => run(props.graph.moveStep(id, x, y), { quiet: true })
const onRemove = (id) => run(props.graph.removeStep(id), { quiet: true })
const onDisconnect = (target, slot) => run(props.graph.disconnect(target, slot), { quiet: true })

// ------------------------------------------------------------- the toolbar

const KINDS = addableKindLabels()

// Where the Step lands is the store's business, derived from the Steps already in
// the graph. A counter held here would restart at zero on every view switch —
// this pane is unmounted when the Sources pane shows — and the next Step would
// land exactly on the first one.
const addStep = (kind) => run(props.graph.addStep(kind, { name: kindLabel(kind) }))

// ------------------------------------------------------------- the Sources

// Reconciled whenever the list changes, not only on mount: a file that finishes
// parsing while the Editor is open would otherwise stay invisible until the pane
// was left and re-entered. One command, one direction (AD-10) — the Source store
// is the truth about which Sources exist and the graph holds their ids and
// positions.
watch(
  () => props.sources,
  (sources) => {
    props.graph.syncSources(sources.map((s) => ({ id: s.id, name: s.name })))
    refresh()
  },
  { immediate: true },
)
</script>

<template>
  <!-- No height of its own: the canvas below is `flex-1`, so the pane needs a
       *definite* height from its host or the flex item resolves to zero and the
       whole Editor renders as a hairline. `ui/App.vue` gives it one. -->
  <section class="flex min-h-0 flex-col">
    <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
      <h2 class="mr-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Pipeline
      </h2>
      <button
        v-for="[code, label] in KINDS"
        :key="code"
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
        @click="addStep(code)"
      >
        + {{ label }}
      </button>
    </div>

    <!-- role="status" so a refused command says so out loud. Without it, pressing
         a button that refuses appears to do nothing at all to a screen reader,
         which is the one case where it does the most. -->
    <div
      role="status"
      data-testid="editor-refusal"
      class="min-h-6 py-2"
    >
      <p
        v-for="(d, i) in refusal"
        :key="i"
        class="text-sm"
        :class="SEVERITY[d.severity].tone"
      >
        <span class="font-semibold">{{ SEVERITY[d.severity].label }}:</span>
        {{ graphText(d, nameOf) }}
      </p>
    </div>

    <p
      v-for="(d, i) in status"
      :key="i"
      data-testid="editor-status"
      class="pb-2 text-sm"
      :class="SEVERITY[d.severity].tone"
    >
      <span class="font-semibold">{{ SEVERITY[d.severity].label }}:</span>
      {{ graphText(d, nameOf) }}
    </p>

    <div class="min-h-0 flex-1 rounded border border-slate-200">
      <component
        :is="canvas"
        :nodes="canvasNodes"
        :edges="canvasEdges"
        :guard="guard"
        @connect="onConnect"
        @refused="onConnect"
        @move="onMove"
        @remove="onRemove"
        @disconnect="onDisconnect"
      >
        <template #step="{ node }">
          <StepCard
            v-if="byId.get(node.id)"
            :node="byId.get(node.id)"
            :result="projection.resultId === node.id"
            :diagnostics="marksFor(node.id)"
            :candidates="graph.candidates"
            :name-of="nameOf"
            @rename="(name) => run(graph.renameStep(node.id, name))"
            @set-result="run(graph.setResult(node.id))"
            @connect="(slot, source) => run(graph.connect(source, node.id, slot))"
            @disconnect="(slot) => run(graph.disconnect(node.id, slot))"
            @add-slot="run(graph.addInputSlot(node.id))"
            @remove-slot="(slot) => run(graph.removeInputSlot(node.id, slot))"
            @remove="run(graph.removeStep(node.id))"
          />
        </template>
      </component>
    </div>
  </section>
</template>
