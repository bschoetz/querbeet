<script setup>
defineProps(['node'])
</script>
<template>
  <div data-kind="filter">
    <strong>Filter</strong>
    <label>Spalte <input v-model="node.data.config.column" @pointerdown.stop /></label>
    <label>Operator
      <select v-model="node.data.config.op" @pointerdown.stop><option>equals</option><option>contains</option></select>
    </label>
  </div>
</template>
