---
title: 'Story 1 — CSV Sources: load, encoding ladder, delimiter/header detection, damage detection'
type: 'feature'
created: '2026-08-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '520bca6aec912a26636f226b7e8383bdcaaa6d09'
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** querbeet cannot load a file yet. Story 1 delivers the CSV share of CAP-1 plus CAP-2, CAP-3, CAP-39: CSV files become named removable Sources, encoding is decided by a ladder with a visible override, delimiter and header row are proposed correctably, and structural damage is reported by row number instead of parsed into a plausible table (C-10).

**Approach:** Establish the `SourceReader` port, the PapaParse csv adapter, the AD-7 registry (original bytes + raw parsed table) with named commands in `core/exec`, the encoding ladder in `core/types`, and a Sources pane in `ui/` rendering diagnostic codes as German text (AD-13, C-6).

## Boundaries & Constraints

**Always:**
- AD-1/AD-2: PapaParse only in `adapters/csv/`; `core/` framework- and browser-free (`TextDecoder` is a JS primitive, allowed).
- AD-3: `ui/` hands over `ArrayBuffer` + name; the encoding ladder runs in `core/types`.
- AD-7: registry keeps original bytes; encoding/delimiter/header changes re-read from them, never from the file.
- AD-13: core and adapter emit `{severity, code, values}` only; German text only in `ui/`.
- AD-20: the reader declares domain `text` for every CSV column. `dynamicTyping: false` permanently; typing is Step zero (Story 3).
- AD-14: Source ids `src:<slug>`, minted by core, unique, never reused.
- Damaged rows are excluded from the table but kept raw and inspectable — never padded or guessed into alignment (CAP-39).

**Ask First:** deviating from PapaParse 5.5.4; any further dependency.

**Never:** JSON/XLSX/Parquet reading (stories 4, 17 — unknown extensions get a named error, other Sources stay loaded); preview table (story 2); type detection (story 3); Recipe persistence (story 14); repair of structural damage (asymmetry with CAP-5 is deliberate).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German Excel export | `;`-CSV, CP1252 bytes, `ä`/`€` | delimiter `;` detected; characters correct via 1252 fallback | N/A |
| BOM present | UTF-8/UTF-16LE/UTF-16BE BOM | BOM decides outright, is stripped | N/A |
| Encoding override | user switches UTF-8 → 1252 | re-decode + re-parse from retained bytes | N/A |
| Undetectable delimiter | single-column file | parsed with fallback `,` + `unresolved` `csv.delimiter_undetectable` — an explicit question, no silent guess | UI shows question + delimiter picker |
| Preamble before header | 3 junk lines, then header | header row proposed at line 4 (dominant field count), correctable | N/A |
| Field-count mismatch | 2 rows deviate | `warning` `csv.field_count_mismatch` `{expected, rows, count}`; rows excluded, raw inspectable | Source stays loaded, usable |
| Unclosed quoted field | quote never closed | `error` `csv.unclosed_quote` `{row}` — that defect, not a generic failure | raw rows inspectable |
| Unsupported extension | `.xlsx` dropped beside `.csv` | `error` `source.unsupported_format` for that file; CSV loads normally | per-file error |
| Reader throws | binary garbage | `error` `source.unreadable`; other Sources stay | N/A |
| Multi-drop | 3 CSVs at once | 3 Sources, each renamable, individually removable | N/A |

</frozen-after-approval>

## Code Map

- `ports/index.js` — refine `SourceReader` typedef: `media: 'text'|'binary'`, `read(data, config)`; AD-20 domain per column. JSDoc only.
- `core/diagnostics/diagnostic.js` — exists; the only diagnostic vocabulary. Reuse, don't extend.
- `core/types/` (empty) — new `encoding.js`: BOM sniff, strict UTF-8 probe (`TextDecoder('utf-8',{fatal:true})`), Windows-1252 fallback, override list. R3: no library; ISO-8859-1 is a WHATWG label for the 1252 decoder.
- `core/exec/` (empty) — new `source-store.js`: AD-7 registry as plain `Map`; AD-10 commands `addSource`, `removeSource`, `renameSource`, `overrideEncoding`, `reconfigureParse`; readers injected `{extension → SourceReader}` by `app/`.
- `adapters/csv/` (empty) — new `csv-reader.js`: PapaParse 5.5.4, `header: false` (raw grid — Papa emits FieldMismatch only in header mode, so the field-count check is own code; R3). Maps `UndetectableDelimiter` → unresolved, `MissingQuotes` → `csv.unclosed_quote`. Header proposal: first row matching dominant field count.
- `app/main.js` — wire `{csv: csvReader}` + store, provide to `ui/`.
- `ui/App.vue` — scaffold demo section is replaced by the real Sources pane (its role — prove the core→ui diagnostics chain — now carried by the feature).
- `ui/SourcesPane.vue` — new: drop zone + file dialog, per-Source card (editable name, encoding select, delimiter select, header-row input, damage report with raw rows, remove). German text map for all codes (AD-13).
- `vitest.config.js` — add `adapters/**/*.test.js` to `include` (adapter is framework-free; AD-27 permits).
- `package.json` — add `papaparse: "5.5.4"` exact.
- `tests/e2e/single-file.spec.js` — demo-anchored assertions (umlaut sentence, `4.200 → 61.000`) re-anchored to the real UI; severity-leak, mount and network tests unchanged.
- `tests/e2e/csv-sources.spec.js` — new; fixture bytes built inline as `Uint8Array` (CP1252 needs exact bytes, no fixture files).

