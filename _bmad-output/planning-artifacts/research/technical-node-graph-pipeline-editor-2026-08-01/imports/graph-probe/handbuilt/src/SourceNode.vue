<script setup>
defineProps(['node'])
</script>
<template>
  <div data-kind="source">
    <strong>Source</strong>
    <label>Datei <input v-model="node.data.config.file" @pointerdown.stop /></label>
    <small>{{ node.data.table ? node.data.table.length : 0 }} Zeilen</small>
  </div>
</template>
