# Findings — the Columns Step's configuration UI, and where sorting lives

**Date:** 2026-08-04
**Source:** first hand test of the Editor after story 6b landed (`72a7b63`), three observations by the project owner
**Purpose:** input for cutting the next story. Nothing here is a decision; each finding ends with what is actually true and what the open question is.
**Code under discussion:** `ui/StepPanel.vue` (the Columns form, `:101` `readDraft`, `:298-317` the mutators, `:563-616` the template), `core/steps/columns.js` (the config vocabulary).

---

## Finding 1 — There is no select-all / deselect-all, and only half of that is a missing button

**Observed:** configuring a Columns Step means clicking one checkbox per column. At the design shape this is measurable rather than a matter of taste: story 6b's own performance fixture is 100,000 rows × **20 columns**, so keeping three of twenty columns is seventeen clicks, and there is no control that does it in one.

**Verified in code:** `ui/StepPanel.vue:573-616` renders one row per input column with a checkbox, a rename field and two order buttons. There is no control above or below the list. Confirmed by reading the whole `step-config-columns` block — the only buttons in it are `↑` and `↓`, per row.

**The half that is only a missing button — "select all".** Fully expressible in the config vocabulary today: a config listing every input column in input order is exactly what a freshly added Step means. One button, one `commit`, no model change.

**The half that is not — "deselect all".** `core/steps/columns.js:24` states the rule: *"An empty list means **every column, unchanged, in input order** rather than 'no columns'"*, and `:97` implements it — `if (ordered.length === 0) return { table: input, … }`, the identity. So the empty config is already taken, and it means the opposite of "nothing selected". The UI is consistent with this and says so at `ui/StepPanel.vue:578-581`: the last remaining checkbox is `:disabled`, because unchecking it would show *more* columns rather than none.

**So the real question is not the button, it is what "no columns" should mean.** Three routes, none of them chosen here:

1. **"Deselect all" does not exist**, and the button is only "select all" (plus perhaps "invert"). Honest, cheap, and leaves the seventeen-click case only half solved — you still uncheck seventeen boxes to keep three.
2. **"Deselect all" means "all but the first"**, so the list collapses to one row and the user checks up from there. Solves the ergonomics without touching `core/`, but the button then does not do what it says.
3. **The config gains an explicit empty selection** — a sentinel, or the identity moves from "empty list" to "absent config". This makes a zero-column table representable, which is a question in itself: every downstream Step and the Result table would have to mean something sensible for a table with no columns, and no acceptance criterion covers that state today.

**Recommendation for the cut:** route 1 or 2 belongs in a UI-only story and is small. Route 3 is a config-vocabulary change and should not be smuggled in beside a button.

---

## Finding 2 — A deselected column moves to the end of the list, and that is a consequence, not a decision

**Observed:** deselecting a column and coming back to the Step later shows it at the bottom of the list. Re-checking it leaves it there.

**Verified in code, and the mechanism is exact.** `ui/StepPanel.vue:101-126` builds the draft in two parts:

```js
const chosen = config.columns ?? []
const listed = chosen.map(…)                      // the stored config, in its order
const rest   = columnNames.filter(not in chosen)  // everything else
return { entries: [...listed, ...rest] }          // appended at the end
```

The stored config **only lists selected columns** (`:186-188`: `state.entries.filter(entry => entry.selected).map(…)`). So a deselected column has no recorded position anywhere — it is not in the config, and the only other source of order is the input schema, from which it is appended after everything the config does list. There is nowhere for its old position to have been kept.

**Two corrections to the observation, both worth having before cutting:**

- **The jump is not immediate.** The draft is deliberately *not* rebuilt when the stored config changes (`ui/StepPanel.vue:128-154` documents why: after a refusal the draft must keep the word the refusal is about). So within one continuous session the column stays where it is when you uncheck it. It moves to the end the next time the draft is rebuilt — selecting another Step and coming back, or the input schema changing. This matches "beim nächsten Mal" exactly, and it means the bug is invisible while you are looking at it, which is the worst shape for a defect of this kind.
- **There *is* a way back, it is just a bad one.** `moveColumn` (`:313-317`) swaps adjacent entries regardless of selection state, so `↑` walks a column back up. Re-checking it first, then walking up, does persist — a selected column's position is written into the config. So the accurate statement is not "there is no way" but "the way costs one click per position and nothing remembers where it was."

