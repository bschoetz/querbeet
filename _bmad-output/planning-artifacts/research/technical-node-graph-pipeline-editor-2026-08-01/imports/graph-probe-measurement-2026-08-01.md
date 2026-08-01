# Graph-editor build probe — measurement note

**Measured for this decision, not cited.** Three node-graph editors were built as real
single-file artifacts with the same Vite configuration R2 established, then opened from a real
`file://` URL in Chromium 151.0.7922.34 and Firefox 153.0, headless, via Playwright.

**Every figure below is read from `graph-probe/graph-probe-results.json` in this folder**, which is
the final run of the probe; the complete probe sources are under `graph-probe/`, and the runner is
`graph-probe/run-graph-probe.mjs`. Package-export figures come from
`graph-probe/package-export-inspection.json`.

Host: Node 26.5.0, npm 12.0.1, Vite 8.2.0, `@vitejs/plugin-vue` 6.x, `vite-plugin-singlefile` 2.3.3,
Vue 3.5.x. Date: 2026-08-01.

> **On repeat runs.** The probe was run several times while its assertions were being corrected.
> Structural results (gates, identity, cycle behaviour, node kinds) were identical every time.
> **Heap deltas and mount timings were not**: an earlier run of the same builds reported Baklava's
> mount delta as 1.71 MB against 1.13 MB here, and mount timings moved by tens of percent. Treat
> the cost figures as order-of-magnitude, not as precise constants — what survives across runs is
> the ratio, not the digits.

## What each probe builds

The same application three times, so the numbers are comparable:

- **three node kinds** — Source, Filter, Result — each with **its own Vue component and its own
  configuration form** (a text input, a select, a checkbox), dispatched per kind;
- **two connections**, `Source → Filter → Result`;
- **a frozen dataset in the Source node's data**: 100,000 rows × 20 columns, every row
  `Object.freeze`d and the array `Object.freeze`d, attached **by reference**;
- after mount, in this order: the assertion snapshot, then a **programmatic** node addition and
  connection with no pointer input at all, then a cycle-closing connection attempt, then a zoom
  API call.

Candidates: `@vue-flow/core@1.48.2`, `baklavajs@2.8.1`, and a hand-built SVG canvas written for
this probe.

## Gate G1 — single file, nothing fetched at runtime

Static scan of each built `dist/index.html`, a directory listing of `dist/`, then the live
`file://` run.

| | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| files in `dist/` (`readdirSync`, recursive) | **1** (`index.html`) | **1** | **1** |
| built size | 224,382 B | 175,233 B | 73,532 B |
| `import(` in the artifact | 0 | 0 | 0 |
| `fetch(` | 0 | 0 | 0 |
| `new Worker` | 0 | 0 | 0 |
| `importScripts` | 0 | 0 | 0 |
| `@font-face` | 0 | 0 | 0 |
| `XMLHttpRequest` | 0 | 0 | 0 |
| non-`data:` `url()` | none | none | none |
| external `src`/`href` | none | none | none |
| **network requests beyond the document, Chromium** | **0** | **0** | **0** |
| **network requests beyond the document, Firefox** | **0** | **0** | **0** |
| page errors, either engine | none | none | none |

**All three pass G1 outright.** No candidate needed a workaround, and the `file://` run produced
zero console errors and zero failed requests in either engine.

## Gate G5 — does the library take ownership of the frozen table?

This is the question both web screens flagged as decisive and unresolved. It is now resolved.
The table was attached by reference and read back **out of each library's own state**.

| Assertion | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| `readback === frozenTable` | **true** | **true** | **true** |
| `isReactive(readback)` | **false** | **false** | **false** |
| `isProxy(readback)` | false | false | false |
| `toRaw(readback) === frozenTable` | true | true | true |
| array **and row 0** still frozen | true | true | true |
| rows after mount | 100,000 | 100,000 | 100,000 |

Identical in Chromium and Firefox. Note the exact scope of the freeze assertion: `assert.js`
checks `Object.isFrozen(readback) && Object.isFrozen(readback[0])` — **the array and its first
row**, not all 100,000 rows.

