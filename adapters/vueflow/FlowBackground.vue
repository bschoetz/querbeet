<script setup>
// The dot grid, vendored rather than depended on: `@vue-flow/background` has gone
// the better part of two years without a release, and this is twenty lines with
// no runtime dependency of its own.
//
// Two spellings matter here and both have been wrong before. `patternUnits` is
// spelled as SVG spells it — `pattern-units` is not an attribute, so the pattern
// falls back to `objectBoundingBox` and the grid does not render, silently and
// only in a browser. And the pattern's id is **unique per instance**: a
// document-global literal makes the second canvas on a page paint through the
// first one's pattern.

import { computed, useId } from 'vue'
import { useVueFlow } from '@vue-flow/core'

const props = defineProps({
  gap: { type: Number, default: 22 },
  radius: { type: Number, default: 1 },
  color: { type: String, default: '#cbd5e1' },
})

// Resolved in setup. Anywhere else `useVueFlow()` goes through `inject()`, fails
// silently and hands back a second, empty store — and a production build strips
// the Vue warning that would have said so.
const { viewport } = useVueFlow()

const patternId = `qb-dots-${useId()}`
const scaled = computed(() => props.gap * viewport.value.zoom)
</script>

<template>
  <svg
    class="qb-background"
    data-testid="editor-background"
  >
    <pattern
      :id="patternId"
      :x="viewport.x % scaled"
      :y="viewport.y % scaled"
      :width="scaled"
      :height="scaled"
      patternUnits="userSpaceOnUse"
    >
      <circle
        :cx="radius * viewport.zoom"
        :cy="radius * viewport.zoom"
        :r="radius * viewport.zoom"
        :fill="color"
      />
    </pattern>
    <rect
      x="0"
      y="0"
      width="100%"
      height="100%"
      :fill="`url(#${patternId})`"
    />
  </svg>
</template>

<style>
.qb-background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
