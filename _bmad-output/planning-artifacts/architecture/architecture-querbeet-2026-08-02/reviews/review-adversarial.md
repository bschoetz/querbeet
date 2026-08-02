---
title: 'Adversarial review — ARCHITECTURE-SPINE.md (querbeet)'
type: review
lens: adversarial
target: 'architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
driving-spec: 'prds/prd-querbeet-2026-08-01/prd.md'
date: '2026-08-02'
verdict: 'The spine holds its layering and its build constraints. It does not hold its data shapes. Fourteen pairs of fully compliant units build incompatible things, and five of them end in a wrong number rather than an error.'
---

# Adversarial review — the architecture spine of querbeet

## Method and standing

The test applied is not "is this AD true". It is: **can I write two units one level down — two epics, two stories, or the same developer a week apart — that each obey every AD to the letter and still build things that do not fit together?** Every such pair is a hole, and the hole is closed by an AD that does not exist yet or by tightening one that does.

Fourteen pairs are below, ordered by what they cost. The severity scale is the PRD's own, stated in §4: *querbeet's characteristic failure mode is a plausible wrong number, not an error message.* A pair that ends in a crash is a nuisance. A pair that ends in a number nobody can tell is wrong is an existential defect for this product, because the whole value proposition — an export a Boxchecker files, a Recipe a Consumer runs against data the Author never sees — rests on the output being trustworthy without a second opinion.

**Five of the fourteen end in a wrong number:** A-1, A-2, A-4, A-6, A-9.

What resisted is recorded in the last section, and it is a real list, not a courtesy.

---

## A-1 — Chunked execution is defined nowhere, and one of the two readings computes wrong aggregates

**Severity: existential.** This is the strongest finding in the review.

### The two units

**Unit A — Story "Scheduler: chunked, cancellable execution" (`core/exec`).**
Implements AD-9 with *one Step per chunk*. The scheduler walks the topological order, calls one Step function, yields to the message queue, checks for cancellation, calls the next. Fully compliant: Step functions stay synchronous (AD-4), the scheduler yields between chunks and checks cancellation through the message queue (AD-9), no `SharedArrayBuffer` is touched.

**Unit B — Story "Progress and cancellation at the design scale" (`core/exec`), written a week later against the same ADs.**
Reads AD-9's "~5 ms chunks" as binding — because it is the only number in the rule — and observes that Unit A's chunk is not 5 ms: the addendum measures a single first-Step edit in a 30-Step graph at 578.6 ms (Chromium) / 1,156 ms (Firefox), and R4's Checkpoint D2-a produced a single join emitting 2,687,670 rows from 28,000 source rows. Unit B therefore chunks *inside* a Step. It cannot make the Step function async or a generator — AD-4 forbids both — so it does the only thing AD-4 leaves open: it slices the input table into row ranges, calls the same pure Step function once per range, and concatenates the results. Signature unchanged, purity unchanged, synchrony unchanged. Fully compliant with AD-4 and with AD-9's letter.

### The break

Unit B's strategy is correct for Filter (FR-15), Columns (FR-16) and Computed Column (FR-17), which are row-local. It is **silently wrong** for three of the six Step kinds:

- **Aggregate (FR-18).** A per-chunk `group by` produces partial groups. Concatenating them yields one output row per (group, chunk) instead of one per group. `count` and `sum` are recoverable by a merge pass that does not exist in Unit B; `average`, `count distinct`, `minimum` and `maximum` are not recoverable from the concatenated partials at all — `average` of averages is wrong whenever chunks differ in size, which they do at the tail. FR-18 also requires "rows with null in a grouping column form their own visible group", and that group now appears once per chunk.
- **Join (FR-14).** A per-chunk join misses every match whose right-hand row fell in another chunk. FR-14's "the Step reports how many left rows found no match" then reports a number that is an artifact of the chunk size. Worse: the row-count warning ("the output row count exceeds the input row count ... states the factor") compares against a per-chunk input, so a genuine Cartesian product is diluted below the warning threshold.
- **Union with column mapping (FR-13).** FR-13 requires the union of all column names to be computed and each input padded before `concat` — the addendum records this as the measured workaround for Arquero's silent column drop. Per-chunk, the column union is computed over a chunk, so a column that only appears in rows 80,000+ of one input is dropped from the chunks that precede it and appears as null-padded in the chunks that follow. That is exactly the silent column drop FR-13 exists to prevent, reintroduced by the scheduler.

Neither unit raises a diagnostic. Both produce a table. The Result looks like a table.

Unit A's failure is milder but also real: with chunk = Step, cancellation latency equals the longest single Step, which is unbounded — AD-9's own *Prevents* clause ("an execution the user cannot stop") is not met, and the addendum names this directly: *"the threshold has to be low enough that live mode never begins work the user cannot get out of."* A rule that permits an unbounded chunk cannot deliver that.

### FRs and ADs involved

FR-13, FR-14, FR-18, FR-34, FR-38, NFR-3; AD-4, AD-9.

### The AD that closes it

**AD-19 — The chunk boundary is a Step boundary, and a Step declares its cost class.**
The scheduler's unit of work is one Step invocation; it never partitions a Step's input. A Step function therefore declares a static cost class — `row-local` or `whole-table` — and only `row-local` Steps may be invoked over a row range, by the scheduler and never by a Step author. Join, Aggregate and Union are `whole-table` by declaration and are always invoked once over their complete inputs. Because a `whole-table` Step can exceed the chunk budget, AD-9's cancellation guarantee is restated honestly: **cancellation latency is bounded by the longest single `whole-table` Step, not by the chunk size**, and FR-38's threshold is calibrated against that number rather than against the 5 ms figure. The progress affordance reports Step-granular progress for `whole-table` Steps.

---

## A-2 — `SourceReader` has no cell-domain contract, so three adapters deliver three different value universes into one type system

**Severity: existential.**

### The two units

**Unit A — Epic "CSV and JSON loading" (`adapters/csv`, `adapters/json`).**
PapaParse with `dynamicTyping` permanently off — mandated by the addendum. Every cell that reaches the registry is a **string**. All typing is therefore Step zero's job (AD-7), the R5 type record `{type, decimalChar, groupChar, dateFormat, missingValues, keepOriginal}` applies to every column, FR-9's full-column scan reports a real hit rate ("842 of 900 values readable"), and the missing-value token list has something to match against.

