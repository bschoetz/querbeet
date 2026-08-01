---
title: 'Technical research: client-side transformation engine for querbeet'
type: 'technical'
topic: 'Client-side transformation engine for querbeet'
decision: 'Which client-side transformation engine powers the querbeet pipeline steps (union with column mapping, multi-key join, filter, column editing, computed columns, later group-by)'
source: 'research-plan.md R1; idea.md sections 3, 4, 5.2, 9'
status: complete
shape: 'select'
preset: 'standard'
validation: 'normal'
claims:
  verified: 66
  unverified: 9
  disputed: 2
  total: 77
created: '2026-08-01'
updated: '2026-08-01'
deepened: '2026-08-01 — Arquero slice (adoption, capabilities, type handling)'
project_decision: 'Arquero — overrides the research recommendation, see the note below the executive summary'
---

# Technical research: client-side transformation engine for querbeet

**Decision this research serves:** Which client-side transformation engine powers the querbeet pipeline steps (union with column mapping, multi-key join, filter, column editing, computed columns, later group-by).

## Executive summary

**Write the six operations by hand in plain JavaScript. Do not take a transformation-engine dependency.**

Three findings drive that answer.

First, **the workload is far smaller than every candidate is built for.** Measured in an original benchmark run for this decision — 100,000 rows × 20 columns joined against a 5,000-row lookup, report-shaped German data with nulls — hand-written JavaScript completes a two-key left join in 64 ms, a group-by in 21 ms, and the full realistic pipeline (filter, then join, then group-by) in 10.5 ms [30]. Every operation finishes well inside the roughly 100 ms budget within which an interaction still feels instant — the full pipeline by about a factor of ten. The performance argument that would justify a heavyweight engine does not exist at this scale. The complete hand-written implementation of all six operations is roughly 57 lines of ordinary JavaScript — it is in `imports/bench.mjs` and can be read in a couple of minutes.

Second, **every dependency on the shortlist carries a specific, documented defect that lands squarely on querbeet's core use case.** AlaSQL takes 25.2 seconds for the same two-key join — 265 times Arquero's time — and its own README opens its limitations section with "Please be aware that AlaSQL has bugs", naming FULL OUTER and RIGHT joins over more than two tables as producing wrong results, with a "LEFT JOIN returns incorrect data" issue open since 2019 [10][12][30]. Arquero, the best technical fit, has had **zero commits since 2025-05-29** — fourteen months — while filed issues sit unaddressed [4]; and its `concat` silently drops columns that exist only in incoming tables [7], which is precisely the union-with-column-mapping case querbeet exists to serve. DuckDB-WASM is excellent and institutionally maintained, but at roughly 8 MB gzipped it produces a ~50 MB single HTML document, failing hard gate G2 outright [16].

Third, **the dependency buys less than it appears to.** Union with column mapping is caller-side work in every candidate examined — Arquero's `concat` is schema-anchored to the receiving table, so the application must rename and align columns before calling it [7]. Filter conditions, computed columns and column mapping all have to be constructed from UI state regardless of engine. What the engine actually contributes is a hash join and a group-by accumulator: about 20 lines each.

**The biggest caveat:** hand-written code means owning every edge case forever — type coercion, null semantics, duplicate-key blow-up — and those are exactly where hand-rolled data code goes quietly wrong. The mitigation is cheap and specific, and it is recommendation R3 below: keep Arquero as a **development-time test oracle**, not a runtime dependency.

