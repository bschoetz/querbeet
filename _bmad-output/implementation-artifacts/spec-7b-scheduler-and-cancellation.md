---
title: 'Story 7b — The scheduler: cancellation between Steps, progress, and a run with an identity'
type: 'feature'
created: '2026-08-04'
status: 'draft'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7a-per-step-cache.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Execution is one synchronous call that cannot be stopped, cannot report where it is, and cannot say which run produced what. `core/exec/execute.js:144` runs the whole walk in a single turn of the event loop, so the earliest edit of a 30-Step graph — measured at 578.6 ms in Chromium and 1,156 ms in Firefox — freezes the interface for that long with no progress, no cancel, and no way for a user who realizes mid-run that they configured the wrong Step to get out. Nothing in the product has a run identity: there is no id, no start time and no state anywhere, `runStatus` has no production caller, and the `Clock` port is declared at `ports/index.js:364-369` with no adapter behind it.

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

- No cache changes — 7a owns the cache and this story only passes it through.
- No execution mode, no row threshold, no stale mark, no explicit run action, and **no change to the interim recompute rule** at `ui/EditorPane.vue:68-88`: every data-affecting change still starts a run. 7c decides when a run should *not* start.
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

**The walk, and the exact line that becomes the yield point:**

- `core/exec/execute.js:144` `executeGraph({ steps, resultId, engine, sourceTable })` — plain synchronous `function`, no `async` and no promise anywhere in the file. Story 7a adds a `cache` and a `sourceKey` door to this same signature; **this story must be written against 7a's version, not against `main` as it stands before it.**
- `core/exec/execute.js:193` `for (const node of order)` — **this `for` head is the yield point and the cancellation-check point.** One iteration is one Step, so "exit latency is one Step" falls out of checking here, before the Source shortcut at `:193-196` and before `kind.apply` at `:242`.
- `core/exec/execute.js:152-154` — `contributingTo` then `inDependencyOrder`; `order.length` is the natural progress denominator and the run identity is minted here.
- `core/exec/execute.js:161-173` — the gate loop runs over the whole order **before anything computes**, and `refused()` returns early. A refusal must still carry the run identity, so the id is minted above this block.
- `core/exec/execute.js:107-125` `inDependencyOrder` — DFS post-order, returns a plain array. Unchanged.
- `core/exec/execute.js:269-287` — the epilogue: `exec.run_incomplete` computed from `results`, then the frozen `{ ok, results: readOnlyMap(results), diagnostics }`. **The return has no status field beyond `ok`** — this is where `run: { id, startedAt, state }` joins, and the shape decision is this story's.
- `core/exec/execute.js:55-65` `CODE` / `EXEC_CODES` — the frozen code table and the enumeration `ui/graph-labels.js:437-447` checks itself against. **A new code lands in both or the gap test checks nothing.**
- `core/exec/execute.js:27-31` — the in-code note that gates 2 and 3 are absent by design. Still true after this story; 7c takes gate 3.

**Callers — the nine that become scheduler starts:**

- `ui/EditorPane.vue:156-163` `recompute()` — the sole production call site of `executeGraph`, **synchronous, fire-and-forget, awaited by nobody**. `:140` `execution = shallowRef({ ok:true, results:new Map(), diagnostics:[] })` is the value it swaps (AD-6: swapped wholesale, never made reactive).
- `ui/EditorPane.vue:84-88` `runData(result, options)` = `run(result, options)` + `recompute()`. Reached from `:242` `onConnect`, `:364` `addStep`, and template `:487` set-result, `:488` connect, `:489` disconnect, `:492` remove, `:511` configure. Plus `:342-346` `fromCanvasData` (→ `:348` `onRemove`, `:349` `onDisconnect`) and `:373-384` `watch(() => props.sources)` with `{ immediate: true }`, which fires on a typing confirmation.
- **Name collision, and it is a real one:** `ui/EditorPane.vue:62-66` already has a function called `run` — it is a *command* runner that publishes a refusal and refreshes the projection, nothing to do with an execution run. This story's concept must not be called `run` in that file.
- `ui/EditorPane.vue:203-208` `status` computed → the fixed-height status band at `:415-444` (`role="status"`, testids `editor-refusal` and `editor-status`). **The `h-20` is load-bearing and measured**: a growing region shrank the canvas from 405 px to 237 px in story 6b. A progress line and a cancel control have to fit that band, not extend it.
- `ui/EditorPane.vue:391-405` — the toolbar strip (`Pipeline` heading, one button per addable kind). The only other pane-level affordance row.
- `ui/App.vue:103-111` — `EditorPane` is `v-if`, so it is **genuinely unmounted** on a view switch. A run in flight when the user leaves has to be cancelled by the component, or it publishes into a component that is gone.

