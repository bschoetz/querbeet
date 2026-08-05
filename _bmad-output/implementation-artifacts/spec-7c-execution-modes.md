---
title: 'Story 7c — The two execution modes: a stated threshold, a visible mode, and a stale mark'
type: 'feature'
created: '2026-08-04'
status: 'draft'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7b-scheduler-and-cancellation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is one execution mode and it is unconditional. `ui/EditorPane.vue:77-89` recomputes after every data-affecting change no matter how much data is loaded — a rule story 6b shipped as an interim and licensed only at design scale — and nothing anywhere tells a user which mode they are in, because there is no mode. Above the measured shapes that rule stops being affordable, and the failure it produces is the worst one this product has: a Preview that looks current while the configuration under it has moved on, with nothing on screen saying so.

**Approach:** Below a stated row threshold the Pipeline stays live and every edit recomputes. Above it the Pipeline is explicit: an edit changes the configuration and starts nothing, every Preview and Result whose Step has moved on is marked as belonging to the previous run, and a named action starts the new one. The mode is derived by the scheduler from the loaded row count against a threshold the user can read, and the UI reads it rather than deciding it.

## Boundaries & Constraints

**Always:**

- **The mode is derived in `core/`, from the loaded row count against a stated threshold, and the UI reads it** (AD-29). No component computes a mode, and no component may start a run the mode forbids: the scheduler refuses an edit-triggered run in explicit mode rather than trusting the caller not to ask.
- **The mode in force is visible wherever the user is working**, in both views, at all times — including while the Editor is unmounted. It is not a setting on a screen somebody has to visit.
- **The threshold is a number the user can see**, not a hidden heuristic, and crossing it is announced when it happens rather than discovered.
- **The mode is a property of the session and its data, never of the Recipe.** Nothing about it is saved, and the same Recipe over a larger extract gets explicit mode without the Recipe saying anything.
- **A result whose Step has moved on is marked, and the mark is derived, never held.** Story 7a keys every Step by its content, so "belongs to the previous run" is exactly "the key that produced this result is not the Step's key now" — which also marks every Step downstream, because their input keys changed.
- **Nothing may look current by default.** A stale Preview keeps its numbers and says what they are; it never silently blanks and never silently updates.
- **Recomputation is incremental in both modes** — a change recomputes that Step and its dependents, never the Steps above it. That is the walk's existing frontier behaviour and this story must not widen it.
- **Gate 2 gets its seam and its absence is stated.** The Pre-flight Check is story 15's and does not exist. The scheduler carries the gate; explicit mode says in German that there is no pre-flight check yet, so its silence cannot be read as "checked".
- Every control this story adds is a real focusable element with a German label (AD-30, NFR-6). `core/` emits codes, `ui/` writes sentences (AD-13).

**Ask First:**

- The threshold constant is the owner's number. This story proposes **100,000 rows** with its reasoning stated; if the owner wants a different one, that is a one-constant change and **the reasoning, not the number, is what needs to survive**.
- If the derived stale mark turns out to disagree with what a user would call stale in any case found while building — a Step whose key is unchanged but whose *input Source* was re-read, say — **HALT and report the case** rather than adding a second staleness rule beside the key.

**Never:**

