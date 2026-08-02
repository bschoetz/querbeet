# Reconciliation — PRD addendum against ARCHITECTURE-SPINE

- **Addendum:** `_bmad-output/planning-artifacts/prds/prd-querbeet-2026-08-01/addendum.md` (§1–§7)
- **Spine:** `_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md` (AD-1..AD-18, Consistency Conventions, Stack, Deferred)
- **Date:** 2026-08-02
- **Scope note:** the architecture directory contains the spine and nothing else, and the spine declares `companions: []`. There is no second architecture artifact where a rule could have landed instead. Every "missing" below is missing from the architecture, not merely from this file.
- **Method note:** absence of technology *rationale* in the spine is by design and is never reported here. Only absence of a **rule** for a measured hazard is. The spine's AD-5 supersession of the addendum's first reversibility seam (plain arrays of objects at Step boundaries) is disclosed and deliberate and is **not** reported as a defect — but its consequences for the *other* seams and for the freeze rule are, in §B.

---

## A. Measured constraints that did not land

### A-1 — Section 3 in its entirety has no home in the spine `[CRITICAL]`

**Addendum §3, "Arquero hazards the wrapper must absorb"** — six measured hazards against the released 8.0.3, each with a stated workaround, each mapped by the addendum to an FR.

**What the spine says:** nothing. The word Arquero appears three times — the Stack table, AD-5 ("Arquero implements it"), and the paradigm sentence saying library names live in adapters. There is no AD, no convention row, and no structural-seed comment covering any of the six. `core/steps/` is listed as "one file per Step kind: union, join, filter, columns, computed, aggregate, typing" with no rule about what those files may call. The Capability map routes FR-13..FR-18 to `AD-4, AD-5, AD-10` — purity, boundary shape, command path — none of which constrain engine semantics.

This is the highest-consequence finding in the review, because it is the section whose failures are *silent by measurement*: three of the six hazards produce a wrong answer with no error.