**Unit B — Epic "XLSX and Parquet loading" (`adapters/xlsx`, `adapters/parquet`).**
`read-excel-file` 9.3.5 returns **real JS numbers and real `Date` objects**; `hyparquet` returns typed values under Parquet logical types. Unit B stores what the library delivers, which is exactly what AD-7 instructs: *"the registry holds raw parsed tables — values as delivered."*

Both units implement the same port. The port's name — `SourceReader`, a noun of role — is all the spine says about it.

### The break

Step zero (AD-7) now receives two incompatible value universes under one type record, and the record is a *string-parsing* record. Two equally defensible implementations of Step zero:

- **Pass-through:** if a value is already the target native type, leave it. Consequence: `missingValues` never fires for XLSX/Parquet columns. FR-9 enumerates precisely what that changes, and it changes all four: null shares in the Column Profile (FR-26), which rows form their own group (FR-18), which rows a join matches (FR-14), and what "is empty" means (FR-15). The Author's CSV-sourced pipeline and the Consumer's XLSX-sourced run of the same Recipe produce different row counts from the same data.
- **Stringify-then-parse:** coerce to string and run the record. Consequence: an XLSX float stringifies as `0.30000000000000004`; a `Date` stringifies in a form `dateFormat: 'dd.MM.yyyy'` refuses, so 100 % of an XLSX date column is reported unparsed and FR-9's confirmation gate blocks a perfectly good file.

And FR-9's headline guarantee is voided either way: *"Detection reads every value in the column, not a sample"* is meaningless for a column that arrived typed. What hit rate does the detector show for an XLSX date column — 900 of 900, unconditionally? Then FR-9's confirmation gate, which the PRD calls "the single strongest correctness guarantee", is a real gate for CSV and a rubber stamp for XLSX and Parquet. The Input Contract (FR-21) then records a "confirmed type and locale" that was never confirmed against anything, and the Consumer whose export of the same report is CSV fails the Pre-flight Check (FR-22) against a contract derived from a file format rather than from the data.

Sharpest single instance: **FR-1 requires a querbeet-exported Parquet file to load back "with its columns and types intact."** Under Unit B the types come back as Parquet logical types with no type record; under Unit A the same data round-tripped via CSV comes back as strings needing full confirmation. One requirement, two loaders, two different post-load states, and FR-9's gate fires in one case and not the other.

### FRs and ADs involved

FR-1, FR-9, FR-14, FR-15, FR-18, FR-21, FR-22, FR-26, FR-36; AD-7, AD-13; the `SourceReader` row of the ports convention table.

### The AD that closes it

**AD-20 — `SourceReader` delivers one declared cell domain.**
Every `SourceReader` returns `{ columns: [{name, native: 'text'|'number'|'date'|'boolean'}], rows }`. A column is `text` unless the *source format itself* carried a type — CSV and NDJSON are always `text`; XLSX and Parquet may be native. Step zero's behaviour is stated per domain and not left to the implementer: for `text` columns the full R5 record applies; for native columns the parse phase is skipped but **the missing-value token pass always runs**, on the original value where the format retained one. Detection reports the hit rate over the values it actually evaluated and says which of the two paths produced it, so a hit rate is never a number that means nothing. FR-21's Input Contract records the cell domain alongside the type, so a Pre-flight Check can distinguish "same type, different source format" from "wrong type".

---

## A-3 — The unparsed-value carrier is unspecified, and every choice becomes a column somebody else enumerates

**Severity: existential.**

### The two units

FR-9 requires that values which do not parse "are marked as unparsed and remain inspectable in their original form — they are never silently replaced by null, and the original is retained." R5's type record carries `keepOriginal`. FR-31 requires "cells whose value did not parse under the column's confirmed type are visually marked." AD-5 says the boundary form is **plain frozen row objects**. Plain. Nothing in the spine says where the original text and the unparsed flag live.

**Unit A — Story "Step zero applies the type record" (`core/types`, `core/exec`).**
A typed column becomes `number | null`, and a **sidecar column** `__raw__LastPatchDate` carries the original text wherever the parse failed. Rows stay plain and frozen (AD-5), Step zero stays pure (AD-4), a diagnostic reports the count (AD-13). Compliant.

**Unit B — Story "Result table marks unparsed cells" (`ui/`), same week.**
Needs the marker at the cell, so it assumes the cell is **boxed**: an unparsed cell is `{ __unparsed: '12,5x' }` and a parsed one is a bare value. Also plain frozen row objects. Also compliant.

### The break

Under Unit A the sidecar is a column, and five separate places enumerate columns:

- **FR-13 Union** must *"list to the user before the Step runs"* every column present in only some inputs — so the Consumer is asked whether to keep or drop `__raw__LastPatchDate`.
- **FR-16 Columns** offers it for selection, renaming and reordering, and its refusal-on-duplicate-name check now guards a name the user never created.
- **FR-21 Input Contract** derives "the columns the Pipeline actually reads" — sidecars included if any Step touched one.
- **FR-26 Column Profile** ships `__raw__` columns to the language model, and FR-27's prompt block invites the model to reference them in a Recipe.
- **FR-36 export** writes them into the Boxchecker's XLSX.

Under Unit B, no column leaks — but every Step kind now receives objects where it expects scalars. `sum` over a column with one boxed cell yields `NaN` or a string concatenation depending on the engine path; a join key that is boxed never equals a bare key, so FR-14's unmatched-row count silently rises; FR-15's `>` comparison against a boxed value is neither true nor false; and CSV export writes `[object Object]`.

Both units are compliant, and the two are not merely different — a pipeline built half from each produces a table that is wrong in both directions at once.

### FRs and ADs involved

FR-9, FR-13, FR-14, FR-15, FR-16, FR-18, FR-21, FR-26, FR-31, FR-36; AD-4, AD-5, AD-7.

### The AD that closes it

**AD-21 — Unparsedness is out of band, and every Step kind states its behaviour on it.**
A Table carries, alongside its columns, an **unparsed mask**: per column, the row positions whose value did not parse, together with the retained original text. The mask is not a column. It is invisible to every column enumeration — FR-13's union list, FR-16's selector, FR-21's contract, FR-26's profile, FR-36's export header — and is reachable only through a named Table accessor that `ui/` uses for FR-31's marking and FR-9's inspection. Every Step kind declares its mask semantics explicitly and once: **an unparsed cell is treated as null for matching, grouping, filtering and aggregation, and the mask propagates to the output row.** FR-17's marked empty cell on division-by-zero produces a mask entry with no original text, which is the same mechanism rather than a second one.