- No cache changes (7a) and no scheduler changes beyond the mode gate and the trigger argument (7b).
- No new Step kind, no change to what any Step computes, no change to the frontier walk or to incremental recomputation.
- No persistence of the mode, no per-Recipe override, no user-settable threshold in the MVP. The threshold is stated and visible; making it editable is a different decision.
- No Pre-flight Check implementation, no Input Contract, no column mapping — story 15.
- No run status surface, no run history — story 12.
- No dialog. The only two-step commitment in this product is the typing confirmation, and a modal would be the first.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Below the threshold | Loaded rows under the stated number | Live mode; every data-affecting edit recomputes exactly as it does today | N/A |
| Crossing upward | Loading a Source takes the session over the threshold | The mode indicator changes and the crossing is announced in German at the moment it happens, in whichever view the user is in | N/A |
| Crossing downward | Removing a Source takes the session back under | Live mode returns and is announced the same way | N/A |
| An edit in explicit mode | A Filter value changes above the threshold | The configuration changes, nothing runs, and that Step and everything downstream are marked as belonging to the previous run | N/A |
| The named action | The run action is used in explicit mode | A run starts, progress and cancellation work as in live mode, and every mark clears as its Step's result arrives | N/A |
| A stale Preview | A Step marked as previous-run | The rows, counts and warnings shown are the previous run's, unchanged, and are stated to be | N/A |
| A Step edited back to its previous configuration | Value changed and changed back, above the threshold | The mark clears without a run — the key is the Step's key again | N/A |
| A rename or a move above the threshold | `renameStep` / `moveStep` | Nothing runs and nothing is marked — the key never saw the name or the position | N/A |
| Gate 2's absence | Explicit mode, before the run action is used | A German sentence states that there is no pre-flight check yet; nothing implies one was passed | N/A |
| An edit-triggered run in explicit mode | A caller asks for a run because a config changed | The scheduler refuses it and names the mode; no Step executes | Refusal carries a code and a German sentence |
| The view is switched | The user goes to Quellen and back, above the threshold | The mode, the threshold and the marks are all still what they were | N/A |

</frozen-after-approval>

## Code Map

> **Re-verified against the tree on 2026-08-05, after story 7a shipped.** Every anchor below is current. The previous draft predates 7a and its `core/exec/execute.js`, `ui/EditorPane.vue`, `ui/App.vue` and `ui/SourcesPane.vue` line numbers were all stale. **One assumption in it was not merely stale but wrong**, and it is the one the whole stale-mark design rests on — see the first bullet under *Where a stale mark is rendered*. `ui/StepPanel.vue` was untouched by 7a; its anchors are re-checked and correct.

**Where the mode has to live, and the trap that decides it:**

- `ui/App.vue:142-143` — `EditorPane` is `v-if`, so it is **genuinely unmounted on every view switch**, and `:13-14` states the reason the Sources pane is `v-show` and this one is not. Any mode, threshold or stale state held in the pane is destroyed when the user visits Quellen — which is exactly where Sources are loaded and therefore where the threshold is crossed. **This is the argument for deriving the mode in `core/` and showing it above the panes.**
- `ui/App.vue:107-114` — the header strip (`<h1>querbeet</h1>`, tagline, `build-version` at `:113`) is **the only page-global chrome in the product**, rendered in both views. `:116` the tabs `<nav>`, `:134` SourcesPane (`v-show`), `:69` `createStepZeroCache(props.engine)` and `:95-96` `sources = shallowRef(store.list())` with `onSourcesChanged` — the row total is already reachable here and already refreshes.
- `ui/App.vue:26-33` — props `buildVersion, store, graph, engine, canvas`, **plus 7a's `runCache`**; `app/main.js:42-48` is where anything new is named. **7a's precedent for adding one**: `runCache` arrives as a prop with a `createRunCache()` default factory rather than a `setup` constant, and `ui/App.vue:41-48` records why — a production default that no test mounts without is a default that can be deleted with a green suite. A mode or clock threaded the same way inherits both the pattern and the obligation.
- **Absent:** no mode state, no threshold constant, no global run action, no page-level execution chrome anywhere. `core/exec/execute.js:1-58` is the file that would own it and names which gates are present and which are not.

**The row count — what exists and what does not:**

- `core/exec/source-store.js:579` — an entry holds `table: { columns, rowCount }` from the reader, frozen. **`entry.table.rowCount` is the loaded-row count per Source**, a plain number on the frozen entry available to every `store.list()` consumer.
- `ui/SourcesPane.vue:955` — the only place it is rendered today: `{{ rowsLabel(s.table.rowCount) }}`, testid `source-counts` at `:952`.
- `ui/EditorPane.vue:24` — the pane already receives whole Source entries, so the number is reachable there too and is currently unused.
- `core/exec/execute.js:221-232` — a Step result carries `rowCount` and `columnCount`; `ports/index.js:27` `Table.rowCount()`.
- **Absent:** there is no sum, no aggregate, no `rowsLoaded` anywhere. The store is the one writer of Source state and is where the total belongs.

**The recompute rule this story supersedes:**

