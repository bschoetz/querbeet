// The graph model the app owns outright. Nodes and edges are plain data; the
// canvas is a view over this and never takes ownership of anything inside `data`.
export function createGraph(nodes = [], edges = []) {
  return { nodes, edges }
}

export function wouldCycle(graph, sourceId, targetId) {
  // walk forward from target; if we reach source, the new edge closes a cycle
  const seen = new Set()
  const stack = [targetId]
  while (stack.length) {
    const id = stack.pop()
    if (id === sourceId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of graph.edges) if (e.source === id) stack.push(e.target)
  }
  return false
}

export function connect(graph, sourceId, targetId) {
  if (sourceId === targetId) return { ok: false, reason: 'Ein Step kann nicht mit sich selbst verbunden werden.' }
  if (wouldCycle(graph, sourceId, targetId))
    return { ok: false, reason: `Verbindung ${sourceId} → ${targetId} würde einen Zyklus schließen.` }
  if (graph.edges.some((e) => e.source === sourceId && e.target === targetId))
    return { ok: false, reason: 'Diese Verbindung besteht bereits.' }
  graph.edges.push({ id: `${sourceId}->${targetId}`, source: sourceId, target: targetId })
  return { ok: true }
}

// Steps that do not reach the Result Step (PRD FR-12) — a plain reverse walk.
export function contributingTo(graph, resultId) {
  const seen = new Set([resultId])
  const stack = [resultId]
  while (stack.length) {
    const id = stack.pop()
    for (const e of graph.edges) if (e.target === id && !seen.has(e.source)) { seen.add(e.source); stack.push(e.source) }
  }
  return seen
}
