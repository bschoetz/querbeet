<script setup>
// One Step, as the user reads and edits it. Every word on screen comes from
// `ui/graph-labels.js` (AD-13), and every change leaves through an event the pane
// turns into a named command (AD-10) — this component writes to nothing.
//
// **The input-slot rows are the keyboard path to connecting**, decided by the
// project owner on 2026-08-03 against handles-as-tab-stops and a connect mode. It
// is the only candidate whose control count is bounded by something a Step
// *declares*: a Join has two inputs for ever and a Filter one, while handles grow
// with the graph on both ends — at the spike's six-Step graph that is 5 controls
// against 11. It also disappears exactly where it should, since a Source has no
// inputs, and it turns connecting into choosing a value in a form, which is the
// affordance C-9 asks of everything else in the MVP.
//
// The refused candidates are **absent** from the list rather than offered and
// then turned down: the guard already knows the answer, and a list that offers a
// cycle only to refuse it is a worse version of the same information.

import { computed, nextTick } from 'vue'
import { kindLabel, graphText, SEVERITY, slotLabel, stepLabel } from '@ui/graph-labels.js'

const props = defineProps({
  /** A frozen Step out of the graph store's projection: ids and a position. */
  node: { type: Object, required: true },
  /** The card's accessible name. The pane supplies it because only the pane can
   *  see whether two Steps would otherwise share one. */
  label: { type: String, default: null },
  result: { type: Boolean, default: false },
  /** The diagnostics `core/graph` attached to this Step. */
  diagnostics: { type: Array, default: () => [] },
  /** `(targetId, slot) => string[]` — the Steps this slot would accept, from the
   *  same guard the pointer drop uses. */
  candidates: { type: Function, required: true },
  /** `(id) => string` — a name resolved against the graph being rendered. */
  nameOf: { type: Function, required: true },
})

const emit = defineEmits([
  'rename',
  'set-result',
  'connect',
  'disconnect',
  'add-slot',
  'remove-slot',
  'remove',
])

const canBeResult = computed(() => props.node.kind !== 'source')
const takesInputs = computed(() => props.node.kind !== 'source')
const cardLabel = computed(() => props.label ?? stepLabel(props.node.kind, props.node.name))

/**
 * Rename, and put the field back to what the model holds afterwards.
 *
 * The write-back is the point. `renameStep` refuses an empty name and keeps the
 * old one, so the model's `name` is unchanged, so Vue sees an unchanged prop and
 * never patches the DOM — and the field goes on showing the empty text while the
 * refusal beside it says „der alte bleibt stehen". That is the exact state the
 * refusal exists to prevent, one layer out. It also puts a trimmed name back
 * where the user typed spaces.
 *
 * On the next tick, because the command runs synchronously in the parent's
 * handler and the projection it produces reaches this component one render later.
 */
const onRename = (event) => {
  const field = event.target
  emit('rename', field.value)
  nextTick(() => {
    field.value = props.node.name
  })
}

const marks = computed(() =>
  props.diagnostics.map((d) => ({
    key: d.code,
    text: graphText(d, props.nameOf),
    ...SEVERITY[d.severity],
  })),
)

/**
 * What a slot's select offers.
 *
 * The attached Step is listed first so the control can *display* it — a select
 * cannot show a value that is not among its options — and every candidate the
 * guard accepts follows. The attached one is never among them, because
 * `graph.already_connected` refuses it, so there is no duplicate to filter out.
 */
const optionsFor = (slot) => {
  const attached = props.node.inputs[slot]
  const accepted = props.candidates(props.node.id, slot)
  return attached ? [attached, ...accepted] : accepted
}

const onSlot = (slot, value) => {
  // The empty option is the disconnect, not a Step. Re-selecting the value a
  // select already displays fires no change event, so choosing what is already
  // attached cannot reach here at all — which is why there is no branch for it.
  if (value === '') emit('disconnect', slot)
  else emit('connect', slot, value)
}
</script>

<template>
  <!-- The card names itself as what it is: two Steps of the same kind are told
       apart by the name their author gave them, and nothing else on the canvas
       carries that pairing. It is also the one stable handle a locator has, since
       every control inside repeats the names of the Steps around it. -->
  <div
    role="group"
    :aria-label="cardLabel"
    data-testid="step-card"
    :data-node="node.id"
    class="w-64 rounded border bg-white px-3 py-2 text-sm shadow-sm"
    :class="result ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-300'"
  >
    <header class="flex items-center gap-2">
      <span class="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
        {{ kindLabel(node.kind) }}
      </span>
      <input
        :value="node.name"
        aria-label="Name"
        class="w-full min-w-0 rounded border border-transparent px-1 py-0.5 font-semibold hover:border-slate-300 focus:border-slate-400"
        @change="onRename"
      >
      <button
        v-if="canBeResult"
        type="button"
        aria-label="Als Ergebnis-Step setzen"
        :aria-pressed="result"
        class="shrink-0 rounded-full border px-2 py-0.5 text-[10px]"
        :class="result ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 text-slate-600'"
        @click="emit('set-result', node.id)"
      >
        Ergebnis
      </button>
    </header>

    <!-- Broken, under-filled and orphan all arrive here as Diagnostics and are
         all rendered from the one map. A sentence written into this template
         instead would make the gap check pass over a dead map entry. -->
    <ul
      v-if="marks.length"
      class="mt-2 space-y-1"
    >
      <li
        v-for="mark in marks"
        :key="mark.key"
        data-testid="step-mark"
        class="text-xs"
        :class="mark.tone"
      >
        <span class="font-semibold">{{ mark.label }}:</span> {{ mark.text }}
      </li>
    </ul>

    <ul
      v-if="takesInputs"
      class="mt-2 space-y-1"
    >
      <li
        v-for="(attached, slot) in node.inputs"
        :key="slot"
        data-testid="step-slot"
        class="flex items-center gap-1"
      >
        <span class="w-16 shrink-0 text-xs text-slate-500">{{ slotLabel(node.kind, slot) }}</span>
        <select
          :value="attached ?? ''"
          :aria-label="slotLabel(node.kind, slot)"
          class="w-full min-w-0 rounded border border-slate-300 px-1 py-0.5 text-xs"
          @change="onSlot(slot, $event.target.value)"
        >
          <option value="">
            — nicht verbunden —
          </option>
          <option
            v-for="id in optionsFor(slot)"
            :key="id"
            :value="id"
          >
            {{ nameOf(id) }}
          </option>
        </select>
        <!-- Present whatever the arity allows, and never disabled: the command's
             refusal is what names the limit, and a control hidden at the limit
             makes the limit unreachable outside a unit test. -->
        <button
          type="button"
          :aria-label="'Eingang entfernen: ' + slotLabel(node.kind, slot)"
          class="shrink-0 rounded border border-slate-300 px-1.5 text-xs text-slate-600"
          @click="emit('remove-slot', slot)"
        >
          −
        </button>
      </li>
    </ul>

    <div
      v-if="takesInputs"
      class="mt-2 flex gap-2"
    >
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
        @click="emit('add-slot')"
      >
        Eingang hinzufügen
      </button>
      <button
        type="button"
        :aria-label="'Step entfernen: ' + node.name"
        class="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
        @click="emit('remove')"
      >
        Entfernen
      </button>
    </div>
  </div>
</template>
