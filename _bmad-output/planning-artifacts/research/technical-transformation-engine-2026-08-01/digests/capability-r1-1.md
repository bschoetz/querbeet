# Digest — capability, API fit, distribution footprint (r1-1)

Run date: 2026-08-01. Budget spent: 15 tool calls, 8 distinct sources.
Scope: AlaSQL, Arquero, Danfo.js, DuckDB-WASM, sql.js — against six pipeline ops (union w/ column mapping, multi-key join, filter, column ops, computed column, group-by).

**Measurement method note (applies to every footprint claim below):** sizes were measured this run by requesting each file from `cdn.jsdelivr.net` twice — once with `Accept-Encoding: gzip`, once with `identity` — and recording `curl`'s `%{size_download}`. That is the *actual transferred* byte count from the CDN a browser would use, not an estimate. This is one source (jsDelivr). Version numbers were independently cross-checked against `registry.npmjs.org`, so version claims have two sources; the byte counts have one (marked medium confidence per the two-source rule, though the measurement is direct).

---

## Cross-cutting: measured transfer sizes, 2026-08-01

- **AlaSQL 4.17.3 `dist/alasql.min.js` transfers 109,874 bytes gzipped (511,831 raw).** `source:` https://cdn.jsdelivr.net/npm/alasql@4.17.3/dist/alasql.min.js · `publisher:` jsDelivr / npm · `pub_date:` undated (version 4.17.3) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **Arquero 8.0.3 `dist/arquero.min.js` transfers 73,879 bytes gzipped (236,290 raw).** `source:` https://cdn.jsdelivr.net/npm/arquero@8.0.3/dist/arquero.min.js · `publisher:` jsDelivr / npm · `pub_date:` undated (version 8.0.3) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **sql.js 1.14.1 costs 16,635 bytes gzipped for `sql-wasm.js` plus 322,296 bytes gzipped for `sql-wasm.wasm` (46,406 + 659,730 raw) — ~339 KB transferred total.** `source:` https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/ · `publisher:` jsDelivr / npm · `pub_date:` undated (version 1.14.1) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **Danfo.js 1.2.0 `lib/bundle.js` transfers 1,910,505 bytes gzipped (6,786,916 raw) — ~1.8 MB over the wire, ~6.8 MB parsed.** `source:` https://cdn.jsdelivr.net/npm/danfojs@1.2.0/lib/bundle.js · `publisher:` jsDelivr / npm · `pub_date:` undated (version 1.2.0) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **DuckDB-WASM 1.33.1-dev57.0 WASM payloads: `duckdb-eh.wasm` transfers 8,063,914 bytes gzipped (35,913,747 raw); `duckdb-mvp.wasm` transfers 9,189,614 bytes gzipped (41,325,187 raw).** `source:` https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/dist/ · `publisher:` jsDelivr / npm · `pub_date:` undated (version published 2026-06-22) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **DuckDB-WASM's JS glue adds `duckdb-browser.mjs` at 8,313 bytes gzipped and `duckdb-browser-eh.worker.js` at 188,242 bytes gzipped (773,223 raw).** `source:` https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/dist/ · `publisher:` jsDelivr / npm · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **Latest npm versions as of 2026-08-01: alasql 4.17.3, arquero 8.0.3, sql.js 1.14.1, danfojs 1.2.0, @duckdb/duckdb-wasm 1.33.1-dev57.0.** `source:` https://registry.npmjs.org/ (per-package `latest`) + jsDelivr `x-jsd-version` headers · `publisher:` npm, jsDelivr · `pub_date:` 2026-08-01 (live registry) · `accessed:` 2026-08-01 · `confidence:` high · `class:` version
- **@duckdb/duckdb-wasm's npm `latest` dist-tag currently points at a pre-release-labelled build, `1.33.1-dev57.0` published 2026-06-22, with `next` at `1.33.1-dev64.0`; there is no non-`dev` version at the head of the version list.** `source:` https://registry.npmjs.org/@duckdb/duckdb-wasm · `publisher:` npm · `pub_date:` 2026-06-22 (that version's publish time) · `accessed:` 2026-08-01 · `confidence:` high · `class:` version
- **DuckDB's own docs state "The latest stable version of the DuckDB WebAssembly client is 1.5.4", a version string that does not correspond to any npm `@duckdb/duckdb-wasm` dist-tag observed this run.** `source:` https://duckdb.org/docs/current/clients/wasm/overview.html · `publisher:` DuckDB Foundation · `pub_date:` undated (living doc) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` version

