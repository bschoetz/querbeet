# Original measurement: reactivity cost over a 100k-row dataset

Run for this decision on 2026-08-01. Script preserved alongside as `reactivity-bench.mjs`;
every number below is reproducible with it.

## Why this was measured

The retrieved literature could not ground a memory budget. Vue's own performance page is
qualitative throughout (its only quantity is the rhetorical "100,000+ properties"), and the
one independent measurement found — AwesomeAlpine's 471.6 bytes per proxy — is undated,
Node/Deno/Bun rather than a browser, carries no machine spec, and its author states no raw
timings were kept. A load-bearing gate (G5: render a live preview over ~100k rows without
the data entering the reactivity system) cannot rest on that. So it was measured directly.

## Method

- **Engine:** Node.js v26.5.0 (V8), Linux x86-64, this machine. V8 is the engine behind
  Chrome and Edge; Firefox (SpiderMonkey) is not covered and may differ.
- **Data:** 100,000 rows × 20 columns, plain objects; every third column numeric, the rest
  short strings. Plain data cost measured separately: **159.7 MB, ~1675 bytes per row**
  (the frozen variant costs 166.6 MB / 1747 bytes — freezing itself is not free).
- **Builds:** `@vue/reactivity` **3.1.1** — the version Alpine.js 3.15.12 pins (`~3.1.1`),
  fetched from jsDelivr — and `@vue/reactivity` **3.5.40** (published 2026-07-16), the
  current release, to see whether Vue 3.5's reactivity rewrite changes the picture.
- **Procedure:** build the data, force GC twice, record heap; then wrap (or not) and read
  every property of every row — Vue converts nested objects lazily on property get, so a
  full traversal is what actually materialises the proxies; force GC twice again, record
  heap. The delta is the cost the reactivity layer adds on top of the data.
- **The `-effect` variants** run that traversal inside `effect(...)`. This is the case that
  matters: without an active effect, reads are tracked into nothing. A render function or a
  computed reading the data registers a dependency for every key it touches, and those dep
  sets — not the proxies — are where the memory actually goes. Measuring without an effect
  understates the cost by a factor of roughly fifty, which is the trap this run fell into on
  the first pass.
- One process per case, so no case contaminates another's heap.

## Results

| Build | Case | Added heap | Bytes/row added | Wrap | Traverse | Array proxied | Row proxied |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.1.1 | plain (no reactivity) | 0 MB | 0 | — | 107.3 ms | no | no |
| 3.1.1 | `reactive()`, no effect | 7.9 MB | 82 | 0.4 ms | 398.9 ms | yes | yes |
| 3.1.1 | **`reactive()` in effect** | **436.8 MB** | **4580** | 0.3 ms | 1193.2 ms | yes | yes |
| 3.1.1 | `shallowReactive()` in effect | 21.2 MB | 222 | 0.4 ms | 241.5 ms | yes | no |
| 3.1.1 | **frozen rows + `reactive()`** | **0 MB** | **0** | 0.3 ms | 89.9 ms | no | no |
| 3.1.1 | frozen rows, in effect | 0 MB | 0 | 0.3 ms | 115.7 ms | no | no |
| 3.5.40 | plain (no reactivity) | 0 MB | 0 | — | 104.8 ms | no | no |
| 3.5.40 | `reactive()`, no effect | 7.9 MB | 82 | 0.3 ms | 468.9 ms | yes | yes |
| 3.5.40 | **`reactive()` in effect** | **478.5 MB** | **5017** | 0.4 ms | 1410.5 ms | yes | yes |
| 3.5.40 | `shallowReactive()` in effect | 23.4 MB | 245 | 0.4 ms | 255.4 ms | yes | no |
| 3.5.40 | **frozen rows + `reactive()`** | **0 MB** | **0** | 0.3 ms | 90.6 ms | no | no |
| 3.5.40 | frozen rows, in effect | 0 MB | 0 | 0.3 ms | 96.7 ms | no | no |

A checksum over the traversal is identical in every case, so all cases read the same data.

## Findings

1. **Deep reactivity over the dataset is not affordable.** Inside a render effect it adds
   ~437 MB (Alpine's engine) to ~479 MB (current Vue) on top of 160 MB of data — roughly
   **three to four times the data itself**, per 100k-row source — and slows a full read from
   ~105 ms to ~1.2–1.4 s, an 11–13x penalty. With five sources loaded this is the difference
   between a working tool and a dead tab.
2. **`Object.freeze()` on the rows is a complete escape hatch, and it is exact.** Zero added
   heap, zero proxies created (`array_is_proxy: false`, `row_is_proxy: false`), and traversal
   back to plain-object speed. This confirms the mechanism read out of Alpine's bundle:
   `getTargetType` returns INVALID for a non-extensible value, so `createReactiveObject`
   returns the raw target untouched. It holds identically on Alpine's pinned 3.1.1 and on
   current 3.5.40 — so this is not a version accident, it is the documented-by-code contract
   of `@vue/reactivity` across five years of releases.
3. **`shallowReactive` is the second-best hatch, not an equal one.** 21–23 MB and ~250 ms:
   perfectly usable, ~20x cheaper than deep reactivity, but still ~250x more expensive than
   freezing. It keeps the array itself reactive, which is what you want when the *root* must
   trigger renders; freeze is what you want for the row objects.
4. **Vue 3.5's reactivity rewrite does not help this shape — it is marginally worse.**
   478.5 MB vs 436.8 MB and 1410 ms vs 1193 ms. Whatever 3.5 improved, it was not the
   dep-set cost of tracking a very wide read. The corollary matters for the decision: Alpine
   being pinned to a 2021 reactivity core costs nothing *here*.
5. **The blog-derived estimate was low by an order of magnitude.** The AwesomeAlpine anchor
   (471.6 bytes/proxy) suggested deep reactivity would roughly double the heap. Measured at
   this shape it is ~4580 bytes/row, because the dominant cost is per-*key* dependency
   tracking (20 keys/row), not per-object proxy allocation. Any estimate derived from
   proxy count alone will understate this badly.

## Limits of this measurement

- V8 via Node, not a browser tab. Browser heap accounting includes DOM and renderer overhead
  this does not capture; SpiderMonkey is entirely untested. The *ratios* should transfer; the
  absolute megabytes are indicative.
- One machine, one run per case, no repetitions and no variance reported. The effects are
  large enough (multiples, not percentages) that run-to-run noise does not threaten the
  conclusions, but a precise number would need repetition.
- `effect()` here performs one full read of every key. A real preview renders ~50 rows, so
  the realistic tracked set is far smaller — this measures the **worst case**, which is what
  a hard gate should be tested against. The failure mode it models is real and easy to hit:
  any computed that scans the whole array inside an effect.
- Alpine itself was not loaded (its bundle expects a DOM); the engine it wires up via
  `setReactivityEngine` was measured directly instead.
