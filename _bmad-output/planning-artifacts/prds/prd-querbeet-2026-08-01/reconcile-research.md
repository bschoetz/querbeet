# Input reconciliation: the research corpus against the PRD

**Inputs:** `research-plan.md` (R1–R9 verdict blocks), the eight `research/*/research.md` reports read
in full, and both spikes (`spikes/editor-vueflow-2026-08-01/`, `spikes/recipe-llm-authorship-2026-08-01/`).
**Targets:** `prd.md`, `addendum.md` (both in this directory).
**Date:** 2026-08-01

A finding counts as a gap when it carries a product consequence and appears in **neither** target
document. The division of labour applied throughout: the PRD states capabilities, user-visible
behaviour and what a requirement can honestly promise; the addendum holds technology decisions and
build consequences.

**Excluded by instruction, not by oversight:** R8 (view document export) has not run, and R9 is
answered only at its IndexedDB gate — the Package container, eviction behaviour and the 500k-row
write time are open and already named. Where a finding below touches those areas it is because the
finding itself is settled and its consequence is not recorded (for example the synchronous-compressor
constraint that binds FR-24 regardless of which container is chosen).

Twenty-nine items follow, in four tiers. Tier 1 changes what a requirement promises; tier 2 is
build-level; tier 3 is stale or mis-stated material already in the targets; tier 4 is what the two
spikes leave outstanding.

---

## Tier 1 — PRD-level gaps (user-visible, or they change what an FR can honestly promise)

### 1.1 The comparison-value rule stops at numbers, and the same hole is one column type over

**Finding (R5, open question 1; the FR-28 spike supplies the evidence).** R5 decided that a numeric
comparison value is a JSON number in canonical machine form, and FR-15 and FR-28 now say so. R5's own
report then names the residual: `{"op": "gt", "value": "2025-12-31"}` is the next thing a model will
guess at, and FR-9 detects a date **locale** per column too, so `"31.12.2025"` and `"2025-12-31"` and
a locale-aware parse give the same three-readings split that four-strings-to-one-number produced for
`Betrag`. A decision covering only numbers leaves the identical defect on date columns.

This is not hypothetical for querbeet: **UJ-1's climax is a filter on "patch state older than 30
days"** — a date comparison in the anchor use case.

R5 raises a second undecided question in the same place: **must a `value`'s type agree with the
column's confirmed type at load time?** Is a JSON number against a text-typed column an error, a
coercion, or accepted? The measured precedent is bad — MongoDB type-brackets string against number
and returns a **silent empty result with no error**, which is exactly querbeet's stated
characteristic failure mode.

