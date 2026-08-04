<script setup>
// The Editor (CAP-11, CAP-12). `ui/` issues named commands and renders
// projections; it never writes to the model (AD-10), and it never names a
// concrete adapter — the canvas arrives as a prop from `app/` (AD-1).
//
// German is rendered here and in `ui/graph-labels.js`, nowhere else (AD-13). The
// canvas below is handed a body per node as a scoped slot precisely so no German
// word has to cross into `adapters/`.

import { computed, nextTick, shallowRef, watch } from 'vue'
import { stepZeroKey } from '@core/exec/convert.js'
import { executeGraph } from '@core/exec/execute.js'
import { CODE } from '@core/graph/graph.js'
import StepCard from '@ui/StepCard.vue'
import StepPanel from '@ui/StepPanel.vue'
import { addableKindLabels, graphText, kindLabel, SEVERITY, stepLabel } from '@ui/graph-labels.js'

const props = defineProps({
  /** The graph store's command surface (`createGraphStore`). */
  graph: { type: Object, required: true },
  /** The Sources as the Source store holds them — whole entries, because the
   *  Editor needs both their names (to reconcile the nodes) and their typing (to
   *  ask Step zero for a converted Table). */
  sources: { type: Array, default: () => [] },
  /** The `GraphView` implementation, named by `app/` and passed down. */
  canvas: { type: [Object, Function], required: true },
  /** The `TableEngine` implementation. `app/` is the only place that names one
   *  (AD-1); this pane hands it to the executor and never calls it directly. */
  engine: { type: Object, required: true },
  /** Step zero's cache, created in `ui/App.vue` and shared with the Sources pane
   *  (decided 2026-08-04) — one converted Table per Source, whoever reads it. */
  stepZero: { type: Object, required: true },
  /** AD-8's per-Step cache, also `ui/App.vue`'s, so it survives this pane being
   *  unmounted by a view switch. Optional and defaulting to nothing: without it
   *  every Step computes exactly as it did before story 7a, which is what lets a
   *  test that is about something else say nothing about caching. */
  cache: { type: Object, default: null },
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

/**
 * A command that can change what the Pipeline computes, followed by a recompute.
 *
 * **The interim rule, stated where it is enforced.** Until story 7's scheduler
 * brings AD-29's mode gate and its row threshold, execution recomputes after
 * every data-affecting change and after nothing else: `connect`, `disconnect`,
 * `configureStep`, `removeStep`, `setResult` and `syncSources`. A rename and a
 * move are deliberately absent — they cost 263–446 ms of recomputation at the
 * design scale and change no number on screen. `addInputSlot` and
 * `removeInputSlot` are absent too, and that is not an omission: a slot may only
 * be removed while it is empty, so neither changes which tables reach a Step.
 *
 * **The rule is unchanged by story 7a and that is deliberate.** The cache made
 * `recompute()` cheap where nothing changed; it did not make it free, and which
 * commands are worth running it after is a question about the *command*, not
 * about the cache. A rename still recomputes nothing because a rename changes no
 * number on screen — the cache would now answer every Step of that run from a
 * hit, but the walk, the gates and the projection swap are still work with no
 * result. Cancellation and the mode switch are still 7b's and 7c's.
 */
const runData = (result, options) => {
  const outcome = run(result, options)
  recompute()
  return outcome
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

// ------------------------------------------------------------- execution
//
// AD-6: the run holds `Table` handles, so it lives in a `shallowRef` swapped
// wholesale and never in a `ref`, a `reactive` or a `computed` return value.
// `executeGraph` is pure and synchronous — it takes the frozen projection, the
// engine and a way to ask Step zero for a Source, and it returns one frozen
// value.
const execution = shallowRef({ ok: true, results: new Map(), diagnostics: [] })

const sourceEntries = computed(() => new Map(props.sources.map((s) => [s.id, s])))

/**
 * Step zero's output for a Source node, or `null` while its typing is not
 * confirmed — which is the only thing `null` means here as of this story, and is
 * what lets gate 1 name the Source truthfully.
 *
 * The cache is `ui/App.vue`'s and is shared with the Sources pane, so a Source
 * the user just confirmed and looked at is not converted a second time for the
 * Editor. It is read through a plain function rather than a computed: the value
 * is a `Table`.
 */
const sourceTable = (id) => props.stepZero.of(sourceEntries.value.get(id))?.table ?? null

/**
 * What that Source's Step zero *is*, as a cache key — the base case every Step
 * key downstream is built out of (AD-8).
 *
 * Derived in `core/`, not here: `stepZeroKey` is the same function the Step-zero
 * cache keys itself with, so the two cannot part company about when a Source has
 * gone stale. This pane only knows which entry a node id names.
 *
 * `null` for a Source the store never digested — a hand-built fixture, nothing
 * the product produces — and `null` means the run simply does not cache that
 * branch. A miss, never a wrong answer.
 */
const keyOfSource = (id) => stepZeroKey(sourceEntries.value.get(id))

function recompute() {
  execution.value = executeGraph({
    steps: projection.value.steps,
    resultId: projection.value.resultId,
    engine: props.engine,
    sourceTable,
    cache: props.cache,
    sourceKey: keyOfSource,
  })
}

/** What the *run* said about a Step, as opposed to what the graph did. */
const resultFor = (id) => execution.value.results.get(id) ?? null

/**
 * The marks on a Step's **card**, and they are the graph's alone.
 *
 * A run's diagnostics are deliberately not here, and the reason is measured
 * rather than aesthetic: they are full sentences — „7 Zeilen entfernt, 3 Zeilen
 * übrig", „1 Zeile wurde nicht verglichen, weil …" — and a 256 px card wearing
 * two of them grows past 280 px, which is taller than any placement pitch the
 * model can pick without asking the DOM (AD-2 forbids that outright). Cards then
 * overlap and the upper one swallows the pointer aimed at the lower one's
 * controls, which was measured on 2026-08-04 and is how this was found.
 *
 * So the split follows what each surface is for: the canvas marks what is wrong
 * with the *graph* — a lost input, a Step contributing to nothing, one upstream
 * consumed twice — and the panel carries what the *run* said about the selected
 * Step, beside its counts and its preview, which is where CAP-19 puts it.
 */
const marksFor = (id) => projection.value.diagnostics.filter((d) => d.stepId === id)

/**
 * What the graph and the run say about themselves rather than about one Step.
 *
 * A refused run is here rather than on a card even though its diagnostics name a
 * Step: a gate refusal is about **the whole run**, and putting it only on the
 * card of the Source that caused it would let a user with the Editor scrolled
 * elsewhere see a pipeline that computed nothing and no reason anywhere.
 *
 * **A run that was not refused can still produce nothing, and that needs saying
 * here too.** A Step error — a condition naming a column its input lost, a
 * comparison the engine could not evaluate — leaves `ok: true` and is reported in
 * that Step's own panel, which is where CAP-19 puts it. With the run's marks
 * deliberately off the cards, a user with nothing selected would see a pipeline
 * that computed nothing and no reason on screen at all. `exec.run_incomplete`
 * carries no `stepId` for exactly that reason, so it lands here rather than on a
 * card, and it names the first Step that failed.
 */
const status = computed(() => [
  ...projection.value.diagnostics.filter((d) => d.stepId === undefined),
  ...(execution.value.ok
    ? execution.value.diagnostics.filter((d) => d.stepId === undefined)
    : execution.value.diagnostics),
])

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

const onConnect = (source, target, slot) => runData(props.graph.connect(source, target, slot))

// ------------------------------------------------------------- the selection
//
// The canvas owns the selection *state* and hands back the id; this pane mirrors
// the id and nothing else (`ports/index.js`). It is a `shallowRef` holding a
// string, which is not a table — the AD-6 rule is about data, and a Step id is
// the opposite of data.
const selectedId = shallowRef(null)

const onSelect = (id) => {
  selectedId.value = id
  if (id !== null) bringPanelIntoView()
}

/**
 * The panel's element, so the pane can scroll it into view — the one thing this
 * component does to the *page* rather than to the model.
 */
const panelEl = shallowRef(null)

/**
 * **Why the panel is scrolled to rather than fitted in, and it was measured
 * rather than argued (2026-08-04, after the first hand test).**
 *
 * The panel sits below a canvas of fixed height, so selecting a Step opened a
 * form outside the viewport that the user had to go looking for. Two layouts that
 * would have kept it on screen were built and run against the e2e suite, and both
 * failed for the same underlying reason — the canvas is a window of fixed height
 * onto a graph that is usually larger, so anything taking vertical space takes
 * *clickable graph* with it:
 *
 *  - Floating the panel over the canvas's lower edge: 13 cases failed with the
 *    panel's own subtree intercepting the pointer aimed at a Step beneath it. A
 *    user hits it the same way — select one Step, then try to click the next.
 *  - Shrinking the canvas to 34vh while a Step is selected: 3 cases failed, and
 *    both failure classes are real rather than test geometry — an edge cannot be
 *    dragged to a Step that is no longer visible, and a control on a card lying
 *    across the fold is intercepted by the panel below it.
 *
 * Scrolling costs no canvas at all. `block: 'nearest'` is the load-bearing part:
 * it scrolls the least that makes the panel visible, so the lower band of the
 * canvas — with the Step that was just selected in it — stays on screen above the
 * panel instead of the page jumping past the graph entirely.
 */
const bringPanelIntoView = () => {
  // After the panel has been rendered for the new selection, and only where a DOM
  // is present: `ui/EditorPane.test.js` mounts this pane without a layout engine.
  nextTick(() => {
    panelEl.value?.$el?.scrollIntoView?.({ block: 'nearest' })
  })
}

/** The selected Step, or `null`. Resolved against the projection on every read
 *  rather than held: a Step that is removed while selected must stop being the
 *  panel's subject even in the frame before the canvas reports the change. */
const selectedStep = computed(() =>
  selectedId.value === null ? null : (byId.value.get(selectedId.value) ?? null),
)

/**
 * The schema of the selected Step's input, or `null`.
 *
 * The panel's column controls are built from it, and `null` is what it says when
 * there is nothing truthful to build them from — an empty slot, an upstream that
 * produced no table, a run the gates refused. Offering a stale column list would
 * invite a config the next run refuses by name.
 *
 * The **first** slot, because both configurable kinds take exactly one input
 * (`core/graph/kinds.js`). Stories 8 and 9 own what a two-input config asks of
 * this.
 */
const inputSchema = computed(() => {
  const step = selectedStep.value
  if (!step || step.kind === 'source') return null
  const upstream = step.inputs[0]
  const produced = upstream ? execution.value.results.get(upstream) : null
  return produced?.table ? produced.table.schema() : null
})

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

// A move changes no number on screen, so it is the one canvas command that does
// not recompute. The other two do.
const onMove = (id, x, y) => fromCanvas(props.graph.moveStep(id, x, y))

const fromCanvasData = (result) => {
  const outcome = fromCanvas(result)
  recompute()
  return outcome
}

const onRemove = (id) => fromCanvasData(props.graph.removeStep(id))
const onDisconnect = (target, slot) => fromCanvasData(props.graph.disconnect(target, slot))

// ------------------------------------------------------------- the toolbar

const KINDS = addableKindLabels()

// Where the Step lands is the store's business, derived from the Steps already in
// the graph. A counter held here would restart at zero on every view switch —
// this pane is unmounted when the Sources pane shows — and the next Step would
// land exactly on the first one.
// `runData` rather than `run`, and it is the one addition to the interim list:
// `addNode` designates the *first* Step that could be a Result as one, so adding
// a Step can change which Pipeline exists — which is the same change `setResult`
// makes and is on the list for the same reason. An added Step is unconnected, so
// the frontier is otherwise unchanged and the recompute is a no-op.
const addStep = (kind) => runData(props.graph.addStep(kind, { name: kindLabel(kind) }))

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
    // `syncSources` is data-affecting twice over: a Source may have appeared or
    // vanished, and — because this list is re-projected whenever the Source store
    // commits — a typing may just have been confirmed, which is what opens gate 1.
    recompute()
  },
  { immediate: true },
)
</script>

<template>
  <!-- The canvas carries its own definite height (see below), so this pane no
       longer needs one from its host — and it must not have one, or the panel
       under the canvas would be clipped instead of growing the page. -->
  <section class="flex flex-col">
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

    <!-- **A fixed height, and it is load-bearing rather than tidy.** What the
         graph and the run say about themselves varies from nothing to several
         sentences, and this region sits directly above the canvas: measured on
         2026-08-04, letting it grow shrank the canvas from 405 px to 237 px over
         three commands, which moved every Step on screen and pushed the ones the
         user was looking at outside the pane. A canvas that resizes because a
         sentence appeared is a canvas the user cannot aim at. So the space is
         reserved once and the region scrolls inside it. -->
    <div class="h-20 shrink-0 overflow-auto py-2">
      <!-- role="status" so a refused command says so out loud. Without it,
           pressing a button that refuses appears to do nothing at all to a screen
           reader, which is the one case where it does the most. -->
      <div
        role="status"
        data-testid="editor-refusal"
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
        class="text-sm"
        :class="SEVERITY[d.severity].tone"
      >
        <span class="font-semibold">{{ SEVERITY[d.severity].label }}:</span>
        {{ graphText(d, nameOf) }}
      </p>
    </div>

    <!-- **The panel is outside the node body, and it is under the canvas rather
         than beside it — the second half decided by measurement.**

         Outside the body is the rule: never a Handle inside a fixed-height
         scrolling container, because the ResizeObserver that keeps the input
         anchors aligned watches the node element's box and not its contents, so
         the edges would drift away from the anchors drawn to them
         (`adapters/vueflow/StepFrame.vue`).

         Beside the canvas was the first attempt and it was measured on
         2026-08-04: a 384 px column leaves ~396 px of canvas at this page width,
         which is narrower than one column of Steps (a 256 px card plus a 320 px
         column pitch), so every Step added after the fit panned the ones already
         on screen out of the pane. Under the canvas the pane keeps its full width
         and the page grows instead — the Editor already scrolls, and a viewport
         the user can aim at is worth more than a panel they never have to scroll
         to. -->
    <div class="flex min-h-0 flex-col gap-3">
      <div class="h-[62vh] min-h-0 rounded border border-slate-200">
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
          @select="onSelect"
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
              @set-result="runData(graph.setResult(node.id))"
              @connect="(slot, source) => runData(graph.connect(source, node.id, slot))"
              @disconnect="(slot) => runData(graph.disconnect(node.id, slot))"
              @add-slot="run(graph.addInputSlot(node.id))"
              @remove-slot="(slot) => run(graph.removeInputSlot(node.id, slot))"
              @remove="runData(graph.removeStep(node.id))"
            />
          </template>
        </component>
      </div>

      <!-- One Step's body and one Step's output. It appears with a selection and
           disappears without one: a panel about nothing is a paragraph, not a
           form. Both states occupy the page below the canvas, so the canvas's own
           geometry never changes with the selection. -->
      <StepPanel
        v-if="selectedStep"
        ref="panelEl"
        :key="selectedStep.id"
        :step="selectedStep"
        :label="labels.get(selectedStep.id) ?? selectedStep.name"
        :input-schema="inputSchema"
        :result="resultFor(selectedStep.id)"
        :name-of="nameOf"
        @configure="(config) => runData(graph.configureStep(selectedStep.id, config))"
      />
      <p
        v-else
        data-testid="step-panel-empty"
        class="rounded border border-dashed border-slate-200 p-3 text-sm text-slate-500"
      >
        Einen Step auswählen, um Einstellungen und Vorschau zu sehen.
      </p>
    </div>
  </section>
</template>