| Addendum §3 hazard | Measured numbers | Consequence if unruled |
| --- | --- | --- |
| `concat` silently drops columns present only in incoming tables | none needed — the drop is silent and is "precisely querbeet's core use case" | FR-13's "never dropped silently" clause is unimplementable by accident. Workaround measured working: union of all column names → pad each table via `derive` → force order with `select` → `concat`. |
| Null join keys never match, no option overrides it; the sentinel fix has a second cliff | sentinel substitution 30.8 ms at 100k rows; custom predicate degrades to O(n·m), projected ~3.7 s. **Checkpoint D2-a: both sides carrying nulls → 28,000 source rows produced 2,687,670 join rows; at 100,000 it crashed the tab.** | The most dangerous single item in the addendum. Null keys silently *drop* rows; the naive fix silently *multiplies* them. A graph makes the both-sides case easy — two branches of one Source inherit its nulls. The addendum names three admissible policies (exclude sentinel rows and re-attach, distinct sentinels per side, or refuse) and one **UX** obligation: a Join Step must warn when both inputs carry nulls in the key column. None of the four is anywhere in the spine. |
| Duplicate keys produce a Cartesian product | `lookup()` is the row-count-safe alternative | FR-14's row-count warning and its optional duplicate audit have no architectural anchor. |
| **Never call `fromCSV`** | converts German `"1.234"` to 1.234; samples only the first 1,000 values, then applies the inferred parser to the whole column | The spine pins `dynamicTyping` off for PapaParse but never forbids the *other* inference path. AD-7's "registry holds raw parsed tables — values as delivered" is compatible with `fromCSV` on a careless reading; the addendum's rule is `aq.from(objects)` after PapaParse, with querbeet owning the locale-aware parser. |
| `toCSV` writes no BOM and uses LF | prepend U+FEFF for German Excel | FR-36 export defect, user-visible, trivially preventable, currently unruled. Note this is the *export* twin of the encoding ladder in A-5. |
| Arquero needs `unsafe-eval` (open issue #361); `escape()` throughout may avoid it, untested | untested | Low today — "only matters if the page ever imposes a policy on itself" — but nothing in the spine records that a self-imposed CSP is a decision with a known cost. |

**Where it should land.** AD-5 already establishes the exact seam these belong behind: a narrow `Table` interface that Arquero implements. A new AD — call it **AD-19, "the Table adapter absorbs the engine's hazards"** — is the natural carrier: *no Step and no adapter calls an Arquero verb directly; `concat`, join and CSV emission are reached only through querbeet's own methods, which implement the union-pad-select order, the null-key policy, the duplicate-key row-count audit, and BOM + CRLF on CSV out.* The Join null warning additionally needs a `Diagnostic` code under AD-13 and a UX obligation the spine can state in one line. Without AD-19, AD-5's claim that replaceability "lives in the interface" is unbacked — see B-5.

### A-2 — Section 4 in its entirety has no home either, and one item fails silently `[CRITICAL]`

**Addendum §4, "Rendering constraints"** — five items, all measured in R4.

**What the spine says:** `ui/` is described as "panes, Editor, table view, Dashboard, dialogs". That is the only mention of the table view in the entire document. No AD binds it; the Capability map routes FR-31..FR-35 to `AD-6, AD-10` (dataset-out-of-graph and command-path), neither of which touches virtualization.

| Addendum §4 item | Measured numbers | Consequence if unruled |
| --- | --- | --- |
| **Guard the spacer height** | Firefox does not clamp: above ~**17.2 million px** it collapses the element to zero height and **the list silently vanishes**. Chromium clamps at **33,554,428 px**. At 28 px rows the Firefox cliff is ~**614,000 rows**. | The addendum explicitly re-scoped this from precaution to obligation: "When R4 measured this, the design target was 100,000 rows and the cliff was six times away; **NFR-3 now speaks of half a million rows** in total, and a Union of several large Sources can produce a single Result table close to that. … build it." The spine binds NFR-3 in its frontmatter and in AD-6/AD-9/AD-15, but nothing carries the guard. This is a blank Result pane in one engine only, at a row count the product now advertises. |
| Fixed row height is the default, not a compromise | every documented virtualization failure mode — list jumping, wrong scroll targets, upward drift — comes from dynamic heights | Nothing prevents a later story from "improving" the table with content-sized rows. Note the addendum permits variable height *in the Editor node bodies* (§2/§7, drift 0 px / 0.02 px) — the two are easy to conflate without a rule that separates them. |
| Do not build column virtualization | 50 columns × 50 rows measured at **11–14 ms** per swap; it is "where the leading library visibly breaks, and where sticky columns fight the virtualizer" | An unruled non-requirement that looks like an optimization. |
| Keep windowing behind a component whose props are `(rows, rowHeight, windowSize)` | — | This is a **reversibility seam** ("swapping in TanStack Virtual later rewrites one file") stated in §4 rather than §5, and it is the one seam of the five the spine does not carry in any form. It is also the one place where the row window size (~50, §1 D1) becomes a contract. |
| Accessibility bookkeeping is manual | `aria-rowcount`/`aria-colcount` totals, `aria-rowindex`/`aria-colindex` true positions; Ctrl+End to the last *rendered* row is a known unsolved problem | Per NFR-7 not required — record as a known limitation, not a rule. Lowest priority item in this table. |

**Where it should land.** One AD — **AD-20, "the table view is a fixed-height window behind one component"** — carries four of the five: the props contract, fixed row height, no column virtualization, and the spacer guard with both engine numbers. It binds NFR-3, FR-19, FR-31. A convention row (`Rendering — table window`) is the lighter alternative but would understate the spacer cliff, which is a silent failure and deserves an AD's *Prevents* line.

### A-3 — The chart renderer's silent degradation has no rule, and three tile settings are unrecorded `[HIGH]`

**Addendum §2, "The chart renderer choice is load-bearing, and two tile settings come with it":**

- Register `SVGRenderer` and nothing else — **in canvas mode `getDataURL({type:'svg'})` returns a PNG silently, with no error**, so registering both renderers makes an export degrade from vector to raster undetected.
- The reason is FR-37: measured, an SVG chart enters a printed PDF as vector plus selectable text; a canvas chart enters as a raster bounded by `devicePixelRatio`.
- **Every tile needs a long-label strategy** (`axisLabel.width` + `overflow`, or a shortening formatter — which querbeet owns anyway since the tick formatter is application-supplied): a 60-character category label **escapes the SVG by 15–21 px**.
- **`barMaxWidth` must be set** or a single-category tile renders as a **237 px slab in a 346 px plot**.
- ECharts does not observe its container, so **a tile size change must call `resize()`**.

**What the spine says:** one Stack-table cell, "Apache ECharts 6.1.0, SVG renderer registered alone". There is no AD for the `ChartRenderer` port; the port is listed in `ports/` and in the naming convention, and the Capability map governs FR-31..FR-35 by AD-6 and AD-10. The three tile settings and the `resize()` obligation appear nowhere. Worse, the Stack table is prefaced with "Seed … **The code owns this once it exists**" — see B-1: the one place the SVG constraint is written is the one place the spine declares non-binding.

**Where it should land.** **AD-21, "the ChartRenderer registers SVG alone, and tiles are rendered under a fixed set of guards"**, binding FR-33, FR-35, FR-37: only `SVGRenderer` is imported and registered (a canvas import is the defect, not just its registration); every tile applies a long-label strategy and `barMaxWidth`; a tile geometry change calls `resize()`. The *Prevents* line writes itself: a vector export that silently became a raster.

### A-4 — The FR-38 execution threshold has a measured design case and a hard bound, neither of which is carried `[HIGH]`

**Addendum §2, "The execution threshold of FR-38 has a measured shape":** editing a Step recomputes it and everything downstream, so the worst case is not the largest graph but the **earliest edit** in one — changing the first Step of a 30-Step graph costs **578.6 ms (Chromium) / 1,156 ms (Firefox)**, "which R4 names as the number the progress affordance should be built against". Two findings bound it: there is **no Editor-versus-table contention** at 30 Steps across 2,800 window swaps, so live mode need not defend the Editor's frame rate; and because there is no shared cancellation flag, **the threshold has to be low enough that live mode never begins work the user cannot get out of**. The threshold value is a calibration; FR-38 requires only that whatever it is, it is visible.

**What the spine says:** AD-9 carries the cancellation mechanism and its numbers (3.0 / 2 ms at ~5 ms chunks, ~2.6 % progress overhead) and correctly records why `SharedArrayBuffer` is unavailable. AD-8 carries the cache both FR-38 modes share. Neither carries (a) the first-Step-edit worst case as the number the progress affordance is designed against, (b) the requirement that the live-mode threshold be visible, or (c) the bound that live mode must never start work that cannot be exited. (c) is the one with teeth — it is the coupling between the threshold and the missing shared flag, and it is exactly the kind of reasoning that evaporates between documents.

**Where it should land.** Two clauses appended to AD-9, or a sibling **AD-22 "live mode is gated by a visible threshold"** binding FR-38, FR-34: the threshold is calibrated so that live-mode work is always exitable through the message queue, it is visible to the user, and the progress affordance is built against 578.6 / 1,156 ms.

### A-5 — The encoding ladder has no owner, and AD-3's wording pushes it into `ui/` `[MEDIUM]`

**Addendum §1:** Encoding — **no library**; BOM sniff → strict UTF-8 probe → Windows-1252 fallback → **user override** (R3).

**What the spine says:** nothing. Encoding is absent from the Stack table, from every AD and from the conventions. Worse, **AD-3** states that `ui/` unwraps a browser `File` "and issues a command carrying **bytes, text** and a name". If text has already been produced by `ui/`, the decode ladder — including its user-override branch, which is a re-decode of the same bytes and therefore stateful — sits in the driving adapter, outside the Vitest-testable core AD-2 exists to protect. If instead bytes cross, AD-3's "text" is wrong. The spine does not choose.

**Where it should land.** Either sharpen AD-3 to "bytes and a name, never text", and place the ladder in `core/` (it is pure: `Uint8Array → { text, encoding, confidence }`) with the override as a re-invocation carrying an explicit encoding; or declare it a `SourceReader` adapter concern and say so. Related: the export twin of this rule — `toCSV` writes no BOM (A-1) — should be stated in the same place so the read and write sides cannot drift apart.

### A-6 — The type-detection cost model and two locale traps are unrecorded `[MEDIUM]`

**Addendum §2, "Budget type detection as rows × columns × candidates tried, not rows × columns":** no parsing library infers a format from data (date-fns, Luxon, Day.js, d3 all require the caller to supply the pattern), so the candidate loop is querbeet's own code in every scenario, and FR-9's full-column scan multiplies by the candidate list. The measured point: **Luxon at 356 ms per 100,000 values per candidate** even with its precompiled parser — roughly **7 s for a 100k × 20 Source**, which is what disqualified it. Two traps in the same family as §3: Day.js silently ignores a format string when its plugin is unregistered, and **`Intl` will happily report separators for a locale nobody in the column is using**.

**What the spine says:** `core/types/` is seeded as "locale detection, **candidate loop**, type record, missing-value tokens" — the loop is named, its cost model is not. The Day.js trap is moot (date-fns is chosen). The `Intl` trap is *not* moot: the spine adopts `Intl.NumberFormat.formatToParts` implicitly via the Stack's "no library" number-parsing decision, and nothing records that the separators it returns are a hypothesis to be tested against the column rather than an answer.

**Where it should land.** A convention row (`Data — type detection`): detection cost is budgeted as rows × columns × candidates; every candidate is scored by acceptance count over the full column; a locale's separators from `Intl` are a candidate, never a conclusion. If detection runs under the AD-9 scheduler (it does, via AD-7's Step zero), say so — it is the largest single non-export compute in the product.

