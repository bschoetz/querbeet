---
title: 'Story 6e — Node layout from measured cards, not from a constant'
type: 'bugfix'
created: '2026-08-04'
status: 'done'
review_loop_iteration: 2
baseline_commit: '93bcc8c499bab04a68c767d2ed094ef00bb7bb01'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `PLACEMENT.dy` is a fixed row pitch and a Step card has no fixed height, so two nodes in one column overlap as soon as a card grows past 200 px — and the upper card then swallows the pointer aimed at the lower one's controls (measured in story 6b: at the old 150 px pitch, Playwright reported the upper card intercepting the lower card's `Ergebnis` button). The pitch clears every card *this* build renders, but by arithmetic over today's tallest card rather than by measurement, and a card grows at runtime from a button inside itself: every `Eingang hinzufügen` adds a slot row and every Diagnostic adds a mark line.

**Approach:** The guarantee moves from the constant to a **reflow pass in the Vue Flow adapter**, driven by the dimensions the library already measures for its own anchor arithmetic. When a card's measured size changes, the adapter recomputes an overlap-free layout and reports the nodes that must move through the `move` event the port already has — so the model keeps owning positions, `core/graph/` stays browser-free (AD-2), and `ui/` needs no change at all. `PLACEMENT` keeps its numbers and stops being load-bearing: it is the opening guess, the reflow is the promise.

## Boundaries & Constraints

**Always:**

- **The arithmetic is a pure function in `adapters/vueflow/canvas-logic.js`** — no Vue import, no DOM — for the reason that file's own header states: it is the only envelope that can unit-test canvas logic, since an SFC falls between the two Vitest projects.
- **The reflow is idempotent and deterministic.** Running it over its own output produces no moves, and the result does not depend on the order the nodes arrive in. Without idempotence the library's `forceUpdate: true` dimension reports (`vue-flow-core.mjs:9502,9645`) become a loop.
- **Nodes move down, never sideways.** The horizontal position carries the column semantics `freePosition` puts there.
- **A node the library has not measured is neither moved nor an obstacle.** Vue Flow leaves `dimensions` at `{width: 0, height: 0}` until the ResizeObserver reports (`vue-flow-core.mjs:6321`); reflowing against a zero box would stack every node on the first frame.
- **Every emitted position is two finite numbers** — `moveNode` throws on anything else (`core/graph/graph.js:285`).
- The reflow reports through the existing `move` event and nothing else. `applyDefault: false` stands: the adapter never writes positions into the library's store (`GraphCanvas.vue` rule 1).
- No German word enters `adapters/`; the reflow is silent and announces nothing.

**Ask First:**

- Widening the `GraphView` port — publishing measured dimensions to `ui/`, or adding an event beside `move`.
- Any change to `freePosition` or the `PLACEMENT` numbers themselves.
- Making the reflow run on user drags.

**Never:**

- No graph auto-layout. The architecture's Deferred list keeps that item; this story resolves overlaps and arranges nothing.
- No measurement inside `core/` and no dimensions on a graph node (AD-2, AD-6).
- No `getBoundingClientRect` in the reflow path — the library's `offsetWidth`/`offsetHeight` are unscaled layout pixels, in the same space as `position`, and a client rect is not.
- No reflow driven by position changes. ~~A card the user deliberately drags onto another stays where it was put.~~ **The second half was renegotiated by the project owner on 2026-08-04**, after review reproduced it as false: it holds at the moment of the drop and not afterwards. The operative rule is about the trigger. See the change-log entry below.
- No z-index, no collapsing, no card-height cap as a workaround.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Already clear | Two nodes in one column, 200 px apart, both 150 px tall | No moves | N/A |
| A card grew | Upper node 260 px tall at y=40, lower at y=240 | The lower node moves to y = 40 + 260 + gap | N/A |
| Cascade | Three stacked nodes, the top one grows past both | Both lower nodes move, in order, each clear of the one above | N/A |
| Idempotent | The output of any case above, fed back in | No moves | N/A |
| Order-independent | The same nodes in reversed array order | The same result | N/A |
| Different columns | Two tall nodes whose x-intervals do not intersect | No moves — vertical overlap alone is not overlap | N/A |
| Unmeasured node | A node with `width: 0` or `height: 0` | Not moved, and not an obstacle to anything else | N/A |
| Nothing to do | Empty list, one node | No moves | N/A |

</frozen-after-approval>

## Code Map

