// The graph model querbeet owns outright. No library import, by design: this
// module is the exit from Vue Flow (R6). Nodes are plain data, edges are
// *derived* from the input slots, and every mutation goes through a guard that
// returns a named reason on refusal (PRD FR-12).
//
// A Step's inputs are positional slots, not a free edge list. That is what
// makes "Union takes two or more, Join takes exactly two, the rest take exactly
// one" (FR-12) a property of the data rather than a rule to check later.

export const KINDS = {
  source: { label: 'Quelle', minInputs: 0, maxInputs: 0, slotLabels: () => [] },
  union: {
    label: 'Union',
    minInputs: 2,
    maxInputs: Infinity,
    slotLabels: (n) => n.inputs.map((_, i) => `Eingang ${i + 1}`),
  },
  join: { label: 'Join', minInputs: 2, maxInputs: 2, slotLabels: () => ['Links', 'Rechts'] },
  filter: { label: 'Filter', minInputs: 1, maxInputs: 1, slotLabels: () => ['Eingang'] },
}

export function emptyGraph() {
  // `lost` remembers the name of every removed node, so a Step that loses an
  // input can name what it lost instead of silently losing the reference.
  return { nodes: [], resultId: null, lost: {} }
}

export function findNode(graph, id) {
  return graph.nodes.find((n) => n.id === id) || null
}

export function defaultConfig(kind) {
  switch (kind) {
    case 'source':
      return { file: '', columns: [] }
    case 'union':
      return { mappings: [], unmatched: 'keep' }
    case 'join':
      return { keys: [{ left: '', right: '' }], type: 'left', nullsMatch: false, duplicateAudit: false }
    case 'filter':
      return { conditions: [{ column: '', op: 'equals', value: '' }], combine: 'and' }
    default:
      return {}
  }
}

export function makeNode(kind, { id, name, x = 0, y = 0, inputs, config } = {}) {
  const spec = KINDS[kind]
  const slots = inputs ? inputs.length : Math.min(spec.minInputs, spec.maxInputs === Infinity ? spec.minInputs : spec.maxInputs)
  return {
    id,
    kind,
    name: name || spec.label,
    x,
    y,
    inputs: inputs ? [...inputs] : new Array(slots).fill(null),
    config: config ? { ...config } : defaultConfig(kind),
  }
}

// --- edges are derived, never stored ------------------------------------

export function edgeId(sourceId, targetId, slot) {
  return `${sourceId}->${targetId}#${slot}`
}

export function edgesOf(graph) {
  const out = []
  for (const n of graph.nodes) {
    n.inputs.forEach((sourceId, slot) => {
      if (sourceId) out.push({ id: edgeId(sourceId, n.id, slot), source: sourceId, target: n.id, slot })
    })
  }
  return out
}

// --- the 12-line forward walk, carried over from the R6 probe unchanged ---

export function wouldCycle(graph, sourceId, targetId) {
  // walk forward from target; if we reach source, the new edge closes a cycle
  const seen = new Set()
  const stack = [targetId]
  while (stack.length) {
    const id = stack.pop()
    if (id === sourceId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edgesOf(graph)) if (e.source === id) stack.push(e.target)
  }
  return false
}

// --- mutations: the only door ------------------------------------------

// The guard, separated from the mutation so the pointer path can ask the same
// question without changing anything. Both doors run this; there is no second
// rule set.
export function checkConnect(graph, sourceId, targetId, slot) {
  const target = findNode(graph, targetId)
  const source = findNode(graph, sourceId)
  if (!source) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${sourceId}“.` }
  if (!target) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${targetId}“.` }
  if (sourceId === targetId)
    return { ok: false, reason: `„${target.name}“ kann nicht mit sich selbst verbunden werden.` }
  if (KINDS[target.kind].maxInputs === 0)
    return { ok: false, reason: `„${target.name}“ ist eine Quelle und nimmt keine Eingänge.` }
  if (!(slot >= 0 && slot < target.inputs.length))
    return { ok: false, reason: `„${target.name}“ hat keinen Eingang ${slot + 1}.` }
  if (target.inputs[slot] === sourceId)
    return { ok: false, reason: `„${source.name}“ liegt bereits an Eingang ${slot + 1} von „${target.name}“.` }
  if (wouldCycle(graph, sourceId, targetId))
    return {
      ok: false,
      reason: `„${source.name}“ → „${target.name}“ würde einen Kreis schließen: „${target.name}“ liegt bereits vor „${source.name}“.`,
    }
  return { ok: true }
}

export function connect(graph, sourceId, targetId, slot) {
  const check = checkConnect(graph, sourceId, targetId, slot)
  if (!check.ok) return check
  const target = findNode(graph, targetId)
  const replaced = target.inputs[slot]
  target.inputs[slot] = sourceId
  return { ok: true, replaced }
}

export function disconnect(graph, targetId, slot) {
  const target = findNode(graph, targetId)
  if (!target) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${targetId}“.` }
  if (!target.inputs[slot]) return { ok: false, reason: `Eingang ${slot + 1} von „${target.name}“ ist bereits leer.` }
  target.inputs[slot] = null
  return { ok: true }
}

export function addNode(graph, node) {
  if (!KINDS[node.kind]) return { ok: false, reason: `Unbekannte Step-Art „${node.kind}“.` }
  if (findNode(graph, node.id)) return { ok: false, reason: `Die Kennung „${node.id}“ ist bereits vergeben.` }
  graph.nodes.push(node)
  if (!graph.resultId && node.kind !== 'source') graph.resultId = node.id
  return { ok: true }
}

export function removeNode(graph, id) {
  const node = findNode(graph, id)
  if (!node) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${id}“.` }
  graph.nodes = graph.nodes.filter((n) => n.id !== id)
  // FR-12: a Step whose input disappears is marked broken and names what it
  // lost — it is neither deleted nor silently re-wired. So the dangling
  // reference stays in place and the name is remembered.
  graph.lost[id] = node.name
  if (graph.resultId === id) graph.resultId = null
  return { ok: true }
}

