---
review: rubric walk — good-spine checklist
target: ARCHITECTURE-SPINE.md (querbeet, 2026-08-02, status draft)
driving spec: prds/prd-querbeet-2026-08-01/prd.md (FR-1..FR-39, NFR-1..NFR-9) + addendum.md
reviewer: rubric walker, pre-handoff review
date: 2026-08-02
---

# Rubric Review — Architecture Spine querbeet

## Overall verdict

**Adequate, not yet handoff-ready.** The domain half of this spine is genuinely good: eighteen ADs,
most of them mechanically checkable, and the four highest-risk product properties — one validator for
three doors, no dataset in the reactive graph, a content-addressed cache, and a single-file build that
asserts itself — are ruled precisely enough that an epic author cannot get them wrong by accident.
What is missing is on two axes. Structurally, the transformation engine — the single most load-bearing
library in the product — has no port, no adapter directory and no legal import path into `core/`,
which makes AD-1 and AD-5 contradict each other at the exact point where every Step kind is written.
Dimensionally, the operational and environmental envelope this product actually has (browser matrix,
test placement, dev-vs-artifact parity, dependency pinning, the file-out path, runtime failure
behaviour) is almost entirely silent, and two correctness invariants have been demoted into a Stack
table the spine itself declares overridable.

| # | Dimension | Verdict |
| --- | --- | --- |
| 1 | Fixes the real divergence points for epics and stories | **thin** |
| 2 | Every Rule enforceable and matching its Prevents | **adequate** |
| 3 | Nothing under Deferred lets two units diverge | **thin** |
| 4 | Covers the driving spec's capabilities | **adequate** |
| 5 | Every dimension decided, deferred or open — none silent | **thin** |
| 6 | Build substrate: terse, convergent, invariant-heavy | **adequate** |

Findings: **1 critical, 8 high, 18 medium, 11 low.**

---

## Mechanical checks

Run before the dimension walk, because two dimension findings depend on them.

**AD ids — PASS.** `AD-1` through `AD-18`, contiguous, no duplicates, no gaps.

**FR/NFR citations — PASS.** Every FR and NFR cited in a `Binds:` line, a Capability map row or a
Deferred entry exists in the PRD. No dangling reference. Highest cited: FR-39, NFR-9 (frontmatter
only). No AD cites a requirement number the PRD does not define.

**Requirement coverage of the `binds:` frontmatter — FAIL (M-1, medium).** The frontmatter declares
`binds: [FR-1 … FR-39, NFR-1 … NFR-9]`, but **NFR-4 (browsers), NFR-5 (form factor), NFR-7 (keyboard
reachability) and NFR-9 (nothing is typed) appear nowhere in the body of the spine** — not in an AD's
Binds line, not in a Consistency Convention, not in the Capability map. NFR-6 is the only
non-functional in that set that gets a convention row. The frontmatter therefore claims a coverage the
document does not have. *Location: frontmatter line 11 vs the whole body.* *Fix: either bind them (see
findings 1.5, 1.6, 5.1) or remove them from `binds:` and say why in the memlog. NFR-5 is an explicit
non-goal and can simply be dropped from `binds:`.*

**Mermaid blocks — PASS (3 blocks).** No mermaid renderer is available in this environment (no
network, no `mmdc`), so this was checked by inspection against the grammar rather than by rendering.
- `graph LR` (AD-1): node ids valid, `["…"]` quoted labels containing em dashes and parentheses are
  legal inside quotes, `-->|text|` and `-.->|text|` are both valid link forms. Valid.
- `flowchart TB` (Structural Seed): `[/"…"/]` parallelogram and `[("…")]` cylinder shapes are both
  valid flowchart shapes with quoted text; all edges are plain `-->`. Valid.
- `erDiagram`: cardinality tokens `||--o{`, `||--||` valid; relationship labels are bare words except
  `"endpoint of"`, which is correctly quoted. Valid.

*Semantic note (low, 4.4b):* the ER diagram omits `COLUMN_ANNOTATION`, although FR-10 and FR-20 make
annotations part of the Recipe and FR-26 makes them part of the Column Profile. Every other Recipe
constituent is drawn.

**Capability map ↔ Structural Seed directory references — FAIL, 3 mismatches.**

| Map reference | In seed? |
| --- | --- |
| `adapters/{csv,json,xlsx,parquet}` | yes |
| `core/types`, `core/exec`, `core/graph`, `core/steps`, `core/recipe`, `core/profile` | yes |
| `adapters/indexeddb`, `adapters/echarts`, `adapters/vueflow` | yes |
| `ui/` | yes |
| `Clipboard` port | port named in `ports/`, **no adapter directory** (finding 4.2) |
| FR-37 → `adapters/{csv,json,xlsx,parquet}` behind `TableWriter` | **wrong target** (finding 3.1) |
| the `Table` interface / Arquero (AD-5) | **absent from both `ports/` and `adapters/`** (finding 1.1) |

Also unreferenced in either direction: `core/diagnostics/` and `app/` exist in the seed but appear in
no Capability map row (finding 4.4).

---

## Dimension 1 — Does it fix the real divergence points for epics and stories?

**Verdict: thin.**