### A-7 — Two ordering/ownership rules from §1 are unrecorded `[LOW-MEDIUM]`

- **`jsonrepair` 3.15.0, only after `JSON.parse` fails.** The spine's Stack lists the version; the ordering rule — which is what keeps repair from silently rewriting valid input — is absent. One convention line, or a comment on the `adapters/json/` seed.
- **JSON flattening is own code**, because "three maintained libraries chose three different array semantics, which is evidence there is no safe default". The spine does not mention flattening at all, and `adapters/json/` is seeded only as "SourceReader + TableWriter implementations". The consequence worth carrying is not "write it yourself" but "the array semantics is a documented product decision, visible to the user, not an accident of an adapter" — it determines row counts on import.
- Minor, for completeness: Snappy as the `hyparquet-writer` default (round-trip verified against pyarrow 25, DuckDB 1.5.5, Polars 1.43.2) and Vue Flow's mandatory `@vue-flow/core/dist/style.css` (3,930 B, the only mandatory stylesheet) appear in the addendum and not in the Stack table. Both are inert unless changed.

### A-8 — The keyboard-reachability rule is binding in the addendum and absent from the spine `[MEDIUM]`

**Addendum §6, "Drag-and-drop":** the ban on drag reordering was a misreading and was withdrawn — native drag events that compute a target index and update the model are fine, because the framework re-renders from a single truth; what is binding is that a *library which mutates DOM order while the framework diffs the same list* is forbidden, and that **"no interaction may exist *only* as a pointer gesture, which is a correctness rule about keyboard reachability rather than an accessibility target"**. §7 measures the state of play: nine of eleven Editor interactions are keyboard-reachable in both engines; **connecting two Steps is the one gap**, and it waits on a UX decision, since `connectOnClick` is on and its click path ends in the same guarded door as the drag.