Weighted decision matrix, runner-up conditions, and the case against this recommendation are in [Verdict](#verdict).

> **Project decision (2026-08-01): querbeet will use Arquero, not hand-written functions.**
> The project owner overrode this recommendation, reasoning that a complete, widely used
> library is more battle-tested than freshly written bespoke code. That is a legitimate
> reading of the same evidence — this report's own C5 criterion scores Arquero 5/5 against
> hand-written 3/5, and the [case against the recommendation](#the-case-against-this-recommendation)
> makes precisely that argument. The research verdict is left standing as research rather
> than rewritten to match; the practical consequences of the decision are worked out in
> [Deepening: adopting Arquero](#deepening-adopting-arquero), which also revises the
> dormancy risk downward on new evidence.

---

## Requirements frame

These requirements were agreed with the user before any candidate research ran, and are derived from `idea.md` section 3 (fixed constraints) and `research-plan.md` R1. Project context sets requirements; it is never evidence for a claim about a candidate.

### Hard gates (pass/fail)

| # | Gate |
|---|---|
| G1 | Runs fully client-side in the browser — no server, no runtime network dependency |
| G2 | Shippable in or with a single HTML file (CDN-loadable, or bundleable inline) |
| G3 | Handles ~100,000 rows across up to 5 sources without killing the tab |
| G4 | Works in Chrome 143+, Edge 143+, Firefox 145+ (Safari optional) |
| G5 | Permissive open-source license, free for commercial use |

### Weighted criteria (total 100)

| # | Criterion | Weight |
|---|---|---|
| C1 | API fit for the six pipeline operations | 25 |
| C2 | Ecosystem health, maintenance, five-year regret risk | 20 |
| C3 | Footprint: bundle/WASM size, load time, offline behavior | 20 |
| C4 | Performance and memory at 100k rows | 15 |
| C5 | Implementation burden for a solo developer | 10 |
| C6 | Type and null handling | 10 |

### Out of scope for this run

Two areas are deferred to other runs: file formats and Parquet (research-plan R3), and UI framework choice (research-plan R2).

---

## Candidate screen

Ten candidates were screened. Five were cut before detailed evaluation, each on a hard gate.

| Candidate | Verdict | Reason |
|---|---|---|
| Polars (WASM) | **Cut** — G1/G2 | No browser build exists. npm ships only `nodejs-polars` with per-platform native NAPI binaries; the browser path is Pyodide-only (polars issue #24058, closed 2026-03-03) [20] |
| DataFusion in WASM | **Cut** — G2 | No maintained browser distribution: `datafusion-wasm` 0.3.1 last published 2024-12-22; the contrib bindings repo last pushed 2025-04-30 [21] |
| Danfo.js | **Cut** — G2/C2 | 1.91 MB gzipped, 6.79 MB raw [16], 42.6 MB unpacked [22]; one release since October 2022, an unanswered "Is this project actively being maintained?" issue open since 2026-05-19, bot-only repo traffic [22] |
| Arrow JS | **Cut** — not an engine | An interchange substrate with no query surface; cannot serve as the transformation engine on its own [23] |
| Perspective | **Cut** — scope | Apache-2.0 and actively released (v5.0.0, 2026-07-28), but it is a visualization component with an embedded engine, far heavier than the six operations require. Note for future reference: it **left FINOS** — `finos/perspective` now redirects to `perspective-dev/perspective` and `@finos/perspective` is deprecated on npm, so any 2024-era reference to the `@finos/*` scope is stale [23] |

Four candidates went forward: **Arquero**, **AlaSQL**, **sql.js**, **DuckDB-WASM**, plus the **hand-written** baseline. No candidate was cut on license — all ten screened are permissive, and the per-candidate licenses are listed in the ecosystem table below [24].

---

## Capability and API fit

**Arquero is the only dependency with a composable JavaScript API** a UI can drive as data rather than as generated strings: `join_left(other, [[l1, l2], [r1, r2]])` for multi-key joins, all four join types plus semi/anti, `groupby` + `rollup`, and `select`/`rename`/`relocate`/`derive`/`filter` [5]. AlaSQL, sql.js and DuckDB-WASM cover the six operations only through generated SQL strings; none documents a query-builder surface.

The decisive question for a click-together UI was whether Arquero expressions can be built from UI state rather than written as literal arrow functions at author time. **Resolved: yes, two ways** [5][6].

- Arquero accepts expressions **as strings** — both `"d => op.sqrt(d.value)"` and bare `"sqrt(d.value)"` are documented, as is template interpolation. Crucially, the arrow-function style takes the *same* path: Arquero calls `toString()` on author functions and re-parses them. A UI-built string is therefore not a degraded mode.
- `escape()` bypasses parsing entirely and supports runtime closures, letting a UI build `escape(d => cmp(d[column], value))` from `{column, operator, value}` with no source strings at all. Its documented cost: no aggregate or window `op` functions, sidestepped internal optimizations, and broken query serialization to worker threads.

Two qualifications on Arquero that matter more than they first appear:

- **`concat` silently drops columns.** `src/verbs/concat.js` iterates only the *first* table's `columnNames()`; columns unique to incoming tables vanish without warning, and missing cells fill with `undefined` (`src/util/null.js` exports `NULL = undefined`) [7]. For a tool whose core use case is merging exports with differing column sets, a silent drop is the worst failure mode available.
- **Runtime codegen on every non-escaped expression.** `src/expression/parse.js` ends in `compileExpr(generate(node), params)` [6]. Read at face value that means a Content-Security-Policy without `unsafe-eval` would threaten all expression use, not just string expressions — but this is an inference from one line of source rather than documented behavior, and it should be tested before anyone commits to a strict policy. Also worth knowing: string expressions and `escape()` have **no test coverage** in the repository's filter and parse test files — documented but untested [6].

Both readings above come from the `main` branch, which may be ahead of the released 8.0.3. Re-check them against the release tag before depending on either.

Other candidates' capability notes: AlaSQL's own documentation states that FULL OUTER and RIGHT joins over more than two tables "will not produce expected results" and that joining a sub-SELECT does not work [10]. sql.js has no bulk array-of-objects import — loading 100k rows means generating INSERT statements by hand [16]. Danfo.js `merge` accepts an array of key columns and all four join types, filling unmatched cells with `NaN` — though that comes from reading `merge.ts` on the development branch, since the published API reference documents neither [22]. Danfo.js was already cut on footprint regardless.

### Measured bundle sizes

Sizes were measured directly against jsDelivr during this run, comparing the gzipped and identity `curl` download sizes — that is, the bytes actually transferred [16]:

| Library | Version | Gzipped | Raw |
|---|---|---|---|
| Arquero | 8.0.3 | 73.9 KB | 236 KB |
| AlaSQL | 4.17.3 | 110 KB | 512 KB |
| sql.js | 1.14.1 | 339 KB total (16.6 KB JS + 322 KB WASM) | — |
| Danfo.js | 1.2.0 | 1.91 MB | 6.79 MB |
| DuckDB-WASM (`duckdb-eh.wasm`) | 1.33.1-dev57.0 | 8.06 MB | 35.9 MB |

Base64-inlining DuckDB-WASM into one HTML file yields a document of roughly 48–55 MB. **That fails hard gate G2**, independent of any capability judgment. The size is inherent rather than incidental: DuckDB-WASM ships a full analytical database that holds data in Arrow columnar form inside a 2–4 GB WASM memory space [2], which is exactly why it wins on query time and loses on payload.

---

## Performance and memory

### What the public record offers

One independent benchmark with published methodology carries the public evidence: `timlrx/browser-data-processing-benchmarks`, 1,000,000 rows × 24 columns, two hardware configurations, all engines driven from a worker thread, roughly 2023 vintage [1]. At that scale DuckDB-WASM dominates on query time while paying the worst ingest cost: 4.3 against Arquero's 2.9 and SQLite-WASM's 0.9. The units are ambiguous in the source itself — its prose says milliseconds while the magnitudes only cohere as seconds — so treat the ratio as the finding and the absolute values as uncertain.

Three gaps made that record insufficient for this decision, and all three are reported honestly rather than papered over:

- **No public benchmark exists at ~100k rows.** Everything retrieved is at 1M rows or TPC-H scale.
- **No public benchmark tests a JOIN at all** for any candidate. The suite covers load, aggregate, group-by, row select, index and data manipulation (DML). Joins — the core operation here — are unevidenced in the public record.
- **AlaSQL appears in zero benchmarks found.**

### Original benchmark run for this decision

Rather than extrapolate, a differential benchmark was written and run as part of this research (logged as a mid-run scope change). The setup was a main table of 100,000 rows × 20 columns of report-shaped German data including nulls and umlauts, joined against a 5,000-row lookup. Each figure is the median of three runs, taken on Node v26.5.0 (V8) as a proxy for the browser's JavaScript engine, against Arquero 8.0.3 and the AlaSQL npm package 4.17.3 — whose internal version constant reads 4.17.2, a lag inside the package itself. Script and raw output are preserved in `imports/bench.mjs` and `imports/bench-result.json` [30].

| Operation | Hand-written JS | Arquero 8.0.3 | AlaSQL 4.17.3 |
|---|---|---|---|
| Left join, 1 key | **37.1 ms** | 73.0 ms | 410 ms |
| Left join, 2 keys | **64.3 ms** | 94.8 ms | **25,190 ms** |
| Filter | 3.8 ms | **3.3 ms** | 32.6 ms |
| Group-by + sum | **21.4 ms** | 35.1 ms | 37.3 ms |
| Union of 3 sources, mapped columns | **10.3 ms** | 33.2 ms | 51.4 ms |
| Full pipeline (filter, then join, then group-by) | **10.5 ms** | 28.2 ms | 59.9 ms |

Three things follow.

**AlaSQL's two-key join is disqualifying.** 25.2 seconds against Arquero's 94.8 ms is not a tuning difference; it is an algorithmic one, and multi-key joins are an explicit requirement for the minimum viable product. Note the shape of the failure: the single-key join is merely slow (410 ms), so a developer testing with one key would never see this coming.

**Everything else is fast enough that performance stops being a selection criterion.** Outside that one cell, every engine completes every operation in well under 100 ms. At querbeet's scale the performance question is settled and the decision rests on API fit, maintenance and footprint.

**Correctness cross-check: all three engines agreed.** Result fingerprints — row count, numeric column sum, null count — were byte-identical across hand-written JS, Arquero and AlaSQL for all six operations [30]. This is worth stating plainly in AlaSQL's favour: in these query shapes it produced no wrong answers. Its documented defects lie in shapes this benchmark did not exercise (sub-SELECT joins, FULL OUTER and RIGHT joins over more than two tables).

### Memory

Measured in the same run [30], 105,000 report-shaped rows held as a plain array of objects occupy **47.2 MB of V8 heap — about 471 bytes per row** at 20 columns. Building an Arquero columnar table on top adds a further 17.1 MB. This replaces the unevidenced folklore figure the public record offered; the array-of-objects "blow-up factor" cited in community sources came without methodology and is not safe to build on.

At 471 bytes per row, five 100k-row sources held simultaneously is roughly 235 MB — comfortable on a desktop browser, worth watching on a memory-constrained machine, and a reason not to keep every intermediate pipeline result alive at once.

### Benchmark caveats, stated plainly

The benchmark ran on Node/V8, not in a browser: the same JavaScript engine, but with no DOM, no rendering competition for the main thread, and no browser memory ceiling. The data is synthetic and deterministic. The hand-written implementations are happy-path code of roughly 57 lines total, not a hardened library. And this measures transformation only — table *rendering* at 100k rows is a separate question belonging to research-plan R4.

---

## Ecosystem health and correctness track record

The maintenance ranking below is derived from commit and author time series across four six-month windows running from August 2024 to August 2026 [19][4][15][24][22]:

| Candidate | Latest release | Maintenance signal | License |
|---|---|---|---|
| DuckDB-WASM | v1.33.0 stable, 2025-12-16 | **Institutional.** 100/100/86/42 commits per window, 3–8 distinct authors each, DuckDB Labs staff constant, DuckDB Foundation backing | MIT |
| sql.js | v1.14.1, 2026-03-04 | **Thin but shipping.** Solo maintainer plus occasional help, one dead window; SQL semantics are SQLite's, not its own | MIT (confirmed from LICENSE text) |
| AlaSQL | 4.17.3, 2026-05-22 | **One human plus bots.** Highest raw activity of the JS options, but 460 open issues and spiky releases (nothing Apr–Nov 2025, then eleven in ten weeks, then nothing tagged since Jan 2026) | MIT |
| Arquero | 8.0.3 | **Dormant.** Zero commits since 2025-05-29 — fourteen months — solo maintainer at the University of Washington Interactive Data Lab; the most recent newly filed issue is from 2026-03-31 and remains unaddressed | BSD-3-Clause (confirmed from LICENSE text) |
| Danfo.js | v1.2.0, 2025-04-03 | **Effectively abandoned.** One release since Oct 2022, ~1 commit per half-year, maintenance question unanswered since 2026-05-19, human pull requests stranded since April | MIT |

**No license blockers.** All are confirmed permissive. One false alarm was resolved: sql.js reads `NOASSERTION` on the GitHub API only because its LICENSE heading deviates from the template — the file body is plain MIT [24].

### AlaSQL correctness: established, not refuted, and not stale

This was checked specifically because a reputation for silent wrong answers is easy to repeat and hard to verify, and an old complaint against a current version would be a false claim. It is not stale:

- AlaSQL's **own current README** (develop branch, last modified 2025-11-30) opens its limitations section with "Please be aware that AlaSQL has bugs", states that joining a sub-SELECT "does not work", and that FULL OUTER and RIGHT joins over more than two tables "will not produce expected results" [10].
- Issue #832 (open since 2017, README-linked) and #1091 "LEFT JOIN returns incorrect data" (open since 2019, traced by commenters to stale `preIndex` join indexes reused after updates) **remain open** [11][12].
- New reports keep landing in 2026: #2515 on ORDER BY with GROUP BY (2026-07-27) and #2481 on aggregate/date/NULL handling across MAX/MIN/VAR/STDEV (2026-04-19) [13].

In fairness: a November–December 2025 burst did close real long-standing bugs, including a GROUP BY defect open since 2017. But the two canonical JOIN wrong-result issues survived it. These are silent-wrong-answer failures, not exceptions — the single worst failure mode for a tool whose output people act on.

For contrast, DuckDB-WASM shows no open wrong-result query bug in a title-scoped search, and Arquero's 2025 correctness bugs were filed and fixed inside the v8.0.x cycle [19][4].

### DuckDB-WASM's version surfaces disagree

Three surfaces disagree, and the discrepancy is worth knowing regardless of the outcome here [17][18]: npm's `latest` dist-tag points at a **prerelease dev build** (1.33.1-dev57.0, published 2026-06-22; `next` at dev64.0), the last stable GitHub tag is v1.33.0 (2025-12-16), and duckdb.org names "1.5.4" as the stable WASM client. Installing unpinned therefore ships a development build, and the dev channel carries open regressions in module instantiation and OPFS durability — though whether those reach the MVP and EH bundles specifically was not established [19]. Anyone adopting DuckDB-WASM should pin 1.33.0 explicitly.

---

## Single-file packaging feasibility

This dimension tested hard gate G2 against browser reality, since a page opened as `file://` gets no server headers.

**WASM from `file://` works — resolved.** Base64-inline the binary and instantiate via `WebAssembly.instantiate` over a decoded `Uint8Array`. `instantiateStreaming` is unusable because it requires a server-supplied MIME type and must be swapped out. Two independent sources: a documented single-file Pyodide build (30 MB HTML, opened from `file://`, no CORS errors) [26] and Bun's standalone-HTML documentation [27].

**Workers from `file://` — unresolved, and honestly reported as such.** Worker creation is governed by same-origin rules on the script URL [28], and workers loaded from a *separate script file* are deliberately blocked: Mozilla closed Bugzilla 1565672 as RESOLVED INVALID, with the platform engineer stating that workers loaded from `file://` should not work unless loaded from the exact same file — a consequence of Firefox treating `file:` URIs as unique origins after CVE-2019-11730 [25]. Blob-URL workers appear exempt, but that rests on **one 2019 source for one browser**. The Chromium issue tracker was unreachable (sign-in wall), so current Chrome and Edge behavior is genuinely unknown, and no source under twelve months exists on the question.

**This gap does not block the recommendation.** It is decisive only for DuckDB-WASM, which mandates a Worker; that there is no main-thread alternative rests on an unresolved maintainer discussion rather than on the documentation [3] — and DuckDB already fails G2 on size in any case. The recommended hand-written approach and the Arquero fallback both run on the main thread and are unaffected. Resolving the question costs about fifteen minutes of manual testing whenever it matters; the procedure is set out under [Open questions](#open-questions).

---

## Cross-dimension insights

These are the findings that only the combination of dimensions produces:

**The technically best-fitting library is the least maintained one.** Arquero wins API fit decisively — it is the only candidate a click-together UI can drive without string generation — and it is measurably fast. Read alone, the capability dimension would have named it the winner. The ecosystem dimension inverts that: fourteen months without a commit, a solo maintainer, and unaddressed issues. Neither dimension alone produces the right answer; together they produce a clear one, which is that Arquero is excellent code to *learn from* and risky code to *depend on*.

**Two dimensions independently converged on the same disqualification.** Capability research found DuckDB-WASM's ~50 MB inlined document fails G2; packaging research found its mandatory Worker sits behind an unresolved `file://` question. The strongest-maintained candidate in the field is ruled out twice over — not by weakness but by a constraint querbeet chose deliberately. If the single-HTML-file constraint were ever relaxed, DuckDB-WASM becomes the obvious answer, and that is worth remembering as the constraint's real cost.

**The benchmark collapsed the criterion that usually decides these choices.** Teams normally pick a data engine on performance. Measurement showed performance is a non-differentiator at this scale for everything except one AlaSQL cell — so the weight genuinely shifts onto maintenance risk and footprint, where the no-dependency option is strongest by construction. Had the benchmark not been run, the public record's 1M-row numbers would have pointed at DuckDB-WASM, a candidate that fails a hard gate.

**Each engine's headline abstraction leaks at exactly querbeet's use case.** Arquero's `concat` drops unmapped columns; AlaSQL's multi-key join collapses; sql.js has no bulk import path. The pattern is consistent: these libraries are built for analysis over clean, known-schema data, whereas querbeet's job is reconciling *dirty, differently-shaped* exports. The messy part — deciding that column A in source 1 means column B in source 2 — is application logic no engine offers, and it is the part querbeet is actually about.

---

## Verdict

### Weighted decision matrix

Scores are 0–5 against each criterion. Each cell shows the raw score and, after the arrow, that score's weighted contribution, calculated as `score ÷ 5 × weight`. Re-weight it yourself — the scores are the argument, not the total.

| Criterion (weight) | Hand-written | Arquero | sql.js | AlaSQL | DuckDB-WASM |
|---|---|---|---|---|---|
| C1 API fit (25) | 5 → 25 | 4 → 20 | 2 → 10 | 2 → 10 | 3 → 15 |
| C2 Ecosystem health (20) | 5 → 20 | 1 → 4 | 3 → 12 | 2 → 8 | 5 → 20 |
| C3 Footprint (20) | 5 → 20 | 4 → 16 | 2 → 8 | 3 → 12 | 0 → 0 |
| C4 Performance/memory (15) | 5 → 15 | 4 → 12 | 2 → 6 | 1 → 3 | 4 → 12 |
| C5 Solo-dev burden (10) | 3 → 6 | 5 → 10 | 2 → 4 | 3 → 6 | 2 → 4 |
| C6 Type/null handling (10) | 4 → 8 | 3 → 6 | 4 → 8 | 2 → 4 | 5 → 10 |
| **Total** | **94** | **68** | **48** | **43** | **61** *(fails G2)* |

The two extremes deserve a note on how they scored. Hand-written takes C1 because the API is whatever the UI needs and union-with-mapping becomes explicit rather than fought; it takes C2 and C3 by construction (no dependency, no bytes); it loses C5 because the developer owns the code, and gives up a point on C6 because type handling must be built rather than inherited. Arquero loses C2 almost entirely on dormancy and gives up points on C6 for the `null !== null` join default and the silent `concat` column drop.

### The pick

**Hand-written array functions**, scoring 94 of 100 and passing every hard gate trivially.

### Runner-up, and when it wins instead

**Arquero** (68). It wins if the feature set grows well past the six operations — window functions, pivot/unpivot, rolling aggregates, percentile summaries — where hand-writing stops being 57 lines and starts being a library. Two conditions would need to hold: the dormancy risk is accepted knowingly (BSD-3-Clause means a fork is always available, and 236 KB of readable source is a forkable amount), and the `concat` column-drop behavior is wrapped rather than called directly.

**AlaSQL is not recommended in any scenario.** The 25-second two-key join and the open silent-wrong-answer join bugs together disqualify it for a tool whose entire purpose is joining report exports. This directly answers the proposal in `idea.md` section 4, which named AlaSQL as the presumed transformation engine.

### The case against this recommendation

The red-team pass was configured off for this run, so this is the lead researcher's own strongest counter-argument rather than an adversarial pass:

**You are choosing to own data-transformation correctness forever.** Join semantics with duplicate keys, null-versus-empty-string handling, numeric coercion of German-formatted values, and column collision on union are all places where hand-rolled data code is subtly wrong in ways that produce plausible numbers rather than errors — the same failure class this report condemns AlaSQL for. The 57-line benchmark implementation is a happy path, not a hardened one; the hardened version is realistically several times that, plus tests. A library at least distributes that risk across other users who file bugs.

The counter-counter-argument, and why the recommendation stands: the risk is *bounded and testable* here in a way it is not for a dependency. Six pure functions over arrays of objects are exactly the shape property-based testing handles well — which is what recommendation R3 below makes concrete.

### Cheapest reversibility hedge

Define every pipeline step as a pure function `(tables, config) => table` over plain arrays of objects. Every candidate examined consumes and produces that shape, so swapping the engine later is a per-operation change rather than an architectural one. This costs nothing to adopt now and preserves the Arquero and DuckDB-WASM options at full value.

---

## Recommendations

**R1 — Implement the six operations as hand-written pure functions over arrays of objects.** Confidence: **high**, resting on measured performance and memory from a benchmark run for this decision [30] plus documented defects in every alternative [7][10][12]. *Feeds:* architecture spine (core paradigm); `idea.md` section 9's open question on the transformation engine, now closed.

**R2 — Adopt the `(tables, config) => table` step interface from the first commit.** Confidence: **high** (design judgment, not an empirical claim). It is the reversibility hedge and costs nothing. *Feeds:* architecture spine (module boundary).

**R3 — Use Arquero as a development-time test oracle, not a runtime dependency.** Install it as a dev dependency and write differential tests asserting that each hand-written operation matches Arquero's result on generated inputs — exactly the fingerprint cross-check this research used, which is already implemented in `imports/bench.mjs` [30]. This buys the correctness assurance a library would provide while shipping zero bytes to the user and taking on no dormancy risk. Confidence: **high**. *Feeds:* test strategy; architecture spine (dependency policy).

**R4 — Handle the three known traps explicitly, since you now own them.** All three are documented failure modes of the libraries examined, which makes them a free checklist. Decide and document whether `null` equals `null` in a join key — Arquero says no by default [5], SQL says no, and users of report data usually mean yes. Warn the user in the interface when a join's output row count exceeds its input, because duplicate keys silently produce a Cartesian product [8]. And on union, surface columns that appear in only some sources rather than dropping them the way Arquero's `concat` does [7]. Confidence: **high**.

**R5 — Do not pursue DuckDB-WASM under the current constraints, but record why.** It fails G2 on size alone (~50 MB inlined) [16] and mandates a Worker whose `file://` viability is unverified [25]. Should the single-HTML-file constraint ever be relaxed — a hosted variant, or an Electron/Tauri wrapper — DuckDB-WASM becomes the strongest candidate in the field on maintenance and correctness, and this decision should be revisited rather than re-researched. If adopted, pin 1.33.0; npm `latest` is a dev build [17][18]. Confidence: **high**.

**R6 — Budget memory for roughly 470 bytes per row.** Five simultaneous 100k-row sources is about 235 MB of heap [30]. Release intermediate pipeline results rather than retaining every step's output, and treat "keep all intermediates for instant step-back" as a feature with a measurable cost. Confidence: **medium** — measured in Node, not in a browser tab competing with rendering. *Feeds:* research-plan R4 (performance and table rendering).

---

## Open questions

| Question | What it would take to answer | Blocking? |
|---|---|---|
| Can a Web Worker be created from a `file://` page in current Chrome, Edge and Firefox (blob URL or data URI)? | ~15 minutes: one HTML file opened from `file://` in each browser, testing blob-URL worker, data-URI worker, and WASM instantiation inside it. Cheaper than any further searching [25] | **No** for the recommendation (main-thread only). **Yes** if DuckDB-WASM is ever reconsidered |
| Do the measured timings hold in a real browser tab rather than Node? | Port `imports/bench.mjs` to a single HTML page and run it in the target browsers. Same V8, but rendering competes for the main thread | No — the full pipeline finishes about ten times inside the interaction budget |
| At what row count does the hand-written approach stop being comfortable? | Extend the benchmark to 500k and 1M rows. Relevant only if the ~100k design target moves | No |
| Is there a real migration-away account for any of these engines? | Not found in this run — five-year regret risk (C2) rests on maintenance signals, not on observed migration cost | No, but it is a genuine evidence gap |
| Does Arquero's dormancy end? | Watch `uwdata/arquero` commit activity; relevant only if recommendation R3's oracle role grows into a runtime dependency | No |

---

## Deepening: adopting Arquero

Added 2026-08-01 after the project decision. Scope: Arquero only. Three research briefs plus five original probe scripts run against the **released 8.0.3 package** — not the `main` branch — which also settles the earlier "main may be ahead of the release" caveat for every behavior below. Probe scripts and raw output are in `imports/arquero-probe*.mjs` and the matching `-result.json` files [40].

### What this changes about the risk assessment

Two findings revise the dormancy risk **downward**, and they are the strongest support for the decision:

**Adoption rose roughly tenfold during the dormancy.** Monthly npm downloads went 24,659 (Jan 2025) → 30,462 (Jul 2025) → 81,567 (Jan 2026) → 249,216 (Jul 2026), a smooth curve rather than a step [31]. The honest caveat: no identified dependent accounts for that volume, so some share is likely continuous-integration and mirror traffic — the *direction* is reliable, the absolute human-usage figure is not. GitHub records 399 dependent repositories and 57 dependent packages [32]. One negative result worth knowing, because it contradicts a natural assumption: **the Observable ecosystem does not use Arquero** — neither Observable Framework nor Observable Plot depends on it, and neither does UW IDL's own Mosaic [32].

**Forking is cheap, and now measured rather than asserted.** 172 source files totalling 10,764 lines, a 63-file test suite of 9,020 lines, and `npm ci && npm test` passes clean on Node v26.5.0 — 392 tests in about one second. Two runtime dependencies, both current. Plain rollup with mocha, tape, eslint and tsc [34]. A BSD-3-Clause library that small, that well tested and that dependency-light is a realistic thing to maintain yourself if you ever have to.

**The dormancy itself is better characterized than "finished versus abandoned".** Nothing anywhere declares the project complete. The maintainer's last thirty public GitHub events are entirely on Mosaic, and his own comment on issue #361 (2025-10-21) reads: "not something I have time to work on… If someone is interested in working on this, I'd be happy to help guide" [33]. He was still answering issues in late 2025. The 41 open issues skew toward feature requests, bundler friction and questions; genuine correctness reports are a small minority covering narrow edge cases [33].

Does this overturn the verdict? **No, but it narrows the gap honestly.** On the original matrix Arquero scored 1/5 on C2 (ecosystem health). Measured fork cost and rising adoption justify raising that to 3/5, which moves Arquero from 68 to 76 against hand-written's 94. The recommendation would still have been hand-written; the decision to use Arquero buys maturity and API breadth at a cost the matrix prices mostly in C2 and C3, and that is a reasonable trade to make deliberately.

### Driving the six operations from UI state

This was the decisive capability question, and it is settled: **all six operations can be constructed from plain configuration objects**, verified by running them on 8.0.3 [40].

The governing choice is `aq.escape()` versus parsed string expressions [35]. Use `escape()` wherever the **column name is runtime data** — filters and computed columns — because it applies an ordinary JavaScript closure with no code generation. Use parsed string expressions with `params()` for `rollup`, which `escape()` cannot host because it forbids aggregate and window functions.

| Operation | Shape that works | Notes |
|---|---|---|
| Filter | `table.filter(aq.escape(d => OPS[cfg.op](d[cfg.column], cfg.value)))` with an operator dispatch table | Verified for equals, contains, is-empty and is-not-empty. Hand-roll the operators: `op.includes` is documented for arrays only, `op.indexof` is the string primitive, and `op.valid`/`op.invalid` are aggregates rather than row predicates [35] |
| Computed column | `table.derive({[name]: aq.escape(d => d[cfg.left] * d[cfg.right])})` | `derive` also takes `{drop, before, after}` for placement. String expressions work too |
| Join | `table.join_left(other, [[...leftKeys], [...rightKeys]])` | **Footgun:** a flat `['a','b']` is the left/right key *pair*, not two keys. Multi-key needs the nested form [35] |
| Join type at runtime | `join_left` is `join` with `{left: true, right: false}`; options are exactly `{left, right, suffix}` | Verified switching type from config |
| Select, rename, reorder | A single `select()` call accepting `{old: 'new'}` objects | `select` fixes output order, so all three collapse into one call |
| Group-by | `table.groupby(cols).rollup(spec)` with `spec` assembled from config | Verified building the spec from a config array. `op.sum` ignores nulls, `op.count()` counts all rows, `op.valid()` counts non-null |

### The three traps, with measured workarounds

**1. `concat` silently drops columns.** Confirmed on 8.0.3: a column present only in an incoming table vanishes from the output with no warning, and a row missing a column yields that key *absent* from the emitted object rather than set to null [40]. There is no built-in full outer union; the documentation states plainly that only the receiving table's named columns appear. A second hazard sits in the same source: `if (trows === nrows) return table` returns the receiver unwidened when every other table is empty [35].

The workaround, measured working: compute the union of all column names, pad each table with `derive` for its missing columns, force identical order with `select(allCols)`, then `concat`. Since querbeet's core use case *is* merging exports with differing column sets, this belongs in the application's union step permanently — not as a special case.

**2. Null join keys never match, and the obvious fix is a performance trap.** Arquero's own test is named "does not treat null values as equal"; `null`, `undefined` and `NaN` all fail to match, and **no option overrides it** [39]. This definitively corrects an earlier claim in this report that `op.equal` fixes it — it does not, and it additionally renames the key columns [40].

Two workarounds exist, and the choice between them matters enormously:

| Workaround | Measured at 100k rows × 5k lookup, 8% null keys | Why |
|---|---|---|
| Sentinel substitution before joining | **30.8 ms** | Keeps the hash join, and preserves clean column names |
| Custom predicate function | 73.6 ms at only 2k rows → **~3.7 s projected at 100k** | `src/verbs/join.js` selects `loopJoin` for a predicate, making it O(n·m) [39] |

Sentinel substitution is roughly 120 times faster and is the only viable option [40]. For reference, the plain hash join that leaves nulls unmatched takes 43.3 ms, so the correct behavior is actually *cheaper* than the default.

**3. Duplicate keys produce a Cartesian product.** Confirmed on 8.0.3: two left rows against two matching right rows yield four output rows [40]. `lookup()` is the row-count-safe alternative, keeping the last observed instance per key [35]. Warn the user whenever a join's output row count exceeds its input.

### Type handling — the part that can silently corrupt reports

This is the most important section for a German-language reporting tool, and it contains the deepening's sharpest finding.

**Arquero's CSV type inference silently corrupts German numbers.** `aq.fromCSV` with default settings converts `"1.234"` — German for one thousand two hundred thirty-four — into the JavaScript number `1.234`, and `"2.500"` into `2.5`. Wrong by a factor of a thousand, with no error and no warning [40]. The value passes the numeric test because `+"1.234"` is a valid number. Arquero has a `decimal` option, but it only replaces the first occurrence and there is no thousands-separator support anywhere in 8.0.3 [36].

**Worse, inference samples only the first 1,000 values.** `autoMax` defaults to 1000; Arquero picks a parser from that sample and then applies it to the entire column with no re-check [36]. Measured on a file of 1,000 plain integers followed by German-formatted values [40]:

| Import mode | Row 1001 `"1.234,56"` | Row 1002 `"7.500"` | Column total |
|---|---|---|---|
| Default `autoType` | `null` — dropped | `7.5` — wrong by 1000× | **600,062.50 (wrong)** |
| `autoMax` raised above row count | stays a string | stays a string | `null` — no arithmetic possible |
| `autoType: false` | stays a string | stays a string | `null` — no arithmetic possible |
| Explicit per-column `parse` function | `1234.56` ✓ | `7500` ✓ | **608,789.56 (correct)** |

Note what the wrong total looks like: 600,062.50 is entirely plausible. Nothing about it signals a defect.

**And the obvious detector does not catch it.** Comparing `op.count()` against `op.valid()` reveals values that became null — in the experiment above, 1003 versus 1002 — but it is blind to the factor-1000 corruption, because 7.5 is a perfectly valid number [40]. Count-versus-valid detects *dropped* values, never *mis-scaled* ones.

**The rule that follows: always pass explicit per-column `parse` functions; never rely on inference.** A `parse[column]` function wins over everything, including `autoType: false` [36] — it is the supported hook. Two further details: in CSV, empty fields become `null` *before* parsing and parsers are skipped for null, whereas `fromJSON` calls the parser on every value including null, so JSON parsers must be null-safe [36]. And `aq.from(objects)` never coerces types at all, so if a dedicated CSV library does the parsing, this entire hazard class is bypassed — which is a real argument for pairing Arquero with PapaParse rather than using `fromCSV`. That question belongs to research-plan R3.

On missing values generally: `src/util/null.js` exporting `NULL = undefined` describes what aggregates *emit* when nothing valid exists, not how input missings are stored — those are `null`. One predicate governs everything, `isValid(v) => v != null && v === v`, so `null`, `undefined` and `NaN` are indistinguishable to aggregation [37].

### Export shaping

Measured on 8.0.3 [40]: `toCSV({delimiter: ';', format: {…}})` with per-column format functions produces German-Excel-shaped output — `1234,56` and `31.12.2025` — and a full round trip back through `fromCSV` with matching per-column parsers reproduces the original numbers exactly. Quoting is correct for embedded semicolons, quotes and newlines, and umlauts survive.

One gap the application must close itself: **Arquero writes no UTF-8 byte-order mark and uses LF line endings**, and offers no option for a BOM, CRLF, or locale [38]. German Excel needs the BOM to recognize UTF-8, so prepend the byte-order mark U+FEFF to the exported string before handing it to the download.

### Distribution and pinning

The published package ships `dist/arquero.js` (759,244 bytes) and `dist/arquero.min.js` (236,290 bytes), both UMD builds exposing a global `aq` — verified against the locally installed package. The `unpkg` and `jsdelivr` fields point at the minified build, while `main` and `module` point at `./src/index.js` with `type: module` and no `exports` map, so ESM-oriented CDNs serve raw source. Apache Arrow is deliberately excluded from the bundle [35].

A plain `<script>` tag from a CDN therefore works with no build step, which satisfies the single-file constraint. **Pin `arquero@8.0.3` rather than `@latest`** — on current evidence there will be no further releases, so a floating tag buys nothing and risks everything [35].

### Recommendations arising from this deepening

**R7 — Wrap Arquero rather than calling it directly from the UI layer.** Every trap above is a wrapper's job: pad-then-concat for union, sentinel substitution for null keys, a row-count check after joins. Confidence: **high**, resting on measured behavior [40].

**R8 — Never call `fromCSV` without explicit per-column `parse` functions.** Or avoid `fromCSV` altogether and feed Arquero via `aq.from(objects)` after parsing with a dedicated CSV library. Treat automatic type inference as unsafe for this application's data. Confidence: **high** [36][40]. *Feeds:* research-plan R3 and R5.

**R9 — Use sentinel substitution for null join keys, never a predicate function.** The predicate form silently drops to an O(n·m) nested-loop join. Confidence: **high**, measured [39][40].

**R10 — Pin `arquero@8.0.3` and vendor the `dist/arquero.min.js` build.** 236 KB inlined into the single HTML file removes the CDN dependency entirely and matches the offline requirement. Confidence: **high** [35].

**R11 — Keep a fork plan on file rather than a fork.** 10,764 lines with 392 passing tests and two dependencies is a realistic thing to adopt if a blocking bug ever surfaces. Record this so the option is remembered rather than rediscovered under pressure. Confidence: **high**, measured [34].

**R12 — Verify the Content-Security-Policy consequence before hardening the page.** Open issue #361 reports that Arquero requires `unsafe-eval` because of its dynamic function compilation [35]. Using `escape()` throughout may avoid it, but that is untested. Confidence: **medium** — this is a real open question, not a settled finding.

---

## Source appendix

| [n] | Supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | Public 1M-row browser benchmark: DuckDB-WASM query dominance, ingest cost | [timlrx/browser-data-processing-benchmarks](https://github.com/timlrx/browser-data-processing-benchmarks) | ~2023 | 2026-08-01 | medium (units ambiguous in source) |
| [2] | DuckDB-WASM architecture, Arrow columnar, 2–4 GB WASM memory limit | [PVLDB / DuckDB Labs](https://duckdb.org/2021/10/29/duckdb-wasm) | 2022 | 2026-08-01 | medium (memory bound read from the PVLDB paper, not the blog post) |
| [3] | DuckDB-WASM requires a Worker; bundle variants | [DuckDB instantiation docs](https://duckdb.org/docs/current/clients/wasm/instantiation.html) | undated (current) | 2026-08-01 | medium (the absence of a main-thread API rests on unresolved maintainer discussion #1445, not the docs) |
| [4] | Arquero: zero commits since 2025-05-29; last new issue filed 2026-03-31 | [GitHub commits API, uwdata/arquero](https://api.github.com/repos/uwdata/arquero/commits?since=2025-06-01) | 2026-08-01 | 2026-08-01 | high |
| [5] | Arquero string expressions, template interpolation, `escape()`, join/rollup API | [Arquero expression docs, UW IDL](https://idl.uw.edu/arquero/api/expressions) | undated (v8.0.3) | 2026-08-01 | high |
| [6] | Runtime codegen (`compileExpr(generate(node))`); no test coverage for string exprs/`escape()` | [uwdata/arquero `src/expression/parse.js`](https://github.com/uwdata/arquero/blob/main/src/expression/parse.js) | main branch | 2026-08-01 | high for the code reading; medium for the CSP consequence inferred from it |
| [7] | `concat` iterates first table's columns only — silent column drop; `NULL = undefined` | [uwdata/arquero `src/verbs/concat.js`](https://github.com/uwdata/arquero/blob/main/src/verbs/concat.js) | main branch | 2026-08-01 | high (main branch may be ahead of released 8.0.3) |
| [8] | `hashJoin` emits a full Cartesian product on duplicate keys | [uwdata/arquero `src/verbs/join.js`](https://github.com/uwdata/arquero/blob/main/src/verbs/join.js) | main branch | 2026-08-01 | high (main branch may be ahead of released 8.0.3) |
| [10] | AlaSQL README limitations: "has bugs"; FULL OUTER/RIGHT join and sub-SELECT join defects | [AlaSQL README](https://github.com/AlaSQL/alasql#limitations) | 2025-11-30 | 2026-08-01 | high |
| [11] | AlaSQL issue #832, open since 2017, README-linked | [AlaSQL issue tracker](https://github.com/AlaSQL/alasql/issues/832) | 2017-02-20, upd. 2025-05-31 | 2026-08-01 | high |
| [12] | AlaSQL #1091 "LEFT JOIN returns incorrect data", open since 2019 | [AlaSQL issue tracker](https://github.com/AlaSQL/alasql/issues/1091) | 2019-02-09, upd. 2025-05-31 | 2026-08-01 | high |
| [13] | AlaSQL 2026 reports: #2515 ORDER BY+GROUP BY, #2481 aggregate/date/NULL | [AlaSQL issue tracker](https://github.com/AlaSQL/alasql/issues/2515) | 2026-07-27 / 2026-04-19 | 2026-08-01 | high |
| [15] | AlaSQL 460 open issues; solo maintainer plus bots; release cadence | [GitHub API, AlaSQL/alasql](https://api.github.com/repos/AlaSQL/alasql) | 2026-08-01 | 2026-08-01 | high |
| [16] | Measured bundle sizes for all candidates (gzip and raw, transferred bytes) | [jsDelivr CDN](https://cdn.jsdelivr.net/npm/arquero@8.0.3/dist/arquero.min.js) | version-tagged | 2026-08-01 | medium (measured directly this run, but from one CDN — the two-source bar is formally unmet) |
| [17] | npm dist-tags: `latest` = 1.33.1-dev57.0 prerelease, `next` = dev64.0 | [npm registry, @duckdb/duckdb-wasm](https://registry.npmjs.org/@duckdb/duckdb-wasm) | 2026-06-22 / 2026-07-28 | 2026-08-01 | high (two sources) |
| [18] | Last stable GitHub release v1.33.0; duckdb.org's conflicting "1.5.4" | [GitHub releases, duckdb/duckdb-wasm](https://api.github.com/repos/duckdb/duckdb-wasm/releases) | 2025-12-16 | 2026-08-01 | high (discrepancy unresolved) |
| [19] | DuckDB-WASM commit/author time series; institutional backing; dev-channel regressions; no open wrong-result bug | [GitHub commits and issues API, duckdb/duckdb-wasm](https://api.github.com/repos/duckdb/duckdb-wasm/commits) | through 2026-07-28 | 2026-08-01 | medium (absence-of-bug rests on a title-scoped search) |
| [20] | Polars has no browser build; browser path is Pyodide-only | [polars issue #24058](https://api.github.com/search/issues?q=repo:pola-rs/polars+wasm+browser) | closed 2026-03-03 | 2026-08-01 | high |
| [21] | DataFusion-WASM unmaintained: npm 2024-12-22, contrib repo 2025-04-30 | [GitHub search, datafusion wasm](https://api.github.com/search/repositories?q=datafusion+wasm) | 2025-05-18 | 2026-08-01 | high |
| [22] | Danfo.js dormancy and unpacked size; `merge` multi-key and join types; NaN fill | [GitHub, javascriptdata/danfojs](https://api.github.com/repos/javascriptdata/danfojs) + [API reference](https://danfo.jsdata.org/api-reference/dataframe) | last release 2025-04-03; maintenance issue 2026-05-19 | 2026-08-01 | high for dormancy; medium for join semantics (read from development-branch source, not documented) |
| [23] | Perspective left FINOS (repo redirect + npm deprecation); Arrow JS is not an engine | [GitHub, finos/perspective redirect](https://api.github.com/repos/finos/perspective) + [apache/arrow-js](https://api.github.com/repos/apache/arrow-js) | 2026-07-28 / 2026-07-24 | 2026-08-01 | high |
| [24] | sql.js v1.14.1, thin maintenance, MIT confirmed from LICENSE body | [GitHub, sql-js/sql.js](https://api.github.com/repos/sql-js/sql.js/releases) | 2026-03-04 | 2026-08-01 | high |
| [25] | Workers blocked from `file://` for separate script files; blob-URL exemption | [Mozilla Bugzilla 1565672](https://bugzilla.mozilla.org/show_bug.cgi?id=1565672) | 2019-07 | 2026-08-01 | **low** (single source, 2019, one browser) |
| [26] | WASM instantiable from `file://` via base64 + `WebAssembly.instantiate` | [Bart Broere (personal blog)](https://bartbroere.eu/2025/03/06/inlining-wasm-in-html-not-terrible/) | 2025-03-06 | 2026-08-01 | medium |
| [27] | Standalone HTML with base64-inlined WASM works offline | [Bun (Oven) docs](https://bun.com/docs/bundler/standalone-html) | undated (current) | 2026-08-01 | medium |
| [28] | Web Worker creation and origin rules | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) | 2026-05-07 | 2026-08-01 | high |
| [30] | **Original benchmark run for this decision**: all timings, memory, correctness fingerprints | This research run — `imports/bench.mjs`, `imports/bench-result.json` | 2026-08-01 | 2026-08-01 | high (measured), Node/V8 not browser |
| [31] | Arquero npm download time series, Jan 2025 – Jul 2026 | [npm registry download API](https://api.npmjs.org/downloads/range/2025-01-01:2026-07-31/arquero) | 2026-08-01 | 2026-08-01 | high for the trend; **low for absolute human usage** (no dependent accounts for the volume; likely CI and mirror traffic) |
| [32] | 399 dependent repositories, 57 dependent packages; Observable ecosystem does *not* depend on Arquero | [GitHub dependency graph, uwdata/arquero](https://github.com/uwdata/arquero/network/dependents) | 2026-08-01 | 2026-08-01 | high |
| [33] | Maintainer attention has moved to Mosaic; issue #361 comment "not something I have time to work on"; open-issue composition | [uwdata/arquero issue #361](https://github.com/uwdata/arquero/issues/361) | 2025-10-21 | 2026-08-01 | high |
| [34] | Fork cost measured: 172 src files / 10,764 LOC, 63 test files / 9,020 LOC, 392 tests pass on Node v26.5.0, two runtime dependencies | [uwdata/arquero](https://github.com/uwdata/arquero) — `npm ci && npm test` run this session | 2026-08-01 | 2026-08-01 | high (executed, not inferred) |
| [35] | Verb inventory, `escape()` versus parsed expressions, join key-pair footgun, `concat` source, `lookup()`, CSP issue #361, UMD dist and package fields | [Arquero API documentation](https://idl.uw.edu/arquero/api/) and the v8.0.3-tagged source | undated (v8.0.3) | 2026-08-01 | high |
| [36] | `autoType` / `autoMax` (default 1000) / `parse` precedence; `decimal` replaces only the first occurrence; CSV-versus-JSON null asymmetry | [uwdata/arquero `src/format/stream/parse-text-rows.js`](https://github.com/uwdata/arquero/blob/v8.0.3/src/format/stream/parse-text-rows.js) and `src/util/parse-values.js` | v8.0.3 tag | 2026-08-01 | high |
| [37] | `NULL = undefined` is what aggregates emit; `isValid(v) => v != null && v === v`; count/valid/invalid/distinct semantics | [uwdata/arquero `src/util/null.js`](https://github.com/uwdata/arquero/blob/v8.0.3/src/util/null.js) | v8.0.3 tag | 2026-08-01 | high |
| [38] | `toCSV` options and formatting; no BOM, CRLF or locale option | [uwdata/arquero `src/format/to-csv.js`](https://github.com/uwdata/arquero/blob/v8.0.3/src/format/to-csv.js) | v8.0.3 tag | 2026-08-01 | high |
| [39] | `hashJoin` versus `loopJoin` selection; the test named "does not treat null values as equal"; no option overrides it | [uwdata/arquero `src/verbs/join.js`](https://github.com/uwdata/arquero/blob/v8.0.3/src/verbs/join.js) and its tests | v8.0.3 tag | 2026-08-01 | high |
| [40] | **Original Arquero probes run for this deepening**: config-driven operations, concat drop, null-join workarounds and their cost, `autoMax` corruption, German CSV round trip | This research run — `imports/arquero-probe*.mjs` and matching `-result.json` | 2026-08-01 | 2026-08-01 | high (measured against the released 8.0.3 package), Node/V8 not browser |

---

## Staleness map

Staleness was computed with `recon_kit.py staleness` against the technical pack's freshness bars — versions and compatibility 1 month, ecosystem signals 6 months, landscape 12 months, patterns 2 years — using each claim's publication date rather than the access date. The full computation is preserved as `staleness.json` in this run folder, and this section is the work order for `bmad-deep-recon`'s Refresh mode.

### Already stale on delivery

Four claims exceed their bar the day this report is written. All four are reported in the body with that weakness visible, and none of them carries the recommendation.

| Re-check was due | Claim | Why it does not undermine the verdict |
|---|---|---|
| 2021-07-01 | [25] Workers blocked from `file://` for separate script files | Already flagged low confidence in the body; the recommendation runs on the main thread and does not depend on it |
| 2024-01-01 | [1] Public 1M-row benchmark | Superseded by the original benchmark run for this decision [30], which measures the actual scale and the actual operations |
| 2026-04-30 | [21] DataFusion-WASM has no maintained browser distribution | Supports a cut, not the pick; a revival would add a candidate, not remove one |
| 2026-05-30 | [10] AlaSQL README limitations | Corroborated by live issue evidence accessed 2026-08-01 [12][13], which is well inside its bar |

### Re-check schedule

| Re-check by | Class | Claims |
|---|---|---|
| **2026-09-01** | version, footprint | Bundle sizes [16]; DuckDB dist-tag and stable release [17][18]; sql.js [24] and AlaSQL [15] latest versions |
| 2026-12-02 | ecosystem | Danfo.js abandonment [22] |
| 2027-01-27 | correctness | 2026 AlaSQL correctness reports [13] |
| 2027-01-28 | ecosystem | DuckDB-WASM commit cadence [19] |
| **2027-02-01** | ecosystem, correctness | Arquero dormancy [4]; AlaSQL maintainer situation [15]; AlaSQL #1091 still open [12] |
| 2027-03-03 to 2027-07-28 | landscape, packaging | Polars browser support [20]; `file://` WASM inlining [26]; Perspective's FINOS departure [23] |
| 2027-08-01 | capability, performance, memory, license | Arquero API semantics [5][6][7][8]; benchmark results [30]; licenses [24] |
| 2028-08-01 | worker | DuckDB-WASM's Worker requirement [3] |

**Earliest live re-check: 2026-09-01.** Only two of those matter before implementation starts: whether Arquero has resumed commits — which would materially raise the runner-up's score — and DuckDB-WASM's stable-release situation. Note also that the benchmark [30] is valid for the versions tested (Arquero 8.0.3, AlaSQL 4.17.3) and should be re-run on any upgrade rather than waiting for its 2027 date.

Per the select shape's own rule: **a selection report older than two quarters should be refreshed before anyone acts on it.** This one expires around **2027-02-01**, which coincides with the ecosystem re-check. `bmad-deep-recon` Refresh handles it against this run folder.