---

## A-4 — The content-addressed cache has no base case, so a re-parse of a Source is invisible to it

**Severity: existential.**

### The two units

AD-8 states `key(step) = hash(canonical(config) + key(inputs))`. It defines `key` recursively and **never states `key(source)`**.

**Unit A — Story "Per-Step memoization" (`core/exec`).**
`key(source) = sourceId`. Cheap, obviously stable, and consistent with AD-14's "ids are stable and never reused".

**Unit B — Story "Cache survives a session restore" (`core/exec`), written against FR-25.**
`key(source) = hash(raw parsed content)`, so a restored session (FR-25) or an imported Package (FR-24) that reproduces the same table reuses the Author's cached results rather than recomputing from scratch. Also a defensible reading of "content-addressed", which is the name of the AD.

### The break

Under Unit A, four requirements change a Source's parsed content **without changing its id**, and AD-7 explicitly keeps all four out of Step zero by ruling that the registry holds "raw parsed tables — values as delivered":

- **FR-2**: changing the encoding "re-reads the file".
- **FR-3**: correcting the delimiter or the header row re-parses it.
- **FR-39**: deciding to load a structurally damaged CSV anyway changes what the table contains.
- **FR-7**: changing the JSON array strategy "without reloading the file" changes both the column count and the row count.

After any of these, every downstream Step's key is unchanged, and AD-8 says in terms what happens next: *"An edit that returns a configuration to a previous value returns to a previous key and reuses the entry."* The user corrects a semicolon delimiter on a 4,200-row CSV, the Source preview updates, and the Result shows the table computed from the one-column misparse. AD-8's own *Prevents* clause — "a stale table shown as current" — is delivered by AD-8's own rule.

Under Unit B the correctness is right and the cost is wrong: hashing the content of a 100,000-row table is a full pass at every key computation, on a path FR-38's live mode runs on every configuration change, against a whole-pipeline budget the addendum measures at 263–446 ms.

The two units are also mutually incompatible at the persistence boundary: a cache written by A and read by B is a cache whose keys mean different things, and nothing in the spine versions a cache.

### FRs and ADs involved

FR-2, FR-3, FR-7, FR-19, FR-24, FR-25, FR-38, FR-39; AD-7, AD-8.

### The AD that closes it

**AD-22 — A Source has a parse generation, and it is the cache's base case.**
`key(source) = sourceId + ':' + generation`, where `generation` is a monotonically increasing counter incremented by the core on every command that re-parses the Source — encoding change (FR-2), delimiter or header change (FR-3), array-strategy change (FR-7), damaged-load acceptance (FR-39), and re-read after restore. The generation is session state and is never serialized into a Recipe, so it never affects AD-14's byte-identical round trip. The cache is dropped wholesale on any change to the parse-settings vocabulary itself, and a persisted cache carries the build version and is discarded on mismatch rather than migrated (consistent with AD-12's refusal posture).

---

## A-5 — Source parse settings have two owners, and Recipe load has no precedence rule

**Severity: high.**

### The two units

**Unit A — Epic "Loading Sources" (FR-1 – FR-8, FR-39).**
Builds `SourceReader` adapters parameterised by `{bytes, name, encoding, delimiter, headerRow, arrayStrategy}` and a `ui/` panel that owns those settings per Source, because that is where the user sets them and where FR-2, FR-3 and FR-7 put the affordance. AD-3 endorses this shape: `ui/` unwraps the browser object and issues a command carrying bytes, text and a name.

**Unit B — Epic "Recipes and Packages" (FR-20 – FR-25).**
Builds `core/recipe` with the canonical serializer. FR-3 says of delimiter and header row: *"Both settings are stored in the Recipe."* FR-7 says of the array strategy: *"is stored in the Recipe."* So Unit B serializes and deserializes them, and AD-11's validator refuses a Recipe that omits or misnames them.

### The break

Two owners of one piece of state, and the collision is not theoretical — it is UJ-2's opening move. The Consumer loads Ben's Recipe and drops in his own CSV export. FR-3 detects a delimiter from that file; the Recipe carries the Author's. Which wins?

- **Unit A's reading:** detection runs on the file in front of the user, the Recipe's value is a hint. Consequence: the Author corrected a doubtful delimiter by hand precisely because detection got it wrong (UJ-1 says so in as many words), and the Consumer's identical file gets the same wrong detection with no correction carried across. The Recipe's stored fix silently does nothing.
- **Unit B's reading:** the Recipe's value is applied and overrides detection. Consequence: an export whose delimiter genuinely changed between months — UJ-4's named edge case, "the source system changed its export format" — is parsed under last month's delimiter into a single column.

Worse, neither outcome is reportable. FR-21 defines the Input Contract as *"the columns the Pipeline actually reads, and each column's confirmed type and locale"* — parse settings are **not** in the contract. So the Pre-flight Check (FR-22) cannot report a delimiter mismatch as fits/missing/doubtful. What it reports instead is that every single required column is *missing*, because the file parsed into one column named after the whole header line. The Consumer's first interaction with the product is a wall of missing-column errors whose actual cause is one character, unmentioned.

AD-11 does not help: it guarantees one validator across three doors, not that the validator knows what a delimiter is.

### FRs and ADs involved

FR-2, FR-3, FR-7, FR-20, FR-21, FR-22, FR-23, FR-24, FR-39; AD-3, AD-7, AD-11.

### The AD that closes it

**AD-23 — Parse settings belong to the Source, are carried by the Recipe as defaults, and are Pre-flight subjects.**
The parse settings of a Source — encoding, delimiter, header row, array strategy, damaged-row disposition — are one named record owned by `core/recipe` and applied by the `SourceReader` adapter as parameters, never invented by the adapter. On Recipe load the stored record is applied **as the proposal**, detection runs anyway, and where the two disagree the Pre-flight Check reports it as `doubtful` with both values named — the same fits/missing/doubtful vocabulary FR-22 already owns, extended to cover the settings that decide whether the column check means anything. The parse record is part of the Input Contract precisely so this disagreement has somewhere to be reported.

---

## A-6 — A cache hit produces no diagnostics, so the second run of a warning pipeline reports clean

