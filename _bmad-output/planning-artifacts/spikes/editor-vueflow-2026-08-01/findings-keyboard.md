# NFR-7 check: is any Editor interaction pointer-only?

**Date:** 2026-08-01 · **Driver:** `run-keyboard-check.mjs` · **Raw data:** `keyboard-results.json`
**Result: 7 of 10 interactions are keyboard-reachable. Two NFR-7 gaps, plus one bug the check
found by accident.**

Not an accessibility audit. The PRD targets no WCAG level and requires no accessibility testing;
NFR-7 states exactly one rule, and states it as a correctness rule: *no interaction may exist only as
a pointer gesture.* So the method is to enumerate the Editor's interactions and drive each one with
the keyboard alone. Focus starts at the document, as it does for a user arriving with Tab, and every
Tab count starts from a freshly loaded page. Chromium 151 and Firefox 153 agree on every line.

---

## What the keyboard already reaches

R6 recorded that "no such path exists in the box." **That is wrong, and this check corrects it.**
Vue Flow ships `nodesFocusable` and `edgesFocusable` as `true`, `disableKeyboardA11y` as `false`,
puts `tabIndex: 0` on node and edge wrappers, and carries a keydown handler with an `aria-live`
region that announces node movement.

| Interaction | Reachable | Measured |
| --- | --- | --- |
| Reach the canvas | yes | first Step focused after **8** Tab presses (7 toolbar controls first) |
| Select a Step | yes | Enter on a focused Step selects it |
| Move a Step | yes | **5 px** per arrow key, **20 px** with Shift |
| Add a Step | yes | toolbar button, Enter |
| Designate the Result Step | yes | in-node button, Enter |
| Edit a Step's configuration | yes | native inputs |
| Delete a Step | yes | Delete on a selected Step; successor correctly marked broken |

**Two of these are load-bearing for design B and were not obvious.**

Selecting survives `applyDefault: false` because `getSelectionChanges` is called with
`mutateItem: true` and writes `node.selected` straight into the store, rather than proposing a change
that our disabled default applier would have had to apply.

Arrow-key movement survives because it goes the other way: `updateNodePositions` emits position
changes, our own `onNodesChange` writes them into the model, and the projection puts them back. The
drift check stayed clean throughout — **keyboard movement round-trips through the model exactly as
the mouse drag does.**

---

## Gap 1 — Connecting two Steps (NFR-7)

**The only genuine pointer-only interaction, and it is the central one.**

11 handles are rendered, **0** carry a `tabindex`, and none is reachable by Tab. Pressing the
plausible keys on a focused Step (Enter, Space, `c`, `v`, `l`) produced no edge; the edge count
stayed at 5.

The machinery, however, is already there: **`connectOnClick` defaults to `true`**, so Vue Flow models
connecting as *activate handle A, then activate handle B* rather than as a drag, and the click path
ends in `emits.connect(connection)` — the same door the mouse drag uses, which means the same guard
in `model/graph.js`. What is missing is only the focus affordance on the handle.

**The technical fix is small** — `tabindex="0"` on the target and source handles plus a keydown
handler that forwards Enter and Space to the existing click path, roughly a dozen lines in
`StepFrame.vue`. **The design question is not.** Six Steps already render 11 handles; making each one
a tab stop means tabbing past every input of every Step to reach the one you want. At least three
shapes are worth weighing before building one:

- **Handles as tab stops.** Cheapest, and the tab order becomes unusable as the graph grows.
- **A connect mode on the Step.** Focus a Step, press a key, choose target and input slot from a
  list. Fewer tab stops, needs a list UI, and it reads out the slot names Union and Join already
  have.
- **Connect from the input side.** Each Step already renders its input slots as rows with the source
  id in them; making those rows the control ("Eingang 1: …") turns connecting into choosing a value
  in a form, and it disappears entirely on Sources, which have no inputs.

This is a UX decision, not a technical risk, and it belongs to whoever owns the Editor's interaction
design.

## Gap 2 — Panning and zooming (NFR-7)

The viewport was byte-identical after ArrowRight, ArrowDown, `+`, `-` and PageDown in both engines.
There is no keyboard path to move or scale the canvas.

It matters more than it looks: focusing a Step does **not** bring it into view, because the canvas is
transform-based rather than scrolled, so the browser's own focus-scrolling does nothing. A Step
outside the visible area can be focused, moved and deleted without ever being seen.

Two candidate fixes, both small: keyboard handlers on the pane for pan and zoom, or — probably better
and definitely cheaper — call `setCenter` when focus lands on a Step that is outside the viewport, so
the canvas follows the focus. The second one is a few lines and fixes the actual problem.

## Found by accident — multi-selection is broken for *both* input modes

Selecting a second Step with Control held selects nothing extra: `["q1"]` after the gesture, by
keyboard **and by pointer**, in both engines. The pointer control test is what tells this apart from
a keyboard gap — **it is not an NFR-7 gap, it is a design-B consequence.**

`addSelectedNodes` takes a different branch when `multiSelectionActive` is set: it emits selection
changes and mutates nothing. With `applyDefault: false` nobody applies them, so the second selection
is silently dropped.

**Fix: let view-state changes through.** `onNodesChange` currently ignores everything that is not a
position or a removal. It should pass `select` changes to `applyNodeChanges`, keeping the split
honest — the model owns graph state, Vue Flow owns view state, and view state still has to be
applied by someone. Small, but it needs its own measurement, because it is the first place where
design B hands anything back to the library.

---

## Effort to close

| Item | Size | Blocked on |
| --- | --- | --- |
| Multi-selection | a few lines in `onNodesChange`, plus a check case | nothing |
| Focus follows into view | a few lines, `setCenter` on node focus | nothing |
| Keyboard connect | ~a dozen lines once the shape is chosen | a UX decision between the three shapes above |
| Keyboard pan/zoom explicitly | small | worth deciding whether focus-follows-view makes it unnecessary |

The check itself is reusable: `run-keyboard-check.mjs` is the regression test for NFR-7 and takes
about a minute across both engines.

## Two things the check does not cover

- **Screen readers.** Out of scope by NFR-7, and untested. Vue Flow emits `aria-label` and an
  `aria-live` region; whether either is useful was not measured.
- **Focus visibility.** Whether a focused Step is *visibly* focused was not measured. The default
  Vue Flow stylesheet is the only thing styling it, and this spike overrode part of it.
