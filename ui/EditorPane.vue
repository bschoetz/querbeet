<script setup>
// The Editor (CAP-11, CAP-12). `ui/` issues named commands and renders
// projections; it never writes to the model (AD-10), and it never names a
// concrete adapter — the canvas arrives as a prop from `app/` (AD-1).
//
// German is rendered here and in `ui/graph-labels.js`, nowhere else (AD-13). The
// canvas below is handed a body per node as a scoped slot precisely so no German
// word has to cross into `adapters/`.

import { computed, shallowRef, watch } from 'vue'
import { CODE } from '@core/graph/graph.js'
import StepCard from '@ui/StepCard.vue'
import { addableKindLabels, graphText, kindLabel, SEVERITY, stepLabel } from '@ui/graph-labels.js'

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

/**
 * A Step's name, resolved against the graph being rendered.
 *
 * A slot may still point at a Step that is gone — that is the whole of CAP-12's
 * "never deleted, never silently re-wired" — and the projection holds only the
 * id for it. The model remembers the name, so the select beside the sentence that
 * just said „…hat „Umsatz Q2“ verloren." says the same word rather than a raw
 * `src:umsatz-q2`. The id is the last resort and is a state nothing should reach.
 */
const nameOf = (id) => byId.value.get(id)?.name ?? props.graph.lostName(id) ?? id

/**
 * What each card calls itself. Two Steps of one kind open with the same name, so
 * the label — which is the card's accessible name and its only handle — is
 * qualified by the id where it would otherwise be shared, exactly as
 * `ui/SourcesPane.vue` qualifies a repeated column name by its position.
 */
const labels = computed(() => {
  const counts = new Map()
  for (const step of projection.value.steps) {
    const label = stepLabel(step.kind, step.name)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return new Map(
    projection.value.steps.map((step) => {
      const label = stepLabel(step.kind, step.name)
      return [step.id, counts.get(label) > 1 ? `${label} (${step.id})` : label]
    }),
  )
})

// From the core's own constant, never from a literal: renaming the code would
// otherwise stop the dimming with nothing failing, which is exactly what building
// `GRAPH_CODES` out of the emit sites was meant to make impossible.
const orphanIds = computed(
  () =>
    new Set(
      projection.value.diagnostics.filter((d) => d.code === CODE.orphan).map((d) => d.values.id),
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
 * The pointer gesture's guard: the store's own `check`, which is `checkConnect`
 * and changes nothing. One rule set, one refusal — a drop the canvas accepts is a
 * drop the command accepts, and a drop it refuses is a Step the keyboard list
 * never offered, because that list is built from the same function.
 *
 * It is asked per handle the pointer passes over, so it must not be the candidate
 * list: `candidates(...).includes(source)` rebuilds every candidate of that slot
 * on every pointer move.
 */
const guard = (source, target, slot) => props.graph.check(source, target, slot).ok

const onConnect = (source, target, slot) => run(props.graph.connect(source, target, slot))

/** A drop the guard turned down. The reason is asked of the guard rather than
 *  obtained by re-issuing the mutation — the separation `checkConnect` exists
 *  for. */
const onRefused = (source, target, slot) => run(props.graph.check(source, target, slot))

/**
 * The refusals a canvas-driven command can produce that describe a race rather
 * than a decision: the canvas reports about nodes and edges it measured a frame
 * ago, so a change addressing something that has since gone is two truthful views
 * disagreeing and not something a user did. Everything else a canvas command
 * refuses — deleting a Source, for one — is a decision and is said out loud.
 */
const RACE_CODES = new Set([CODE.unknownStep, CODE.noSuchSlot, CODE.slotEmpty])
const fromCanvas = (result) =>
  run(result, { quiet: result.diagnostics.every((d) => RACE_CODES.has(d.code)) })

const onMove = (id, x, y) => fromCanvas(props.graph.moveStep(id, x, y))
const onRemove = (id) => fromCanvas(props.graph.removeStep(id))
const onDisconnect = (target, slot) => fromCanvas(props.graph.disconnect(target, slot))

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
        @refused="onRefused"
        @move="onMove"
        @remove="onRemove"
        @disconnect="onDisconnect"
      >
        <template #step="{ node }">
          <StepCard
            v-if="byId.get(node.id)"
            :node="byId.get(node.id)"
            :label="labels.get(node.id)"
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
