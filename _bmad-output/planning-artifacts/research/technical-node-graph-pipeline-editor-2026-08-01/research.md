---
title: 'technical research: Node-graph pipeline editor'
type: 'technical'
topic: 'Node-graph pipeline editor'
decision: 'What carries a node-graph editor for ~5-30 nodes under querbeet''s single-file, file:// constraints — an existing Vue 3 component, a framework-agnostic library, or a hand-built SVG canvas?'
source: 'run (deep-recon, native)'
status: complete
preset: 'standard'
validation: 'normal'
shape: 'select'
created: '2026-08-01'
updated: '2026-08-01'
claims_verified: 17
claims_unverified: 0
claims_overturned: 0
---

# technical research: Node-graph pipeline editor

**Decision this research serves:** What carries a node-graph editor for ~5–30 nodes under
querbeet's single-file, `file://` constraints — an existing Vue 3 component, a framework-agnostic
library, or a hand-built SVG canvas? (research-plan.md R6, on the critical path.)

---

## Executive summary

**A hand-built SVG canvas wins at 85/100; Vue Flow 1.48.2 is the runner-up at 75 and BaklavaJS
2.8.1 scores 68.** All three were built as real single-file artefacts and measured from a
`file://` URL — this is not a paper comparison.

Three findings drive that answer.

**1. The gate everyone expected to be decisive isn't decisive — every candidate passes it.** All
three build to exactly one HTML file, contain zero occurrences of `import(`, `fetch(`,
`new Worker`, `importScripts`, `@font-face` or a non-`data:` `url()`, and issue **zero network
requests beyond the document** when opened from a real `file://` URL in Chromium 151 and Firefox
153, with no page errors in either engine [M5]. The `file://` gate — the constraint that shaped
this entire research plan — separates nothing here.

**2. The ownership question, which both of this run's screens — the Vue-3-native and the
framework-agnostic — named as decisive and unresolved, resolves in every candidate's favour — for a reason that generalises.** A frozen 100,000 × 20 table placed by
reference in node data comes back out of each library's own state with `readback === frozenTable`
true, `isReactive` false, and the array and its first row still frozen [M6]. Vue's reactivity
skips non-extensible objects, so **`Object.freeze` is itself the protection** and Vue Flow's
documented `markRaw` advice does not apply to a frozen payload. R2's existing architecture rule
already covers this gate. The one real difference is smaller than expected: Vue Flow **copies the
node wrapper objects** you hand it — the node object inside Vue Flow's state is not identical to the one in our source array — while passing
the payload through untouched [M7].

**3. What actually separates the candidates is graph semantics, and there the libraries are
weaker than the 164 lines that replace them.** PRD FR-12 requires that a connection creating a
cycle "is refused with a named reason". **Vue Flow has no cycle detection in its bundle** —
`addEdges` happily created `r1 → s1` on the chain `s1 → f1 → r1`, edge count 3 → 4, no error, and
a literal search of the published `vue-flow-core.mjs` finds **zero** occurrences of `cycle`,
`Cycle`, `acyclic` or `topological` [M8][M12]. BaklavaJS refuses a direct
self-loop but **allowed the two-node cycle**, while `containsCycle(graph)` from
`@baklavajs/engine` returned `true` immediately afterwards: the Kahn's-algorithm detector is in
the box, wiring it to the guard is still your code [M8]. The hand-built canvas refuses it with the
reason as text, in 12 lines.

**The biggest caveat, stated plainly:** the hand-built number rests on a probe with **fixed-width
nodes at three-to-four nodes**. The single best-evidenced risk in the whole web sweep is that
**node dimension measurement** is where hand-building hurts. React Flow #3270 (a node vanishes
without an explicit width, open ~7 weeks in 2023) and Vue Flow #174 (handles misplaced on dynamic-
height nodes, ~8 weeks in 2022) are the same *failure family*, asynchronous DOM geometry, in two
independent mature codebases [7][8]. querbeet's Step nodes carry per-kind
configuration forms of *different heights*, which is exactly that shape, and the probe did not
test it. If variable-height nodes turn out to be painful, that is the moment Vue Flow wins.

**Secondary result: PRD Open Question 4 is answered — R2's Vue 3 verdict survives.** The winning
criterion was "authoring a list of heterogeneous step kinds", and the requirement is now a graph.
All three probes are Vue 3 SFCs, per-kind `<component :is>` dispatch worked in every one, and
mount ranged 11.9–68.1 ms across both engines with no errors [3]. The framework choice does not need
revisiting.

---

## D1 — The field, and what the screen removes

The research plan named seven candidates. The screen — npm registry metadata read directly, plus
published tarballs installed and inspected on disk [M4], plus two web sweeps — **removes four of
them on hard gates and adds three that were not on the list**.

### Cut on gates

| Candidate | Latest release | Cut on |
| --- | --- | --- |
| Drawflow 0.0.60 | 2024-09-03 | **G3 freshness** — 1 y 11 m since publish [4] |
| LiteGraph.js 0.7.18 | 2024-01-08 | **G3** (2 y 7 m) *and* canvas rendering, so no Vue node bodies [4] |
| jsPlumb Community 6.2.10 | 2023-07-14 | **G3** (3 y 0 m); the repo carries "This repository no longer receives updates" and the maintained path is the commercial Toolkit, which "is not a public project" [5] |
| GoJS 4.0.3 | 2026-07-17 | **G4 licence** — the npm manifest declares `SEE LICENSE IN license.html`, which is how a commercial licence presents itself in the registry [M4] |