**Severity: existential.**

### The two units

**Unit A — Story "Content-addressed per-Step cache" (`core/exec`).**
AD-8 says the cache is keyed on config plus inputs and that both FR-38 modes read and write "this one cache." Unit A stores what a cache stores: `Map<key, Table>`. On a hit it returns the table and does not call the Step function. Compliant — AD-8 says nothing about diagnostics.

**Unit B — Story "Run status" (FR-34).**
AD-13 says *"FR-34's run status is the aggregation of this stream and adds nothing of its own."* Unit B aggregates the diagnostics emitted during the run and renders the clean/warned distinction. Compliant.

### The break

Second run, unchanged configuration, fresh files of the same shape — UJ-4, the monthly run, which is one of the two primary success metrics (SM-3). Every Step is a cache hit. No Step function executes. No Step emits a diagnostic. Unit B aggregates an empty stream and reports **a clean run** over a pipeline whose Join Step warned last month that duplicate keys multiplied 4,200 rows into 61,000.

FR-34 is explicit about what the status must summarise: "every warning raised by any Step during the run, whether any Source was repaired (FR-6), and whether the duplicate audit (FR-14) was on." A cache hit raises no warning during the run and is indistinguishable from a Step that had nothing to say. FR-19 fails in the same motion: "warnings raised by that Step are visible alongside its Preview, **not only at the moment of execution**" — a requirement that AD-8's cache, as specified, makes unimplementable.

And FR-37 carries the consequence off the machine: the run status is reproduced in the exported view document, so the Boxchecker's copy of a Cartesian-product report says the run was clean.

Note that the same hole applies to two non-Step diagnostic producers that AD-13 admits by making `stepId` optional but never assigns an owner or a lifetime: FR-6's repair marker and FR-22's Pre-flight outcome. Both must survive into a run status for a run in which neither re-ran.

A second, quieter version of the same gap: AD-13 gives diagnostics no identity, no ordering and no replacement rule. In live mode (FR-38) a Step recomputes on every configuration change, so a naively appending stream accumulates hundreds of identical `join.duplicate-keys` entries, while a naively replacing stream loses FR-39's structural-damage report the moment any Step re-emits.

### FRs and ADs involved

FR-6, FR-14, FR-19, FR-22, FR-34, FR-37, FR-38, FR-39; AD-8, AD-13.

### The AD that closes it

**AD-24 — The cache stores the whole Step result, and diagnostics are keyed and replaced, never appended.**
The per-Step cache entry is the complete `{ table, diagnostics }` that AD-4 defines as a Step's return, so a cache hit replays its diagnostics exactly as an execution would. Diagnostics are held in a keyed store: the current diagnostic set of a producer (`stepId`, `sourceId`, or the named non-Step producers `preflight` and `session-restore`) **replaces** that producer's previous set rather than accumulating. FR-34's run status is the union over all current producers, which makes it well-defined in live mode, where there is no run event at all. A producer that has never executed and has no cache entry is `unknown`, and `unknown` is rendered distinctly from `clean` — because "no warnings recorded" and "no warnings occurred" are the same string and different facts.

---

## A-7 — A broken or failing Step has no defined output, and one of the two answers is an empty table

**Severity: high.**

### The two units

AD-4 fixes the Step signature as `(inputs, config) => { table, diagnostics }`. The conventions table says *"A port failure surfaces as a `Diagnostic` with `severity: error`, never as a thrown string. The core throws only on a programming error."* FR-12 says a Step whose input disappears "is marked broken and names what it lost." Nothing states what a broken or erroring Step **puts on its output edge**.

**Unit A — Story "Broken Steps" (`core/graph`, FR-12).**
Returns `{ table: emptyTableWithNoColumns, diagnostics: [error] }`. Honours the signature literally — `table` is typed `Table`, not `Table | null` — and downstream Steps need no special case.

**Unit B — Story "Join Step" (`core/steps/join`, FR-14), a week later.**
A join whose key column is absent returns `{ table: null, diagnostics: [error] }` and the scheduler halts the branch. Also defensible: producing a table from an operation that could not be performed is a lie, and the conventions table forbids throwing.

### The break

Unit A's empty table propagates. Every downstream Step computes correctly over zero rows: the Filter reports "0 rows removed", the Aggregate reports 0 in and 0 out, the Result Step shows an empty table, and — under A-6, if the error diagnostic came from a producer whose set was replaced — the run status may show nothing at all. **An empty Result is indistinguishable from an honest zero rows.** The PRD names this exact failure in FR-15 as the reason comparison-value type mismatches are refused: *"how established databases produce a silently empty result set, which is indistinguishable from an honest zero rows and is the failure this product exists to make impossible."* The spine reintroduces it one level up, at the Step boundary.

Unit B's null violates AD-4's stated return type, so every Step author who read AD-4 and not Unit B's code dereferences `inputs[0].numRows` on null and throws — which the conventions table classifies as a programming error, escaping the Diagnostic channel entirely and surfacing as an unhandled exception in a tool that promises it does not do that.

### FRs and ADs involved

FR-12, FR-13, FR-14, FR-15, FR-18, FR-19, FR-34, FR-39; AD-4, AD-13.

### The AD that closes it

**AD-25 — A Step that cannot run produces no table, and the absence propagates as a named state.**
AD-4's return type is `{ table: Table | null, diagnostics }`, and `table: null` means *did not run*, distinct in every consumer from an empty table meaning *ran and matched nothing*. A Step whose input is `null` does not execute, emits one `upstream-unavailable` diagnostic naming the first failing ancestor, and returns `null` in turn. The Result Step returning `null` is rendered as "no result" and never as an empty table; export (FR-36) and the view document (FR-37) refuse rather than writing an empty file, because an empty CSV in a compliance folder is the worst artifact this product could produce.

---

## A-8 — The transient view and the Result are two owners of what the user calls "the table", and export does not know which one it writes

**Severity: high.**

### The two units

**Unit A — Story "View filters and sort" (FR-32) plus "Full-dataset search" (FR-33), in `ui/`.**
FR-32 requires view filters to apply "to the full Result, not to the rendered window", to be transient, and to be convertible into a real Filter Step. FR-33 requires search over every row of the Result with a match count and jump-to-match. Unit A holds the view as an **index permutation plus a predicate mask** over the Result's materialized rows, in `shallowRef` — compliant with AD-6 ("`ui/` wraps the registry in `shallowRef` and never copies a table into reactive state") and with AD-10 (no model mutation: a view is not the model).

