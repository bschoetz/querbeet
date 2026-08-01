<script setup>
// The tallest body in the set, and the only kind whose input count is variable
// (FR-13: two or more). Adding an input both grows the node and adds a handle —
// the harder half of Q1, because a new handle has never been measured.
import { computed } from 'vue'
import StepFrame from './StepFrame.vue'
import { editor } from '../editor.js'

const props = defineProps(['id', 'data'])
const node = computed(() => props.data.node)

function addMapping() {
  node.value.config.mappings.push({ target: '', from: '' })
}
function removeMapping(i) {
  node.value.config.mappings.splice(i, 1)
}
</script>

<template>
  <StepFrame :node="node">
    <div class="qb-row">
      <button :data-t="`add-input-${node.id}`" @click="editor.addInputSlot(node.id)">+ Eingang</button>
      <button
        :data-t="`del-input-${node.id}`"
        @click="editor.removeInputSlot(node.id, node.inputs.length - 1)"
      >
        − Eingang
      </button>
    </div>

    <table class="qb-table">
      <tbody>
        <tr v-for="(m, i) in node.config.mappings" :key="i" :data-t="`mapping-${node.id}-${i}`">
          <td><input v-model="m.target" placeholder="Zielspalte" size="9" /></td>
          <td><input v-model="m.from" placeholder="Quellspalte" size="9" /></td>
          <td><button @click="removeMapping(i)">×</button></td>
        </tr>
      </tbody>
    </table>
    <button :data-t="`add-mapping-${node.id}`" @click="addMapping">+ Zuordnung</button>

    <label class="qb-field">
      Nicht zugeordnet
      <select v-model="node.config.unmatched">
        <option value="keep">behalten (null)</option>
        <option value="drop">verwerfen</option>
      </select>
    </label>
  </StepFrame>
</template>