**What the spine says:** nothing about pointer-only interactions, and nothing about a DOM-mutating drag library. NFR-7 appears in the frontmatter binds list and in no AD. The Deferred section lists six items; the open keyboard-connect UX decision — the only named open item from the Editor spike other than auto-layout, which *is* listed — is not among them.

**Where it should land.** A convention row (`Cross-cutting — interaction`): no interaction exists only as a pointer gesture; no library may mutate DOM order that the framework also diffs. Plus one Deferred entry for keyboard connecting, marked as a UX decision rather than a technical gap — the distinction is the addendum's own and is worth preserving.

### A-9 — "A linear pipeline is the trivial case of the graph" is a Recipe-format constraint with no carrier `[MEDIUM]`

**Addendum §6, "Pipeline shape":** the graph was chosen over a linear list and a named-reference list, with its costs named in advance (PRD §6.3, Open Questions 2–4). The closing rule: "**The Recipe format should nonetheless be written so a linear pipeline is the trivial case of it — a graph whose every node has one input — so that a model asked for something simple can produce something simple.**"

**What the spine says:** AD-11 (one validator), AD-12 (version gate), AD-14 (short readable ids, "a Recipe a language model cannot author" as the *Prevents*) all serve machine authorship, and AD-14's rationale is the closest thing to this rule in the spine. But nothing states the shape constraint itself. It is a real design constraint on `core/recipe/` — it forbids, for instance, a format that requires an explicit edge list even for a chain, or mandatory positional metadata.

