# Measured Constraints — querbeet

Companion to `SPEC.md`. Findings that were **measured**, not argued, and that bind the build.

**Scope rule for this file:** the architecture spine (`ARCHITECTURE-SPINE.md`) absorbed most of these measurements into invariants AD-1 to AD-30, and where the spine speaks it is authoritative and is not restated here. What follows is the residue — numbers that justify a capability's cost, hazards the spine names without their figures, and findings no AD covers. One rule, one place.

Unless noted, engine pairs are Chromium / Firefox, and all browser figures were taken from a `file://` page rather than a dev server.

## Export cost, which is why CAP-36 must show progress

Earlier figures were taken in Node and understated the browser badly. Re-measured from `file://`:

| Export | 100,000 rows | 500,000 rows |
| --- | --- | --- |
| XLSX | 4,943.8 / 5,805 ms | 26,269.7 / 30,558 ms |
| Parquet | 1,553.6 / 801 ms | 9,717 / 4,369 ms |

XLSX **does not scale linearly**. Firefox is roughly twice as fast as Chromium on the Parquet path. Across eight main-thread-versus-worker pairs, a worker removes 88–98 % of the main-thread block for between −0.9 % and +18.8 % elapsed time — which is the whole argument for moving both exports off-thread.

**Moving a dataset to a worker in order to compute on it is a straight loss**, and the spine states that rule. The nuance it omits: engine column arrays are about 30 % cheaper to send than frozen row objects, but the full round trip is *worse*, so the columnar intuition is only half right.

## Cancellation and progress

The spine records that there is no shared cancellation flag on this platform and that a `typeof` check reports the opposite of the truth. Two details behind it:

- The documented `WebAssembly.Memory({shared: true})` escape hatch yields a memory neither engine will post. It is not a workaround.
- Cancelling through the message queue costs 3.0 / 2 ms at ~5 ms chunks, and progress reporting costs about 2.6 % overhead. Both are cheap enough that the design is not a compromise.

## The execution threshold has a measured shape

Editing a Step recomputes it and everything downstream, so **the worst case is not the largest graph but the earliest edit in one**: changing the first Step of a 30-Step graph costs 578.6 / 1,156 ms, and that is the number the progress affordance is designed against.

**The threshold itself is an implementation calibration, not a product constant.** CAP-38 requires only that whatever it is, it is visible and stated. What bounds it from below is that an execution which has started can only be stopped between Steps, so live mode must never begin work the user cannot get out of.

**There is no Editor-versus-table contention**, measured against a real build with a virtualized table pane beside the canvas: a 50-row window swap costs 2.9–3.1 / 4–5 ms identically at 6 and at 30 Steps, idle and during real pointer drags, and **not one frame exceeded 50 ms across 2,800 swaps** in either engine. So live mode does not have to defend the Editor's frame rate against the Result pane. The per-node `ResizeObserver` is real and cheap — resizing all 30 node bodies at once costs 32.2 / 33 ms once, not per frame.

## Type detection is budgeted as rows × columns × candidates

No parsing library infers a format from the data — every candidate examined requires the caller to supply the pattern — so the loop that tries candidate formats and counts how many values each accepts is querbeet's own code in every scenario, and **CAP-9's full-column scan multiplies it by the candidate list rather than by the column.**

The one measured point: Luxon at 356 ms per 100,000 values *per candidate* even with its precompiled parser, roughly 7 s for a 100k × 20 Source. That is what disqualified it.

Two adjacent traps of the same family:

- **Day.js silently ignores a format string when its plugin is not registered.** `dayjs('12-25-1995','MM-DD-YYYY')` returns the right date through the native path while `dayjs('25.12.1995','DD.MM.YYYY')` returns Invalid Date.
- **`Intl` will happily report separators for a locale nobody in the column is using.** It answers what a locale's characters are; it does not answer which locale the data is in.

## Engine hazards, with the figures the spine omits

The spine's engine-adapter invariant names these hazards and assigns them to the adapter. The numbers behind two of them:

