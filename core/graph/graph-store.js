// The Pipeline's command surface (AD-10). `ui/` never writes to the model; it
// issues the named commands below and re-reads the projection afterwards.
//
// The shape is `core/exec/source-store.js`'s, deliberately: a closure over the
// state, ids minted with a collision loop, a `mintedIds` set that is never
// emptied so a deleted id cannot be reissued (AD-14), and a `commit` that freezes
// on the way out at the one point of construction. This story does not invent a
// second store convention.
//
// **Refusal is a return value; a caller's bug throws** — the split
// `source-store.js` states verbatim. One thing sits on the refusal side that
// would sit on the throw side there, and the reason is design B: the canvas
// reports about nodes it measured a frame ago, so a position change for a Step
// that has just been deleted is a race between two truthful views rather than a
// caller's bug. **An unknown id is therefore a refusal on every command.** A
// wrong *type* still throws.

import { error } from '../diagnostics/diagnostic.js'
import {
  CODE,
  addInputSlot,
  addNode,
  checkConnect,
  connect,
  connectableInto,
  disconnect,
  edgesOf,
  emptyGraph,
  findNode,
  freePosition,
  graphDiagnostics,
  makeNode,
  moveNode,
  removeInputSlot,
  removeNode,
  renameNode,
  setResult,
} from './graph.js'
import { isAddableKind } from './kinds.js'

const freezeStep = (node) =>
  Object.freeze({
    id: node.id,
    kind: node.kind,
    name: node.name,
    x: node.x,
    y: node.y,
    inputs: Object.freeze([...node.inputs]),
  })

