# Original measurement — export cost in a browser, and worker control (querbeet R4/D3, M2 + M8)

**Date:** 2026-08-01 · **Harness:** `export-probe.html` + `run-export.mjs`, `sab-probe.html` +
`run-sab.mjs`, headless Playwright 1.62, real `file://` URL · **Engines:** Chromium 151.0.7922.34,
Firefox 153.0 · **Raw:** `export-chromium.json`, `export-firefox.json`, and the `run-sab.mjs`
output quoted below · **Libraries:** write-excel-file 4.1.1 (shipped UMD bundle),
hyparquet-writer 0.16.3 (ESM only, bundled to IIFE with esbuild — R3's finding that makes the
build step mandatory). Both are injected as source text, never fetched, and the *same* text goes
into the page and into the worker body.

R3 measured these two exports in Node and said so plainly. This re-measures them in a browser.

## The headline: R3's Node figures understate the browser badly

| Export | Rows | Chromium 151 | Firefox 153 | R3 (Node) |
| --- | ---: | ---: | ---: | ---: |
| xlsx (write-excel-file) | 100,000 | **4,943.8 ms** | **5,805 ms** | ~3,300–3,400 ms |
| xlsx | 500,000 | **26,269.7 ms** | **30,558 ms** | ~16,000 ms (projected) |
| Parquet SNAPPY | 100,000 | **1,553.6 ms** | **801 ms** | 273 ms |
| Parquet SNAPPY | 500,000 | **9,717 ms** | **4,369 ms** | — |

xlsx at half a million rows is **26–31 seconds**, against R3's linear projection of ~16 s. It
does not scale linearly: Chromium goes 4.9 s → 26.3 s for 5× the rows, a factor of 5.3.

**Parquet reverses the usual engine ranking.** Firefox is roughly **twice as fast as Chromium**
here (801 vs 1,553.6 ms at 100k; 4,369 vs 9,717 ms at 500k), which is the opposite of D2's finding
that Firefox is 1.5–2× slower on Arquero work. Engine ranking is per-operation, not global.

**On the 273 ms.** Re-running hyparquet-writer 0.16.3 in Node 26 against *this probe's* data shape
gives **933 ms**, not 273 ms — so R3's figure describes a different, narrower dataset, and the
browser-versus-Node penalty is **1.65×** (933 ms Node → 1,553.6 ms Chromium), not 5.7×. The
comparison in the table above is honest about row count and column count but not about R3's exact
shape; the 1.65× is the like-for-like number.

## Three library traps, all silent, all measured

### 1. `writeXlsxFile(sheet)` returns a builder, not a result — and the README contradicts itself

The browser entry point returns `{ toBlob(), toFile(fileName) }`. `await writeXlsxFile(sheet)`
therefore resolves to that object, does **no work at all**, throws nothing, and yields a `blob.size`
of `undefined`. This probe's first run reported xlsx export at 37.9 ms for 100,000 rows because of
it. The correct call is `await writeXlsxFile(sheet).toBlob()`.

**This is a migration trap, not a library defect, and the distinction matters.** The shipped
README documents the change at the top (line 42): *"Instead of receiving options such as `fileName`
or `filePath` or `buffer: true` … it now returns an object with several `async toXxx()` methods"*,
with `Old: await writeExcelFile(data, { filePath: … })` / `New: await writeExcelFile(data).toFile(…)`.

But the same README still carries a v3 example further down (line 210): *"Example 3: `filePath`
parameter is not passed, but `blob: true` parameter is passed, so it returns a `Blob`."* The
changelog and the examples disagree inside one file.

That resolves R3's finding rather than repeating it. R3 recorded `filePath` as *"a documented
silent no-op"* on the Node entry and concluded "verify options took effect rather than trusting its
README". The mechanism is now identified: the option is not documented-and-broken, it is
**removed in 4.0 and still described by a surviving example**. R3's advice stands; its diagnosis
should read "the README is internally inconsistent across the 3 → 4 boundary". Both entry points
are affected, and this run walked into the browser half exactly as R3 walked into the Node half.

### 2. `codec: 'GZIP'` writes an unreadable file

hyparquet-writer 0.16.3 registers exactly one compressor by default —
`this.compressors = { SNAPPY: snappyCompress, ...compressors }` — and the page writer falls back
with `compressors[codec]?.(pageBytes) ?? pageBytes`. Asking for GZIP therefore writes the pages
**uncompressed** while still recording GZIP in the column metadata.

Measured, and verified against an independent reader (pyarrow 25.0.0):

| Request | Bytes (2,000 × 4 probe) | pyarrow 25 read |
| --- | ---: | --- |
| `codec: 'SNAPPY'` (default) | 38,819 | OK, declared SNAPPY |
| `codec: 'UNCOMPRESSED'` | 101,550 | OK, declared UNCOMPRESSED |
| `codec: 'GZIP'` | **101,550 — byte-identical to uncompressed** | **`OSError: GZipCodec failed: unknown compression method`** |
| `codec: 'GZIP'` + `compressors: { GZIP: fflate.gzipSync }` | **16,386** | OK, declared GZIP |

The **default** is documented — the README lists `compressors?: Compressors // custom compressors
(default includes snappy)`. What is not documented, and what makes this a defect rather than a
configuration detail, is the **failure mode**: requesting a codec with no registered compressor
neither throws nor warns; it writes raw bytes and labels them with the codec that was asked for.
So the option is not merely ignored: it produces a file that a real Parquet reader **refuses**.
The fix is one option — and R3 already put `fflate` in the bundle, because `hyparquet-writer`'s
GZIP support is exactly what it was carried for. GZIP is also **2.4× smaller than SNAPPY** here,
so this is worth having rather than avoiding.