- `ui/EditorPane.vue:77-89` — the interim rule stated in prose, implemented as `runData(result, options) = run(result, options) + recompute()` at `:94`. **7a added a paragraph to that comment** (`:89`) explaining that a rename still recomputes nothing *and* now costs nothing, because the cache keys never saw the name. **The prose is the text this story rewrites**, and it names story 7 explicitly.
- The data-affecting commands, and the call sites that reach them: `:268` `onConnect`; `:368` `fromCanvasData` → `:374` `onRemove`, `:375` `onDisconnect`; `:390` `addStep`; `:399-400` `watch(() => props.sources)` with `{ immediate: true }` (fires on a typing confirmation); template `:513` set-result, `:515` disconnect, `:518` remove, `:537` `@configure` — **`:537` is the main edit-vs-run seam**. Not recomputing, and staying that way: rename, add-slot, `:517` remove-slot, `onMove`.
- `ui/EditorPane.vue:68` — the existing `run(result, {quiet})` is a **command** runner, not an execution run. Story 7b already had to work around this name; do not add a third meaning.
- `ui/EditorPane.vue:150` `execution = shallowRef(...)`, `:180-189` `recompute()` (now passing 7a`'`s `cache` and `sourceKey`), `:192` `resultFor(id)`, `:340` `inputSchema` derived from `execution.value.results.get(upstream)` — **note this one: in explicit mode the schema the config forms are built from is already previous-run data**, and the forms must not pretend otherwise.
- `ui/EditorPane.vue:420` — the toolbar strip (`Pipeline` heading, one button per addable kind). **The named run action belongs here**, beside the verbs, not in the status band.
- `ui/EditorPane.vue:441-470` — the fixed `h-20` status band, `role="status"`, testids `editor-refusal` / `editor-status`. Story 7b puts progress and cancel in it. **The band's height is measured and load-bearing** — story 6b saw the canvas go from 405 px to 237 px when it grew — so the mode indicator does not go here; it goes in the header.

**Where a stale mark is rendered, and why it must be derived:**

