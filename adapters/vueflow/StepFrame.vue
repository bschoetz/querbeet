<script setup>
// The frame every Step shares: the anchors, and a slot for a body this file
// knows nothing about. No German word reaches here (AD-13) — the body is the
// host's, handed in as a scoped slot.
//
// The input anchors sit at `(i+1)/(n+1)` of the node's own height. That fraction
// is deliberate rather than decorative: it makes every anchor position depend on
// the body height, which is what made the spike's drift measurement bite —
// measured at 0 px in Chromium and 0.02 px in Firefox across five height changes,
// including an anchor that had never been measured before it was connected to. A
// fixed-offset layout would have dodged the question.
//
// The rule that measurement leaves behind: **never place a Handle inside a
// fixed-height scrolling container.** The ResizeObserver that keeps the anchors
// correct watches the node element's box, not its contents.

import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { handleOfSlot, slotOfHandle } from './canvas-logic.js'

const props = defineProps({
  /** `{ id, kind, slots, dimmed }` — ids and geometry, never data (AD-6). */
  node: { type: Object, required: true },
  /** `(source, target, slot) => boolean`, supplied by the host. */
  guard: { type: Function, required: true },
})

const slots = computed(() => Array.from({ length: props.node.slots ?? 0 }, (_, i) => i))

/**
 * The pointer gesture's half of the guard.
 *
 * Wired on the Handle, **never as a `<VueFlow>` prop**: the store-level prop is
 * also applied by `setEdges` to every edge on every projection, so a cycle guard
 * there evaluates edges that already exist — for which a forward walk from target
 * trivially reaches source — and silently drops the entire graph.
 *
 * And it sits on **both** ends of a drag, because the library consults the
 * `isValidConnection` of the handle the pointer went *down* on. With the guard on
 * the inputs alone it is never asked during the ordinary gesture: a cyclic drag
 * was accepted by the view, refused by the model, and lit the handle green on the
 * way.
 */
const isValid = (connection) => {
  const slot = slotOfHandle(connection.targetHandle)
  if (slot === null) return false
  return props.guard(connection.source, connection.target, slot)
}
</script>

<template>
  <div
    class="qb-step"
    :data-node="node.id"
    :data-kind="node.kind"
  >
    <slot :node="node" />

    <Handle
      v-for="i in slots"
      :id="handleOfSlot(i)"
      :key="handleOfSlot(i)"
      type="target"
      :position="Position.Left"
      :style="{ top: `${((i + 1) / (slots.length + 1)) * 100}%` }"
      :data-slot="i"
      :is-valid-connection="isValid"
    />
    <Handle
      id="out"
      type="source"
      :position="Position.Right"
      :is-valid-connection="isValid"
    />
  </div>
</template>

<style>
.qb-step {
  position: relative;
}

/* Vue Flow's own stylesheet is unlayered, so it outranks every layered rule
 * Tailwind emits. The handle is therefore restyled here rather than from a
 * utility class that would lose. */
.vue-flow__handle {
  width: 10px;
  height: 10px;
  background: #2563eb;
  border: 1px solid #fff;
}

.vue-flow__node-step {
  cursor: grab;
}

.qb-edge-orphan .vue-flow__edge-path {
  stroke-dasharray: 4 3;
  opacity: 0.55;
}
</style>
