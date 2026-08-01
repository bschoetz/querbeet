# Digest — Performance & memory of in-browser JS/WASM transformation engines at ~100k rows (r1-1)

Accessed 2026-08-01. Budget spent: 8 sources / 15 tool calls. Two web fetches failed (timlrx blog post returned HTTP 402; the Guerra student benchmark landing page carried no data, its numbers live in an Observable notebook I did not have budget to open).

**Scope warning up front:** I found **no benchmark that measures these engines at ~100,000 rows**. The one strong independent benchmark I retrieved runs at 1,000,000 rows. Every 100k-row statement below is my extrapolation from a 1M-row measurement, and is labelled as such rather than presented as a measured number.

---

## Class: performance

- **Independent benchmark exists comparing Arquero, Danfo, sql.js/SQLite-WASM and DuckDB-WASM in a browser, at 1,000,000 rows × 24 columns (Bandcamp sales dataset, ~301 MB uncompressed / 74 MB zstd parquet), on two configs: 11th-gen Intel Core i7-1165G7 @2.80 GHz + Chrome 116, and Apple M2 MacBook Air + Firefox 117; all tests run "on a separate browser thread."** — `source:` https://github.com/timlrx/browser-data-processing-benchmarks (README) · `publisher:` Timothy Lin (timlrx), independent · `pub_date:` undated in README; Chrome 116 / Firefox 117 date it to ~2023-08/09 · `accessed:` 2026-08-01 · `confidence:` high (methodology, hardware, dataset shape and code all published) · `class:` performance

- **Group-by on 1M×24 rows, Intel i7-1165G7 / Chrome 116: Arquero 1.05 ("SELECT group by day") and 4.847 ("Top 5 countries by type"); Danfo 4.068 and 3.413; SQLite-WASM in-memory 0.638 and 1.432; DuckDB-WASM 0.163 and 0.114.** Units are ambiguous in the source — the README prose says milliseconds, but the magnitudes only make sense as **seconds** for this data shape; I read them as seconds and flag the ambiguity. — `source:` https://github.com/timlrx/browser-data-processing-benchmarks · `publisher:` timlrx · `pub_date:` ~2023 · `accessed:` 2026-08-01 · `confidence:` medium (numbers high-confidence, unit interpretation medium, single source) · `class:` performance

- **Same tests on Apple M2 MacBook Air / Firefox 117: Arquero 0.634 and 0.852; Danfo 2.73 and 3.53; SQLite-WASM 0.476 and 1.025; DuckDB-WASM 0.169 and 0.132.** The M2 is roughly 1.6–5.7× faster than the i7 on the Arquero rows — the hardware spread on one operation is larger than the gap between some engines. — `source:` https://github.com/timlrx/browser-data-processing-benchmarks · `publisher:` timlrx · `pub_date:` ~2023 · `accessed:` 2026-08-01 · `confidence:` medium · `class:` performance

- **Data *load* cost is where DuckDB-WASM loses at this scale: loading 1M×24 rows took DuckDB-WASM 4.309 (Intel) / 4.081 (M2) versus Arquero 2.866 / 1.707 and SQLite-WASM in-memory 0.893 / 0.206.** DuckDB wins every query but pays the largest ingest cost — relevant for a tool that loads 2–5 files and runs a handful of queries. — `source:` https://github.com/timlrx/browser-data-processing-benchmarks · `publisher:` timlrx · `pub_date:` ~2023 · `accessed:` 2026-08-01 · `confidence:` medium · `class:` performance

- **Danfo.js is consistently the slowest of the four on both machines, including fetch/parse (16.86 Intel, 9.487 M2 vs 1.5–3.0 for the others) and group-by (4.068 vs Arquero 1.05 on Intel).** — `source:` https://github.com/timlrx/browser-data-processing-benchmarks · `publisher:` timlrx · `pub_date:` ~2023 · `accessed:` 2026-08-01 · `confidence:` medium · `class:` performance

- **The author's stated conclusion is that WASM ports (SQLite-WASM, DuckDB-WASM) are the best in-browser choice on both performance and DX, and that "for small datasets with mostly analytical queries, Arquero at 105kB might be a decent choice."** This is the one qualitative statement that bears directly on our scale. — `source:` https://www.timlrx.com/blog/the-best-in-browser-data-processing-framework-is-sql/ (post itself returned HTTP 402 on fetch; text obtained via search-engine extract of the same post) · `publisher:` timlrx · `pub_date:` ~2023 · `accessed:` 2026-08-01 · `confidence:` low-medium (could not read the primary page directly) · `class:` performance

