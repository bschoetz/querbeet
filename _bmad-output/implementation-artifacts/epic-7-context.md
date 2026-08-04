# Epic 7 Context: Execution full build — cache, cancellation, execution modes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 7 turns epic 6's walking skeleton into the real execution owner: a content-addressed per-Step cache that stores each result with its diagnostics and replays them on a hit, cancellation that the scheduler checks between Steps, and the two execution modes — live below a stated row threshold, explicit above it — with the mode in force always visible where the user is working. It is where execution stops being a function someone calls and becomes a scheduler with gates: story 6b shipped gate 1 (types confirmed) and named gates 2 and 3 as this epic's. Gate 2 depends on a Pre-flight Check that does not exist yet (story 15), so its absence must be rendered honestly rather than implied satisfied.

**The epic is three stories, split by the project owner on 2026-08-04** (the reasoning is in `stories.yaml` above the entries and in the spec's `.memlog.md`). The id `7` is retired. Only `7b → 7c` is a real dependency; the cache is downstream of neither.

## Stories

- Story 7a: The per-Step cache — content-addressed, diagnostics replayed, bounded
- Story 7b: The scheduler — cancellation between Steps, progress, and a run with an identity
- Story 7c: The two execution modes — a stated threshold, a visible mode, and a stale mark

## Requirements & Constraints

- **Two modes, one visible piece of state (CAP-38).** Below the threshold every configuration change recomputes the affected Steps and everything downstream with no action required. Above it, edits change configuration without recomputing, Previews and Result are **marked as belonging to the previous run**, and a named action starts the new one. The mode is *stated, not inferred* — a user must never be in doubt whether what they see reflects the Step in front of them.
- **The threshold is a number the user can read**, not a hidden heuristic, and crossing it is **announced when it happens** rather than discovered. It is a property of the session and its data, never of the Recipe: the same Recipe over a larger extract gets explicit mode with the Recipe saying nothing.
- **Recomputation is incremental in both modes** — a change recomputes that Step and its dependents, never the Steps above it. Per-Step previews update on the same terms (CAP-19).
- **The threshold is an implementation calibration, not a product constant.** What bounds it from below: an execution that has started can only be stopped between Steps, so **live mode must never begin work the user cannot get out of.**
- **Scale (C-3).** ~100,000 rows per Source, ~500,000 total. The worst case is not the largest graph but the earliest edit in one: editing Step 0 of a 30-Step graph costs **578.6 ms (Chromium) / 1,156 ms (Firefox)** — the number the progress affordance is designed against. Editing the last Step costs **24.1 / 54 ms cached against 496.4 / 1,394 ms recomputed**, a factor of 20–26. Holding all 30 intermediates costs **180 MB** at half a million rows, on top of ~217 MB for the Sources.
- **A long-enough run shows progress and leaves the interface responsive**, on the same terms as the exports. Progress is nearly free — 100 messages over 571 ms of work cost about 2.6 % — so there is no reason to be stingy with granularity.
- **Make the silent failures visible (C-10).** A cache hit that does not replay its diagnostics makes every repeat run look clean; that is the failure this product exists to avoid, not a nicety.
- **Keyboard reachability (C-7)** — cancellation and the explicit run action included. **German UI, English code and docs (C-6).**

## Technical Decisions

- **AD-8 — the cache is content-addressed.** `key(step) = hash(canonical(config) + key(inputs))`, base case `key(source) = hash(byteDigest + parseConfig)`. **A Source id alone is never a key**, because an encoding, delimiter, header-row, flattening or damage decision re-parses without changing the id. **An entry stores the table and its diagnostics together and a hit replays them.** The cache is bounded by total retained rows with least-recently-used eviction; **eviction is a cache miss, never a wrong answer.**
- **The cache key needs a canonical form of a config** — fixed key order, one serializer. The Recipe file (story 14) shares that same serializer by convention; whichever story builds it first, there must not be two.
- **AD-9 — cancellation is between Steps, through the message queue.** There is no shared cancellation flag on this platform: `SharedArrayBuffer` is hidden from `file://` in both engines, `typeof Atomics` reports the opposite of the truth, and the documented `WebAssembly.Memory({shared: true})` escape hatch yields a buffer neither engine will post. Cancel latency through the queue is 3.0 / 2 ms at ~5 ms chunks. **Exit latency is one Step, not one chunk.**
- **Row-range chunking inside a Step is permitted only for row-independent kinds** — Filter, Columns, Computed Column, typing — and is **forbidden for Aggregate, Join and Union**, where a partial view computes partial groups, misses cross-chunk matches and recomputes a per-chunk column union. Anything chunked here must therefore be per-kind, because stories 8 and 9 add the forbidden kinds.
- **AD-29 — three gates, all in the scheduler, none bypassable from the UI:** every Source's type mapping confirmed, the Pre-flight Check shown, the mode in force visible. **The mode is derived from the loaded row count against the stated threshold and is state the UI reads, never state the UI decides.**
- **Steps stay pure and synchronous (AD-4/AD-2); the yield point is the scheduler around them.** Execution stays on the main thread — workers exist for the two exports only (AD-15), and moving a dataset to a worker in order to compute on it is a measured loss.
- **AD-6 — the cache is the registry.** Tables live in a plain `Map` keyed by Source/Step id; neither a row array nor a Table handle may enter `ref`, `reactive` or a `computed`. `ui/` holds them through `shallowRef` alone.
- **AD-13 — diagnostics have one shape** (`severity` of `info | warning | error | unresolved`, stable `code`, structured `values`), and `core/` emits codes, never prose. A replayed diagnostic is the same value, not a re-derived one.
- **AD-25 — a run has an identity.** Run id and start time come from a `Clock` port so the core stays pure; diagnostics, run status and exported documents all carry them.
- **AD-18 test envelope.** `core/exec` runs under Vitest with no browser; a core test that needs a DOM means the layering broke.

## UX & Interaction Patterns

- **The mode indicator lives where the user is working**, not in a settings screen. The owner's standing decision: if users report being surprised by the switch, **the fix is to make the indicator louder, not to remove a mode.**
- **Stale is a stated condition.** In explicit mode a Preview or Result carries the fact that it belongs to the previous run; nothing may look current by default.
- **Nothing has to defend the Editor's frame rate.** A 50-row window swap costs 2.9–3.1 / 4–5 ms identically at 6 and 30 Steps, idle and during real pointer drags, with not one frame over 50 ms across 2,800 swaps — so live mode and the Result pane do not contend.

## Cross-Story Dependencies

- **6a/6b → 7.** Story 6b built the topological walk, Step zero on the execution path and gate 1, and deliberately shipped **no cache, no memoization, no cancellation, no mode switch, no threshold** — all named as this story's. Its interim rule, which this story replaces, is: recompute after every *data-affecting* change (`connect`, `disconnect`, `configureStep`, `removeStep`, `setResult`, `syncSources`), never after a rename or a move.
- **Story 15 → 7 (gate 2).** The Pre-flight Check that explicit mode is supposed to show first does not exist yet. Build the gate seam, render the missing check honestly, and do not let its absence read as "checked".
- **7 → story 12.** The run status is pure aggregation of the diagnostic stream this scheduler emits; the diagnostics-replaying cache entry is what keeps a repeat run from certifying clean over warnings it never re-emitted.
- **7 ↔ story 14.** The canonical serializer is shared between the cache key hash and the Recipe file; a byte-identical round trip is a test on it.
- **7 → stories 8/9.** Union, Join and Aggregate executors arrive later and are the kinds the chunking prohibition names.
- **Ledger entry to close here.** The Step-zero conversion measured at **548–555 ms** at the design shape runs inside a render function on the main thread, uncancellable. It was carried from 6a to 6b as the scheduler's shape rather than the pane's. Two things to decide: that Step zero runs the same path as every other Step (AD-7 says it should), and what the Sources pane shows while it does.
