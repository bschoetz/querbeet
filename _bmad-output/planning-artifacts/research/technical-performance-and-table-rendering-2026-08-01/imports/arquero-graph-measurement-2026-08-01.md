# Original measurement: Checkpoint D2-a — Arquero in a DAG

Run for querbeet R4 / Checkpoint D2-a on 2026-08-01. Reproduce with
`node run-graph.mjs chromium` against `arquero-graph-probe.html` (needs
`npm i playwright arquero`). Raw output preserved as `arquero-graph-chromium.json`.

## Why this was measured

D2 established by object identity that `select`, `filter`, `orderby` and `derive` share the
parent's backing arrays. **That was measured on a linear chain.** The PRD's graph (FR-12)
differs in two ways a chain cannot exhibit: one Step may feed several consumers, and a Step's
output must outlive all of them, so nothing can be released early.

*Hypothesis to falsify:* a DAG over the half-million-row target costs approximately one copy of
the source data, plus one full-length array per derived column, plus one materialisation per
`join`/`concat` — and fan-out itself is free.

**All three limbs are confirmed.** The run also turned up a trap that the graph makes reachable
and the linear case does not.

## Method

Chromium 151.0.7922.34, headless via Playwright, with `--enable-precise-memory-info` and
`--js-flags=--expose-gc --max-old-space-size=8192`, loading a real `file://` page with the
Arquero 8.0.3 UMD bundle injected. Two forced GCs before and after each measurement, with the
produced value still referenced, so figures are *retained* memory. Sources are 100,000 rows ×
20 columns plus a `key` column, every seventh row with a null key.

**Chromium only.** Firefox exposes no `performance.memory`, and this checkpoint is entirely a
memory question. The findings are structural — properties of Arquero's data model — not
engine-specific.

## Results

### 1. Fan-out is free

One source Step feeding N consumers, all held alive simultaneously:

| Consumers | Pure view chain (`filter` → `select`) | With a derived column |
| --- | --- | --- |
| 1 | 0.05 MB | 0.43 MB |
| 3 | 0.05 MB | 1.20 MB |
| 10 | **0.13 MB** | 3.95 MB |

**Pure view consumers are effectively free and the cost does not grow with N** — ten consumers
of an 80 MB source cost 0.13 MB between them, and the per-consumer figure *falls* as N rises
(0.05 → 0.02 → 0.01 MB). Sharing survives fan-out.

**A derived column costs 0.40 MB per consumer, linearly.** That is the `Array(totalRows)`
allocation D2 read from the source, and it is charged per derived column regardless of how
selective the branch is. A 30-Step graph in which every Step derives one column would cost about
12 MB at 100k rows — negligible against the 80 MB source.

### 2. The join is the entire price of a graph

A diamond — one source, two filtered-and-derived branches, then recombined — against the same
two branches left unjoined:

| Shape | Retained | Time |
| --- | --- | --- |
| Two branches, not rejoined | 0.79 MB | 35 ms |
| Same two branches + `join_left` on a unique key (50,000 rows out) | 10.81 MB | 125 ms |
| **Price of the rejoin** | **10.02 MB** | 90 ms |

Branching is free; recombining costs one materialisation. This is the hypothesis's third limb,
confirmed: cost in a DAG lives exactly where rows are combined.

### 3. No leak, and dropping a leaf frees only the leaf

A four-Step graph over a shared source (`src → s1 → s2`, `s1 → s3`, `src → s4`), all held:

| Step | Retained vs. baseline |
| --- | --- |
| Whole graph held | 0.82 MB |
| After dropping one leaf (`s2`) | 0.40 MB |
| — reclaimed by that drop | 0.42 MB |
| **After dropping the whole graph** | **0.00 MB** |

Four Steps over an 80 MB source cost 0.82 MB in total. Dropping one leaf reclaims **its own
derive array and nothing else** — the shared parent stays pinned by its other consumers, as
predicted. Dropping the whole graph returns exactly to baseline: **there is no retention leak.**

This refines rather than contradicts the expectation: a leaf does free its own allocation, it
just cannot free anything it shares.

### 4. `reify()` in a graph costs instead of saving — this overturns a D2 rule

D2 recommended: *reify after a selective filter and release the parent.* Measured there, it was
worth 80 MB. But in a graph the Editor can re-run from any Step, so **the parent normally cannot
be released**. Both cases, side by side, filtering 100,000 rows down to 1,000:

| Case | View only | Reified | Effect of reifying |
| --- | --- | --- | --- |
| **Parent stays alive (the graph case)** | 0.01 MB | 0.11 MB | **costs 0.10 MB, saves nothing** |
| Parent can be released (D2's linear case) | 69.65 MB held → **0.70 MB** after release | | saves ~69 MB |

**The rule is conditional on releasability, and D2 stated it unconditionally.** Where a Step's
parent remains reachable from the graph — which is the normal case in an Editor that can re-run
from any node — reifying is pure cost: it copies the surviving rows while the original arrays
stay alive anyway. Reify only when the parent is genuinely going away.

### 5. A trap the graph makes reachable: R1's null-key sentinel becomes a Cartesian bomb

R1 established that null join keys never match and mandated **sentinel substitution**. That rule
was derived for joining a table against a **unique lookup**, where sentinel rows simply find no
partner. In a DAG, two branches of the same source both inherit its nulls — and then every
sentinel row on the left matches every sentinel row on the right.

Measured deliberately small, because at 100,000 rows it kills the tab:

| Source rows | Left | Right | Sentinels L × R | **Join output** | Time |
| --- | --- | --- | --- | --- | --- |
| 7,000 | 3,500 | 2,334 | 500 × 334 = 167,000 | **170,000 rows** | 236 ms |
| 14,000 | 7,000 | 4,667 | 1,000 × 667 = 667,000 | **673,000 rows** | 716 ms |
| 28,000 | 14,000 | 9,334 | 2,000 × 1,334 = 2,668,000 | **2,687,670 rows** | 2,646 ms |

**The output row count tracks the sentinel pair count almost exactly** — the legitimate matches
are the small remainder. Growth is quadratic in the null count, so it is invisible on a sample
and catastrophic at scale. The first run of this probe attempted the same join at 100,000 source
rows, where the sentinel pairs come to roughly 34 million, and **crashed the tab**. It was
reproduced independently in Node before being accepted as a finding.

### 6. The realistic target: a graph over half a million rows

Five 100,000-row sources, padded and unioned, sentinel-substituted, left-joined against a
5,000-row lookup with unique keys, filtered, then a derived column:

| | |
| --- | --- |
| Five sources held | 358.43 MB |
| Graph adds on top | 88.64 MB |
| **Total retained** | **447.07 MB** |
| Pipeline time | **699.9 ms** |
| Result rows | 250,000 |

The graph's 88.64 MB is essentially the one materialised join output; the `concat` and
sentinel-derive intermediates were collected once the join had copied from them, which is the
sharing model behaving exactly as read from the source.

## Caveats

- Chromium only; heap instrumentation exists nowhere else.
- Headless, one machine, no competing tab load.
- Synthetic ~16-character strings; wider real values raise every memory figure roughly
  proportionally.
- The half-million figure uses five identically-shaped sources; real files will differ in width.
- Test 5's join key was wrong in the first pass (`['jk','jk']` against a lookup whose column is
  `key`), which surfaced as `Invalid column reference` rather than a wrong number. Corrected and
  re-run; only the corrected figures are reported.
