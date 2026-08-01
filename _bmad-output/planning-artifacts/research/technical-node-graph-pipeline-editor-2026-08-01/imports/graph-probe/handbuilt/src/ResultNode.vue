<script setup>
defineProps(['node'])
</script>
<template>
  <div data-kind="result">
    <strong>Ergebnis</strong>
    <label><input type="checkbox" v-model="node.data.config.isResult" @pointerdown.stop /> Result-Step</label>
  </div>
</template>