Two screening traps worth recording, because either would have produced a wrong answer:

- **`jointjs` was renamed.** The `jointjs` package's last stable is 3.7.7 (2023-11-07); the
  maintained line is **`@joint/core` 4.3.1 (2026-07-27)** with 15 releases inside the gate window
  [4][M4]. Screening the old name alone would have scored a live project as dead.
- **`@antv/x6`'s `latest` dist-tag is stale relative to its own publishing** — it resolves to
  3.1.7 (2026-03-18) while 3.2.7 and 3.3.7 were both published on 2026-05-19, so `npm i @antv/x6`
  does not install the newest code [M4].

### Rete.js — a licence-verification failure, not a capability failure

Rete is the most interesting cut because it fails on the gate the project wrote specifically after
R4's PrimeVue experience. **None of the four Rete packages ships a LICENCE file in the published
tarball** — `rete`, `rete-vue-plugin`, `rete-area-plugin` and `rete-connection-plugin` all assert
MIT solely through the `license` field in `package.json` [M1]. The repository says MIT; the
artefact you install cannot corroborate it. G4 asks for the LICENCE in the published package, and
Rete is the one candidate family that cannot supply one.

Two further marks against, both measured: `rete-vue-plugin` 2.1.3 declares peer
`vue "^2.6 || ^3.2"` and resolves `vue-demi` transitively — a **version-straddling renderer, not a
Vue-3-native one**, which is what G2 was written to catch [M3]. And Rete's auto-layout plugin
declares peer dependencies on `elkjs` and `web-worker` [4]: `elkjs@0.12.0` ships
`lib/elk-worker.js` as its default path and is licensed `EPL-2.0 OR GPL-3.0-or-later` [4] — a
worker chunk *and* a licence problem in one dependency.

### Added by the screen, not on the plan's list

- **`@joint/core` 4.3.1** (2026-07-27, MPL-2.0, **zero runtime dependencies**, no CSS in `dist/`,
  no fonts or workers found) — the freshest release in the entire field, and it clears every gate
  without touching the commercial JointJS+ tier [4][6]. It was **not** built, because its
  custom-HTML-node support via `foreignObject` could not be confirmed from documentation and
  there is no first-party Vue 3 binding. It is the wildcard reserve.
- **`@antv/x6` 3.1.7** (MIT, no CSS file at all in the tarball, no fonts, no workers, no dynamic
  import) with a first-party `@antv/x6-vue-shape` 3.0.2 — the cleanest tarball of the whole field
  on the offline gate [4]. Not built: its Vue shape also depends on `vue-demi`, and its layout
  package pulls `comlink` (Worker RPC) plus `dagre`.
- **`@maxgraph/core` 0.24.0** — Apache-2.0, zero dependencies, but its `css/common.css` references
  four `.gif` files and `images/warning.png` **by relative URL** [4]. It is the only candidate in
  the entire field with an actual runtime-fetch hazard in its shipped assets, and it would fail G1
  unless that stylesheet is dropped or the images inlined.

### The finalists

**Vue Flow 1.48.2** (2026-01-28) and **BaklavaJS 2.8.1** (2025-11-02) are the only two Vue-3-native
libraries the screen found credible; a third, `vueweave`, is 0.0.x with all three versions
published inside 48 hours in November 2025 and nothing since, and the registry record has no
repository field [2]. `vue-visual-node-editor` is not published on npm at all [2]. **On this
evidence the Vue-3-native field is genuinely two libraries deep.** Both finalists were built and
measured, alongside the hand-built baseline.

---

## D2 — The finalists on the criteria

Four criteria carry weight: interaction surface (25%), node rendering (20%), ownership fit (20%)
and ecosystem health (25%), with PRD graph semantics at 10% and footprint at 0%. Licence is a gate
rather than a criterion, and is settled first because it removed a candidate.

### Licence

Both finalists ship a LICENCE file in the published package and declare MIT in the manifest [M1].

**Vue Flow's LICENCE carries two copyright lines** — "Copyright (c) 2019-2025 webkid GmbH" and
"Copyright (c) 2021-2025 Burak Cakmakoglu" [2]. webkid GmbH is the React Flow / xyflow vendor, so
Vue Flow ships as a derivative work under React Flow's MIT grant. Given that vendor runs a Pro
subscription on its React line, the paid-tier question was checked directly rather than left as
absence of evidence: **vueflow.dev states "Released under the MIT License" and mentions React Flow
Pro only as optional support for the original creators — no paid tier, no runtime key, no
eligibility gate** [1]. BaklavaJS's LICENCE reads "MIT License / Copyright (c) 2021 newcat" —
single holder, no third-party grant [2].

Vue Flow is **not** xyflow code and is not published from the xyflow monorepo; it is an
independent Vue 3 reimplementation whose README credits React Flow as inspiration [13]. This
matters for reading the evidence: **a React Flow issue closed in 2024 says nothing about whether
Vue Flow has that bug.**

### Ecosystem health — and an inversion

Both are effectively **single-maintainer projects**: vue-flow has 3,634 commits from
`bcakmakoglu` against 4 from the next human contributor; baklavajs has 733 from `newcat` against
10 [2]. Both are funded by GitHub Sponsors with no commercial tier [2].

