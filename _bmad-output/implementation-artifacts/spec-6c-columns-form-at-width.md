---
title: 'Story 6c — The Columns form at report width: bulk selection, stable positions, a search'
type: 'feature'
created: '2026-08-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e8aabc8327ac6e738c1edccb07c7b8081478c084'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/findings-columns-step-ui-2026-08-04.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Columns form was built for a four-column fixture and its only verbs are check, type and move-by-one. At the width a report actually has, every interaction is O(n) clicks with no bulk verb and no memory: keeping 3 of 30 columns costs 27 clicks, a deselected column loses its position at the next draft rebuild, and there is no way to find a column in the list.

**Approach:** Make the Columns branch behave like the Filter branch beside it, in `ui/StepPanel.vue` only. An empty selection is an unfinished edit and is simply not committed — which is what lets a "deselect all" button exist without inventing a zero-column config. `readDraft` keeps an unselected column at its input-schema position instead of appending it, and a search box filters visibility only. No new capability: CAP-16 is unchanged and this is the form that operates it.

## Boundaries & Constraints

**Always:**

- **An entry that has not finished is not a change to the config** (`ui/StepPanel.vue:156-169`). A Columns draft with nothing selected is never emitted; the stored config stays in force and the panel says so, reusing the wording `ui/graph-labels.js` already uses ("… die vorherige Einstellung bleibt in Kraft.").
- **`core/steps/columns.js` is read-only here.** The empty list keeps meaning **identity** — every column, unchanged, in input order. No sentinel, no zero-column table, no config-vocabulary change, nothing downstream means anything new.
- **The list order *is* the config order** (CAP-16). Nothing may reorder the list as a side effect of finding, filtering or bulk-selecting.
- Every new control is keyboard-reachable (C-7) and carries an `aria-label` in the pattern the existing controls use. German is written in `ui/` only (AD-13, NFR-6).
- The panel writes to nothing: every change still leaves as one `configure` event (AD-10). Withholding therefore happens in `commit`/`configOf`, not per control.
- No Table, row array or preview cell in `ref`/`reactive`/`computed` (AD-6). The search term is a plain string and may be reactive.

**Ask First:**

- Any change to `core/steps/columns.js`, `ports/index.js`, or the stored config vocabulary.
- Making the editing list order differ from the config order as a *stored* fact (a second `position` field).

**Never:**

- No drag-and-drop reorder (pointer-only gesture, C-7), no "move to top/bottom", no "sort the list alphabetically" verb — the findings listed these as options and none was chosen; a list sort would silently become the output order.
- No row sorting and no First-N — story 6d's, and explicitly not folded in.
- No threshold that hides the new controls below N columns — an invented constant with no source.
- No change to the Filter branch beyond what the shared `commit` requires.
- No new diagnostic code, no `GERMAN` map entry, no `core/`, `ports/` or `adapters/` change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bulk deselect | 30 columns, 3 selected and stored | every checkbox clears; **no** `configure` emitted; the Step still computes with the stored three | the panel states the previous setting stays in force |
| First check afterwards | draft with 0 selected | `configure` emits exactly `{columns:[{from,to}]}` for that one column | N/A |
| Bulk select, no search | any draft | every entry selected; list order unchanged; emits the full list in list order | N/A |
| Bulk verb under a search | term matches 3 of 30 | acts on the 3 visible entries only; the other 27 keep their state | the labels name the visible set |
| Uncheck the last one | one column selected | allowed — no `:disabled`; draft holds 0 selected; nothing emitted | as row 1 |
| Deselected column's place | input `[A,B,C,D]`, config `[A,B,D]` | the list reads `[A,B,C,D]` — `C` sits between its input neighbours, not at the end | N/A |
| Reorder under a search | term active, `↑`/`↓` pressed | the buttons are disabled and the reason is stated — a swap with a hidden neighbour would look like nothing happened | N/A |
| Search matches nothing | term matches no column | a sentence, not an empty list; bulk verbs then act on nothing | N/A |
| Another Step selected | selection or input schema changes | the search term clears with the draft rebuild | N/A |
| Input has no columns | `inputSchema` is `[]` | the existing "keine Spalten" sentence; no bulk, search or list controls | unchanged |

</frozen-after-approval>

## Code Map