What it fixes well, and should not be touched: the dependency direction (AD-1), the Step contract
(AD-4), the registry/graph separation (AD-6), the cache key (AD-8), the command path with the cycle
guard in front of the editor library (AD-10), one validator for three doors (AD-11), the id shape
(AD-14), the worker rule (AD-15), and the single-file build assertion (AD-18). These are exactly the
places where two epics would otherwise each invent an answer.

The gaps are cross-cutting: every one of them is touched by three or more epics, which is precisely
the class this altitude exists to close.

### 1.1 — The transformation engine has no home, and AD-1 forbids the only obvious one — **CRITICAL**

*Location: AD-1 Rule; AD-5 Rule; Structural Seed `core/steps/`, `ports/`, `adapters/`; Stack row
"Arquero 8.0.3, pinned and vendored".*

AD-1 rules `core/` may import from `core/` and `ports/` **only**, and that "every library import lives
here" under `adapters/`. AD-5 rules that a `Table` handle crosses Step boundaries "behind querbeet's
own narrow interface — Arquero implements it". But:

- the `Table` interface is not in the `ports/` line (which lists exactly `SourceReader TableWriter
  SessionStore ChartRenderer GraphView Clipboard`);
- there is no `adapters/arquero/` in the seed;
- and `core/steps/` — "one file per Step kind: union, join, filter, columns, computed, aggregate,
  typing" — is where the join, filter and aggregate work actually happens.

So a Step author has three readings, all defensible against the written rules: import Arquero directly
into `core/steps/` (violates AD-1), route every operation through a port that does not exist, or build
a second unnamed abstraction. The same hole swallows `date-fns` 4.4.0, which the Stack pins for date
parsing and which `core/types/` — "locale detection, candidate loop, type record" — is the only
plausible caller of.

There is a second reading conflict inside the spine itself: AD-2 (`[ADOPTED]`) forbids only Vue, DOM
and browser APIs in `core/`, which reads as permitting a pure computational library there, while AD-1
forbids all of them. A reviewer cannot tell compliance from violation for the most-written code in the
product.

*Fix:* name the boundary. Add `Table` (or `TableEngine`) to `ports/` with its operation list, add
`adapters/arquero/` to the seed, and state in AD-1 or AD-5 whether a pure computational library may be
imported into `core/` at all — and if yes (the pragmatic answer for `date-fns`), say so explicitly so
that AD-2's narrower prohibition and AD-1's broader one stop disagreeing.

### 1.2 — Arquero's measured hazards have no single absorption point — **HIGH**

*Location: AD-5; addendum §3, titled "Arquero hazards the wrapper must absorb".*

The addendum lists five hazards, each mapped to an FR and each a silent-wrong-number defect of exactly
the class §4 of the PRD names as this product's characteristic failure: `concat` silently drops columns
(FR-13), null join keys never match and the sentinel workaround multiplies rows quadratically when both
sides carry nulls — 28,000 rows produced 2,687,670 join rows (FR-14), duplicate keys produce a
Cartesian product (FR-14), `fromCSV` must never be called (FR-9), `toCSV` writes no BOM (FR-36).

The spine has no rule that these are absorbed once, behind one wrapper. AD-5 gets adjacent to it — a
narrow interface — but rules only what crosses a Step boundary, not who owns the workarounds. Written
as it stands, the Union epic and the Join epic each solve their own hazard in their own Step file, and
both are compliant.

*Fix:* an AD stating that every documented engine hazard is absorbed in the engine adapter and never in
a Step kind, with the list named so a reviewer can check it off.

### 1.3 — Step kinds have an execute contract and nothing else — **HIGH**

*Location: AD-4 Rule; Capability map rows "Pipeline graph" and "Recipes, contracts, Packages".*

AD-4 defines a Step as `(inputs: Table[], config) => { table, diagnostics }`. Four requirements need a
Step kind to answer questions **without running**:

- FR-13: columns present in only some inputs are "listed to the user **before the Step runs**";
- FR-12: "Every Step kind states how many inputs it takes";
- FR-21: the Input Contract records "the columns the Pipeline actually reads" — static analysis over
  Step configs;
- FR-22: the Pre-flight Check reports fit/missing/doubtful before any Step runs.

None of that is expressible through the one function AD-4 defines. Each epic will invent its own
answer — a dry-run flag, a parallel switch statement in `core/recipe`, a second export per Step file.

*Fix:* extend AD-4 to a Step-kind descriptor rather than a bare function:
`{ kind, arity, configShape, columnsRead(config), outputColumns(inputSchemas, config), run(...) }`,
and rule that FR-21 and FR-22 read it rather than pattern-matching on `kind`.

### 1.4 — Table rendering and virtualization are unruled — **HIGH**

*Location: Structural Seed `ui/` (one line); Capability map row "Result view and Dashboard"; addendum
§4.*

Four surfaces render a large table: Source Preview (FR-8), Step Preview (FR-19), the Result table
(FR-31, FR-32, FR-33) and the table Tile (FR-35). All four sit at NFR-3 scale. The addendum fixes the
answers — fixed row height is "the default, not a compromise", no column virtualization, windowing kept
behind a component whose props are `(rows, rowHeight, windowSize)`, and a **mandatory spacer guard**
because Firefox collapses an oversized spacer to zero height at roughly 614,000 rows, which a Union of
several large Sources now reaches under the revised NFR-3.

