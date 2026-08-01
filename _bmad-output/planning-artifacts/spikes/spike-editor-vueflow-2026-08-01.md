# Spike: the Vue Flow Editor — four questions, one build

**Status:** [x] done, 2026-08-01 — all four questions pass in Chromium 151 and Firefox 153
**Created:** 2026-08-01, after R6 and the project decision for Vue Flow 1.48.2
**Kind:** spike, not research. The outcome is working code plus four answers, not a report.
**Results:** `editor-vueflow-2026-08-01/findings.md` · code in `editor-vueflow-2026-08-01/app/`

---

## Why this exists

R6 chose Vue Flow over a hand-built canvas. That decision closed the selection question and opened
four implementation questions, each small on its own and all needing the same artefact. Building
them separately would mean building the editor four times.

**Read first:** `_bmad-output/planning-artifacts/research/technical-node-graph-pipeline-editor-2026-08-01/research.md`,
section **"Adopting Vue Flow — what the measurements require"**. It states the consequences this
spike has to discharge, each tied to a measurement.

**Start from:** `.../technical-node-graph-pipeline-editor-2026-08-01/imports/graph-probe/vueflow/`.
That is a working Vite single-file build with three node kinds, two connections and a frozen
100k × 20 table already flowing through it. This spike grows that probe into the real Editor
skeleton; it does not start from an empty directory.

---

## The four questions

### Q1 — Do connection anchors survive variable-height node bodies?

**The risk R6 named as the strongest argument against its own verdict.** Vue Flow #174 and React
Flow #3270 are the same failure family — anchor positions depend on asynchronously measured DOM
geometry — and R6's probe used fixed-height nodes, so it never touched this.

Build the **Union and Join** Step bodies, the two with the most configuration and therefore the
most height. Change a body's height at runtime (add a mapping row, add a join key) and confirm the
edges follow.

**Pass:** anchors track the height change without a manual re-measure call.
**Fail:** if the fix is not obviously small, this is the moment the hand-built canvas comes back —
R6's matrix has it at 85 against Vue Flow's 75, so reverting is a decision, not a defeat.

### Q2 — Is the cycle guard actually in front of every mutation?

Vue Flow's bundle contains **zero** cycle detection, and `addEdges` created a cycle silently in
R6's probe. PRD FR-12 requires refusal *with a named reason*.

Put the check in front of Vue Flow's mutation API, not beside it. The implementation already
exists: the 12-line forward walk in the R6 probe's `handbuilt/src/graph.js`.

**Pass:** a cycle is refused with a named reason on **both** paths — the pointer gesture *and* the
programmatic call. The programmatic one matters more: it is what the Recipe loader and FR-28's
model-authored Recipe use.

### Q3 — Which side owns the truth?

Vue Flow copies the node objects it is handed. Two coherent designs:

- **A:** Vue Flow's internal state is authoritative; the Recipe is derived from it.
- **B:** the app's model is authoritative; run with `applyDefault: false` and reconcile through
  `onNodesChange` / `onEdgesChange`.

Build one, and write down why. This is where the best-evidenced practitioner regret in the whole R6
sweep lands — the state-synchronisation cluster, of which #1630 is still open.

**Pass:** a decision recorded in the architecture notes, and an editor that round-trips a graph
edit without the two models drifting.

### Q4 — Does the Recipe format survive a round trip?

Serialize the graph to a Recipe and load it back. The R6 decision made this easier: Vue Flow's
model is already plain nodes and edges with `data` as an arbitrary object, so the Recipe maps
almost directly.

**Design rule:** a linear pipeline must be the trivial case — a graph where every node has one
input — so a model asked for something simple can answer simply.

**Pass:** save → clear → load reproduces the graph exactly, including Step names, which Step is the
Result, and per-kind configuration.
**Not in this spike:** having a language model actually author one. That is the separate FR-28
spike, which this unblocks.

---

## Constraints carried in — settled, do not re-litigate

