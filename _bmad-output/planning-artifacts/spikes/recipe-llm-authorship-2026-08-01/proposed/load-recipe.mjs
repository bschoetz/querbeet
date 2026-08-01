// The load path FR-28 actually needs: the Editor spike's `fromRecipe` plus the
// three checks the FR-28 spike found missing. It is written as a composition
// rather than an edit so the Editor spike's artefact — measured at 247,987 B,
// with its four answers — stays exactly as measured. Folding it in is three
// lines inside `fromRecipe`, once the Editor is a construction site rather than
// a spike.
//
// Order matters and mirrors the existing validator's own reasoning: structure
// first, then columns. A column error against a graph that has a dangling
// reference would be noise.

import { fromRecipe } from '../../editor-vueflow-2026-08-01/app/src/model/recipe.js'
import { checkColumns } from './columns.js'
import { layoutIfUnplaced } from './layout.js'

// A Source under `steps` loads today: `kind: "source"` is a known kind with
// zero inputs, so nothing refuses it, and `toRecipe` quietly moves it back into
// `sources` on the next save. Harmless, but it means one graph has two
// encodings and the documentation describes one of them.
function sourcesInSteps(doc) {
  return (doc?.steps || [])
    .filter((s) => s && s.kind === 'source')
    .map((s) => `„${s.name || s.id}“ ist eine Quelle und gehört unter „sources“, nicht unter „steps“.`)
}

export function loadRecipe(input) {
  const base = fromRecipe(input)
  if (!base.ok) return base

  // Safe now: fromRecipe has already proven it parses.
  const doc = typeof input === 'string' ? JSON.parse(input) : input

  const errors = sourcesInSteps(doc)
  const cols = checkColumns(base.graph)
  errors.push(...cols.errors)
  if (errors.length) return { ok: false, errors }

  const laidOut = layoutIfUnplaced(base.graph)
  return { ...base, notes: cols.notes, laidOut }
}

export { checkColumns, layoutIfUnplaced }
