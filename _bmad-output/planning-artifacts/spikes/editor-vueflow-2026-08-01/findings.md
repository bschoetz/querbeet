# Spike results: the Vue Flow Editor

**Date:** 2026-08-01 · **Status:** done, all four questions pass
**Artefact:** `app/` (Vite single-file build) · **Driver:** `run-spike.mjs` · **Raw data:** `spike-results.json`

Measured against the built single-file artefact opened from a real `file://` URL, headless, in
**Chromium 151.0.7922.34** and **Firefox 153.0**. No page errors and no requests beyond the document
itself in either engine. Build gate: `dist/` contains exactly one file, **247,987 B**, with zero
occurrences of dynamic `import(`, `fetch(`, `new Worker`, `importScripts`, `@font-face` or
`XMLHttpRequest`, no external `src`/`href`, and no non-`data:` `url()`.

---

## Verdict

The Editor stops being a risk. Vue Flow survives variable-height bodies without a single manual
re-measure call, the cycle guard sits in front of the mutation API on both paths, the ownership
question is decided in favour of **design B** with a mechanism that turns out to be stronger than
expected, and the Recipe round-trips byte-identically at 1,309 B for a six-Step graph.

R6's matrix does not need revisiting. The strongest argument against its verdict — the
variable-height tripwire — measured at **0 px** drift in Chromium and **0.02 px** in Firefox.

---

## Q1 — Do connection anchors survive variable-height node bodies?

**Yes, in both engines, with no `updateNodeInternals` call anywhere in the app.**

The first run of this spike appeared to fail with a 4.86 px error. It did not: the edge does not end
at the handle's *centre* but at its outer face, a fixed offset of half a handle width
(Chromium: −3.90 px against a 7.79 px handle at zoom 0.8657; Firefox: −3.95 px against 7.92 px at
0.8793). That is a rendering convention, not drift. **The measurement that answers the question is
the change in that offset across a height change**, not the offset itself.

| Case | Height change | Handle travelled | Offset change |
| --- | --- | --- | --- |
| Filter, +3 conditions (single anchor, vertically centred) | +60.8 px | 30.4 px | **0 px** |
| Join, +3 keys (two anchors at ⅓ and ⅔) | +60.7 px | 40.5 px | **0 px** |
| Union, +4 mapping rows | +81.0 px | 54.0 px | **0 px** |
| Union, +1 input (new handle, existing ones move) | +16.8 px | 27.9 px | **0 px** |
| Join, −2 keys (height shrinks) | −40.5 px | 27.0 px | **0 px** |

Chromium figures; Firefox is identical in structure with a worst case of 0.02 px.

The test is only worth anything because the node layout makes it bite: input handles sit at
`(i+1)/(n+1)` of the node's own height, so **every** handle position depends on body height. A
fixed-offset layout would have dodged the question entirely.

The hardest case passes too. Adding a Union input creates a handle that has never been measured;
connecting to it produced an edge landing on exactly the same convention (−3.90 px horizontal,
0.00 px vertical), while the two existing anchors did not move by a measurable amount.

**Mechanism**, so the result is understood rather than merely observed: every node element carries a
`ResizeObserver` which calls `updateNodeDimensions(..., forceUpdate: true)`, and that rewrites
`handleBounds.source` / `handleBounds.target` from a fresh `getBoundingClientRect`. It runs
independently of `applyDefault`, so design B does not disturb it.

**The residual risk this does not cover, and the rule that follows.** The observer watches the node
element's *box*. A handle that moves while the box stays the same size — a handle inside a
fixed-height scrolling area, for instance — would not fire it. Not built here, so not measured.
Carry it as a design rule: **never place a Handle inside a fixed-height scrolling container**, and if
that ever becomes necessary, `updateNodeInternals` is the escape hatch, exposed on the spike harness
and used nowhere in the app.

---

## Q2 — Is the cycle guard actually in front of every mutation?

**Yes, on both paths — and design B goes further than "in front of".**

- **Programmatic:** `editor.connect('j1','u1',0)` on the chain `u1 → f1 → j1` is refused with
  *„Mit Kunden“ → „Halbjahr“ würde einen Kreis schließen: „Halbjahr“ liegt bereits vor „Mit Kunden“.*
  The graph is byte-identical afterwards and the reason is rendered in the UI.