## Tasks & Acceptance

**Execution:**
- [x] `package.json` — add papaparse 5.5.4, `npm install`.
- [x] `core/types/encoding.js` + test — ladder + override; BOM variants, `ä€` on both paths, BOM stripped, invalid UTF-8 falls back.
- [x] `ports/index.js` — refine `SourceReader` contract.
- [x] `adapters/csv/csv-reader.js` + test — parse, delimiter guess, header proposal, damage detection; covers the adapter rows of the matrix.
- [x] `core/exec/source-store.js` + test — registry + commands; multi-add, id uniqueness, rename, remove, per-file error isolation, re-read uses retained bytes.
- [x] `app/main.js` — wiring.
- [x] `ui/SourcesPane.vue`, `ui/App.vue` — pane, German texts, demo removed.
- [x] `vitest.config.js` — adapter tests included.
- [x] `tests/e2e/single-file.spec.js` — re-anchor.
- [x] `tests/e2e/csv-sources.spec.js` — load, override re-read, delimiter question, damage by row number, German formatting (`1.500` from a 1500-row generated fixture).

**Acceptance Criteria:**
- Given the built artifact from `file://`, when a CP1252 `;`-CSV with umlauts/`€` loads via dialog, then a named Source shows correct characters, detected `;`, editable name.
- Given a loaded Source, when the displayed encoding is switched, then it re-reads from retained bytes and rendered values change.
- Given rows 3 and 5 deviate in field count, when loaded, then the UI names count and row numbers in German, excludes them from the table, keeps them raw-inspectable.
- Given an unclosed quoted field, when loaded, then the report names that specific defect with its row.
- Given an unsupported file beside a valid CSV, then the error names that file and the CSV Source is usable.
- Given `npm run verify`, then lint, Vitest and Playwright (Chromium+Firefox; network assertion Chromium-only, AD-18) pass.

## Design Notes

- Reader result: `{ table: {columns: [{name, domain:'text', cells}], rowCount}, proposal: {delimiter, headerRow}, damage: {mismatches: [{row, fields, raw}], unclosedQuoteRow}, diagnostics }`
- csv `config`: `{delimiter: string|null, headerRow: number|null}` — `null` = propose; explicit values are user corrections and survive re-reads (later stored in the Recipe, CAP-3).
- Registry entry: `{id, name, fileName, bytes, encoding: {chosen, source, override}, parseConfig, table, damage, diagnostics}`; table structures frozen (AD-6).
- Severities: field mismatch = `warning` (usable, user decides); unclosed quote = `error` (remainder swallowed — using it is the C-10 failure); undetectable delimiter = `unresolved` (awaiting a person).

## Verification

**Commands:**
- `npm run lint` — clean; AD-1/AD-2 boundaries hold with the new imports.
- `npm test` — all Vitest suites pass (encoding, adapter, store, diagnostics).
- `npm run test:e2e` — one-file assertion + all Playwright specs from `file://`, both engines.

## Spec Change Log

- 2026-08-02 — implementation notes, two touches beyond the Code Map:
  - `eslint.config.js` — `TextDecoder`/`TextEncoder` added to core/'s globals (the spec's own boundary — "TextDecoder is a JS primitive, allowed" — was otherwise a `no-undef` lint error), and `tests/**/*.js` added to the Node-globals block (the e2e fixtures build bytes with `Buffer`).
  - `adapters/csv/csv-reader.js` — the delimiter guess runs as a separate PapaParse preview pass with `skipEmptyLines: true`: under the main parse's `skipEmptyLines: false` (needed for file-true damage row numbers), the trailing-newline row drags Papa's average field count below its 2.0 guessing threshold and a plain two-column `;`-file reads as undetectable. Found by the adapter test, not in review.