- **Null join keys never match and no option overrides it.** Sentinel substitution before joining costs 30.8 ms at 100k rows; a custom predicate function collapses the engine to an O(n·m) loop join, projected at ~3.7 s. So sentinels are the affordable fix — **but only against a lookup whose keys are unique.** When *both* sides carry nulls in the key column, which a graph makes easy since two branches of one Source inherit its nulls, every sentinel row matches every sentinel row and output grows quadratically: 28,000 source rows produced 2,687,670 join rows, and at 100,000 it crashed the tab. Null keys silently *drop* rows and the sentinel silently *multiplies* them, which is worse. Three remedies are available — exclude sentinel rows from the join and re-attach them afterwards, give each side a distinct sentinel so they cannot match, or refuse the join. **CAP-14 additionally requires a warning when both inputs carry nulls in the key column**; that is a UX requirement, not only an implementation detail.
- **Duplicate keys produce a Cartesian product.** `lookup()` is the row-count-safe alternative where the semantics allow it.
- **The engine's own CSV entry point converts German `"1.234"` to 1.234** and samples only the first 1,000 values before applying a parser to the whole column. This is the concrete reason parsing belongs to the reader and typing is Step zero.

## Rendering

- **Fixed row height is the default, not a compromise.** Every documented failure mode in virtualization — list jumping, wrong scroll targets, upward drift — comes from dynamic heights.
- **Do not build column virtualization.** 50 columns × 50 rows measured at 11–14 ms per swap. Column virtualization is where the leading library visibly breaks, and where sticky columns fight the virtualizer.
- **The scroll-extent cliff, precisely.** Firefox does not clamp oversized elements; above roughly 17.2 million pixels it collapses them to zero height and the list silently vanishes. Chromium clamps at 33,554,428 px instead. At 28 px rows the Firefox cliff is around 614,000 rows — and since C-3 speaks of half a million rows in total and a Union of several large Sources can produce a single Result table close to that, the guard protects a case that can actually arise.
- **Keep windowing behind a component whose props are `(rows, rowHeight, windowSize)`,** so swapping in the runner-up virtualization library later rewrites one file.
- **Accessibility bookkeeping is manual** where it is done at all: `aria-rowcount`/`aria-colcount` carry the totals, `aria-rowindex`/`aria-colindex` the true positions. Ctrl+End moving focus to the last *rendered* row is a known unsolved problem in this pattern. Per C-7 none of this is required.

## Freezing datasets

The spine records the reactivity penalty and the rule. Two supporting facts: `Object.freeze` removes it entirely — no proxy is created at all — for about **4 % more heap**; and **the framework's reactivity skips non-extensible objects, so the freeze is itself the protection.** The editor library's `markRaw` advice does not apply to a frozen payload.

## The graph Editor, as built and measured

A spike built the Editor and opened it from `file://`.

- **The variable-height tripwire passes.** The same asynchronous-DOM-geometry failure is filed against two independent node-graph codebases; here anchors drift **0 px in Chromium and 0.02 px in Firefox across five runtime height changes**. This is what makes the growing Step tile safe to build.
- **The editor library ships no cycle detection whatsoever** — zero occurrences of `cycle`, `acyclic` or `topological` in the published bundle — and its `addEdges` created a cycle on a three-node chain without complaint. The guard was verified to refuse on the pointer path, the programmatic path and the Recipe loader; the programmatic path is the one both a Recipe loader and an LLM-authored Recipe use.
- **The library copies the node objects it is handed**, which is why the app's model owns the truth and the library is a projection of it.
- **The Recipe round-trips byte-identically** at 1,309 B for a six-Step graph, with six rejection classes each naming its defect specifically enough to paste back to a model.
- **Keyboard reachability is better than assumed.** Nine of eleven Editor interactions are keyboard-reachable in both engines: reaching the canvas, selecting, multi-selecting, moving (5 px per arrow, 20 px with Shift), adding a Step, designating the Result Step, editing configuration, deleting, and focus returning to the canvas. The library ships `nodesFocusable`, `edgesFocusable`, `tabIndex: 0`, arrow-key movement and an `aria-live` region — all of which a hand-built canvas would have had to write. The two fixes this needed were four and fifteen lines. **Connecting two Steps is the one gap**, and it waits on a UX decision rather than on anything technical: click-to-connect is already enabled and its click path ends in the same guarded door as the drag.
- **Footprint cannot decide this question.** The editor costs 0.32–2.76 MB of heap against ~94 MB for one Source table.
- **The single-file gate separated nothing.** All three finalists — Vue Flow 1.48.2, BaklavaJS 2.8.1 and a hand-built canvas — build to exactly one HTML file (175,233 / 73,532 / 224,382 B), contain zero occurrences of `import(`, `fetch(`, `new Worker`, `@font-face` or a non-`data:` `url()`, and issue zero network requests beyond the document in Chromium 151 and Firefox 153. The lazy-loading hazard the screening plan was built around is real in the wider field — `@maxgraph/core` fetches four `.gif` files by relative URL — but absent among the candidates that mattered. A future evaluation should not expect this gate to do the work.
- **If undo/redo, clipboard or subgraphs ever become requirements, the fallback is BaklavaJS**, which ships all three plus a topological sort — not the hand-built canvas that the research scored above both.

