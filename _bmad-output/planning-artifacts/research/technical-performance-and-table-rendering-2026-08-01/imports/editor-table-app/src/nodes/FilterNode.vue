<script setup>
// One input, so its single handle sits at the vertical centre of the node —
// the plainest form of the Q1 tripwire: every added condition moves the anchor
// by half a row.
import { computed } from 'vue'
import StepFrame from './StepFrame.vue'

const props = defineProps(['id', 'data'])
const node = computed(() => props.data.node)

function addCondition() {
  node.value.config.conditions.push({ column: '', op: 'equals', value: '' })
}
function removeCondition(i) {
  if (node.value.config.conditions.length > 1) node.value.config.conditions.splice(i, 1)
}
</script>

<template>
  <StepFrame :node="node">
    <table class="qb-table">
      <tbody>
        <tr v-for="(c, i) in node.config.conditions" :key="i" :data-t="`cond-${node.id}-${i}`">
          <td><input v-model="c.column" placeholder="Spalte" size="7" /></td>
          <td>
            <select v-model="c.op">
              <option value="equals">=</option>
              <option value="contains">enthält</option>
              <option value="gt">&gt;</option>
            </select>
          </td>
          <td><input v-model="c.value" placeholder="Wert" size="6" /></td>
          <td><button @click="removeCondition(i)">×</button></td>
        </tr>
      </tbody>
    </table>
    <button :data-t="`add-cond-${node.id}`" @click="addCondition">+ Bedingung</button>
    <label class="qb-field">
      Verknüpfung
      <select v-model="node.config.combine">
        <option value="and">und</option>
        <option value="or">oder</option>
      </select>
    </label>
  </StepFrame>
</template>
