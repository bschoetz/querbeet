<script setup>
import { Handle, Position } from '@vue-flow/core'
defineProps(['id', 'data'])
</script>
<template>
  <div class="qb-node" data-kind="filter">
    <strong>Filter</strong>
    <label>Spalte <input v-model="data.config.column" /></label>
    <label>Operator
      <select v-model="data.config.op"><option>equals</option><option>contains</option></select>
    </label>
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
