---
title: 'Story 6a — The typed Table: engine adapter, conversion, and the values that did not read'
type: 'feature'
created: '2026-08-04'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/research/technical-performance-and-table-rendering-2026-08-01/digests/arquero-internals-r1-1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3 settles what a column *is* and confirms it, but every value in the app is still canonical text: the `TableEngine` port is a prose stub with no methods, `adapters/arquero/` is an empty `.gitkeep`, Arquero appears in no dependency list, and the typing panel's "842 von 900 Werten lesbar" is a dead end — the count is exact and the 58 rows behind it cannot be shown (CAP-9's remainder, `deferred-work.md:175-178`).

**Approach:** Pin Arquero 8.0.3 and build the first `TableEngine` implementation. Convert a confirmed Source into a typed engine Table as **Step zero**: unparsed values become boxes carrying their original text (AD-22), all four temporal types become nanoseconds held as `BigInt` (AD-21), read by parts-extractors that provably read exactly what detection counted. Mark the unparsed cells in the Source preview from the conversion's own output. The registry stays raw (AD-7); the converted Table lives in a Step-zero cache outside it and outside reactivity (AD-6).

## Boundaries & Constraints

**Always:**

- **Only `adapters/arquero/` imports `arquero`.** Add an `arqueroBan` to every `no-restricted-imports` block in `eslint.config.js` exactly as `vueFlowBan` is handled — flat config replaces a rule's options rather than merging them (`eslint.config.js:31-35`) — including one covering the other adapter directories, which are otherwise unrestricted (`:172-173`).
- **Conversion dispatches on the column's confirmed `type`, never on `format`:** `time` and `duration` carry `format: null` by construction (`candidatesFor` returns empty for both), and they are the two types AD-21 gives distinct units.
- **Conversion reads every value exactly as detection counted it.** `numberParts` (`core/types/typing.js:882`, exported "for story 6") is reused with `affix` and `accounting` re-derived the same way `scoreColumn` derives them. Date, datetime, time, duration and boolean get **parts-returning siblings beside their predicates** in `core/types/typing.js` — five new extractors, since those readers today return only booleans — and a test drives each pair over the reading corpus asserting *parts ⇔ predicate* agreement. **Per column, the converted unparsed count equals `typing.counts.unparsed`. This equality is an acceptance criterion, not a hope.**
- **A datetime is parsed as one value, never date-part plus clock arithmetic.** End-of-day `24:00` (accepted only where minutes, seconds and fraction are all zero) rolls to midnight of the **next calendar day** — `2025-12-31T24:00:00Z` is `2026-01-01T00:00Z`, next year. Two-digit years expand through `expandTwoDigitYear` (`typing.js:548`). Date → UTC-midnight epoch ns; datetime → UTC epoch ns with any offset applied; time → ns since midnight; duration → plain ns; all `BigInt` (AD-21).
- **Missing is never a box.** Tokens in the confirmed `missingTokens` (same trim rule as `sift`, `typing.js:1882`) become null cells. A box exists only for a value that fails its confirmed type.
- **The box representation is private to `adapters/arquero/`** (AD-22). The `Table` interface stays exactly `rows() / rowCount() / schema() / column(name)` (AD-5); `schema()` reports the confirmed types. What the UI needs for marking crosses as plain data: conversion returns `{ table, unparsed }` where `unparsed` maps column name → frozen array of row indices.
- **The registry entry shape is unchanged.** The converted Table is never placed in the entry and never in `ref`/`reactive`/`computed` (AD-6); `ui/` holds at most a `shallowRef` to swap.
- **The engine's own CSV entry points stay unused** (`measured-constraints.md:54`; parsing belongs to `SourceReader`).

**Ask First:**

- Widening the four-method `Table` interface.
- Implementing ordinal dates (`2025-001`) or leap seconds (`23:59:60`): the ledger files both for story 6 but says a real Source decides, and "do not implement leap seconds from this entry alone" (`deferred-work.md:134-137`).
- Any change to detection or reading behavior in `typing.js` beyond adding the extractors.

**Never:**

