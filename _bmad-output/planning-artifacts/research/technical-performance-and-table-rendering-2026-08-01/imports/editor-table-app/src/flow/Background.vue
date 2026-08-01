<script setup>
// Vendored rather than depended on: @vue-flow/background has gone 1 year
// 9 months without a release (R6 [2]). It is a dot pattern that follows the
// viewport transform — twenty lines, no runtime dependencies, and no reason to
// carry an unmaintained package for it.
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

const props = defineProps({
  gap: { type: Number, default: 22 },
  radius: { type: Number, default: 1 },
  color: { type: String, default: '#c9cfd8' },
})

const { viewport } = useVueFlow()
const scaled = computed(() => props.gap * viewport.value.zoom)
</script>

<template>
  <svg class="qb-background" data-t="background">
    <pattern
      id="qb-dots"
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
    <rect x="0" y="0" width="100%" height="100%" fill="url(#qb-dots)" />
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