---

## Arquero (v8.0.3)

- **Arquero exposes `join`, `join_left`, `join_right`, `join_full`, `semijoin` and `antijoin` — all four join types plus filtering joins — as first-class table methods with signature `table.join(other[, on, values, options])`.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW Interactive Data Lab · `pub_date:` undated (v8 API reference) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Multi-key joins are expressed as data, not SQL: the `on` argument accepts an array of two-element `[leftCol, rightCol]` pairs, or a two-table predicate function — so a UI can build the key list programmatically.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Arquero join semantics treat null/undefined as unequal: "normal join semantics do not consider null or undefined values to be equal (that is, `null !== null`)" — the docs direct callers to `op.equal` in a custom predicate to change this.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **`concat` preserves all rows and `union` deduplicates, but both are documented as schema-anchored to the receiver: "Only named columns in this table are included in the output" — i.e. the output schema is the *first* table's schema and columns unique to later tables are dropped.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **The Arquero docs do not state what value fills a column that the receiver has but a concatenated table lacks (null? undefined? error?) — this is undocumented on the verbs page.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **Group-by/aggregation is `table.groupby(...keys)` followed by `rollup({outName: d => op.mean(d.col), ...})`, with `count()` as a documented shorthand; rollup takes an object of output-name → expression, which is directly constructible from UI state.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Column ops and computed columns map 1:1 to verbs: `select(...columns)`, `rename(mapping)`, `relocate(cols, {before|after})`, `derive({name: expr})`, `filter(criteria)`.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **Arquero's verbs page documents `derive`/`filter`/`rollup` expressions via arrow-function examples (`d => op.mean(d.colB)`) but does not on that page state whether expressions may be supplied as strings or otherwise assembled programmatically — for a UI-driven builder this is the one API question the verbs reference leaves open.** `source:` https://idl.uw.edu/arquero/api/verbs.html · `publisher:` UW IDL · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

### Arquero op coverage
| Op | Support | Note |
|---|---|---|
| 1. Union + column mapping | Partial | `concat`/`union` align to first table's named columns; caller must `rename`/`select` first to map A→B. Fill value undocumented. |
| 2. Multi-key join, left default | Yes | `join_left` explicit; `on` takes `[[l,r],...]`. Default of bare `join` is inner. |
| 3. Filter | Yes | `filter(criteria)` |
| 4. Select/rename/reorder | Yes | `select` / `rename` / `relocate` |
| 5. Computed column | Yes | `derive` |
| 6. Group-by aggregation | Yes | `groupby` + `rollup` / `count` |

---

## AlaSQL (v4.17.3)