**Time and identity — declared, unimplemented:**

- `ports/index.js:364-369` — the `Clock` typedef exists and declares **`now()` only**. AD-25 says a run's id *and* its start time come from this port, so the port grows a second member here.
- `adapters/clock/` — **empty except `.gitkeep`. No Clock adapter exists.** `app/main.js:27-48` is the composition root and wires `store`, `graph`, `engine`, `canvas`; a clock is named here and threaded `App.vue` → `EditorPane.vue` exactly like `engine` (`ui/App.vue:30`, `:108`).
- **No `Date.now`, no `performance.now`, no wall-clock `new Date` in any production file.** Every `new Date` is a fixed epoch or UTC arithmetic (`core/exec/convert.js:63`, `adapters/arquero/engine.js:273`, `core/types/typing.js:356,404,1528,1530`, `ui/cell-text.js:74`). The only `Date.now()` in the repo is a Playwright budget assertion at `tests/e2e/xlsx-parquet.spec.js:40`.
- **No id minting of any kind** — no `Math.random`, no `crypto.randomUUID`. Every id in the product is deterministic (`src:…`, `edgeId` at `core/graph/graph.js:114`).
- `core/diagnostics/diagnostic.js:21-27` — `{ severity, code, values, stepId?, sourceId? }`, no `runId`. `:72-81` `runStatus(diagnostics)` → `{ clean, counts, diagnostics }`, **zero production callers except `ui/StepPanel.vue:559`, which calls it per Step**. Do not change its signature; story 12 owns the run status.

**Async, yielding and progress — what exists to copy, and what does not exist at all:**

- **Nothing in `core/` is async outside the Source store's parse chain.** `execute.js`, `convert.js`, `core/steps/*`, `core/graph/*`, `core/types/*`, `core/view/row-window.js` are synchronous top to bottom.
- `core/exec/source-store.js:346-358` `serialize(id, work)` — a per-Source promise chain, tail-chained, the stored link never rejects. The repo's only in-flight-command precedent, and the model for "a second request supersedes the first".
- `adapters/vueflow/canvas-logic.js:99-122` `createRemovalRouter({ …, schedule = queueMicrotask })` with `arm()`/`flush()` — **the one injectable scheduler in the repo**, and `:99` states the reason in as many words: "`schedule` is injectable so a test can drive the flush without a clock." **This is the pattern for the yield.**
- `adapters/vueflow/GraphCanvas.vue:404-408` — `disposed = true` on unmount so a landed pass is dropped. The repo's only "abandon work scheduled by a component that is gone" precedent.
- **No `setTimeout`, no `MessageChannel`, no `requestIdleCallback`, no `postMessage`, no `Worker` anywhere** in `core/`, `adapters/`, `ui/` or `app/`. `TableWriter` at `ports/index.js:255-260` is a bare typedef with no adapter, so AD-15's export workers do not exist yet either. **The message-queue channel has nothing to reuse and is new code.**
- **No progress reporting of any kind** — no percentage, no counter, no ETA.

**The in-flight affordance to compose with:**