- `adapters/vueflow/canvas-logic.js:141-146` — `positionChanges`, whose comment already says `dimensions` changes are the library's own measurement. `:160-182` `VIEW_MARGIN`/`panShortfall` is the shape to follow for a new exported layout constant plus a pure geometry function. The new `reflowMoves` and the dimension-change predicate go here.
- `adapters/vueflow/GraphCanvas.vue:145-155` — `onNodesChange`, the one place changes are read; `dimensions` currently falls through unread. `:57-73` the `useVueFlow()` destructure (rule 4 — resolved in `setup` and nowhere else) is where `getNodes` joins. `:120-134` the projection watcher, whose comment records that `setNodes` merges, so measured dimensions survive re-projection.
- `core/graph/graph.js:551-604` — `PLACEMENT` and `freePosition`. The doc comment at `:553-573` states the standing limitation and points at the ledger; that paragraph is what this story rewrites. **The numbers and the function stay.**
- `core/graph/graph.js:284-291` — `moveNode`, which throws on a non-finite position and refuses an unknown id with `graph.unknown_step`.
- `ui/EditorPane.vue:335-340` — `onMove` → `fromCanvas` → `graph.moveStep`. A refusal naming an id that has since gone is already treated as a race and stays quiet. **No edit here.**
- `ui/StepCard.vue:143-219` — what makes a card grow: one `<li>` per Diagnostic and one per input slot, plus the `Eingang hinzufügen` button that adds a slot from inside the card.
- `core/graph/kinds.js:51` — Union is `maxInputs: Infinity`, so it is the kind an e2e case can grow at will.
- `node_modules/@vue-flow/core/dist/vue-flow-core.mjs:6305-6342` — `updateNodeDimensions`: it assigns `node.dimensions` **directly** and then triggers `nodesChange` with `type: 'dimensions'`, so the measurement is in the store under `applyDefault: false` too. `:3500-3505` `getDimensions` is `offsetWidth`/`offsetHeight`. `:9781-9792` the per-node ResizeObserver.
- `adapters/vueflow/canvas-logic.test.js:23` `rect()` and `:212-235` `describe('the shortfall pan')` — the fixture style for a pure geometry case.
- `tests/e2e/step-graph.spec.js:41-83` — `toEditor`, `card`, `wrapper`, and the `data-fitted` wait every geometry assertion goes through; `:96-104` `dragOnto`; `:113-118` `isInside`.
- `_bmad-output/implementation-artifacts/deferred-work.md:47-49` — the `PLACEMENT` entry with the measurements (151 px, 187 px, 37 px of overlap), to be closed by this story.

## Tasks & Acceptance

**Execution:**

- [x] `adapters/vueflow/canvas-logic.js` -- add `LAYOUT` (the vertical clearance), `hasDimensionChange(changes)`, and `reflowMoves(nodes)` returning a frozen list of `{id, x, y}` for the nodes that must move -- the arithmetic belongs in the only file of this adapter a unit test can reach
- [x] `adapters/vueflow/GraphCanvas.vue` -- read `getNodes` in the `setup` destructure, run the reflow once per microtask when `onNodesChange` carries a dimension change, and emit `move` for each result -- one reader in, one event out, and no second writer into the library's store
- [x] `core/graph/graph.js` -- rewrite the `PLACEMENT` doc comment: the pitch is the opening guess and the adapter's reflow is the guarantee; keep the numbers and `freePosition` untouched -- a comment that still names the limitation as standing would be the only thing in the tree lying about it
- [x] `adapters/vueflow/canvas-logic.test.js` -- a `describe` per new export, covering every I/O matrix row, plus one case asserting that a bounded number of passes settles a deep cascade -- the matrix is where the coverage comes from
- [x] `tests/e2e/step-graph.spec.js` -- one case: two Unions from the toolbar, grow the upper one with `Eingang hinzufügen` until it exceeds the pitch, then assert the two boxes do not intersect **and** that the lower card's `Ergebnis` button takes an ordinary click -- happy-dom has no ResizeObserver, so this is the only envelope that measures anything
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- close the `PLACEMENT` entry, naming what replaced it and what it deliberately did not do (auto-layout stays deferred) -- the ledger is how the next story finds out this is settled

**Acceptance Criteria:**

