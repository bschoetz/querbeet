---
title: 'Story 4 — XLSX and Parquet Sources'
type: 'feature'
created: '2026-08-02'
status: 'done'
review_loop_iteration: 1
baseline_commit: '72c19a51de907d0475eef439de2c89d1c6323015'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/research/technical-file-formats-and-parsing-2026-08-01/research.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only CSV loads (CAP-1 remainder except JSON). XLSX and Parquet carry real types where CSV carries strings, and story 3's `native:<type>` branch — built against a hand-written reader result — has never met a real file.

**Approach:** Two binary `SourceReader` adapters, `read-excel-file` 9.3.5 and `hyparquet` 1.27.1, declaring per column `text` or `native:<type>` (AD-20). Native columns arrive pre-typed with `format null`, skip locale inference, and still face the confirmation gate (AD-29). Where a real column does not fit story 3's shape, this story fixes the assumption here — starting with the native unparsed sweep, which is currently vacuous.

## Boundaries & Constraints

**Always:**
- Cells in the raw table are **canonical text**: numbers as shortest round-trip decimal (`1234.5`), dates as `yyyy-MM-dd`, datetimes as ISO 8601 UTC, booleans `true`/`false`, null/empty as `''`. The typed-ness lives in the column's `domain` declaration, not in the cell values. (Story 3's whole machinery — `sift`, missing tokens, preview, annotations — is string-based; a `Date` object stringifies to a local-zone sentence, violating AD-21's spirit, and is mutable inside a frozen entry.)
- **The admissible native types are a closed list — `number`, `date`, `datetime`, `boolean` — and a reader declaring anything else yields a `text` column with a warning diagnostic naming the column and the type.** `detectColumn` takes everything after `native:` verbatim as the column's type, and `SETTABLE_TYPES` guards only the command path, so today a reader is the one producer that can put an unknown word into a confirmed typing and out the other side into story 6's conversion. Parquet delivers TIME, INTERVAL, DECIMAL and INT96 from real files; this story is the first to have a reader at all, so the list closes here or it never closes.
- Type map — XLSX: number → `native:number`; `Date` → `native:date` when every value is UTC-midnight, else `native:datetime`; boolean → `native:boolean`; an all-string column → `text` with full locale detection (German numbers stored as text are the normal office case). Parquet: INT32/INT64/FLOAT/DOUBLE/DECIMAL → `native:number`; DATE → `native:date`; TIMESTAMP_* / INT96 → `native:datetime`; BOOLEAN → `native:boolean`; UTF8/STRING → `text`.
- Mixed XLSX column: if all typed (non-string) cells share one type, declare `native:<type>`; string cells ride along verbatim and count as missing (when they match a missing token) or unparsed. If typed cells disagree, declare `text`, everything canonicalized, with a warning diagnostic naming the column.
- **The native unparsed sweep becomes real:** a native column's `unparsed` counts cells that do not parse under the canonical form of its type — including an INT64 whose digits do not survive String→Number round-trip (silent precision loss is C-10). Today `detectColumn`'s native branch scores every non-missing cell as parsed; that only holds for homogeneous columns.
- A native column is never retyped: guard by `domain`, not by type — `setColumnTyping` refuses a `type`/`format` patch on a native column, and the pane renders no type/reading select for one (today a `native:number` column would get the full select, because `isSettable` checks the type). Missing tokens and annotation stay editable; confirm/unconfirm unchanged.
- Multi-sheet XLSX: `parseConfig.sheet` (null = propose first sheet); the proposal names the chosen sheet and lists the available ones; switching re-reads the retained bytes (AD-7) — native domains and annotations survive by name, the confirmation never does.
- XLSX header row: proposed as the first row carrying the sheet's dominant non-empty cell count (the CSV rule restated over null-padded rows), correctable like CSV.
- Parse controls render per format: no encoding or delimiter control for binary Sources; header-row for XLSX; sheet select for XLSX; Parquet gets none (its schema is authoritative).
- Values hyparquet returns as non-primitives (nested LIST/MAP/STRUCT, raw BYTE_ARRAY) → `text` cells carrying compact JSON, one warning diagnostic per column; flattening is story 17's vocabulary.
- AD-15/AD-18: querbeet creates no worker; `read-excel-file`'s fflate blob-URL worker is the dependency's own and is measured surviving the single-file gate and `file://` in both engines. The gate's assertions (one file, no `fetch(`, no `import(`) stay green.
- AD-1: library names only in `adapters/xlsx/` and `adapters/parquet/`; registration only in `app/main.js`. AD-13: codes from `core/` and adapters, German only in `ui/`.

