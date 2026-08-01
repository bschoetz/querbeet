// The Recipe: the Pipeline as portable JSON. It contains no data — and here it
// cannot, because the tables never live in the graph model at all (they sit in
// a separate table registry keyed by Source id). That is structural, not a
// stripping step someone has to remember.
//
// Design rule from the spike: a linear pipeline must be the trivial case. So
// `inputs` accepts a bare string for a single input and may be omitted for a
// Source. A three-Step linear Recipe is then three objects with one `inputs`
// string each — about as little as a model can be asked to emit.

import { KINDS, emptyGraph, makeNode, addNode, findNode, validate } from './graph.js'

export const RECIPE_FORMAT = 'querbeet/recipe@1'

export function toRecipe(graph, { name = 'Unbenanntes Rezept' } = {}) {
  const sources = []
  const steps = []
  for (const n of graph.nodes) {
    const common = { id: n.id, name: n.name, ui: { x: Math.round(n.x), y: Math.round(n.y) } }
    if (n.kind === 'source') {
      // The Input Contract lives here: what the Recipe expects to be given.
      sources.push({ ...common, file: n.config.file, columns: n.config.columns })
    } else {
      steps.push({ ...common, kind: n.kind, inputs: packInputs(n.inputs), config: n.config })
    }
  }
  return { format: RECIPE_FORMAT, name, sources, steps, result: graph.resultId }
}

function packInputs(inputs) {
  const packed = inputs.map((i) => i || null)
  return packed.length === 1 ? packed[0] : packed
}

function unpackInputs(inputs) {
  if (inputs === undefined || inputs === null) return []
  return Array.isArray(inputs) ? inputs.map((i) => i || null) : [inputs]
}

// Returns { ok, graph } or { ok: false, errors } — every error names the
// failing reference, because FR-28 requires a message specific enough to paste
// back to the model that produced it.
export function fromRecipe(input) {
  let doc = input
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input)
    } catch (e) {
      return { ok: false, errors: [`Das ist kein gültiges JSON: ${e.message}`] }
    }
  }
  const errors = []
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['Das Rezept ist kein Objekt.'] }
  if (doc.format !== RECIPE_FORMAT)
    errors.push(`Unbekanntes Format „${doc.format}“ — erwartet wird „${RECIPE_FORMAT}“.`)

  const graph = emptyGraph()
  const seen = new Set()
  const claim = (entry, what) => {
    if (!entry || typeof entry !== 'object') { errors.push(`Ein Eintrag unter ${what} ist kein Objekt.`); return false }
    if (!entry.id) { errors.push(`Ein Eintrag unter ${what} hat keine Kennung.`); return false }
    if (seen.has(entry.id)) { errors.push(`Die Kennung „${entry.id}“ kommt mehrfach vor.`); return false }
    seen.add(entry.id)
    return true
  }

  for (const s of doc.sources || []) {
    if (!claim(s, 'sources')) continue
    addNode(
      graph,
      makeNode('source', {
        id: s.id,
        name: s.name || s.id,
        x: s.ui?.x ?? 0,
        y: s.ui?.y ?? 0,
        config: { file: s.file || '', columns: s.columns || [] },
      }),
    )
  }

  for (const s of doc.steps || []) {
    if (!claim(s, 'steps')) continue
    if (!KINDS[s.kind]) {
      errors.push(`„${s.name || s.id}“ hat die unbekannte Step-Art „${s.kind}“.`)
      continue
    }
    const inputs = unpackInputs(s.inputs)
    const spec = KINDS[s.kind]
    if (inputs.length < spec.minInputs || inputs.length > spec.maxInputs) {
      errors.push(
        `„${s.name || s.id}“ ist ein ${spec.label} und nimmt ${
          spec.maxInputs === Infinity ? `mindestens ${spec.minInputs}` : `genau ${spec.minInputs}`
        } Eingänge, das Rezept nennt ${inputs.length}.`,
      )
      continue
    }
    addNode(
      graph,
      makeNode(s.kind, {
        id: s.id,
        name: s.name || s.id,
        x: s.ui?.x ?? 0,
        y: s.ui?.y ?? 0,
        inputs,
        config: s.config,
      }),
    )
  }

  // Dangling references are named individually: which Step, which slot, which
  // missing id. This is the check UJ-3's edge case turns on.
  for (const n of graph.nodes) {
    n.inputs.forEach((sourceId, slot) => {
      if (sourceId && !findNode(graph, sourceId))
        errors.push(`„${n.name}“ verweist an Eingang ${slot + 1} auf „${sourceId}“, das es nicht gibt.`)
    })
  }

  if (!doc.result) errors.push('Das Rezept weist keinen Ergebnis-Step aus.')
  else if (!findNode(graph, doc.result))
    errors.push(`Der ausgewiesene Ergebnis-Step „${doc.result}“ kommt im Rezept nicht vor.`)
  else if (findNode(graph, doc.result).kind === 'source')
    errors.push(`Der ausgewiesene Ergebnis-Step „${doc.result}“ ist eine Quelle.`)
  else graph.resultId = doc.result

  if (errors.length) return { ok: false, errors }

  // Structural checks last, so a cycle is reported against a graph that has
  // already been proven referentially sound.
  const v = validate(graph)
  if (!v.ok) return { ok: false, errors: v.errors }

  return { ok: true, graph, name: doc.name || 'Unbenanntes Rezept' }
}