- **AlaSQL is loadable from a plain HTML page with `<script src="https://cdn.jsdelivr.net/npm/alasql@4"></script>` — no build step.** `source:` https://github.com/AlaSQL/alasql · `publisher:` AlaSQL project · `pub_date:` undated (repo README/wiki) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **AlaSQL's API is SQL-string-only; there is no documented fluent/programmatic query-builder surface, so a click-together UI must generate SQL text (compiled statements can be cached for reuse).** `source:` https://github.com/AlaSQL/alasql · `publisher:` AlaSQL project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **AlaSQL queries JS arrays of objects directly via `?` placeholders, e.g. `alasql('SELECT a, SUM(b) AS b FROM ? GROUP BY a', [data])` — no import/ingest step for in-memory arrays.** `source:` https://github.com/AlaSQL/alasql · `publisher:` AlaSQL project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **AlaSQL's own documentation warns that `FULL OUTER JOIN` and `RIGHT JOIN` with more than two tables "will not produce expected results" — a self-declared correctness limitation, not a rumour.** `source:` https://github.com/AlaSQL/alasql · `publisher:` AlaSQL project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **AlaSQL documents Web Worker support both as a drop-in bundle (`alasql-worker.min.js`, auto-delegating) and as an explicit `alasql.worker()` activation, covering dedicated and shared workers.** `source:` https://github.com/AlaSQL/alasql · `publisher:` AlaSQL project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **AlaSQL supports `GROUP BY` with `SUM`/`COUNT` plus `GROUPING SETS`, `ROLLUP` and `CUBE`.** `source:` https://github.com/AlaSQL/alasql · `publisher:` AlaSQL project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **AlaSQL's repo shows ~7.3k stars with 404 open issues and 56 open PRs, and the project self-describes as an "unfunded open source project installed 650k+ times each month" — high usage, thin maintenance capacity.** `source:` https://github.com/AlaSQL/alasql · `publisher:` GitHub / AlaSQL · `pub_date:` 2026-08-01 (live repo counters) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` ecosystem

### AlaSQL op coverage
| Op | Support | Note |
|---|---|---|
| 1. Union + column mapping | Yes (via SQL) | `SELECT col AS target FROM ? UNION ALL ...` — mapping is expressed in the SELECT list; caller generates SQL. |
| 2. Multi-key join, left default | Qualified | `LEFT JOIN ... ON a.x=b.x AND a.y=b.y` fine; `RIGHT`/`FULL OUTER` documented as unreliable beyond 2 tables. |
| 3. Filter | Yes | `WHERE` |
| 4. Select/rename/reorder | Yes | SELECT list ordering + `AS` |
| 5. Computed column | Yes | SQL expression in SELECT |
| 6. Group-by aggregation | Yes | `GROUP BY` + `ROLLUP`/`CUBE`/`GROUPING SETS` |

---

## sql.js (v1.14.1)

- **sql.js is loaded via script tag plus an initializer that must be told where the wasm lives, e.g. `locateFile: file => \`https://sql.js.org/dist/${file}\`` — the `.js` loader and `.wasm` binary are separate artifacts.** `source:` https://github.com/sql-js/sql.js · `publisher:` sql-js project · `pub_date:` undated (repo README) · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **The sql.js API surface is `db.exec()` (returns `{columns, values}`), `db.prepare()`/`stmt.bind()`/`stmt.getAsObject()`, plus `db.create_function()` and `db.create_aggregate()` for JS UDFs — everything is driven by SQL strings.** `source:` https://github.com/sql-js/sql.js · `publisher:` sql-js project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` high · `class:` capability
- **sql.js has no documented bulk array-of-objects import: the `Database` constructor accepts only a `Uint8Array` of an SQLite file, so loading 100k parsed rows means generating INSERT statements yourself.** `source:` https://github.com/sql-js/sql.js · `publisher:` sql-js project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **sql.js ships `worker.sql-wasm.js` for offloading queries to a Web Worker, with an API the project describes as more limited than the main library.** `source:` https://github.com/sql-js/sql.js · `publisher:` sql-js project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **Because sql.js is SQLite, all four join types and multi-key ON clauses are available in SQL, but nothing in the API is composable from JS objects — the whole pipeline would be string generation.** `source:` https://github.com/sql-js/sql.js · `publisher:` sql-js project · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability (SQLite feature set inferred, not separately verified this run)

### sql.js op coverage
| Op | Support | Note |
|---|---|---|
| 1–6 | Yes via SQL | All six expressible in SQLite SQL, but every one is a generated string; plus you must hand-write the array→table ingest layer (no bulk import). |

---

## DuckDB-WASM (npm latest 1.33.1-dev57.0)

