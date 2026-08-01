<script setup>
import { computed } from 'vue'
import StepFrame from './StepFrame.vue'
import { tables } from '../editor.js'

const props = defineProps(['id', 'data'])
const node = computed(() => props.data.node)
const rows = computed(() => tables.value[props.id]?.length ?? 0)
</script>

<template>
  <StepFrame :node="node">
    <label class="qb-field">
      Datei
      <input v-model="node.config.file" :data-t="`file-${node.id}`" />
    </label>
    <small class="qb-meta">{{ rows.toLocaleString('de-DE') }} Zeilen, {{ node.config.columns.length }} Spalten</small>
  </StepFrame>
</template>