- Given two Steps stacked in one column, when the upper one grows past the row pitch, then the lower one moves down until it is clear and its controls take a click that previously landed on the card above.
- Given a card that shrinks again, when its dimensions are reported, then nothing moves back up — the reflow only ever resolves an overlap, so a layout the user is looking at never rearranges itself out from under them.
- Given a Step dragged deliberately on top of another, when the pointer is released, then both stay exactly where the user put them.
- Given `npx vitest run --project core`, when it runs, then the new `canvas-logic` cases are green and no test in `core/graph/` changed.
- Given `npm run verify`, when it runs, then lint, both Vitest projects and Playwright in Chromium and Firefox are green.

## Spec Change Log

**2026-08-04 — the owner resolved one `Never` that had two readings, and the review round it came out of.** Three context-free reviewers ran against the diff; eighteen findings after dedup, one of them an intent gap.

**The intent gap.** „No reflow driven by position changes: a card the user deliberately drags onto another stays where it was put" is two rules, and only the first was built. The pass is graph-wide and stateless, so it separates a user-made overlap at the next measurement anywhere in the graph. Two reviewers reproduced it independently against the built artefact: a Filter dropped on a Source at y=63.7 sits at y=157 after three slot rows are added to an **unrelated** Union, and equally after a plain switch to Quellen and back. Three texts asserted the opposite — the frozen `Never`, the comment in `GraphCanvas.vue`, and the ledger entry this story closed. **Put to the project owner and decided for the trigger reading:** the operative rule is that no gesture starts a pass; an overlap the user made is not preserved, because preserving it would mean keeping the last settled layout in order to tell "the user put it there" from "a card just grew into it", and the overlap it would preserve is the swallowed pointer this story exists to close. Acceptance criterion 3 stays true as written — *when the pointer is released* — and is now read as being about the release. **Not reverted before re-deriving,** also the owner's call: fifteen of the eighteen findings were independent of this decision, and the code under either reading shares everything but one function's contract.

**KEEP across any re-derivation:** the split that positions come from `props.nodes` and only the measurement from the library's store; the three properties `reflowMoves` is written for (idempotent, deterministic, down-only) and the tests that pin them; and the rule that a test for this mechanism must be shown to go red with the mechanism removed.

| # | What was false or missing | Where it is fixed |
| --- | --- | --- |
| P1 | The e2e case for the drag rule asserted only the moment of the drop, so it stayed green with `armReflow()` deleted — the exact failure this file's own header warns about for the focus pull. | Rewritten as both halves: the drop changes nothing, then an unrelated card grows and the pair is separated. **Probed: 6 failures across 3 cases and 2 engines with `armReflow()` removed.** |
| P2 | Nothing exercised the reflow at a zoom other than 1, where `offsetWidth` and a client rect are numerically identical — so the story's own `Never` about the measurement space was enforced by a comment. `fitView({ maxZoom: 1 })` zooms *out*, so zoom < 1 is ordinary. | A second e2e case zooms out before growing the card. **Probed: swapping the measurement for a scaled source fails that case in both engines and nothing else.** |
| P3 | `reflow()` read positions out of the library's store. Vue Flow assigns `node.position` itself on its clamp path, so this made it an inbound writer of model state — the mirror of the rule that keeps this file from writing into it. | Positions come from `props.nodes`; only `dimensions` comes from the store. |
| P4 | `LAYOUT.gap` and `PLACEMENT.dy` were documented as independent. They are not: the bound is `gap <= dy - the tallest card`, so with 200 and 24 any card over 176 px makes the pass nudge the grid the model just placed on — an 11 px shove for the 187 px card story 6b measured. | Stated in `LAYOUT`'s comment with the numbers, and pinned by a test that asserts the nudge rather than pretending it does not happen. |
| P5 | The convergence argument lived in a doc comment; the "deep cascade" case was one arrangement that happens to settle, not a check that the loop converged. | A case over 60 deterministic arrangements asserting the result is pairwise clear and produces no second move. |
| P6 | Acceptance criterion 2 — a card that shrinks pulls nothing back up — had no test anywhere. | Its own case. |
| P7 | `clear()` applies the gap vertically only, which was neither stated nor tested; two columns that exactly touch count as clear. | Stated in `LAYOUT` and in `clear`, and given a case. |
| P8 | The reflow moves Source nodes exactly like Steps and nothing said so — no comment, no test. | Named in `GraphCanvas.vue` (with why `moveStep` takes a Source where `removeStep` refuses one) and given a case. |
| P9 | The unit fixture called a card 256 px after `ui/StepCard.vue`'s `w-64`. What the library measures is the node **wrapper**, measured at 282 px in the built artefact — so the column-independence case was checking a 64 px gutter where 38 px ships. | Fixture corrected to 282 with the distinction written down. |
| P10 | `node.dimensions.width` was dereferenced before `measured()` could refuse it, so a store node without dimensions would throw inside a `queueMicrotask` callback with no handler above it. | Optional chaining at the mapping; `measured()` refuses `undefined`, with a case. |
| P11 | German identifiers (`oben`, `unten`, `quelle`, `zwei`, `eins`, `ungemessen`) entered `adapters/vueflow/canvas-logic.test.js`, against this spec's own Always list — a directory that had contained none. | Renamed. |
| P12 | The e2e clearance assertion tolerated a one-pixel overlap and said nothing about which coordinate space it was in. | Tolerance removed, and the choice of screen space written down: it is the question the pointer asks, and it is the same question at any zoom. |
| P13 | The `O(n³)` worst case and the fact that the pass runs on measurements that changed nothing were unstated, in a file whose neighbouring comments quote measured milliseconds. | Both stated, with what bounds `n` and what would have to be measured if that stopped holding. |

