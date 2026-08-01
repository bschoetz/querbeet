# Packaging feasibility — single self-contained HTML, `file://` viability (R1-1)

Run date: 2026-08-01. Budget spent: 15 tool calls, 6 distinct sources read.
Scope note: the two decisive questions (`file://` Workers, `file://` WASM) consumed most of the budget. Library-specific claims for Arquero, AlaSQL and Perspective are **unverified this run** — see "Looked for but could not find".

---

## Claims

### A. Workers from `file://` — the decisive question

- **Firefox deliberately blocks a Worker constructed from a separate script file when the page is opened via `file://`; the bug was closed RESOLVED INVALID because the behavior is intended, not a regression to fix.** `source:` https://bugzilla.mozilla.org/show_bug.cgi?id=1565672 · `publisher:` Mozilla Bugzilla · `pub_date:` 2019-07 (opened; closed ~2019–2020, last comment ~2021) · `accessed:` 2026-08-01 · `confidence:` high · `class:` browser-behavior

- **Mozilla's stated design rule, from platform engineer Boris Zbarsky: "workers loaded from file:// should not work, basically, unless you load the worker from the exact same file as the HTML involved."** `source:` https://bugzilla.mozilla.org/show_bug.cgi?id=1565672 · `publisher:` Mozilla Bugzilla (comment by Boris Zbarsky) · `pub_date:` 2019-07 (approx) · `accessed:` 2026-08-01 · `confidence:` high · `class:` browser-behavior

- **The cause is Firefox 68 treating each `file:` URI as a unique/opaque origin, a change driven by CVE-2019-11730 (local HTML files stealing other local files); the tracking bug is "Treating file: URIs as unique origins".** `source:` https://bugzilla.mozilla.org/show_bug.cgi?id=1500453 · `publisher:` Mozilla Bugzilla · `pub_date:` 2018–2019 · `accessed:` 2026-08-01 · `confidence:` high · `class:` browser-behavior
  - *Caveat:* I saw bug 1500453 only as a search result title plus cross-reference from 1565672; I did not read the bug body. The CVE attribution comes from 1565672.

- **A Worker created from a `Blob` object URL (`URL.createObjectURL(new Blob([code]))`) DOES still work from a `file://` page in Firefox — this is the workaround the bug reporter demonstrated in comment 14 and which led to the bug being closed as INVALID rather than left open.** `source:` https://bugzilla.mozilla.org/show_bug.cgi?id=1565672 · `publisher:` Mozilla Bugzilla · `pub_date:` 2019 (approx) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` browser-behavior
  - **This is the single most load-bearing claim in this digest and it rests on ONE source, from 2019, for ONE browser.** It fails the two-source bar. It is also trivially testable in ten minutes — see Leads.

- **Chrome/Chromium treats each `file:///` URL as having a unique origin, so cross-file access from a local page is blocked as cross-origin; `--allow-file-access-from-files` exists as a developer escape hatch.** `source:` search synthesis over https://bugs.chromium.org/p/chromium/issues/detail?id=357664 and related · `publisher:` Chromium issue tracker (via search snippets) · `pub_date:` undated / pre-2020 · `accessed:` 2026-08-01 · `confidence:` low · `class:` browser-behavior
  - **Unverified belief.** `issues.chromium.org` returned a sign-in wall to WebFetch, so I could not read any Chromium issue body directly this run. The Firefox bug asserts the Firefox 68 change was made to align with "other browsers", which is consistent with Chrome blocking file-script Workers, but I have no Chrome-side primary source and no source under 12 months. **Treat Chrome and Edge `file://` Worker behavior as UNKNOWN as of 2026-08-01.** No evidence at all was retrieved for Safari.