- **Pointer:** a real mouse drag from the Result Step's output handle to the Union's first input is
  refused, with the same named reason surfaced on drop. A control drag (`q2 → f1`) is accepted, so
  the refusal is not an artefact of dragging being broken.
- **Recipe load (FR-28):** a cyclic Recipe is rejected naming the cycle:
  *„Der Graph enthält einen Kreis: Filter → Filter 2 → Filter.“*

### The finding R6 could not have predicted

R6 [M8] measured `addEdges` creating a cycle silently. That result stands and was reconfirmed here —
`addEdges` emitted an `add` change for the cyclic edge, so **no cycle check ran**. But under
`applyDefault: false` the edge never reached the store: the edge count stayed at 6. Flipping
`applyDefault` back to `true` and repeating the identical call landed it (6 → 7), which pins the
mechanism empirically rather than by reading the source.

`addEdges` does not add edges. It proposes an `add` change, and the only subscriber that applies such
changes is the default handler that `applyDefault: false` unsubscribes. **Design B does not merely
put the guard in front of the mutation API — it removes the mutation API's ability to mutate.** Every
edge in Vue Flow's store exists because our model produced it.

### Two traps found on the way

1. **Never wire `isValidConnection` as a `<VueFlow>` prop.** The store-level `isValidConnection` is
   also applied by `setEdges` to *every* edge on *every* projection. A cycle guard there would
   evaluate already-existing edges — for which a forward walk from target trivially reaches source —
   and silently drop the entire graph. Wire it on the **Handle** instead, where it affects only the
   pointer gesture. This spike does.
2. **The projection re-asserts itself only when the projection changes.** An injected phantom edge
   survived a rename (which touches neither `flowNodes` nor `flowEdges`, since neither computed reads
   `name`) and vanished on the next structural or position change. Self-healing is real but is not a
   substitute for the guard, and must not be relied on as one.

---

## Q3 — Which side owns the truth?

**Decided: design B. The app's model is authoritative; Vue Flow is a view over it.**

The reasons, in the order that decided it:

1. **The Recipe is the product, and it is derived from the model.** Under design A the Recipe would
   be derived from a library's internal state, which would make the portable artefact — the thing the
   whole product hypothesis rests on — a function of a dependency whose last functional commit is
   2026-01-23.
2. **The guard becomes structural rather than disciplined.** See Q2: with `applyDefault: false`
   the library's mutation API stops being able to mutate. Under design A every future call site would
   have to remember to ask the guard first.
3. **It is the exit from Vue Flow, kept open.** `model/graph.js` imports nothing.

### What design B costs, concretely

The `:nodes` / `:edges` props are unusable. They are v-models — Vue Flow writes the store back into
them — so binding a projection there creates a second writer into our own state, which is exactly the
drift the R6 regret cluster describes. The projection is therefore pushed with `setNodes` / `setEdges`
from one watcher, and read back through `onNodesChange` / `onEdgesChange` in one place. Two functions
in, two out, no third path. `setNodes` merges into existing store nodes via `Object.assign`, so
measured dimensions and handle bounds survive re-projection — which is why Q1 and Q3 do not interact.

### Measured

Five drift checks, all clean in both engines: after loading a Recipe, after dragging a Step with the
mouse, after adding a Step, after connecting and disconnecting, after deleting a Step with a
downstream consumer. Each compares node count, per-node position and kind, the `data.node` identity,
and the full edge id set between the model and Vue Flow's own state.

A mouse drag round-trips: no position is written to the store except through the model, and
`f1` landed at 1024,247 (Chromium) / 1022,247 (Firefox) in the model, matching the store.

Deleting the Union marks its consumer broken and names what it lost —
*„Nur Bestand“ hat „Halbjahr“ verloren.* — rather than deleting or re-wiring it (FR-12), and the two
Sources plus the disconnected new Filter are reported as orphans.

The frozen 100,000 × 20 dataset survived all of it, still frozen, still held by reference. It never
enters the graph model at all.

---

## Q4 — Does the Recipe format survive a round trip?

**Yes: save → clear → load reproduces the graph byte-identically.** 1,309 B for a six-node graph with
three Sources, a Union, a Filter and a Join, all with configuration. Cleared to 0 nodes in between,
so the reload is real.

