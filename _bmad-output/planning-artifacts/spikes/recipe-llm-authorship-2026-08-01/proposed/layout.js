// A fallback layout for Recipes that arrive without positions.
//
// `ui` is the field a model drops first: it is cosmetic, it is repetitive, and
// under length pressure it is the obvious thing to omit. `x` and `y` default to
// 0, there is no auto-layout in the Editor (explicitly out of scope in the
// Editor spike — @dagrejs/dagre is the named candidate if it ever enters), so
// the result is every Step stacked on the origin and a correct Recipe that
// looks broken.
//
// This is not auto-layout. It is the one case auto-layout would be needed for:
// no positions at all. Anything else — a Recipe that positions some Steps, a
// user rearranging the canvas — is left alone.

// The two spacings the prompt block tells the model to use, so a hand-placed
// and a fallback-placed Recipe look like the same drawing.
export const COL_WIDTH = 260
export const ROW_HEIGHT = 140

export function allAtOrigin(graph) {
  return graph.nodes.length > 0 && graph.nodes.every((n) => n.x === 0 && n.y === 0)
}

// Column = longest path from a Source, so a Step always sits to the right of
// everything feeding it. Row = order of first appearance within the column,
// which keeps the Recipe's own ordering visible instead of sorting it away.
export function layout(graph, { colWidth = COL_WIDTH, rowHeight = ROW_HEIGHT } = {}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const depth = new Map()

  const depthOf = (id, guard = new Set()) => {
    if (depth.has(id)) return depth.get(id)
    if (guard.has(id)) return 0 // a cycle never reaches here; not a reason to hang
    guard.add(id)
    const node = byId.get(id)
    const feeders = (node?.inputs || []).filter((i) => i && byId.has(i))
    const d = feeders.length ? Math.max(...feeders.map((i) => depthOf(i, guard) + 1)) : 0
    depth.set(id, d)
    return d
  }

  for (const n of graph.nodes) depthOf(n.id)

  const rows = new Map()
  for (const n of graph.nodes) {
    const col = depth.get(n.id)
    const row = rows.get(col) || 0
    rows.set(col, row + 1)
    n.x = col * colWidth
    n.y = row * rowHeight
  }
  return graph
}

// Applies the fallback only to the case it is for.
export function layoutIfUnplaced(graph, opts) {
  if (!allAtOrigin(graph)) return false
  layout(graph, opts)
  return true
}