- **The DuckDB-WASM WASM payload is not "a few MB": measured this run, `duckdb-eh.wasm` is ~8.06 MB gzipped / ~35.9 MB uncompressed and `duckdb-mvp.wasm` ~9.19 MB gzipped / ~41.3 MB uncompressed — inlining either as base64 into a single HTML file would produce a ~48–55 MB document.** `source:` https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/dist/ · `publisher:` jsDelivr / npm · `pub_date:` undated (version published 2026-06-22) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint
- **DuckDB's docs mention "about 3.2 MB of compressed Wasm files" in the context of loading extensions — a figure that is far below the core `duckdb-eh.wasm` transfer measured here, so it should not be read as the core engine size.** `source:` https://duckdb.org/docs/current/clients/wasm/overview.html · `publisher:` DuckDB Foundation · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low · `class:` footprint
- **DuckDB-WASM is documented as single-threaded with multithreading noted as experimental, and is explicitly "sandboxed and might not have the same level of support for out-of-core operations and access to file system".** `source:` https://duckdb.org/docs/current/clients/wasm/overview.html + https://github.com/duckdb/duckdb-wasm · `publisher:` DuckDB Foundation · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **The distribution ships a dedicated worker script per bundle variant (`duckdb-browser-eh.worker.js`, 188 KB gzipped), which is strong evidence the intended execution model is worker-based; I could not retrieve a doc sentence this run that states a Worker is *required*.** `source:` https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/dist/duckdb-browser-eh.worker.js · `publisher:` jsDelivr / npm · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low · `class:` capability
- **DuckDB-Wasm was measured, in the project's own VLDB paper, to outperform JS competitors "by a factor of 10 to 100 across all scale factors", with Arquero and Lovefield scaling worse as data grows.** `source:` https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf (via search result summary) · `publisher:` VLDB / Kohn et al. · `pub_date:` 2022 · `accessed:` 2026-08-01 · `confidence:` low · `class:` ecosystem — **stale vs. the 12-month landscape bar and not read in full this run; treat as directional only, and note the authors are the DuckDB-Wasm authors.**

### DuckDB-WASM op coverage
| Op | Support | Note |
|---|---|---|
| 1–6 | Yes via SQL | Full SQL engine; union-by-name, all join types, group-by all native. API is SQL strings + Arrow results. Cost is the ~8 MB wasm, not the feature set. |

*(Not verified this run: the exact `getJsDelivrBundles`/`selectBundle` instantiation snippet, `registerFileText`/`insertJSONFromPath` signatures, and whether self-hosting the .wasm offline is documented. See Looked-for.)*

---

## Danfo.js (v1.2.0)

- **Danfo.js DataFrame documents `merge` ("Merge DataFrame or named Series objects with a database-style join") and `concat`, but the API reference page does not document which join types are supported or whether multi-column keys are allowed.** `source:` https://danfo.jsdata.org/api-reference/dataframe · `publisher:` Danfo.js / JSdata · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **The Danfo.js API reference does not specify how `concat` handles tables with differing column sets.** `source:` https://danfo.jsdata.org/api-reference/dataframe · `publisher:` Danfo.js · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability
- **Danfo.js covers the remaining five ops: `groupby` with `sum/mean/median/min/max/count/std/var` and cumulative variants; `query` for boolean filtering; `loc`/`iloc`; `rename`/`drop`; `addColumn`/`apply`; and explicit missing-value handling via `isNa`/`fillNa`/`dropNa`/`replace` plus `asType` casting.** `source:` https://danfo.jsdata.org/api-reference/dataframe · `publisher:` Danfo.js · `pub_date:` undated · `accessed:" 2026-08-01 · `confidence:` high · `class:` capability
- **Danfo.js is by far the heaviest pure-JS option measured: ~1.82 MB gzipped / 6.8 MB parsed for `lib/bundle.js`, roughly 25× Arquero — it bundles TensorFlow.js-derived machinery this use case does not need.** `source:` https://cdn.jsdelivr.net/npm/danfojs@1.2.0/lib/bundle.js · `publisher:` jsDelivr / npm · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` footprint (the *reason* for the size — TF.js — is my inference, not sourced)
- **The Danfo.js DataFrame API reference page carries no CDN script-tag instructions.** `source:` https://danfo.jsdata.org/api-reference/dataframe · `publisher:` Danfo.js · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` capability

---