**No candidate proxies, wraps or mutates a frozen dataset placed in node data.** The Vue Flow
documentation's `markRaw` advice — which the Vue-3 screen read as evidence that Vue Flow would
convert the payload — turns out **not** to apply to a frozen array: Vue's reactivity skips
non-extensible objects, so `Object.freeze` is itself the protection and `markRaw` is unnecessary
here. The R2 architecture rule ("freeze every dataset at the boundary") already covers this gate.

One real difference did show up, and it is about the node *wrapper*, not the payload:

- **Vue Flow copies the node objects you hand it.** The node object inside Vue Flow's state is not
  identical to the one in the source array (`sourceNodeObjectIdentity: false`), while
  `nodesArrayStillOurs: true` — the wrapper is copied, the payload is passed through untouched.
- **BaklavaJS constructs the nodes itself** — you never hand it an array; you register classes and
  it instantiates them. The frozen table survives inside a `NodeInterface` value unchanged.
- **The hand-built canvas holds the app's own array**, so the question does not arise.

## Cost

Chromium only (`--enable-precise-memory-info`); Firefox exposes no equivalent, so its heap cells
are empty by design rather than by omission. Read with the repeat-run caveat at the top.

| | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| heap for the frozen 100k × 20 table | 94,436,629 B | 94,499,221 B | 94,343,713 B |
| **heap added by mounting the editor** | **2,763,340 B** | **1,125,656 B** | **323,848 B** |
| as a share of one source table | **2.93 %** | **1.19 %** | **0.34 %** |
| mount to two stable frames, Chromium | 62.4 ms | 68.1 ms | 11.9 ms |
| mount to two stable frames, Firefox | 61 ms | 54 ms | 48 ms |

The dataset costs ~94 MB in all three, as it must — it is the same data. **The editor itself costs
between 0.3 % and 2.9 % of one source table.** This confirms by measurement what the research plan
asserted by judgement: footprint must not decide this.

## Interaction surface, as measured rather than as documented

| | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| three distinct node kinds rendered, each its own Vue component | **yes** | **yes**, via the editor-level `#node` slot with `<component :is>` dispatch on `node.type` | **yes** |
| per-kind configuration form (text / select / checkbox) | yes, arbitrary Vue markup | yes — either the built-in interface components (`TextInputInterface`, `SelectInterface`, `CheckboxInterface`) or arbitrary markup in the slot | yes, arbitrary Vue markup |
| connection paths rendered at mount | 2 | 2 | 2 |
| add node + connect **programmatically**, no pointer | **yes** — `addNodes` / `addEdges` | **yes** — `graph.addNode` / `graph.addConnection` | **yes** — push to the array, `connect()` |
| zoom via API | `zoomIn()` | `ZOOM_TO_FIT_*` commands | 3 lines |

### Feature surface, from the published packages

From `graph-probe/package-export-inspection.json` — `Object.keys()` on the published
`@baklavajs/renderer-vue` UMD build, and an export-statement parse of the published
`@vue-flow/core` ESM build.

| | Vue Flow (69 exports) | BaklavaJS renderer-vue (75 exports) |
| --- | --- | --- |
| undo / redo | **absent** | `UNDO_COMMAND`, `REDO_COMMAND`, `useHistory` |
| clipboard | absent | `COPY_COMMAND`, `PASTE_COMMAND`, `CLEAR_CLIPBOARD_COMMAND`, `useClipboard` |
| subgraphs | absent | `CREATE_SUBGRAPH_COMMAND`, `SAVE_SUBGRAPH_COMMAND`, `SWITCH_TO_MAIN_GRAPH_COMMAND` |
| sidebar / toolbar | absent | `OPEN_SIDEBAR_COMMAND`, `TOOLBAR_COMMANDS`, `DEFAULT_TOOLBAR_COMMANDS` |
| zoom-to-fit command | absent | `ZOOM_TO_FIT_GRAPH_COMMAND` |

Vue Flow exports **nothing** matching `hist|undo|redo|clipboard|subgraph|cycle`. In the running
probe, Baklava's command handler answered for `UNDO_COMMAND` and `baklava.history` was present —
though note that the probe's check establishes only that the command **exists**, not that undo
works.

Neither library ships auto-layout.

