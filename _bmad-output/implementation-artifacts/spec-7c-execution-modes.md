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

**Problem:** There is one execution mode and it is unconditional. `ui/EditorPane.vue:68-88` recomputes after every data-affecting change no matter how much data is loaded — a rule story 6b shipped as an interim and licensed only at design scale — and nothing anywhere tells a user which mode they are in, because there is no mode. Above the measured shapes that rule stops being affordable, and the failure it produces is the worst one this product has: a Preview that looks current while the configuration under it has moved on, with nothing on screen saying so.

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

**Where the mode has to live, and the trap that decides it:**

- `ui/App.vue:103-111` — `EditorPane` is `v-if`, so it is **genuinely unmounted on every view switch**. Any mode, threshold or stale state held in the pane is destroyed when the user visits Quellen — which is exactly where Sources are loaded and therefore where the threshold is crossed. **This is the argument for deriving the mode in `core/` and showing it above the panes.**
- `ui/App.vue:70-76` — the header strip (title, tagline, `build-version`) is **the only page-global chrome in the product**, rendered in both views. `:78-93` the tabs, `:95-101` SourcesPane (`v-show`), `:50` `createStepZeroCache(props.engine)` and `:57-60` `sources = shallowRef(store.list())` with `onSourcesChanged` — the row total is already reachable here and already refreshes.
- `ui/App.vue:24-33` — props `buildVersion, store, graph, engine, canvas`; `app/main.js:42-48` is where anything new is named.
- **Absent:** no mode state, no threshold constant, no global run action, no page-level execution chrome anywhere. `core/exec/execute.js:8` says so in the file that would own it, and `:28` names it as story 7's.

**The row count — what exists and what does not:**

- `core/exec/source-store.js:560-571` — an entry holds `table: { columns, rowCount }` from the reader, frozen. **`entry.table.rowCount` is the loaded-row count per Source**, a plain number on the frozen entry available to every `store.list()` consumer.
- `ui/SourcesPane.vue:891` — the only place it is rendered today: `{{ rowsLabel(s.table.rowCount) }}`, testid `source-counts` at `:888`.
- `ui/EditorPane.vue:23` — the pane already receives whole Source entries, so the number is reachable there too and is currently unused.
- `core/exec/execute.js:186-187` — a Step result carries `rowCount` and `columnCount`; `ports/index.js:27` `Table.rowCount()`.
- **Absent:** there is no sum, no aggregate, no `rowsLoaded` anywhere. The store is the one writer of Source state and is where the total belongs.

**The recompute rule this story supersedes:**

- `ui/EditorPane.vue:68-88` — the interim rule stated in prose at `:71-82` and implemented as `runData(result, options) = run(result, options) + recompute()` at `:84-88`. **The prose is the text this story rewrites**, and it names story 7 explicitly.
- The data-affecting commands, and the call sites that reach them: `:242` `onConnect`; `:342-346` `fromCanvasData` → `:348` `onRemove`, `:349` `onDisconnect`; `:364` `addStep`; `:373-384` `watch(() => props.sources)` with `{ immediate: true }` (fires on a typing confirmation); template `:487` set-result, `:488` connect, `:489` disconnect, `:492` remove, `:511` `@configure` — **`:511` is the main edit-vs-run seam**. Not recomputing, and staying that way: `:486` rename, `:490` add-slot, `:491` remove-slot, `:340` `onMove`.
- `ui/EditorPane.vue:62-66` — the existing `run(result, {quiet})` is a **command** runner, not an execution run. Story 7b already had to work around this name; do not add a third meaning.
- `ui/EditorPane.vue:140` `execution = shallowRef(...)`, `:156-163` `recompute()`, `:166` `resultFor(id)`, `:314-320` `inputSchema` derived from `execution.value.results.get(upstream)` — **note this one: in explicit mode the schema the config forms are built from is already previous-run data**, and the forms must not pretend otherwise.
- `ui/EditorPane.vue:391-405` — the toolbar strip (`Pipeline` heading, one button per addable kind). **The named run action belongs here**, beside the verbs, not in the status band.
- `ui/EditorPane.vue:415-444` — the fixed `h-20` status band, `role="status"`, testids `editor-refusal` / `editor-status`. Story 7b puts progress and cancel in it. **The band's height is measured and load-bearing** — story 6b saw the canvas go from 405 px to 237 px when it grew — so the mode indicator does not go here; it goes in the header.

**Where a stale mark is rendered, and why it must be derived:**

