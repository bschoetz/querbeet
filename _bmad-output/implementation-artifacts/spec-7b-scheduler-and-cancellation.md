---
title: 'Story 7b — The scheduler: cancellation between Steps, progress, and a run with an identity'
type: 'feature'
created: '2026-08-04'
status: 'in-progress'
baseline_commit: '5002d2a'
review_loop_iteration: 1
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7a-per-step-cache.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Execution is one synchronous call that cannot be stopped, cannot report where it is, and cannot say which run produced what. `core/exec/execute.js:178` runs the whole walk in a single turn of the event loop, so the earliest edit of a 30-Step graph — measured at 578.6 ms in Chromium and 1,156 ms in Firefox — freezes the interface for that long with no progress, no cancel, and no way for a user who realizes mid-run that they configured the wrong Step to get out. Nothing in the product has a run identity: there is no id, no start time and no state anywhere, `runStatus` has no production caller, and the `Clock` port is declared at `ports/index.js:364-369` with no adapter behind it.

**Approach:** Keep the walk, change what drives it. The Step loop becomes a generator, and two drivers consume it: the existing synchronous `executeGraph`, unchanged for every current caller and test, and a new asynchronous scheduler that yields to the message queue between Steps, checks for cancellation at each yield, reports progress, and stamps every run with an id and a start time taken from the `Clock` port. Steps stay pure and synchronous — the yield point is the scheduler around them, never inside one.

## Boundaries & Constraints

**Always:**

- **One walk, two drivers.** The dependency-ordered Step loop exists once. A second copy of it would drift, and the sync driver is what keeps every existing test honest.
- **Cancellation is checked between Steps, and exit latency is one Step, not one chunk** (AD-9). The heaviest single Step is the 578.6/1,156 ms figure, and that is what the affordance is designed against.
- **The yield goes to the macrotask queue**, so a user's click on the cancel control is actually delivered before the next Step starts. A microtask yield is not a yield for this purpose.
- **The platform is named in an adapter, never in `core/`** (AD-1, AD-2). The scheduler receives a yield function and a clock as parameters; it constructs neither.
- **Steps stay pure and synchronous** (AD-4). No Step becomes `async`, a generator, or chunked. No row-range slicing of any kind — that is a separate rule with a per-kind prohibition and no story needs it yet.
- **A cancelled run never becomes what the user is looking at.** The pane keeps showing the previous execution; the Steps that completed survive in story 7a's cache, so nothing is recomputed on the next run, but a partial run is never presented as a result.
- **Only the newest run may publish.** A new run cancels the one in flight and an older run's completion is discarded — nine call sites reach `recompute()` and any of them can fire during a run.
- **Every run carries `{ id, startedAt }` from the `Clock` port** (AD-25), including a run that is refused at a gate.
- Execution stays on the main thread. Workers exist for the two exports only (AD-15).
- Progress is reported by Step, with the Step's id and the total from the walk's own length.
- The cancel control is a real focusable element (AD-30). A keyboard *shortcut*, if one exists at all, is scoped to an element and never to `document`.

**Ask First:**