- No Step kinds, no execution, no graph or Editor change — story 6b's.
- No reopening the integer `MAX_SAFE_INTEGER` guard — closed by story 4a (the whole column reads `text`). A fractional part beyond float precision **rounds** at conversion; the ledger entry (`deferred-work.md:104-107`) stays open as the owner's scope question and this story does not decide it.
- No intermediate array of row objects on the way into the engine — the adapter builds columns directly, so D2's rule 1 is satisfied by construction, not by a drop (see Design Notes).
- No worker for conversion — moving a dataset to a worker to compute on it is a measured straight loss (`measured-constraints.md:20`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Number, de locale | `1.234,56`, confirmed number `{group: '.', decimal: ','}` | `1234.56` | N/A |
| Affixed number | `12,5 %` in a confirmed `%` column | `12.5`; affix stays column-level | N/A |
| Unparsed value | `abc` in a confirmed number column | box carrying `abc`; row index in `unparsed`; preview cell marked | never null, never dropped |
| End-of-day datetime | `31.12.2025 24:00`, confirmed dmy datetime | `BigInt` epoch ns of `2026-01-01T00:00:00Z` | N/A |
| Offset datetime | `2025-06-15T12:00:00+02:00` | epoch ns of `2025-06-15T10:00:00Z` | N/A |
| Short year | `31.12.25`, confirmed `shortYear` date | UTC midnight ns of `2025-12-31` (pivot ≤29 → 2000s) | N/A |
| Time / duration | `14:30` time; `25:00` duration | `52_200e9n` ns since midnight; `90_000e9n` ns | standalone `24:00` cannot reach a time column (refused at detection) |
| Missing token | `n/a` in a column whose `missingTokens` include it | null cell; not a box; not counted unparsed | N/A |
| Boolean | `ja` under confirmed pair `ja/nein` | `true` | N/A |
| Fractional overflow | `1,2345678901234567890` confirmed number | rounds to nearest float (ledger stays open) | N/A |
| Unconfirmed Source | typing not confirmed | no conversion, no marks | N/A |

</frozen-after-approval>

## Code Map

**Read-only shapes to build against:**

- `ports/index.js:19-30` — the `Table` typedef, fully specified: `rows()`, `rowCount()`, `schema()`, `column(name)`. This is what the adapter must hand out. `:82-88` — the `TableEngine` stub this story turns into a contract; body today is only the AD-19 hazard prose. `:47-52` — `SourceReader` explicitly assigns conversion to this story.
- `core/exec/source-store.js:448-461` — the frozen entry: `table` is `{ columns: [{name, domain, cells}], rowCount }` of **canonical text**; `typing.columns[i]` carries `{type, format, counts:{total,missing,parsed,unparsed}, missingTokens, chosen, …}`; `chosen` is `{type, format}|null` (`:681-689`). `:736` `confirmTyping` flips `confirmed` and converts nothing. `:260-267` `commit` freezes — entries can be compared by reference for cache invalidation.
- `core/types/typing.js:882` `numberParts(text, {group, decimal}, affix, accounting)` → `{digits, fraction, negative}|null` — its docstring at `:878-881` names this story. `:1294` `affixScan` and `:850` `carriesAccountingEvidence` are what `scoreColumn` re-derives at `:2076, :2093-2098` — conversion must derive identically. Predicates to pair with extractors: `readsAsDate :1048`, `readsAsMonthNameDate :1019`, `readsAsDateTime :1250`, `readsAsClockTime :1192`, `readsAsBoolean :1274`; helpers `isRealDate :952`, `dayIndex :1800`, `readsAsEndOfDay :1178-1181`, `clockStart :1241`, `readsAsOffset :1166` (±14:00, `-00:00` refused), `monthNameSpellings :426` / `normalizeMonthToken :307`, `sift :1882` (private today), `readerFor :1917` (the dispatch shape a `partsFor` mirrors).
- `core/types/catalog.js:38-44` — the seven type codes conversion dispatches on.
- `core/diagnostics/diagnostic.js:43-62` — diagnostic constructors, should conversion need to report (e.g. per-column unparsed summary re-emitted at conversion).
- `ui/SourcesPane.vue:411-418` `hitRate` — the "842 von 900" sentence; `:1148-1151` the one `RowWindow` embed. `ui/RowWindow.vue:165-172` — cells render as bare `{{ cell }}`, no per-cell class or title today. `core/view/row-window.js:135` `sliceRows` reads `columns[c].cells[i]` directly — marking projects alongside, it does not change the table shape.
- `adapters/vueflow/canvas-logic.js` + its 24 node-envelope tests — **the adapter split to copy**: pure logic in a plain `.js` beside the SFC, because vitest's `core` project reaches `adapters/**/*.test.js` in `environment: 'node'` but cannot compile `.vue` (`vitest.config.js:52-72`).
- `eslint.config.js:31-35, 104-110` — the `vueFlowBan` pattern; `:172-173` adapters are deliberately unrestricted. `scripts/assert-single-file.mjs` — structural gate; Arquero adds ~236 kB raw / 73.6 kB gzip, the single largest budget item (research digest), and the gate checks structure, not size.
- `app/main.js:16,35` — the only place a concrete adapter is named (AD-1).

## Tasks & Acceptance

**Execution:**

- [ ] `package.json` -- add `"arquero": "8.0.3"` (exact pin, no caret) -- AD-19; the spine's Stack table is version authority
- [ ] `eslint.config.js` -- `arqueroBan` restated in every `no-restricted-imports` block; other adapter dirs included -- one importer, enforced by lint not review (AD-1)
- [ ] `ports/index.js` -- give `TableEngine` its first real contract: `fromColumns(columns: ReadonlyArray<{name, type, values}>) → Table`; document that boxes and `BigInt` are adapter-owned hazards (AD-19, AD-21, AD-22) -- the port stops being prose
- [ ] `core/types/typing.js` -- export `dateParts`, `datetimeParts`, `timeParts`, `durationParts`, `booleanParts` beside their predicates; export the missing-split (`sift`) -- one parser rule: no second reading of any shape
- [ ] `core/types/typing.test.js` (extend) -- pair-agreement property per type over the reading corpus: extractor returns parts iff predicate returns true -- the counts and the conversion cannot disagree
- [ ] `core/exec/convert.js` (new) + `convert.test.js` -- `convertSource(entry, engine)` → `{table, unparsed}`: per-column dispatch on confirmed type, missing → null, failure → box via engine, temporals → `BigInt` ns; plus the Step-zero cache keyed by entry reference, invalidated when the registry hands out a different frozen entry -- AD-7's own sentence: typing "is applied by the engine as Step zero … and caches like any other Step"
- [ ] `adapters/arquero/engine.js` (new) + `engine.test.js` -- `createArqueroEngine()`: builds the Arquero table column-wise, private box representation, `Table` handle with frozen row objects at edges -- node-envelope tests like `canvas-logic.test.js`
- [ ] `app/main.js` -- construct the engine, pass it down as a prop -- the only file naming the adapter (AD-1)
- [ ] `ui/SourcesPane.vue` -- for a confirmed Source, obtain the conversion and hand per-column marks to the preview; German title on a marked cell (e.g. `Unter dem bestätigten Typ nicht lesbar`) -- the count stops being a dead end
- [ ] `core/view/row-window.js` + `ui/RowWindow.vue` -- optional `marks` input: per-cell marked state rendered as class + `title`, windowing math untouched -- a render, not a search
- [ ] `tests/e2e/typed-table.spec.js` (new) -- fixture with known unparsed cells: confirm, count marked cells, assert equality with the panel's number, original text visible -- CAP-9:109
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- close the entry at `:175-178` (count → rows), citing this spec -- ledger hygiene

**Acceptance Criteria:**

- Given a confirmed Source whose panel reports N values unreadable in a column, when the preview renders, then exactly N cells of that column are visibly marked and each shows its original text.
- Given the fixture corpus, when every confirmed column is converted, then for every column `unparsed.length === typing.counts.unparsed` and no parsed value differs from what its parts-extractor read.
- Given `31.12.2025 24:00` under a confirmed dmy datetime, when converted, then the cell equals the epoch nanoseconds of `2026-01-01T00:00:00Z`.
- Given a Source that is unconfirmed (or becomes unconfirmed / re-read), when the preview renders, then no cell is marked and the cached conversion for the old entry is released.
- Given `npm run build && npm run assert`, when Arquero is installed, then the artefact is still one HTML file with zero dynamic imports, zero fetches.

## Spec Change Log

## Design Notes

**Where the converted copy lives — decided against the measurement, closing the open architecture question.** AD-7 keeps bytes and the raw parsed table (six requirements read from them). D2's rule 1 — "drop the parsed row array once `aq.from()` has run", 110.8 vs 80.2 MB — targets an object this codebase never builds: the intermediate array of row objects. D2's own mechanics (`research.md:470-487`) show `aq.from` copies per column and shares values by reference; the 30.6 MB gap is row-*object* overhead, and the marginal cost of a table beside an existing row array is 8.0 MB. Resolution: **the registry stays exactly as AD-7 demands; the adapter builds engine columns directly from `entry.table.columns[i].cells` during conversion, so no row array ever exists to drop; the converted Table is Step zero's output, cached per Source outside the registry and outside reactivity, released on unconfirm or re-read.** Converted numeric/temporal columns are new allocations regardless (a `BigInt` is not the raw string) — the decisive property is that nothing ever holds a third copy. Budget from the measured envelope: ~80.2 MB per converted 100k×20 Source, 552.6 MB at five — plan from 550 MB.

**Why dispatch on `type`:** `format` is null for exactly the two types with distinct AD-21 units; a format-dispatched converter would crash on time and duration first.

**Why the extractors live beside the predicates:** `numberParts`'s docstring states the rule — conversion "must read every value exactly as detection counted it." A second parser in the adapter would drift; a predicate rewritten as `parts !== null` cannot.

## Verification

**Commands:**

- `npm install` -- expected: `arquero@8.0.3` resolved, no other new dependency
- `npm run build && npm run assert` -- expected: one HTML file, zero `import(`, zero `fetch(`, every `url(` a `data:` or `#`
- `npx vitest run --project core` -- expected: green, including pair-agreement and count-equality properties
- `npm run verify` -- expected: lint (arquero ban active), both Vitest projects, Playwright in Chromium and Firefox green