export function setResult(graph, id) {
  const node = findNode(graph, id)
  if (!node) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${id}“.` }
  if (node.kind === 'source') return { ok: false, reason: `Eine Quelle kann nicht der Ergebnis-Step sein.` }
  graph.resultId = id
  return { ok: true }
}

export function addInputSlot(graph, id) {
  const node = findNode(graph, id)
  if (!node) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${id}“.` }
  if (node.inputs.length >= KINDS[node.kind].maxInputs)
    return { ok: false, reason: `„${node.name}“ nimmt höchstens ${KINDS[node.kind].maxInputs} Eingänge.` }
  node.inputs.push(null)
  return { ok: true }
}

export function removeInputSlot(graph, id, slot) {
  const node = findNode(graph, id)
  if (!node) return { ok: false, reason: `Es gibt keinen Step mit der Kennung „${id}“.` }
  if (node.inputs.length <= KINDS[node.kind].minInputs)
    return { ok: false, reason: `„${node.name}“ braucht mindestens ${KINDS[node.kind].minInputs} Eingänge.` }
  node.inputs.splice(slot, 1)
  return { ok: true }
}

// --- the two walks no library in the field provides (R6) ----------------

export function contributingTo(graph, resultId = graph.resultId) {
  const seen = new Set()
  if (!resultId || !findNode(graph, resultId)) return seen
  seen.add(resultId)
  const stack = [resultId]
  const edges = edgesOf(graph)
  while (stack.length) {
    const id = stack.pop()
    for (const e of edges) if (e.target === id && !seen.has(e.source)) { seen.add(e.source); stack.push(e.source) }
  }
  return seen
}

export function orphans(graph) {
  const contributing = contributingTo(graph)
  return graph.nodes.filter((n) => !contributing.has(n.id)).map((n) => n.id)
}

// A Step is broken when a slot points at a node that is gone, or when it has
// fewer inputs filled than its kind requires.
export function brokenNodes(graph) {
  const out = []
  for (const n of graph.nodes) {
    const spec = KINDS[n.kind]
    const missing = []
    n.inputs.forEach((sourceId, slot) => {
      if (sourceId && !findNode(graph, sourceId))
        missing.push({ slot, lostName: graph.lost[sourceId] || sourceId })
    })
    const filled = n.inputs.filter((s) => s && findNode(graph, s)).length
    const underfilled = filled < spec.minInputs
    if (missing.length || underfilled)
      out.push({
        id: n.id,
        missing,
        underfilled,
        reason: missing.length
          ? `„${n.name}“ hat ${missing.map((m) => `„${m.lostName}“`).join(' und ')} verloren.`
          : `„${n.name}“ braucht ${spec.minInputs} Eingänge, hat aber ${filled}.`,
      })
  }
  return out
}

// A full structural verdict, used by the Editor and by the Recipe validator.
export function validate(graph) {
  const errors = []
  const seen = new Set()
  for (const n of graph.nodes) {
    if (seen.has(n.id)) errors.push(`Die Kennung „${n.id}“ kommt mehrfach vor.`)
    seen.add(n.id)
    if (!KINDS[n.kind]) errors.push(`„${n.name}“ hat die unbekannte Step-Art „${n.kind}“.`)
  }
  for (const b of brokenNodes(graph)) errors.push(b.reason)
  if (!graph.resultId) errors.push('Kein Step ist als Ergebnis-Step ausgewiesen.')
  else if (!findNode(graph, graph.resultId))
    errors.push(`Der ausgewiesene Ergebnis-Step „${graph.resultId}“ fehlt.`)
  const cyc = findCycle(graph)
  if (cyc) errors.push(`Der Graph enthält einen Kreis: ${cyc.join(' → ')}.`)
  return { ok: errors.length === 0, errors }
}

// Names the cycle rather than only reporting that one exists — FR-28 requires
// a rejection specific enough to paste back to a model.
export function findCycle(graph) {
  const edges = edgesOf(graph)
  const state = new Map()
  const path = []
  let found = null
  const walk = (id) => {
    if (found) return
    state.set(id, 'open')
    path.push(id)
    for (const e of edges) {
      if (e.source !== id) continue
      if (state.get(e.target) === 'open') {
        found = [...path.slice(path.indexOf(e.target)), e.target].map(
          (nid) => (findNode(graph, nid) || { name: nid }).name,
        )
        break
      }
      if (!state.has(e.target)) walk(e.target)
    }
    path.pop()
    state.set(id, 'done')
  }
  for (const n of graph.nodes) if (!state.has(n.id) && !found) walk(n.id)
  return found
}

export function cloneGraph(graph) {
  return {
    nodes: graph.nodes.map((n) => ({ ...n, inputs: [...n.inputs], config: structuredClone(n.config) })),
    resultId: graph.resultId,
    lost: { ...graph.lost },
  }
}
