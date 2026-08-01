<script setup>
// FR-14: exactly two inputs, several key columns, join type, explicit null
// handling, optional duplicate audit. The key list is what makes the body grow.
import { computed } from 'vue'
import StepFrame from './StepFrame.vue'

const props = defineProps(['id', 'data'])
const node = computed(() => props.data.node)

function addKey() {
  node.value.config.keys.push({ left: '', right: '' })
}
function removeKey(i) {
  if (node.value.config.keys.length > 1) node.value.config.keys.splice(i, 1)
}
</script>

<template>
  <StepFrame :node="node">
    <table class="qb-table">
      <tbody>
        <tr v-for="(k, i) in node.config.keys" :key="i" :data-t="`key-${node.id}-${i}`">
          <td><input v-model="k.left" placeholder="links" size="8" /></td>
          <td class="qb-eq">=</td>
          <td><input v-model="k.right" placeholder="rechts" size="8" /></td>
          <td><button @click="removeKey(i)">×</button></td>
        </tr>
      </tbody>
    </table>
    <button :data-t="`add-key-${node.id}`" @click="addKey">+ Schlüssel</button>

    <label class="qb-field">
      Art
      <select v-model="node.config.type" :data-t="`type-${node.id}`">
        <option value="left">left</option>
        <option value="inner">inner</option>
      </select>
    </label>
    <label class="qb-check">
      <input type="checkbox" v-model="node.config.nullsMatch" /> Null trifft Null
    </label>
    <label class="qb-check">
      <input type="checkbox" v-model="node.config.duplicateAudit" :data-t="`audit-${node.id}`" />
      Duplikat-Prüfung
    </label>
  </StepFrame>
</template>