**Deferred rather than fixed** (both in `deferred-work.md`): a node the reflow moves can leave the fitted viewport with no pan after it, and a cascade of `k` moves is `k` model mutations where the port shape says a move is one node. **Rejected:** a guard on a non-finite `gap` argument (internal-only, and `moveNode` already throws loudly), a pointer gate on the pass (the trigger cannot fire during a gesture — measured, and the drag case asserts it), and the untested `disposed` branch (the reviewer probed it and could not establish a regression from removing it).

**2026-08-04 — review round 2, run because the round-1 fixes were never themselves reviewed.** 274 lines had changed after the reviewers saw the diff; the same three ran again against only those lines. **The finding that mattered: the round-1 fix for P5 did not fix P5.** Measured by a reviewer rather than argued — with `reflowMoves`'s inner bound clamped to two passes per node, the entire tree stayed green, and four coincident cards came out with two of them exactly on top of each other. The 60-arrangement case was 60 samples of *one shape*: a grid of distinct cells, where every node settles in a single move, so the loop it was written to exercise never ran.

| # | What was false or missing | Where it is fixed |
| --- | --- | --- |
| Q1 | The 60-arrangement generator never worked the loop, so the convergence claim was still pinned by exactly one fixture. | The generator now stacks cards under a **roof** taller than the pitch and at coincident points, which is what makes a node land on something it did not first hit. Plus three explicit cases: three-under-a-roof, four coincident cards, and the cross-column one below. |
| Q2 | `reflowMoves` had no post-condition: if the bound were ever wrong the loop fell out with the node still overlapping and took idempotence with it. | A guard after the loop places the node below every settled bottom, which is clear by construction. **It also made the bound untestable inside one column** — the guard lands on the same answer there — so the case that discriminates puts a very tall card in the neighbouring column, where "below what I hit" and "below everything" part company. Probed: `pass <= 1` fails exactly that case. |
| Q3 | The 282 px fixture width was right and its stated reason was false: it is `content-box` plus `px-3` plus the border, not the wrapper and the handles — which are `position: absolute` and contribute nothing. The comment mispredicted change in both directions. | Corrected, measured, with what moves the number and what does not. |
| Q4 | „raising this number past 50 would have the emptiest possible graph reflow itself on mount" — wrong. Measured: a Source card is 39 px (93 with an orphan mark), so the empty graph survives a gap of 161 (107 with marks). The 50 was borrowed from story 6b's 151 px Filter. | Replaced with the measured numbers. |
| Q5 | The `gap <= dy - tallest card` bound was framed as a threshold cards mostly sit under. Measured: a bare Union is 177 px and a Union with one added slot row **203 — taller than `dy` itself**, so for a card the user can grow the bound has no solution. And the nudge is not a corner case: on two Sources plus a Union, the Filter added next is placed at (360, 240) and renders at (360, 267). | Rewritten with those measurements, and the honest reading stated: the grid is an opening guess whose spacing this constant overrides, not a spacing the two agree on. |
| Q6 | `O(n³)` was given as "the cost" — the loosest bound, in a file whose convention is measured numbers — and "`n` is bounded by what a person can hold in a graph" is a belief about users, not a property (nothing in `core/graph/` caps the node count). | `O(n²)` per report named as the shape that occurs, `O(n³)` as the loose worst case, no measurement claimed where none was taken, and the belief removed. |
| Q7 | The clamp-path citation justifying the P3 split rests on `clampPosition`, which fires from `node.extent` / `nodeExtent` — neither of which this application sets. The change is right on ownership grounds; as written it rested on dead code. Nor did it name the hazard it takes on. | Lines cited, the path stated as unreachable today, the change rested on ownership, and the new hazard named: clearance now comes from the model while the library renders from its store, and only Playwright could see a drift. |
| Q8 | `pairwiseClear` is `clear` restated, so it can only ever catch non-convergence — never a wrong definition of "clear". Its comment sold it as checking the promise. | Comment says what it cannot catch and points at the explicit cases that pin the definition. |
| Q9 | No test constructed a **partial** horizontal overlap — the exact branch `clear`'s new comment was added to document — and its user-visible price was written down nowhere. | A case, plus the price stated in `clear`: a card dragged 20 px sideways is still the same column and is shoved a whole card height down. |
| Q10 | The P10 case would pass with `measured()` reduced to its `> 0` checks; `Number.isFinite` on the dimensions was unpinned, `width: Infinity` had no case, and four scenarios shared one `it` with no messages. | Split into two cases, one field per assertion, each with a message. |
| Q11 | The drag case depends on card heights nobody recorded: change them enough and the pass moves the Source instead, failing for an unrelated reason. | The ordering the case rests on is now asserted, with the reason. |
| Q12 | „and after a plain view switch" was claimed in a comment and covered by nothing — and re-entering the Editor is the more common way a user meets this. | Its own e2e case. |
| Q13 | The zoom case asserted `scale < 0.95` against a fit that already zooms out, so the wheel was never proven to do anything; and it did not check the two Unions share a column. | Both relative to the state before the wheel, plus the same-column assertion the other case already had. |
| Q14 | The 24 px was pinned only in unit fixtures — a pass leaving 1 px of clearance passed both e2e cases — in a story whose premise is that arithmetic over card heights is not measurement. | Observed on screen once, as `24 * zoom`, in the zoomed case. |
| Q15 | The two deferred entries interact and neither said so: never pulling back up plus never panning means a column drifts downward monotonically across a session. | Named in the first entry, which had claimed to be bounded. |
| Q16 | The layout is path-dependent — the positions depend on the order cards grew — and those positions are model state a Recipe will carry. Said nowhere. | Its own ledger entry, with the choice story 14 has to make. |