**Unit B — Story "Export the Result" (FR-36) and "Export the view document" (FR-37), in `adapters/*` behind `TableWriter`.**
Reads the Result table from the registry by Step id (AD-6) and writes it. Compliant, and required by FR-16: *"Column order in the Step determines column order in this Step's output and, if it is the Result Step, in every export."*

### The break

The user filters the view down to the 143 rows the CISO needs — UJ-1's climax is literally this number — and clicks export. Unit B writes 100,000 rows in the Step's column order. The user has no way to tell from the dialog which they got, and the two are the same file type with the same name.

The spine takes no position, and both positions are defensible from the FRs: FR-32 says a view filter "does not change the Result", which argues for Unit B; FR-37 says the document "shows the Dashboard as configured and the Result table", which also argues for Unit B — while every user expectation and UJ-1's own narrative argue for the view. FR-32's promote-to-Step action exists precisely because the Author is expected to make a view into data, which implies the un-promoted view is *not* data — but it does not say what export does with it.

The second half of the pair is inside Unit A. FR-32 permits sorting, and FR-33 requires jumping between matches. If the sort is a permutation over materialized rows and search indexes the underlying array, "match 3 of 47" resolves to a row position that does not correspond to the visible row — and FR-31 requires in terms that "the scroll position maps to the correct rows throughout." Two developers, one on FR-32 and one on FR-33, both reading AD-5's `table.rows()` — which declares **no row-order guarantee whatsoever** — will disagree about whether an index is pre- or post-permutation, and the disagreement shows up as the search jumping to the wrong row, not as an error.

A third consequence: if a developer instead implements the view sort as a core operation producing a new Table, that table needs a registry key, AD-6 keys the registry by "Source id and Step id", and a view is neither — so it either gets a minted id in the Recipe id space (AD-14: "unique within a Recipe", but this is not in a Recipe) or it lives outside the registry, which AD-6 says tables do not do.

### FRs and ADs involved

FR-16, FR-31, FR-32, FR-33, FR-36, FR-37; AD-5, AD-6, AD-10, AD-14.

### The AD that closes it

**AD-26 — Row identity is positional and stable, the view is a projection, and export names its subject.**
`Table.rows()` returns rows in a **defined, stable order** — the order the producing Step's semantics define, stated per Step kind — and a row's identity is its position in that order. The transient view (FR-32, FR-33) is a projection over that order: an ordered index list plus a match index list, both indexing the Result's canonical positions, never a second table and never in the registry. Every export (FR-36, FR-37) declares its subject explicitly in the action that starts it — "Result (100,000 rows)" or "current view (143 rows)" — and the written artifact records which it was, so the Boxchecker's document says on its face what it contains.

---

## A-9 — Dates have no single in-Table representation, so three readers and three writers disagree by up to a day

**Severity: existential.**

### The two units

The conventions table says: *"Data — dates in the domain: ISO 8601 strings across the Recipe boundary; parsed values inside a Table."* "Parsed values" is the whole specification.

**Unit A — Story "CSV typing" (`core/types`, FR-9).**
Parses `31.12.2025` with `date-fns` `parse` and an explicit pattern — the addendum's decision — yielding a JS `Date` at **local** midnight.

**Unit B — Story "Parquet and XLSX loading" (`adapters/parquet`, `adapters/xlsx`, FR-1).**
`hyparquet` returns a Parquet `DATE` as days since the Unix epoch, i.e. **UTC** midnight when widened to a `Date`; `read-excel-file` returns a `Date` from an Excel serial under its own convention.

Both comply with "parsed values inside a Table". Both are what the chosen libraries do.

### The break

FR-17 offers "difference between two date columns in days". Join one Source loaded from Parquet to one loaded from CSV (UJ-1 joins three exports; UJ-2 joins four), compute the difference, and in any timezone east of UTC the two midnights differ by hours and the floored day difference is off by one — for every row, silently, in a column the user reads as "days behind". FR-15's date comparison has the same defect at the boundary: `LastPatchDate < 2025-12-31` includes or excludes 31 December depending on which adapter loaded the column.

The write side splits the same way. `table.rows()` hands plain row objects to four `TableWriter` implementations with no stated date contract: the CSV writer formats `dd.MM.yyyy` per FR-36; the JSON writer calls `JSON.stringify`, which emits `2025-12-30T23:00:00.000Z` — a **different calendar day** than the CSV writer wrote from the same cell; the XLSX writer needs an Excel serial plus a German format code; the Parquet writer needs a logical type. FR-36 requires the Parquet export to load back into querbeet (FR-1), so the write and read conventions must be inverses, and nothing says they are.

Two developers on two writers, both fully compliant, produce two artifacts from one Result whose dates disagree — and it is exactly the class of defect FR-9 exists to eliminate, arriving one layer below where FR-9 can see it.

### FRs and ADs involved

FR-1, FR-9, FR-15, FR-17, FR-31, FR-36, FR-37; AD-5, AD-7; the "dates in the domain" convention.

### The AD that closes it