The format is `querbeet/recipe@1`, with `sources` and `steps` separated because the Input Contract
lives on the Sources.

**A Recipe contains no data — structurally.** Datasets live in a table registry keyed by Source id,
outside the graph, so serialization has nothing to leak and no stripping step to forget. The frozen
table was still attached at 100,000 rows after the round trip, because a Recipe has no data to
restore in the first place.

**The design rule holds: a linear pipeline is the trivial case.** `inputs` accepts a bare string for
single-input Steps, so a three-Step linear Recipe is three objects with one `inputs` string each. It
appears naturally in real output — the Filter above serializes as `"inputs": "u1"` while the Join
serializes as `"inputs": ["f1","kd"]`.

Six rejection classes, each naming the defect specifically enough to paste back to a model:

| Case | Message |
| --- | --- |
| Invalid JSON | *Das ist kein gültiges JSON: …* (engine's own parser message) |
| Dangling reference | *„F“ verweist an Eingang 1 auf „gibtsnicht“, das es nicht gibt.* |
| Wrong arity | *„J“ ist ein Join und nimmt genau 2 Eingänge, das Rezept nennt 1.* |
| Unknown Step kind | *„P“ hat die unbekannte Step-Art „pivot“.* |
| No Result Step | *Das Rezept weist keinen Ergebnis-Step aus.* |
| Result Step is a Source | *Der ausgewiesene Ergebnis-Step „a“ ist eine Quelle.* |
| Cyclic graph | *Der Graph enthält einen Kreis: Filter → Filter 2 → Filter.* |

Nothing is partially applied: validation runs against a fully parsed candidate graph and the editor's
graph is replaced only on success.

---

## Rules this spike adds

1. **Wire `isValidConnection` on the Handle, never on `<VueFlow>`** — the component-level prop is
   also applied by `setEdges` to every existing edge.
2. **Run with `applyDefault: false` and never bind `:nodes` / `:edges`** — they are v-models, and
   binding them creates a second writer into the app's own state.
3. **Never place a Handle inside a fixed-height scrolling container** — the ResizeObserver that keeps
   anchors correct watches the node's box, not its contents.
4. **Call `useVueFlow()` only in `setup`.** Anywhere else it resolves through `inject()`, fails
   silently, and hands back a *second, empty* store — and a production build strips the Vue warning
   that would have said so. This cost the spike its first Q3 run, which reported the graph as empty.
5. **Datasets never enter the graph model.** It is what makes "a Recipe contains no data" structural
   rather than a stripping step, and it keeps the graph cheap enough to be deeply reactive.

## What is still open

- **Keyboard reachability.** Out of scope by project decision, and PRD FR-12 and NFR-7 remain
  unsatisfied. Vue Flow's mutations are reachable programmatically — the precondition — but no
  keyboard path exists in the box, and none was built here.
- **Auto-layout and undo/redo.** Still nobody's; unchanged by this spike.
- **Scale.** The graph carried six to seven Steps. Nothing here says what a fifty-Step Recipe costs
  to render or to re-project.
- **The transformation work itself.** Arquero is settled (R1); this is the Editor shell only.

## What this unblocks

The FR-28 spike — *can a language model emit a valid Recipe from the documentation alone?* — now has
a real format, a working validator with named rejections, and a loader that refuses cycles,
dangling references and wrong arity before anything is applied.

## Files

| Path | What it is |
| --- | --- |
| `app/src/model/graph.js` | The graph model. Imports nothing. Kinds, derived edges, the cycle guard, the contributing-Steps walk, orphan and broken marking. |
| `app/src/model/recipe.js` | `querbeet/recipe@1` — serialization, parsing, validation with named reasons. |
| `app/src/editor.js` | The authoritative state and the only mutation doors; the projection into Vue Flow. |
| `app/src/App.vue` | The one place that writes Vue Flow's store and the one place that reads it back. |
| `app/src/nodes/` | `StepFrame` plus Source, Union, Join, Filter bodies. |
| `app/src/flow/Background.vue` | Vendored dot background, per R6 recommendation 6. |
| `app/src/harness.js` | Spike scaffolding: the measurements the driver reads. Not product code. |
| `run-spike.mjs` | The driver: build gate, then all four questions in both engines from `file://`. |