**Ask First:** any runtime dependency beyond `read-excel-file` 9.3.5 and `hyparquet` 1.27.1 (these two are what this spec's approval approves); devDependencies beyond `hyparquet-writer`/`write-excel-file` for e2e fixture generation; changing `SourceReader`'s return shape beyond the format-specific `config`/`proposal` fields already declared.

**Never:** converting cells into engine values — boxes and epoch ms belong to story 6 (AD-22, AD-21); XLSX/Parquet export (story 13); JSON/NDJSON (story 17); legacy `.xls`/`.xlsb`/`.ods` — the pair cannot read them, they stay `source.unsupported_format`; sampling — every value, every column (CAP-9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| XLSX numeric column | number cells | `native:number`, pre-typed, settled, no locale question, confirmable | N/A |
| XLSX date column | serial dates, date style | `native:date`, cells `yyyy-MM-dd` | N/A |
| XLSX datetime | any value with time-of-day | `native:datetime`, ISO UTC cells | N/A |
| XLSX text column | German numbers as text | `text`, full detection — ambiguity and locale questions as in CSV | N/A |
| Mixed column | numbers + `k.A.` + `x` strings | `native:number`; `k.A.` missing (default token), `x` unparsed → `typing.unparsed_values` | N/A |
| Typed cells disagree | numbers and dates in one column | `text`, canonicalized, warning naming the column | N/A |
| Multi-sheet | 3 sheets, none chosen | first sheet proposed, others listed; switch re-reads, confirmation drops, annotations survive by name | N/A |
| Large XLSX | ≥ 512 KB zip (fflate worker path) | loads from `file://`, both engines — measured 40k rows in ~330–370 ms | N/A |
| Empty sheet / workbook | no cells | 0 columns, 0 rows, `xlsx.empty` warning | N/A |
| Encrypted / corrupt XLSX | password-protected or truncated | no Source, `source.unreadable` error; loaded Sources untouched | error diagnostic |
| Parquet type sweep | INT64, DOUBLE, STRING, TIMESTAMP, DATE, BOOLEAN with nulls | per map above; nulls count missing; STRING column is `text` | N/A |
| INT64 beyond 2^53 | `9007199254740993` | cell keeps exact digits, counts unparsed — precision loss is named, not silent | N/A |
| Native type off the list | a reader declares `native:decimal` | `text`, full detection, warning naming column and type | N/A |
| Nested Parquet column | LIST/STRUCT | `text` cells with compact JSON, warning per column | N/A |
| Empty Parquet | schema, 0 rows | columns from schema, rowCount 0, confirmable | N/A |
| Corrupt Parquet | bad magic / truncated | no Source, `source.unreadable` | error diagnostic |
| Native re-read | confirmed XLSX Source, sheet switched | domain survives, confirmation gone, pane says so | N/A |

</frozen-after-approval>

## Code Map

- `adapters/xlsx/xlsx-reader.js` — new: `media: 'binary'`. `readXlsxFile(bytes)` from `read-excel-file/browser` (the package has **no root export**) returns `[{sheet, data}]`, rows null-padded to uniform width; empty trailing rows/columns are dropped by the library. Dates arrive as `Date` at UTC-midnight (`parseExcelDate` builds UTC+0) — measured `45870 → 2025-08-01T00:00:00.000Z`. The XML-parse worker in 9.3.5 is commented out in `parseSpreadsheetContents.js`; only fflate's unzip worker runs, ≥ 512 KB archives, classic blob-URL from inlined strings — the one shape R2 measured working from `file://`.
- `adapters/parquet/parquet-reader.js` — new: `parquetRead` from `hyparquet` with array rows (not `parquetReadObjects` — object rows collapse repeated column names, the duplicate-name care CSV already takes). Returned values, measured from the built artefact in both engines: INT64 → `BigInt`, DOUBLE → number, UTF8 → string, TIMESTAMP_MILLIS → `Date` (instant preserved), DATE → `Date` at UTC-midnight, BOOLEAN → boolean, null → null. **A partial `parsers` option replaces all defaults** (crashes on `stringFromBytes`) — pass none. Import from the package index only; the `fetch`-bearing URL helpers tree-shake out, measured: gate green at 232 kB with both libraries.
- `core/types/catalog.js` — new: the one place a type is declared. Today the vocabulary is spread over four — `TEXT`/`NUMBER`/`DATE` in `typing.js:58-60`, `SETTABLE_TYPES` in `source-store.js:30`, `TYPE_LABEL` in `SourcesPane.vue:111`, and `isSettable` in `SourcesPane.vue:138` — and this story has to touch all four anyway (admissible native list, domain-guarded select, German words for `datetime` and `boolean`). One record per type carrying the code, whether a user may set it, and whether a reader may declare it natively; `TYPE_LABEL` stays in `ui/` because AD-13 keeps German out of `core/`, but it is keyed off the catalogue rather than restating it. This is what makes story 4a's new types one edit instead of four, and what makes an unknown native type a lookup miss rather than a forgotten branch.
- `core/types/typing.js:302-323` — the native branch: keep skip-inference and `format: null`, replace `parsed = values.length` with the canonical-form sweep per native type, and reject a domain the catalogue does not admit before either happens. `sift` (L396-408) already coerces `String(cell ?? '')` and counts `''` missing via `DEFAULT_MISSING` (L65, includes `k.A.`).
- `core/types/typing.test.js` — the sweep per type, the BigInt round-trip rule, mixed-column counts.
- `core/exec/source-store.js:412-462` — `setColumnTyping`: refuse `type`/`format` on a native-domain column (TypeError — programming error at the command boundary, the UI no longer offers it); `missingTokens`-only patches keep working. `reconfigureParse` (L348-372) validates only `delimiter`/`headerRow` — extend for `sheet` (string | null) so a sheet switch can travel; `reRead` (L223-253) already routes `media: 'binary'` past the decode.
- `core/exec/source-store.test.js:719-735` — the native re-read reference test; extend with the refused retype and a sheet-switch re-read.
- `ui/SourcesPane.vue:440-510` — parse controls render unconditionally; make them per-format (encoding+delimiter CSV-only, header-row CSV+XLSX, sheet select XLSX). L134-138: `isSettable` guards by type — a `native:number` column passes it and gets the full select; guard by domain, off the catalogue. L611-615: `typing-native` shows the raw English type — give `date`/`datetime`/`number`/`boolean` German words (Datum/Zeitstempel/Zahl/Wahrheitswert), keyed off the catalogue so a type without a German word is a build-visible gap rather than a raw English word on the card.
- `ui/SourcesPane.test.js` — native column renders no type select but keeps missing-token and annotation controls; sheet select issues the command.
- `app/main.js` — register `{ csv, xlsx, parquet }` readers.
- `tests/e2e/xlsx-parquet.spec.js` — new: fixtures generated at test setup with `write-excel-file` + `hyparquet-writer` (devDependencies; no binaries in git), incl. one ≥ 512 KB XLSX for the worker path. Load via `setInputFiles` as in `typing.spec.js:31`.
- `scripts/assert-single-file.mjs` — read-only: the informational `new Worker` count moves 0 → 2 (fflate + the bundled-but-unreached worker-f); both are blob-URL constructions, not gate failures.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` — add `read-excel-file@9.3.5`, `hyparquet@1.27.1` (runtime), `write-excel-file@4.1.1`, `hyparquet-writer@0.16.3` (dev) — the Ask-First answered by this spec's approval.
- [x] `core/types/catalog.js` + test — one declaration per type; `typing.js`, `source-store.js` and `SourcesPane.vue` read it instead of restating it.
- [x] `core/types/typing.js` + `typing.test.js` — the real native sweep: canonical forms per type, BigInt round-trip, mixed-column counts, and a native type off the list falling to `text` with a warning.
- [x] `adapters/xlsx/xlsx-reader.js` + test — sheets, header proposal, type map, canonical cells, mixed-column rule, `xlsx.empty`.
- [x] `adapters/parquet/parquet-reader.js` + test — schema-driven columns, type map, nested-to-JSON rule, zero-row schema.
- [x] `core/exec/source-store.js` + test — native retype refusal, `sheet` through `reconfigureParse`, sheet-switch re-read semantics.
- [x] `ui/SourcesPane.vue` + test — per-format controls, domain-guarded type select, German native labels, sheet select.
- [x] `app/main.js` — wire both readers.
- [x] `tests/e2e/xlsx-parquet.spec.js` — generated fixtures, both engines, incl. the ≥ 512 KB worker-path file and the native re-read journey.

**Acceptance Criteria:**
- Given the built artefact with both libraries, when `npm run build` runs, then the AD-18 gate passes: one file, zero `fetch(`, zero `import(`.
- Given a ≥ 512 KB XLSX loaded from `file://`, when it is read, then it parses in both engines with no page error (the fflate worker path).
- Given a confirmed XLSX Source, when the sheet is switched, then the native domains and annotations survive by column name and the confirmation is gone.
- Given a `native:number` column containing stray strings, when detection runs, then the strings count as unparsed and `typing.unparsed_values` is emitted — the gate is not a rubber stamp (AD-20).
- Given a reader declaring a native type outside the catalogue, when the Source loads, then the column is `text`, detection runs on it, and a warning names the column and the type — no unknown word reaches a confirmed typing.
- Given the type vocabulary, when a type is added, then it is added in `core/types/catalog.js` and nowhere else; no test asserts a type list restated in `core/exec` or `ui/`.
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

### 2026-08-02 — Ask First answered by the project owner: `hyparquet-compressors` is in

**The question.** The Boundaries make any runtime dependency beyond `read-excel-file` and `hyparquet` an Ask First. Bare `hyparquet` decompresses UNCOMPRESSED and SNAPPY only, so a Parquet written with GZIP, ZSTD, BROTLI or LZ4 — ordinary defaults across the Spark, pandas and DuckDB ecosystems — could not be read at all. Review round 1 made the refusal honest (`parquet.unsupported_codec` names the codec and says the file is in order); it could not make the file readable. The question was logged and put to the owner.

**The answer: add it.** `hyparquet-compressors@1.1.1`, MIT, 161 KB unpacked, same author family as hyparquet. Its dependencies are `fzstd` (pure JS zstd) and `hysnappy` (WASM snappy); GZIP, Brotli and LZ4 are hand-written JavaScript inside the package. It is passed to `parquetRead` as `compressors`, and `SUPPORTED_CODECS` is derived from the map rather than restated, so a codec the package gains or loses cannot leave the guard behind.

**Why the WASM is not the thing the spine rejected.** AD-17 and AD-18 sank `parquet-wasm` and DuckDB-WASM over multi-MB payloads **fetched at runtime**. This is neither: hysnappy's module is base64-inlined in the source and instantiated with `atob` plus `new WebAssembly.Module` — no `fetch`, no `import(`, no second file. No architecture decision forbids WebAssembly as such. Confirmed by building, not assumed: the gate stays green and `dist/index.html` went from 246,399 to **361,045 bytes**, still one file.

**The one real risk, and where it is pinned.** Chrome refuses a synchronous `new WebAssembly.Module` larger than **4,096 bytes** on the main thread. The decoded module is **3,458 bytes** — a margin of **638**. If a future version crosses it, instantiation throws in Chromium and nowhere else: not under Node, not in the dev server, only in the shipped artefact opened by double-click. That is the exact class of silent build-time failure AD-18 exists for, so it is asserted twice. `scripts/assert-single-file.mjs` locates the inlined module by its `AGFzbQ` base64 preamble — the base64 of WASM's `\0asm` magic — reports its size and remaining margin, and **fails the build** at the ceiling. And `tests/e2e/xlsx-parquet.spec.js` loads a snappy Parquet from the built `dist/index.html` in both engines and asserts the cell values, because a Vitest case would pass under Node whatever Chrome does with it. hyparquet's `decompressPage` prefers a supplied decompressor over its own, so that test genuinely exercises the WASM rather than the pure-JS fallback.

**Coverage, stated rather than implied.** Four of the six codecs are round-tripped against really-compressed bytes — SNAPPY, UNCOMPRESSED, GZIP, BROTLI — each with the codec recorded in the metadata asserted, so an identity function cannot pass for compression. ZSTD and LZ4 have no fixture: nothing in this tree can write them. Logged in `deferred-work.md` as a fixture gap rather than left to look like coverage.

**`parquet.unsupported_codec` stays.** It was the wrong answer for gzip and ZSTD; it is the right answer for LZO and for whatever the format adds next. Its comment says so, so a later reader does not take it for dead code and delete it.

### 2026-08-02 — review round 1: what three review layers found, and what changed because of it

**Two silent wrong answers, and they are the reason this entry exists.**

*A DECIMAL was corrupted on the way in.* hyparquet computes `parseDecimal(bytes) * 10 ** -scale` in floating point, so an unscaled `123456789` at scale 2 arrives as `1234567.8900000001` — and that round-trips, so the canonical sweep counted it **parsed** and a wrong amount reached the card with no warning at all. This is the C-10 class the INT64 case has a test, a warning and a matrix row for, arriving through a door nobody had checked. The reader now recovers the figure from the *declared* scale, which is arithmetic against the schema rather than a guess about a value. Where the unscaled integer is past `Number.MAX_SAFE_INTEGER` the figure is not recoverable, and the cell then carries the double's own exact expansion — everything that arrived, nothing invented — which fails the round trip, is counted unparsed, and raises `parquet.decimal_precision` besides. The old test picked three values that happen to survive the multiply, so the suite certified the corruption; the new ones use values that break.

*An XLSX header cell that was not a string became a timezone-dependent column name.* `String(aDate)` yields `Fri Aug 01 2025 02:00:00 GMT+0200 (Mitteleuropäische Sommerzeit)` — the same local-zone sentence this story forbids for cell values, in the one place it had not been forbidden. A header row of dates is an ordinary monthly-report shape, and because annotations and chosen types are carried across a re-read **by name**, a name that moves with the clock quietly breaks that carry-over. Header cells now go through the same canonicalization as values.

**One correctness bug all three layers found independently.** `reconfigureParse` and `overrideEncoding` captured the entry synchronously and committed after the await, so two overlapping re-reads let the one that *resolved* last win rather than the one that was *asked* last — choose a sheet, correct the header row before the sheet lands, and the sheet switch is gone with the file read on the wrong sheet. A `setColumnTyping` or `annotateColumn` issued during a parse was overwritten by the stale commit the same way. On the binary formats this story adds, a parse takes seconds, so it is reachable by ordinary clicking. Parses are now serialized per Source, each command merges against the entry the one before it left behind, and a finished read commits onto the entry as it stands rather than the snapshot it began with. The queue continues through a rejection, so one failed read cannot wedge a Source. Covered with a reader that resolves on a controllable deferred, which is the only way to hold two reads open at once — no test in this suite could represent an overlap before.

**Two ways one bad column cost a whole file.** An Invalid or out-of-range `Date` made `toISOString` throw in both adapters, and `INTERVAL` and `BSON` throw inside hyparquet's own row conversion — in every case the user lost the Source over one cell or one column. Dates now canonicalize to `''` and are counted by the sweep; the two refused converted types are identified from the schema and left out of the read, with the column reported as `parquet.unreadable_column` and every other column read in full. Only `TIME_MILLIS` had been tested, which is the one unsupported type that happens not to throw.

**Six things that were true and unsaid.** A codec hyparquet cannot decompress surfaced as "damaged, password-protected, or not the format its extension claims" — three diagnoses, all three wrong for a valid gzip Parquet; adapters may now attach a `code` to what they throw and the store forwards it, so the card names the codec and says the file is in order. Sub-millisecond timestamp precision, non-finite doubles, blank header cells and repeated header names each got a diagnostic. And the unhonoured parse decisions — a clamped header row, a sheet that no longer exists — are now adopted from the reader's proposal instead of lingering in `parseConfig`, which also makes the sheet fallback clearable in one action and stops re-choosing the sheet already on screen from counting as a switch.

**Two invariants and one restatement.** `CANONICAL` now has the same completeness test the German labels already had, so a type added to the catalogue without a canonical form is a red test rather than a good file reported as unreadable. `type: null` on a native column is a no-op reset again rather than a throw — it withdraws a choice, it does not retype, and story 3 shipped "Zurück zum Vorschlag" as the fix for exactly that defect. And the user-visible format list is derived from the reader registry rather than hand-kept in two sentences.

**Pending state.** The four parse controls disable the one that is reading and announce it through `role="status"`. A card that stays fully interactive and unchanged for seconds is the invitation to the overlap above.

### 2026-08-02 — matrix audit: a refused native declaration is discarded, not retained

**The conflict.** The matrix row "Native type off the list" reads `text`, and the first implementation read that as the *type* only: the column fell back to full detection but kept `domain: 'native:decimal'` on its record. The sibling row "Typed cells disagree" is asserted as `domain === 'text'`, and the acceptance criterion adds "no unknown word reaches a confirmed typing" — the domain is precisely the part that would carry it. Story 14 serializes the domain into the Recipe and story 6 reads it as the instruction for a conversion, so a retained `native:decimal` is the unknown word arriving downstream by a different door.

**What changed.** `core/types/typing.js` gained `readDeclaration`, the one place a reader's domain is read. An admissible declaration passes through; a refused one is **discarded down to `text`**, and the bare word survives on the column record as `refusedNativeType` — provenance, never spelled `native:…`, so no reader of a record can convert against it. `detectColumn` and `scoreColumn` both go through it, so the two routes into a record cannot disagree. `typingDiagnostics` reads the field instead of re-deriving from the domain, which is what keeps the warning alive across a recount. `refusedNativeType()` was removed from `core/types/catalog.js` rather than left as a second way to ask a question the domain can no longer answer, and `setColumnTyping` now guards against the *reader's* domain (`entry.table.columns[i].domain`) rather than the record's copy of it, since the two differ exactly on a refused declaration — and a refused column is settable.

### 2026-08-02 — decided during dev, without the owner, because neither library can be synchronous

**The Ask-First this touches.** "Changing `SourceReader`'s return shape beyond the format-specific `config`/`proposal` fields already declared." The project owner was away; the decision was taken alone and is recorded here so it can be overruled cheaply.

**The finding.** `SourceReader.read` was synchronous, and neither binary reader can be. `read-excel-file` 9.3.5 unzips through fflate's callback API (`unzipFromArrayBufferSync` exists in the package but calls `.then` on a plain object and is dead code) and parses each XML file through a promise-returning SAX pass; `hyparquet` reads through an async buffer. There is no entry point in either package that returns a table without a `Promise` in the chain.

**What was decided.** `read` may return a result **or a Promise of one**. The store awaits either, which makes exactly the three commands that parse — `addSource`, `overrideEncoding`, `reconfigureParse` — return Promises; every other command stays synchronous, and argument validation still throws synchronously, because a bad argument is a caller's bug and not a state of the data. `ports/index.js` carries the contract, `core/exec/source-store.js` carries the reason, and `ui/SourcesPane.vue` awaits the three handlers.

**What was rejected, and why.** Holding a decoded intermediate per Source — the sheet arrays out of `readXlsxFile` — would have kept the store synchronous, and it was rejected because the Boundaries say a sheet switch **re-reads the retained bytes (AD-7)**. A second copy of every Source's rows, held only to avoid an `await`, is the registry AD-7 exists to refuse.

**Blast radius.** `core/exec/source-store.test.js` gained `await` at 48 call sites; nothing else in the tree called a reader. `npm run verify` is green: lint, both Vitest projects, Playwright in Chromium and Firefox from `file://`.

### 2026-08-02 — renegotiated by the project owner, before dev

**Triggering finding.** Using story 3, the project owner found that no text column can ever become a `datetime`. Measured against the built `detectColumn`, that holds for ten more shapes as well — `2025-12-31T14:30:00`, `14:30`, `ja`/`nein`, `12,5 %`, `1.234,56 €`, `(1.234,56)` among them, all `text`. The gap was triaged into three homes; the full record, including what was cut and why, is the closed entry in `deferred-work.md`. Two of the three are this story's, because this story already edits every site they touch.

**What was amended.** Boundaries gained the closed list of admissible native types — a Frozen-block change, which is why it needed the owner's word rather than a Code Map note. `detectColumn` takes everything after `native:` verbatim and `SETTABLE_TYPES` guards only the command path, so a reader is the one producer that can carry an unknown type word into a confirmed typing; this story ships the first reader that could. The matrix gained the row for a type off the list. The Code Map gained `core/types/catalog.js`, one declaration per type replacing the four-way restatement in `typing.js`, `source-store.js` and `SourcesPane.vue` — bundled here because the admissible list, the domain-guarded select and the German words for `datetime` and `boolean` are three edits to those same four sites, and because it is what makes story 4a's six new types one edit rather than four.

**Known-bad state avoided.** A Parquet `TIME` or `DECIMAL` column confirmed under a type word nothing downstream knows, and a type vocabulary that four files each hold a partial copy of on the eve of the story that doubles it.

**KEEP.** Everything else. The two libraries and their measurements, canonical text cells, the real native sweep including the INT64 round-trip, the per-format parse controls, and native columns staying unretypeable.

## Design Notes

- **The exclusion criterion is retired by measurement, not reading.** Both libraries were bundled into the real artefact (232,251 bytes, one file) and the AD-18 gate passed: zero `fetch(`, zero `import(`, 2 informational `new Worker` — both classic blob-URL constructions from strings inlined in the bundle. Runtime, from `file://`, both engines: a 2 KB XLSX in 5–6 ms, a 2.4 MB XLSX (forcing fflate's worker) 40,001 rows in 326–373 ms, the Parquet type sweep byte-identical across engines. No page errors anywhere.
- **Why hyparquet:** the spine's stack already pins it (1.27.1); it is pure JS (no WASM), MIT, listed on Apache Parquet's own implementation-status page, tested against the ecosystem's reference corpus, and the only alternative class (`parquet-wasm`, DuckDB-WASM) fails AD-17/AD-18 outright on multi-MB WASM payloads fetched at runtime. ESM-only is free here — the build step exists.
- **Why read-excel-file:** research D3's weighted matrix, 88 vs 61 against SheetJS CE (334 KB, styling paywalled, two years without a release). The open question that survived research — whether its internal worker survives `file://` — is closed above.
- **Canonical text cells are the load-bearing decision.** They keep story 3's machinery untouched for native columns (the reference test at `source-store.test.js:719` already models exactly this shape), keep frozen entries genuinely immutable, and make the native unparsed sweep implementable as a parse check instead of a type inspection. The cost — story 6 re-parses canonical forms on the way into a Table — is a locale-free parse of machine-shaped strings.
- **`native:datetime` and `native:boolean` are display-only types this story.** They exist because the formats deliver them (AD-21 separates date and datetime deliberately); they are not settable, no text column can be retyped into them, and story 6 owns their conversion. Story 4a is what closes the asymmetry — that the same table is typed as XLSX and untyped as CSV — by teaching detection to reach them from text. It is deliberately not this story: the vocabulary has to exist before detection can aim at it, and this story is where it lands.

## Verification

**Commands:**
- `npm run lint` — clean; `core/` and `adapters/` stay DOM-free.
- `npm test` — both Vitest projects; the sweep matrix and both adapters green.
- `npm run test:e2e` — builds `dist/`, asserts AD-18, runs both engines from `file://`.

## Suggested Review Order

**The type vocabulary, declared once**

- Start here: one record per type, carrying who may set it and who may declare it natively.
  [`catalog.js:39`](../../core/types/catalog.js#L39)

- The one place a reader's `native:<type>` declaration is read; a refused word is discarded, not retained.
  [`typing.js:385`](../../core/types/typing.js#L385)

- The canonical form per native type — what the sweep actually checks each cell against.
  [`typing.js:305`](../../core/types/typing.js#L305)

- Completeness invariant: a native type without a canonical form is a build-visible gap, not a corrupt-file report.
  [`typing.js:322`](../../core/types/typing.js#L322)

**Numbers that must not lie**

- DECIMAL recovered from the schema's declared scale; past 2^53 nothing is invented and the round trip fails.
  [`parquet-reader.js:191`](../../adapters/parquet/parquet-reader.js#L191)

- Cells canonicalized to text; an out-of-range date yields `''` rather than taking the file down.
  [`xlsx-reader.js:58`](../../adapters/xlsx/xlsx-reader.js#L58)

**A file degrades, it does not disappear**

- Codec checked against what this build carries, before any page is read.
  [`parquet-reader.js:88`](../../adapters/parquet/parquet-reader.js#L88)

- INTERVAL and BSON identified from the schema and excluded from the read — one column, not the Source.
  [`parquet-reader.js:270`](../../adapters/parquet/parquet-reader.js#L270)

- Header cells go through the same canonicalization as values, so no column is named in a local timezone.
  [`xlsx-reader.js:87`](../../adapters/xlsx/xlsx-reader.js#L87)

**Async commands that cannot clobber each other**

- Parses serialized per Source; the queue is why a second click cannot lose the first.
  [`source-store.js:189`](../../core/exec/source-store.js#L189)

- The entry is fetched inside the queue, never captured outside it.
  [`source-store.js:441`](../../core/exec/source-store.js#L441)

- Patches merged against the config the previous command left, not against a stale snapshot.
  [`source-store.js:489`](../../core/exec/source-store.js#L489)

- Retype refusal guarded by the reader's domain, so a refused declaration stays settable.
  [`source-store.js:560`](../../core/exec/source-store.js#L560)

**What the user sees while it happens**

- One wrapper owns pending state, re-enabling and routing a failed parse to the visible error list.
  [`SourcesPane.vue:373`](../../ui/SourcesPane.vue#L373)

- The format list derived from the reader registry rather than restated in prose.
  [`SourcesPane.vue:44`](../../ui/SourcesPane.vue#L44)

**The gate**

- Inlined WASM located by its `AGFzbQ` preamble and failed at Chrome's 4,096-byte sync-compile ceiling.
  [`assert-single-file.mjs:110`](../../scripts/assert-single-file.mjs#L110)

**Peripherals**

- The snappy journey that proves the inlined WASM runs in the built artefact, where a Vitest case could not.
  [`xlsx-parquet.spec.js:283`](../../tests/e2e/xlsx-parquet.spec.js#L283)

- Reader registration, the one place adapters are named (AD-1).
  [`main.js:1`](../../app/main.js#L1)