- **⚠ The one thing this spec assumed that 7a did not ship.** The Design Notes below say 7a "stores [the content key] with the result" and that three consequences "fall out for free and none of them needs code". **The design is right and the keys exist — but a result does not carry one.** `core/exec/execute.js:221` `record()` builds `{ kind, table, rowCount, columnCount, diagnostics }` and nothing else, and the keys live in a `Map` local to `executeGraph` (`:246` `const keys = new Map()`, written at `:269` and `:323`, never returned). So `resultKey !== currentKey` needs `executeGraph` to expose a key per result, and **that is this story's edit** — one line in `record()` plus whatever the return shape decides. It is small, it is not free, and story 7b may reshape the same return to add `run: { id, startedAt, state }`, so the two should be decided together rather than in sequence. Everything else in the Design Notes' argument survives unchanged: the key genuinely never saw `name`, `x` or `y`, downstream marking genuinely falls out of input keys, and un-marking genuinely works because a config returned to a previous value produces the previous key — all three are pinned by tests 7a shipped (`core/exec/execute.test.js`, the `describe('the per-Step cache')` block at `:442`).
- **A second thing worth knowing before designing the mark:** 7a's keys can be `null`. An unkeyable Source, a config the serializer refuses, and an entry whose Step inherited a `null` input key all propagate as "not cacheable" (`core/exec/execute.js:240-246` states the rule). **A `null` key is not a staleness answer** — it means the question cannot be asked — so the mark needs a third state or an explicit decision that `null` reads as fresh. Not reachable through the shipped UI today, and it will be the moment story 14 imports a Recipe.
- `ui/StepPanel.vue:46` — props `step`, `label`, `inputSchema`, `result` (`{ table, rowCount, columnCount, diagnostics }` or `null`), `nameOf`. **No `stale` prop exists.** Untouched by 7a.
- `ui/StepPanel.vue:550-596` — the preview block: `preview = shallowRef(null)` at `:557`, `status = runStatus(result.diagnostics)` at `:559`, and **the `watch(() => props.result, …)` at `:574` keys off the `result` prop's identity** — so continuing to hand the panel the previous run's result object re-renders nothing, which is precisely the behaviour this story wants.
- `ui/EditorPane.vue:528-534` — `StepPanel` is invoked with `:key="selectedStep.id"` at `:531`, so it **remounts on every selection change**. Anything held inside the panel resets; a stale mark therefore has to be derived from props, never stored.
- `ui/StepPanel.vue:1092`, `:1099`, `:1106` — the counts block's three `step-counts` branches. The third, at `:1109` — „Nicht gerechnet — dieser Step trägt nicht zum Ergebnis bei oder der Lauf wurde abgelehnt." — is the nearest existing idiom, and the mark belongs immediately above the block, since counts, marks and preview are all the previous run's together.
- `ui/StepPanel.vue:1117` `step-status` and `:1124` `step-marks` (the warnings), `:1146` the `RowWindow` preview's `step-preview-bound`.
- **The German idiom to match, already used three times:** `ui/StepPanel.vue:778` `filter-value-pending`, `:844` `columns-selection-pending` („…die vorherige Einstellung bleibt in Kraft. Die neue Auswahl wirkt, sobald …"), `:1077` `first-count-pending`. The rule for whether it gets announced is stated just above `:844`: a refusal the model rejected carries `role="status"`, a hint that never reached the model does not. **A stale mark is neither — it is a statement about what is on screen, and it changes without the user touching anything, so it is announced.**
- `ui/StepPanel.vue` `commit(next)` — the single funnel that emits `configure`; every control routes through it and nothing else needs touching.

**Mode visibility, gates, and the existing gate-1 precedent:**

- `core/exec/execute.js:197-214` — the gate loop, running over the whole order before anything computes and returning `refused()` at `:214`; `:39-58` the in-code note naming which gates are present. **This story takes gate 3 and builds gate 2's seam.** 7a's rule that the cache is neither read nor written above this line is a constraint on where a mode gate may sit.
- `core/exec/execute.js:77-87` `CODE` / `EXEC_CODES` — new codes for the refused edit-triggered run and for the threshold crossing land here and therefore in `ui/graph-labels.js:437-447`'s check.
- `ui/SourcesPane.vue:860` `confirm()` and `:1313-1317` the „Typen bestätigen" / „Bestätigung aufheben" buttons, `:604` `confirmState(s)` → „Typen bestätigt." / „Typen noch nicht bestätigt." — **gate 1's whole surface**, and the tone the mode indicator and the run action should match.
- `ui/SourcesPane.vue:1071-1073` — `parse-pending`: `role="status"`, testid, `text-xs text-slate-500`, rendered as a `v-if`/`v-else-if` pair so it replaces a sibling rather than adding height. The disabled idiom is `:disabled` plus `disabled:opacity-50` (`:976`, `:1000`, `:1022`, `:1059`); there is no `.muted` class and `ui/style.css:14-29` is the whole of the app's own CSS. The de-facto token table is `ui/graph-labels.js:452-457` `SEVERITY` (`info` → `text-slate-500`, `warning` → `text-amber-600`).
- `ui/graph-labels.js:186-397` the `GERMAN` map (`exec.*` at `:363-396`), `:76-88` the helpers `q()`, `step()`, `nf()`, `rows(n)` — **`nf()` is what makes the threshold read as `100.000`**, `:431-435` `graphText`, `:437-447` `graphLabelGaps()`.

**Tests:**

- `ui/EditorPane.test.js:308` `describe('what recomputes and what does not')` — the comment that names story 7 and the reason this envelope exists: "an e2e run cannot tell a recomputed number from an unchanged one … Here the engine can be counted." `:321` `countingEngine()`, `:337` `withEngine`, `:350` `wired()`. **This block is this story's direct predecessor: the rename and move cases stay, and the mode cases join them.** 7a added its own cache cases inside the same block and inside `ui/App.test.js`, which is new — `ui/App.test.js:135` `render(store, graph, engine, runCache)` and `:151`, the case that mounts with no cache prop at all, are the pattern for testing anything threaded from the composition root. The comment itself has to be rewritten — it currently describes an interim that ends here.
- `tests/e2e/execution.spec.js:714` — the e2e counterpart, `'renaming and moving a Step recompute nothing, while connecting does'`.
- `ui/StepPanel.test.js:10-54` — untouched by 7a. `mount(StepPanel, …)` with a hand-built `handle(schema, rows)` whose `column()` throws to prove the preview never copies a column, plus a `result()` factory.
- `ui/EditorPane.test.js:20` `StubCanvas`, `:44` `stubEngine()`, `:50` `render()`.
- `vitest.config.js:35-48` — happy-dom's `getBoundingClientRect` is all-zero and `ResizeObserver` is a stub, so **the mode indicator must be assertable by text and `disabled`, never by layout**.
- `tests/e2e/execution.spec.js:18-28` `file://` against `dist/`, `:53-58` locators by testid and role, `:131,147-148` German assertions by exact text (`toHaveText('10 Zeilen, 3 Spalten')`), controls reached by German label (`getByLabel('Anzahl Zeilen')` at `:269`).

## Tasks & Acceptance

**Execution:**

- [ ] `core/exec/mode.js` (new) + test -- the threshold constant with its reasoning in a comment, and a pure `modeFor(rowsLoaded)` → `live | explicit`; export the threshold so the UI can state the number rather than restate it -- one place decides, and it is not a component
- [ ] `core/exec/source-store.js` + test -- a `rowsLoaded()` reader summing `entry.table.rowCount` over every Source in the registry -- the store is the one writer of Source state, so it is the one place that can answer without a second count drifting
- [ ] `core/exec/scheduler.js` + `core/exec/execute.js` + tests -- take the mode and a run trigger (`edit` or `explicit`); **refuse an `edit`-triggered run in explicit mode** with a named code, before any Step; carry a pre-flight gate whose current state is "not available" and which never reads as passed -- AD-29: the gates live in the scheduler and the UI reads the mode
- [ ] `core/exec/execute.js` + test -- **put each result's content key on the result entry.** 7a computes the keys and keeps them in a `Map` local to `executeGraph` (`:246`, written at `:269` and `:323`); `record()` at `:221` does not carry one. Add it there and decide with story 7b, which reshapes the same return for `run: { id, startedAt, state }`. Rule the `null` case explicitly: a key can be `null` for an unkeyable Source or a config the serializer refuses, and `null` means the staleness question cannot be asked rather than "fresh" -- the stale mark is a key comparison, so the key has to be reachable from the thing it describes
- [ ] `core/exec/execute.js` -- new codes in `CODE`/`EXEC_CODES` for the refused edit-triggered run, the threshold crossing, and the unavailable pre-flight check -- the enumeration is what makes the German gap test meaningful
- [ ] `ui/App.vue` -- derive the mode from `store.rowsLoaded()` beside the existing `sources` refresh; render the mode and the threshold in the header strip so both views show it; announce a crossing when the derived mode changes -- the Editor is `v-if` and cannot be the home of state that has to survive a view switch
- [ ] `ui/EditorPane.vue` -- receive the mode; rewrite the `:77-89` interim-rule comment to state the two modes; keep every command committing exactly as now and let the scheduler decide whether a run follows; add the named run action to the toolbar strip at `:420` with a German label; in explicit mode state that there is no pre-flight check yet -- an edit never silently becomes a run and never silently does not
- [ ] `ui/EditorPane.vue` + `ui/StepPanel.vue` -- derive `stale` per Step by comparing the key that produced the shown result against the Step's key now, pass it as a prop, and render the sentence above `step-counts` with `role="status"`; the shown numbers, warnings and rows stay exactly as they were -- derived, because the panel remounts per selection and anything held would reset
- [ ] `ui/graph-labels.js` -- German for every new code, the threshold rendered through `nf()` so it reads `100.000`; `graphLabelGaps()` stays `[]` -- AD-13
- [ ] `ui/EditorPane.test.js` + `ui/StepPanel.test.js` -- rewrite the story-7 comment at `:298-305`, keep the rename and move cases, and add: an edit above the threshold computes nothing, the run action computes, the mark appears and clears, an edit back to a previous configuration clears the mark with no run, the mode survives a view switch -- the counting engine is the only envelope that can see any of this
- [ ] `tests/e2e/execution.spec.js` -- one case in both engines over the built artefact: load past the threshold, see the announcement and the mode, edit a Step, see the mark and unchanged numbers, use the run action, see the mark clear -- German text asserted exactly, as everywhere else in this file
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- append: the threshold is stated and visible but not user-settable, and CAP-38's promise is only that it is stated -- named as a deliberate MVP boundary rather than left to be discovered

**Acceptance Criteria:**

- Given a session under the threshold, when any data-affecting change is made, then it recomputes exactly as it does today — this story adds a second mode and does not alter the first.
- Given loading a Source takes the session over the threshold, when the load completes, then the mode shown changes and the crossing is announced in German at that moment, whichever view the user is in.
- Given explicit mode, when a Step's configuration changes, then nothing executes, that Step and every Step downstream of it state that what they show belongs to the previous run, and the numbers they show are unchanged.
- Given a marked Step in explicit mode, when its configuration is changed back to the value that produced the shown result, then the mark clears and no run occurs.
- Given explicit mode, when the named run action is used, then a run starts and each mark clears as its Step's result arrives.
- Given explicit mode, when the user looks for the pre-flight check, then a German sentence states there is not one yet — no screen, no wording and no silence implies a check was made.
- Given any mode, when the user switches to Quellen and back, then the mode, the threshold and every mark are unchanged.
- Given a Step renamed or moved above the threshold, when the graph re-renders, then nothing runs and nothing is marked.

## Spec Change Log

**2026-08-05 — story 7a shipped. One assumption in this draft was wrong, not merely stale.**

The frozen block survives intact: nothing in the intent, the boundaries or the matrix depends on what changed. The Code Map did.

*The correction that matters.* This spec's central design — the stale mark is `resultKey !== currentKey` — was written believing 7a would store each Step's content key **on the result**. It does not. `core/exec/execute.js:221` `record()` builds `{ kind, table, rowCount, columnCount, diagnostics }`, and the keys live in a `Map` local to `executeGraph` (`:246`, written at `:269` and `:323`, never returned). The Design Notes claimed three consequences "fall out for free and none of them needs code"; all three are real and all three are pinned by tests 7a shipped, but reaching them costs one line in `record()` plus a decision about the return shape. That is now its own task, and it should be decided **together with story 7b**, which reshapes the same return to add `run: { id, startedAt, state }`.

*A second thing the draft could not have known.* 7a's keys can be `null` — an unkeyable Source, a config `canonical` refuses, or a Step that inherited a `null` input key all propagate as "not cacheable" rather than as a guess. **`null` is not an answer to "is this stale"**, it means the question cannot be asked, and the mark needs a third state or an explicit ruling that `null` reads as fresh. Not reachable through today's UI; reachable the moment story 14 imports a Recipe.

*Anchors.* Every `core/exec/execute.js`, `ui/EditorPane.vue`, `ui/App.vue` and `ui/SourcesPane.vue` line number was stale and is re-derived above, checked one by one against the tree. `ui/StepPanel.vue` and `ui/StepPanel.test.js` were untouched by 7a and their anchors are confirmed rather than changed.

*Two smaller inheritances.* `ui/App.vue` now takes the run cache as a prop with a default factory, and `:41-48` records the reason a production default needs a test that mounts **without** it — that hole was the top review finding in all three of 7a's rounds, and a mode threaded the same way inherits the obligation. And `ui/EditorPane.vue:89` gained a paragraph explaining that a rename now costs nothing as well as recomputing nothing, which is the sentence this story's rewrite of that comment has to preserve rather than overwrite.

## Design Notes

**Why the stale mark is a key comparison and not a generation counter.** Story 7a gives every Step a content key — `hash(canonical(config) + key(inputs))`. "This Preview belongs to the previous run" is then not a new concept at all: it is `resultKey !== currentKey`, computed with the function that is already there. **Corrected 2026-08-05 after 7a shipped:** an earlier wording of this paragraph said 7a "stores it with the result", and it does not — the keys live in a `Map` local to `executeGraph` and a result carries `{ kind, table, rowCount, columnCount, diagnostics }`. Exposing one per result is this story's edit and it has its own task. The three consequences below are still free once it is; what is not free is the one line that makes them reachable. **Downstream marking**: change a Filter and the Columns Step below it has a different input key, so it marks itself without anyone propagating anything. **Un-marking**: edit a value and edit it back, and the key is the old key again, so the mark clears and no run happens — which is correct, because the shown result *is* current. **Renames and moves**: the key never saw `name`, `x` or `y`, so they mark nothing, and the rule that story 6b measured and story 7b preserved holds here too without a special case. A generation counter would get all three wrong in the same direction: it would mark things that are not stale, which trains the user to ignore the mark.

**Why the mode indicator is in the app header and not in the Editor.** `ui/App.vue:143` mounts the Editor with `v-if`, so it is destroyed on a view switch — and the switch to Quellen is exactly where a Source is loaded and the threshold is crossed. An indicator in the pane would be absent at the moment it has the most to say. The header strip at `ui/App.vue:107-114` is the only chrome rendered in both views, it already carries the build version, and adding the mode to that row costs no height — which matters, because story 6b measured what happens when the Editor's own status band grows: the canvas went from 405 px to 237 px. AD-29's gate 3 asks for the mode to be visible, not for it to be visible in one pane.

**Why the threshold is 100,000 rows, and what would change it.** CAP-38 requires the threshold to be stated and visible and says nothing about its value; the measured constraints call it "an implementation calibration, not a product constant". So the number is taken from the largest shape research actually measured rather than from a feeling: C-3's design point is ~100,000 rows per Source, and at that shape a full pipeline costs 263 ms (Chromium) / 446 ms (Firefox) and the worst case — the earliest edit of a 30-Step graph — costs 578.6 / 1,156 ms. Above 100,000 the numbers are extrapolation. The lower bound the constraints name — "live mode must never begin work the user cannot get out of" — is satisfied at any size once story 7b lands, so it no longer pushes the threshold down; what remains is that live mode above the measured shapes means every edit costs an unmeasured wait. **This is the owner's number** (Ask First): the reasoning is what has to survive a different choice.

**Why the scheduler refuses the run rather than the pane declining to ask.** AD-29 puts the gates in the scheduler "so no second caller can reach execution around them", and the mode is "state the UI reads, never state the UI decides". A pane that checks the mode and then skips calling would satisfy the letter and lose the guarantee at the first second caller — and there will be one, because story 12's run status and story 13's export both want to execute. So every caller still asks, passing why it is asking, and the scheduler answers. In live mode an `edit` trigger runs; in explicit mode it is refused by name and nothing executes. The explicit trigger runs in both.

**How gate 2's absence is rendered honestly.** AD-29's second gate is the Pre-flight Check and story 15 owns it. The gate exists here as a seam the scheduler carries, currently answering "not available", and explicit mode states in German that there is no pre-flight check yet. The alternative — leaving the gate out until story 15 — would make explicit mode look like it had passed a check nobody wrote, which is the same class of lie as a stale Preview looking current and is the reason this story exists. It is stated once, where the run is started, and not repeated on every Step.

**What the config forms are built from in explicit mode, and why it is left alone.** `ui/EditorPane.vue:340` derives `inputSchema` from the last run's results, so above the threshold a Filter's column list is the previous run's schema. That is correct and deliberate: a schema that has not been computed does not exist, and offering columns from a run that has not happened would be inventing them. The Step is marked, and the mark covers what the panel shows including its form; no second sentence is added for the schema.

## Verification

**Commands:**

- `npx vitest run --project core` -- expected: green; `modeFor` and `rowsLoaded` covered, and the scheduler refuses an edit-triggered run in explicit mode by code
- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` return `[]`; `describe('what recomputes and what does not')` passes with the rename and move cases intact and the mode cases added
- `npm run lint` -- expected: clean
- `npm run test:e2e` -- expected: green in chromium and firefox, including the new mode case
- `npm run build` -- expected: `assert-single-file.mjs` passes

**Manual checks:**

- With a Source over the threshold loaded, confirm the mode and the number are readable in both views, that the crossing announcement appears at the moment of the load, and that neither survives longer than it should.
- Confirm the Editor canvas height is unchanged from before this story — the mode indicator is in the header precisely so that it is, and the 405 px → 237 px regression story 6b measured is what this check exists to catch.