The spine says none of this. `ui/` is one seed line ("panes, Editor, table view, Dashboard, dialogs")
and the map governs FR-31–35 with AD-6 and AD-10 only. Four epics will each write a table renderer, and
the spacer guard — a silent-disappearance defect, not a performance nicety — belongs to no one.

*Fix:* one AD: a single windowing component with the props above, fixed row height, one spacer guard,
every table surface renders through it. Add `ui/table/` to the seed.

### 1.5 — NFR-7's keyboard rule is unbound, and it is not an accessibility rule — **HIGH**

*Location: nowhere in the spine; PRD NFR-7, FR-12, FR-35, NFR-7's drag clause; addendum §6
"Drag-and-drop".*

Accessibility conformance is an explicit non-goal and is correctly not chased here. But NFR-7 carries
one clause the PRD marks as "not optional, because it is a correctness rule rather than an
accessibility one": no interaction may exist only as a pointer gesture, and drag must be implemented
"as a gesture that computes a target and updates the underlying model, never as a library that reorders
DOM nodes itself, which is the documented cause of a list fighting its own framework."

That second half is an architecture invariant of the same family as AD-6 and AD-10 — two sources of
truth over one list — and it binds three surfaces: file drop (FR-1), graph editing (FR-12, "the graph
is navigable and editable by keyboard"), and Tile ordering (FR-35, "order changes through
keyboard-reachable controls"). The Editor spike also recorded that keyboard *connecting* of two Steps
is the one unresolved interaction. The spine mentions `DragEvent` once, in AD-3, and only to unwrap it
at the `ui/` boundary.

*Fix:* an AD binding NFR-7, FR-1, FR-12, FR-35: every pointer gesture computes a target and issues a
command (AD-10); no library reorders DOM nodes; every such action has a keyboard-reachable path. Name
keyboard connecting as the one open UX item, so it is not silently lost.

### 1.6 — NFR-9 is unbound, and it is what makes AD-11 tractable — **MEDIUM**

*Location: AD-4, AD-11; PRD NFR-9, FR-17.*

"Nothing is typed" is not a UI preference; it is the property that makes a Recipe a data structure a
model can emit and a validator can check (NFR-9 says so, FR-17 repeats it: "a plain data structure with
no free text to parse"). It also names the boundary a post-MVP formula language must not breach. The
spine's AD-11 depends on it and never states it.

*Fix:* one clause in AD-4 or a new AD: a Step config is a closed data structure with no free-text field
that is parsed; anything a validator must interpret is an enumerated value or a typed literal.

### 1.7 — Display formatting has two consumers and one convention line — **MEDIUM**

*Location: Consistency Conventions, rows "Data — comparison values" and "Data — dates in the domain";
FR-31, FR-36.*

FR-31 requires German display conventions in the Result table "regardless of the locale they were read
in". FR-36 requires German number and date conventions **inside the CSV and XLSX exports** — produced
by adapters, not by `ui/`. The conventions rule only what may not reach the Recipe. Nothing says the
formatter is one thing; `ui/` and `adapters/xlsx/` will each grow one, and they will disagree on
exactly the values the Boxchecker files.

*Fix:* name a single value-formatting module and its home, and rule that both the view and the export
adapters call it. Note this does not violate the "no user-facing string in `core/`" convention —
formatting a number is not a message catalogue.

### 1.8 — The view/data boundary has no home — **MEDIUM**

*Location: Capability map row "Result view and Dashboard"; FR-32, FR-33.*

FR-32's view filters apply "to the full Result, not to the rendered window", are transient, are not in
the Recipe, and can be **promoted into a Filter Step** by a single action. FR-33's search runs over
every row. These are full-dataset operations that are deliberately not Steps. The map puts them in
`ui/`, governed by AD-6 and AD-10 — but AD-10 rules that `ui/` never mutates the model, which is
consistent, and nothing rules where transient view state lives or what vocabulary a view filter shares
with a Filter Step config so that promotion is a translation rather than a re-entry.

*Fix:* rule it in one line: view state lives in `ui/`, never in the Recipe, and a view filter uses the
Filter Step's own condition shape so promotion is a copy.

### 1.9 — The seed is thinnest where the build is heaviest — **LOW**

*Location: Structural Seed, `ui/` line.*

`core/` gets seven directories with contents named. `ui/` gets one line for what PRD §6.3 identifies as
"four largely independent product surfaces" and as the project's scope risk — which is also where the
epic cut will fall. A seed is meant to be minimal, but the asymmetry here works against the level
below.

*Fix:* three or four subdirectories under `ui/` matching the surfaces the epics will follow (sources,
editor, result, dashboard), plus `ui/table/` from 1.4.

---

## Dimension 2 — Is every Rule enforceable, and does it prevent what its Prevents claims?

**Verdict: adequate.**

Eight ADs are exemplary and could be checked by a grep or a build assertion: AD-1, AD-2, AD-3, AD-11,
AD-12, AD-14 ("A Recipe round-trips byte-identically" is a test, not a hope), AD-17, AD-18. AD-8's key
formula is unambiguous. AD-6's rule names the mechanism and the measurement it defends.

Four rules do not carry their own weight.

### 2.1 — AD-16's Prevents claims something its Rule cannot deliver, and the PRD says is impossible — **HIGH**

*Location: AD-16, Prevents and Rule.*

Prevents: "two copies of `querbeet.html` silently sharing one session, and a Package colliding with a
live session." Rule: "the `SessionStore` port's keys and database name carry a discriminator."

Two copies of the same build carry the same discriminator, so the first half of the Prevents line is
not prevented. Worse, the PRD states copy-sharing as an accepted, user-visible, unavoidable
consequence: FR-25, "**Two copies of `querbeet.html` on one machine share one stored session.** Opening
the second copy shows the first copy's Recipe and data. Copying the file is the expected way to
distribute this tool, so this will happen." The spine's own Rule text agrees that querbeet "cannot
partition it from the inside". The AD therefore promises to prevent something the driving spec
documents as a feature-level fact.

Second defect in the same rule: the discriminator's provenance is unspecified. A build-time constant, a
per-install id minted on first run, and a user-visible session name are three different products, and
FR-25's one-action delete plus FR-24's Package/session collision rule read differently under each.

*Fix:* restate Prevents as what the discriminator actually buys — a Package's storage colliding with a
live session, and any other local page's keys colliding with querbeet's — and state in the Rule what
the discriminator is derived from. If it is a build constant, say so, because that is what makes
copy-sharing the accepted behaviour rather than a bug.

### 2.2 — AD-9 names a worker mechanism for a main-thread scheduler — **MEDIUM**

*Location: AD-9 Rule.*

"the scheduler yields between chunks and checks for cancellation **through the message queue**". AD-15
rules that workers exist only for the two exports and that a dataset is never sent to a worker to
compute on — so pipeline execution is on the main thread, where cancellation is a plain flag read
between chunks and no message passing is involved. The `SharedArrayBuffer` clause that follows is a
worker-shared-memory concern and is irrelevant to a main-thread loop.

A reviewer cannot tell whether a `MessageChannel`-yield plus a boolean complies, or whether
`postMessage` plumbing was intended. Two implementers will build different things.

*Fix:* state the mechanism plainly — the scheduler yields to the macrotask queue between chunks so that
input events land, and reads a plain cancellation flag; the `SharedArrayBuffer` finding belongs to
AD-15's worker rule (or to the memlog, per 6.2).

### 2.3 — AD-13's Diagnostic shape cannot carry the numbers the PRD requires — **MEDIUM**

*Location: AD-13 Rule; FR-13, FR-14, FR-15, FR-18, FR-34, FR-37.*

The shape is `{ severity, code, message, stepId?, sourceId?, rowCount? }`, with `code` "a stable
identifier, never a sentence" and `message` German and user-facing. The requirements that feed it need
structured numbers, plural:

- FR-14: how many left rows found no match, **and** the duplication factor, **and** per-key duplicate
  counts under the audit;
- FR-18: input **and** output row counts;
- FR-15: how many rows were removed;
- FR-13: the list of columns present in only some inputs;
- FR-39: affected row numbers.

One optional `rowCount` cannot hold a pair, and the alternatives are to stuff numbers into `message`
(which breaks "the core emits a `code` and the UI renders it", since the German sentence would then be
built in `core/`) or to invent per-Step side channels. FR-34 must aggregate this and FR-37 must
reproduce it on paper.

*Fix:* add a typed `data` payload whose shape is keyed by `code`, and rule that no number appears in
`message` that is not also in `data`.

### 2.4 — AD-10's command vocabulary is ambiguous about closure and incomplete — **MEDIUM**

*Location: AD-10 Rule.*

The listed commands are `addStep`, `connect`, `reconfigure`, `deleteStep`, `loadRecipe`. Model changes
with no command named: type confirmation (FR-9, which is stored in the Recipe and gates execution),
Source add/remove/rename (FR-1), Column Annotation (FR-10), designating the Result Step (FR-12),
Dashboard Tile add/configure/order/size (FR-35), contract mapping (FR-23), promoting a view filter
(FR-32), editing the derived Input Contract (FR-21). Nothing says whether the list is closed or
illustrative, so an epic may reasonably mutate the Dashboard directly and claim AD-10 did not cover it.

*Fix:* declare the rule as the invariant ("every model change is a named command applied by the core
after its guards; the vocabulary is defined in `core/recipe` and is closed") and either complete the
list or move it out of the Rule.

### 2.5 — AD-8 defines a cache with no bound and no eviction — **LOW**

*Location: AD-8 Rule.*

Content-addressing gives correct invalidation and explicitly rewards returning to a previous
configuration, which means entries are never superseded — they accumulate. At NFR-3 scale (~94 MB live
per 100k×20 Source per the addendum), a session of editing a 30-Step graph accumulates results for
every config the user passed through. No bound, no eviction policy, no rule on when an entry is
dropped. See also 5.9.

*Fix:* one clause: the cache is bounded and evicts by least-recent-use; a dropped entry is
indistinguishable from a cold one.

### 2.6 — AD-12's build-version clause is a UI placement, not an invariant — **LOW**

*Location: AD-12 Rule, last sentence.*

"The application displays its own build version where a Consumer can read it back to the Author" says
where a number appears but not where it comes from, how it relates to the Recipe format version, or
that it must be a build-time constant (which AD-17 requires, since nothing may be fetched).

*Fix:* rule the source — build-time constant, injected by the build, distinct from and independent of
the Recipe format version.

### 2.7 — AD-5's interface is unnamed and unenumerated — **LOW**

See 1.1. The rule as written is enforceable at the boundary (`table.rows()` only at preview, export,
`SessionStore`, worker transfer — that is checkable) but not at the thing it defines.

---

## Dimension 3 — Could anything under Deferred let two units diverge?

**Verdict: thin.** Two of the six deferrals leave open boundaries, and one of them says in writing that
it does not.

### 3.1 — The FR-37 deferral claims a port that does not exist — **HIGH**

*Location: Deferred, first bullet; Capability map row "Export"; `ports/` line; memlog entry 19.*

The deferral says: "The port it sits behind is defined; the gap is an unimplemented adapter, not an open
boundary." The `ports/` line lists `SourceReader TableWriter SessionStore ChartRenderer GraphView
Clipboard`. There is no document or view-document port. The Capability map instead routes FR-37 to
`adapters/{csv,json,xlsx,parquet}` behind `TableWriter` — adapters that write tabular data files, which
is FR-36's job and not FR-37's. The memlog repeats the same claim for both deferrals.

So the boundary is open in exactly the way the entry denies. Two units diverge trivially: one builds
the view document as a fifth `TableWriter` implementation, another as a `ui/` export path with a print
stylesheet (the PRD's own OQ 11 names print-to-PDF as a live candidate that "cannot be triggered as a
download") — and both are compliant.

Several FR-37 invariants also do **not** depend on R8 and could be ruled today: charts arrive as vector
SVG with selectable text (measured, 21–35 real axis labels vs zero raster images), the run status is
reproduced, the document names its Recipe/date/Sources, and a truncated Result states its omission
(R4's virtualization does not apply to a static document).

*Fix:* add a `ViewDocumentWriter` port with its signature — Result handle + Dashboard definition + run
status + provenance → bytes — and move the R8-independent invariants into an AD. Correct the Capability
map row and the memlog claim.

### 3.2 — The Package deferral leaves boundary choices open, not only an implementation — **MEDIUM**

*Location: Deferred, second bullet; FR-24; AD-12; AD-16.*

"`SessionStore` and `TableWriter` already bound the shapes it must fit between" is true of the data
shapes and not of the boundary. Still undecided in a way two units would answer differently: the file
extension and how a Package is distinguished from a Recipe on load (FR-24 requires a visibly distinct
extension), whether the container is written through `TableWriter` or its own port, where the format
version sits relative to AD-12's Recipe version, and how FR-24's "states the resulting file size before
writing it" is computed for a compressed container.

*Fix:* fix the extension, the discrimination rule (magic bytes or extension, named), and the version
placement now; leave only the compression mechanism and the internal data encoding deferred.

### 3.3 — "Graph auto-layout" is deferred without ruling what the Recipe carries — **MEDIUM**

*Location: Deferred, fifth bullet; AD-14; FR-28.*

AD-14 requires a byte-identical Recipe round trip and FR-28 requires a language model to author a valid
Recipe from documentation alone. Node positions are the one Recipe field a model has no basis to
invent. With no auto-layout and no rule, three compliant outcomes exist: positions are required (a model
must guess them), positions are optional and absent ones default to the origin (an LLM-authored graph
stacks into one pile — a UJ-3 failure), or positions are absent from the format entirely (an Author's
layout is lost across save/load, breaking UJ-1's "next quarter is Recipe plus three fresh files").

*Fix:* rule positions optional and non-semantic, with a deterministic fallback placement in the loader,
and state that a missing position is never a validation failure.

**Correctly deferred, no divergence risk:** undo/redo (AD-10 already makes commands the record), Recipe
format migration (AD-12 rules refusal instead), and the Consumer's first-run surface (gated on PRD OQ 1,
a UX decision over machinery that is decided here).

---

## Dimension 4 — Does it cover the driving spec's capabilities?

**Verdict: adequate.**

The Capability map's FR ranges union to exactly FR-1..FR-39 with no gap and no invented number. The
grouping is a defensible re-cut of the PRD's six feature groups: §4.1 is split into loading
(FR-1–FR-8, FR-39) and typing (FR-9, FR-10), §4.2 into graph (FR-11–FR-18) and execution (FR-19, FR-34,
FR-38) with the Editor surface pulled out separately, and §4.5/§4.6 map straight across. Every group's
"Lives in" resolves to a real seed directory except the three noted in the mechanical section.

### 4.1 — FR-37 is mapped to the wrong adapters — **HIGH**

Cross-reference to 3.1. *Location: Capability map, Export row.* Grouping FR-36 and FR-37 under
`adapters/{csv,json,xlsx,parquet}` behind `TableWriter` makes a document export look like a fifth data
format. *Fix: split the row.*

### 4.2 — The Clipboard port has no adapter directory — **MEDIUM**

*Location: Capability map row "LLM collaboration"; Structural Seed `adapters/`.*

Every other port has one. Clipboard is crossed by FR-27, FR-28, FR-29 and FR-30 — the whole LLM
protocol — and clipboard access from an opaque `file://` origin is exactly the kind of edge constraint
AD-2, AD-3 and AD-17 exist to keep out of the core. Its absence reads as "the UI just calls
`navigator.clipboard`", which puts a browser API in a `ui/` component instead of behind the port the
map already cites.

*Fix:* add `adapters/clipboard/` to the seed.

### 4.3 — The "Governed by" column under-links several rows — **LOW**

*Location: Capability map.* Typing (FR-9, FR-10) cites AD-7 and AD-13 but not AD-11 or AD-14, though the
type record is Recipe content that the one validator must accept and refuse. Export cites AD-15 and
AD-18 but not AD-13 (an export failure is a Diagnostic) or AD-12. Recipes cites AD-16 but the row also
covers FR-22's Pre-flight, which is AD-13's aggregation surface.

### 4.4 — Two seed directories appear in no map row — **LOW**

`core/diagnostics/` and `app/` are in the seed and in no capability. Both are cross-cutting; the map has
no row for cross-cutting concerns, for the composition root, or for the build and test envelope (see
5.2).

---

## Dimension 5 — Is every dimension this altitude owns decided, deferred or open?

**Verdict: thin.** The domain dimensions are all ruled. The operational and environmental envelope —
build, distribution, environments, versioning, operations — is mostly silent, and where it is not, the
rulings sit in a table the spine itself marks as overridable.

CI/CD, orchestration, monitoring and on-call are correctly absent and are not counted as gaps. What
follows is this product's actual envelope.

### 5.1 — The browser matrix is silent — **HIGH**

*Location: nowhere; PRD NFR-4.*

NFR-4 is a real decision with real teeth: Chromium (Edge/Chrome 143+) is the lead on a stated project
decision; Firefox 145+ "is *measured* during the first builds rather than assumed, and if it does not
carry the JavaScript-heavy paths it is dropped rather than specially accommodated"; Safari is optional.
Nearly every measurement in this spine is a Chromium/Firefox pair — AD-9, AD-15, AD-16 all cite both.
Yet nothing says which engine's failure blocks a story, whether a Firefox-only defect is a bug or a
data point, or that the Firefox verdict is itself a scheduled decision. Epics will diverge on
acceptance criteria and on how much test matrix to write.

*Fix:* one AD or one convention row: Chromium is the acceptance engine; Firefox is measured and
reported per build, and its failure is recorded rather than accommodated; Safari is untargeted.

### 5.2 — The test envelope is a Stack row, not a rule — **HIGH**

*Location: Stack table, last row; AD-18 second sentence; memlog entry 16.*

The memlog records this as an architect's own decision made by no prior document: Vitest over the pure
core (validator, graph guards, type and locale detection, Step functions, cache keys), Playwright over
the built artifact opened from `file://` for everything that only appears there (blob-URL workers,
IndexedDB, the shared bucket, the one-file assertion). In the spine that decision survives as a table
row — under a heading that says "Seed … The code owns this once it exists" — plus one clause inside
AD-18. So the one dimension the architect actually decided fresh is the one recorded as overridable.

*Fix:* promote it to an AD: what is provable under Vitest, what may only be claimed after Playwright
against the built artifact from `file://`, and that no `file://`-specific behaviour counts as done on
Vitest evidence alone.

### 5.3 — Dev-vs-artifact parity is unruled — **MEDIUM**

*Location: nowhere; AD-9, AD-15, AD-16, AD-17 all depend on it.*

A Vite dev server serves an `http://localhost` origin. There, `SharedArrayBuffer` exists, module workers
work, `fetch` succeeds, storage is per-origin rather than one shared bucket, and the origin is not
opaque — every single constraint AD-9, AD-15, AD-16 and AD-17 encode evaporates. The addendum documents
the resulting failure mode explicitly: the idiomatic worker form "silently breaks the single-file build,
and fails at runtime with no build-time signal". Nothing in the spine forbids building a feature that
only works under `npm run dev`.

*Fix:* one rule: the built artifact opened from a `file://` URL is the only environment a capability may
be accepted in; the dev server is a convenience with different physics and is never a target.

### 5.4 — Dependency and version policy is silent — **MEDIUM**

*Location: Stack table.*

Only Arquero is described as "pinned and vendored". The addendum records hazards that are exact-version
facts: `hyparquet-writer`'s `GZIP` codec "silently writes an unreadable file", `read-excel-file` 9.3.5
hardcodes `CAN_USE_WORKER = false`, Tailwind's preflight must be dropped by deleting one import line,
ECharts must register one renderer. Nothing rules exact pinning over ranges, lockfile commitment, a
vendoring policy, or what an upgrade must re-measure.

*Fix:* a convention row: every dependency pinned exactly, lockfile committed, and any version bump
re-runs the Playwright artifact suite before it is accepted.

### 5.5 — Distribution and the file-out path are silent — **MEDIUM**

*Location: nowhere; NFR-1; FR-20, FR-24, FR-36, FR-37.*

This product's entire distribution model is "one HTML file, copied". Unruled: the artifact's file name
(the PRD says `querbeet.html` and AD-16's own Prevents line depends on it), and — more consequentially
— **how bytes get from the application to the user's disk**. `TableWriter` produces bytes; no port owns
saving them. Every export path (Recipe, Package, four data formats, view document) needs the same
Blob + `a[download]` mechanism from an opaque origin, and FR-37's likely print-to-PDF route
deliberately does not use it (PRD OQ 11).

*Fix:* name the file-out boundary — a `FileSink`/download port or an explicit rule that `ui/` owns it —
and fix the artifact name.

### 5.6 — Runtime failure behaviour is silent — **MEDIUM**

*Location: Consistency Conventions, row "State — errors".*

The convention covers port failures (a Diagnostic) and says the core throws only on a programming
error. Nothing says what happens when that throw escapes. In a single-file page with no logging
framework and no telemetry (conventions, "Cross-cutting — logging"), an unhandled error is a white
page — for a tool whose entire thesis is that a failure must never look like a plausible result, and
whose session state (FR-25) must remain deletable afterwards.

*Fix:* one rule for a top-level error boundary: an escaped error renders a named failure state that
keeps the stored session reachable and deletable, and never a blank document.

### 5.7 — Two correctness invariants are demoted into the Stack seed — **MEDIUM**

*Location: Stack table, rows "PapaParse" and "Apache ECharts"; heading text "The code owns this once it
exists".*

Two entries in that table are not version choices, they are silent-corruption defences of exactly the
class the ADs exist for:

- **`dynamicTyping` permanently off.** With it on, PapaParse converts German `"1.234"` to `1.234` — the
  FR-9 defect, three orders of magnitude, invisible in the Result.
- **SVG renderer registered alone.** In canvas mode `getDataURL({type:'svg'})` "returns a PNG silently,
  with no error", so registering both renderers makes FR-37's vector-chart requirement degrade to raster
  undetected.

Sitting in a table the spine declares the code may override, they are seed, not invariant.

*Fix:* move both into ADs (or a conventions row) binding FR-9 and FR-37 respectively, with the silent
failure named in the Prevents line. Leave the version numbers in the Stack.

### 5.8 — The chart-tile settings the research says are owed have no rule — **MEDIUM**

*Location: `ChartRenderer` port; Capability map row "Result view and Dashboard"; addendum §2.*

Three measured obligations come with ECharts and bind every Tile kind (FR-35) and the printed document
(FR-37): a long-label strategy, because a 60-character category label escapes the SVG by 15–21 px;
`barMaxWidth`, or a single-category tile renders as a 237 px slab in a 346 px plot; and an explicit
`resize()` on tile size change, because ECharts does not observe its container. Five Tile kinds will
otherwise each answer these separately.

*Fix:* one AD or convention row on the `ChartRenderer` port: these three are properties of the port, not
of a Tile.

### 5.9 — The memory envelope is unruled — **LOW**

*Location: AD-6, AD-8.*

The registry holds every raw Source, the cache holds every Step result including superseded ones, Vue
Flow holds 0.32–2.76 MB, and one 100k×20 Source is ~94 MB live against a half-million-row total target.
No budget, no eviction, no rule on what is released when a Source is removed or a Recipe swapped. AD-7's
Step-zero decision explicitly buys "no second in-memory copy" — the spine cares about this and then does
not bound it.

### 5.10 — CSP is neither decided nor deferred — **LOW**

*Location: nowhere; addendum §3 last bullet.*

A `<meta http-equiv="Content-Security-Policy">` in the single file would be the cheapest possible
enforcement of NFR-2 ("verifiable from the built artifact") — and Arquero requires `unsafe-eval` for
dynamic function compilation, so it interacts directly with AD-1's engine. Silent in both directions.

*Fix:* one line, either way. If no CSP, say so and say why, so nobody adds one and breaks the engine.

---

## Dimension 6 — Is it a build substrate: terse, convergent, invariants heavy, seed minimal?

**Verdict: adequate.** The shape is right — eighteen ADs each with Binds / Prevents / Rule, a
conventions table, a minimal seed, three diagrams, no narrative sections. What breaks it is that
several Rules argue their case inside the ruling, and in every instance the argument is already in the
memlog, which is where it belongs.

### 6.1 — AD-5's Rule argues with its own source — **MEDIUM**

*Location: AD-5, sentences 3 and 4.*

The Rule contains a bolded supersession notice against the addendum ("**This supersedes the addendum's
seam wording, which names plain arrays of objects as the boundary contract; replaceability is preserved
but now lives in the interface rather than in the row shape.**") and then an admission that the cost it
optimises is unmeasured ("The per-boundary conversion cost this avoids is unmeasured — R4 measured only
the whole pipeline, at 263–446 ms for 100,000 rows"). Both are already in memlog entry 17, which also
records `UPSTREAM ACTION OWED: addendum section 5 must be corrected`. A Rule that debates its own
provenance cannot be applied.

*Fix:* the Rule keeps the boundary contract and the edge list. The supersession goes to the memlog (it
is there) and the addendum gets corrected, as the memlog already says it must.

### 6.2 — Three Rules carry measurement prose — **MEDIUM**

*Location: AD-9, AD-15, AD-16 Rules.*

- AD-9: latency figures for two engines, progress overhead, and a `SharedArrayBuffer` narrative ending
  in "a `typeof` check reports the opposite of the truth".
- AD-15: four structured-clone timings across two engines and two dataset sizes, against the pipeline
  total.
- AD-16: the R9 cross-directory experiment retold, plus `navigator.storage.persist()` "never settles in
  Firefox from `file://` and deadlocked a probe's startup for 180 s".

Each is good evidence and none of it is a rule. The one number that *is* a rule — `~5 ms chunks` — should
stay.

*Fix:* strip to the ruling, keep the numbers that are thresholds, move the rest to the memlog.

### 6.3 — The Design Paradigm section argues — **LOW**

*Location: "Design Paradigm", paragraphs 2 and 3.*

"Two properties of this product decide the paradigm…" is a justification, duplicated close to verbatim
in memlog entry 9. The bolded paradigm line and the layer table are the substrate; the rest is the
record of a choice.

### 6.4 — Deferred entries argue instead of ruling — **LOW**

*Location: Deferred bullets 1, 3.*

"Blocks nothing else." "AD-10 makes it cheap later — the commands are already the record — which is why
it is deferred rather than designed around." A deferral needs two facts: what is open, and what may not
be broken while it stays open (see 3.1–3.3, all of which are the missing second fact).

### 6.5 — Spike provenance inside Rules — **LOW**

*Location: AD-10 ("which the Editor spike measured as containing no cycle detection at all"), AD-14
("the authorship spike measured that working with this shape").*

Both rules are correct and both would be shorter without the citation. Memlog entries 12 and 15 already
hold them.

---

## Summary of findings

| # | Sev | Dimension | Finding |
| --- | --- | --- | --- |
| 1.1 | critical | 1 | Transformation engine has no port, no adapter dir, no legal import path; AD-1 and AD-5 conflict |
| 1.2 | high | 1 | Arquero's five measured silent-corruption hazards have no single absorption point |
| 1.3 | high | 1 | Step kinds have only an execute contract; FR-12/13/21/22 need schema introspection |
| 1.4 | high | 1 | Table virtualization unruled across four surfaces; mandatory spacer guard unowned |
| 1.5 | high | 1 | NFR-7's keyboard/drag correctness rule unbound (not an accessibility finding) |
| 2.1 | high | 2 | AD-16 Prevents claims what its Rule cannot deliver and FR-25 calls unavoidable |
| 3.1 | high | 3 | FR-37 deferral claims a port that does not exist; boundary is open |
| 4.1 | high | 4 | FR-37 mapped to the tabular export adapters behind `TableWriter` |
| 5.1 | high | 5 | Browser matrix (NFR-4) entirely silent |
| 5.2 | high | 5 | Test envelope recorded as an overridable Stack row, not a rule |
| M-1 | medium | mech | Frontmatter `binds:` claims NFR-4/5/7/9, none of which appear in the body |
| 1.6 | medium | 1 | NFR-9 unbound; AD-11 depends on it |
| 1.7 | medium | 1 | Value formatting has two consumers and no single owner |
| 1.8 | medium | 1 | View/data boundary (FR-32, FR-33) has no home or shared vocabulary |
| 2.2 | medium | 2 | AD-9 names a message-queue mechanism for a main-thread scheduler |
| 2.3 | medium | 2 | AD-13's shape cannot carry the counts FR-13/14/15/18 require |
| 2.4 | medium | 2 | AD-10's command vocabulary neither closed nor complete |
| 3.2 | medium | 3 | Package deferral leaves extension, discrimination, version placement open |
| 3.3 | medium | 3 | Auto-layout deferral leaves node positions in the Recipe undecided |
| 4.2 | medium | 4 | `Clipboard` port has no adapter directory |
| 5.3 | medium | 5 | Dev-server vs `file://` artifact parity unruled |
| 5.4 | medium | 5 | Dependency pinning / lockfile / upgrade discipline silent |
| 5.5 | medium | 5 | Distribution and the file-out (download) path silent |
| 5.6 | medium | 5 | Runtime failure behaviour / top-level error boundary silent |
| 5.7 | medium | 5 | `dynamicTyping` off and SVG-only demoted into the Stack seed |
| 5.8 | medium | 5 | ECharts long-label / `barMaxWidth` / `resize()` obligations unruled |
| 6.1 | medium | 6 | AD-5's Rule contains a supersession argument and a missing-measurement caveat |
| 6.2 | medium | 6 | AD-9, AD-15, AD-16 Rules carry measurement prose |
| 1.9 | low | 1 | Seed thinnest (`ui/`) where the build is heaviest |
| 2.5 | low | 2 | Cache unbounded, no eviction |
| 2.6 | low | 2 | AD-12's build-version clause has no source |
| 2.7 | low | 2 | AD-5's interface unnamed and unenumerated |
| 4.3 | low | 4 | Capability map "Governed by" under-linked on three rows |
| 4.4 | low | 4 | `core/diagnostics/` and `app/` in no map row; no cross-cutting row |
| 4.4b | low | 4 | ER diagram omits `COLUMN_ANNOTATION` |
| 5.9 | low | 5 | Memory envelope unruled |
| 5.10 | low | 5 | CSP neither decided nor deferred (Arquero needs `unsafe-eval`) |
| 6.3 | low | 6 | Design Paradigm section argues; duplicated in memlog |
| 6.4 | low | 6 | Deferred entries argue instead of ruling |
| 6.5 | low | 6 | Spike provenance cited inside AD-10 and AD-14 Rules |

## The five to fix before handoff

1. **1.1** — give the transformation engine a port and an adapter, and reconcile AD-1 with AD-2 on pure
   libraries. Every Step story is blocked on this reading.
2. **3.1 / 4.1** — define the view-document port, or state honestly that FR-37's boundary is open.
3. **1.4 + 1.3** — the table-rendering AD and the Step descriptor. Both are touched by most epics.
4. **5.1 + 5.2** — browser matrix and test envelope, as rules rather than table rows.
5. **2.1 + 2.3** — AD-16's Prevents line and AD-13's payload. Both are wrong in a way that will be
   discovered during implementation rather than during review.