**Where it should land.** A clause on AD-14 or a new convention row under `Data — Recipe serialization`: the format degrades to a chain with no ceremony; a Step with one input needs no edge declaration beyond naming it.

### A-10 — Carried correctly (no action)

For completeness, the addendum items the spine does carry with their numbers intact: the freeze rule and the 437–479 MB / 11–13× penalty (AD-6, with the caveat in B-2); classic blob-URL workers, `?worker&inline`, `worker.format = 'iife'` (AD-15); exports-only-in-a-worker and the never-transfer-to-compute rule with 109.4 / 132 ms and 510.8 / 627 ms against 263–446 ms (AD-15); the absent `SharedArrayBuffer` and the lying `typeof` check (AD-9); nothing fetched at runtime (AD-17); one-file build assertion (AD-18); the shared `file://` bucket and NFR-8 (AD-16, which adds the unreported `navigator.storage.persist()` 180 s deadlock from R9 — an addition, not a conflict); the cycle guard in front of the library's mutation API and Design B's single-watcher projection (AD-10); datasets out of the graph model (AD-6); the comparison-value-as-number decision (conventions, `Data — comparison values`); the framework-free core seam and the XLSX adapter seam (AD-2, `ports/`); Package and Recipe as two named artifacts (ER diagram); R8 and R9's gate status (Deferred).

---

## B. Where the spine contradicts the addendum

*AD-5's disclosed supersession of the plain-arrays seam is excluded by instruction. B-2, B-5 and B-6 are its undisclosed consequences and are in scope.*

### B-1 — The Stack table is declared a seed the code may overrule, and three permanent constraints are filed only there `[HIGH]`

**Spine, Stack preamble:** "Seed, inherited from research runs R1–R9 and verified against the registries on 2026-08-01 … **The code owns this once it exists.**"

Three entries in that table are not seeds in the addendum:

| Stack row | Addendum's force |
| --- | --- |
| "Apache ECharts 6.1.0, **SVG renderer registered alone**" | §2: "**The renderer choice is not cosmetic**" — canvas mode returns a PNG from `getDataURL({type:'svg'})` silently, and FR-37's vector-plus-selectable-text output depends on it. |
| "PapaParse 5.5.4, `dynamicTyping` **permanently off**" | §1 uses the word *permanently*; §3 explains why (locale-destroying inference on a 1,000-value sample). |
| "Arquero 8.0.3, **pinned and vendored**" | §1 and §5: pinned and vendored, with a fork *plan* rather than a fork on file. |

