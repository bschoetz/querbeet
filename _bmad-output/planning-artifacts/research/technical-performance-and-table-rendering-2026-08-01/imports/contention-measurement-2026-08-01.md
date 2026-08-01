# Original measurement — Editor / table contention at 30 Steps (querbeet R4/D4, M6)

**Date:** 2026-08-01 · **Harness:** `editor-table-app/` (a Vite single-file build) + `run-contention.mjs`,
headless Playwright 1.62, real `file://` URL, viewport 1600×1000 · **Engines:** Chromium
151.0.7922.34, Firefox 153.0 · **Raw:** `contention.json`.

## What this is measured against

The app is the **Editor spike's own build** (`spikes/editor-vueflow-2026-08-01/app/`) with its Vue
Flow wiring carried over verbatim — design B, `applyDefault: false`, the single projection watcher,
the guarded mutation doors. Two things are added:

- **A real virtualized table pane**: D1's winning shape, hand-rolled fixed-height row windowing,
  50 rows over a `rowCount × 32 px` spacer, no node recycling, over a frozen 100,000 × 20 dataset.
  Row height is 32 px because that is D1's row-height budget ceiling at half a million rows.
- **A dialable Step count**, 6 or 30, so the PRD's unmeasured upper half is actually measured.

The build gate passes: **`dist/` contains exactly one file**, 251,127 B, with zero occurrences of
`import(`, `fetch(`, `new Worker`, `importScripts`, `@font-face` or `XMLHttpRequest`, and no
non-`data:` `url()`. **Zero requests beyond the document** in both engines, no page errors.

## The measurement

Each case runs 200 window swaps, one per animation frame, and records two things: the **swap cost**
(set offset → Vue patch → forced layout) and the **interval between frames**, because contention a
swap does not see still shows up as a dropped frame. Drags are real pointer drags driven by
Playwright — mouse down on a node, 30 moves, mouse up — running concurrently with the swap loop.

### Chromium 151

| Case | Mount | Heap | Node heights | Swap p50 / p95 / max | Frame p50 / p95 / max | Frames > 50 ms |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| 6 Steps, canvas idle | 33.3 ms | 89.1 MB | 101.9–187.8 px | **3.1 / 5.1 / 6.3 ms** | 16.7 / 16.7 / 16.8 | **0** |
| 6 Steps, node dragging | 33.3 ms | 99.3 MB | 101.9–187.8 px | **2.9 / 5.3 / 6.2 ms** | 16.7 / 16.8 / 16.8 | **0** |
| 30 Steps, canvas idle | 50.1 ms | 107.1 MB | 38.7–92.2 px | **2.9 / 4.3 / 6.0 ms** | 16.7 / 16.7 / 16.8 | **0** |
| 30 Steps, node dragging | 33.3 ms | 103.3 MB | 38.7–92.2 px | **2.9 / 4.4 / 7.5 ms** | 16.7 / 16.7 / 16.8 | **0** |
| 30 Steps, all 30 bodies resized | 33.3 ms | 114.1 MB | 60.1–113.6 px | **2.9 / 5.4 / 7.6 ms** | 16.7 / 16.7 / 16.8 | **0** |
| 30 Steps, no table pane, dragging | 33.3 ms | 103.5 MB | 64.4–153.6 px | — | 16.7 / 16.7 / 16.8 | **0** |
| 30 Steps, table back, dragging | 33.4 ms | 118.7 MB | 38.7–92.2 px | **3.0 / 4.9 / 7.4 ms** | 16.7 / 16.7 / 16.8 | **0** |

### Firefox 153

Firefox exposes no `performance.memory`, and its timer resolution is ~1 ms, which is why its swap
figures are integers.

| Case | Mount | Node heights | Swap p50 / p95 / max | Frame p50 / p95 / max | Frames > 50 ms |
| --- | ---: | --- | ---: | ---: | ---: |
| 6 Steps, canvas idle | 33 ms | 101.9–189.9 px | **5 / 8 / 24 ms** | 17.02 / 17.08 / 17.42 | **0** |
| 6 Steps, node dragging | 33 ms | 101.9–189.9 px | **4 / 7 / 12 ms** | 17.02 / 17.06 / 33.14 | **0** |
| 30 Steps, canvas idle | 67 ms | 38.7–94 px | **4 / 7 / 8 ms** | 17.02 / 17.10 / 33.26 | **0** |
| 30 Steps, node dragging | 33 ms | 38.7–94 px | **4 / 6 / 8 ms** | 17.02 / 17.06 / 33.08 | **0** |
| 30 Steps, all 30 bodies resized | 33 ms | 60.1–115.4 px | **4 / 6 / 8 ms** | 17.02 / 17.06 / 17.16 | **0** |
| 30 Steps, no table pane, dragging | 33 ms | 64.4–156.6 px | — | 17.02 / 17.08 / 17.38 | **0** |
| 30 Steps, table back, dragging | 33 ms | 38.7–94 px | **4 / 6 / 9 ms** | 17.02 / 17.06 / 17.24 | **0** |

## What it says

**There is no measurable contention.** The swap costs the same at 30 Steps as at 6, the same while
a node is being dragged as while the canvas is idle, and the same while all 30 node bodies are
resizing at once. The frame interval sits at 16.7 ms (Chromium) / 17.02 ms (Firefox) — a locked
60 Hz — in every case, and not one frame exceeded 50 ms in either engine across 2,800 swaps.

**The ResizeObserver storm is real and it is cheap.** Driving every node's height from a CSS custom
property changes all 30 at once — heights move 38.7–92.2 px → 60.1–113.6 px — and the whole
operation, including 30 observer callbacks and the relayout, costs **32.2 ms (Chromium) / 33 ms
(Firefox)**, once. It is a one-off cost on a deliberate action, not a per-frame tax, and the swap
loop running through it never noticed.

**Cold mount at 30 Steps: 50.1 ms (Chromium) / 67 ms (Firefox).** Later rebuilds in the same page
cost 33 ms because the code is warm; the first figure is the honest one. R6 measured 62.4 / 61 ms
at 3–4 nodes, but that number covers a full page mount and this one covers a graph rebuild inside a
live page, so they are not the same quantity — what they jointly support is that the count is not
where the cost lives.

## Two things this measurement got wrong first, and how

Both would have produced a confidently wrong claim, so they are recorded rather than quietly fixed:

1. **The first swap measurement read layout synchronously after `scrollTo()`** — before Vue had
   patched the DOM, since Vue patches on the microtask queue. It reported a swap p50 of **0.1 ms**,
   which is the cost of laying out the *old* DOM. Awaiting `nextTick()` and only then forcing layout
   gives the 3 ms figure, which is the same quantity D1 measured at 4.1 ms.
2. **The first "ResizeObserver storm" resized nothing.** It lengthened each node's *name*, which
   lives in a fixed-height `<input>` — the node heights in that run were byte-identical to the
   un-stormed cases ([38.7, 92.2] px in both), which is what gave it away. Driving height from CSS
   is what actually moves 30 boxes at once.

**One non-reproducing observation, reported because it is a caveat on the method.** An earlier run
of this harness showed Firefox at 30 Steps with a node dragging producing 8 frames over 50 ms and a
frame p95 of 34.14 ms. It did not reproduce in the clean run above (p95 17.06 ms, zero long frames).
The earlier run shared the machine with an npm install and two Vite builds; this one ran alone.
**Treat the tables above as the result and the earlier one as an artefact of a loaded machine** —
and note that this is exactly the kind of measurement a busy real machine can degrade.