export function createGraphStore() {
  /** The working graph. Mutable, internal, and reachable only through the
   *  commands below — the projection readers hand out the frozen snapshot. */
  const graph = emptyGraph()

  // AD-14 — minted here, unique, never reused after a removal, so a Recipe
  // referencing a deleted Step can never silently bind to a new one. Source ids
  // arrive already minted by `createSourceStore` and are recorded rather than
  // re-derived; two minters of one id space would collide on the first reload.
  const mintedIds = new Set()

  const mintId = () => {
    for (let n = 1; ; n += 1) {
      const id = `s${n}`
      if (!mintedIds.has(id)) {
        mintedIds.add(id)
        return id
      }
    }
  }

  /** Frozen on the way out, one level down, at the point of construction. The
   *  diagnostics are recomputed here so no command can ship a projection whose
   *  marks describe the graph it replaced. */
  let snapshot
  const commit = () => {
    snapshot = Object.freeze({
      steps: Object.freeze(graph.nodes.map(freezeStep)),
      edges: Object.freeze(edgesOf(graph).map((e) => Object.freeze(e))),
      resultId: graph.resultId,
      diagnostics: Object.freeze(graphDiagnostics(graph)),
      // The names of the Steps that are gone. `graph.input_lost` carries one,
      // because the node has nowhere else to keep it — and a slot still pointing
      // at a removed Step has to render *something* beside the sentence that just
      // named it correctly. Without this the projection has only the id, and a
      // raw `src:umsatz-q2` appears in a German select.
      lost: Object.freeze({ ...graph.lost }),
    })
    return snapshot
  }
  commit()

  /** Run a model mutation and re-project. Every command below is this. */
  const apply = (result) => {
    commit()
    return result
  }

  /**
   * AD-10 command. **Throws** for a kind the toolbar cannot offer, rather than
   * refusing: the toolbar is rendered from `addableKinds()`, so neither an
   * unknown kind nor a Source is a state a user can reach. `graph.unknown_kind`
   * survives as a refusal for story 14's loader, which reads a kind out of a
   * file — the one caller for which an unknown kind is data rather than a bug.
   */
  function addStep(kind, at = {}) {
    if (!isAddableKind(kind)) throw new TypeError(`not an addable Step kind: ${kind}`)
    const id = mintId()
    const where =
      Number.isFinite(at.x) && Number.isFinite(at.y) ? { x: at.x, y: at.y } : freePosition(graph, kind)
    const result = addNode(graph, makeNode(kind, { id, name: at.name, ...where }))
    return apply({ ...result, id })
  }

  /**
   * AD-10 command, CAP-12. The pointer drop and the slot-row control both land
   * here, through the one guard in `checkConnect`.
   */
  const connectCmd = (sourceId, targetId, slot) => apply(connect(graph, sourceId, targetId, slot))

  const disconnectCmd = (targetId, slot) => apply(disconnect(graph, targetId, slot))

  const renameStep = (id, name) => apply(renameNode(graph, id, name))

  const moveStep = (id, x, y) => apply(moveNode(graph, id, x, y))

  /**
   * AD-10 command. **A Source is refused**, and the refusal is what keeps the two
   * stores from disagreeing: the Sources pane owns the Source list, so deleting a
   * Source node here removes it, marks its consumers broken, and then the next
   * `syncSources` puts the node straight back — with the dangling slot references
   * still in place, so the edges return too. Half a removal that undoes itself is
   * worse than a named no.
   */
  function removeStep(id) {
    const node = findNode(graph, id)
    if (node?.kind === 'source') {
      return apply({ ok: false, diagnostics: Object.freeze([error(CODE.sourceNotRemovable, { id })]) })
    }
    return apply(removeNode(graph, id))
  }

  const setResultCmd = (id) => apply(setResult(graph, id))

  const addInputSlotCmd = (id) => apply(addInputSlot(graph, id))

  const removeInputSlotCmd = (id, slot) => apply(removeInputSlot(graph, id, slot))

  /**
   * AD-10 command. One command, one direction: the Source store is the truth
   * about which Sources exist, and the graph holds their ids and positions.
   *
   * Three things this does deliberately.
   *
   * **The whole argument is validated before anything is mutated.** Throwing on
   * a later entry with earlier ones already added would leave the graph changed
   * and `commit()` never reached, so every reader would sit on a snapshot that
   * describes neither the old state nor the new one.
   *
   * **A vanished Source goes through `removeNode`** — the same path a deleted
   * Step takes — so "marked broken, naming what it lost" has one implementation
   * rather than two, and the Union that consumed it comes out named rather than
   * merely under-filled.
   *
   * **A new node is placed where no node already sits.** Counting the existing
   * Sources collides the moment one has been removed.
   */
  function syncSources(sources) {
    if (!Array.isArray(sources)) throw new TypeError('syncSources takes an array of sources')
    for (const source of sources) {
      if (typeof source?.id !== 'string' || source.id === '') {
        throw new TypeError('every source needs a non-empty string id')
      }
      if (typeof source.name !== 'string') throw new TypeError(`source ${source.id} needs a name`)
    }

    const wanted = new Map(sources.map((s) => [s.id, s.name]))
    const present = graph.nodes.filter((n) => n.kind === 'source').map((n) => n.id)

    // Every refusal the reconciliation collected, rather than a result derived
    // from nothing. A Source whose name arrives empty is refused by `renameNode`
    // and the command has to say so — it is the only command here that issues
    // more than one mutation, which is exactly why it was the one that could
    // report success over a refusal.
    const diagnostics = []
    const collect = (result) => {
      if (!result.ok) diagnostics.push(...result.diagnostics)
      return result
    }

    for (const id of present) {
      if (!wanted.has(id)) collect(removeNode(graph, id))
    }
    for (const [id, name] of wanted) {
      const node = findNode(graph, id)
      if (!node) {
        mintedIds.add(id)
        collect(addNode(graph, makeNode('source', { id, name, ...freePosition(graph, 'source') })))
      } else if (node.name !== name) {
        collect(renameNode(graph, id, name))
      }
    }
    return apply({ ok: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) })
  }

  return {
    addStep,
    connect: connectCmd,
    disconnect: disconnectCmd,
    renameStep,
    moveStep,
    removeStep,
    setResult: setResultCmd,
    addInputSlot: addInputSlotCmd,
    removeInputSlot: removeInputSlotCmd,
    syncSources,

    /** The frozen projection. `list()` is the Steps, `edges()` the connections
     *  derived from their slots, and `diagnostics()` what the graph says about
     *  itself — all three from one snapshot, so they cannot disagree. */
    get: (id) => snapshot.steps.find((s) => s.id === id) ?? null,
    list: () => snapshot.steps,
    edges: () => snapshot.edges,
    resultId: () => snapshot.resultId,
    diagnostics: () => snapshot.diagnostics,

    /** The name a removed Step had, or `null`. A slot still pointing at one has
     *  to render something beside the sentence that already named it. */
    lostName: (id) => snapshot.lost[id] ?? null,

    /**
     * The guard, asked without changing anything.
     *
     * This is the reason `checkConnect` is separated from the mutation at all:
     * the pointer gesture asks it per handle it hovers, and the refusal region
     * asks it again to name what was refused. Both would otherwise have to call
     * `connect` and rely on a refusal not mutating, which is a promise rather
     * than a shape.
     */
    check: (sourceId, targetId, slot) => {
      const result = checkConnect(graph, sourceId, targetId, slot)
      return result.ok
        ? { ok: true, diagnostics: Object.freeze([]) }
        : { ok: false, diagnostics: Object.freeze([result.diagnostic]) }
    },

    /** The Steps a slot would accept, from the same guard the connect commands
     *  use. This is what the keyboard path lists, and it is why a candidate it
     *  offers can never be refused on selection. */
    candidates: (targetId, slot) => Object.freeze(connectableInto(graph, targetId, slot)),
  }
}