**AD-27 — One date representation inside a Table, timezone-free by construction.**
A date-typed cell inside a Table is a **UTC-midnight epoch-day integer**; there is no `Date` object and no local time anywhere in `core/` — which AD-2 already implies, since local time is an environment dependency. Every `SourceReader` converts to epoch days on the way in and every `TableWriter` converts out of them, and the two conversions are stated as inverses and tested as a round trip. Datetime columns, if they ever exist, are a distinct type and not a widened date. Display formatting (FR-31's German conventions) and locale-aware entry (FR-15) happen only in `ui/` and only against epoch days, so the Recipe's ISO 8601 boundary form has exactly one interpretation.

---

## A-10 — The Dashboard is model to one unit and view state to another, and AD-10's binds list says both

**Severity: high.**

### The two units

**Unit A — Epic "Result view and Dashboard" (FR-31 – FR-35).**
AD-10's *Binds* list is FR-11, FR-12, FR-20, FR-28, FR-32. **FR-35 is not in it.** The capability map assigns FR-31–FR-35 to `ui/` and `adapters/echarts`, governed by AD-6 and AD-10 — but AD-10, read against its own binds list, governs the Editor's graph. Unit A concludes that Tile configuration is view state, holds it in a reactive `dashboard` ref in `ui/`, and mutates it directly from the Tile form. No AD forbids this; the conventions table's "No component writes to the model" is satisfied because Unit A does not consider the Dashboard to be the model.

**Unit B — Epic "Recipes" (FR-20).**
FR-35 says *"The Dashboard definition is stored in the Recipe."* The spine's own ER diagram says `RECIPE ||--|| DASHBOARD`. Unit B's canonical serializer therefore reads the Dashboard out of `core/recipe`, and AD-14 requires a byte-identical round trip as a test.

### The break

Two owners of one entity, with a projection in one direction only. `loadRecipe` (AD-10, an actual named command) writes the Dashboard into the core model; Unit A's `ui/` ref never learns about it, so UJ-2's Consumer loads Ben's Recipe and lands on an empty Dashboard — while FR-35's whole point is *"so a Consumer sees the Author's Dashboard."* In the other direction the Author configures four Tiles, saves the Recipe, and gets the Dashboard the Recipe was loaded with. AD-14's byte-identical round-trip test passes throughout, because it never round-trips through `ui/`.

The same hole is open for **five more Recipe-resident pieces of state whose mutation path AD-10 does not name**: the type and locale confirmations (FR-9), Column Annotations (FR-10), the edited Input Contract (FR-21), saved-back column mappings (FR-23), and the Source parse settings of A-5. AD-10's rule reads as absolute — "All model change goes through named commands" — but its enforceability depends entirely on what counts as "the model", and the AD answers that question with a binds list that omits over half of what the Recipe holds. That is a rule that sounds binding and is a matter of opinion in practice.

### FRs and ADs involved

FR-9, FR-10, FR-20, FR-21, FR-23, FR-30, FR-35; AD-10, AD-14; the ER diagram.

### The AD that closes it

**AD-28 — The model is the Recipe, entire, and every Recipe-resident field has a named command.**
"The model" in AD-10 means everything the canonical serializer writes: Steps, edges, Source parse settings, type records, Column Annotations, the Dashboard, the Input Contract and its saved mappings. The command vocabulary is extended to cover all of it — `setColumnType`, `annotateColumn`, `setParseSettings`, `configureTile`, `reorderTiles`, `editContract`, `mapColumn` — and `ui/` renders from one projection of the core model in every case. State that is deliberately *not* in the Recipe is enumerated in the same breath, so its absence is a decision rather than an oversight: transient view filters and sort (FR-32), sample-release choices (FR-30, which FR-30 requires not to persist), the execution mode in force (FR-38), and Source parse generations (AD-22).

---

## A-11 — Two id spaces meet at the Consumer, and the Recipe binds only one of them

**Severity: high.**

### The two units

**Unit A — Story "Recipe references a Source" (`core/recipe`, FR-20).**
A Step's input is an id: `src:patch`. AD-14 requires ids to be short, readable, minted by the core, unique within a Recipe and stable across a round trip.

**Unit B — Story "Pre-flight Check and column mapping" (FR-22, FR-23).**
The Consumer has loaded three files of their own. Each became a Source with its own core-minted id — `src:umsatz-maerz` or `src:1`, depending on the minting rule, which the spine also does not state. The Input Contract (FR-21) declares expectations "per expected Source: a role name". Nothing in the spine says how a role name binds to a loaded Source id.

### The break

Two incompatible bindings, both compliant:

- **Unit B rewrites the loaded Source's id** to the contract's role name so the Recipe's `src:patch` resolves. This mutates an id that AD-14 calls stable, and it breaks if the Consumer loads two files that both plausibly satisfy one role, or one file that satisfies none.
- **Unit B keeps a binding map** `role → sourceId`. FR-23 says mappings "can be saved back into the Recipe", so the map wants to live in the Recipe — but a Recipe saved with the Consumer's local Source ids is no longer portable to a third person, and AD-14's byte-identical round trip now depends on session state. If the map lives outside the Recipe, FR-23's "so the same correction is not repeated next month" fails across the session boundary that FR-25 restores.

The same ambiguity has a second face at Recipe load. FR-28 has a **language model** authoring a Recipe with its own ids. If `loadRecipe` re-mints them, the byte-identical round trip AD-14 makes a test fails on the first save, and AD-11's refusal messages — which must be "shaped to be pasted back to a model" — name ids that do not appear in the text the user pasted, which breaks the correction loop that Open Question 3 already flags as never exercised. If `loadRecipe` does not re-mint, the core must recover its minting state from the loaded Recipe, and AD-14's "never reused after a deletion" needs a high-water mark the Recipe format does not carry:

- Dev A derives the counter as `max(suffix) + 1`. Delete the highest Step, save, reload, add a Step — and the id is reused, across exactly the boundary AD-14 forbids it, where FR-23's saved mappings and FR-25's restored session may still reference the dead one.
- Dev B stores `nextId` in the Recipe. An LLM-authored Recipe has no such field. AD-11 refuses *unrecognised* fields and says nothing about *missing* ones, so Dev B's loader either refuses every model-authored Recipe — killing UJ-3 and FR-28 — or defaults it, which is Dev A.

### FRs and ADs involved

FR-20, FR-21, FR-22, FR-23, FR-24, FR-25, FR-27, FR-28; AD-11, AD-12, AD-14.

### The AD that closes it

**AD-29 — Recipes reference roles; sessions bind roles to Sources; ids are never re-minted on load.**
A Recipe's Step inputs reference **contract role names**, not session Source ids — the role name is the portable identifier and is the only Source-shaped thing a language model has to invent (FR-28). The role-to-Source binding is session state produced by the Pre-flight Check and FR-23's mapping, held outside the Recipe; FR-23's "saved back" saves the *column* mapping into the contract, which is portable, and never the Source binding, which is not. `loadRecipe` preserves every id byte-for-byte and re-mints nothing. The minting rule and its exhaustion rule are stated once: ids are `s<n>` with `n` a strictly increasing counter, and the counter is derived on load as `max(n) + 1` with the explicit consequence that a deleted trailing id **is** reusable across a save/load boundary — AD-14's "never reused" is scoped to a live session and says so, rather than promising something the format cannot carry.

---

## A-12 — AD-16 promises what R9 measured to be impossible, and the two available discriminators fail in opposite directions

**Severity: medium-high. This is a rule that cannot be complied with as written.**

### The internal contradiction

AD-16's *Prevents* clause: "two copies of `querbeet.html` silently sharing one session." AD-16's *Rule*, three lines later: "the `file://` origin is one bucket shared across directories in both engines ... and querbeet cannot partition it from the inside." The AD states that it prevents a thing and then states that the thing cannot be prevented. Any unit can claim compliance; no unit can be shown to fail.

### The two units

**Unit A — Story "SessionStore namespacing" (`adapters/indexeddb`).**
Uses a **build-time constant** as the discriminator, because AD-17 forbids runtime configuration and `app/` already owns a build version. Consequence: every copy of the same build shares one bucket — the exact scenario AD-16 claims to prevent, and the one FR-25 says "will happen" because copying the file is the expected distribution method. Second consequence: two *different builds* get different discriminators, so upgrading querbeet silently orphans the user's session while FR-25 promises "reopening the tool restores the previous session," and FR-25's one-action delete clears only the current build's namespace, leaving the previous build's 8.9 MB behind under a name nothing will ever open.

**Unit B — Story "SessionStore namespacing", written a week later.**
Uses a **per-installation random id**. It has to be stored somewhere, and the only durable store available is the shared bucket — so the second copy reads it and adopts it, landing back on Unit A's behaviour. The alternative is deriving it from `location.pathname` in the adapter (AD-2 forbids `window` in `core/` only, so this is legal): now two copies in different directories are correctly separated, and the *same* copy moved to a different folder loses its session with no explanation, while a copy opened from a path with different percent-encoding is a third session.

### The second break: the session payload has no version gate

AD-12 binds FR-20, FR-21 and FR-24 — Recipe and Package. **The `SessionStore` payload is not covered by any version rule.** A build that stores rows and a build that stores column arrays (both defensible under AD-5, which names `SessionStore` as a materialization edge while the addendum measures column arrays as ~30 % cheaper to send) write mutually unreadable payloads under the same key. FR-25's "restored state is treated as possibly incomplete rather than assumed intact" then converts a format mismatch into "your session came back partial" — the friendliest possible wording for silent data loss.

### FRs and ADs involved

FR-24, FR-25, NFR-8; AD-12, AD-16, AD-17.

### The AD that closes it

**AD-30 — The discriminator is named, its failure modes are stated as product behaviour, and the store is versioned.**
The `SessionStore` discriminator is a **build-independent product constant** plus a user-visible, user-changeable session name defaulting to a single shared value. The consequences are stated in AD-16's own text rather than left to an implementer to discover: two copies of the same file **do** share a session by default and the UI says so (FR-25 requires the statement anyway), and a user who wants separation renames the session. AD-16's *Prevents* clause is rewritten to what is achievable — a Package import never overwrites a live session, and the discriminator is present from the first version so it can never be retrofitted — dropping the copy-isolation claim R9 disproved. Every stored record carries a store format version; a mismatch is **refused and reported as a version mismatch naming both versions**, on AD-12's posture, and is never rendered as FR-25's "incomplete session".

---

## A-13 — `ChartRenderer` is one port with two lifecycles, and the Tile spec has no stated shape

**Severity: high.**

### The two units

**Unit A — Story "Dashboard Tiles" (FR-35, `ui/` + `adapters/echarts`).**
Needs a live chart in a container that resizes: the addendum records that "ECharts does not observe its container either, so a tile size change must call `resize()`", plus a mandatory long-label strategy and `barMaxWidth`. Unit A's port is imperative and container-bound: `mount(el, spec)`, `update(spec)`, `resize()`, `dispose()`.

**Unit B — Story "View document export" (FR-37, the deferred adapter).**
Needs an SVG **string** to inline into a static single-file HTML document and a print-to-PDF path, with no live container and no lifecycle. Unit B's port is `toSVG(spec) => string`.

One port name, two contracts that share no method. The spine's Deferred section asserts *"The port it sits behind is defined"* for FR-37 — but the ports table and the structural seed list exactly six ports, and none of them is a document writer. The port the spine says is defined does not appear in the spine.

### The second break: who builds the spec

Nothing states that the Tile spec is renderer-neutral. Unit A, sitting in `ui/` and importing nothing from `adapters/` (AD-1 permits this only for *imports*; a plain option object is data, not an import), can legitimately build an **ECharts option object** in `ui/` and hand it to the adapter. FR-35 then says that object "is stored in the Recipe."

Three requirements break at once if that happens:

- **FR-27** puts "the Recipe format specification" into the prompt block, so a language model authoring a Recipe would have to emit ECharts option objects — against NFR-9's premise that "a fixed set of configured Steps is a data structure a model emits and a validator checks."
- **AD-11** must refuse unrecognised fields in that object, which means the validator has to know ECharts' option schema.
- **AD-12**'s format version now encodes a third-party library's option schema, so an ECharts upgrade is a Recipe format break.

FR-35 states the actual contract the spine failed to record: *"Every Tile is configured through the same small form: grouping column, measured column, aggregation, row limit."* Five fields. That is the spec, and nothing says so where a developer would read it.

### FRs and ADs involved

FR-27, FR-28, FR-34, FR-35, FR-37; AD-1, AD-11, AD-12, AD-15; the ports convention table and the Deferred section.

### The AD that closes it

**AD-31 — The Tile spec is renderer-neutral, and `ChartRenderer` states both of its lifecycles.**
A Tile in the Recipe is exactly `{ kind, title, groupColumn, measureColumn, aggregation, limit, size }` and contains no field belonging to any rendering library; the ECharts option object is constructed **only inside `adapters/echarts`**, from that spec plus the Table. `ChartRenderer` declares two operations with stated semantics — a live `mount/update/resize/dispose` lifecycle for FR-35, and a pure `toSVG(spec, table) => string` for FR-37 that must produce vector output with real text and must fail loudly rather than degrade to raster (the addendum records that `getDataURL({type:'svg'})` returns a PNG silently in canvas mode, which is why the SVG-only registration is a correctness rule). The FR-37 document writer is named as its own port, `DocumentWriter`, and added to the ports table so the Deferred section's claim becomes true.

---

## A-14 — There is no clock, and the compliance artifact needs a date

**Severity: medium.**

### The two units

AD-4 forbids a clock in `core/`. AD-2 forbids browser APIs there. The ports list contains no `Clock`. FR-37 requires the exported document to name "the Recipe that produced it, **the date**, and the Sources by name — enough for a Boxchecker to file it without asking anyone what it is", and FR-34's run status travels into that document.

**Unit A — Story "View document export".**
The document writer stamps `new Date()` at write time. The document says **export date**.

**Unit B — Story "Run status" (FR-34).**
The run status carries the timestamp of the execution it summarises, taken in `ui/` when the run was started. The document says **run date**.

### The break

Both are "the date" and they are different dates whenever the user exports on a later day than they ran — which is the normal case for UJ-1, where the export goes into a quarterly compliance file. §2 states the Boxchecker's need as "evidence that something was measured, **on a stated date**, from stated inputs." A document whose date is the moment somebody pressed Export is not that evidence, and nothing on the page distinguishes the two.

Structurally: AD-13's diagnostic shape has no time field and AD-4 forbids the core from obtaining one, so the run status — which AD-13 says "adds nothing of its own" — cannot carry a timestamp at all under the spine as written. The one artifact in the product with an external audience is the one the architecture cannot date.

### FRs and ADs involved

FR-34, FR-37; AD-2, AD-4, AD-13; the ports convention table.

### The AD that closes it

**AD-32 — Time enters through a port, and a run is stamped once.**
A `Clock` port is added, injected by `app/`, and is the only source of time in the product; `core/` calls it through the port, which preserves AD-2 and AD-4's intent (no ambient clock, no untestable Step) without leaving the core unable to date a run. The run status carries a single `startedAt` stamped when execution begins. FR-37's document prints **both** dates, labelled: the run date and the export date. In live mode, where there is no run event, `startedAt` is the time of the most recent Step execution and the document says so rather than implying a run that never happened.

---

## Smaller pairs, recorded without full treatment

- **`Object.freeze` granularity (AD-6).** "Rows are frozen at the boundary where they are produced" admits freezing the array or freezing each row object. `Object.freeze(array)` leaves the elements extensible, so Vue's reactivity proxies every row — R2's measured 437–479 MB and 11–13× read penalty, back in full, with no rule violated. State that **each row object** is frozen, individually.
- **Re-reading a Source after a restore (FR-2, FR-25).** AD-3 has `ui/` unwrap the `File` and pass bytes inward. After a session restore there is no `File`. Either the bytes are persisted — doubling both heap and IndexedDB against R9's 8.9 MB / ~94 MB figures — or FR-2's "can be changed, which re-reads the file" and FR-7's "changed without reloading the file" are silently unavailable after a restore, with no requirement admitting that. Name the owner of the bytes and the post-restore behaviour of every re-parse affordance.
- **What a Package embeds (FR-24, Deferred).** The ER diagram has `PACKAGE ||--o{ SOURCE_DATA`. Bytes or parsed tables? Bytes make FR-2/FR-3/FR-7 work after import and make the import re-run detection, which may disagree with the Author's settings (A-5 again). Parsed tables make import deterministic and make the parse-settings affordances dead. Two implementers, two containers, both compliant with the Deferred note's "SessionStore and TableWriter already bound the shapes it must fit between" — which bounds nothing here.
- **AD-15's worker ownership versus FR-37.** AD-15 says the worker is "owned inside the `TableWriter` adapter" and that "nothing else" uses one. A developer placing the FR-37 document writer inside `TableWriter` — defensible, since it writes a file and the capability map puts all export under that port — can reuse the worker that the adapter already owns, violating AD-15's exclusivity while never leaving the adapter AD-15 names. A developer placing it in a separate `DocumentWriter` must inline a 500k-row table and SVG on the main thread with no worker and no chunking rule, since AD-9's scheduler governs Steps.
- **AD-11's "unrecognised field is refused" versus optional fields.** The rule covers unrecognised fields and is silent on *missing* ones. Every optional field the format grows — FR-14's null-key setting, FR-14's duplicate-audit flag, FR-23's saved mappings, FR-21's per-column optional marker — is a place where one implementer defaults and another refuses, and FR-28's model-authored Recipes will omit all of them. State the default for every optional field in the format spec, since FR-27 ships that spec to a model.

---

## What resisted, and why

Four ADs held under every attack tried, and the reason is the same in all four: **each is checkable by a machine rather than by an opinion.**

- **AD-1 (dependency direction)** is a lint rule over import paths. I could not construct two compliant units whose imports differ in a way that matters, because the rule quantifies over every import and admits no judgement call.
- **AD-2 (core is framework- and browser-free)** is a grep over `core/`, and the forbidden list is enumerated rather than described. The only edge I found — `Date` and ambient time — is not a browser API, which is exactly why A-9 and A-14 slipped through it; the rule itself is sound and its scope is simply narrower than its intent.
- **AD-17 (nothing is fetched at runtime)** and **AD-18 (one file, asserted)** hold together as a pair with a build-time and a runtime assertion behind them: one entry in `dist/`, zero network requests from a `file://` Playwright run. AD-18 is the strongest AD in the document because it converts a discipline into a failing pipeline, and it is the model the weaker ADs should be rewritten against.
- **AD-14's "no UUIDs"** and the readable-id shape resisted on their own terms. What broke around it (A-11) is the minting and binding rules, not the shape.

Two further observations, offered as pattern rather than as findings:

**The spine is strong exactly where research measured something and weak exactly where it did not.** Every AD carrying a number — AD-6's 437–479 MB, AD-9's 3.0/2 ms, AD-15's 109.4/132 ms, AD-16's 180 s — is a rule an implementer cannot misread, because the number pins the intent. Every AD without one is where the pairs above live. AD-5 admits this in its own text ("The per-boundary conversion cost this avoids is unmeasured") and is the source or accomplice of five findings.

**The unfilled gap is data shape, not structure.** The layering, the build path and the platform constraints are decided to a level a developer can execute. The Table's cell domain, the date representation, the unparsed carrier, the row-order guarantee, the diagnostic lifecycle and the Recipe's id binding are all named as concepts and specified nowhere — and every one of them is a shared shape that two units must agree on without talking to each other. That is the definition of what a spine is for, and it is the half that is missing.

**Empty-result check.** The instruction to treat an empty result as suspicious did not apply: fourteen pairs is more than the review expected to find, and the concentration in one category (shared data shapes, nine of fourteen) is itself the finding — this document decided the paradigm and the platform, and has not yet decided the data.