- **DuckDB-Wasm's own paper claims it "outperforms previous data processing libraries for the Web in the TPC-H benchmark at multiple scale factors," compared against sql.js, Arquero and Lovefield at TPC-H SF 0.5.** This is a vendor benchmark, and SF 0.5 (~3M lineitem rows) is a different scale from ours; I could not extract the per-query numbers from the PDF. — `source:` https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf · `publisher:` Kohn/Moritz/Raasveldt/Mühleisen/Neumann, PVLDB vol. 15 no. 12 · `pub_date:` 2022 · `accessed:` 2026-08-01 · `confidence:` medium for the directional claim, low for any number · `class:` performance

- **Extrapolation (NOT measured): scaling the 1M-row Intel/Chrome numbers down linearly to 100k rows puts Arquero group-by at roughly 100–500 ms and DuckDB-WASM at roughly 10–20 ms on a mid-range 2021 laptop.** Linear scaling is optimistic for hash-based group-by/join (cache effects favour the smaller size, so real 100k numbers are likely *better* than linear), but this is inference, not evidence. — `source:` derived from https://github.com/timlrx/browser-data-processing-benchmarks · `confidence:` low (inference) · `class:` performance

## Class: memory

- **DuckDB-Wasm operates inside the browser WASM memory limit, typically 2–4 GB depending on browser/platform, and uses a columnar Apache Arrow representation for results.** — `source:` https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf · `publisher:` PVLDB 2022 · `pub_date:` 2022 · `accessed:` 2026-08-01 · `confidence:` medium · `class:` memory

- **UNVERIFIED / do not rely on:** a search-result extract asserted that JS boxes numbers as heap objects at "50 bytes or more" each, implying ~5 GB for 100M numbers, and that switching an interleaved array-of-objects layout to a struct-of-arrays TypedArray layout "fixed the memory overhead in Chrome." I could not open a primary source with methodology behind either figure, and modern V8 does unbox doubles in packed arrays, so the 50-byte figure is likely wrong as stated for arrays. **No credible measured blow-up factor for array-of-objects vs columnar at a few hundred thousand rows was retrieved this run.** — `source:` https://news.ycombinator.com/item?id=46574989 (HN thread, seen only as a search extract) · `publisher:` HN commenters · `pub_date:` undated in extract · `accessed:` 2026-08-01 · `confidence:` low · `class:` memory

## Class: worker

- **DuckDB-WASM requires a Web Worker: every documented instantiation pattern (jsDelivr CDN, webpack, Vite, static serving) creates a `new Worker(worker_url)` and passes it to `AsyncDuckDB`, then awaits `instantiate()`. The worker story is the default, not an option.** — `source:` https://duckdb.org/docs/current/clients/wasm/instantiation.html · `publisher:` DuckDB · `pub_date:` undated (current docs) · `accessed:` 2026-08-01 · `confidence:` high · `class:` worker

- **DuckDB-WASM ships multiple binaries: an MVP baseline compatible with all WASM browsers and an EH (exception-handling) variant; a third SIMD+threads ("coi") variant is described in third-party docs.** The threaded variant is the one that would need cross-origin isolation; MVP/EH do not. — `source:` https://duckdb.org/docs/current/clients/wasm/instantiation.html (MVP/EH, read directly) + https://deepwiki.com/duckdb/duckdb-wasm/5.2-bundling-and-distribution (SIMD/threads variant, search extract only) · `publisher:` DuckDB / DeepWiki · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium · `class:` worker

- **The DuckDB instantiation docs I read contain NO statement about COOP/COEP, SharedArrayBuffer, cross-origin isolation, or `file://` support.** The absence is itself the finding for our single-HTML-file constraint — it is not documented as required for the MVP/EH path, and it is not documented as working either. — `source:` https://duckdb.org/docs/current/clients/wasm/instantiation.html · `publisher:` DuckDB · `accessed:` 2026-08-01 · `confidence:` medium · `class:` worker