A reader who follows the spine's own instruction — code owns the stack — may re-register a canvas renderer or flip `dynamicTyping` and be architecturally in the clear. Each of the three needs to be restated as a rule inside an AD (A-1, A-3), leaving the Stack table to carry version numbers, which is what a seed legitimately is.

### B-2 — AD-5 dissolves the object the freeze rule protects, and AD-6 still describes the old one `[HIGH]`

**Addendum §2:** "`Object.freeze` on the rows removes that entirely — **no proxy is created at all** — for about 4 % more heap. This is an architecture rule, not a tuning tip: one unfrozen 100k array inside a computed recreates the whole problem." **§7** supplies the mechanism: "**Vue's reactivity skips non-extensible objects, so `Object.freeze` is itself the protection**" — measured on a frozen 100,000 × 20 table placed by reference in node data, which came back with identity preserved, `isReactive` false, and both array and rows still frozen.

**Spine AD-6:** "Rows are frozen at the boundary where they are produced. `ui/` wraps the registry in `shallowRef` for rendering and never copies a table into reactive state."

Under AD-5, rows are no longer produced at Step boundaries — a `Table` handle crosses and `table.rows()` runs "only at real edges". So the thing that lives in the registry, in the cache and in every Step's output is an **Arquero Table object, which is extensible**, and to which the measured protection (`Object.freeze` → Vue skips it) therefore does not apply. AD-6's own *Prevents* line — the 437–479 MB and 11–13× penalty — now rests entirely on the discipline clause "never copies a table into reactive state", which is exactly the discipline the addendum said should be replaced by a structural property. The addendum's own warning names the failure mode: one unfrozen array inside a computed.

This is not a reason to reverse AD-5. It is a gap AD-5 opened and did not close. The fix is one clause: state whether querbeet's `Table` handle is itself frozen (or `markRaw`'d — note §7 says `markRaw` was *unnecessary for a frozen payload*, which is no longer the situation), and keep the row-level freeze rule for the materialized edges. Without it, the single most expensive measurement in the addendum is defended by a convention row.

### B-3 — AD-6 and AD-7 disagree about what the registry holds, and both differ from §7 `[MEDIUM]`

- **AD-6:** "tables live in a registry **keyed by Source id and Step id**, held as a plain `Map` in `core/`."
- **AD-7:** "**the registry holds raw parsed tables — values as delivered.** … FR-9's retained original is therefore the registry entry itself, not a duplicate."
- **AD-8:** the per-Step cache is a separate content-addressed store, `key(step) = hash(canonical(config) + key(inputs))`.
- **Addendum §7:** "Tables live in a `shallowRef` registry keyed by **Source id**, outside the graph … **R4 confirmed this is also where a per-Step result cache belongs.**"

Three readings are live: one store keyed by both kinds of id (AD-6), one store holding only raw Sources with the cache elsewhere (AD-7 + AD-8), or one store that is also the cache (§7). AD-7's guarantee — that FR-9's retained original *is* the registry entry — holds only under its own reading; under AD-6's, a Step-id entry can evict or shadow a Source-id entry and the "no duplicate copy" claim quietly becomes a lifetime question nobody has answered. Pick one and make AD-6, AD-7 and AD-8 say the same thing. (The spine's resolution of §7's `shallowRef` — a plain `Map` in `core/`, wrapped by `ui/` — is correct and should be kept; it is what AD-2 requires.)

### B-4 — AD-7 silently reinterprets the type record's `keepOriginal` `[MEDIUM]`

**Addendum §1:** the per-column type record is `{type, decimalChar, groupChar, dateFormat, missingValues, **keepOriginal**}`, stored in the Recipe — "this is what FR-9's confirmation actually persists", shaped deliberately close to Power Query's `Table.TransformColumnTypes(…, culture)`.

**Spine AD-7** makes retention a property of the architecture rather than of the column: the registry always holds the raw values, so "FR-9's retained original is therefore the registry entry itself, not a duplicate". That is an elegant answer to *storage*, but `keepOriginal` is a **per-column** flag in a Recipe that a language model authors and a validator checks, and its plausible product meaning is "carry the original value alongside the typed one **in the result**". AD-7's mechanism does not produce that column; it only guarantees the raw table still exists upstream. The spine neither restates the field list nor says the flag has been redefined.

