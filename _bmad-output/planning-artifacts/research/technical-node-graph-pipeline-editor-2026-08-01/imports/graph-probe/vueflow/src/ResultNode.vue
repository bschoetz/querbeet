<script setup>
import { Handle, Position } from '@vue-flow/core'
defineProps(['id', 'data'])
</script>
<template>
  <div class="qb-node" data-kind="result">
    <strong>Ergebnis</strong>
    <label><input type="checkbox" v-model="data.config.isResult" /> Result-Step</label>
    <Handle type="target" :position="Position.Left" />
  </div>
</template>