### Cycle refusal (PRD FR-12) — measured

| | behaviour |
| --- | --- |
| **Vue Flow** | **Accepts a cycle.** `addEdges([{source:'r1',target:'s1'}])` on the chain `s1→f1→r1` succeeded; edge count went 3 → 4 with no error. A literal search of the published `vue-flow-core.mjs` finds **0** occurrences of `cycle`, `Cycle`, `acyclic` or `topological` — there is no cycle detection in the bundle to invoke. (`isValidConnection` appears 37 times and `connectionExists` 4 times; what those code paths do was **not** traced, so no claim is made about them.) |
| **BaklavaJS** | **Refuses a direct self-loop, accepts a longer cycle.** `checkConnection(f1.out, f1.in)` returns `{connectionAllowed: false}`; but `checkConnection(f1.out, s1.<input>)`, which closes the two-node cycle `s1→f1→s1`, returns `{connectionAllowed: true, connectionsInDanger: []}` and `addConnection` created it (3 → 4). **The detector exists but is not wired to the guard:** calling `containsCycle(graph)` immediately afterwards returns **`true`** in both engines. Kahn's algorithm is in the box; refusing the connection is still your code. *Caveat on this probe: the input used to close the cycle is `s1.inputs.table`, the hidden interface carrying the frozen table, because `s1` has no ordinary input port. A test against a normal port would be cleaner.* |
| **hand-built** | Refuses it, with the reason as text: `"Verbindung r1 → s1 würde einen Zyklus schließen."` — 12 lines of forward walk in `graph.js`. |

`sortTopologically` is declared in `@baklavajs/engine`'s type definitions alongside `containsCycle`
and documented there as Kahn's algorithm, but **this probe never calls it** — that is a
declaration reading, not a measurement.

Also measured on the hand-built canvas, because both are PRD requirements the libraries do not
address: the "Steps that do not contribute to the Result Step" marking (FR-12) resolved correctly
(1 orphan after the programmatic addition), and connection hit-testing works via a widened
transparent twin `<path>` (3 hit targets rendered) — no hit-test mathematics required.

## Hand-built cost, counted

The hand-built candidate is not a sketch: it does node dragging, background panning,
cursor-anchored wheel zoom with correct screen↔graph coordinate conversion, connection dragging
from an output port to a target node, cycle refusal with a named reason, orphan-step marking, and
connection hit-testing.

| File | Lines | What |
| --- | --- | --- |
| `graph.js` | 40 | the model: cycle check, connect with named refusals, contributing-steps walk |
| `Canvas.vue` | 124 | the view: coordinate conversion, drag/pan/zoom, bezier paths, ports, hit targets |
| **canvas + model** | **164** | |
| three node components | 31 | shared in shape with the other two candidates, so not a differentiator |

**164 lines** is the honest figure for what the two libraries provide on the interaction surface at
this scale — with **no auto-layout, no undo/redo, no minimap, no keyboard handling and no
multi-select**, none of which was built. The web research returned no published line count for a
hand-built node editor in either direction, so this number stands alone and should be read as one
data point from one probe, not as a general estimate.

## What this probe does not establish

- **Nothing at 30 nodes.** Every measurement is at three and then four nodes. Nothing here speaks
  to rendering or interaction cost at the upper end of the PRD's 5–30 range.
- **No auto-layout was built or benchmarked** for any candidate. This is the one interaction-surface
  item where the libraries and the hand-built path may genuinely diverge, and it is untested.
  Both libraries would reach for dagre or elkjs, and elkjs's default path is a Web Worker — which
  R2's rules permit only as a classic blob worker, and which is licensed EPL-2.0/GPL-3.0.
- **Pointer gestures were never exercised.** Every mutation in this probe went through the
  programmatic API. Dragging a connection with a real pointer, and whether each library's hit
  targets are usable, is unmeasured.
- **Node dimension measurement** — the failure mode both React Flow (#3270) and Vue Flow (#174)
  shipped bugs against — was not probed, because all probe nodes have a fixed width.
- **Whether undo actually works in Baklava.** Only the existence of the command was checked.
- **Precise heap deltas.** See the repeat-run caveat at the top.