**Belongs in:** PRD FR-15 (what the Recipe holds for a date comparison) and FR-28 (what the ingest
validator accepts, coerces and refuses, and whether it cross-checks the value's type against the
column's confirmed type). **Level: PRD.**

### 1.2 Two fields of the confirmed type record are user decisions with no requirement behind them

**Finding (R5, D3).** The addendum records the per-column type record as
`{type, decimalChar, groupChar, dateFormat, missingValues, keepOriginal}`, and says this "is what
FR-9's confirmation actually persists". Two of those six fields correspond to nothing in FR-9:

- **`missingValues`** — which literal strings in this column mean "no value" (`""`, `-`, `N/A`,
  `k.A.`). This is not cosmetic: it changes the null share reported in the Column Profile (FR-26),
  which rows form the null group in an Aggregate (FR-18), which key values are null on a Join
  (FR-14, where null handling is an explicit setting), and what "is empty" matches (FR-15).
- **`keepOriginal`** — whether the raw string survives beside the parsed value, which is what makes
  FR-9's "values that do not parse are marked and remain inspectable" implementable at all.

FR-9's consequence list covers type, locale, hit rate, ambiguity and confirmation, and never asks the
user for either of these. As written, the addendum promises persistence of a decision the PRD never
collects.

**Belongs in:** PRD FR-9 (consequences), and the FR-20 Recipe-contents list. **Level: PRD.**

### 1.3 Persisting the session is a wait the user experiences, and in Firefox it lands on the freeze threshold

**Finding (R9, measured; R4/D3 confirms it as a worker candidate).** FR-25 stores the Recipe **and
the loaded source data** every session. Measured at 100,000 × 20: `put` **304.6 ms (Chromium) /
731.0 ms (Firefox)**, `get` **194.9 / 825.0 ms**. Linear projection to half a million rows — an
extrapolation from one point, stated as such — gives ~1.5 s (Chromium) and **~3.7 s (Firefox), which
lands on the ~3.3 s tab-freeze threshold R3 established**. IndexedDB is available inside workers, so
the path can move off-thread wholesale.

FR-25 says nothing about *when* the write happens (on every change? on close? on demand?), what the
user sees while it does, or that it can block. FR-36 has the corresponding clause for exports — "an
export that takes noticeably long shows progress and does not freeze the interface" — and FR-25 has
no counterpart. The measured numbers make one necessary.

**Belongs in:** PRD FR-25 (a consequence about when persistence runs and that it must not block the
interface), and the addendum's §2 worker paragraph, which currently says "both exports belong in a
worker, and nothing else does" while R9 added a third candidate after D3 was scoped.
**Level: PRD, with an addendum follow-on.**

### 1.4 Editing a Step near the head of a long graph is a second-scale wait, and R4 named the number to design against

**Finding (R4/D4).** A 30-Step graph over half a million rows recomputes fully in **496.4 ms
(Chromium) / 1,394 ms (Firefox)**. Edit cost tracks tail length almost linearly: **editing the last
Step costs 24.1 / 54 ms, editing the first Step is a full recompute by definition at 578.6 /
1,156 ms — a factor of 20 to 26.** R4 states explicitly: *"that is the number to design the progress
affordance against."*

FR-19 promises that changing a Step's configuration updates its Preview and every downstream Preview.
NFR-3 promises that step reconfiguration stays responsive. Neither acknowledges that one class of
edit — the one at the head of the graph, which is where a user fixes a source-level mistake — costs
over a second on the secondary engine and cannot be memoized away.

**Belongs in:** PRD FR-19 (a consequence: a recompute that takes noticeably long shows progress) and
NFR-3. The memoization decision itself (hold all 30 intermediates, 180 MB; cache in the `shallowRef`
registry, never in the graph model) is **absent from the addendum entirely** and belongs in §2.
**Level: PRD, with a genuine addendum gap alongside it.**

### 1.5 XLSX export has a hard cell limit, and FR-7 makes it easy to exceed

**Finding (R3).** Excel's "we found a problem with some content" repair prompt has two confirmed
causes, and one of them is a **cell string exceeding 32,767 characters**. The failure presents as a
repair dialog on open, not as an export error.

FR-7 offers "one JSON value per cell" as one of three array strategies for nested JSON — a strategy
whose whole point is that a cell holds a serialized structure. A moderately deep array in a report
export clears 32,767 characters without difficulty. FR-36 then promises XLSX that "opens cleanly in
Excel". The two requirements are in tension and nothing records it.

**Belongs in:** PRD FR-36 (a consequence: values above the format's cell limit are truncated or
refused with a named reason, never written silently), cross-referenced from FR-7.
**Level: PRD.**

### 1.6 FR-37's vector-chart guarantee is one-engine evidence, and one printing hazard is not stated

**Finding (R7).** FR-37 asserts, with "Measured:", that charts arrive as vector graphics with real
selectable axis labels. The measurement is sound — three SVG artefacts printed 95–131 words of real
text carrying 21–35 of the app's own formatted axis labels and **zero** raster images, against 12
words and six images each for the canvas artefacts. But R7 names its own scope: **printing was
measured in Chromium only, because Playwright exposes no PDF output for Firefox**, and R7 flags this
as "one-engine evidence against a two-engine claim" — pointedly, because the folklore being refuted
was a Firefox bug. NFR-4 keeps Firefox a target that is *measured during the first builds*.

Second, unrecorded anywhere: **a fill that comes from a CSS background disappears from the printed
document when the user's "print background graphics" setting is off**, and the printing API's own
default is off — R7 had to pass `printBackground: true` explicitly. This is the actual mechanism
behind the canvas-prints-blank folklore, and R7 generalises it beyond charts to **surrounding tile
chrome**. It is a user-visible defect in the Boxchecker's copy that the page cannot prevent from the
outside; it can only be avoided by keeping fills in attributes or inline styles.

**Belongs in:** PRD FR-37 (qualify the measured claim to Chromium; Firefox is verified during the
first builds like the rest of NFR-4) and addendum §2 (the fill rule, which is currently missing from
the chart-renderer paragraph). **Level: PRD for the engine scope, addendum for the fill rule.**

### 1.7 Nothing anywhere states how large a Pipeline may be

**Finding (R4/D4, the Editor spike, R6).** NFR-3 quantifies scale in rows only. The graph has a
target too, and the evidence has a ceiling:

- R6's brief and the PRD's own §6.3 reasoning assume **5–30 Steps**; R6 measured the canvas at 3–4
  nodes.
- The Editor spike carried **six to seven Steps** and says plainly: *"Nothing here says what a
  fifty-Step Recipe costs to render or to re-project."*
- R4/D4 then measured at 30: cold rebuild **50.1 ms (Chromium) / 67 ms (Firefox)**, 30 intermediates
  held alive cost **180 MB**, and **not one frame exceeded 50 ms across 2,800 window swaps** with a
  virtualized table beside the canvas. R4 also records that **30 was tested as the PRD's stated
  ceiling, not as a stress test** — nothing establishes where a cliff sits above it, and a graph with
  several joins costs measurably more than the one-join graph measured, because the joins are the
  whole price (join 85.6 / 179 ms and concat 44.9 / 94 ms against 22–26 / 90–98 ms for a derive).

A Recipe is a portable artifact that a Consumer receives; "how big may it get" is a product boundary,
not an implementation detail. Today the PRD promises responsiveness at any graph size by omission.

**Belongs in:** PRD NFR-3 (state the graph target alongside the row target) or FR-12.
**Level: PRD.**

### 1.8 The load path is the one interaction the user always waits on, and its cost has never been measured in a browser

**Finding (R3, R4).** FR-8 promises the Preview "renders within an interaction-responsive time
regardless of Source size". Every parsing figure behind that promise is **Node, not browser**:
PapaParse at ~1.13M rows/s untyped and ~454k rows/s typed, extrapolating to roughly 0.1–0.25 s per
100k rows. R3 states it: *"No browser-side timing or memory figure for PapaParse exists at any
scale."*

That matters because the one case where a Node figure *was* re-measured in a browser got
dramatically worse: R3 measured xlsx export at ~3.3 s in Node; R4 re-measured **4,943.8 ms (Chromium)
/ 5,805 ms (Firefox)** from `file://` at the same 100k rows, and R3's projection to half a million
was short by about ten seconds. Parsing plus type detection plus `aq.from()` is the *first* thing a
user does and the one operation that runs on every Source, every session — and its browser cost is an
extrapolation from a different runtime.

Type detection compounds it: R5 established that the candidate-enumeration loop is querbeet's own
code and must be budgeted as **rows × columns × candidates tried**, with the field's only datapoint
being Luxon at 356 ms per 100,000 values *per candidate pattern*.

**Belongs in:** PRD NFR-3 or FR-8 as an honest qualification, and as an item under Open Questions —
the import path deserves the same first-build measurement NFR-4 gives Firefox.
**Level: PRD.**

### 1.9 The Probe Query is the one half of the LLM protocol that nothing has exercised

**Finding (the FR-28 spike).** PRD Open Question 3 records one caveat as open work — the
paste-the-error-back correction loop, never run because all five independent authorings passed on the
first round. The spike names a **second** unexercised piece, and it is larger:

- **Nobody ever asked a Probe Query.** All five runs resolved the one real ambiguity (`gt` versus
  `gte`) by assuming and saying so. *"It means the Probe Query section of the block is written and
  unexercised. A question that cannot be answered by assumption would be needed to reach it."*
- The format itself is a proposal: section 4 of `block-template.txt` ends with the Probe Query as *a
  Recipe plus `"purpose": "probe"`*, honouring FR-29's "same Step vocabulary, no second query
  language" — but **the validator ignores unknown top-level fields, so such a document loads today
  and nothing enforces or acts on the marker.** The spike labels it *"a proposal, not a measured
  design."*

The Probe Query is the mechanism UJ-3's climax rests on and the thing that distinguishes querbeet's
LLM story from "paste your schema into a chatbot". Open Question 3 currently reads as though only the
correction loop is outstanding.

**Belongs in:** PRD Open Question 3 (extend the caveat) and FR-29. **Level: PRD.**

### 1.10 `lookup()` — the row-count-safe join — silently keeps one row per duplicate key

**Finding (R1, confirmed against 8.0.3).** Addendum §3 says: *"Duplicate keys produce a Cartesian
product. `lookup()` is the row-count-safe alternative."* The half it omits is the one that matters:
`lookup()` is row-count-safe **because it keeps the last observed instance per key** and discards the
others. Substituting it for a join to avoid the Cartesian product therefore trades a visible
row-count explosion for a silent, unreported row loss — the same failure family FR-14's row-count
warning and duplicate audit exist to make visible, arriving through the fix rather than the bug.

**Belongs in:** addendum §3 (complete the sentence) and PRD FR-14, if `lookup()` is ever offered as a
Step behaviour — a Join that silently keeps one match per key is a different operation from a join
and must be named as one. **Level: addendum, with a PRD consequence if it becomes a user-facing
option.**

### 1.11 Two Recipe-format ambiguities the spike found and left open, both user-visible

**Finding (the FR-28 spike, "Two decisions the column check forced").**

- **Union `mappings` does not say which input a mapping applies to.**
  `{"target": "KundenNr", "from": "Kunden-Nr"}` identifies the source column by name only. That is
  unambiguous only as long as no two inputs use the same column name for different things — and FR-13
  exists precisely to stack files whose columns disagree. *"Worth knowing before Union config is
  finalized."*
- **A Join whose two inputs share a column name is legal, and what happens to the duplicate is
  undecided.** The spike's schema propagation emits the name once and reports the collision as a
  *note*, not an error, deliberately refusing to invent a suffix convention (`Name_rechts`) that
  would bind the transformation engine to a spike's guess.

FR-13 and FR-14 are silent on both. FR-16 refuses a rename onto an existing name — a join that
produces one implicitly is the same problem arriving by another door.

**Belongs in:** PRD FR-13 and FR-14. **Level: PRD.**

### 1.12 The ambiguity report's two numbers are stated; its wording and its decisive signals are not

**Partially landed — recorded as a qualification, not a gap.** FR-9 carries the full-column scan, the
sampling contrast and the explicit "nothing in the column settles this" state, which is the load-
bearing half. What R5 additionally establishes and neither document carries:

- **Hit rate and decisive-evidence count are different numbers and both are needed.** FR-9's example
  wording — "842 of 900 values readable" — is a hit rate, and *"a column can have a 100 % hit rate
  under both readings. That is the case the report must name."* R1 measured the same blind spot from
  the other side: comparing `op.count()` against `op.valid()` catches values that were *dropped* but
  is blind to values that were **mis-scaled** — 7.5 looks perfectly valid where 7,500 was meant.
- **Which signals are decisive is settled and should not be re-derived by whoever writes the UX:**
  more than three digits after a separator; both `.` and `,` in one value; a digit group of other
  than three; a day value above 12; a first-position value above 31. Merely probabilistic, and never
  resolving alone: column-name hints (`Betrag`, `Datum`) and agreement with other columns in the same
  file — because FR-9 permits different locales *within* one Source.
- R5 names the wording and scoring as **design work with no prior art**, and warns specifically
  against a confidence percentage when the evidence count is zero.

**Belongs in:** the UX spec, referenced from FR-9. Worth one line in the addendum so the signal list
is not rediscovered. **Level: PRD-adjacent (UX spec).**

---

## Tier 2 — Addendum-level gaps (build consequences, in neither document)

### 2.1 PapaParse's streaming path corrupts umlauts at chunk boundaries

**R3.** Open defect #1132: streaming mode has chunk-boundary UTF-8 corruption **that specifically
hits umlauts**, plus a cached line-ending guess, a header-dedupe bug on resume, and no backpressure
under `pause()`. Separately #1122: `worker: true` returns malformed results in Vite production
builds. The safe shape follows from R3's own encoding decision — decode the bytes yourself with
`TextDecoder` and hand PapaParse a **string** — but nothing in the addendum forbids the streaming or
worker paths, and both are the obvious reach for a 100k-row file. This is the same silent-corruption
family the PRD's §4 theme paragraph is built around.

Related, same source: **PapaParse does not detect the header row at all** (#1121 is an acknowledged
open feature request; `header: true` only means "row 1 is field names"). FR-3 requires header-row
proposal and correction, so that detector is querbeet's own code — the addendum's CSV row implies
otherwise. And on a genuine single-column file the delimiter guesser does not guess wrong: it returns
an explicit `UndetectableDelimiter` error, which is the signal FR-3's "says so explicitly and asks"
clause should be wired to.

### 2.2 Three ECharts consequences and the CSS-background rule are missing from §2

**R7, "Adopting ECharts — what the measurements require."** The addendum carries the SVG-only rule,
`resize()`, the long-label strategy and `barMaxWidth`. Four of the seven are absent:

- **Import through `echarts/core`, never the package root** — the tree-shaken figure (592,693 B total
  / 206,286 B gzip, of which ECharts' own share is 178.3 KB gzip) only holds on that path; the
  whole-library figure overstates the real cost by ~52 %.
- **Never pass `width`/`height` to `echarts.init`** — it pins the instance and turns `resize()` into
  a no-op, which silently defeats the tile-resize rule the addendum *does* carry.
- **Do not enable `sampling`** — unnecessary at this scale (500,000 raw line points render in
  315.7 ms Chromium / 197 ms Firefox with decimation configured on nobody), and its `lttb` mode
  renders null-gapped lines "sparse and disordered", closed upstream as "not planned". The tripwire
  confirmed null gaps become three separate `M` commands rather than an interpolation, so the ban
  costs nothing.
- **Fills in attributes or inline styles, never CSS backgrounds** — see 1.6.

### 2.3 The xlsx worker has two contracts §2 does not state

**R4/D3.** The addendum sends both exports to a worker. Two measured facts decide *how*:

- **A `write-excel-file` sheet cannot be posted across a thread boundary.** Its cell `type` field
  holds the native `Number` constructor, so `postMessage` throws `DataCloneError`. The worker must
  receive **plain rows** and build the sheet itself.
- **`await writeXlsxFile(sheet)` returns the builder and silently does nothing.** The call is
  `.toBlob()`. This also resolves R3's `filePath` finding: the option was removed in 4.0, and the
  README documents the removal at the top while still contradicting itself with a v3 example further
  down.

Also worth one line: v4 **no longer bolds the header row by default and no longer applies a default
width to date columns** — both must now be set explicitly, and the openpyxl verification of FR-36's
"opens cleanly" was run against a build that set them.

### 2.4 Parquet: the GZIP codec writes an unreadable file, and every non-Snappy codec must be synchronous

**R4/D3, R3.** The addendum's Parquet row says "Snappy default" and stops. Measured:

- **`codec: 'GZIP'` writes a file no standard reader accepts.** hyparquet-writer 0.16.3 registers only
  SNAPPY, falls back to raw bytes, and still labels the pages GZIP; **pyarrow 25 refuses it**
  (`GZipCodec failed: unknown compression method`). Passing `compressors: { GZIP: fflate.gzipSync }`
  fixes it and is **2.4× smaller than SNAPPY**. Out of the box, only SNAPPY is safe — which qualifies
  R3's "read correctly across three codecs" and directly conditions FR-36's "standard readers accept
  it".
- **Any codec other than the bundled Snappy must be supplied as a *synchronous* function**, so the
  browser-native `CompressionStream` cannot be used at all. This constrains FR-24's Package container
  before its research runs: whatever the container turns out to be, `fflate`'s sync API is already
  load-bearing, and R9's own sub-question notes the same asymmetry.
- Interop nuance for FR-36: the same timestamp column returns as `timestamp[ms, tz=UTC]` from pyarrow
  and as a naive `datetime[ms]` from Polars.

### 2.5 The memory budget is Chromium-only

**R4.** Firefox exposes no `performance.memory` API, so **every heap figure in the corpus is
Chromium's**: 80.2 MB per 100k × 20 Arquero table, the 447 MB realistic half-million-row graph, the
552.6 MB five-source ladder, the 180 MB of 30 held intermediates. Firefox is the engine that is
1.5–2× slower on Arquero work and **8× slower on full row materialization** (`objects()` over 100k:
97 ms against 12.5 ms). The number the whole scale target is designed against is unverified on the
secondary engine, and NFR-4 says Firefox is measured during the first builds — this is one of the
things to measure.

### 2.6 The Delivery row's byte figure predates three-quarters of the stack

**R2, R6, R7.** Addendum §1 records the built artifact as **280,519 B**. That measurement is the R2
deepening's probe: Vue plus Arquero. It predates Vue Flow (R6's probe alone built to 224,382 B; the
Editor spike's working build is 247,987 B), ECharts (R7's ECharts+Vue probe: **592,693 B / 206,286 B
gzip**), Tailwind, and the export worker (62,612 B with hyparquet-writer and fflate inlined). The
figure is quoted as though it described querbeet; it describes an early probe.

Four further build rules from R2 that §2 does not carry:

- **Set `build.target` explicitly.** Vite 8 defaults to `baseline-widely-available` (chrome111 /
  firefox114) — below NFR-4's floor. Currently harmless, but it should be a decision rather than a
  default.
- **Commit the lockfile and the built `querbeet.html`, and record the Node and Vite versions of a
  known-good build.** The toolchain is now a dependency with a five-year horizon.
- **`vite-plugin-singlefile` branches at runtime on `viteMajor >= 8`**, so a future Vite 9 silently
  takes the Vite-8 path; it also writes into `build.rollupOptions`, which Vite 8 already documents as
  deprecated in favour of `build.rolldownOptions`. That is the likely breakage point at the next
  major.
- **`new Worker` is a poor gate signal.** The *correct* artefact contains two occurrences plus a
  `createObjectURL`, because inlining requires blob-URL construction. Gate on the `dist/` file count
  and on opening the artefact from a real `file://` URL in both engines. (The PRD mentions this in
  closed Open Question 7; the addendum, which owns the build rules, does not.)

### 2.7 The `formatToParts` technique has four pitfalls, and one of them silently yields no separator

**R5/D2.** The addendum's number-parsing row says the separators are read from
`Intl.NumberFormat.formatToParts`. The mechanics decide whether that works:

1. **The probe value matters.** `format(1000)` yields `"1000"` — no group part at all — in `es-ES`
   and `pl-PL`. The probe needs **≥ 5 integer digits *and* a fraction**; React Spectrum uses
   `1111.11`.
2. **`fr-FR`'s group separator is U+202F** (narrow no-break space), so `replace(/ /g,'')` misses it,
   and the CLDR/ICU migration from U+00A0 to U+202F **lands at different ICU versions per engine** —
   the parser must accept U+0020, U+00A0 and U+202F as **one character class**. (Whether Chromium and
   Firefox agree byte-for-byte is one of R5's six owed local measurements; only Node v26.5.0 /
   ICU 78.3 was measured.)
3. **Non-`latn` numbering systems need a digit transliteration map**, obtainable from a second format
   pass.
4. **There is no accessor** — it is probe-and-read; nothing exposes "give me the separators".

### 2.8 The type record borrows a shape with two documented defects

**R5/D3.** The record in the addendum's "Type record" row is modelled on Frictionless Table Schema,
which carries two defects that must be fixed rather than inherited:

- **`groupChar` has no spec default** — it must be given an explicit default or made required, and
  it is precisely the field whose absence causes a silent mis-parse.
- The reference implementation reproduces a **silent `decimalChar` mis-parse** (#1005): *a
  declared-but-wrong locale is as dangerous as an inferred one*, which means FR-9's confirmation gate
  protects against inference but not against a bad confirmation inherited through a Recipe.
- **Never emit `format: "any"`** — the spec itself names it an anti-pattern, and its own exemplar
  (`dateutil.parser.parse`) defaults `dayfirst=False`, reading `03/04/2025` as 3 April with no
  ambiguity report.

### 2.9 Five Editor rules the spike produced that §7 does not carry

**Editor spike, "Rules this spike adds" and the keyboard check.** §7 records design B, the cycle
guard, the anchor result and the contention numbers. These five are measured, cost the spike real
debugging, and appear nowhere:

1. **Wire `isValidConnection` on the Handle, never as a `<VueFlow>` prop.** The store-level prop is
   also applied by `setEdges` to *every* edge on *every* projection; a cycle guard there evaluates
   already-existing edges — for which a forward walk from target trivially reaches source — and
   **silently drops the entire graph**.
2. **Pass `select` changes back through `applyNodeChanges` / `applyEdgeChanges`.** With
   `applyDefault: false`, `addSelectedNodes` takes a branch that emits changes and mutates nothing,
   so **multi-selection silently did nothing — by keyboard *and* by pointer, in both engines**. Found
   by accident, fixed, and it is the one place design B hands anything back to the library.
3. **Call `useVueFlow()` only in `setup`.** Anywhere else it resolves through `inject()`, fails
   silently, and returns a **second, empty store** — and a production build strips the Vue warning
   that would have said so. This cost the spike its first Q3 run.
4. **Never place a Handle inside a fixed-height scrolling container.** The `ResizeObserver` that keeps
   anchors correct watches the node's *box*, not its contents; a handle that moves while the box does
   not would not fire it. `updateNodeInternals` is the escape hatch and is used nowhere.
5. **The projection self-heals only when the projection changes.** An injected phantom edge survived
   a rename and vanished on the next structural change. Self-healing is real and **is not a
   substitute for the guard**.

Plus one dependency rule: **vendor `@vue-flow/background`** (1 year 9 months without a release —
outside the 12-month freshness gate) rather than depending on it. `@vue-flow/controls` and
`@vue-flow/minimap` are inside the gate.

### 2.10 A second silent path past FR-13's "never dropped silently"

**R1.** Addendum §3 records that `concat` silently drops columns unique to incoming tables. The same
verb has a second escape: `if (trows === nrows) return table` **returns the receiver unwidened when
every other table is empty**. A Union whose other inputs happen to be empty this month — an entirely
ordinary monthly-export case — therefore produces the receiver's columns rather than the padded
union, without the padding workaround ever being exercised.

Three smaller Arquero rules from the same report, none recorded: **`aq.from(objects)` never coerces
types at all** (which is what makes the parse-elsewhere strategy airtight); **`fromJSON` calls the
parse function on every value including null**, so JSON-side parsers must be null-safe, whereas the
CSV path nulls empty fields *before* parsing and skips the parser; and **Arquero has no row-object
pooling** — every row read allocates a fresh object, so value-only paths must use `values()` /
`array()`, which allocate nothing. The last is the primitive FR-33's search already relies on.

---

## Tier 3 — Stale or mis-stated in the targets

### 3.1 PRD Open Question 5 is answered and should be closed

**R4/D3 settled R3's leftover.** *"`read-excel-file` 9.3.5 never creates a worker."*
`parseSpreadsheetContents.js` hardcodes `var CAN_USE_WORKER = false`, the entire `createWorkerFunction`
call site is commented out, and the README's retraction is the accurate half. The
`read-excel-file/web-worker` fallback is not needed. Open Question 5 still asks the question.

One caveat travels with the closure and belongs in the addendum's XLSX row: R4 classes this as
volatile **on a minor version** — `CAN_USE_WORKER = false` is one line from being flipped back on —
so 9.3.5 must be pinned, not floated.

### 3.2 PRD Open Question 6 points at the wrong FR

It reads *"Until it passes, FR-35's 'opens cleanly in Excel' is asserted, not verified."* FR-35 is the
Dashboard tiles requirement. The Excel claim is **FR-36**.

### 3.3 §0 promises an Open Question that §8 does not contain

PRD §0 states: *"Two questions are still open at the time of writing — how the view document of FR-37
is produced, and what container FR-24's Package uses — and both are named in §8."* §8 contains the
Package container (item 8). It contains **no item for the FR-37 view document / R8**. R8 not having
run is known and excluded from this pass as a gap in its own right — the defect here is that the PRD
says the question is listed where it is not.

### 3.4 The addendum's worker paragraph is one candidate behind

§2 states *"Both exports belong in a worker, and nothing else does."* That was true when D3 was
scoped. R9 then added IndexedDB persistence as a third long operation whose Firefox projection lands
on the freeze threshold (see 1.3), and R4's own text records it as an open worker question rather
than a settled no.

---

## Tier 4 — Spike outstanding work the PRD should acknowledge rather than assume

Measured as working, and safe to rely on: variable-height anchors (0 px Chromium / 0.02 px Firefox
across five height changes); the cycle guard on the pointer path, the programmatic path and the
Recipe loader; byte-identical Recipe round trip at 1,309 B for six Steps; nine of eleven Editor
interactions keyboard-reachable; thirteen named rejection classes; five independent cold LLM
authorings passing on the first round with 33 of 33 named requirements met.

Never exercised, and each one currently reads as satisfied:

### 4.1 Deliberate pan and zoom have no keyboard path

**Keyboard check, gap 2.** The viewport was **byte-identical after ArrowRight, ArrowDown, `+`, `-`
and PageDown** in both engines. The urgent half was fixed — focus now pulls the canvas after it via a
`focusin` handler that pans by the shortfall, measured on a Step parked at 3400,2200 — but *moving
the view without moving the focus* has no keyboard path at all. FR-12 promises the graph is
"navigable and editable by keyboard"; addendum §7 records only **connecting** as the outstanding
NFR-7 gap. The spike itself flags that it is worth deciding whether deliberate pan/zoom is needed at
all now that focus drags the view along — that decision has not been recorded either way.

### 4.2 Whether a focused Step is *visibly* focused was not measured

Same source, "Two things the check does not cover". The default Vue Flow stylesheet is the only thing
styling focus, **and the spike overrode part of it**. Screen readers are the other uncovered item and
are legitimately out of scope by NFR-7; focus visibility is not — it is the affordance the nine
working keyboard interactions depend on.

### 4.3 A Recipe that arrives without positions needs a fallback layout

**FR-28 spike, gap 3.** A model under length pressure omits cosmetic fields; `s3-no-ui` stacked all
five Steps at 0,0. Closed in the spike by `proposed/layout.js` (~30 lines: column = longest path from
a Source, row = order of first appearance) which fires **only when every node sits at the origin**, so
a Recipe that positions its Steps and a canvas the user has arranged are never touched. Neither
document records that a pasted Recipe may arrive without a layout or that the tool supplies one — and
FR-28's consequence list is where a reader would look.

### 4.4 A Source that declares no columns switches the column check off downstream

**FR-28 spike, `s5-source-without-columns`, accepted deliberately.** No Input Contract means no
schema, so the column check is disabled for everything downstream rather than guessing — *"the
alternative is a page of false accusations against a Recipe whose author simply has not described the
file yet."* This is a deliberate, defensible silence in the validation FR-28 and FR-22 promise, and it
is recorded only in the spike.

### 4.5 An example in a specification is a default in practice

**FR-28 spike.** The five authors produced one identical graph except for one flag: `duplicateAudit`,
where Sonnet 5 reasoned about it and set `true` while both Gemini runs took the block's example value
`false` without mentioning it. The finding generalises past the numeric-filter example the addendum
already records: **every value in a block example is a recommendation whether or not the prose says
so.** FR-14 makes `duplicateAudit` off-by-default and FR-34 records whether it was on, so the block's
example silently decides a run-status field for machine-authored Recipes.

---

## Checked and confirmed already landed

Recorded so the sweep's coverage is legible: the shared `file://` storage bucket and its three
consequences (FR-24, FR-25, NFR-8); the `persist()` deadlock (FR-25); Ctrl+F not reaching virtualized
rows (FR-33) and Ctrl+End landing on the last rendered row (NFR-7, addendum §4); the Firefox spacer
cliff (NFR-4, addendum §4); the sentinel Cartesian bomb (addendum §3, FR-14); `concat`'s column drop
(addendum §3, FR-13); `fromCSV` and `dynamicTyping` silent corruption (addendum §3, FR-9); `toCSV`
writing no BOM (addendum §3, FR-36); the transfer cost that keeps the pipeline on the main thread
(addendum §2); the absence of a shared cancellation flag (addendum §2); the JSON array-strategy
finding (FR-7); jsonrepair's `RangeError` (FR-5); the freeze/`shallowRef` rule (addendum §2); the
worker construction rules and the one-file gate (addendum §2); the comparison-value decision (FR-15,
FR-28, addendum §6); the vector-versus-raster chart result (FR-37); the long-label and `barMaxWidth`
tile settings (addendum §2); Vue Flow's missing cycle detection and node copying (addendum §7); the
correction loop being unexercised (Open Question 3); the two relicensings, PrimeVue and ApexCharts,
and the read-the-published-LICENSE rule (addendum §1, research plan).