- **MDN's "Using web workers" guide (last modified 2026-05-07) does not document `file://` behavior at all — it covers only same-origin requirements for subworkers and SharedWorker, and notes that a worker whose script URL has a `data:` or `blob:` scheme gets a globally unique origin and therefore inherits the creating document's CSP.** `source:` https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers · `publisher:` MDN · `pub_date:` 2026-05-07 · `accessed:` 2026-08-01 · `confidence:` high · `class:` browser-behavior
  - Relevant corollary: a blob-URL worker is NOT exempt from the document's CSP, so a restrictive `script-src`/`worker-src` would still block it. Under `file://` there is normally no CSP header, but an inline `<meta http-equiv="Content-Security-Policy">` in the single-file HTML would apply.

### B. WebAssembly from `file://`

- **A practitioner inlined Pyodide (CPython/WASM) into one HTML file by base64-encoding the `.wasm` and zip payloads, replacing `WebAssembly.instantiateStreaming` with `WebAssembly.instantiate` over a `Uint8Array` decoded from base64, and reports opening the result directly from the local filesystem with no CORS errors.** `source:` https://bartbroere.eu/2025/03/06/inlining-wasm-in-html-not-terrible/ · `publisher:` Bart Broere (personal blog) · `pub_date:` 2025-03-06 · `accessed:` 2026-08-01 · `confidence:` high · `class:` browser-behavior
  - Size datapoint: ~30 MB uncompressed, 11 MB gzip, 6 MB brotli for the full Pyodide console. Author also floats Base122 (~14% inflation vs base64's 33%).

- **Bun's bundler ships a documented standalone-HTML mode that inlines JS/TS/JSX/CSS/images/fonts/video **and WASM binaries** as base64 data URIs into one `.html`, and the docs explicitly claim: "Double-click it from your desktop — it opens in the browser and works offline, no localhost server needed."** `source:` https://bun.com/docs/bundler/standalone-html · `publisher:` Bun (Oven) · `pub_date:` undated (current docs) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` packaging
  - Stated limitations: no code splitting; 33% base64 size overhead; external/absolute URLs are left as-is (only relative paths inlined). **No mention of Web Workers anywhere in the doc** — neither support nor caveat.

- **Together these two independent sources support: WASM instantiation from inlined bytes works from `file://`; `instantiateStreaming` does not and must be swapped for the ArrayBuffer path.** `confidence:` high for the ArrayBuffer path, `class:` browser-behavior. The `instantiateStreaming` failure mode (MIME type requirement) is corroborated by the Broere post being forced to replace it; I did not retrieve a separate spec/MDN citation for it this run.

### C. Build-tool support

- **`vite-plugin-singlefile` inlines all JavaScript and CSS into `dist/index.html` so the app ships as one HTML file.** `source:` https://www.npmjs.com/package/vite-plugin-singlefile · `publisher:` npm / plugin author · `pub_date:` undated (read via search snippet only) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` packaging
  - I did not open the README directly; this is from search-result summary. Notably I found **no statement from the plugin about WASM or Workers** — the gap is real, not merely unread.

- **Vite core: `.wasm` files smaller than `assetInlineLimit` are inlined as base64, larger ones are emitted as separate assets and fetched at runtime; Workers are emitted as separate chunks by default but can be inlined as base64 with the `?worker&inline` import query.** `source:` https://vite.dev/guide/features · `publisher:` Vite · `pub_date:` undated (current docs, read via search snippet) · `accessed:` 2026-08-01 · `confidence:` medium · `class:` packaging
  - Implication: for a single-file build you must raise `assetInlineLimit` above the wasm size **and** use `?worker&inline`. The inline-worker path in Vite produces a Blob-URL worker, which is exactly the form that the Firefox bug indicates still works from `file://`.

### D. DuckDB-WASM

- **DuckDB-Wasm's architecture is a main-thread wrapper plus a DuckDB engine that lives in a Web Worker and communicates by message passing; the Worker is the standard and documented instantiation path.** `source:` https://duckdb.org/2021/10/29/duckdb-wasm and https://duckdb.org/docs/current/clients/wasm/instantiation · `publisher:` DuckDB · `pub_date:` 2021-10-29 (blog) / current docs · `accessed:` 2026-08-01 · `confidence:` high · `class:` packaging
  - **Stale-risk flag:** the architectural blog post is nearly 5 years old. The instantiation docs are current but I read them only via search snippet.

- **There is no official main-thread / worker-less DuckDB-Wasm API: a maintainer (carlopi) said on 2023-10-15 it "should be workable ... but there is some refactoring needed", and as of the last reply on 2025-03-19 the discussion was still unresolved with no documented solution.** `source:` https://github.com/duckdb/duckdb-wasm/discussions/1445 · `publisher:` GitHub / duckdb-wasm · `pub_date:` 2023-10-15 to 2025-03-19 · `accessed:` 2026-08-01 · `confidence:` high · `class:` packaging
  - Practical read: **DuckDB-WASM requires a Worker.** Its viability under `file://` is therefore entirely contingent on the blob-URL-worker claim in section A.

- **Cross-origin isolation (COOP/COEP) is NOT required for baseline DuckDB-Wasm — COI is a distinct optional bundle needed only for maximum thread count via SharedArrayBuffer/WASM threads, and DuckDB explicitly assumed "the majority of users on non-isolated websites."** `source:` https://duckdb.org/2021/10/29/duckdb-wasm and https://shell.duckdb.org/docs/interfaces/index.DuckDBBundles.html · `publisher:` DuckDB · `pub_date:` 2021-10-29 / undated API docs · `accessed:` 2026-08-01 · `confidence:` medium · `class:` packaging
  - So the `eh` (exception-handling) bundle should not need headers a `file://` page cannot receive. Good news for the header question; the Worker question remains the blocker.

- **DuckDB's own `examples/plain-html` demonstrates creating the worker URL from a Blob rather than a file path.** `source:` https://github.com/duckdb/duckdb-wasm/blob/main/examples/plain-html/index.html · `publisher:` DuckDB · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low · `class:` packaging
  - Read via search snippet only; not opened. If accurate, the blob-worker pattern is already the sanctioned no-bundler path, which materially helps the single-file case.

- **Offline usage requires manually downloading dist files; users report `NetworkError` when resources cannot be fetched offline.** `source:` https://duckdb.org/docs/lts/clients/wasm/deploying_duckdb_wasm (via search snippet) · `publisher:` DuckDB · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low · `class:` packaging

### E. sql.js

- **A third-party project, `sql.js-standalone`, exists specifically to compile sql.js JS + the required WebAssembly into a single locally-executable script, demonstrating the single-file pattern is achievable.** `source:` https://github.com/hmellanger/sql.js-standalone · `publisher:` GitHub (third party) · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low · `class:` packaging
  - Read via search snippet only. Third-party, unknown maintenance state — do not treat as a supported path.

- **sql.js's own README frames distribution as the two-file pair (`sql-wasm.js` loader + `sql-wasm.wasm`).** `source:` https://github.com/sql-js/sql.js/blob/master/README.md · `publisher:` sql.js · `pub_date:` undated · `accessed:` 2026-08-01 · `confidence:` low · `class:` packaging
  - **I did NOT verify the `wasmBinary` / `locateFile` config options this run.** My prior belief is that sql.js exposes Emscripten's standard `wasmBinary` option accepting an ArrayBuffer, and Emscripten offers `-sSINGLE_FILE` to embed the wasm as base64 in the JS — **both stated here as unverified beliefs, not findings.**

---

## Verdict table

| Candidate | Single-file packageable | What breaks / what to watch |
|---|---|---|
| **Arquero, AlaSQL** (pure JS) | **Unverified — presumed yes** | No evidence retrieved this run. The brief's specific asks (hidden dynamic import, `new Worker()` from a file, runtime `fetch()` of an asset, `new Function`/`eval` under CSP) were NOT checked. AlaSQL in particular historically compiles SQL to JS at runtime, which would be an `eval`/`new Function` CSP concern — unverified. |
| **sql.js** | **Qualified yes** | WASM must be inlined and instantiated from bytes, not `instantiateStreaming`. A standalone single-file build demonstrably exists (`sql.js-standalone`), but it is third-party; the first-party documented path is two files. sql.js needs no Worker, which removes the decisive risk. Best-odds candidate. |
| **DuckDB-WASM** | **Qualified — hinges on one unverified claim** | Requires a Web Worker; no main-thread API exists (maintainer, still unresolved 2025-03-19). Viability under `file://` therefore depends entirely on blob-URL Workers being permitted from an opaque `file://` origin — evidenced for Firefox in 2019, **unverified for Chrome/Edge in 2026**. COOP/COEP is NOT a blocker (COI is a separate optional bundle). Size remains ~50 MB inlined at 33% base64 overhead. |
| **Perspective** (`@perspective-dev/*`) | **Unverified** | No source retrieved this run. Its Worker and `.wasm` artifact structure, and any `file://` viability, are entirely unexamined. |

**Bottom line on the two decisive questions:**
1. **`file://` WASM: YES, via `WebAssembly.instantiate` on an inlined byte array.** Two independent sources (Broere 2025-03, Bun docs). `instantiateStreaming` must be replaced. This is settled enough to build on.
2. **`file://` Workers: NOT SETTLED.** Workers from a separate script file are deliberately blocked (Firefox, high confidence; Chrome, unverified). Blob-URL Workers appear to remain permitted, but that rests on a single 2019 Firefox bug comment. **Current authoritative evidence for 2026 Chrome/Edge behavior is thin — I could not read a single Chromium issue this run because the tracker returned a sign-in wall.** This is cheaply testable and should be tested before any decision depends on it.

---

## Leads

- **Highest value, ~15 minutes: write the test.** One HTML file, opened via `file://` in current Chrome, Edge, Firefox and Safari. Test three things: (a) `new Worker(URL.createObjectURL(new Blob([...])))`; (b) `new Worker(dataURI)`; (c) `WebAssembly.instantiate(bytes)` inside that worker. This single experiment resolves the entire DuckDB question and is far cheaper than more searching.
- Chromium issue tracker via an unauthenticated mirror or the `chromium-html5` / `blink-dev` mailing list archives on groups.google.com — WebFetch hit a login wall on `issues.chromium.org` directly.
- WHATWG HTML spec, "worker script fetch" / "run a worker" algorithm — the spec text on which origins may fetch a worker script is normative and would settle the blob/data question independently of any browser's bug tracker.
- `hmellanger/sql.js-standalone` build script — likely shows the exact Emscripten flag or post-processing step needed, generalizable to other Emscripten-built WASM libraries.
- Emscripten `-sSINGLE_FILE` documentation — the canonical mechanism for base64-embedding wasm into the JS glue; would confirm the sql.js path first-hand.
- Perspective docs at the new `@perspective-dev/*` scope — completely unexamined.

## Looked for but could not find

- **Any Chromium issue body.** `issues.chromium.org/issues/41098022` returned only a sign-in page to WebFetch. All Chrome-side claims here are search-snippet grade, undated or pre-2020, and are marked low confidence accordingly.
- **Any source under 12 months on `file://` Worker behavior in any browser.** The freshest direct evidence is a 2019 Bugzilla thread. Per the freshness rule, all `file://` Worker claims must be treated as possibly stale.
- **Any Safari / WebKit evidence whatsoever** on `file://` Workers or WASM.
- **Confirmation that data-URI Workers work from `file://`.** Only the Blob path was evidenced.
- **Arquero and AlaSQL packaging characteristics** — dynamic imports, runtime fetches, `eval`/`new Function` usage. Not searched; budget went to the decisive questions as instructed.
- **Perspective (`@perspective-dev/*`)** — no source retrieved.
- **`vite-plugin-singlefile`'s own statements about WASM and Workers.** The README was not opened directly, and no search result surfaced such a statement, which weakly suggests the plugin does not address them.
- **A first-party sql.js statement about `wasmBinary` or single-file builds.**
- **Any statement about ES-module inlining constraints in a single file** (e.g. whether `<script type="module">` inline blocks behave differently under `file://`, or module-specific CORS rules for local files). This was asked in the brief and I found nothing — it is a real open question, since ES modules are subject to CORS even same-origin, and opaque `file://` origins could plausibly break inline module imports.