**Not fixed, and recorded as such:** the P3 split is an architectural rule with no test — a reviewer reverted it and could not construct an observable regression, since the library's own position writes are unreachable in this application. `moves a Source exactly like a Step` cannot discriminate (the pass has no notion of kind); its comment now says so, and the wiring is covered end to end instead. The `?.` in the box mapping guards a path a reviewer instrumented and measured at zero occurrences.

## Design Notes

**Why the adapter and not `ui/`.** The measurement exists only in the library's node store, so `ui/` could only reach it through a widened `GraphView` port — a second event or a dimensions prop, and then the same arithmetic one layer further from the numbers. The adapter already owns "absorb the library's hazards" (AD-19) and already has the seam for exactly this: `move` is on the port, `EditorPane.onMove` turns it into `moveStep`, and `ui/EditorPane.test.js` drives the pane through a stub canvas that emits it. So the whole story is two files in `adapters/vueflow/` plus a comment in `core/`.

**Why there is no pointer guard**, recorded because its absence looks like an omission. A reflow that moved a card out from under a pressed pointer would be the defect `createFocusGate` already exists to prevent. It cannot happen: the reflow is triggered by `type: 'dimensions'` changes only, a drag emits `type: 'position'`, and the library's ResizeObserver watches a node element's *box size* — dragging moves the element and resizes nothing. **What makes the argument complete is the trigger, not a list of growths.** A card grows from `Eingang hinzufügen` and equally from a mark appearing, which `connect`, `disconnect`, `configureStep`, `setResult` and `syncSources` can all cause — but every one of them is a command, and a command is dispatched from a `click` or a `change`, both of which land after the release. There is no path from a held pointer to a size change at all. Review round 2 asked for a `dragging` guard anyway; it is refused for the same reason the round-1 review refused the untested `disposed` branch its author could not make fire — a defensive branch guarding an unreachable path is a branch no test can hold honest.

**Why idempotence is the termination argument.** `updateNodeDimensions` is also called with `forceUpdate: true` from two watchers, which emits a `dimensions` change even when the size is unchanged. So the reflow must be expected to run on its own output, and "no overlap ⇒ no moves" is what keeps that from being a loop. The pass itself terminates for a separate reason: each node is placed against the already-settled ones and only ever moves to a strictly greater `y` drawn from a finite set, so the inner resolution is bounded by the settled count.