- If yielding between Steps costs materially more than R4's measured 3.0 ms (Chromium) / 2 ms (Firefox) per cancellation round trip once measured against a real 30-Step graph in the built artefact, **HALT and report** — the whole design is licensed by that number being small.
- If `MessageChannel` turns out to be unavailable or clamped from `file://` in either engine, **HALT** rather than falling back to `setTimeout`. This project has been caught once by a platform behaving differently from `file://` than the documentation says (AD-9's `SharedArrayBuffer`), and a clamped fallback would silently make a 30-Step run slower than the unyielded one it replaces.

**Never:**

- No cache changes — 7a owns the cache, **it has shipped**, and this story only passes `cache` and `sourceKey` through to `executeGraph`. Do not re-key, re-bound or re-wrap anything in `core/exec/cache.js`, `cache-key.js` or `convert.js`.
- No execution mode, no row threshold, no stale mark, no explicit run action, and **no change to the interim recompute rule** at `ui/EditorPane.vue:77-89`: every data-affecting change still starts a run. 7c decides when a run should *not* start.
- No `SharedArrayBuffer`, no `Atomics`, no worker, no shared cancellation flag. `SharedArrayBuffer` is hidden from `file://` in both engines and a `typeof` check reports the opposite of the truth (AD-9).
- No `setTimeout` as the yield channel — after five nested timers both engines clamp to 4 ms, which at 30 Steps is over 100 ms of pure clamp.
- No fix for the Step-zero conversion that runs inside `ui/SourcesPane.vue`'s render path. The run's Step zero becomes cancellable here because it is a node in the walk; the pane's is the pane's, and the ledger entry says so after this story rather than pointing at a scheduler that does not exist.
- No run history, no persistence, no run status aggregation surface — story 12 owns CAP-34.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| A run completes | A confirmed chain, no interruption | The pane shows the new results; the run carries an id, a start time and state `complete` | N/A |
| A run is cancelled mid-walk | Cancel pressed while Step 4 of 12 is pending | The walk stops before Step 4 starts, state is `cancelled`, one German sentence names the cancellation, and the pane still shows the previous execution | N/A |
| A cancelled run's work is not lost | Steps 1–3 completed, then cancelled, then the same run requested again | Steps 1–3 are served from the cache and only Step 4 onward computes | N/A |
| An edit lands during a run | `configureStep` while a run is in flight | The in-flight run is cancelled, a new run starts, and only the new run's results are published | N/A |
| An older run finishes after a newer one started | The superseded run's promise resolves last | Its results are discarded; `execution` still holds the newest run's | N/A |
| A run is refused at a gate | An unconfirmed Source in the frontier | Refused exactly as today, synchronously visible, and the refusal still carries a run id and start time | N/A |
| A short run | A cached edit costing tens of milliseconds | No progress line and no cancel control appear at all — the band does not flicker | N/A |
| A long run | An uncached edit over a 30-Step graph | Progress names the Step and the position in the walk, and updates as the walk advances | N/A |
| A Step throws mid-run | `kind.apply` throws at Step 5 | The run continues exactly as today, records `exec.step_threw`, and finishes with state `complete` — a throw is a diagnostic, not a cancellation | Existing `try/catch` unchanged |
| The pane is unmounted mid-run | The user switches to Quellen while a run is in flight | The run is cancelled and nothing is published to a component that is gone | N/A |

</frozen-after-approval>

## Code Map

> **Re-verified against the tree on 2026-08-05, after story 7a shipped.** Every anchor below is current. The previous draft was written before 7a and its `core/exec/execute.js`, `ui/EditorPane.vue` and `ui/App.vue` line numbers were all stale — `executeGraph` alone moved from `:144` to `:178`. Anchors in files 7a did not touch (`ports/`, `core/diagnostics/`, `adapters/vueflow/`, `ui/graph-labels.js`) were checked and are unchanged.

**The walk, and the exact line that becomes the yield point:**

- `core/exec/execute.js:178` `executeGraph({ steps, resultId, engine, sourceTable, cache, sourceKey })` — plain synchronous `function`, no `async` and no promise anywhere in the file. **`cache` and `sourceKey` are 7a's and this story only passes them through.**
- `core/exec/execute.js:253` `for (const node of order)` — **this `for` head is the yield point and the cancellation-check point.** One iteration is one Step, so "exit latency is one Step" falls out of checking here, before the Source branch that follows it and before `kind.apply` at `:362`. **One thing 7a changed about this loop:** it is now also where content keys are computed and stored (`:269` the Source key, `:318-323` the Step key, `:404` the store). A yield placed carelessly lands *between a Step's key and its store* — pick the point deliberately, and note that a cancelled run must not leave a key in `keys` for a Step it never computed.
- `core/exec/execute.js:194-195` — `contributingTo` then `inDependencyOrder`; `order.length` is the natural progress denominator and the run identity is minted here.
- `core/exec/execute.js:197-214` — the gate loop runs over the whole order **before anything computes**, and `refused()` returns early at `:214`. A refusal must still carry the run identity, so the id is minted above this block. 7a's rule that the cache is neither read nor written above this line still holds.
- **`core/exec/execute.js:203-213` — the gate loop calls the converting door, and that is the anchor round 1 was missing.** `sourceTable(node.id) === null` is how gate 1 tests a Source's confirmation. In the pane that door is `ui/EditorPane.vue:183` `props.stepZero.of(entry)?.table`, and `core/exec/convert.js:307` runs `convertSource` on a miss — **the 548–555 ms measured in story 6a, per contributing Source.** A scheduler whose first `next()` drains the gates therefore pays every cold Step-zero conversion synchronously, before the walk's first yield exists. `core/exec/convert.js:283` already tests `entry.typing?.confirmed !== true` and returns `null` *before* converting, so the confirmation the gate wants is available without materialising a table. **The gate needs a predicate, not a table.**
- `core/exec/execute.js:129` `inDependencyOrder` — DFS post-order, returns a plain array. Unchanged by 7a and unchanged by this story.
- `core/exec/execute.js:413-430` — the epilogue: `exec.run_incomplete` computed from `results` at `:413-418`, then the frozen `{ ok, results: readOnlyMap(results), diagnostics }` at `:424-426`. **The return has no status field beyond `ok`** — this is where `run: { id, startedAt, state }` joins, and the shape decision is this story's.
- `core/exec/execute.js:77-87` `CODE` / `EXEC_CODES` — the frozen code table and the enumeration `ui/graph-labels.js:437-447` checks itself against. **A new code lands in both or the gap test checks nothing.** 7a minted no code, so this table is exactly what story 6b left.
- `core/exec/execute.js:39-58` — the in-code note about which gates are present and which are absent by design. Still true after this story; 7c takes gate 3.
- `core/exec/execute.js:221` `record(node, table, diagnostics)` — builds the frozen `{ kind, table, rowCount, columnCount, diagnostics }`. **It carries no key**, which is 7c's problem rather than this story's, but a `run` field added to the *return* must not be confused with a field on a result.

**Callers — the nine that become scheduler starts:**

- `ui/EditorPane.vue:180-189` `recompute()` — the sole production call site of `executeGraph`, **synchronous, fire-and-forget, awaited by nobody**. It now passes `cache: props.cache` and `sourceKey: keyOfSource` (7a). `:150` `execution = shallowRef({ ok:true, results:new Map(), diagnostics:[] })` is the value it swaps (AD-6: swapped wholesale, never made reactive). `:178` `keyOfSource` derives a Source's key through `stepZeroKey` — **it is contained and returns `null` rather than throwing**, which is what 7a's door contract rests on; a scheduler must not re-wrap it in something that changes that.
- `ui/EditorPane.vue:96` `runData(result, options)` = `run(result, options)` + `recompute()`. Reached from `:268` `onConnect`, `:390` `addStep`, and template `:513` set-result, `:515` disconnect, `:518` remove, `:537` configure. Plus `:368` `fromCanvasData` (→ `:374` `onRemove`, `:375` `onDisconnect`) and `:399-400` `watch(() => props.sources)` with `{ immediate: true }`, which fires on a typing confirmation.
- **Name collision, and it is a real one:** `ui/EditorPane.vue:68` already has a function called `run` — it is a *command* runner that publishes a refusal and refreshes the projection, nothing to do with an execution run. This story's concept must not be called `run` in that file.
- `ui/EditorPane.vue:229` `status` computed → the fixed-height status band at `:441-470` (`role="status"` at `:446`, testids `editor-refusal` at `:447` and `editor-status` at `:463`). **The `h-20` at `:441` is load-bearing and measured**: a growing region shrank the canvas from 405 px to 237 px in story 6b. A progress line and a cancel control have to fit that band, not extend it.
- `ui/EditorPane.vue:420` — the toolbar strip (`Pipeline` heading, one button per addable kind). The only other pane-level affordance row.
- `ui/App.vue:142-143` — `EditorPane` is `v-if`, so it is **genuinely unmounted** on a view switch, and `:73` states the reason in the file. A run in flight when the user leaves has to be cancelled by the component, or it publishes into a component that is gone. **7a made this line load-bearing twice over:** the same `v-if` is why the run cache lives in `App` rather than in the pane, so a scheduler owned by `EditorPane` is destroyed on a view switch while the cache it filled survives — which is exactly the split this story wants, and worth stating rather than rediscovering.

**Time and identity — declared, unimplemented:**

- `ports/index.js:364-369` — the `Clock` typedef exists and declares **`now()` only**. AD-25 says a run's id *and* its start time come from this port, so the port grows a second member here.
- `adapters/clock/` — **empty except `.gitkeep`. No Clock adapter exists.** `app/main.js:27-48` is the composition root (`createApp` at `:42`) and wires `store`, `graph`, `engine`, `canvas`; a clock is named here and threaded `App.vue` → `EditorPane.vue` exactly like `engine` (`ui/App.vue:31` the prop, `:147` the binding down to `EditorPane`). **7a set the precedent for how**: it made the run cache a prop with a `createRunCache()` default factory, and `ui/App.vue:41-48` records why — the production default has to be exercised by at least one test that mounts without the prop, or the whole thing can be deleted with a green suite.
- **No `Date.now`, no `performance.now`, no wall-clock `new Date` in any production file.** Every `new Date` is a fixed epoch or UTC arithmetic (`core/exec/convert.js:63`, `adapters/arquero/engine.js:273`, `core/types/typing.js:356,404,1528,1530`, `ui/cell-text.js:74`). The only `Date.now()` in the repo is a Playwright budget assertion at `tests/e2e/xlsx-parquet.spec.js:40`.
- **No id minting of any kind** — no `Math.random`, no `crypto.randomUUID`. Every id in the product is deterministic (`src:…`, `edgeId` at `core/graph/graph.js:114`).
- `core/diagnostics/diagnostic.js:21-27` — `{ severity, code, values, stepId?, sourceId? }`, no `runId`. `:72-81` `runStatus(diagnostics)` → `{ clean, counts, diagnostics }`, **zero production callers except `ui/StepPanel.vue:559`, which calls it per Step**. Do not change its signature; story 12 owns the run status.

**Async, yielding and progress — what exists to copy, and what does not exist at all:**

- **Nothing in `core/` is async outside the Source store's parse chain.** `execute.js`, `convert.js`, `core/steps/*`, `core/graph/*`, `core/types/*`, `core/view/row-window.js` are synchronous top to bottom.
- `core/exec/source-store.js:349` `serialize(id, work)` — a per-Source promise chain, tail-chained, the stored link never rejects. The repo's only in-flight-command precedent, and the model for "a second request supersedes the first".
- `adapters/vueflow/canvas-logic.js:99` `createRemovalRouter({ …, schedule = queueMicrotask })` with `arm()`/`flush()` — **the one injectable scheduler in the repo**, and `:99` states the reason in as many words: "`schedule` is injectable so a test can drive the flush without a clock." **This is the pattern for the yield.**
- `adapters/vueflow/GraphCanvas.vue:404-408` — `disposed = true` on unmount so a landed pass is dropped. The repo's only "abandon work scheduled by a component that is gone" precedent.
- **No `setTimeout`, no `MessageChannel`, no `requestIdleCallback`, no `postMessage`, no `Worker` anywhere** in `core/`, `adapters/`, `ui/` or `app/`. `TableWriter` at `ports/index.js:255-260` is a bare typedef with no adapter, so AD-15's export workers do not exist yet either. **The message-queue channel has nothing to reuse and is new code.**
- **No progress reporting of any kind** — no percentage, no counter, no ETA.

**The in-flight affordance to compose with:**

- `ui/SourcesPane.vue:706` `parsing = shallowRef({})` (id → control name), `:708` `isParsing(id, control)`, `:710` `reparse(id, control, run)` — sets the flag, awaits, clears in `finally` and refreshes. The ref is **swapped wholesale, never mutated in place** — the discipline a progress ref must follow. **7a added one thing to this function**: it captures what `run()` returned and withdraws the run cache only if something was actually committed, so a re-parse control given an unusable value no longer discards the cache. A progress affordance added here must not undo that gate.
- `ui/SourcesPane.vue:1071-1073` — the pending line: `role="status"`, `data-testid="parse-pending"`, `class="pb-1 text-xs text-slate-500"`, German „Datei wird neu gelesen …", rendered as a `v-if`/`v-else-if` pair so it **replaces** a sibling rather than adding height. `:976`, `:1000`, `:1022`, `:1059` — the disabled idiom is `:disabled="isParsing(...)"` plus `disabled:opacity-50`; there is no `.muted` class and no design-token file (`ui/style.css:14-29` is the whole of the app's own CSS).
- `ui/SourcesPane.vue:704` — the stated reason the affordance exists at all: a card that stays fully interactive and unchanged for a third of a second "invites a second click over the first."

**Keyboard and German:**

- `adapters/vueflow/GraphCanvas.vue:417-425` — the pane is `tabindex="-1"` and `@keydown` is **scoped to the pane element, never document-level**; `:290-299` gives the measured reason (the library's guard covers INPUT/SELECT/TEXTAREA but not BUTTON). A plain `<button>` is keyboard-reachable for free; a shortcut would have to be scoped the same way.
- `ui/graph-labels.js:186-397` `GERMAN` map (`exec.*` block at `:363-396`), `:76-88` the sentence helpers `q()`, `step(nameOf,id)`, `nf()`, `rows(n)`, `:437-447` `graphLabelGaps()`, `:452-457` `SEVERITY` tone classes. Every new code needs its sentence here.

**Tests:**

- `core/exec/execute.test.js:8-16` — real graph store, real engine by dynamic import (AD-1). **7a added three imports this story inherits**: `createRunCache`, and `canonical`/`forgetRefusals`/`keyOrNull`/`sourceKey`/`stepKey` from `cache-key.js`, plus a `beforeEach(forgetRefusals)` in the suites that assert the refusal warning. A new scheduler suite that touches keys needs the same reset or it passes on its position in the file.
- `ui/EditorPane.test.js:20` `StubCanvas` (renders the `#step` slot, declares the six emits), `:44` `stubEngine()`, `:50` `render()`, `:321` `countingEngine()`, `:337` `withEngine`, `:350` `wired()`. `describe('what recomputes and what does not')` opens at `:308` — **this block must still pass unchanged in substance: the interim rule is not this story's to change.** 7a added cache cases inside it that use the same helpers.
- `ui/App.test.js:135` `render(store, graph, engine, runCache)` — **new in 7a and the only `mount(App)` in the repo.** `:151` is the case that mounts with *no* cache prop, the way `app/main.js` does. A scheduler threaded from the composition root gets tested here, and the same rule applies: at least one case must exercise the production default rather than an injected stand-in. That hole was the top review finding in all three of 7a's rounds.
- **No test in the repo uses fake timers** — no `useFakeTimers`, no `vi.advanceTimers`. Async is handled with `await nextTick()` and, in two places, `flushPromises()` (`ui/SourcesPane.test.js:9,1484`). An injected yield is therefore both the architectural answer and the only testable one.
- `vitest.config.js:35-48` — happy-dom's `ResizeObserver` is an empty stub and `getBoundingClientRect` returns an all-zero rect. **A progress affordance must not depend on geometry** or it cannot be tested in the `ui` project.
- `playwright.config.js:19-30` — `file://` only, no `baseURL`, chromium and firefox. `tests/e2e/execution.spec.js:53-58,131` — locators by testid and German text (`toHaveText('10 Zeilen, 3 Spalten')`).

## Tasks & Acceptance

**Execution:**

- [x] `ports/index.js` -- give `Clock` a second member for minting a run identity beside `now()`, and add a `Yield` port whose single method resolves on the next turn of the macrotask queue; state in both that they exist so `core/` stays pure and browser-free -- ports move before implementations
- [x] `adapters/clock/clock.js` (new) + test -- the first inhabitant of an empty directory: `now()` and an id mint. Ids must be unique within a session and must not depend on `Math.random` being seeded any particular way -- AD-25's identity, named in an adapter
- [x] `adapters/scheduler/queue-yield.js` (new) + test -- a `MessageChannel`-backed yield, one port pair created once and reused, resolving a promise per turn; document why `setTimeout` is not it (the 4 ms clamp after five nested timers) -- AD-9's message queue, and the first one in the project
- [x] `core/exec/execute.js` + test -- extract the Step loop into a generator that yields once per node and returns the assembled result; keep `executeGraph` as the synchronous driver that drains it, unchanged in signature and behaviour; mint `{ id, startedAt }` above the gate loop and add `run: { id, startedAt, state }` to both the refused and the completed return -- one walk, two drivers, no drift
- [x] `core/exec/execute.js` + `ui/EditorPane.vue` + test -- **the gate must test confirmation without materialising a table.** Give the gate a predicate door beside `sourceTable` and have the pane supply it from the entry's own `typing.confirmed`; keep `sourceTable(id) === null` as the fallback when no predicate is passed, so every existing caller and test stays honest. A Source's conversion then happens at its node *inside* the walk, between two yields like every other Step -- refusal stays synchronous **and** Step zero becomes cancellable; round 1 satisfied only the first half
- [x] `core/exec/scheduler.test.js` -- a case with a counting `sourceTable` and a hand-driven yield asserting the count is **0** immediately after `startRun` returns -- the assertion that would have caught round 1, in the same shape as the existing `pending()` checks
- [x] `core/exec/scheduler.js` (new) + test -- `startRun({ ...executeGraph's arguments, clock, yieldNow, onProgress })` → `{ id, startedAt, cancel(), completed }`; drives the generator, awaits `yieldNow()` before each Step, checks the cancellation flag at each yield, calls `onProgress({ done, total, stepId })`, and resolves with state `complete` or `cancelled`; the flag is a plain closure variable on the same thread -- the scheduler is the yield point, the Steps are not
- [x] `core/exec/execute.js` -- one new code for a cancelled run in `CODE` and therefore in `EXEC_CODES` -- the enumeration is what makes the German gap test meaningful
- [x] `app/main.js` + `ui/App.vue` -- construct the clock and the yield in the composition root and thread them to `EditorPane` as props beside `engine` -- AD-1: one place names the adapter
- [x] `ui/EditorPane.vue` -- turn `recompute()` into a scheduler start under a name that does not collide with the existing command runner at `:68`; cancel the in-flight run before starting a new one; publish only the newest run's result; cancel on unmount; hold `{ done, total, stepId }` in a `shallowRef` swapped wholesale -- nine call sites become starts and every one of them can fire during a run
- [x] `ui/EditorPane.vue` -- the progress line and the cancel button inside the existing `h-20` band, `role="status"`, testids for both, appearing only once the run has outlived the reveal delay; the button is a real `<button>` with a German label -- the band's height is measured and must not grow
- [x] `ui/graph-labels.js` -- the German sentence for the cancellation code; `graphLabelGaps()` stays `[]` -- AD-13: `core/` emits the code, `ui/` writes the sentence
- [x] `core/exec/scheduler.test.js` + `ui/EditorPane.test.js` -- the matrix as cases, driving the injected yield by hand rather than with timers: cancel between Steps, completed Steps survive in the cache, an edit supersedes, an older run's late completion is discarded, a refusal still carries a run identity, unmount cancels, a throw is not a cancellation -- the repo has no fake timers and an injected yield is why it still does not need them
- [x] `tests/e2e/execution.spec.js` -- one case over the built artefact in both engines: start a run big enough to be noticed, press the cancel control, assert the German sentence and that the previous results are still what is shown -- `file://` is where the platform assumptions actually get tested
- [x] **Ten defects round 1 shipped, each one confirmed against the tree — none may recur:**
  1. `ui/EditorPane.vue` -- the progress callback read `handle` from its own temporal dead zone (`const handle = startRun({ onProgress: () => handle.startedAt })`). Read the start time from something that exists when the callback can fire; the scheduler's "never called synchronously" contract also needs a test that pins it
  2. `ui/graph-labels.js` -- `Von ${nf(total)} Steps` renders „Von 1 Steps"; the `done === 1` branch hard-coded `'1'` instead of `nf(1)`; only one of the three branches had a text assertion. All three need one, in `ui/StepCard.test.js`'s `graphText(...)` idiom
  3. `ui/graph-labels.js` + `ui/EditorPane.vue` -- the walk's `order` contains Source nodes, so progress rendered „Rechnet Step 1 von 46: „gross"" for a Quelle and the cancellation sentence counted Sources as Steps. `ui/graph-labels.js:34` establishes `source: 'Quelle'` and the German distinguishes them deliberately
  4. `adapters/scheduler/queue-yield.js` -- `next()` after `dispose()` posted on a closed port and never resolved; a test asserted the hang as the contract. A disposed yielder must resolve, not suspend the scheduler forever
  5. `ui/EditorPane.vue` -- the rejection handler rethrew inside a `.then` rejection callback, which is an unhandled promise rejection and never reaches Vue's `errorHandler` as its comment claimed. Fix the mechanism or the comment, and test the branch — round 1 tested neither
  6. `ui/EditorPane.vue` -- `startRun` can throw synchronously out of the gate door, and the `inFlight = null` cleanup existed only in the promise callbacks, leaving a dead handle behind the cancel control
  7. `core/exec/execute.js:417,455,362` + `core/exec/cache-key.js:364,399,417,427,431` -- seven comments describe `executeGraph` as running inside the pane's `watch`. After this story it has **no production caller at all**; say what it is instead — the parity surface that keeps the two drivers from drifting
  8. `ui/EditorPane.test.js` -- the superseded-run case drove an interleaving the FIFO yielder cannot produce and its comment called it real. Either construct one the adapter can produce or state plainly what the hand-driven yield is standing in for
  9. `adapters/clock/clock.js` -- the session prefix was `Date.now().toString(36)`, so two clocks constructed in the same millisecond emit identical id streams while the doc promised two sessions of the same file are distinguishable in a filed artifact. Make the claim true or make the claim smaller
  10. `tests/e2e/execution.spec.js` -- nothing asserted the `h-20` band's height or the canvas height with the progress row rendered, though the spec calls it measured and load-bearing (405 px → 237 px in story 6b). happy-dom returns an all-zero rect, so this assertion only exists in e2e
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- rewrite the open entry about the 548–555 ms Step-zero conversion in `ui/SourcesPane.vue`'s render path: the scheduler now exists, the run's Step zero is cancellable because it is a node in the walk, and what remains is the pane's own render-path call -- the entry must stop pointing at a story that has shipped

**Acceptance Criteria:**

- Given a run over a graph large enough to take several hundred milliseconds, when the cancel control is used, then the walk stops before the next Step begins, the run reports itself cancelled in German, and what the panel shows is still the previous run's output rather than a partial one.
- Given a run that was cancelled after three of twelve Steps, when the same run is requested again, then the three completed Steps are served from the cache and only the fourth onward computes.
- Given a run in flight, when a Step's configuration changes, then the in-flight run is cancelled and the results eventually shown are the new run's — the superseded run cannot publish even if it finishes last.
- Given a run in flight, when the user switches to the Quellen view, then the run is cancelled and nothing is published.
- Given a cached edit costing tens of milliseconds, when it runs, then neither the progress line nor the cancel control ever appears.
- Given a refused run, when a gate rejects it, then the refusal is what it is today and additionally carries the run's id and start time.
- Given a Step whose executor throws, when the run reaches it, then the run continues and completes — a throw is recorded as a diagnostic and is never reported as a cancellation.
- Given the interim recompute rule, when a Step is renamed or moved, then nothing runs at all — this story changes when a run *yields*, never when one *starts*.

## Spec Change Log

**2026-08-05 — review round 1: the story's central claim was false in code and in two artifacts. Reverted and re-planned.**

*The finding.* All three review layers found it independently and two demonstrated it with executed probes: `core/exec/execute.js`'s gate loop calls `sourceTable(node.id)` for every Source, the scheduler drains that gate in a synchronous first `next()`, and in the pane `sourceTable` is the converting door. So the first Step-zero conversion — 548–555 ms per contributing Source — ran uncancellable, unyielded and unreported, which is the exact failure this story exists to remove. The e2e case could not catch it because the Sources pane warms the conversion cache before the Editor mounts. Worse than the defect: the shipped Design Notes and the rewritten `deferred-work.md` entry both asserted the opposite, so the repo's own record would have carried a false closure.

*What was amended.* The Code Map gained the anchor round 1 lacked — the gate loop calls the converting door, and `core/exec/convert.js:283` already has the confirmation test that does not convert. A task adds a predicate door so refusal stays synchronous *and* the conversion moves to the Source node inside the walk, plus the counting-`sourceTable` case that pins it. The Design Notes stop claiming Step zero is free and now state what the reveal delay actually guarantees. Ten further defects confirmed against the tree are listed as a task block.

*The known-bad state this avoids.* A shipped scheduler whose first act is an uncancellable half-second, with two artifacts in the repo saying it is not.

*KEEP — round 1 got these right and re-derivation must not lose them:*

- **The yield is the first statement of the loop body**, before the node's key is minted and before its entry is stored, driven by `order.entries()` because the body `continue`s in four places. That is the deliberate choice epic 7's context warns about, and it was made correctly.
- **The Ask First is resolved and must not be re-litigated blindly.** Measured over `dist/index.html` from `file://`, 30 yields: `MessageChannel` 0.1–0.5 ms in Chromium (0.003 ms/yield) and 0–1 ms in Firefox; `setTimeout(…, 0)` 99.9–124.2 ms (3.33 ms/yield) and 110–122 ms (3.67 ms/yield). Two orders of magnitude below R4's 3.0/2 ms. `SharedArrayBuffer` is `undefined` from `file://` in both engines. Record these again rather than re-deriving them.
- **The clock and the yielder are required props with no default factory**, because a `ui/`-built microtask stand-in would pass every test and deliver no click. This is 7a's "a production default no test exercises can be deleted" lesson answered in the opposite direction, and deliberately.
- The pane's three-part discipline: cancel the in-flight run before starting another, a generation guard so only the newest publishes, and cancel on unmount.
- **Every mechanism was probed by mutation** — removing the cancellation check, the generation guard, the unmount cancel, the reveal delay or the cancelled-run guard, or moving the yield to the bottom of the loop body, each turned a test red. Keep that standard.
- The e2e shape: a chain long enough to still be walking, the cancel control taken **from the keyboard** (AD-30, and cheaper than a pointer race), and an assertion that the Result Step still reports the *previous* run's row count.
- A cancelled run resolves with no results at all and one `info` diagnostic carrying `{ done, total }` and no `stepId` — a mark on that Step's card would read as something wrong with the Step.

**2026-08-05 — story 7a shipped; this draft was written against the tree before it. Re-verified, not re-planned.**

Nothing in the frozen block changed: the intent, the boundaries and the matrix all survive 7a intact, because 7a deliberately did not touch what drives the walk. What changed is everything the Code Map pointed at.

*Anchors.* Every `core/exec/execute.js`, `ui/EditorPane.vue`, `ui/App.vue` and `ui/SourcesPane.vue` line number in this spec was stale — `executeGraph` moved from `:144` to `:178`, the Step loop from `:193` to `:253`, `recompute()` from `:156` to `:180`. All are re-derived above and were checked against the tree one by one. Anchors in files 7a did not touch were also checked and are unchanged.

*Four things 7a added that this story has to plan around, none of them visible from the story text:*

1. **The Step loop now computes keys as well as results.** `:269` mints a Source key, `:318-323` a Step key, `:404` stores the entry. The `for` head this story turns into a yield point is the same loop, so a yield can land between a Step's key and its store. Choose the point deliberately, and make sure a cancelled run leaves no key behind for a Step it never computed.
2. **`executeGraph`'s signature grew two optional doors** — `cache` and `sourceKey` — and both are pass-through here. `ui/EditorPane.vue:178`'s `keyOfSource` is *contained*: it returns `null` rather than throwing, which is what 7a's door contract rests on. A scheduler that re-wraps it must not change that.
3. **`ui/App.vue` is now the owner of two caches and the precedent for threading a clock.** The run cache arrives as a prop with a `createRunCache()` default factory; `:41-48` records why in the file. **The lesson 7a paid for three review rounds to learn**: a production default that no test exercises can be deleted with a green suite. `ui/App.test.js:151` is the case that mounts the way `app/main.js` does — a clock and a yield threaded the same way need the same treatment, or this story reopens the hole 7a closed.
4. **`core/` lint got stricter.** `no-console` plus a `no-restricted-syntax` selector now block reaching a banned global through `globalThis`, which used to be an open route for the whole of AD-2's list. A scheduler in `core/` cannot name `MessageChannel` by any spelling — which is the design anyway, but the rule will now say so rather than letting it through.

*One thing that is 7c's, recorded here so it is not solved twice.* A result carries `{ kind, table, rowCount, columnCount, diagnostics }` and **no key**; the keys live in a `Map` local to `executeGraph`. 7c's stale mark needs one exposed per result. If this story reshapes the return to add `run: { id, startedAt, state }`, that is the natural moment to decide whether a per-result key rides along — but it is 7c's call and 7c's acceptance criterion, so raise it rather than assume it.

## Design Notes

**Why a generator, and not a second copy of the walk.** The walk has to exist for a synchronous caller and for an asynchronous one, and the two must never disagree about dependency order, gates, or what a result looks like. A generator is the smallest thing that gives both: `executeGraph` drains it in a loop and stays byte-for-byte the function its tests already describe, while the scheduler drains it one Step per turn. AD-4 forbids a *Step* from being a generator or async — it says nothing about the loop around them, and the loop is precisely the thing AD-9 calls the scheduler.

**Why `MessageChannel` and not `setTimeout` or `queueMicrotask`.** AD-9 says the yield goes "through the message queue", and the two obvious alternatives both fail for stated reasons rather than aesthetic ones. `queueMicrotask` drains before the browser processes input, so a click on the cancel control would not be delivered until the whole run finished — a cancellation channel that cannot receive the cancellation. `setTimeout(…, 0)` is clamped to 4 ms once nesting reaches depth five in both engines, which at 30 Steps is over 100 ms of pure clamp added to a run that is already the worst case. `MessageChannel` has no clamp and posts a macrotask, which is what lets the click land. R4 measured the round trip at 3.0 ms (Chromium) / 2 ms (Firefox) and progress reporting at about 2.6 % overhead, so the design is not a compromise — but both numbers were measured outside this artefact, which is why confirming them from `file://` is an acceptance task and an Ask First.

**The message queue from `file://`, re-measured 2026-08-05 against `dist/index.html` in both engines — this is the Ask First, and it resolves in favour of the design by two orders of magnitude.** Thirty yields (one 30-Step run's worth) timed inside the loaded page, three runs each:

| Thirty yields | Chromium (`file://`) | Firefox (`file://`) |
|---|---|---|
| `MessageChannel` | **0–0.2 ms** → at or below the clock's own resolution | **0–1 ms** → the same |
| `setTimeout(…, 0)` | **96.3–96.8 ms** → 3.2 ms per yield | **104–105 ms** → 3.5 ms per yield |

Taken again this round rather than inherited from the reverted attempt, which measured 0.1–0.5 / 0–1 ms and 99.9–124.2 / 110–122 ms — the same two orders of magnitude, from a different process on a different day. Three things follow, each of them a claim this project had only cited before. `MessageChannel` **is** available and does post from `file://` in both engines, so the HALT condition is not met. The per-yield cost is **under 0.01 ms against R4's 3.0 / 2 ms**, so yielding once per Step rather than once per chunk costs nothing measurable — a 46-node run adds well under a millisecond of yield to a walk of several hundred. And the `setTimeout` prohibition is now a measurement in this artefact rather than a citation: **the 4 ms clamp is real in both engines**, and at 30 Steps it is around 100 ms of pure clamp added to the worst case the affordance exists for. `SharedArrayBuffer` is `undefined` from `file://` in both — while `typeof Atomics` is `'object'` in both, which is AD-9's trap re-confirmed in passing: the feature check that looks right reports the opposite of the truth.

**What the return grew, and what it deliberately did not.** The shape decision this story owns is `run: { id, startedAt, state }` on the walk's return, with `state` one of `refused | complete | cancelled` — three words because there are three ways a run ends, and collapsing the refusal into `ok: false` alone would leave a caller unable to tell a refused run from a cancelled one without reading the diagnostics. The identity is minted above everything, including the Result-Step check, so **every** return carries it (AD-25). `clock` is a door in the same sense `cache` and `sourceKey` are: absent, the identity is two `null`s and the walk is what it always was, which is what keeps every pre-7b caller and test honest.

**A per-result key was *not* added, and that is a decision handed on rather than taken.** 7c's stale mark needs one key exposed per result, the keys already exist in a `Map` local to the walk, and reshaping the return was the natural moment. It was left alone because the criterion it serves is 7c's — a mark that says "this belongs to the previous run" has to be designed together with the mode that makes runs stale, and a field added here with no reader is a shape 7c would then have to live with. `results` still holds `{ kind, table, rowCount, columnCount, diagnostics }`. **Raised, not assumed.**

**What the gate asks, and why the walk's descriptor carries a kind.** Two consequences of the round-1 finding, both in code rather than in prose. Gate 1 takes a `sourceConfirmed(id)` predicate beside `sourceTable(id)`, and the pane supplies it from the entry's own `typing.confirmed` — the same field `convertSource` tests before it converts, so the two doors cannot disagree about what "confirmed" means; a caller that passes no predicate keeps `sourceTable(id) === null`, which is what makes it an added door rather than a changed contract. And because Step zero is now genuinely a node in the walk, the walk's order visibly contains Quellen as well as Steps: the yielded descriptor carries `kind` so that the German can say „Rechnet Quelle „gross“ (1 von 46)“ rather than calling a Quelle a Step, and the cancellation sentence counts *Arbeitsschritte (Quellen mitgezählt)* rather than reporting a Step count the user cannot find in their Pipeline.

**Why a plain closure flag is not the flag AD-9 forbids.** AD-9 rules out a *shared* cancellation flag — `SharedArrayBuffer` between threads, which is hidden from `file://` in both engines and which `typeof` lies about. This scheduler is single-threaded: the flag lives in the scheduler's own closure, the cancel control sets it from the same thread, and the yield is what makes the interval between "the user clicked" and "the flag is read" bounded by one Step. That is the design AD-9 describes, and the trap it names is a different one.

**Why a cancelled run publishes nothing, and why that is not a loss.** A partially computed graph shown as the current result is the failure this product exists to prevent — some Steps reflect the new configuration and some the old, and nothing on screen says which. So the pane keeps the previous execution and says the run was cancelled. The work is not thrown away: story 7a's cache holds every Step that completed, keyed on what it is, so the next run picks up where this one stopped. **This is the reason the cache came first**; without it, cancelling would cost more than waiting and nobody would use it twice.

**Why only the newest run may publish.** `recompute()` is reached from nine places today and awaited by none. The moment it becomes asynchronous, an edit during a run means two runs in flight and a race whose loser can be the one that assigns last. The rule is the one the Source store already uses for its parse chain (`core/exec/source-store.js:349`) and the one `GraphCanvas` uses for a landed pass after unmount (`adapters/vueflow/GraphCanvas.vue:404-408`): a generation is held, and a result whose generation is not the current one is dropped. Superseding by cancelling rather than by ignoring is the stronger form and costs nothing, because cancellation is already built.

**When the progress affordance appears, and why that number.** CAP-38 asks for progress on "an execution long enough to be noticed", which is not a number, so the number comes from the two figures the research does have: a cached last-Step edit costs 24.1 ms (Chromium) / 54 ms (Firefox), and a full 100k pipeline costs 263/446 ms. Any reveal delay between those two shows the slow case and hides the fast one, so the delay is **150 ms** — it sits inside the measured gap rather than being borrowed from a rule of thumb. Below it the band is untouched and cannot flicker; above it the line names the Step and its position, and the cancel control appears with it. The delay is read from the injected clock at a yield, so it needs no timer of its own and no second scheduling mechanism.

**Where Step zero ends up, and what stays open.** The ledger has carried an entry since story 6a: the Source conversion costs 548–555 ms at design scale and runs inside a render function, uncancellable, and the entry says this is "the scheduler's shape and not the pane's" because there was no scheduler. Half of that is answered here — but **not for free, and round 1 proved it.** Step zero sits between two yields only if the Source node inside the walk is the *first* place the conversion is asked for. It was not: gate 1 asks `sourceTable(node.id)` for every Source above the loop, so the conversion was already paid, synchronously, before the run yielded once. The gate predicate in the task list is what makes the free version true, and the counting-`sourceTable` case is what keeps it true. The other half stays open regardless: `ui/SourcesPane.vue` calls the conversion from its own render path to draw the unparsed marks, and that call has nothing to do with a run. The entry is rewritten rather than closed, and it names the pane — **and it may not claim the run's half is closed unless the counting case passes.**

**What the reveal delay actually guarantees.** 150 ms is when the affordance *becomes eligible*, not when it appears: the check is read from the clock at a yield, and yields happen between Steps, so the line and the button appear at the first Step boundary past 150 ms. That is not a shortcut — during a single long Step the main thread is computing and the browser cannot paint at all, so no affordance can appear mid-Step by any mechanism available here. The consequence to state rather than discover: **a run whose whole cost is one Step never shows the affordance at all**, however long that Step takes. With the gate predicate in place the one-node run is a Source conversion, which is exactly that case. Say so in the file rather than implying a wall-clock 150 ms.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green; the existing `execute.test.js` suite passes **unchanged in substance**, which is the proof that the sync driver still behaves as before
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` return `[]`, and `describe('what recomputes and what does not')` still passes — this story does not touch the interim rule
- `npm run lint` -- expected: clean
- `npm run test:e2e` -- expected: green in both chromium and firefox, including the new cancellation case
- `npm run build` -- expected: `assert-single-file.mjs` passes

**Manual checks:**

- ~~From the built artefact over `file://` in **both** Chromium and Firefox: confirm `MessageChannel` posts and that the per-yield cost over a real 30-Step graph is in the neighbourhood of R4's 3.0 / 2 ms~~ — **done 2026-08-05, re-measured this round rather than inherited; the table is in the Design Notes.** 30 yields cost 0–0.2 ms (Chromium) / 0–1 ms (Firefox) against 96.3–96.8 / 104–105 ms for the same 30 through `setTimeout(…, 0)`. Under 0.01 ms per yield against R4's 3.0 / 2 ms, so the HALT condition is not met and nothing is re-litigated. `SharedArrayBuffer` is `undefined` from `file://` in both engines while `typeof Atomics` is `'object'` in both.
- ~~Confirm by hand that cancelling a long run leaves the panel showing the previous run's numbers, not a blank and not a partial set~~ — **automated instead, and it is stronger that way.** `tests/e2e/execution.spec.js` builds a 45-Step chain over 500,000 rows, widens the first Step's condition so every Step recomputes, takes the cancel control from the keyboard while the walk is walking, and asserts the German sentence, that the Result Step still reports the *previous* run's row count, and that the status band is still 96 px with the canvas neither resized nor displaced. Run six times across both engines while writing it, green each time.
