<script setup>
// D1's verdict, built for real: hand-rolled fixed-height row windowing over a
// frozen dataset. ~50 rows rendered, a spacer of rowCount x rowHeight behind
// them, and no node recycling — D1 measured a from-scratch rebuild at 4.1 ms
// and recycling would only muddy what R4/D4 is now asking.
//
// Row height is 32 px, which is not a styling choice: at half a million rows it
// is the tallest Firefox tolerates before the spacer collapses (R4/D1's
// row-height budget).
import { ref, shallowRef, computed } from 'vue'

const props = defineProps({
  rows: { type: Array, required: true },   // frozen
  columns: { type: Array, required: true },
})

const ROW_HEIGHT = 32
const WINDOW = 50

const offset = ref(0)
const viewport = ref(null)

const visible = shallowRef([])
function rebuild() {
  const start = offset.value
  const end = Math.min(start + WINDOW, props.rows.length)
  const out = new Array(end - start)
  for (let i = start; i < end; i++) out[i - start] = props.rows[i]
  visible.value = out
}
rebuild()

const spacerHeight = computed(() => props.rows.length * ROW_HEIGHT)
const padTop = computed(() => offset.value * ROW_HEIGHT)

function scrollTo(rowIndex) {
  offset.value = Math.max(0, Math.min(rowIndex, props.rows.length - WINDOW))
  rebuild()
}
function onScroll(e) {
  scrollTo(Math.floor(e.target.scrollTop / ROW_HEIGHT))
}

defineExpose({ scrollTo, rebuild, ROW_HEIGHT, WINDOW, offset })
</script>

<template>
  <div class="qb-tablepane">
    <div class="qb-tablehead">
      <span v-for="c in columns" :key="c" class="qb-th">{{ c }}</span>
    </div>
    <div class="qb-viewport" ref="viewport" @scroll="onScroll" data-t="viewport">
      <div class="qb-spacer" :style="{ height: spacerHeight + 'px' }">
        <div class="qb-rows" :style="{ transform: 'translateY(' + padTop + 'px)' }">
          <div v-for="(row, i) in visible" :key="offset + i" class="qb-tr" data-t="row">
            <span v-for="c in columns" :key="c" class="qb-td">{{ row[c] }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.qb-tablepane { display: flex; flex-direction: column; min-height: 0; height: 100%; border-left: 1px solid #d7dce3; background: #fff; }
.qb-tablehead { display: flex; border-bottom: 1px solid #d7dce3; background: #f6f8fa; font-weight: 600; }
.qb-th, .qb-td { flex: 0 0 90px; padding: 0 6px; font-size: 11px; line-height: 32px; height: 32px; overflow: hidden; white-space: nowrap; }
.qb-viewport { flex: 1; overflow: auto; min-height: 0; }
.qb-spacer { position: relative; }
.qb-rows { position: absolute; top: 0; left: 0; }
.qb-tr { display: flex; border-bottom: 1px solid #eef1f4; }
</style>
