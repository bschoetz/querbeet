# NFR-7 check: is any Editor interaction pointer-only?

**Date:** 2026-08-01 · **Driver:** `run-keyboard-check.mjs` · **Raw data:** `keyboard-results.json`

**As checked: 7 of 10 interactions keyboard-reachable — two NFR-7 gaps, plus one bug the check found
by accident. After the two small fixes: 9 of 11, and one NFR-7 gap left, connecting two Steps.**

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

## Gap 2 — Panning and zooming (NFR-7) — **the load-bearing half is fixed**

The viewport was byte-identical after ArrowRight, ArrowDown, `+`, `-` and PageDown in both engines.
There is still no keyboard path to move or scale the canvas deliberately.

What made it urgent was different, though: focusing a Step did **not** bring it into view, because
the canvas is transformed rather than scrolled, so the browser's own focus-scrolling does nothing. A
Step outside the visible area could be focused, moved and deleted without ever being seen.

**Fixed: the focus now pulls the canvas after it.** A `focusin` handler on the canvas compares the
focused Step's rectangle against the pane's and pans by the shortfall — `panBy`, not `setCenter`,
because panning preserves the zoom level the user chose. A Step parked at 3400,2200 was measured
off-screen before focus and fully visible after, with the zoom unchanged, in both engines. It also
catches Tabbing into a Step's configuration fields, since those are inside the node.

**What remains open** is deliberate pan and zoom — moving the view without moving the focus. It is
small to add, but it is worth deciding whether it is needed at all now that focus drags the view
along, rather than adding key bindings nobody asked for.

## Found by accident — multi-selection was broken for *both* input modes — **fixed**

Selecting a second Step with Control held selected nothing extra: `["q1"]` after the gesture, by
keyboard **and by pointer**, in both engines. The pointer control test is what told this apart from a
keyboard gap — **it was not an NFR-7 gap, it was a design-B consequence.**

`addSelectedNodes` takes a different branch when `multiSelectionActive` is set: it emits selection
changes and mutates nothing. With `applyDefault: false` nobody applied them, so the second selection
was silently dropped.

**Fixed by letting view-state changes through.** `onNodesChange` and `onEdgesChange` now pass
`select` changes — and only those — to `applyNodeChanges` / `applyEdgeChanges`. This is the one place
design B hands anything back to the library, and it is deliberately narrow: the model owns graph
state, Vue Flow owns view state, and view state still has to be applied by someone. Measured after
the fix: `["q1","q2"]` by keyboard and by pointer in both engines.

Both fixes were re-run against the four spike questions, which still pass in both engines with the
build gate intact at 248,579 B in one file.

---

## Where it stands

| Interaction | State |
| --- | --- |
| Reach canvas, select, multi-select, move, add, designate Result, edit config, delete, focus into view | keyboard-reachable, measured |
| **Connect two Steps** | **pointer-only — the remaining NFR-7 gap** |
| Deliberate pan / zoom | no keyboard path; open decision whether it is still needed |

Connecting is ~a dozen lines once the interaction shape is chosen, and the shape is a UX decision —
see the three candidates above. Nothing about it is a technical risk: `connectOnClick` is already on,
and the click path already ends in the guarded door.

The check is reusable: `run-keyboard-check.mjs` is the NFR-7 regression test and takes about a minute
across both engines.

## Two things the check does not cover

- **Screen readers.** Out of scope by NFR-7, and untested. Vue Flow emits `aria-label` and an
  `aria-live` region; whether either is useful was not measured.
- **Focus visibility.** Whether a focused Step is *visibly* focused was not measured. The default
  Vue Flow stylesheet is the only thing styling it, and this spike overrode part of it.