The star counts point one way and the commit log points the other:

| | Vue Flow | BaklavaJS |
| --- | --- | --- |
| stars / forks | 6,760 / 405 [2] | 2,045 / 149 [2] |
| open vs closed issues | 12 / 300 [2] | 44 / 228 [2] |
| latest release | 1.48.2, 2026-01-28 [M4] | 2.8.1, 2025-11-02 [M4] |
| releases in the last 12 months | 11 [M4] | 2 [M4] |
| **last functional code commit** | **2026-01-23** (`fix(core): disable selection on drag…`); the 2026-01-28 entries are a CHANGELOG chore and version bumps, and every commit since is documentation [2] | **2026-04-10** — a feature merge ("forward engine") plus bug fixes; the 2026-04-11 commit is documentation [2] |

**Vue Flow shipped more releases but has been quiet in the code for six months; Baklava ships
rarely but was still fixing bugs and merging features in April 2026** [2]. The project with a
third of the stars is the more actively developed one right now. Neither pattern is alarming on
its own — 12 open issues against 300 closed reads as either "finished" or "maintainer stepped
back", and this run could not distinguish the two.

Vue Flow's **add-on packages age at very different rates**, which is a maintenance signal the core
version hides: `@vue-flow/background` 1.3.2 last published 2024-11-13 (1 y 9 m, outside the gate),
while `@vue-flow/controls` (2025-08-07) and `@vue-flow/minimap` (2025-08-15) clear it by days [2].
The dotted background is a tiny zero-dependency surface — vendoring it is likely cheaper than
depending on it.

### Ownership and node rendering

| | Vue Flow | BaklavaJS |
| --- | --- | --- |
| model | you pass `nodes`/`edges` arrays; it keeps **its own internal reactive state** and copies your node wrappers into it [2][M7] | **it owns the model outright** — "Everything lives inside the editor"; node kinds are registered *classes* it instantiates, and values live in `NodeInterface` instances it constructs [2] |
| per-kind Vue bodies | **native** — `#node-<type>` slots or a `node-types` map, `data` is "any object" [2] | **possible but off-pattern** — customization is an editor-level `#node` slot, so per-kind bodies need `<component :is>` dispatch inside one slot (measured working), or you use the built-in interface components |
| Recipe round-trip | your Recipe maps onto plain node/edge objects | your Recipe must be **translated into Baklava's class model and back** |

This is where the two libraries genuinely diverge, and it reaches past the Editor. PRD FR-28
requires a language model to emit a valid Recipe from documentation alone. A Recipe that is a
plain list of nodes and edges is a shape a model handles well; a Recipe that must round-trip
through registered node classes and `NodeInterface` instances adds a translation layer on exactly
the path where correctness is hardest to guarantee.

### Interaction surface, as measured

| | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| connection dragging, pan, zoom | yes | yes | yes (124 lines) |
| minimap / controls / node-resizer / box-select | yes (separate packages) | box-select yes | no |
| **undo / redo** | **no** | **yes** — `UNDO_COMMAND`, `REDO_COMMAND`, `useHistory` [M10] | no |
| clipboard, subgraphs, sidebar, toolbar | no | **yes** — all four command groups exported [M10] | no |
| auto-layout | **no** | **no** | no |
| topological sort of the graph | no | **declared** — `sortTopologically`, documented as Kahn's algorithm, in `@baklavajs/engine`'s type definitions; never exercised by the probe [M13] | no |
| add node + connect programmatically, no pointer | yes | yes | yes |

