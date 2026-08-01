<script setup>
import { Handle, Position } from '@vue-flow/core'
defineProps(['id', 'data'])
</script>
<template>
  <div class="qb-node" data-kind="source">
    <strong>Source</strong>
    <label>Datei <input v-model="data.config.file" /></label>
    <small>{{ data.table ? data.table.length : 0 }} Zeilen</small>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