- 2026-08-02 — review loop (three-layer adversarial review, all findings triaged as patches; 19 applied, verified green):
  - `adapters/csv/csv-reader.js` — **the delimiter guess is now own code**, superseding the Papa preview pass logged above: Papa's guesser hardcodes a ten-line preview internally (the config's `preview` never reaches it), and its average-field-count > 1.99 gate makes any two-column file with one one-field damaged row read as undetectable ((2n+1)/(n+1) < 2 for every n). Own scorer: same four candidates, 50-line window, qualification by median field count ≥ 2, ranking by field-count delta. Parsing itself stays PapaParse. KEEP: median-based qualification; file-true line numbers derived from step-mode raw slices.
  - Damage rows now carry file line numbers (quoted newlines no longer shift `Zeile N`); unclosed-quote rows land in `damage.mismatches` regardless of position vs. header; `InvalidQuotes`-class defects surface as `csv.malformed_quote`; empty files are `csv.empty`, not a delimiter question; NUL-bearing decodes attach `unresolved` `encoding.nul_bytes` (ladder unchanged — the question, not a different verdict); store re-read commands catch reader throws; command-boundary validation in `reconfigureParse`; blank rename keeps the current name; delimiter question renders a placeholder so "Komma" is choosable; `addFiles` isolates per-file read failures; e2e closes four verification gaps (vocabulary scan with diagnostics on screen, Kopfzeile, drag-and-drop, rename asserted via store-rendered text).

## Suggested Review Order

**The port contract — what every layer speaks**

- The refined `SourceReader` contract: `media`, the result shape, damage semantics.
  [`index.js:33`](../../ports/index.js#L33)

**The encoding ladder (CAP-2)**

- Three rungs, no library; a BOM decides, the strict probe validates, 1252 catches the rest.
  [`encoding.js:40`](../../core/types/encoding.js#L40)

- The override list the UI renders — ISO-8859-1 deliberately absent (WHATWG maps it to 1252).
  [`encoding.js:24`](../../core/types/encoding.js#L24)

**The registry and its commands (AD-7, AD-10)**

- `addSource`: decode once, read, per-file failure isolation — a broken file never touches its neighbours.
  [`source-store.js:116`](../../core/exec/source-store.js#L116)

- `reRead`: every re-read starts from retained bytes; a throwing reader becomes a Diagnostic, not a crash.
  [`source-store.js:78`](../../core/exec/source-store.js#L78)

- The NUL-byte trap surfaced as a question — BOM-less UTF-16 passes the UTF-8 probe legally.
  [`source-store.js:33`](../../core/exec/source-store.js#L33)

- Id minting: short, readable, unique, never reused after removal (AD-14).
  [`source-store.js:47`](../../core/exec/source-store.js#L47)

**The csv adapter (CAP-3, CAP-39)**

- Own delimiter guess: median ≥ 2 over a 50-line window — survives preambles and damaged minorities where Papa's average gate fails.
  [`csv-reader.js:62`](../../adapters/csv/csv-reader.js#L62)

- `read()`: `''` never reaches Papa as auto-guess; empty files are their own finding.
  [`csv-reader.js:103`](../../adapters/csv/csv-reader.js#L103)

- Step-mode parse: raw slices via `meta.cursor` give damaged rows their true raw text and file line numbers.
  [`csv-reader.js:138`](../../adapters/csv/csv-reader.js#L138)

- Unclosed quote is that defect by name, wherever it sits relative to the header.
  [`csv-reader.js:177`](../../adapters/csv/csv-reader.js#L177)

**The Sources pane — German happens here (AD-13, C-6)**

- Every code the pane can receive has a German sentence; the fallback is German too.
  [`SourcesPane.vue:49`](../../ui/SourcesPane.vue#L49)

- `addFiles`: File unwrapped here (AD-3), per-file try/catch, functional error append.
  [`SourcesPane.vue:107`](../../ui/SourcesPane.vue#L107)

- The delimiter question renders a placeholder so "Komma" is a choosable answer.
  [`SourcesPane.vue:293`](../../ui/SourcesPane.vue#L293)

**Wiring**

- The composition root — the only place naming a concrete adapter (AD-1).
  [`main.js:16`](../../app/main.js#L16)

**Peripherals — tests and config**

- Adapter matrix rows: delimiter, header proposal, damage detection with file-true line numbers.
  [`csv-reader.test.js:10`](../../adapters/csv/csv-reader.test.js#L10)

- Store commands, failure isolation, NUL trap, re-read guards.
  [`source-store.test.js:42`](../../core/exec/source-store.test.js#L42)

- The ladder under exact bytes — string literals would test the editor's save-encoding instead.
  [`encoding.test.js:11`](../../core/types/encoding.test.js#L11)

- e2e from `file://`, both engines: the full user surface including the four closed verification gaps.
  [`csv-sources.spec.js:60`](../../tests/e2e/csv-sources.spec.js#L60)

- Re-anchored scaffold tests; the AD-18 Chromium-only network caveat unchanged.
  [`single-file.spec.js:69`](../../tests/e2e/single-file.spec.js#L69)
