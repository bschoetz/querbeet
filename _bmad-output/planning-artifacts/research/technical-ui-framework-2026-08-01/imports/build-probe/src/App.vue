<script setup>
import { ref, shallowRef, onMounted } from 'vue'
import * as aq from 'arquero'
import DataWorker from './worker.js?worker&inline'

const status = ref('starting')
const rows = shallowRef([])
const workerSaid = ref('(pending)')
const rowIsProxy = ref(null)

onMounted(() => {
  // Arquero through the bundler, and the frozen-rows rule from the research.
  const t = aq.table({ a: [1, 2, 3, 4, 5], b: ['x', 'y', 'z', 'x', 'y'] })
  const out = t.filter(aq.escape(d => d.a > 1)).objects().map(Object.freeze)
  rows.value = Object.freeze(out)
  rowIsProxy.value = rows.value[0] !== out[0]

  const w = new DataWorker()
  w.onmessage = (e) => { workerSaid.value = e.data }
  w.postMessage(21)

  status.value = 'mounted'
})
</script>

<template>
  <pre id="out">status={{ status }} rows={{ rows.length }} rowIsProxy={{ rowIsProxy }} worker={{ workerSaid }}</pre>
</template>

<style scoped>
#out { font-family: monospace; background: #eee; padding: 8px; }
</style>
