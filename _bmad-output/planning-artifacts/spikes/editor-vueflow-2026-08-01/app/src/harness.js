// Spike scaffolding, not product code. It exposes the Editor's own API and a
// few measurements to the Playwright driver, so the four questions are answered
// against the real build running from a real file:// URL rather than against a
// test double.

import { nextTick } from 'vue'
import * as G from './model/graph.js'
import { editor, graph, tables, refusal, journal, flowEdges, orphanIds, brokenById } from './editor.js'
import { toRecipe, fromRecipe } from './model/recipe.js'

// The anchor measurement: where does the rendered edge actually end, and where
// is the handle it claims to end at? Both in screen pixels, so the comparison
// is independent of the viewport transform and of the engine.
function pointOnPath(path, at) {
  const len = path.getTotalLength()
  const p = path.getPointAtLength(at === 'start' ? 0 : len)
  const m = path.getScreenCTM()
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

function handleCentre(nodeId, handleId) {
  const el = document.querySelector(
    `.vue-flow__handle[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`,
  )
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function measureAnchors() {
  const out = []
  for (const g of document.querySelectorAll('g.vue-flow__edge[data-id]')) {
    const id = g.getAttribute('data-id')
    const path = g.querySelector('path.vue-flow__edge-path')
    const parsed = /^(.*)->(.*)#(\d+)$/.exec(id)
    if (!path || !parsed) continue
    const [, source, target, slot] = parsed
    const end = pointOnPath(path, 'end')
    const start = pointOnPath(path, 'start')
    const targetHandle = handleCentre(target, `in-${slot}`)
    const sourceHandle = handleCentre(source, 'out')
    out.push({
      id,
      targetDx: targetHandle ? +(end.x - targetHandle.x).toFixed(2) : null,
      targetDy: targetHandle ? +(end.y - targetHandle.y).toFixed(2) : null,
      sourceDx: sourceHandle ? +(start.x - sourceHandle.x).toFixed(2) : null,
      sourceDy: sourceHandle ? +(start.y - sourceHandle.y).toFixed(2) : null,
      targetHandleY: targetHandle ? +targetHandle.y.toFixed(2) : null,
    })
  }
  return out
}

// The question is not whether the edge ends exactly on the handle's centre —
// it never does, because Vue Flow anchors edges at the handle's outer face, a
// fixed offset. The question is whether that offset *stays* fixed while the
// body height moves the handle. So the measurement is a delta between two
// states, not an absolute.
function offsetDelta(before, after) {
  let worst = 0
  const perEdge = []
  for (const a of after) {
    const b = before.find((x) => x.id === a.id)
    if (!b) continue
    const d = Math.max(
      Math.abs((a.targetDx ?? 0) - (b.targetDx ?? 0)),
      Math.abs((a.targetDy ?? 0) - (b.targetDy ?? 0)),
      Math.abs((a.sourceDx ?? 0) - (b.sourceDx ?? 0)),
      Math.abs((a.sourceDy ?? 0) - (b.sourceDy ?? 0)),
    )
    perEdge.push({ id: a.id, deltaPx: +d.toFixed(2) })
    worst = Math.max(worst, d)
  }
  return { worstPx: +worst.toFixed(2), perEdge }
}

// The constant itself, so the report can state what it is rather than guess:
// half a handle's rendered width, which is the anchor convention.
function anchorConvention() {
  const h = document.querySelector('.vue-flow__handle')
  const pane = document.querySelector('.vue-flow__transformationpane')
  const zoom = pane ? new DOMMatrixReadOnly(getComputedStyle(pane).transform).a : 1
  const r = h?.getBoundingClientRect()
  return {
    handleWidthPx: r ? +r.width.toFixed(2) : null,
    halfHandlePx: r ? +(r.width / 2).toFixed(2) : null,
    zoom: +zoom.toFixed(4),
  }
}

function nodeHeights() {
  const out = {}
  for (const el of document.querySelectorAll('.qb-node[data-node]'))
    out[el.dataset.node] = +el.getBoundingClientRect().height.toFixed(1)
  return out
}

// `vf` is handed in from App.vue's setup rather than fetched with
// useVueFlow() here. That is not a style choice: useVueFlow() resolves the
// store through inject(), which only works during setup. Called from onMounted
// it silently creates a *second*, empty store — and a production build strips
// the Vue warning that would have said so. The first run of this spike measured
// that phantom store and reported the graph as empty.
export function installHarness(vf, changeLog = []) {
  // The drift check for Q3: does Vue Flow's own state still describe the same
  // graph our model describes? Compared field by field, not by trusting either.
  function drift() {
    const model = graph.value
    const storeNodes = vf.getNodes.value
    const storeEdges = vf.getEdges.value
    const problems = []
    if (storeNodes.length !== model.nodes.length)
      problems.push(`Knotenzahl: Modell ${model.nodes.length}, Vue Flow ${storeNodes.length}`)
    for (const n of model.nodes) {
      const s = storeNodes.find((x) => x.id === n.id)
      if (!s) { problems.push(`„${n.name}“ fehlt in Vue Flows Zustand`); continue }
      if (Math.round(s.position.x) !== Math.round(n.x) || Math.round(s.position.y) !== Math.round(n.y))
        problems.push(`Position von „${n.name}“: Modell ${Math.round(n.x)},${Math.round(n.y)} vs Vue Flow ${Math.round(s.position.x)},${Math.round(s.position.y)}`)
      if (s.type !== n.kind) problems.push(`Art von „${n.name}“: ${n.kind} vs ${s.type}`)
      if (s.data?.node !== n) problems.push(`„${n.name}“ zeigt in Vue Flow nicht auf das Modellobjekt`)
    }
    const modelEdges = flowEdges.value.map((e) => e.id).sort()
    const storeEdgeIds = storeEdges.map((e) => e.id).sort()
    if (JSON.stringify(modelEdges) !== JSON.stringify(storeEdgeIds))
      problems.push(`Kanten: Modell ${JSON.stringify(modelEdges)} vs Vue Flow ${JSON.stringify(storeEdgeIds)}`)
    return { ok: problems.length === 0, problems }
  }

  window.__qb = {
    // state
    graph: () => JSON.parse(JSON.stringify(graph.value)),
    refusal: () => (refusal.value ? { ...refusal.value } : null),
    journal: () => journal.value.slice(),
    orphans: () => [...orphanIds.value],
    broken: () => [...brokenById.value.values()],
    tableIdentityHeld: (id, ref) => tables.value[id] === ref,
    tableRows: (id) => tables.value[id]?.length ?? 0,
    tableFrozen: (id) => {
      const t = tables.value[id]
      return !!t && Object.isFrozen(t) && Object.isFrozen(t[0])
    },

    // mutations, exactly the ones the UI uses
    editor,
    tick: async () => {
      await nextTick()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    },

    // Q1
    measureAnchors,
    offsetDelta,
    anchorConvention,
    nodeHeights,
    // Only here, never in the app: the question is whether anchors track
    // without it. If they do not, this is the size of the fix.
    forceRemeasure: (id) => vf.updateNodeInternals(id ? [id] : undefined),

    // Q2 — the unguarded door, kept reachable so the probe can prove it is
    // still open in the library and closed in the app.
    rawAddEdges: (edges) => vf.addEdges(edges),
    vfEdgeCount: () => vf.getEdges.value.length,
    vfNodeCount: () => vf.getNodes.value.length,
    changeLog: () => changeLog.slice(),
    clearChangeLog: () => (changeLog.length = 0),
    // Flipping this at runtime shows whether "the addition never landed" is a
    // property of applyDefault: false or of something else.
    setApplyDefault: (v) => (vf.applyDefault.value = v),

    // Q3
    drift,

    // Q4
    toRecipe: (name) => toRecipe(graph.value, { name }),
    fromRecipe: (json) => fromRecipe(json),
    loadRecipe: (json) => editor.loadRecipe(json),
    clear: () => editor.clear(),

    // model functions, so the probe can assert against the same code the app runs
    G,
  }
}