- **Arquero has an official worker story only as a proof of concept: `uwdata/arquero-worker` is described by its own README as "a proof-of-concept implementation of worker thread support for Arquero queries," forking a Web Worker or node Worker and providing an API to author, submit and fetch query results.** Not a production-grade path. — `source:` https://github.com/uwdata/arquero-worker · `publisher:` UW Interactive Data Lab · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` medium (README read via search extract, not fetched directly) · `class:` worker

- **The timlrx benchmark itself ran all six library variants "on a separate browser thread," which is direct evidence that Arquero, Danfo, sql.js/SQLite-WASM and DuckDB-WASM can all be driven from a worker.** — `source:` https://github.com/timlrx/browser-data-processing-benchmarks · `publisher:` timlrx · `accessed:` 2026-08-01 · `confidence:` medium-high · `class:` worker

## Class: version / startup

- **A minimal community DuckDB-WASM build (`tobilg/ducklings`, optimised with -Oz, LTO, wasm-opt) reports a footprint of ~6.3 MiB.** The stock bundle is larger; I did not retrieve a stock figure. — `source:` https://github.com/tobilg/ducklings · `publisher:` tobilg, independent · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low-medium (single source, search extract only) · `class:` version

- **DuckDB's own guidance is to "design your UI to handle a few seconds of loading time during the initial startup," with browser caching mitigating repeat loads.** This is a qualitative vendor statement, not a measurement — I found **no measured DuckDB-WASM cold-start latency figure this run**. — `source:` https://duckdb.org/docs/current/clients/wasm/instantiation (search-engine extract of the docs page; the version I fetched directly did not contain this sentence) · `publisher:` DuckDB · `accessed:` 2026-08-01 · `confidence:` low · `class:` version

---

## Leads

1. **Observable notebook https://observablehq.com/d/dc562520a7fa44d0** — the actual data behind the Guerra-supervised student thesis "Evaluating Performance of In-Browser Data Processing Libraries: Arquero, DuckDB-WASM, VanillaJS" (2023, Kasi Viswanath Vandanapu, Northeastern). This is the single most promising unread source: it is an academic comparison that explicitly includes plain JavaScript as a baseline, which is exactly our sixth candidate and is absent from every other benchmark found.
2. **Run the timlrx benchmark harness ourselves at 100k rows** — the repo is public and the dataset is public; re-running at our shape (100k × 10–40 cols) would convert every extrapolation above into a measurement, and would let us add the **join** test that no retrieved benchmark contains.
3. **HN thread "My Browser WASM't Prepared for This. Using DuckDB, Apache Arrow and Web Workers"** (https://news.ycombinator.com/item?id=43599613, ~2025) — a retrospective practitioner account touching DuckDB + Arrow + Workers together; likely source of real startup and transfer costs.
4. **PVLDB PDF is downloaded locally** (a copy was saved during fetch) — the TPC-H SF 0.1/0.5 per-query table vs sql.js/Arquero/Lovefield can still be extracted from it without a network call.
5. **`uwdata/arquero-worker` commit history** — checking whether it has been touched since ~2021 decides whether Arquero-in-a-worker is a maintained path or something we would hand-roll.

## Looked for but could not find

- **Any benchmark of any of these six engines at ~100,000 rows in a browser.** Everything found is at 1M rows (timlrx) or TPC-H scale factors (DuckDB paper). Our scale is unmeasured in the public record I reached.
- **Any browser benchmark of a JOIN.** The timlrx suite covers fetch, load, aggregate, group-by, random-row selection, index creation, INSERT/UPDATE/DELETE — no join. The join question, which is central to the decision, is currently unevidenced for all six candidates.
- **Any number at all for AlaSQL** — it appears in no benchmark I retrieved.
- **Any measured in-browser memory footprint** for array-of-objects vs Arrow/typed-array representations at a few hundred thousand rows, from any engine. The array-of-objects "blow-up factor" is folklore in every source I reached.
- **Explicit documentation of whether DuckDB-WASM works from `file://` or from a page served without COOP/COEP headers.** Neither confirmed nor denied in the docs page I read. This is a hard blocker to resolve empirically before the decision, given the single-HTML-file constraint.
- **A measured DuckDB-WASM cold-start / instantiation time in milliseconds** on named hardware. Only qualitative "a few seconds" guidance.
- **Practitioner "it gets painful at N rows" reports** for any specific engine, with N and hardware named. Search surfaced only generic Web Worker advocacy content, no retrospectives with numbers.