The shape, in the ~10 lines it is:

```js
const clear = (a, b, gap) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x ||          // different columns
  a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y
// nodes sorted by (y, x, id); the first is the anchor and never moves
for (const node of ordered) {
  const hit = settled.filter((s) => !clear(node, s, gap))
  if (hit.length) node.y = Math.max(...hit.map((s) => s.y + s.height)) + gap
  // re-check against `settled`, bounded by settled.length, then push
}
```

**What is deliberately not built.** Arranging a graph — the architecture's deferred "graph auto-layout" — is a different thing and stays deferred: this pass never chooses where a node belongs, it only refuses to leave two of them on top of each other.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green, including the new `canvas-logic` cases
- `npx vitest run --project ui` -- expected: green and unchanged; `ui/` is not edited by this story
- `npm run build && npm run assert` -- expected: one HTML file, structural gate green
- `npm run verify` -- expected: lint, both Vitest projects and Playwright in Chromium and Firefox green
- **Three mutation probes, if any of this is ever rewritten.** Measured 2026-08-04, all three re-run after review round 2. (1) Replace `armReflow()` in `GraphCanvas.vue`'s `onNodesChange` with a no-op: expected **8 failures**, four e2e cases in two engines. (2) Multiply the mapped `width`/`height` by `viewport.zoom`: expected **exactly the zoomed case**, in both engines. (3) Clamp `reflowMoves`'s inner bound to `pass <= 1`: expected exactly `moves a card as little as it must, not to the floor of the graph`. A test for this mechanism that survives its probe is not testing it — which is how round 2 found that the first version of the 60-arrangement case was green at `pass <= 1`.

**Manual checks (if no CLI):**

- In the built artefact: add two Unions, click `Eingang hinzufügen` on the upper one several times, and watch the lower card step down as the upper one grows. Then drag the lower card onto the upper one and release — it stays where it was dropped.

## Suggested Review Order

**The pass itself, which is the whole story**

- Entry point: the three properties it is written for, and what the contract rests on.
  [`canvas-logic.js:348`](../../adapters/vueflow/canvas-logic.js#L348)

- The guard that makes an overlapping result impossible by construction, not by argument.
  [`canvas-logic.js:369`](../../adapters/vueflow/canvas-logic.js#L369)

- What "not on top of each other" means, and what "down only" costs sideways.
  [`canvas-logic.js:299`](../../adapters/vueflow/canvas-logic.js#L299)

- The constant that overrides the grid's spacing rather than agreeing with it — measured.
  [`canvas-logic.js:265`](../../adapters/vueflow/canvas-logic.js#L265)

**What triggers it, and what it is allowed to read**

- Measurement is the only trigger; a drag reports positions and starts nothing.
  [`GraphCanvas.vue:153`](../../adapters/vueflow/GraphCanvas.vue#L153)

- Position from the model, size from the library — an ownership rule, with its own hazard named.
  [`GraphCanvas.vue:210`](../../adapters/vueflow/GraphCanvas.vue#L210)

- The rule the owner resolved: a trigger rule, not a promise that an overlap survives.
  [`GraphCanvas.vue:169`](../../adapters/vueflow/GraphCanvas.vue#L169)

**The constant that stopped being load-bearing**

- Same numbers, different job: an opening guess, with the promise named elsewhere.
  [`graph.js:576`](../../core/graph/graph.js#L576)

**The tests, each shown to fail with what it tests removed**

- The only case that can tell the pass loop from the guard after it.
  [`canvas-logic.test.js:400`](../../adapters/vueflow/canvas-logic.test.js#L400)

- Arrangements that actually work the loop — the first version never did.
  [`canvas-logic.test.js:429`](../../adapters/vueflow/canvas-logic.test.js#L429)

- Both halves in one case, because either alone survives the mechanism's removal.
  [`step-graph.spec.js:609`](../../tests/e2e/step-graph.spec.js#L609)

- The path a user meets more often than growth: leave the Editor and come back.
  [`step-graph.spec.js:682`](../../tests/e2e/step-graph.spec.js#L682)

- The only case that can see the measurement space, and the only one that observes the 24 px.
  [`step-graph.spec.js:720`](../../tests/e2e/step-graph.spec.js#L720)

- The price of "down only", asserted instead of glossed over.
  [`canvas-logic.test.js:488`](../../adapters/vueflow/canvas-logic.test.js#L488)