## Hand-rolling vs. taking a dependency

- **A published benchmark study compares Arquero, DuckDB-WASM and hand-written VanillaJS for in-browser data processing, indicating the hand-rolled baseline is a taken-seriously comparison point rather than a straw man.** `source:` https://johnguerra.co/students/2023KasiViswanathBenchmarkingDataProcessingLibraries/ · `publisher:` Northeastern / John Guerra (student project) · `pub_date:` 2023 · `accessed:` 2026-08-01 · `confidence:` low · `class:` ecosystem — **title/abstract only via search results; not read this run; 2023 is past the 12-month landscape bar.**
- **A practitioner comparison argues Arquero "at 105kB might be a decent choice for small datasets" while SQL-based engines win on performance and developer experience for everything else.** `source:` https://www.timlrx.com/blog/the-best-in-browser-data-processing-framework-is-sql/ · `publisher:` Tim Lin (Quasilinear Musings) · `pub_date:` undated in snippet · `accessed:` 2026-08-01 · `confidence:` low · `class:` ecosystem — **the page returned HTTP 402 to direct fetch; this is a search-engine summary of it, i.e. an aggregator, and the 105 kB figure disagrees with my measured 73.9 KB gzip / 236 KB raw for arquero.min.js 8.0.3.**
- **I did not find a first-hand account from someone who wrote these six operations by hand and reported the cost. The honest state is: not established this run.** `confidence:` high (about the absence) · `class:` ecosystem

---

## Leads

1. **`duckdb-wasm` API docs at `shell.duckdb.org/docs/modules/index.html`** — the GitHub README defers to it for `getJsDelivrBundles`/`selectBundle`/`insertJSONFromPath`. Fetch it directly next run; the duckdb.org overview page is a stub that only links onward.
2. **Arquero source for `concat`** — `github.com/uwdata/arquero`, `src/verbs/*` — resolves the undocumented question of what fills a missing column on concat (null vs undefined vs drop). ~20 lines of code will settle op #1 definitively.
3. **Arquero `escape()` and string-expression support** — the verbs page doesn't cover how to build `derive`/`filter` expressions programmatically. Check `idl.uw.edu/arquero/api/expressions.html`, which the search surfaced but I did not read. This is decisive for a click-together UI.
4. **AlaSQL issue tracker filtered to `join` / `union`** — 404 open issues is a large enough backlog that the documented `FULL OUTER`/`RIGHT JOIN` caveat likely has companions. Search issues for "left join wrong results".
5. **timlrx/browser-data-processing-benchmarks on GitHub** — the repo behind the paywalled blog post; benchmark code and possibly a vanilla-JS baseline, retrievable where the blog was not.
6. **DuckDB versioning discrepancy** — docs say "stable 1.5.4", npm `latest` is `1.33.1-dev57.0`. Worth resolving before any version claim is made in the decision doc; it may mean the npm package and the documented client version numbers are separate series.

## Looked for but could not find

- The DuckDB-WASM CDN instantiation snippet, Worker requirement statement, mvp/eh/coi variant documentation, and any official statement about self-hosting the `.wasm` for offline use. Both duckdb.org/docs and the GitHub README defer elsewhere.
- Whether sql.js's `.wasm` can be inlined as a base64 data URI via `locateFile` (a plausible single-file workaround). One fetched summary asserted it "cannot be inlined"; I could not corroborate that against the README text, so I treat it as unresolved rather than as a finding.
- Danfo.js `merge` join-type list and multi-key support; Danfo.js `concat` column-alignment semantics; Danfo.js CDN usage. The API reference page is a method index without semantics.
- Any first-hand practitioner account of hand-writing these six operations vs. adopting a library.
- Independent second sources for the byte counts (bundlephobia was not queried). The measurements are direct-from-CDN, which I consider stronger than bundlephobia, but the two-source bar is formally unmet.
- Publication dates for essentially every documentation page consulted — Arquero, AlaSQL, Danfo.js and sql.js docs are all undated living documents. Version numbers are current (verified against npm 2026-08-01); doc *text* freshness is unverifiable.
