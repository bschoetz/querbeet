<script setup>
// The frame every Step kind shares. The input handles sit at fractions of the
// node's own height — (i+1)/(n+1) — which is deliberate: it makes every handle
// position depend on the body height, which is the Q1 tripwire (Vue Flow #174 /
// React Flow #3270). A fixed-offset layout would dodge the question.
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { KINDS } from '../model/graph.js'
import { editor, graph, brokenById, orphanIds, pointerGuard } from '../editor.js'

const props = defineProps({ node: Object })

const spec = computed(() => KINDS[props.node.kind])
const slotLabels = computed(() => spec.value.slotLabels(props.node))
const isResult = computed(() => graph.value.resultId === props.node.id)
const broken = computed(() => brokenById.value.get(props.node.id))
const isOrphan = computed(() => orphanIds.value.has(props.node.id))
</script>

<template>
  <div
    class="qb-node"
    :class="{ 'qb-result': isResult, 'qb-broken': broken, 'qb-orphan': isOrphan }"
    :data-kind="node.kind"
    :data-node="node.id"
  >
    <header class="qb-head">
      <span class="qb-kind">{{ spec.label }}</span>
      <input
        class="qb-name"
        :value="node.name"
        :data-t="`name-${node.id}`"
        @input="editor.rename(node.id, $event.target.value)"
      />
      <button
        v-if="node.kind !== 'source'"
        class="qb-badge"
        :class="{ on: isResult }"
        :data-t="`result-${node.id}`"
        :title="isResult ? 'Ergebnis-Step' : 'Als Ergebnis-Step setzen'"
        @click="editor.setResult(node.id)"
      >
        Ergebnis
      </button>
    </header>

    <p v-if="broken" class="qb-warn" :data-t="`broken-${node.id}`">{{ broken.reason }}</p>
    <p v-else-if="isOrphan" class="qb-note" :data-t="`orphan-${node.id}`">
      Trägt nicht zum Ergebnis bei.
    </p>

    <ul v-if="slotLabels.length" class="qb-slots">
      <li v-for="(label, i) in slotLabels" :key="i" class="qb-slot">
        <span class="qb-slot-label">{{ label }}</span>
        <span class="qb-slot-value">{{ node.inputs[i] || '—' }}</span>
      </li>
    </ul>

    <div class="qb-body"><slot /></div>

    <Handle
      v-for="(label, i) in slotLabels"
      :key="`in-${i}`"
      :id="`in-${i}`"
      type="target"
      :position="Position.Left"
      :style="{ top: `${((i + 1) / (slotLabels.length + 1)) * 100}%` }"
      :data-slot="i"
      :is-valid-connection="pointerGuard"
    />
    <Handle v-if="node.kind !== 'result'" id="out" type="source" :position="Position.Right" />
  </div>
</template>