## Session storage under `file://`

- **A `file://` page has an opaque origin, and every local page shares one storage bucket.** A page in a *different directory*, opened by its own `file://` URL, read back a full 100,000-row Source written by another directory's page — in Chromium 151 and Firefox 153 alike. This cannot be fixed from inside querbeet; it is what an opaque origin means. It is the measurement behind C-8's qualification and CAP-25's disclosure wording.
- **Write cost.** At 100,000 rows the write is comfortably below the threshold where a tab visibly freezes; projected to half a million it lands *on* that threshold in Firefox and below it in Chromium — close enough that CAP-25's progress affordance is required rather than optional.
- **Storage is about a tenth of the heap:** 100k × 20 rows occupy 8.9 MB stored against ~94 MB live.

## Excel format codes are locale-neutral, and the German-looking one is the trap

Measured 2026-08-02 against the pinned `write-excel-file` 4.1.1, output inspected in `xl/styles.xml` and rendered through LibreOffice under `LC_ALL=de_DE.UTF-8`. Apparatus: `planning-artifacts/spikes/xlsx-german-format-2026-08-02/`.

xlsx stores a format code **locale-neutrally** — `.` is the decimal separator and `,` the thousands separator *inside the code* — and the reading application renders it per the user's locale. So:

- **Write `#,##0.00` and `dd.mm.yyyy`.** Under a German locale these render `1.234,56` and `31.12.2025`.
- **Never write `#.##0,00`.** It is the code a German-speaking developer reaches for and it is a defect: measured, it renders as `1.234,56000`.
- **Do not use the `[[$]-407]` locale prefix.** It renders correctly but is unnecessary, and it *pins* output to German rather than following the reader's locale — wrong for a file the recipient may open anywhere.
- Date codes are case-insensitive; `dd.mm.yyyy` and `DD.MM.YYYY` render identically.

The library passes codes through verbatim and rewrites nothing, so the whole decision sits in querbeet's own adapter. Round-tripped: 7 of 7 numeric cases come back as real numbers, 4 of 4 dates as real dates, `0123` survives as text, and umlauts and the euro sign survive — which matters because a format code applied to a string formats nothing.

Two API facts the adapter will otherwise rediscover: `write-excel-file` 4.1.1 has **no `filePath` option** — the call returns `{ toBuffer, toStream, toFile }`, and the browser path is `toBuffer`; and `read-excel-file` 9.3.5 returns `[{ sheet, data }]` rather than a flat grid when no sheet is named.

## The prompt block owes a numeric filter example

The block template illustrates a filter twice, and both illustrations are text comparisons. That is why five independent authoring runs had to guess whether a `>` comparison value is a string or a number, and why four of them guessed wrong — against a currency column formatted `1.234,56`, those two readings plus a locale-aware parse give three different answers. The template is the cheapest half of the fix (CAP-27); **the ingest validator (CAP-28) is the half that has to hold regardless**, because a model that never saw the template can still paste a Recipe in.

The shape that produced the split turns out to be a major vendor's own reference schema for exactly this `column`/`operator`/`value` step, with `value` typed as string, number or object and no discriminator. The five authors were guessing at an ambiguity the industry left in place.