| Fact | From |
| --- | --- |
| Freeze every dataset at the boundary; hold results in `shallowRef`. `markRaw` is unnecessary on a frozen array — Vue's reactivity skips non-extensible objects. | R2, R6 [M6] |
| Gate the build on "`dist/` contains exactly one file." Build success does not imply a working artefact on this path. | R2, confirmed R6 [M5] |
| Import any Web Worker as `./w.js?worker&inline`; classic worker from a blob URL. | R2 |
| Never render more than a ~50-row preview window. | R2, R4 |
| Vendor `@vue-flow/background` rather than depend on it (1 y 9 m without a release). | R6 [2] |
| Keep the graph model library-free — nodes, edges, cycle check, contributing-Steps walk. It is the exit from Vue Flow. | R6 |
| Orphan marking and the contributing-Steps walk are ours; no library in the field provides them. | R6 |
| Row height is a load-bearing constant, not styling: ~32 px maximum at half a million rows in Firefox. | R4 |

---

## Explicitly out of scope

- **Auto-layout.** Neither library ships it. If it enters scope later, `@dagrejs/dagre` 3.0.0 is
  the first candidate and needs its own `file://` gate pass — `elkjs` defaults to a Web Worker and
  is `EPL-2.0 OR GPL-3.0-or-later`.
- **Undo/redo.** Vue Flow ships none, and it was never in the hand-built line count either.
- **Keyboard reachability.** Excluded from the R6 selection by project decision. PRD FR-12 and
  NFR-7 are *not* satisfied and must not be assumed so — but this spike is not where that is fixed.
- **The transformation work itself.** Arquero is settled (R1); this spike is the Editor shell.

---

## Done when

One single-file build, opened from a real `file://` URL in Chromium and Firefox, in which:

1. three Step kinds render with their own configuration forms, at least two of them variable-height;
2. a cycle is refused with a named reason on both the pointer and the programmatic path;
3. the ownership design is chosen, written down, and demonstrated by a graph edit that round-trips;
4. the graph serializes to a Recipe and loads back exactly.

After that the Editor stops being a risk and becomes a construction site, and the FR-28 spike —
can a language model emit a valid Recipe from the documentation alone? — is unblocked.

---

## Outcome

All four, in one single-file build of 247,987 B, from a real `file://` URL, in both engines, with no
page errors and no requests beyond the document.

1. **Q1 pass.** Anchors track variable-height bodies with an offset change of 0 px (Chromium) /
   0.02 px (Firefox) across five height changes between −40.5 px and +81 px, including a newly
   created handle carrying a new edge. Zero `updateNodeInternals` calls in the app.
2. **Q2 pass.** Refused with a named reason on the pointer path, the programmatic path and the
   Recipe loader. Sharper than expected: under `applyDefault: false`, `addEdges` cannot mutate at
   all — it proposes a change nobody applies. R6 [M8] reconfirmed: it still runs no cycle check.
3. **Q3 decided: design B**, the model is authoritative. Five drift checks clean in both engines.
   The `:nodes` / `:edges` props turned out to be unusable for it — they are v-models.
4. **Q4 pass.** Byte-identical round trip, 1,309 B for a six-Step graph, no cell values by
   construction, seven named rejection classes, and `inputs: "u1"` as the linear shorthand.

Full measurements and the rules that follow: `editor-vueflow-2026-08-01/findings.md`.

---

## Where the plan stands around this

- **R6** done, decided: Vue Flow 1.48.2.
- **R9's gate** done: IndexedDB works from `file://` and survives a browser restart, so FR-25
  holds. Three consequences fell out — the shared `file://` bucket, the `persist()` deadlock in
  Firefox, and a projected Firefox write at half a million rows that lands on R3's tab-freeze
  threshold.
- **Next after this spike:** R5 (type and locale detection, with the ambiguity UX as the
  load-bearing part) and R4's D3/D4. R7 and R8 stay deferred — presentation layer, nothing blocks
  on them, and R8 has a plausible zero-library answer worth trying first.
