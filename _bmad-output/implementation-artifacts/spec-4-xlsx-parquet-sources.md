---
title: 'Story 4 — XLSX and Parquet Sources'
type: 'feature'
created: '2026-08-02'
status: 'draft'
review_loop_iteration: 0
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
| Nested Parquet column | LIST/STRUCT | `text` cells with compact JSON, warning per column | N/A |
| Empty Parquet | schema, 0 rows | columns from schema, rowCount 0, confirmable | N/A |
| Corrupt Parquet | bad magic / truncated | no Source, `source.unreadable` | error diagnostic |
| Native re-read | confirmed XLSX Source, sheet switched | domain survives, confirmation gone, pane says so | N/A |

</frozen-after-approval>

## Code Map

- `adapters/xlsx/xlsx-reader.js` — new: `media: 'binary'`. `readXlsxFile(bytes)` from `read-excel-file/browser` (the package has **no root export**) returns `[{sheet, data}]`, rows null-padded to uniform width; empty trailing rows/columns are dropped by the library. Dates arrive as `Date` at UTC-midnight (`parseExcelDate` builds UTC+0) — measured `45870 → 2025-08-01T00:00:00.000Z`. The XML-parse worker in 9.3.5 is commented out in `parseSpreadsheetContents.js`; only fflate's unzip worker runs, ≥ 512 KB archives, classic blob-URL from inlined strings — the one shape R2 measured working from `file://`.
- `adapters/parquet/parquet-reader.js` — new: `parquetRead` from `hyparquet` with array rows (not `parquetReadObjects` — object rows collapse repeated column names, the duplicate-name care CSV already takes). Returned values, measured from the built artefact in both engines: INT64 → `BigInt`, DOUBLE → number, UTF8 → string, TIMESTAMP_MILLIS → `Date` (instant preserved), DATE → `Date` at UTC-midnight, BOOLEAN → boolean, null → null. **A partial `parsers` option replaces all defaults** (crashes on `stringFromBytes`) — pass none. Import from the package index only; the `fetch`-bearing URL helpers tree-shake out, measured: gate green at 232 kB with both libraries.
- `core/types/typing.js:302-323` — the native branch: keep skip-inference and `format: null`, replace `parsed = values.length` with the canonical-form sweep per native type. `sift` (L396-408) already coerces `String(cell ?? '')` and counts `''` missing via `DEFAULT_MISSING` (L65, includes `k.A.`).
- `core/types/typing.test.js` — the sweep per type, the BigInt round-trip rule, mixed-column counts.
- `core/exec/source-store.js:412-462` — `setColumnTyping`: refuse `type`/`format` on a native-domain column (TypeError — programming error at the command boundary, the UI no longer offers it); `missingTokens`-only patches keep working. `reconfigureParse` (L348-372) validates only `delimiter`/`headerRow` — extend for `sheet` (string | null) so a sheet switch can travel; `reRead` (L223-253) already routes `media: 'binary'` past the decode.
- `core/exec/source-store.test.js:719-735` — the native re-read reference test; extend with the refused retype and a sheet-switch re-read.
- `ui/SourcesPane.vue:440-510` — parse controls render unconditionally; make them per-format (encoding+delimiter CSV-only, header-row CSV+XLSX, sheet select XLSX). L134-138: `isSettable` guards by type — a `native:number` column passes it and gets the full select; guard by domain. L611-615: `typing-native` shows the raw English type — give `date`/`datetime`/`number`/`boolean` German words (Datum/Zeitstempel/Zahl/Wahrheitswert).
- `ui/SourcesPane.test.js` — native column renders no type select but keeps missing-token and annotation controls; sheet select issues the command.
- `app/main.js` — register `{ csv, xlsx, parquet }` readers.
- `tests/e2e/xlsx-parquet.spec.js` — new: fixtures generated at test setup with `write-excel-file` + `hyparquet-writer` (devDependencies; no binaries in git), incl. one ≥ 512 KB XLSX for the worker path. Load via `setInputFiles` as in `typing.spec.js:31`.
- `scripts/assert-single-file.mjs` — read-only: the informational `new Worker` count moves 0 → 2 (fflate + the bundled-but-unreached worker-f); both are blob-URL constructions, not gate failures.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` — add `read-excel-file@9.3.5`, `hyparquet@1.27.1` (runtime), `write-excel-file@4.1.1`, `hyparquet-writer@0.16.3` (dev) — the Ask-First answered by this spec's approval.
- [ ] `core/types/typing.js` + `typing.test.js` — the real native sweep: canonical forms per type, BigInt round-trip, mixed-column counts.
- [ ] `adapters/xlsx/xlsx-reader.js` + test — sheets, header proposal, type map, canonical cells, mixed-column rule, `xlsx.empty`.
- [ ] `adapters/parquet/parquet-reader.js` + test — schema-driven columns, type map, nested-to-JSON rule, zero-row schema.
- [ ] `core/exec/source-store.js` + test — native retype refusal, `sheet` through `reconfigureParse`, sheet-switch re-read semantics.
- [ ] `ui/SourcesPane.vue` + test — per-format controls, domain-guarded type select, German native labels, sheet select.
- [ ] `app/main.js` — wire both readers.
- [ ] `tests/e2e/xlsx-parquet.spec.js` — generated fixtures, both engines, incl. the ≥ 512 KB worker-path file and the native re-read journey.

**Acceptance Criteria:**
- Given the built artefact with both libraries, when `npm run build` runs, then the AD-18 gate passes: one file, zero `fetch(`, zero `import(`.
- Given a ≥ 512 KB XLSX loaded from `file://`, when it is read, then it parses in both engines with no page error (the fflate worker path).
- Given a confirmed XLSX Source, when the sheet is switched, then the native domains and annotations survive by column name and the confirmation is gone.
- Given a `native:number` column containing stray strings, when detection runs, then the strings count as unparsed and `typing.unparsed_values` is emitted — the gate is not a rubber stamp (AD-20).
- Given `npm run verify`, then lint, both Vitest projects and Playwright (Chromium + Firefox, `file://`) pass.

## Spec Change Log

## Design Notes

- **The exclusion criterion is retired by measurement, not reading.** Both libraries were bundled into the real artefact (232,251 bytes, one file) and the AD-18 gate passed: zero `fetch(`, zero `import(`, 2 informational `new Worker` — both classic blob-URL constructions from strings inlined in the bundle. Runtime, from `file://`, both engines: a 2 KB XLSX in 5–6 ms, a 2.4 MB XLSX (forcing fflate's worker) 40,001 rows in 326–373 ms, the Parquet type sweep byte-identical across engines. No page errors anywhere.
- **Why hyparquet:** the spine's stack already pins it (1.27.1); it is pure JS (no WASM), MIT, listed on Apache Parquet's own implementation-status page, tested against the ecosystem's reference corpus, and the only alternative class (`parquet-wasm`, DuckDB-WASM) fails AD-17/AD-18 outright on multi-MB WASM payloads fetched at runtime. ESM-only is free here — the build step exists.
- **Why read-excel-file:** research D3's weighted matrix, 88 vs 61 against SheetJS CE (334 KB, styling paywalled, two years without a release). The open question that survived research — whether its internal worker survives `file://` — is closed above.
- **Canonical text cells are the load-bearing decision.** They keep story 3's machinery untouched for native columns (the reference test at `source-store.test.js:719` already models exactly this shape), keep frozen entries genuinely immutable, and make the native unparsed sweep implementable as a parse check instead of a type inspection. The cost — story 6 re-parses canonical forms on the way into a Table — is a locale-free parse of machine-shaped strings.
- **`native:datetime` and `native:boolean` are display-only types this story.** They exist because the formats deliver them (AD-21 separates date and datetime deliberately); they are not in `SETTABLE_TYPES`, no text column can be retyped into them, and story 6 owns their conversion.

## Verification

**Commands:**
- `npm run lint` — clean; `core/` and `adapters/` stay DOM-free.
- `npm test` — both Vitest projects; the sweep matrix and both adapters green.
- `npm run test:e2e` — builds `dist/`, asserts AD-18, runs both engines from `file://`.