**Was it intended?** No, and nothing claims it was. The comment at `:111-114` states the intent — *"one row per input column, so unchecking and rechecking is symmetrical"* — and the symmetry it names is about the *checkbox*, not the position. CAP-16 requires only that "column order in the Step determines column order in this Step's output"; it says nothing about where an unselected column sits in the editing list. Story 6b's spec and acceptance criteria are silent on it too. So this is an unspecified consequence of the config shape, discovered by use.

**What a fix would have to decide:** whether the *editing list* order is allowed to differ from the *config* order. Today they are the same object, which is why an unselected column cannot hold a place. Keeping the input-schema position for unselected columns (rather than appending them) is a small change to `readDraft` and needs no model change — a deselected column would then sit where the input has it, which is stable and explains itself. That is probably the right default, and it is a UI-only fix.

---

## Finding 3 — Sorting: it is planned, but only as a view, and the reading of the question matters

The observation was "there is no way to sort columns", with the note that it is unclear where it belongs. It has two readings and they land in different places, so both are answered.

### Reading A — sorting *rows* by a column's values

**It is planned: story 11, "View filter, sort, promotion and full-dataset search" (CAP-32).** But the scope is narrower than it may look, and the narrowness is deliberate and written down (`_bmad-output/specs/spec-querbeet/acceptance-criteria.md:364-371`):

- View filters and sorting apply to the **full Result**, not just the rendered window.
- They are **transient: not stored in the Recipe, and lost on reload.**
- A single action promotes an active **view filter** into a Filter Step — and the promotion path is named for *filters only*. Nothing promotes a sort.

**So there is a real gap, and it is not "sorting is missing" but "no row order ever becomes data".** I checked all 23 stories in `_bmad-output/specs/spec-querbeet/stories.yaml` for a persistent ordering Step: there is none. Story 8 is Union and Join, story 9 is Computed column and Aggregate, and `executorGaps()` in the shipped code names exactly `union, join, computed, aggregate` — no sort kind exists in `core/graph/kinds.js` at all.

The consequence is concrete for the product's own purpose: story 13 is *"Data export — milestone: reports in, consolidated table out"*, and CAP-16 makes **column** order part of the exported data ("Column order in the Step determines column order in this Step's output and, if it is the Result Step, in every export"). There is no equivalent sentence for row order anywhere. As things stand, a user can sort what they look at and cannot sort what they hand over.

**Whether that is a defect or a decision is genuinely open.** An argument exists for the current shape — a consolidated export usually gets sorted by whoever opens it, and a transient sort keeps the Recipe smaller and the Steps fewer. But it should be a decision that was taken, and I found no record that it was: no ledger entry, no line in the SPEC, no note in a story description.

### Reading B — ordering the *columns* themselves

This exists today and is CAP-16's second bullet: the `↑`/`↓` buttons in the Columns Step, and the Step's order is the output order. So nothing is missing capability-wise.

What is missing is ergonomics, and it is the same complaint as findings 1 and 2 wearing a different hat: at twenty columns, moving one column from position 18 to position 2 costs sixteen clicks, and there is no way to sort the *list* (alphabetically, or back to input order) to find a column in it. No story covers this — story 18 is the Column Profile, story 10 is the Result table, and neither touches the Columns Step's form.

---

## What these three have in common, and why it probably wants one story

All three are the same shape: **the Columns Step's form is a flat, unaided list whose only verbs are "check", "type" and "move by one".** It was built for the walking skeleton, where the fixture has four columns, and it is honest at that size. At the design shape the product actually targets — story 6b measured against 20 columns — every one of its interactions is O(n) clicks with no bulk verb and no memory.

A story cut around that reads roughly as: *bulk selection, stable positions for unselected columns, and a way to find a column in a list of twenty* — three UI-level changes in one component, no port change, no `core/` change, with one open question that must be answered first (finding 1's route 3: what, if anything, "no columns" means).

The row-sorting question (reading A) is **not** part of that and should not be folded in. It is a capability question about story 11's transience versus a persistent order, it touches the Recipe, and it deserves its own decision before any code.

---

## Open questions for the story cut

1. **Does "deselect all" exist, and if so what does it mean?** (Finding 1, routes 1–3.) Must be answered before the button is built.
2. **Should an unselected column keep its input-schema position instead of being appended?** (Finding 2.) My reading: yes, UI-only, and it removes the surprise entirely.
3. **Should a row order ever be data rather than view?** (Finding 3, reading A.) Not this story. Wants a decision recorded either way, because right now the absence is undocumented rather than chosen.