- `ui/StepPanel.vue:101-126` `readDraft` — the two-part build (`listed`, then `rest` **appended**) that finding 2 is about. The Columns half is `:115-125`.
- `ui/StepPanel.vue:128-154` the draft watcher — rebuilds on `step.id` and `schemaKey` only, deliberately **not** on a stored-config change (`:134-137` says why). The search term clears here, beside `numberRefusals`.
- `ui/StepPanel.vue:156-171` `isComplete` and its comment — the verbatim precedent this story extends to Columns.
- `ui/StepPanel.vue:173-197` `configOf` / `commit` — the single point where a change reaches the model; `commit` currently emits unconditionally.
- `ui/StepPanel.vue:296-318` the Columns mutators. `selectedCount` (`:300`) already exists and stops driving `:disabled`; `moveColumn` (`:312`) swaps by full-list index and must keep doing so.
- `ui/StepPanel.vue:563-616` the Columns template — one row per entry, keyed by `entry.from`. The `:disabled` at `:585` and its comment at `:578-581` go together, as the story's invoke note says.
- `ui/StepPanel.vue:441-449` and `:540-549` — the Filter's "no condition" and "pending" sentences: the tone and markup the new sentence copies. Note the distinction already made there: `role="status"` marks a *refusal* (`:530-539`), the pending sentence is not one.
- `ui/graph-labels.js:211-217` — the existing "… die vorherige Einstellung bleibt in Kraft." wording to reuse literally. Nothing new enters the map.
- `core/steps/columns.js:22-31` and `:91-97` — read-only evidence that `[]` is identity and that `apply` returns the input handle for it.
- `ui/StepPanel.test.js:262-340` `describe('the Columns form')`. `:287-298` asserts the disabled last checkbox and is the one existing case this story **inverts**; `entries()` (`:74`) and the `field()` helper are reused.
- `tests/e2e/execution.spec.js:171`, `:251`, `:315` uncheck one of three columns — each leaves ≥1 selected, so **no existing e2e case changes meaning** under the new rule (checked, not assumed). `REPORT` (`:44-50`) is the inline-CSV pattern a wide fixture follows.
- `ui/EditorPane.vue:250-267` — the `#step` slot hosting the panel; untouched.

## Tasks & Acceptance

**Execution:**

- [x] `ui/StepPanel.vue` -- `configOf` answers `null` for a Columns draft with nothing selected and `commit` withholds the event; remove the `:disabled` on the last checkbox and its comment -- one withholding rule, applied where the Filter already applies it
- [x] `ui/StepPanel.vue` -- "Alle auswählen" / "Alle abwählen" above the list, acting on the **visible** entries, plus the German sentence shown while the draft holds nothing -- 1 + k clicks instead of n − k
- [x] `ui/StepPanel.vue` -- `readDraft` inserts an unselected column behind its nearest already-placed input-schema predecessor instead of appending it -- a deselected column stops moving to the end
- [x] `ui/StepPanel.vue` -- a search input filtering visibility only; rows render with their full-list index, `↑`/`↓` disabled while the term is non-empty with the reason stated; the term clears in the draft watcher -- finding a column may not reorder it
- [x] `ui/StepPanel.test.js` -- invert the disabled-last-checkbox case and cover every I/O matrix row -- the matrix is where the coverage comes from
- [x] `tests/e2e/execution.spec.js` -- one case at report width over a new inline 30-column fixture: deselect all, check three, counts follow only after the first check -- the O(n) claim is what the story is about

**Acceptance Criteria:**

- Given a Columns Step whose stored config keeps three of thirty columns, when the panel is left and re-entered, then every unselected column sits between its input-schema neighbours and none of them is at the end of the list.
- Given a search term is typed and then cleared, when the list is compared to before, then its order is identical and no `configure` event was emitted by the search itself.
- Given the search box, the two bulk buttons and every list row, when the form is traversed by keyboard alone, then each control is reachable and named (C-7, NFR-6).
- Given `npm run verify`, when it runs, then lint, both Vitest projects and Playwright in Chromium and Firefox are green.

## Spec Change Log

## Design Notes