Resolve explicitly: either `keepOriginal` remains a per-column output instruction (and AD-7 explains how Step zero honours it), or it is dropped from the record as redundant (and the addendum's field list is amended). Leaving both statements standing guarantees the validator and the engine will disagree about what the flag does.

### B-5 — AD-5 claims replaceability for a seam it never specifies, and its edge list omits ingest `[MEDIUM]`

**AD-5:** "between Steps a `Table` handle crosses, behind querbeet's own narrow interface — Arquero implements it. … replaceability is preserved but now lives in the interface rather than in the row shape."

Two problems, both consequences of the supersession rather than of the decision:

1. **The interface is never enumerated.** The addendum's seam bought replaceability from a property every engine already had ("every engine examined consumes and produces that shape"). AD-5 buys it instead from an interface the spine does not define anywhere — not in `ports/` (which lists `SourceReader`, `TableWriter`, `SessionStore`, `ChartRenderer`, `GraphView`, `Clipboard`, and no `Table`), not in the structural seed, not in a convention. If the interface's surface is whatever Arquero happens to expose, the claim is unbacked; and §3's hazards are precisely the semantics where engines differ, so the interface cannot be specified without settling A-1 first. This also strands the fourth reversibility seam: the Arquero fork plan (10,764 lines, 392 passing tests, two dependencies, BSD-3-Clause) was recorded "so the option is remembered rather than rediscovered under pressure", and the spine mentions neither the plan nor where it lives.
2. **The materialization edge list is incomplete.** AD-5 names "preview, export, `SessionStore`, worker transfer". It omits the *ingest* direction entirely — §3 requires `aq.from(objects)` after PapaParse, and the XLSX seam (`readWorkbook`, ~50 lines, SheetJS as drop-in fallback) hands back rows too. So it is unstated whether a `SourceReader` adapter returns rows (and the core wraps them) or returns a `Table` (putting an Arquero import in four adapter directories, which strains "the only place a library name appears is an adapter" in a different direction). It also omits the Column Profile / FR-27 prompt block and the chart tiles, both of which read values. One added sentence — "and the ingest edge, where an adapter's rows become a `Table`" — settles it.

### B-6 — The Deferred entry for FR-37 is broader than the addendum supports `[MEDIUM]`

**Spine, Deferred:** "**The view-document adapter (FR-37).** Research R8 is written and unrun, so **how a `file://` page produces a self-contained HTML document and a paginated PDF is undecided.**"

**Addendum §2** measured part of it already: "**measured**, an SVG chart enters a printed PDF as vector plus selectable text while a canvas chart enters as a raster bounded by the screen's `devicePixelRatio`" — which is why the renderer choice is load-bearing. The PDF path is therefore not wholly undecided; the browser print path was exercised, and it is the *reason* for a Stack entry.

The risk is not the deferral, it is what the deferral swallows. The SVG-only constraint is an obligation on the **chart adapter today**, discharged long before R8 runs; filing FR-37 as undecided invites a reader to treat the renderer question as deferred with it. Reword the entry to defer the *document container* (self-contained HTML, pagination) while stating that the chart-fidelity half is settled and carried by the chart AD proposed in A-3.

### B-7 — AD-9 imports a cancellation number from conditions AD-4 forbids `[MEDIUM]`

**AD-9:** "the scheduler yields between chunks and checks for cancellation through the message queue — R4 measured **3.0 ms (Chromium) / 2 ms (Firefox) at ~5 ms chunks**, with progress costing ~2.6 %. … **Step functions themselves never become async.**" **AD-4:** a Step is a pure *synchronous* function returning a table.

If the smallest schedulable unit is a whole Step, ~5 ms chunks are unreachable: the addendum measures the whole Arquero pipeline at **263–446 ms** for 100,000 rows and a first-Step edit in a 30-Step graph at **578.6 / 1,156 ms**, so a single Step's Arquero call is tens to hundreds of milliseconds of uninterruptible work. The quoted 3.0 / 2 ms latency then describes a chunk size the architecture cannot produce, and the real cancellation granularity is *one Step*. That granularity may well be acceptable — but it is a different promise, and it feeds directly into the live-mode threshold bound in A-4 ("low enough that live mode never begins work the user cannot get out of"), where the unit of no-return is now a Step rather than 5 ms.

Fix by stating the granularity plainly in AD-9: cancellation is checked between Steps, the ~5 ms figure characterises message-queue latency and not the scheduling quantum, and the worst-case exit latency is the longest single Step.

### B-8 — AD-14 cites a measurement the addendum does not record `[LOW]`

**AD-14:** "No UUIDs: FR-28 requires a model to write them and **the authorship spike measured that working with this shape**."

The addendum's authorship evidence is elsewhere and about something else: §2 records five independent authoring runs against `block-template.txt`, four of which guessed the filter comparison value wrong, and §7 records the Recipe round-tripping byte-identically at **1,309 B for a six-Step graph** with **six rejection classes**. Neither is a measurement of the *id shape*. Either the claim traces to a research artifact the addendum does not summarise — in which case the addendum's §7 is one item short — or AD-14's justification is overstated. The rule itself (short, readable, kind-prefixed, never reused, minted by the core) is sound either way and is corroborated by the byte-identical round trip; only the citation is at issue.

---

## Summary — what would carry each finding

| # | Finding | Carrier |
| --- | --- | --- |
| A-1 | §3 Arquero hazards, all six, unruled | **New AD-19** — the Table adapter absorbs engine hazards (concat union-pad, null-key policy + Join warning, duplicate-key audit, no `fromCSV`, BOM + CRLF on CSV out) + a `Diagnostic` code under AD-13 |
| A-2 | §4 rendering constraints, all five, unruled — spacer cliff fails silently | **New AD-20** — fixed-height window behind `(rows, rowHeight, windowSize)`, no column virtualization, spacer guard at 17.2 M px / 33,554,428 px |
| A-3 | Silent SVG→PNG degradation; long labels, `barMaxWidth`, `resize()` | **New AD-21** — ChartRenderer registers SVG alone; per-tile guards |
| A-4 | FR-38 threshold: worst case, visibility, exitability | **AD-9 clauses or AD-22** |
| A-5 | Encoding ladder ownerless; AD-3 says "bytes, text" | **AD-3 wording + `core/` placement** |
| A-6 | Detection cost model; `Intl` separator trap | **Convention row** `Data — type detection` |
| A-7 | `jsonrepair` ordering; JSON array semantics; Snappy; Vue Flow stylesheet | **Convention row / Stack rows** |
| A-8 | No pointer-only interaction; DOM-mutating drag libraries; keyboard connect open | **Convention row** + one Deferred entry |
| A-9 | Linear pipeline as the trivial graph | **AD-14 clause or Recipe convention** |
| B-1 | "The code owns this once it exists" over three permanent constraints | Restate the three as rules; demote Stack to versions |
| B-2 | AD-5 removes the object `Object.freeze` protected; AD-6 unchanged | **AD-5 + AD-6 clause** |
| B-3 | AD-6 / AD-7 / §7 disagree on the registry's contents | Align AD-6, AD-7, AD-8 |
| B-4 | `keepOriginal` silently reinterpreted | **AD-7 clause** or amend the record |
| B-5 | AD-5's interface unspecified; ingest edge missing; fork plan unlocated | **AD-5 + `ports/`** |
| B-6 | FR-37 deferral swallows a settled, measured constraint | Reword the Deferred entry |
| B-7 | 5 ms chunk figure under Step-atomic scheduling | **AD-9 clause** |
| B-8 | AD-14 cites an unrecorded measurement | Fix the citation |