- `ui/StepPanel.vue:46-62` — props `step`, `label`, `inputSchema`, `result` (`{ table, rowCount, columnCount, diagnostics }` or `null`), `nameOf`. **No `stale` prop exists.**
- `ui/StepPanel.vue:550-596` — the preview block: `preview = shallowRef(null)` at `:557`, `status = runStatus(result.diagnostics)` at `:559`, marks at `:561-572`, and **the `watch(() => props.result, …)` at `:574-596` keys off the `result` prop's identity** — so continuing to hand the panel the previous run's result object re-renders nothing, which is precisely the behaviour this story wants.
- `ui/EditorPane.vue:502-512` — `StepPanel` is invoked with `:key="selectedStep.id"`, so it **remounts on every selection change**. Anything held inside the panel resets; a stale mark therefore has to be derived from props, never stored.
- `ui/StepPanel.vue:1088-1110` — the counts block, testid `step-counts`, with three branches. The third — „Nicht gerechnet — dieser Step trägt nicht zum Ergebnis bei oder der Lauf wurde abgelehnt." — is the nearest existing idiom and the mark belongs immediately above it at `:1090`, or as a band at `:605-612`, since counts, marks and preview are all the previous run's together.
- `ui/StepPanel.vue:1112-1136` warnings (`step-status`, `step-marks`), `:1138-1152` the `RowWindow` preview and `step-preview-bound`.
- **The German idiom to match, already used three times:** `ui/StepPanel.vue:775-781` `filter-value-pending`, `:842-850` `columns-selection-pending` („…die vorherige Einstellung bleibt in Kraft. Die neue Auswahl wirkt, sobald …"), `:1075-1085` `first-count-pending`. The rule for whether it gets announced is stated at `:838-840`: a refusal the model rejected carries `role="status"`, a hint that never reached the model does not. **A stale mark is neither — it is a statement about what is on screen, and it changes without the user touching anything, so it is announced.**
- `ui/StepPanel.vue:288` `commit(next)` — the single funnel that emits `configure`; every control routes through it and nothing else needs touching.

**Mode visibility, gates, and the existing gate-1 precedent:**

- `core/exec/execute.js:161-173` — the gate loop; `:27-31` the in-code note that gates 2 and 3 are absent. **This story takes gate 3 and builds gate 2's seam.**
- `core/exec/execute.js:55-65` `CODE` / `EXEC_CODES` — new codes for the refused edit-triggered run and for the threshold crossing land here and therefore in `ui/graph-labels.js:437-447`'s check.
- `ui/SourcesPane.vue:797-801` `confirm()` and `:1247-1262` the „Typen bestätigen" / „Bestätigung aufheben" buttons, `:587-590` `confirmState(s)` → „Typen bestätigt." / „Typen noch nicht bestätigt." — **gate 1's whole surface**, and the tone the mode indicator and the run action should match.
- `ui/SourcesPane.vue:1001-1013` — `parse-pending`: `role="status"`, testid, `text-xs text-slate-500`, rendered as a `v-if`/`v-else-if` pair so it replaces a sibling rather than adding height. The disabled idiom is `:disabled` plus `disabled:opacity-50` (`:912-996`); there is no `.muted` class and `ui/style.css:14-29` is the whole of the app's own CSS. The de-facto token table is `ui/graph-labels.js:452-457` `SEVERITY` (`info` → `text-slate-500`, `warning` → `text-amber-600`).
- `ui/graph-labels.js:186-397` the `GERMAN` map (`exec.*` at `:363-396`), `:76-88` the helpers `q()`, `step()`, `nf()`, `rows(n)` — **`nf()` is what makes the threshold read as `100.000`**, `:431-435` `graphText`, `:437-447` `graphLabelGaps()`.

**Tests:**

- `ui/EditorPane.test.js:298-305` — the comment that names story 7 and the reason this envelope exists: "an e2e run cannot tell a recomputed number from an unchanged one … Here the engine can be counted." `:303-334` `countingEngine()`, `:336-348` `withEngine`, `:350-357` `wired()`, `:359-412` the three cases. **This block is this story's direct predecessor: the rename and move cases stay, and the mode cases join them.** The comment itself has to be rewritten — it currently describes an interim that ends here.
- `tests/e2e/execution.spec.js:714` — the e2e counterpart, `'renaming and moving a Step recompute nothing, while connecting does'`.
- `ui/StepPanel.test.js:10-54` — `mount(StepPanel, …)` with a hand-built `handle(schema, rows)` whose `column()` throws to prove the preview never copies a column, plus a `result()` factory.
- `ui/EditorPane.test.js:18-31` `StubCanvas`, `:44-58` `stubEngine()` + `render()`.
- `vitest.config.js:35-48` — happy-dom's `getBoundingClientRect` is all-zero and `ResizeObserver` is a stub, so **the mode indicator must be assertable by text and `disabled`, never by layout**.
- `tests/e2e/execution.spec.js:18-28` `file://` against `dist/`, `:53-58` locators by testid and role, `:131,147-148` German assertions by exact text (`toHaveText('10 Zeilen, 3 Spalten')`), controls reached by German label (`getByLabel('Anzahl Zeilen')` at `:269`).

## Tasks & Acceptance

**Execution:**

- [ ] `core/exec/mode.js` (new) + test -- the threshold constant with its reasoning in a comment, and a pure `modeFor(rowsLoaded)` → `live | explicit`; export the threshold so the UI can state the number rather than restate it -- one place decides, and it is not a component
- [ ] `core/exec/source-store.js` + test -- a `rowsLoaded()` reader summing `entry.table.rowCount` over every Source in the registry -- the store is the one writer of Source state, so it is the one place that can answer without a second count drifting
- [ ] `core/exec/scheduler.js` + `core/exec/execute.js` + tests -- take the mode and a run trigger (`edit` or `explicit`); **refuse an `edit`-triggered run in explicit mode** with a named code, before any Step; carry a pre-flight gate whose current state is "not available" and which never reads as passed; put each result's content key on the result entry so staleness can be derived -- AD-29: the gates live in the scheduler and the UI reads the mode
- [ ] `core/exec/execute.js` -- new codes in `CODE`/`EXEC_CODES` for the refused edit-triggered run, the threshold crossing, and the unavailable pre-flight check -- the enumeration is what makes the German gap test meaningful
- [ ] `ui/App.vue` -- derive the mode from `store.rowsLoaded()` beside the existing `sources` refresh; render the mode and the threshold in the header strip so both views show it; announce a crossing when the derived mode changes -- the Editor is `v-if` and cannot be the home of state that has to survive a view switch
- [ ] `ui/EditorPane.vue` -- receive the mode; rewrite the `:68-88` interim-rule comment to state the two modes; keep every command committing exactly as now and let the scheduler decide whether a run follows; add the named run action to the toolbar strip at `:391-405` with a German label; in explicit mode state that there is no pre-flight check yet -- an edit never silently becomes a run and never silently does not
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

## Design Notes

**Why the stale mark is a key comparison and not a generation counter.** Story 7a gives every Step a content key — `hash(canonical(config) + key(inputs))` — and stores it with the result. "This Preview belongs to the previous run" is then not a new concept at all: it is `resultKey !== currentKey`, computed with the function that is already there. Three things fall out for free and none of them needs code. **Downstream marking**: change a Filter and the Columns Step below it has a different input key, so it marks itself without anyone propagating anything. **Un-marking**: edit a value and edit it back, and the key is the old key again, so the mark clears and no run happens — which is correct, because the shown result *is* current. **Renames and moves**: the key never saw `name`, `x` or `y`, so they mark nothing, and the rule that story 6b measured and story 7b preserved holds here too without a special case. A generation counter would get all three wrong in the same direction: it would mark things that are not stale, which trains the user to ignore the mark.

**Why the mode indicator is in the app header and not in the Editor.** `ui/App.vue:103` mounts the Editor with `v-if`, so it is destroyed on a view switch — and the switch to Quellen is exactly where a Source is loaded and the threshold is crossed. An indicator in the pane would be absent at the moment it has the most to say. The header strip at `ui/App.vue:70-76` is the only chrome rendered in both views, it already carries the build version, and adding the mode to that row costs no height — which matters, because story 6b measured what happens when the Editor's own status band grows: the canvas went from 405 px to 237 px. AD-29's gate 3 asks for the mode to be visible, not for it to be visible in one pane.

**Why the threshold is 100,000 rows, and what would change it.** CAP-38 requires the threshold to be stated and visible and says nothing about its value; the measured constraints call it "an implementation calibration, not a product constant". So the number is taken from the largest shape research actually measured rather than from a feeling: C-3's design point is ~100,000 rows per Source, and at that shape a full pipeline costs 263 ms (Chromium) / 446 ms (Firefox) and the worst case — the earliest edit of a 30-Step graph — costs 578.6 / 1,156 ms. Above 100,000 the numbers are extrapolation. The lower bound the constraints name — "live mode must never begin work the user cannot get out of" — is satisfied at any size once story 7b lands, so it no longer pushes the threshold down; what remains is that live mode above the measured shapes means every edit costs an unmeasured wait. **This is the owner's number** (Ask First): the reasoning is what has to survive a different choice.

**Why the scheduler refuses the run rather than the pane declining to ask.** AD-29 puts the gates in the scheduler "so no second caller can reach execution around them", and the mode is "state the UI reads, never state the UI decides". A pane that checks the mode and then skips calling would satisfy the letter and lose the guarantee at the first second caller — and there will be one, because story 12's run status and story 13's export both want to execute. So every caller still asks, passing why it is asking, and the scheduler answers. In live mode an `edit` trigger runs; in explicit mode it is refused by name and nothing executes. The explicit trigger runs in both.

**How gate 2's absence is rendered honestly.** AD-29's second gate is the Pre-flight Check and story 15 owns it. The gate exists here as a seam the scheduler carries, currently answering "not available", and explicit mode states in German that there is no pre-flight check yet. The alternative — leaving the gate out until story 15 — would make explicit mode look like it had passed a check nobody wrote, which is the same class of lie as a stale Preview looking current and is the reason this story exists. It is stated once, where the run is started, and not repeated on every Step.

**What the config forms are built from in explicit mode, and why it is left alone.** `ui/EditorPane.vue:314-320` derives `inputSchema` from the last run's results, so above the threshold a Filter's column list is the previous run's schema. That is correct and deliberate: a schema that has not been computed does not exist, and offering columns from a run that has not happened would be inventing them. The Step is marked, and the mark covers what the panel shows including its form; no second sentence is added for the schema.

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