**Where an unselected column goes, stated exactly.** The stored config lists only selected columns, so a deselected column has no recorded position anywhere and the input schema is the only other source of order. The rule: walk the unselected columns in input-schema order and insert each one immediately **after** the nearest preceding input-schema column already placed in the list; if there is none, put it at the front. In the ordinary case — a config whose order still follows the input — this reproduces the input order exactly, which is the case the finding is about. When the user *has* reordered, the rule is still explainable as "a dropped column stays with the neighbour it follows in the input": input `[A,B,C,D]` with config `[C,A]` gives `[C,D,A,B]`.

**The bulk verbs act on what is visible, and say so.** With no search, visible is all, so "Alle abwählen" clears everything — the case the story exists for. With a search active, acting on the full list would contradict a screen showing three rows, so the verbs act on those three and the labels name the visible set rather than "alle". This keeps search + bulk as the actual 30-column workflow instead of two features that fight.

**Reordering is disabled while a search filters the list.** `moveColumn` swaps adjacent entries of the *full* list; under a filter the neighbour is usually hidden, so the swap is correct in the config and invisible on screen — a change the user cannot see is exactly the failure mode C-10 exists to prevent. Disabling with a stated reason is the honest option, and reordering needs the whole list visible anyway.

**Why the withheld state is not a refusal.** A refusal is a command the model rejected; an empty selection never reaches the model at all. So the sentence is a plain hint like the Filter's pending line, not `role="status"` — the same distinction `ui/StepPanel.vue:530-549` already draws.

**What the withheld draft does not survive.** A draft holding zero selected columns is lost when the watcher rebuilds (another Step selected, input schema changed) and the stored config comes back checked. That matches the Filter's incomplete condition exactly and needs no extra machinery.

## Verification

**Commands:**

- `npx vitest run --project ui` -- expected: green; `graphLabelGaps()` and `kindLabelGaps()` still return `[]`
- `npx vitest run --project core` -- expected: green and unchanged; no `core/` file was touched
- `npm run build && npm run assert` -- expected: one HTML file, structural gate green
- `npm run verify` -- expected: lint, both Vitest projects, Playwright in Chromium and Firefox green

## Suggested Review Order

**The one rule the whole story rests on**

- Entry point: an all-unchecked list answers `null` — not a config meaning "no columns".
  [`StepPanel.vue:216`](../../ui/StepPanel.vue#L216)

- The single place a draft is withheld, so no control has to remember to.
  [`StepPanel.vue:242`](../../ui/StepPanel.vue#L242)

- What that licences: the last checkbox loses its `:disabled`, and the guard's reason with it.
  [`StepPanel.vue:709`](../../ui/StepPanel.vue#L709)

**Where a deselected column goes**

- A lookup, not a search: the input predecessor is always already placed.
  [`StepPanel.vue:157`](../../ui/StepPanel.vue#L157)

- The watcher's reason restated — the old one described the behaviour just removed.
  [`StepPanel.vue:162`](../../ui/StepPanel.vue#L162)

**Finding a column without reordering it**

- Rows carry their full-list index, so a filtered view never renumbers what `moveColumn` swaps.
  [`StepPanel.vue:368`](../../ui/StepPanel.vue#L368)

- The input name is the column's identity — a rename must not hide it from its own search.
  [`StepPanel.vue:359`](../../ui/StepPanel.vue#L359)

- Bulk verbs act on what is visible, and a verb that moves no checkbox commits nothing.
  [`StepPanel.vue:382`](../../ui/StepPanel.vue#L382)

- Reordering is disabled under a term, because the neighbour swapped with is hidden.
  [`StepPanel.vue:722`](../../ui/StepPanel.vue#L722)

**Tests**

- The inverted case: unchecking the last column is allowed and reaches the model as nothing.
  [`StepPanel.test.js:303`](../../ui/StepPanel.test.js#L303)

- The reordered placement rule, pinned by its worked example.
  [`StepPanel.test.js:419`](../../ui/StepPanel.test.js#L419)

- Search after a rename — the assertion that stops `from` becoming `to`.
  [`StepPanel.test.js:443`](../../ui/StepPanel.test.js#L443)

- A no-op bulk press costs no recompute.
  [`StepPanel.test.js:373`](../../ui/StepPanel.test.js#L373)

- End to end at thirty columns; the bulk deselect is asserted against a non-identity config.
  [`execution.spec.js:542`](../../tests/e2e/execution.spec.js#L542)