- `ui/SourcesPane.vue:681` `parsing = shallowRef({})` (id → control name), `:683` `isParsing(id, control)`, `:685-709` `reparse(id, control, run)` — sets the flag, awaits, clears in `finally` and refreshes. The ref is **swapped wholesale, never mutated in place** (`:686`, `:704-706`) — the discipline a progress ref must follow.
- `ui/SourcesPane.vue:1001-1013` — the pending line: `role="status"`, `data-testid="parse-pending"`, `class="pb-1 text-xs text-slate-500"`, German „Datei wird neu gelesen …", rendered as a `v-if`/`v-else-if` pair so it **replaces** a sibling rather than adding height. `:912-996` — the disabled idiom is `:disabled="isParsing(...)"` plus `disabled:opacity-50`; there is no `.muted` class and no design-token file (`ui/style.css:14-29` is the whole of the app's own CSS).
- `ui/SourcesPane.vue:676-680` — the stated reason the affordance exists at all: a card that stays fully interactive and unchanged for a third of a second "invites a second click over the first."

**Keyboard and German:**

- `adapters/vueflow/GraphCanvas.vue:417-425` — the pane is `tabindex="-1"` and `@keydown` is **scoped to the pane element, never document-level**; `:290-299` gives the measured reason (the library's guard covers INPUT/SELECT/TEXTAREA but not BUTTON). A plain `<button>` is keyboard-reachable for free; a shortcut would have to be scoped the same way.
- `ui/graph-labels.js:186-397` `GERMAN` map (`exec.*` block at `:363-396`), `:76-88` the sentence helpers `q()`, `step(nameOf,id)`, `nf()`, `rows(n)`, `:437-447` `graphLabelGaps()`, `:452-457` `SEVERITY` tone classes. Every new code needs its sentence here.

**Tests:**

- `core/exec/execute.test.js:1-14` — real graph store, real engine by dynamic import (AD-1); helpers at `:16-59`.
- `ui/EditorPane.test.js:18-31` `StubCanvas` (renders the `#step` slot, declares the six emits), `:44-58` `stubEngine()` + `render()`, `:303-334` `countingEngine()`, `:336-348` `withEngine`, `:350-357` `wired()`. `:298-305` carries the comment naming story 7 and `:359-412` the three recompute cases — **this block must still pass unchanged in substance: the interim rule is not this story's to change.**
- **No test in the repo uses fake timers** — no `useFakeTimers`, no `vi.advanceTimers`. Async is handled with `await nextTick()` and, in two places, `flushPromises()` (`ui/SourcesPane.test.js:9,1484`). An injected yield is therefore both the architectural answer and the only testable one.
- `vitest.config.js:35-48` — happy-dom's `ResizeObserver` is an empty stub and `getBoundingClientRect` returns an all-zero rect. **A progress affordance must not depend on geometry** or it cannot be tested in the `ui` project.
- `playwright.config.js:19-30` — `file://` only, no `baseURL`, chromium and firefox. `tests/e2e/execution.spec.js:53-58,131` — locators by testid and German text (`toHaveText('10 Zeilen, 3 Spalten')`).

## Tasks & Acceptance

**Execution:**

- [ ] `ports/index.js` -- give `Clock` a second member for minting a run identity beside `now()`, and add a `Yield` port whose single method resolves on the next turn of the macrotask queue; state in both that they exist so `core/` stays pure and browser-free -- ports move before implementations
- [ ] `adapters/clock/clock.js` (new) + test -- the first inhabitant of an empty directory: `now()` and an id mint. Ids must be unique within a session and must not depend on `Math.random` being seeded any particular way -- AD-25's identity, named in an adapter
- [ ] `adapters/scheduler/queue-yield.js` (new) + test -- a `MessageChannel`-backed yield, one port pair created once and reused, resolving a promise per turn; document why `setTimeout` is not it (the 4 ms clamp after five nested timers) -- AD-9's message queue, and the first one in the project
- [ ] `core/exec/execute.js` + test -- extract the Step loop into a generator that yields once per node and returns the assembled result; keep `executeGraph` as the synchronous driver that drains it, unchanged in signature and behaviour; mint `{ id, startedAt }` above the gate loop and add `run: { id, startedAt, state }` to both the refused and the completed return -- one walk, two drivers, no drift
- [ ] `core/exec/scheduler.js` (new) + test -- `startRun({ ...executeGraph's arguments, clock, yieldNow, onProgress })` → `{ id, startedAt, cancel(), completed }`; drives the generator, awaits `yieldNow()` before each Step, checks the cancellation flag at each yield, calls `onProgress({ done, total, stepId })`, and resolves with state `complete` or `cancelled`; the flag is a plain closure variable on the same thread -- the scheduler is the yield point, the Steps are not
- [ ] `core/exec/execute.js` -- one new code for a cancelled run in `CODE` and therefore in `EXEC_CODES` -- the enumeration is what makes the German gap test meaningful
- [ ] `app/main.js` + `ui/App.vue` -- construct the clock and the yield in the composition root and thread them to `EditorPane` as props beside `engine` -- AD-1: one place names the adapter
- [ ] `ui/EditorPane.vue` -- turn `recompute()` into a scheduler start under a name that does not collide with the existing command runner at `:62`; cancel the in-flight run before starting a new one; publish only the newest run's result; cancel on unmount; hold `{ done, total, stepId }` in a `shallowRef` swapped wholesale -- nine call sites become starts and every one of them can fire during a run
- [ ] `ui/EditorPane.vue` -- the progress line and the cancel button inside the existing `h-20` band, `role="status"`, testids for both, appearing only once the run has outlived the reveal delay; the button is a real `<button>` with a German label -- the band's height is measured and must not grow
- [ ] `ui/graph-labels.js` -- the German sentence for the cancellation code; `graphLabelGaps()` stays `[]` -- AD-13: `core/` emits the code, `ui/` writes the sentence
- [ ] `core/exec/scheduler.test.js` + `ui/EditorPane.test.js` -- the matrix as cases, driving the injected yield by hand rather than with timers: cancel between Steps, completed Steps survive in the cache, an edit supersedes, an older run's late completion is discarded, a refusal still carries a run identity, unmount cancels, a throw is not a cancellation -- the repo has no fake timers and an injected yield is why it still does not need them
- [ ] `tests/e2e/execution.spec.js` -- one case over the built artefact in both engines: start a run big enough to be noticed, press the cancel control, assert the German sentence and that the previous results are still what is shown -- `file://` is where the platform assumptions actually get tested
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- rewrite the open entry about the 548–555 ms Step-zero conversion in `ui/SourcesPane.vue`'s render path: the scheduler now exists, the run's Step zero is cancellable because it is a node in the walk, and what remains is the pane's own render-path call -- the entry must stop pointing at a story that has shipped

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

## Design Notes

**Why a generator, and not a second copy of the walk.** The walk has to exist for a synchronous caller and for an asynchronous one, and the two must never disagree about dependency order, gates, or what a result looks like. A generator is the smallest thing that gives both: `executeGraph` drains it in a loop and stays byte-for-byte the function its tests already describe, while the scheduler drains it one Step per turn. AD-4 forbids a *Step* from being a generator or async — it says nothing about the loop around them, and the loop is precisely the thing AD-9 calls the scheduler.

**Why `MessageChannel` and not `setTimeout` or `queueMicrotask`.** AD-9 says the yield goes "through the message queue", and the two obvious alternatives both fail for stated reasons rather than aesthetic ones. `queueMicrotask` drains before the browser processes input, so a click on the cancel control would not be delivered until the whole run finished — a cancellation channel that cannot receive the cancellation. `setTimeout(…, 0)` is clamped to 4 ms once nesting reaches depth five in both engines, which at 30 Steps is over 100 ms of pure clamp added to a run that is already the worst case. `MessageChannel` has no clamp and posts a macrotask, which is what lets the click land. R4 measured the round trip at 3.0 ms (Chromium) / 2 ms (Firefox) and progress reporting at about 2.6 % overhead, so the design is not a compromise — but both numbers were measured outside this artefact, which is why confirming them from `file://` is an acceptance task and an Ask First.

**Why a plain closure flag is not the flag AD-9 forbids.** AD-9 rules out a *shared* cancellation flag — `SharedArrayBuffer` between threads, which is hidden from `file://` in both engines and which `typeof` lies about. This scheduler is single-threaded: the flag lives in the scheduler's own closure, the cancel control sets it from the same thread, and the yield is what makes the interval between "the user clicked" and "the flag is read" bounded by one Step. That is the design AD-9 describes, and the trap it names is a different one.

**Why a cancelled run publishes nothing, and why that is not a loss.** A partially computed graph shown as the current result is the failure this product exists to prevent — some Steps reflect the new configuration and some the old, and nothing on screen says which. So the pane keeps the previous execution and says the run was cancelled. The work is not thrown away: story 7a's cache holds every Step that completed, keyed on what it is, so the next run picks up where this one stopped. **This is the reason the cache came first**; without it, cancelling would cost more than waiting and nobody would use it twice.

**Why only the newest run may publish.** `recompute()` is reached from nine places today and awaited by none. The moment it becomes asynchronous, an edit during a run means two runs in flight and a race whose loser can be the one that assigns last. The rule is the one the Source store already uses for its parse chain (`core/exec/source-store.js:346-358`) and the one `GraphCanvas` uses for a landed pass after unmount (`adapters/vueflow/GraphCanvas.vue:404-408`): a generation is held, and a result whose generation is not the current one is dropped. Superseding by cancelling rather than by ignoring is the stronger form and costs nothing, because cancellation is already built.

**When the progress affordance appears, and why that number.** CAP-38 asks for progress on "an execution long enough to be noticed", which is not a number, so the number comes from the two figures the research does have: a cached last-Step edit costs 24.1 ms (Chromium) / 54 ms (Firefox), and a full 100k pipeline costs 263/446 ms. Any reveal delay between those two shows the slow case and hides the fast one, so the delay is **150 ms** — it sits inside the measured gap rather than being borrowed from a rule of thumb. Below it the band is untouched and cannot flicker; above it the line names the Step and its position, and the cancel control appears with it. The delay is read from the injected clock at a yield, so it needs no timer of its own and no second scheduling mechanism.

**Where Step zero ends up, and what stays open.** The ledger has carried an entry since story 6a: the Source conversion costs 548–555 ms at design scale and runs inside a render function, uncancellable, and the entry says this is "the scheduler's shape and not the pane's" because there was no scheduler. Half of that is answered here for free — during a run, Step zero is reached through `sourceTable(id)` at a Source node inside the walk, so it sits between two yields like every other Step and exit latency over it is one Step. The other half is not: `ui/SourcesPane.vue` calls the conversion from its own render path to draw the unparsed marks, and that call has nothing to do with a run. The entry is rewritten rather than closed, and it names the pane.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green; the existing `execute.test.js` suite passes **unchanged in substance**, which is the proof that the sync driver still behaves as before
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` return `[]`, and `describe('what recomputes and what does not')` still passes — this story does not touch the interim rule
- `npm run lint` -- expected: clean
- `npm run test:e2e` -- expected: green in both chromium and firefox, including the new cancellation case
- `npm run build` -- expected: `assert-single-file.mjs` passes

**Manual checks:**

- From the built artefact over `file://` in **both** Chromium and Firefox: confirm `MessageChannel` posts and that the per-yield cost over a real 30-Step graph is in the neighbourhood of R4's 3.0 / 2 ms. Record both figures in the Design Notes. If either is materially larger, HALT (Ask First) — the yield count scales with the graph.
- Confirm by hand that cancelling a long run leaves the panel showing the previous run's numbers, not a blank and not a partial set.
