// One assertion contract, shared by all three probes, so the results are comparable.
import { isReactive, isProxy, toRaw } from 'vue'

export function heap() {
  return (performance.memory && performance.memory.usedJSHeapSize) || null
}

export function assess({ candidate, frozenTable, readback, domRoot, heapBefore, heapAfterTable, heapAfterMount, mountMs, extra }) {
  const kindMarkers = [...domRoot.querySelectorAll('[data-kind]')].map((e) => e.dataset.kind)
  return {
    candidate,
    nodeKindsRendered: kindMarkers,
    distinctNodeKinds: [...new Set(kindMarkers)].sort(),
    edgePathsRendered: domRoot.querySelectorAll('path.vue-flow__edge-path, path[data-probe-edge], .baklava-connection path, .baklava-connection').length,
    // --- G5: does the library take ownership of the frozen table? ---
    identityPreserved: readback === frozenTable,
    readbackIsReactive: isReactive(readback),
    readbackIsProxy: isProxy(readback),
    toRawIsSame: toRaw(readback) === frozenTable,
    tableStillFrozen: Object.isFrozen(readback) && Object.isFrozen(readback[0]),
    rowCountAfter: readback.length,
    firstCellAfter: readback[0] && readback[0].c0,
    // --- cost ---
    heapBeforeBytes: heapBefore,
    heapAfterTableBytes: heapAfterTable,
    heapAfterMountBytes: heapAfterMount,
    tableCostBytes: heapAfterTable != null && heapBefore != null ? heapAfterTable - heapBefore : null,
    mountCostBytes: heapAfterMount != null && heapAfterTable != null ? heapAfterMount - heapAfterTable : null,
    mountMs,
    ...extra,
  }
}