Two things are worth naming. **Neither library ships auto-layout**, so it is not a differentiator.
React Flow's two highest-comment issues of all time are undo/redo (#656, 53
comments, 2020-11-02 → 2022-02-22) and auto-layout (#5, 42 comments, 2019-10-07 → 2021-03-07),
**both closed without the library absorbing the feature** [9][10]. The maintainers' closing
rationale could not be retrieved, so "the library refused to solve it" is an inference from the
outcome, not a quoted decision — React Flow ships neither to this day. Either way, a hand-builder
inherits nothing extra there. And **Baklava's declared topological sort is a real asset that has
nothing to do with drawing**: it is the pipeline execution order for a DAG, which querbeet needs
regardless of who draws the boxes.

---

## D3 — The measurement

Full method and raw data: `imports/graph-probe-measurement-2026-08-01.md` and
`imports/graph-probe/`. Three builds of the same application — three node kinds with their own Vue
components and configuration forms, two connections, and a frozen 100,000 × 20 table in the Source
node's data — were opened from a real `file://` URL in Chromium 151.0.7922.34 and Firefox 153.0.

### Gate G1 — passed by all three, with nothing to work around

| | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| files in `dist/` | **1** | **1** | **1** |
| built size | 224,382 B | 175,233 B | 73,532 B |
| `import(` / `fetch(` / `new Worker` / `importScripts` / `@font-face` / `XMLHttpRequest` | all 0 | all 0 | all 0 |
| non-`data:` `url()`, external `src`/`href` | none | none | none |
| network requests beyond the document, both engines | **0** | **0** | **0** |
| page errors, both engines | none | none | none |

The hazard everyone was watching for — a component that lazy-loads its own icons and fails only
from `file://` — did not appear in any finalist. It exists in the field: `@maxgraph/core`'s
stylesheet fetches four `.gif` files by relative URL [4], and Rete's auto-layout path is
elkjs-in-a-Worker [4]. Neither is a finalist.

### Gate G5 — resolved, and it resolves for everyone

| Assertion (identical in both engines) | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| `readback === frozenTable` | **true** | **true** | **true** |
| `isReactive(readback)` | false | false | false |
| array and row 0 still frozen | true | true | true |
| rows after mount | 100,000 | 100,000 | 100,000 |

**No candidate proxies, wraps or mutates a frozen dataset placed in node data** [M6]. The Vue-3
screen read Vue Flow's `markRaw` documentation as evidence that Vue Flow would convert the payload, and scored Vue Flow as a G5 failure. The measurement **overturns that reading**: Vue's
reactivity skips non-extensible objects, so freezing is the protection and `markRaw` is
unnecessary here. R2's rule — freeze every dataset at the boundary — already covers this gate for
any candidate.

The one real difference is about the wrapper, not the payload: **Vue Flow copies the node objects
it is handed** (the node object inside Vue Flow's state is not identical to the one in the source
array) while `data.table` identity survives [M7]. That is an indirection to design around, not a memory problem.

### Cost — and why footprint cannot decide this

Chromium only; Firefox exposes no precise-memory API.

| | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- |
| heap for the frozen 100k × 20 table | 94,436,629 B | 94,499,221 B | 94,343,713 B |
| **heap added by mounting the editor** | **2,763,340 B** | **1,125,656 B** | **323,848 B** |
| as a share of one source table | **2.93 %** | **1.19 %** | **0.34 %** |
| mount to two stable frames, Chromium | 62.4 ms | 68.1 ms | 11.9 ms |
| mount to two stable frames, Firefox | 61 ms | 54 ms | 48 ms |

**The editor costs between 0.3 % and 2.9 % of one source table** [M9]. The research plan asserted
that footprint must not decide this; the measurement confirms it. The 49 KB spread in built size
between Vue Flow and Baklava is likewise noise against R2's 280 KB baseline.

*Read the heap and timing figures as order-of-magnitude.* The probe ran several times while its
assertions were being corrected; structural results were identical every time, but an earlier run
of the same builds put Baklava's mount delta at 1.71 MB against 1.13 MB here. What survives
repetition is the ratio, not the digits.

### Graph semantics against PRD FR-12 — the real separator

| | measured behaviour |
| --- | --- |
| **Vue Flow** | **Accepts a cycle.** `addEdges([{source:'r1',target:'s1'}])` on the chain `s1→f1→r1` succeeded, 3 → 4 edges, no error [M8]. A literal search of the published `vue-flow-core.mjs` finds **0** occurrences of `cycle`, `Cycle`, `acyclic` and `topological` — there is nothing in the bundle to invoke [M12]. (`isValidConnection` appears 37 times and `connectionExists` 4 times; those code paths were **not** traced, so no claim is made about them.) The unguarded path is the programmatic one, which a Recipe loader and an LLM-authored Recipe both use. |
| **BaklavaJS** | **Refused a self-loop, accepted a longer cycle.** `checkConnection(f1.out, f1.in)` → `{connectionAllowed: false}`; `checkConnection(f1.out, s1.<input>)`, closing `s1→f1→s1`, → `{connectionAllowed: true, connectionsInDanger: []}`, and `addConnection` created it. `containsCycle(graph)` returned **`true`** immediately afterwards, in both engines. **The detector exists but is not wired to the guard** [M8]. *Probe caveat:* the cycle was closed onto `s1.inputs.table`, the hidden interface carrying the frozen table, because the Source node has no ordinary input port; a test against a normal port would be cleaner. |
| **hand-built** | Refuses it and names the reason: `"Verbindung r1 → s1 würde einen Zyklus schließen."` — 12 lines of forward walk. |

Two further FR-12 requirements were built and verified only on the hand-built canvas, because
neither library addresses them: the marking of Steps that do not contribute to the Result Step
(one orphan resolved correctly after a programmatic node addition), and connection hit-testing —
which needs no mathematics at all, just a widened transparent twin `<path>` with
`pointer-events: stroke`.

### What 164 lines buys

The hand-built candidate does node dragging, background panning, cursor-anchored wheel zoom with
correct screen↔graph coordinate conversion, connection dragging from an output port, cycle refusal
with a named reason, orphan-Step marking, and connection hit-testing — in **`graph.js` 40 lines +
`Canvas.vue` 124 lines = 164 lines**, excluding the three node components that are shared in shape
with the other two candidates [M11].

It has **no auto-layout, no undo/redo, no minimap, no multi-select and no keyboard handling**.
Against Vue Flow, that list shrinks to the minimap and the separate resizer and controls packages,
because Vue Flow ships no undo/redo and no auto-layout either. Against Baklava it costs undo/redo,
clipboard, subgraphs and a topological sort.

The web sweep returned **no published line count for a hand-built web node editor in either
direction** across four query formulations, so this number stands alone and should be read as one
data point from one probe, not a general estimate.

---

## Cross-dimension insights

**The constraint that shaped this research plan turned out not to be the constraint that decides
it.** `file://` and single-file inlining were expected to be the filter; every finalist passed
without a workaround, and the two candidates carrying genuine runtime-fetch hazards (maxGraph's
`.gif` references, Rete's elkjs worker) were already out on other grounds. The decision was
settled instead by graph semantics — cycle refusal, orphan marking, Recipe round-trip — which the
plan listed as a sub-question rather than a criterion.

**Licence risk relocated.** After R4's PrimeVue finding, the gate was written to catch a
relicensing. What it actually caught was **absence of evidence**: Rete's four packages ship no
LICENCE file at all [M1]. The lesson generalises past "read the LICENCE in the published package"
to "confirm the published package *has* one".

**The library's own scar tissue predicts the hand-builder's pain better than any hand-builder
account.** No retrospective with a line count or a documented reversal was found in either
direction. But the problems the mature libraries *refused* to absorb, undo/redo and auto-layout, cost a hand-
builder nothing extra, because neither library ships them either. The one both of them shipped
bugs against independently — **node dimension measurement** [7][8] — is precisely where a hand-
built canvas is most exposed. The honest weight of that evidence: two issues, one per
codebase, a year apart, each open under two months. A pattern across two projects, not a long war. That asymmetry is the sharpest thing the web research produced, and it is
the reason the recommendation below carries a specific tripwire rather than a blanket verdict.

**Scale advice in this field is almost all irrelevant here.** React Flow's performance literature
— stress tests at 100 nodes, drag lag, the open RFC for BVH spatial queries and viewport
virtualisation — is about graphs an order of magnitude larger than the PRD's 5–30 [11]. Viewport
culling, canvas-versus-DOM rendering and spatial indexing should be **discounted to zero** for
querbeet. Flyde's author reports budgeting for a WebGL/canvas rewrite on performance grounds and
never needing it [12].

---

## Verdict

The answer first, then the matrix it came from, then the conditions under which it flips.

### The pick

**Build the canvas. Keep the graph model library-free.**

The hand-built path wins because at 5–30 nodes the interaction surface a library provides is
small — 164 measured lines — while the semantics querbeet actually needs (cycle refusal with a
named reason, orphan-Step marking, a Recipe format a language model can emit) are things **no
library in the field provides**, and both finalists were measured *failing* the cycle requirement.
Buying a library here means writing the graph semantics anyway, on top of someone else's model.

### The weighted matrix

Scores 1–5. Weights follow the research plan's stated criteria, with **footprint at 0% by
instruction** — vindicated by the measurement — and **keyboard reachability excluded entirely by
project decision at the plan gate**, which is recorded below as a deviation from PRD FR-12.

| Criterion | Weight | Vue Flow | BaklavaJS | hand-built |
| --- | --- | --- | --- | --- |
| Interaction surface shipped | 25% | 4 | 5 | 3 |
| Node rendering — per-kind Vue bodies | 20% | 5 | 3 | 5 |
| Ownership fit — graph as a view over an app-owned model | 20% | 4 | 2 | 5 |
| Ecosystem health / five-year regret risk | 25% | 3 | 3 | 4 |
| PRD graph semantics (cycle refusal, orphan marking, Recipe round-trip) | 10% | 2 | 4 | 5 |
| **Weighted total** | | **3.75 → 75** | **3.40 → 68** | **4.25 → 85** |

The matrix is here to be re-weighted rather than trusted, so here is exactly what moves it —
recomputed, holding the ratios of the other weights fixed:

- **Interaction surface is the only weight that changes the answer on its own.** Raise it from 25%
  to **47%** and Baklava takes the lead; at **50%** Vue Flow also passes the hand-built path. Below
  47%, no single-weight change unseats the hand-built path.
- **Re-weighting ecosystem health does not favour Vue Flow — it favours the hand-built path**,
  because as scored the hand-built path is *higher* there (4 vs 3): no dependency, no five-year
  regret risk. Vue Flow wins on that axis only if you reject that score — that is, if you hold a
  maintained upstream to be worth strictly more than owned code (Vue Flow 5, hand-built 2). Under
  *that* re-scoring the crossover is at an ecosystem weight of just **10%** and Vue Flow wins
  outright. That is a judgement about ownership, not a finding — and it is the same judgement that
  produced the project decision on R1.

### The runner-up, and when it wins instead

**Vue Flow 1.48.2.** It wins if any of these turns out to be true:

- **Variable-height node bodies prove painful.** This is the named tripwire — see below.
- The interaction surface has to grow: minimap, node resizing, box-select, edge labels and
  markers, snapping. Vue Flow ships these as packages; each is a day of work otherwise.
- The team decides a maintained upstream absorbing five years of browser change is worth more than
  code it owns.

If Vue Flow is adopted, two things are non-negotiable given the measurements: **wrap every
graph mutation in a cycle check of your own**, because `addEdges` will not refuse one [M8]; and
**vendor `@vue-flow/background`** rather than depend on a package that has gone 1 year 9 months without a release [2].

**BaklavaJS is the pick only if undo/redo, clipboard and subgraphs become MVP requirements.** Its
shipped `sortTopologically` is genuinely valuable — but it is 30 lines to write and does not
justify adopting a framework that owns your model.

### The strongest argument against the pick

**Node dimension measurement.** Both mature libraries shipped years of bugs on exactly this —
React Flow #3270 (a node disappears entirely without an explicit width when its content is
dynamic) and Vue Flow #174 (handle positions computed wrongly on dynamic-height nodes) [7][8].
Anchor positions depend on asynchronously measured DOM geometry. querbeet's Step nodes carry
per-kind configuration forms of different heights, so this is querbeet's shape — and the probe
used fixed-width, fixed-content nodes and therefore did not test it. Two independent codebases
failing at the same point is the best evidence in this report that the hand-built path has a hard
part the probe did not reach.

### The reversibility hedge

**Keep `graph.js` — the model — free of both the canvas and any library.** In the probe it is 40
lines: nodes, edges, a forward-walk cycle check, connect-with-named-refusals, and a reverse walk
for contributing Steps. Neither library touched it. This is the same seam R2 mandated for the
pipeline core, applied one level up: if the canvas has to be replaced by Vue Flow, only
`Canvas.vue` is rewritten, the Recipe format is unaffected, and FR-28's LLM protocol never notices.

**The tripwire, stated as a test rather than a feeling:** build the Union and Join Step bodies —
the two with the most configuration, and therefore the most variable height — inside the
hand-built canvas, resize one at runtime, and confirm the connection anchors follow. If they do
not, and the fix is not obviously small, switch to Vue Flow before more is built on top.

---

## Recommendations

1. **Adopt the hand-built SVG canvas for the Editor, with the graph model in its own
   library-free module.** *Confidence: high* — the gates, the ownership semantics and the graph semantics were measured in
both target browsers this run, and the cost in Chromium [M5][M6][M8][M9][M11].
   Feeds the **architecture spine** as a component decision, and closes research-plan R6.
2. **Treat the cycle check, orphan marking and the "which Steps feed the Result" walk as model
   code, not canvas code.** *Confidence: high* — measured; it is 40 lines and it is what neither
   library provides [M8][M11]. Feeds the **Recipe format** and PRD FR-12.
3. **Design the Recipe as a plain node/edge list, with a linear pipeline as the trivial case.**
   *Confidence: medium* — this follows from the ownership finding [2][M7] rather than from a
   measurement of LLM authorship, which was out of scope. Feeds PRD FR-28 and the spike the
   research plan already names.
4. **Run the variable-height tripwire before building more than three Step kinds.**
   *Confidence: medium* — the risk rests on two issue-tracker findings from two codebases [7][8],
   not on a measurement of querbeet's own nodes. Feeds the **roadmap risk register**.
5. **Do not spend design effort on the editor's footprint.** *Confidence: high* — measured at
   0.3–2.9% of one source table [M9]. Confirms the research plan's instruction.
6. **Record that keyboard reachability was excluded from this selection.** PRD FR-12 states "The
   graph is navigable and editable by keyboard" and NFR-7 requires every pointer gesture to have a
   keyboard path. At the plan gate this was set aside as not a criterion (project decision, 2026-08-01).
*Confidence: not applicable — this records a decision, not a finding.* The hand-built path makes
it *cheaper* to add later than either library would, since every mutation is already a plain
function call on an app-owned model, but **FR-12 must not be assumed satisfied by this research.**

---

## Open questions

1. **Does the anchor geometry survive variable-height node bodies?** The single largest risk to
   the recommendation. *To answer:* run the tripwire named in "The reversibility hedge". Half a day.
2. **Nothing was measured above four nodes.** The PRD's range is 5–30. *To answer:* generate 30
   Steps in the existing probe and re-run it — the harness is in `imports/graph-probe/` and this is
   one loop, not a new setup.
3. **Auto-layout is unbuilt and unbenchmarked for every candidate.** Neither library ships it, and
   the ecosystem answer is dagre or elkjs — where `elkjs` defaults to a Web Worker and is licensed
   `EPL-2.0 OR GPL-3.0-or-later` [4]. If auto-layout enters scope, `@dagrejs/dagre` 3.0.0
   (2026-03-22, MIT) [4] is the candidate to check first, and it needs its own gate pass.
4. **Pointer gestures were never exercised.** Every mutation in the probe went through the
   programmatic API. Whether each candidate's hit targets are usable with a real pointer, and how
   connection dragging feels, is unmeasured.
5. **Is Vue Flow finished or is its maintainer stepping back?** Six months without a functional
   commit against 12 open issues and 300 closed reads as either [2]. This matters only if
   recommendation 1 is reversed. *To answer:* read the 12 open issues and any maintainer statement.
6. **No 6–12-month practitioner retrospective was found for either finalist**, across both
   screening lanes and four query formulations — and Reddit (r/vuejs, r/webdev) was inaccessible
   through the search tool this run, so the Vue-specific practitioner voice is missing entirely.
   **No verdict here should lean on real-world durability evidence, because there is none.**
7. **`@joint/core` 4.3.1 was never built.** MPL-2.0, zero dependencies, no runtime assets, the
   freshest release in the field [4][6] — screened out because HTML node bodies via `foreignObject`
   could not be confirmed and there is no first-party Vue 3 binding. If the recommendation is
   reversed *and* Vue Flow's maintenance question resolves badly, this is where to look next.
8. **The LLM Recipe spike (PRD FR-28) is out of scope by design** — the research plan itself marks
   it as a spike, not research. It remains open and is now unblocked, since the Recipe shape this
   report recommends is a plain node/edge list.

---

## Source appendix

Sources marked **[M*]** are measurements produced by this run rather than retrieved; their raw
data is in `imports/`.

| # | Claim / finding it supports | Publisher | Pub date | Accessed | Confidence |
| --- | --- | --- | --- | --- | --- |
| [1] | Vue Flow is MIT with no paid tier, no runtime key; React Flow Pro mentioned only as optional support | [vueflow.dev](https://vueflow.dev/) | undated page | 2026-08-01 | high |
| [2] | Vue-3-native field: versions, LICENCE contents, contributor concentration, repo metrics, commit history, add-on package ageing, VueWeave, Vue Flow ownership/`markRaw` docs, Baklava core-concepts | [npm registry](https://registry.npmjs.org/@vue-flow/core), [GitHub API](https://api.github.com/repos/bcakmakoglu/vue-flow), [vueflow.dev docs](https://vueflow.dev/guide/node.html), [baklavajs docs](https://raw.githubusercontent.com/newcat/baklavajs/master/docs/core-concepts.md) | 2025-11 – 2026-07 | 2026-08-01 | high |
| [3] | PRD Open Question 4: Vue 3 survives the graph-editor criterion | this run's build probe | 2026-08-01 | 2026-08-01 | high |
| [4] | Framework-agnostic field: Rete plugin versions and elkjs/web-worker peers, elkjs licence and worker files, Drawflow/LiteGraph/jsPlumb staleness, X6 tarball contents and Vue shape, maxGraph CSS `.gif` references, `@joint/core` vs `jointjs`, GoJS licence field, dagre | [npm registry](https://registry.npmjs.org/), [retejs.org docs](https://retejs.org/docs/guides/renderers/vue) | 2023-07 – 2026-07 | 2026-08-01 | high |
| [5] | jsPlumb Community is unmaintained; "This repository no longer receives updates"; Toolkit "is not a public project" | [GitHub jsPlumb](https://github.com/jsplumb/community-edition) | moved 2023-10 | 2026-08-01 | high |
| [6] | JointJS licence split: core MPL-2.0 free, JointJS+ commercial per-developer perpetual | [jointjs.com/license](https://www.jointjs.com/license) | undated page | 2026-08-01 | high |
| [7] | Vue Flow #174 "Wrong Handle position on nodes with dynamic height" | [GitHub bcakmakoglu/vue-flow](https://github.com/bcakmakoglu/vue-flow/issues/174) | 2022-06-06 → 2022-07-31 | 2026-08-01 | high |
| [8] | React Flow #3270 — a node disappears without an explicit width when content is dynamic | [GitHub xyflow/xyflow](https://github.com/xyflow/xyflow/issues/3270) | closed 2023-09-18 | 2026-08-01 | high |
| [9] | React Flow #656 — undo/redo, 53 comments, closed without the library owning it | [GitHub xyflow/xyflow](https://github.com/xyflow/xyflow/issues/656) | 2020-11-02 → 2022-02-22 | 2026-08-01 | high |
| [10] | React Flow #5 — auto-layout, 42 comments, punted to dagre/elkjs | [GitHub xyflow/xyflow](https://github.com/xyflow/xyflow/issues/5) | 2019-10-07 → 2021-03-07 | 2026-08-01 | high |
| [11] | React Flow performance literature is about >100-node graphs (#723 stress test, #2119 drag lag, RFC #4239 viewport virtualisation) | [GitHub xyflow/xyflow](https://github.com/xyflow/xyflow/issues/4239) | open since 2024-05-02 | 2026-08-01 | medium |
| [12] | Flyde's author budgeted for a WebGL/canvas rewrite and has not needed it — he adds that "one day WebGL/canvas might be required to take the editor to the next level", so this is true to date, not settled | [Hacker News](https://news.ycombinator.com/item?id=43834830) | 2025-04-29 | 2026-08-01 | medium (single account) |
| [13] | Vue Flow is an independent Vue 3 reimplementation, not xyflow code; its README credits React Flow as inspiration | [GitHub bcakmakoglu/vue-flow](https://github.com/bcakmakoglu/vue-flow) | repo state | 2026-08-01 | high |
| [M1] | Rete's four packages ship no LICENCE file; `@vue-flow/core`, `baklavajs`, `@baklavajs/core` and `@baklavajs/renderer-vue` — the four audited — do | `imports/npm-package-audit-2026-08-01.md` | 2026-08-01 | 2026-08-01 | high |
| [M3] | `rete-vue-plugin` 2.1.3 declares peer `vue "^2.6 \|\| ^3.2"` and resolves `vue-demi` | `imports/npm-package-audit-2026-08-01.md` | 2026-08-01 | 2026-08-01 | high |
| [M4] | Release recency and licence for 18 packages, read from the registry JSON API | `imports/npm-registry-2026-08-01.json` | 2026-08-01 | 2026-08-01 | high |
| [M5] | All three build to one file, contain no fetch hazard, and issue zero requests from `file://` in both engines | `imports/graph-probe-measurement-2026-08-01.md` | 2026-08-01 | 2026-08-01 | high |
| [M6] | No candidate proxies a frozen table in node data; `Object.freeze` is the protection | `imports/graph-probe/graph-probe-results.json` | 2026-08-01 | 2026-08-01 | high |
| [M7] | Vue Flow copies node wrapper objects while preserving payload identity | `imports/graph-probe/graph-probe-results.json` | 2026-08-01 | 2026-08-01 | high |
| [M8] | Cycle behaviour of all three candidates, including Baklava's unwired `containsCycle` | `imports/graph-probe/graph-probe-results.json` | 2026-08-01 | 2026-08-01 | high |
| [M9] | Editor heap cost 0.3–2.8 MB against ~94 MB for one source table | `imports/graph-probe/graph-probe-results.json` | 2026-08-01 | 2026-08-01 | high |
| [M10] | BaklavaJS's published renderer exports all 14 undo/redo, clipboard, subgraph, sidebar and toolbar symbols; Vue Flow's 69 exports contain none matching `hist\|undo\|redo\|clipboard\|subgraph\|cycle`. The probe additionally found `baklava.history` present at runtime — an existence check, not proof undo works | `imports/graph-probe/package-export-inspection.json`, `imports/graph-probe/graph-probe-results.json` | 2026-08-01 | 2026-08-01 | high |
| [M11] | The hand-built canvas is 164 lines for model + view | `imports/graph-probe/handbuilt/src/` | 2026-08-01 | 2026-08-01 | high |
| [M12] | `vue-flow-core.mjs` 1.48.2 contains 0 occurrences of `cycle`, `Cycle`, `acyclic` and `topological`; 37 of `isValidConnection` and 4 of `connectionExists`, neither traced | `imports/graph-probe/package-export-inspection.json` | 2026-08-01 | 2026-08-01 | high |
| [M13] | `sortTopologically` and `containsCycle` are declared in `@baklavajs/engine`'s type definitions, `sortTopologically` documented there as Kahn's algorithm — a declaration reading, never exercised by the probe | `@baklavajs/engine/dist/topologicalSorting.d.ts` (published package) | 2026-08-01 | 2026-08-01 | medium |

## Verification note

Validation level `normal`: load-bearing claims spot-checked, everything else cited with confidence
marked. A **fresh-context verifier** then re-derived every measured figure from the artefacts on
disk, recomputed the decision matrix, and re-read the priority web citations. It found real errors,
and they are corrected above rather than argued with:

- **Every figure in the cost table disagreed with the artefact it cited.** The probe had been run
  three times while its cycle assertions were being fixed, each run overwriting
  `graph-probe-results.json`; the measurement note had been written from the *first* run and the
  report quoted it while citing the *last*. The probe was re-run once more as a single clean pass,
  and the cost table, the percentages, the built sizes and the mount range are now read from that
  one run. Structural results — gates, identity, cycle behaviour, node kinds — were identical
  across all runs; only heap deltas and timings moved, which is why they are now presented as
  order-of-magnitude with the variance stated.
- **Two claims cited a measurement that did not contain them.** "Vue Flow ships no cycle detection"
  rested on a `note:` string the probe author had typed into the probe source, and Baklava's
  topological sort had never been exercised. The first is now backed by a literal identifier search
  of the published bundle [M12]; the second is labelled as a type-declaration reading [M13].
- **The clipboard/subgraph/toolbar comparison had no artefact.** It now has one:
  `imports/graph-probe/package-export-inspection.json` [M10].
- **Both matrix sensitivity thresholds were wrong** — 47% not ~40% for interaction surface, and the
  ecosystem claim pointed in the opposite direction to the matrix's own scores. Recomputed above.
- **Smaller corrections:** the built-size spread between the two libraries is 49 KB, not 150 KB;
  "years of bugs" overstated two issues that each lived under two months; "the same bug" became
  "the same failure family"; the frozen-rows assertion covers the array and row 0, not all 100,000
  rows; Vue Flow's last functional commit is 2026-01-23, not 2026-01-28; and the provenance claim
  about Vue Flow not being xyflow code was citing an unrelated issue and now cites the repository
  [13].

The verifier confirmed, unchanged: all `[M4]` registry figures, all `[M5]` gate results, all `[M6]`
ownership assertions, `[M7]`, Baklava's measured cycle behaviour, `[M11]`'s line counts, the three
matrix totals and the 100% weight sum, and web citations [1], [5], [6], [7], [8], [12] and the
repository metrics in [2].

**17 claims in the ledger, 17 verified, 0 unverified, 0 disputed** (`recon_kit.py tally`).

Two limits on this report's confidence remain, both structural rather than fixable within budget:
**no 6–12-month practitioner retrospective exists for either finalist** that two independent search
lanes could find, and **every measurement is at three-to-four nodes with fixed-height bodies**.

## Staleness map

Computed with `recon_kit.py staleness` against the technical pack's freshness bars
(versions/compatibility 1 month, ecosystem 6 months, architecture and performance 12 months,
patterns 24 months). Zero claims are stale today.

| Re-check by | Claims |
| --- | --- |
| **2026-09-01** | Vue Flow 1.48.2 / Baklava 2.8.1 are still latest · both licences unchanged · Rete still ships no LICENCE file · Drawflow / LiteGraph / jsPlumb still stale, GoJS still commercial · the node-measurement pattern claim |
| 2027-02-01 | Vue Flow's and Baklava's commit activity · both still single-maintainer |
| 2027-08-01 | The `file://` gate results · G5 ownership semantics · cycle behaviour · heap costs · the 164-line figure |

**Earliest re-check: 2026-09-01** — one month, driven by the version and licence classes. As a
selection report this should be refreshed before anyone acts on it if more than two quarters pass.
The cheapest refresh is `imports/npm-registry-2026-08-01.json` regenerated and diffed.
