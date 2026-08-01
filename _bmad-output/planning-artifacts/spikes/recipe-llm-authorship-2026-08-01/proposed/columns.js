// Column checking for a machine-authored Recipe — the FR-28 half that the
// Editor spike's validator does not cover. It checks Steps and Sources; this
// checks the third thing FR-28 names: *"a Recipe referencing a column ... that
// does not exist is rejected naming the failing reference."*
//
// It matters more for a model than for a person. A person picks a column from a
// dropdown; a model half-recalls a name from the Column Profile, writes
// "Abteilung" where the file says "Bereich", and — without this — gets a clean
// load and a silently wrong result.
//
// Doing it properly means knowing which columns leave each Step, which is
// schema propagation and therefore a first slice of the transformation engine's
// job. For the three kinds that exist it is small and exact, because none of
// them invents a column: filter passes its input through, join concatenates,
// union merges under its mappings.
//
// Imports nothing but the graph model, like everything else under model/.

import { KINDS, findNode, edgesOf } from '../../editor-vueflow-2026-08-01/app/src/model/graph.js'

// A Source that declares no columns makes everything downstream unknowable. We
// return UNKNOWN rather than an empty set, so an undeclared Contract produces
// no check instead of a page of false accusations.
const UNKNOWN = null

function list(names) {
  return names.join(', ')
}

// The columns leaving `nodeId`, or UNKNOWN. Memoized per call, because the
// walk is repeated once per node and a diamond would otherwise be exponential.
export function columnsAt(graph, nodeId, memo = new Map()) {
  if (memo.has(nodeId)) return memo.get(nodeId)
  memo.set(nodeId, UNKNOWN) // cycle backstop; a cyclic graph never reaches here
  const node = findNode(graph, nodeId)
  if (!node) return UNKNOWN

  const inputs = node.inputs.map((id) => (id ? columnsAt(graph, id, memo) : UNKNOWN))
  let out = UNKNOWN

  switch (node.kind) {
    case 'source':
      out = Array.isArray(node.config?.columns) && node.config.columns.length ? [...node.config.columns] : UNKNOWN
      break

    case 'filter':
      // Keeps rows, never columns. Its output is its input.
      out = inputs[0]
      break

    case 'join':
      // Left then right, in that order. A name occurring on both sides is
      // reported by checkColumns as an ambiguity rather than resolved here:
      // the suffix rule belongs to the transformation engine and is not decided.
      if (inputs[0] && inputs[1]) {
        out = [...inputs[0]]
        for (const c of inputs[1]) if (!out.includes(c)) out.push(c)
      }
      break

    case 'union': {
      // mappings rename `from` to `target` wherever `from` appears, then
      // unmatched decides what happens to a column not every input has:
      // keep -> the union of all, drop -> the intersection.
      if (inputs.some((c) => c === UNKNOWN)) break
      const rename = new Map((node.config?.mappings || []).filter((m) => m?.from).map((m) => [m.from, m.target || m.from]))
      const mapped = inputs.map((cols) => cols.map((c) => rename.get(c) || c))
      if (node.config?.unmatched === 'drop') {
        out = mapped[0].filter((c) => mapped.every((cols) => cols.includes(c)))
      } else {
        out = [...mapped[0]]
        for (const cols of mapped.slice(1)) for (const c of cols) if (!out.includes(c)) out.push(c)
      }
      break
    }
  }

  memo.set(nodeId, out)
  return out
}

// Every column a Step's config names, with where it has to exist.
// `at` is the input index the reference must resolve against, or 'all' for a
// Union mapping, which may draw on any of its inputs. `pre` and `post` bracket
// the column name, because German puts the particle of a separable verb at the
// end of the clause: *ordnet die Spalte „X“ zu*.
function referencesOf(node) {
  const refs = []
  const c = node.config || {}
  const ref = (column, at, what, pre, post = '') => ({ column, at, what, pre, post })
  if (node.kind === 'filter')
    for (const [i, cond] of (c.conditions || []).entries())
      if (cond?.column) refs.push(ref(cond.column, 0, `Bedingung ${i + 1}`, 'filtert auf die Spalte'))
  if (node.kind === 'join')
    for (const [i, k] of (c.keys || []).entries()) {
      if (k?.left) refs.push(ref(k.left, 0, `Schlüssel ${i + 1} links`, 'verbindet über die Spalte'))
      if (k?.right) refs.push(ref(k.right, 1, `Schlüssel ${i + 1} rechts`, 'verbindet über die Spalte'))
    }
  if (node.kind === 'union')
    for (const [i, m] of (c.mappings || []).entries())
      if (m?.from) refs.push(ref(m.from, 'all', `Zuordnung ${i + 1}`, 'ordnet die Spalte', ' zu'))
  return refs
}

// Returns named errors, in the voice the rest of the validator uses: which
// Step, which reference, which column, and what was available instead — so the
// message can be pasted straight back to the model that wrote the Recipe.
export function checkColumns(graph) {
  const memo = new Map()
  const errors = []
  const notes = []

  for (const node of graph.nodes) {
    const side = ['linke', 'rechte']
    for (const ref of referencesOf(node)) {
      let available
      if (ref.at === 'all') {
        const all = node.inputs.map((id) => (id ? columnsAt(graph, id, memo) : UNKNOWN))
        if (all.some((c) => c === UNKNOWN)) continue
        available = [...new Set(all.flat())]
      } else {
        available = node.inputs[ref.at] ? columnsAt(graph, node.inputs[ref.at], memo) : UNKNOWN
        if (available === UNKNOWN) continue
      }
      if (available.includes(ref.column)) continue

      const where =
        node.kind === 'join'
          ? `die ${side[ref.at]} Tabelle hat sie nicht`
          : node.kind === 'union'
            ? 'keiner seiner Eingänge hat sie'
            : 'sein Eingang hat sie nicht'
      errors.push(
        `„${node.name}“ ${ref.pre} „${ref.column}“${ref.post} (${ref.what}), aber ${where}. Verfügbar: ${list(available)}.`,
      )
    }

    // Not an error: the two sides of a Join sharing a column name is legal and
    // common (both tables have "Name"). What happens to the duplicate is a
    // transformation-engine decision nobody has made, so it is surfaced, not judged.
    if (node.kind === 'join' && node.inputs[0] && node.inputs[1]) {
      const l = columnsAt(graph, node.inputs[0], memo)
      const r = columnsAt(graph, node.inputs[1], memo)
      if (l && r) {
        const both = l.filter((c) => r.includes(c))
        if (both.length)
          notes.push(`„${node.name}“ verbindet zwei Tabellen, die beide ${list(both.map((c) => `„${c}“`))} führen.`)
      }
    }
  }

  return { ok: errors.length === 0, errors, notes }
}

// The Step kinds this module knows how to propagate through. A kind added to
// KINDS without a case above would silently produce UNKNOWN downstream and turn
// the check off — so it is asserted rather than assumed.
export const PROPAGATED_KINDS = ['source', 'filter', 'join', 'union']
export function unpropagatedKinds() {
  return Object.keys(KINDS).filter((k) => !PROPAGATED_KINDS.includes(k))
}

export { edgesOf }