In the 100,000-row export the effect on size is the same story: SNAPPY 9,001,981 B against
22,437,577 B for uncompressed *and* for the GZIP request.

### 3. A write-excel-file sheet cannot cross a thread boundary

The sheet format's `type` field holds the native `Number` / `String` **constructor**. Structured
clone refuses it: `DataCloneError: function Number() { [native code] } could not be cloned`. A
worker cannot be handed a finished sheet — it has to receive plain rows and build the sheet on the
far side. Both paths in this probe do that, which is why the `shape` column below is timed
separately on whichever thread does the work.

## Main thread versus worker

`postBlock` is what the tab actually loses; `total` is what the user waits.

### Chromium 151

| Export | Rows | Main thread | Worker: postBlock | Worker: transfer | Worker: work | Worker: total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Parquet SNAPPY | 100,000 | 1,553.6 ms | **59.9 ms** | 95.6 ms | 1,750.2 ms | 1,845.9 ms |
| Parquet SNAPPY | 500,000 | 9,717 ms | **294.7 ms** | 597.5 ms | 10,397.1 ms | 10,994.8 ms |
| xlsx | 100,000 | 4,943.8 ms | **242.3 ms** | 330.1 ms | 4,941.2 ms | 5,271.5 ms |
| xlsx | 500,000 | 26,269.7 ms | **1,332 ms** | 1,810.7 ms | 24,229.7 ms | 26,040.6 ms |

### Firefox 153

| Export | Rows | Main thread | Worker: postBlock | Worker: transfer | Worker: work | Worker: total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Parquet SNAPPY | 100,000 | 801 ms | **99 ms** | 169 ms | 723 ms | 892 ms |
| Parquet SNAPPY | 500,000 | 4,369 ms | **502 ms** | 927 ms | 3,451 ms | 4,378 ms |
| xlsx | 100,000 | 5,805 ms | **123 ms** | 251 ms | 5,561 ms | 5,813 ms |
| xlsx | 500,000 | 30,558 ms | **648 ms** | 1,328 ms | 30,911 ms | 32,239 ms |

Across all eight pairs the worker **removes 88–98 % of the main-thread block** at an elapsed-time
cost between **−0.9 % and +18.8 %**. The overhead is largest on the *shortest* job (Parquet at 100k in
Chromium, +18.8 %) and vanishes on the longest (xlsx at 500k, −0.9 %, inside the noise) — worker
handover is a fixed cost, so it only matters when the work is short. Note
that the Parquet worker path sends *columns* while the xlsx worker path sends *rows*, which is why
xlsx's postBlock is the larger of the two at equal row count — it matches M1's shape comparison.

## M8 — progress and cancellation

### SharedArrayBuffer is not available, and the WASM escape hatch does not rescue it

A `file://` page sends no headers, so it can never be cross-origin isolated and the
`SharedArrayBuffer` constructor is hidden (`crossOriginIsolated: false`,
`typeof SharedArrayBuffer === 'undefined'` in both engines). MDN documents an escape hatch:
`new WebAssembly.Memory({shared: true}).buffer` *is* a SharedArrayBuffer regardless.

It is — and it is useless here. Both engines construct it and both refuse to send it:

| Engine | `wasmBufferType` | `postMessage(buf)` |
| --- | --- | --- |
| Chromium 151 | `SharedArrayBuffer` | **throws** — `DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.` |
| Firefox 153 | `SharedArrayBuffer` | **throws** — `DataCloneError: The SharedArrayBuffer object cannot be serialized. The Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy HTTP headers can be used to enable this.` |

`Atomics.wait` exists in the worker in both engines, which is the detail that makes this worth
stating explicitly: the API surface is present and the memory cannot be shared, so a probe that
only checked `typeof Atomics` would have concluded the opposite.

### Cancellation therefore goes through the message queue, and that is fine

A running synchronous block cannot be interrupted, so a worker only notices a cancel when it
yields. Measured latency from posting `cancel` to the worker acknowledging it:

| Chunk size (loop iterations between yields) | Chromium 151 | Firefox 153 |
| --- | ---: | ---: |
| 1,000,000 (≈5 ms of work) | **3.0 ms** | **2 ms** |
| 10,000,000 (≈50 ms of work) | **17.2 ms** | **7 ms** |

Cancellation latency is a function of chunk size and nothing else — the same chunking that keeps a
worker responsive is what makes it cancellable.

### Progress messages are effectively free

400 million iterations of work, ~570 ms, with progress posted at three granularities:

| Progress messages | Chromium: worker ms | Firefox: worker ms |
| --- | ---: | ---: |
| 0 | 571.1 | 574 |
| 10 | 583.2 | 582 |
| 100 | 586.1 | 594 |

100 progress messages cost about **15 ms on 571 ms — 2.6 %**. There is no reason to be stingy with
progress granularity.

## Method notes

- No page errors in either engine, and the only request beyond the document was the worker's own
  `blob:` URL — the artefact fetches nothing at runtime.
- Each case settles with two forced GCs before timing (Chromium only exposes `gc`; Firefox figures
  are wall clock without a forced collection, and Firefox exposes no `performance.memory` at all).
- 100,000-row cases run before 500,000-row cases throughout, so an OOM at the larger size would
  still have left the smaller row filled in. Neither engine OOMed.
