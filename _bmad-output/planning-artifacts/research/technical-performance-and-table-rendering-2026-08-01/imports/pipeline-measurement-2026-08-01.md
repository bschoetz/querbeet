# Original measurement — 30-Step recompute, memoization, and full-dataset search (querbeet R4/D4, M5 + M7)

**Date:** 2026-08-01 · **Harness:** `pipeline-probe.html` + `run-pipeline.mjs`, headless Playwright
1.62, real `file://` URL, Arquero 8.0.3 injected as source text · **Engines:** Chromium
151.0.7922.34 (`--max-old-space-size=8192`, `--expose-gc`), Firefox 153.0 · **Raw:**
`pipeline-chromium.json`, `pipeline-firefox.json`.

## The graph

Thirty Steps at the PRD's full scale: **five 100,000-row Sources** (500,000 rows total), unioned,
left-joined to a 5,000-row lookup, filtered, then a 22-Step chain of the mix a real Recipe has —
derives dominating, with an `orderby`, a second `filter` and a `select` where an author would put
them. Final result: **500,000 rows × 39 columns**.

Every intermediate is **held**, because in a graph the Editor can re-run from any Step — which is
exactly what Checkpoint D2-a corrected D2's `reify()` rule about.

## M5 — what a 30-Step graph costs

| | Chromium 151 | Firefox 153 |
| --- | ---: | ---: |
| Build 5 Sources (500,000 rows) | 366.4 ms | 643 ms |
| Source heap | 216.9 MB | — |
| **Full recompute, 30 Steps, cold** | **496.4 ms** | **1,394 ms** |
| Full recompute, warm | 563 ms | 1,022 ms |
| **Heap for all 30 intermediates** | **180 MB** | — |

The per-Step breakdown says where it goes. The two structural Steps dominate and the twenty-two
derives are noise by comparison:

| Step | Chromium | Firefox |
| --- | ---: | ---: |
| `join-lookup` (500k ⋈ 5k) | **85.6 ms** | **179 ms** |
| `union` (concat of five 100k) | **44.9 ms** | **94 ms** |
| a typical `derive` | 22–26 ms | 90–98 ms |

This is D2-a's finding at 30 Steps rather than 8: **joins and concats are the price, everything else
is cheap** — and it extends cleanly, since 180 MB for a 30-Step graph over half a million rows is the
same order D2-a's per-column figures project to.

### What memoization buys, per edit position

Editing a Step re-runs only its tail; everything upstream is served from the cache. Measured:

| Edit at Step | Steps in the tail | Chromium | Firefox |
| --- | ---: | ---: | ---: |
| 0 — `union` | 25 | 578.6 ms | 1,156 ms |
| 1 — `join-lookup` | 24 | 470.7 ms | 973 ms |
| 2 — `filter-plausible` | 23 | 396.3 ms | 906 ms |
| 5 — `derive-2` | 20 | 352.1 ms | 694 ms |
| 10 — `orderby-c1` | 15 | 251.3 ms | 534 ms |
| 15 — `derive-12` | 10 | 190 ms | 384 ms |
| 20 — `derive-17` | 5 | 88.8 ms | 203 ms |
| **24 — `derive-21`** | **1** | **24.1 ms** | **54 ms** |

Cost tracks tail length almost linearly. **Editing the last Step of a 30-Step graph costs 24 ms
memoized against 496 ms recomputed — a factor of 20** in Chromium, and 54 ms against 1,394 ms in
Firefox, a factor of 26.

## M7 — FR-33, searching every row of a 500,000-row result

Three ways of scanning the final 500,000 × 39 table (19.5 million cells), for a needle matching one
row and for a needle matching a hundred:

| Method | Chromium | Firefox |
| --- | ---: | ---: |
| **Column scan** — `t.column(name)` per column, zero object allocation | **431.6 / 405.5 ms** | **433 / 458 ms** |
| `t.objects()` then scan rows | 674 / 611.2 ms | 828 / 700 ms |
| **Chunked column scan**, 25,000 rows per chunk, 780 yields | longest block **2.2 / 1.8 ms** | longest block **3 / 3 ms** |

Three things follow.

- **The column scan is 1.6× (Chromium) / 1.9× (Firefox) faster than materialising rows**, and it
  allocates nothing. D2's primitive is the right one.
- **The engines are equal here** — 431.6 vs 433 ms — which is unusual in this report and worth
  noting: Firefox's penalty in D2 was on Arquero's own machinery and on `objects()`, not on reading
  a backing array.
- **Chunking makes it free.** Splitting the scan into 25,000-row chunks with a yield between them
  puts the longest uninterrupted block at **2–3 ms**, comfortably inside a frame, at no measurable
  cost to the total. Full-dataset search does not need a worker and does not need an index.

Both needles found the same hit count by both methods (1 and 100 respectively), which is the
correctness check on the scan.

## Method notes

- 100,000-row Sources are built as column arrays and handed to `aq.table()`, which is what an
  Arquero table holds — in Arquero 8, `t.column(name)` returns the backing array itself.
- Each Step's result is forced with `numRows()` so a view's cost is not deferred out of the
  measurement.
- Cold and warm full recomputes are both reported because they disagree in opposite directions in
  the two engines (Chromium 496.4 → 563 ms, Firefox 1,394 → 1,022 ms); the spread is the honest
  precision of these figures, roughly ±15 %.
- No page errors and no crash in either engine.
