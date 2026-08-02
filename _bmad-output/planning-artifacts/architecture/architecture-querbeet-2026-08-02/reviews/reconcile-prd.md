---
title: 'Reconciliation — PRD against ARCHITECTURE-SPINE'
type: review
date: '2026-08-02'
input: '_bmad-output/planning-artifacts/prds/prd-querbeet-2026-08-01/prd.md'
target: '_bmad-output/planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md'
also_consulted: '_bmad-output/planning-artifacts/prds/prd-querbeet-2026-08-01/addendum.md'
verdict: 'coherent spine, 14 requirements without an architectural home, 6 architectural consequences drawn wrong'
---

# Reconciliation: PRD → Architecture Spine

## What this is

The PRD is the driving specification: 39 functional requirements, 9 non-functional
requirements, 4 user journeys, non-goals, MVP scope, success metrics, 11 open questions. The
spine is the architecture derived from it, claiming in its frontmatter to bind
`FR-1..FR-39, NFR-1..NFR-9` — all 48.

This document walks every one of them and reports what did not land. It reports two kinds of
failure and keeps them apart, because they need different repairs:

- **Unhoused** — a requirement or constraint with no place in the structure where it would be
  built, and no rule that governs it. The build will invent something.
- **Miscarried** — a requirement that has a home, but the spine drew the wrong architectural
  consequence from it. The build will follow the spine and produce something the PRD forbids.

Nothing here disputes the paradigm. Hexagonal with a pipes-and-filters core is the right
shape for this product and the spine's two justifications for it — three doors into one
validator, and every hard constraint sitting at an edge — are the correct reasons. The spine
is also right where it is most easily wrong: it did not cut MVP scope (see §5), it honoured
FR-37's vector-chart requirement in the stack (`ECharts 6.1.0, SVG renderer registered
alone`), and it correctly narrowed PRD Open Question 1 to the Consumer's presentation rather
than freezing the Recipe machinery.

The findings below are ordered by consequence within each part.

---

## 1. Unhoused — requirements with no architectural home

### U-1. The disclosure boundary has no choke point `[severity: critical]`

**PRD.** This is the product's central promise, stated in §1 and enforced across four FRs, one
NFR and one out-of-scope item.

> §1: "querbeet hands an LLM a structural profile of the loaded Sources together with the
> user's own Column Annotations — never the raw values"

> FR-27: "**Everything that would leave the machine is visible in the block. There is no
> hidden portion.**"

> FR-29: "The result is displayed to the user before any return step. The user copies the
> result back only after seeing it."

> FR-30: "The samples that would be sent are shown before they are sent."

> NFR-8: "Cell values leave the browser only through an export the user triggered, or through
> an LLM disclosure the user saw and confirmed before copying it. **There is no other path
> out.**"

> §6.2: "An optional stored API key that automates the same exchange is the first item in the
> post-MVP backlog; **it must, when built, send exactly what the copy-paste block would have
> contained, so it can never become a second and laxer disclosure path.**"

**Spine.** AD-17 forbids `fetch` — that is network silence (NFR-2), a different property. The
`Clipboard` port exists in the ports list and in the LLM row of the Capability Map. Nothing
anywhere states that what reaches the `Clipboard` port must be exactly what was rendered to
the user, or that nothing else may reach it. `core/profile` holds "Column Profile and the
FR-27 prompt block" — the producer — but the producer is not the boundary.

**Why this is the most important gap.** Every other requirement in this document affects
correctness. This one affects the claim the product is sold on. With the copy-paste channel
alone the risk is modest — a UI that renders one string and copies another is an unlikely
bug. The risk is structural and it is dated: §6.2 requires a future API adapter to send
*exactly* the block, and a future adapter cannot be held to that unless today's architecture
puts one object between the profile and the outside world. Built as the spine currently
stands, the API path is a new adapter beside the `Clipboard` port, and "exactly what the block
would have contained" becomes a code-review promise instead of a structural one.

**What closes it.** A new AD, and it should be one of the first:

> **AD-N — One disclosure boundary.** Everything that may leave the machine on the LLM path is
> produced as a single immutable `Disclosure` value in `core/profile`: the prompt block
> (FR-27), a Probe Query result (FR-29), released samples (FR-30). A `Disclosure` carries the
> exact bytes and nothing derived later. The UI renders that value and no other; the
> `Clipboard` port accepts a `Disclosure` and no other type; no adapter may construct one. A
> `Disclosure` is produced only after the user has seen it. Sample release (FR-30) is a
> per-exchange argument to the constructor and is never read from the Recipe.

Rename the port `Disclosure` rather than `Clipboard` — a port is a noun of role, not of
technology, which is the spine's own convention, and `Clipboard` names the transport that
§6.2 says will change.

---

### U-2. Nothing retains the source bytes, so seven requirements cannot re-parse `[severity: critical]`

**PRD.** Seven requirements need the file as delivered, after it has been parsed:

> FR-2: "The chosen encoding is displayed per Source and can be changed, **which re-reads the
> file**."

> FR-3: "Files with preamble lines before the header can be handled by setting the header row
> to a later line; the Preview updates to match." (delimiter and header row, both correctable
> after load)

> FR-7: "The choice is made per Source at import, is visible afterwards, **can be changed
> without reloading the file**, and is stored in the Recipe."

> FR-6: "The user can see **the differences between the file as delivered and the file as
> parsed**."

> FR-8: "A JSON or NDJSON Source additionally offers a **structure view: the original nested
> document as a collapsible tree, independent of the flattening.**"

> FR-39: "**The affected rows stay inspectable in their raw form**, so the user can decide what
> happened."

> FR-24: "The user can export a Recipe bundled with **the data of its Sources**."

**Spine.** AD-7 defines what the registry holds:

> "the registry holds **raw parsed tables** — values as delivered."

"Raw parsed" is past the point where any of the seven are possible. Once PapaParse has run
with a delimiter and a header row, the delimiter cannot be changed without the bytes; once
`jsonrepair` has run, the delta of FR-6 is gone; once JSON has been flattened under an array
strategy, the nested document of FR-8's structure view is gone. AD-3 is explicit that "a
browser `File` … never reaches `core/`", which is correct, but nothing then says who keeps the
bytes, where, or for how long. The Structural Seed has `core/exec` holding "the registry" and
`adapters/{csv,json,xlsx,parquet}` behind `SourceReader`. There is no byte store in either.

The problem compounds under FR-25. A restored session has no `File` handle at all — the
browser cannot hand one back — so after a reload, changing an encoding or an array strategy is
impossible unless the bytes were persisted alongside the parsed table. FR-25 promises the
session comes back; it does not promise it comes back degraded.

**What closes it.**

> **AD-N — A Source retains its bytes and its parse settings; parsing is a pure re-runnable
> function.** The registry holds, per Source, the original bytes, the parse settings
> (encoding, delimiter, header row, array strategy, repair applied), the parsed table, and —
> for a repaired or damaged Source — the repair delta and the raw text of the affected rows.
> `SourceReader` is `(bytes, settings) => { table, diagnostics, artifacts }` and is called
> again on every settings change; no adapter holds state between calls. The bytes are what
> `SessionStore` persists and what a Package embeds, so FR-24 and FR-25 write the same thing.

Decide explicitly whether the bytes are stored raw or re-encoded to Parquet for the Package
(the spine's Deferred section leaves the Package container open, which is fine — but it should
record that the container's *input* is bytes, not a table, or the decision will be made by
whoever writes the adapter first).

---

### U-3. There is no channel for "unresolved — the user must decide" `[severity: high]`

**PRD.** Five requirements demand that the system stop and ask rather than proceed. This is
the §4 theme in mechanical form:

> §4: "querbeet's characteristic failure mode is a plausible wrong number, not an error
> message."

> FR-3: "When the delimiter cannot be determined, **the system says so explicitly and asks,
> rather than guessing silently.**"

> FR-9: "either one reading carries decisive evidence and the count is shown … or **nothing in
> the column settles it**, and the system says exactly that instead of naming a winner."

> FR-13: "Columns present in only some inputs are **listed to the user before the Step runs**,
> with the choice to map, keep (padded with nulls), or drop them — never dropped silently."

> FR-5: "Repair is offered as an action, not performed automatically on the user's behalf
> without their knowledge."

> FR-7: "Changing the strategy updates the flattened Preview immediately, so the effect on
> column count and row count is visible **before committing**."

**Spine.** AD-13 fixes one Diagnostic shape with `severity: info | warning | error`. All three
are reports about something that already happened. There is no fourth state meaning "this did
not happen and will not until you choose", and no field carrying the options.

AD-4 makes it worse for FR-13 specifically:

> "a Step is `(inputs: Table[], config) => { table: Table, diagnostics: Diagnostic[] }`"

FR-13 requires the union's column reconciliation to be shown **before the Step runs**, with a
choice attached. A function that must return a table cannot express "I have a question and no
table". A Step author following AD-4 literally has exactly two options, and both are wrong:
run with a default and warn afterwards (silent-by-default, which FR-13 names as the failure it
exists to prevent), or throw (which the spine's own error convention reserves for programming
errors).

FR-9's second outcome is the sharper case, because the PRD says explicitly that no comparable
tool has it: "DuckDB documents a tie-break in which dd-mm beats mm-dd silently". A structure
that can only report `warning` will produce a warning next to a chosen winner, which is DuckDB's
behaviour with a nicer message.

**What closes it.** Two changes, and they are small:

- Extend AD-13 with a fourth severity `unresolved`, carrying `options: Option[]` and a
  `resolvedBy` command name. An `unresolved` diagnostic is not advisory: it participates in
  the execution gate of U-4.
- Extend AD-4 to a two-phase Step contract: `plan(inputs, config) => { diagnostics, ready:
  boolean }` and `run(inputs, config) => { table, diagnostics }`. `plan` is where a Union
  reconciles columns, a Join estimates duplication, a Filter type-checks its comparison value
  against the column's confirmed type (FR-15). Both stay pure and synchronous, so nothing in
  AD-4's actual guarantee is lost.

---

### U-4. Three execution preconditions and no admission rule `[severity: high]`

**PRD.** The Pipeline is blocked from running in three distinct situations, by three
different requirements:

> FR-9: "**Running the Pipeline is blocked until confirmation**, and the confirmation is
> stored in the Recipe so the Consumer inherits the Author's decisions."

> FR-22: "**The Pipeline does not execute while any requirement is missing.**"

> FR-38: "In explicit mode, **execution begins only after the Pre-flight Check has been
> shown** (FR-22)"

The PRD treats these as the product's spine, not as polish — SM-C1 names them as the thing not
to optimise away: "The type-confirmation gate (FR-9) and the Pre-flight Check (FR-22)
deliberately cost time, and they are what separate a right number from a plausible one."

**Spine.** The Capability Map routes FR-38 to `core/exec` governed by AD-5, AD-8, AD-9. AD-5 is
about Table handles, AD-8 about cache keys, AD-9 about chunking and cancellation. None of the
three mentions a precondition. AD-7 places confirmed typing in the engine as Step zero, which
is the right place to *apply* a confirmation but says nothing about *requiring* one. The word
"blocked" does not appear in the spine.

A gate implemented in `ui/` — disable the Run button — is the outcome this omission produces,
and it fails the moment a second caller exists: the live mode of FR-38 recomputes without a
button at all, and FR-19's per-Step preview is an execution too. The PRD does not say
"Previews are exempt from the confirmation gate", and the confirmation gate exists precisely so
that no number is shown that was read under an unconfirmed type.

**What closes it.**

> **AD-N — Execution is admitted, never merely started.** `core/exec` exposes one entry point
> and it refuses before it computes. It runs only when: every Source referenced by the
> requested Step has a confirmed type record (FR-9); no Input Contract requirement is `missing`
> (FR-22); no `unresolved` diagnostic is outstanding on any Step upstream (U-3); and in
> explicit mode the Pre-flight result has been acknowledged (FR-38). A refusal returns
> diagnostics naming each unmet precondition. There is no second path into the engine, and
> `ui/` disabling a control is a convenience over this rule, never a substitute for it.

Decide, and write down, whether a Preview is admitted under the same rule. The PRD implies yes;
the build will assume no.

---

### U-5. NFR-7's keyboard rule is bound by nothing `[severity: high]`

**PRD.** NFR-7 marks this out as the one non-negotiable item in a section that otherwise
targets no conformance level at all:

> NFR-7: "One rule is not optional, **because it is a correctness rule rather than an
> accessibility one: no interaction may exist only as a pointer gesture.** Drag-and-drop is
> permitted and encouraged for file input, Step arrangement and Tile ordering — implemented as
> a gesture that computes a target and updates the underlying model, never as a library that
> reorders DOM nodes itself … Every such action also has a keyboard-reachable path."

It recurs inside two FRs:

> FR-12: "The graph is navigable and editable by keyboard. Where a pointer gesture such as drag
> exists, it is an addition to a keyboard-reachable path and never the only way to perform an
> action."

> FR-35: "order changes through keyboard-reachable controls and size through three preset
> steps."

**Spine.** NFR-7 appears once, in the frontmatter `binds` list. No AD mentions keyboard,
pointer, drag or gesture. AD-10's "`ui/` never mutates the model … One watcher projects the
model outward with `setNodes`/`setEdges`; nothing else writes to the editor library" happens to
satisfy the second half of NFR-7 for the graph — the model is the single truth — but it is
stated as a race-condition rule for one library, so it does not carry to Tile ordering (FR-35)
or file drop (FR-1), and it says nothing about keyboard reachability at all.

The addendum records that this is a live open item, not a solved one:

> addendum: "**Connecting two Steps is the one gap**, and it waits on a UX decision rather than
> on anything technical, since `connectOnClick` is already on and its click path ends in the
> same guarded door as the drag."

So the spine dropped a binding constraint *and* the one known outstanding instance of it.

**What closes it.** Promote it to an AD, because it is a rule about how every interaction is
built, which is exactly what an AD is for:

> **AD-N — Every interaction is a command; a pointer gesture is one way to issue it.** No
> interaction exists only as a pointer gesture (NFR-7). A drag computes a target and issues the
> same named command (AD-10) a keyboard path issues; no library reorders DOM nodes as its own
> source of truth. This binds file drop (FR-1), Step arrangement and connection (FR-12), and
> Tile ordering and sizing (FR-35). Open: the keyboard path for connecting two Steps.

---

### U-6. Virtualization and the Firefox spacer guard are missing entirely `[severity: high]`

**PRD.** The spacer guard is not a suggestion in the PRD — NFR-4 says it is built regardless of
the browser decision:

> NFR-4: "One consequence is already known and is not a reason to keep Firefox: **Firefox is
> the stricter engine on the scroll-extent limit, collapsing an oversized spacer to zero height
> at roughly 614,000 rows** where Chromium clamps and keeps working — **so the spacer guard is
> built regardless of whether Firefox stays a target.**"

Three FRs rest on the same structure:

> FR-31: "Scrolling through a hundred thousand rows stays smooth, and **the scroll position maps
> to the correct rows throughout**."

> FR-32: "View filters are set from the column headers and **apply to the full Result, not to
> the rendered window.**"

> FR-33: "**Search runs over every row of the Result, not over the DOM.**"

The addendum adds the mechanism and two prohibitions: "Hand-rolled fixed-height row windowing,
~50-row window; no column virtualization", "Fixed row height is the default, not a compromise",
"Do not build column virtualization", "Guard the spacer height, and note that the margin
shrank … The guard is no longer a precaution against a case that cannot arise — build it."

**Spine.** No mention of virtualization, windowing, row height, spacer, or scroll extent
anywhere. The Capability Map assigns FR-31 – FR-35 to "`ui/`, `adapters/echarts`" governed by
"AD-6, AD-10". AD-6 keeps datasets out of Vue's reactivity — necessary, unrelated. AD-10 is
about command-based mutation. Neither has anything to do with rendering a hundred thousand
rows, and the spine's own Stack table does not list a virtualization approach where it lists
every other library decision.

This is the single largest silent narrowing in the document: a measured, mandatory,
engine-specific structural provision that the driving spec calls out by name, absent from the
architecture derived from it. It is also the one most likely to be discovered late, because a
hand-rolled windowed table works perfectly at every size a developer tests by hand.

**What closes it.** An AD, and a Stack row:

> **AD-N — The table view is a window over a Table handle, never over a materialized array.**
> Rows are fixed-height and windowed (~50 rows); no column virtualization. The scroll spacer is
> guarded: above the engine limit — Firefox collapses an oversized element to zero height at
> ~17.2 M px, ~614,000 rows at 28 px — the spacer is capped and the mapping from scroll offset
> to row index is scaled. View filter, sort and search resolve against the full Table (FR-32,
> FR-33), never against rendered DOM.

---

### U-7. Responsiveness is an engine-local invariant; the PRD asks for it in five other places `[severity: high]`

**PRD.** Six separate requirements carry a responsiveness or progress clause:

> FR-8: "The Preview renders within an interaction-responsive time regardless of Source size."

> FR-9: "**Detection reads every value in the column, not a sample.**"

> FR-25: "Storing and restoring a session at the upper end of NFR-3 **shows progress and leaves
> the interface responsive**, on the same terms as FR-36's exports."

> FR-33: "Searching a hundred thousand rows returns within an interaction-responsive time."

> FR-36: "An export that takes noticeably long shows progress and does not freeze the
> interface."

> FR-38: "An execution long enough to be noticed shows progress and leaves the interface
> responsive."

**Spine.** AD-9 provides exactly one mechanism — a scheduler that yields between chunks and
cancels through the message queue — and binds it to "FR-34, FR-38, NFR-3", scoping it to
`core/exec`. AD-15 covers FR-36 with a worker. Everything else is uncovered:

- **FR-9 is the worst of them.** A full-column scan is mandated by the PRD as the correctness
  differentiator, and the addendum sizes it: "Budget type detection as rows × columns ×
  **candidates tried** … Luxon at 356 ms per 100,000 values *per candidate* … roughly 7 s for a
  100k × 20 Source." Type detection runs at load, outside `core/exec`, and therefore outside
  AD-9. As the spine stands, the correctness rule the product is built on is a multi-second
  main-thread freeze with no progress and no cancellation.
- **FR-25** at half a million rows: AD-16 covers the storage bucket and the `persist()` hazard
  and says nothing about chunking the write. AD-15 explicitly forbids a worker here ("Workers
  exist only for the two exports"). The PRD calls this out with its own measurement:
  "projected to half a million it lands on that threshold in Firefox … the affordance is
  required rather than optional."
- **FR-33** search: the PRD's Open Question 7 records "full-dataset search needs neither a
  worker nor an index", which answers *where* it runs, not *whether it yields*.

**What closes it.** Widen AD-9 from an engine rule to a platform rule: "any operation over a
full column or a full table yields to the event loop on the same chunked, cancellable
scheduler, wherever it runs — type detection, profile computation, search, session write and
restore, export." Then the one mechanism has one home and every long operation inherits
progress and cancellation instead of re-deriving them.

---

### U-8. Nothing bounds memory; the cache has no eviction `[severity: high]`

**PRD.**

> NFR-3: "The design target is roughly 100,000 rows per Source and on the order of half a
> million rows in total across all Sources … **There is no limit on the number of Sources and
> no artificial row cap**"

> FR-1: "There is no limit on the number of Sources; the operative constraint is total row
> count (NFR-3)."

**Spine.** Three structures hold tables and none is bounded:

- AD-6's registry: every Source's raw parsed table.
- AD-7's Step zero: the typed table for every Source, "cached like any other Step".
- AD-8's content-addressed cache: "An edit that returns a configuration to a previous value
  returns to a previous key and reuses the entry" — which is only true if entries are never
  dropped, and the AD says nothing about when they are.

At the NFR-3 upper bound this is half a million rows raw, plus half a million typed, plus one
cached intermediate per Step per distinct configuration ever tried during an editing session,
retained for the life of the tab. AD-8's stated benefit — undo-by-retyping hits the cache — is
precisely the property that forbids eviction, so the AD argues against its own missing rule.

**What closes it.** Add to AD-8: a bounded cache with a stated policy (LRU by rows retained,
with a stated budget), pinning the Result Step and the currently previewed Step, and evicting
recomputable intermediates first. State the memory budget as a number somewhere, since NFR-3 is
otherwise a promise about row counts with no promise about the machine.

---

### U-9. A "run" has no identity, but two requirements report on one `[severity: high]`

**PRD.**

> FR-34: "The Dashboard shows **whether the run that produced it** was clean. … The status
> summarises the Pre-flight Check outcome, every warning raised by any Step during the run,
> whether any Source was repaired (FR-6), and **whether the duplicate audit (FR-14) was on.**"

> FR-37: "The document **names the Recipe that produced it, the date, and the Sources by
> name** … The run status (FR-34) is reproduced in the document."

**Spine.** AD-13 defines the run status as a pure aggregation:

> "FR-34's run status is **the aggregation of this stream and adds nothing of its own.**"

That is wrong on four counts, and each is a fact FR-34 or FR-37 requires that is not a
diagnostic emitted by a Step:

1. **Whether the duplicate audit was on** is a configuration fact about a Join, not something
   the Join reports. A Join with the audit off emits no diagnostic saying so.
2. **The Pre-flight outcome** includes requirements reported as `fits` — a clean result that
   emits no warning but must appear in the status.
3. **The date** (FR-37). AD-4 forbids a clock in a Step — "No I/O, no clock, no randomness" —
   correctly. There is no `Clock` port in the ports list, so nothing in the architecture can
   supply the date the Boxchecker's document depends on.
4. **The Recipe name and the Source names** (FR-37) are model facts, not diagnostics.

There is a deeper problem underneath. AD-8's content-addressed cache plus AD-9's incremental
recomputation mean that in live mode the Result's diagnostics are assembled from cache entries
produced at different moments under different configurations. "The run that produced it" is
then not a well-defined object at all — and FR-34's promise, that a Consumer can tell at a
glance whether what they are looking at is clean, depends on it being one.

**What closes it.** Give a run an identity, and make the status a first-class artifact:

> **AD-N — A run is an object.** Executing the Result Step mints a `Run`: an id, a timestamp
> from the `Clock` port, the Recipe name and version, the Source names, the Pre-flight outcome
> in full, the per-Step audit settings in force, and the diagnostics of every Step that
> contributed. Diagnostics reused from cache carry the key they were computed under, so a Run
> is coherent by construction or reports itself as mixed. FR-34 renders a Run; FR-37 embeds
> one.

Add `Clock` to the ports list. It is two lines and it is the only way AD-4 and FR-37 can both
hold.

---

### U-10. NFR-9 — "nothing is typed" — is enforced nowhere `[severity: medium-high]`

**PRD.** NFR-9 is a whole-product rule with two independent justifications, one of which is
architectural:

> NFR-9: "Every transformation the product performs is assembled by choosing from what the
> interface offers … **No syntax is entered: no formula, no expression, no query, no script.
> This is a rule about the whole Step vocabulary** and not only about computed columns (FR-17)
> … For the machine it is what makes FR-28 tractable — a fixed set of configured Steps is a
> data structure a model emits and a validator checks, while a syntax invites a model to
> produce something the parser has never heard of."

And the forward constraint on lifting it:

> §5: "**the clicked path stays complete**, so typing is never the only way to reach a
> capability; and anything typed still has to serialise into a Recipe that a Consumer can run
> and a validator can check"

> FR-17: "The resulting configuration is a plain data structure with no free text to parse, so
> an LLM can emit it and the system can validate it."

**Spine.** NFR-9 appears once, in `binds`. No AD or convention forbids a parsed syntax. The
`Deferred` section does not carry the §5 forward constraint either.

The rule also needs a boundary drawn, and the spine is the place to draw it: free text is
permitted and required in several places — Column Annotations (FR-10), Step names (FR-12),
Recipe description (FR-20), the search string (FR-33), a filter comparison value typed into a
locale-aware field (FR-15). The rule is not "no text input"; it is "no text is parsed into
behaviour". A build team without that distinction written down will either over-apply it or
quietly break it with the first "small expression field".

**What closes it.**

> **AD-N — No text is parsed into behaviour.** A Step's configuration is a closed data
> structure: kind, column references, an operator or aggregation from a fixed enumeration, and
> literal values in canonical form. Free text exists only as data the system never interprets —
> names, descriptions, annotations, a search string. Nothing in `core/steps` parses a string
> into an operation (NFR-9). A future typed path (§5) must compile to this same structure and
> may never reach a capability the clicked path cannot.

---

### U-11. The Recipe model in the spine is smaller than the Recipe in the PRD `[severity: medium-high]`

**PRD.** The Glossary and FR-20 enumerate the contents:

> Glossary: "A JSON file holding the Pipeline — Steps, their configurations and their
> connections — **plus the Column Annotations, the type confirmations, the Dashboard
> definition, and the Input Contract.**"

> FR-20: "A Recipe carries **a name and a free-text description the Author writes for the
> Consumer.**"

Four more things are stored in it by other FRs:

> FR-3: "Both settings are stored in the Recipe." (delimiter, header row)
> FR-7: "…and is stored in the Recipe." (array strategy)
> FR-9: "The user can declare which tokens count as missing in a column … **a first-class part
> of the column's confirmed typing rather than a display setting**"
> FR-23: "**Mappings can be saved back into the Recipe**, so the same correction is not
> repeated next month."

And one negative rule:

> FR-30: "**The setting does not persist into the Recipe**; a Consumer never inherits an
> Author's disclosure decision."

**Spine.** The ER diagram is the spine's definition of the Recipe:

```
RECIPE ||--o{ STEP · EDGE · SOURCE_CONTRACT ; RECIPE ||--|| DASHBOARD
SOURCE_CONTRACT ||--o{ COLUMN_TYPE_RECORD
```

Missing: Column Annotations, the Recipe name and description, per-Source parse settings
(encoding, delimiter, header row, array strategy), and saved column mappings. `core/types` does
name "missing-value tokens", so that one is housed.

Annotations are the notable one, because the spine files FR-10 under `core/types` in the
Capability Map — an annotation is not a typing concern; it is a Recipe field and a Column
Profile input (FR-26), and filing it under typing is how it ends up attached to a type record
and lost when a type is re-confirmed.

FR-30's negative rule matters more than it looks: AD-14 requires a byte-identical round trip
enforced by a test, and the canonical serializer is the only thing that can guarantee sample
release never leaks into a saved Recipe. That guarantee should be an explicit exclusion in the
serializer, not an emergent property of what the UI happens to write.

**What closes it.** Extend the ER diagram and name the serializer's exclusion list. One extra
entity — `SOURCE_IMPORT_SETTINGS`, per expected Source — covers FR-2, FR-3, FR-7 and FR-23
together, and is what the Pre-flight Check needs anyway to know how to parse the Consumer's
file.

---

### U-12. FR-32 and FR-33 are filed in `ui/`, and FR-32 cannot be `[severity: medium-high]`

**PRD.**

> FR-32: "View filters … **apply to the full Result, not to the rendered window** … **A single
> action converts the active view filters into a Filter Step** inserted before the Result Step,
> after which they are data and are stored in the Recipe."

> FR-33: "Search runs over every row of the Result, not over the DOM."

**Spine.** Capability Map: "Result view and Dashboard (FR-31 – FR-35) | `ui/`,
`adapters/echarts` | AD-6, AD-10". `core/` has `recipe graph steps exec types profile
diagnostics` — no module for a view query.

FR-32's promotion clause makes the placement untenable rather than merely untidy: for a view
filter to become a Filter Step in one action, the view filter must already be expressible in
the Filter Step's configuration vocabulary — including FR-15's canonical comparison values and
its type-agreement refusal. Built in `ui/`, the view filter grows its own predicate
representation and the "single action" becomes a translation layer that can silently disagree
with the Step it produces. That disagreement is exactly the class of defect the PRD calls
characteristic: the view showed 143 rows, the promoted Step returns 142, and nothing errors.

AD-1 also makes this a violation on its own terms — `ui/` may import `core/`, so a view query
in `ui/` is not illegal, but a *domain* computation living in the driving adapter is the thing
AD-1 exists to prevent.

**What closes it.** Add `core/view/` — transient filter, sort and search over a Table handle,
sharing the Filter Step's predicate type so FR-32's promotion is a move, not a translation.
Update the Capability Map row to `core/view` + `ui/`, governed by AD-4 (predicates are pure)
and the new table-window AD from U-6.

---

### U-13. FR-38's mode, threshold and staleness have no owner `[severity: medium]`

**PRD.** FR-38's substance is a piece of visible state, and the PRD says so in the strongest
language it uses anywhere:

> FR-38: "**The mode in force is stated, not inferred. A user must never be in doubt about
> whether what they are looking at reflects the Step in front of them.** … The threshold is a
> stated number the user can see, not a hidden heuristic, and crossing it is announced when it
> happens rather than discovered. … Previews and Result are **marked as belonging to the
> previous run** … **The mode is a property of the session and the data in it, not of the
> Recipe.**"

**Spine.** AD-8 acknowledges the modes exist — "Both FR-38 execution modes read and write this
one cache" — and no AD owns the mode itself, the threshold value, the announcement on
crossing, or the staleness marking.

The staleness marking is the piece with a real architectural answer available and unstated:
AD-8's content-addressed key gives it for free — displayed content is stale exactly when the
key it was computed under differs from the key of the current configuration. That is a good
consequence of the cache design and it should be written down, because a build team that does
not see it will invent a dirty flag, and two invalidation schemes disagreeing is the thing AD-8
was written to prevent.

"Not a property of the Recipe" is a serializer exclusion, like FR-30's — same fix, same place.

**What closes it.** One paragraph in AD-8 or a short AD: mode and threshold are session state
owned by `core/exec`, exposed as a projection; staleness is derived from key inequality and
never from a flag; neither is serialized.

---

### U-14. Smaller unhoused items

- **Broken Steps.** FR-1 ("removing a Source that a Step references **marks that Step as
  broken** rather than deleting it") and FR-12 ("A Step whose input disappears … is marked
  broken **and names what it lost**, rather than being deleted or silently re-wired").
  `core/graph` lists "cycle guard, topological order, orphan marking" — orphan is FR-12's
  *other* marking, the non-contributing Step. Broken-ness is a different state with different
  semantics (it blocks execution; an orphan does not), and AD-13 does not bind FR-12, so a
  broken Step has neither a state nor a diagnostic.
- **The Recipe format specification has three consumers and no source of truth.** FR-20 ("The
  Recipe format is documented well enough that a language model can produce a valid one from
  the documentation alone"), FR-27 ("The block **includes the Recipe format specification and
  the Probe Query format specification**"), and AD-11's validator all describe the same format.
  AD-17 forbids fetching the documentation at runtime, so it is a build-time asset inlined in
  the bundle. Nothing names it or keeps it in sync with the validator — and PRD Open Question 3
  reports that five-of-five machine authorship succeeded *against this documentation*, which
  makes documentation drift a correctness regression, not a docs chore.
- **A cache hit must not lose the warnings.** FR-19: "Warnings raised by that Step (FR-13,
  FR-14, FR-15, FR-18) are visible alongside its Preview, **not only at the moment of
  execution**." AD-8 speaks of caching "a result"; AD-4 defines a result as `{ table,
  diagnostics }`. Almost certainly intended, nowhere stated — and a cache that stores only the
  table produces a Step that is clean on second view and dirty on first.
- **Two German formatters.** FR-31 ("Values are displayed in German conventions — decimal
  comma, thousands separator, `dd.mm.yyyy` dates — regardless of the locale they were read in")
  and FR-36 ("Numbers and dates in CSV and XLSX are written in German conventions") need
  identical formatting in `ui/` and in `adapters/`. The conventions table pushes formatting out
  of `core/` ("A user-facing string never lives in `core/`"), which leaves no shared home and
  two implementations that will drift.
- **FR-24's pre-write size statement.** "Exporting a Package **states the resulting file size
  before writing it**" requires a two-phase `TableWriter` — produce, report, then write. A port
  shaped as write-and-download cannot do it.
- **NFR-5 has no home at all.** "Desktop only, designed for Full HD. Mobile and tablet layouts
  are not supported and not attempted." Nothing in the spine records a layout constraint. Low
  cost to add to the conventions table; zero cost now, and it is the kind of thing that gets
  re-litigated in month four.

---

## 2. Miscarried — consequences the spine drew wrong

### M-1. AD-7's "the retained original is the registry entry" fails at the point of use `[severity: critical]`

**Spine.** AD-7:

> "the registry holds raw parsed tables — values as delivered. The Recipe's per-column type
> record is applied by the engine as Step zero of every Source, cached like any other Step.
> **FR-9's retained original is therefore the registry entry itself, not a duplicate.**"

**PRD.** Three requirements ask for the original, and only one of them is at the Source.

> FR-9: "Values that do not parse under the chosen type are **marked as unparsed and remain
> inspectable in their original form** — they are never silently replaced by null, and **the
> original is retained** rather than discarded once a value has been converted."

> FR-17: "Division by zero and operations on unparsed values **produce a marked empty cell**,
> not a crash and not a silent zero."

> FR-31: "**Cells whose value did not parse under the column's confirmed type are visually
> marked.**"

FR-31 marks cells **in the Result**, which is downstream of joins, filters, aggregates and
column selection. The registry entry is upstream of all of them. There is no correspondence
between a Result row and a registry row after a Join or an Aggregate, so "look it up in the
registry" is not a mechanism — it is a hope. FR-17 is worse still: its marked empty cell is
produced *mid-pipeline* by a computed column and was never in the registry at all.

The consequence the spine avoided is real — a second full copy of every Source is expensive —
but the answer it reached does not satisfy the requirement. The unparsed marker is a property
of a **value**, and it has to travel with the value through the pipeline.

**What closes it.** Decide the cell model explicitly, in an AD, because every Step author needs
to know it:

> **AD-N — An unparsed value is a value, not an absence.** A typed column carries, alongside
> its parsed values, a per-row unparsed marker and the original text for the rows it marks —
> a sparse side-channel, since the expected density is low. Every Step propagates the marker
> for rows it passes through; a computed column that cannot compute (FR-17) emits one. A marked
> cell is never null, never zero, and never silently coerced. AD-5's `Table` interface exposes
> the marker; `table.rows()` materializes it. AD-7 stands for the *typed* original; it does not
> stand for the marker.

Then restate AD-7's last sentence: the registry entry is the original *of a Source*, which is
what a re-typing needs; it is not the original *of a Result cell*, which is what FR-31 needs.

---

### M-2. AD-13's Diagnostic contradicts the language convention, and both contradict FR-28 `[severity: high]`

**Spine.** AD-13:

> "every Step, loader and validator emits `{ severity, code, message, stepId?, sourceId?,
> rowCount? }` … **`code` is a stable identifier, never a sentence.**"

Conventions table, two rows apart:

> "Data — diagnostics | The one shape in AD-13. `code` is stable and machine-readable;
> **`message` is German and user-facing.**"

> "Cross-cutting — language | Interface German, code and comments English (NFR-6). **A
> user-facing string never lives in `core/`; the core emits a `code` and the UI renders it.**"

These cannot all hold. `core/steps` emits diagnostics; a diagnostic carries `message`; `message`
is German and user-facing; user-facing strings never live in `core/`.

**PRD.** FR-28 and AD-11 add a third constraint that neither convention anticipates:

> FR-28: "A syntactically invalid answer is rejected with **a message specific enough to paste
> back to the model.**"

> AD-11: "Refusal messages name the failing reference and are **shaped to be pasted back to a
> model.**"

A validator refusal therefore has two audiences with different needs: a German user reading it
in the UI, and a language model reading it pasted into a chat. NFR-6 says the interface is
German; the prompt block of FR-27 contains an English format specification; the PRD never
decides what language the LLM channel speaks, and the spine did not notice the question.

**What closes it.** Drop `message` from the core diagnostic and make the payload structured:
`{ severity, code, params, stepId?, sourceId?, rowCount? }`, where `params` carries the names
and counts a message needs. `ui/` renders German from `code + params`; the paste-back renderer
(U-1's `Disclosure`) renders the model-facing form from the same pair. One structure, two
renderers, no user-facing string in `core/`, and FR-28's paste-back message stays exactly as
specific as the refusal that produced it. Then decide the LLM channel's language in one line
and write it in the conventions table.

---

### M-3. AD-7 claims to prevent a second copy and then creates one `[severity: medium-high]`

**Spine.** AD-7's `Prevents` line:

> "**Prevents:** a registry whose content depends on which Recipe is loaded, and **a second
> in-memory copy of every Source**"

Its rule:

> "The Recipe's per-column type record is applied by the engine as Step zero of every Source,
> **cached like any other Step.**"

A cached Step output is a second table. The AD's first clause is achieved — the registry is
Recipe-independent, which is genuinely valuable — but its second clause is contradicted by its
own mechanism. Combined with U-8's absent eviction policy, the honest statement is: two copies
of every Source, plus one per cached intermediate, unbounded.

**What closes it.** Correct the `Prevents` line to what the rule actually achieves ("a registry
whose content depends on which Recipe is loaded, and a re-load when a type is re-confirmed"),
and let the eviction policy from U-8 own the memory question.

---

### M-4. AD-11 is credited with the Pre-flight Check, which is a different validation `[severity: medium]`

**Spine.** AD-11 "One validator, three doors" binds "FR-20, FR-21, FR-22, FR-23, FR-28, FR-29",
and the Capability Map routes Recipes, contracts and Packages to it.

AD-11's actual rule is about *structural* validation of a Recipe or Probe Query document:
"every Recipe and every Probe Query passes the same validator … An unrecognised field is
refused, not ignored".

**PRD.** FR-22 is not that. It validates *loaded data* against a contract:

> FR-22: "the system validates **the files** against the Input Contract … Each contract
> requirement is reported as **fits, missing, or doubtful, with the reason** … A column whose
> values do not parse under the expected type or locale is reported as doubtful, **with the hit
> rate.**"

A hit rate is computed by reading the Consumer's data under the Author's type record — it is
the FR-9 detection machinery pointed at a contract, not a schema check. It has different
inputs, a different output vocabulary (`fits | missing | doubtful`, which is not AD-13's
severity set either), and a different failure mode. Filing it under AD-11 means the one thing
AD-11 guarantees — identical treatment at three doors — is claimed for a validation that has
only one door.

**What closes it.** Split the map row: FR-20, FR-21, FR-24, FR-28, FR-29 under AD-11; FR-22 and
FR-23 as their own capability in `core/recipe/preflight`, governed by AD-7 (it reuses the type
system) and AD-13. Add `fits | missing | doubtful` to the diagnostics vocabulary explicitly, or
say how it maps onto `info | warning | error` — FR-22's outcome must survive into the run status
(U-9) and into FR-37's document, so it needs a representation, not an ad-hoc one per renderer.

---

### M-5. AD-4 binds FR-39, which is not a Step `[severity: low-medium]`

**Spine.** AD-4: "**Binds:** FR-13 – FR-18, **FR-39**, and every Step kind added later".

**PRD.** FR-39 is structural CSV damage detection — a loader concern, executed by
`adapters/csv` behind `SourceReader`, correctly filed that way in the Capability Map's first
row. It is not a Step kind and cannot be `(inputs: Table[], config) => …`, since its input is
bytes and one of its outputs is raw text of the affected rows.

Small, but AD binding lists are how a build team decides where code goes, and this one points
at the wrong layer.

**What closes it.** Remove FR-39 from AD-4. It is already bound by AD-13, which is the correct
rule for it, plus the new byte-retention AD from U-2 for "the affected rows stay inspectable in
their raw form".

---

### M-6. The Deferred section claims a port that does not exist `[severity: low-medium]`

**Spine, Deferred:**

> "**The view-document adapter (FR-37).** … **The port it sits behind is defined**; the gap is
> an unimplemented adapter, not an open boundary. Blocks nothing else."

The ports list, in two places (the conventions table and the Structural Seed), is: `SourceReader
TableWriter SessionStore ChartRenderer GraphView Clipboard`. There is no view-document port.
`TableWriter` writes data files (AD-15 scopes it to XLSX and Parquet workers); FR-37 produces a
self-contained HTML document embedding a Dashboard and a run status, and a paginated PDF.

This matters more than a documentation slip because the Deferred entry's reassurance —
"Blocks nothing else" — rests on the boundary being drawn. PRD Open Question 11 says the sharp
sub-question is "whether PDF is generated by a library or handed to the browser's own
print-to-PDF behind a print stylesheet", and those two answers need *different* boundaries: a
library sits behind a port, a print stylesheet is not an adapter at all and reaches into `ui/`
and into the build. Declaring the boundary defined hides a decision that is still open.

**What closes it.** Either define `DocumentWriter` in the ports list, or say honestly that the
boundary depends on R8's answer and name both candidate shapes. Also carry FR-37's own
architectural consequence, which the spine has already half-honoured in the stack (SVG-only
ECharts) but not stated: charts must reach the document as SVG with real text, and R4's
virtualization does not apply to a static document, so a large Result goes in whole or goes in
truncated with the omission stated.

---

## 3. Quiet requirements — the tone-and-stance constraints

These are the ones an AD structure drops most reliably, because none of them is a mechanism.
Each is a real constraint with an architectural consequence. Collected here so none is lost;
each is already argued above under its finding.

| PRD | The quiet constraint | Consequence the spine owes it | Where |
| --- | --- | --- | --- |
| §4 theme | "querbeet's characteristic failure mode is a **plausible wrong number, not an error message**" | An adapter-boundary rule that every known silent library behaviour is intercepted and named. The Stack table does this ad hoc for three libraries and misses a fourth (§4 below). | M-2, §4 |
| FR-3, FR-9, FR-13, FR-5 | "**says so explicitly and asks, rather than guessing silently**"; "**nothing in the column settles it**, and the system says exactly that"; "listed **before the Step runs**"; "offered as an action" | A fourth diagnostic state and a two-phase Step contract | U-3 |
| FR-38 | "The mode in force is **stated, not inferred**. **A user must never be in doubt** about whether what they are looking at reflects the Step in front of them." | Mode as owned session state; staleness derived from the cache key, never a flag | U-13 |
| FR-27 | "**Everything that would leave the machine is visible in the block. There is no hidden portion.**" | One `Disclosure` value; the port accepts nothing else | U-1 |
| FR-28, AD-11 | rejection messages "**specific enough to paste back to the model**" | Structured diagnostics with two renderers, and a decision about the LLM channel's language | M-2 |
| FR-9, FR-17, FR-31 | "**never silently replaced by null**"; "not a crash and **not a silent zero**"; "visually marked" | The unparsed marker travels with the value to the Result | M-1 |
| FR-25, NFR-8 | "The UI states **plainly and persistently** that data is stored in this browser" and says **what that means** — "readable by other local pages, shared between copies of the tool, and removable by the browser without warning"; "**the UI must not imply otherwise**" | AD-16 handles the key namespacing and the `persist()` hazard, and stops there. The disclosure statement itself — a permanent, non-dismissible UI element with specified content — has no home. | new |
| FR-33 | "The search field is **prominent enough to be found by a user who reflexively pressed Ctrl+F first**" | A UX constraint, correctly out of scope for a spine — noted so the UX artifact inherits it. | — |
| FR-11 | The Editor is entered "through an **explicit action acknowledging that the Pipeline can be changed** there" | The Capability Map credits AD-10 with FR-11. AD-10 governs *how* the model is mutated, not *whether the user has entered the place where mutation is possible*. FR-11's three testable consequences are navigation invariants with no rule. | new |
| FR-30 | "a Consumer **never inherits** an Author's disclosure decision" | An explicit exclusion in the canonical serializer, tested alongside AD-14's round trip | U-11 |
| §6.2 | a future API path "**can never become a second and laxer disclosure path**" | Today's architecture must make that structurally true, not aspirational | U-1 |

---

## 4. Stack and known-hazard carry-over

The Stack table encodes three measured guardrails directly into version rows — `PapaParse
5.5.4, dynamicTyping permanently off`, `ECharts 6.1.0, SVG renderer registered alone`,
`Tailwind v4.3.3, preflight.css omitted`. That is exactly the right instinct, which makes the
omissions conspicuous:

- **`hyparquet-writer` carries a silent-corruption hazard and the row does not say so.** PRD
  Open Question 7: "**`hyparquet-writer`'s `GZIP` codec silently writes an unreadable file**".
  The addendum records the fix implicitly ("Snappy default"). The spine's row is bare
  `hyparquet-writer / hyparquet | 0.16.3 / 1.27.1`. A file that writes without error and cannot
  be read back is the §4 failure mode in its purest form, and FR-36 requires "a file that
  standard readers accept, and that querbeet itself can load back". Add `Snappy codec; GZIP
  forbidden` to the row.
- **Arquero's `fromCSV` is banned by the research and unmentioned here.** Addendum: "**Never
  call `fromCSV`.** Its type inference converts German `"1.234"` to 1.234 and **samples only the
  first 1,000 values** before applying a parser to the whole column." That is FR-9's headline
  defect inside the spine's own chosen table engine. AD-5 makes Arquero the `Table`
  implementation and says nothing about it.
- **FR-9's no-sampling rule is not stated anywhere as an invariant.** It is the PRD's most
  differentiating correctness rule — "**Detection reads every value in the column, not a
  sample.** Every comparable engine samples — DuckDB 20,480 rows, Arquero 1,000, Power Query
  200, Frictionless 100" — and it is the first thing anyone optimises when type detection turns
  out to be slow (which U-7 shows it will be). `core/types` names a "candidate loop" and stops
  there. This belongs in an AD sentence, not in a research report.
- **NFR-4's browser posture is not carried.** "Chromium is the lead browser … Firefox 145+
  remains a target but is secondary: it is **measured** during the first builds rather than
  assumed, and if it does not carry the JavaScript-heavy paths **it is dropped**." AD-18's
  Playwright suite does not say which engines it runs, and nothing records the drop criterion.
  Two AD rules already rest on Firefox-specific measurements (AD-16's `persist()` deadlock,
  AD-9's `SharedArrayBuffer` absence), so which engines are in the gate is a live question.
- **Open Question 6 is unresolved on the spine's own date.** "Do `write-excel-file`'s format
  codes render as German decimal commas in a real German Excel? … **Owner: project owner,
  scheduled 2026-08-02.** Until it passes, FR-36's 'opens cleanly in Excel' is asserted, not
  verified." The spine was written on 2026-08-02 and carries no risk note against the XLSX row.

---

## 5. MVP scope: no drift, two small factual errors

Checked against PRD §6.1 and §6.2 in both directions.

**Not narrowed.** All 39 FRs appear in `binds` and all 39 appear somewhere in the Capability
Map (row 1: FR-1–8, 39; row 2: FR-9–10; row 3: FR-11–18; row 4: FR-19, 34, 38; row 5: FR-20–25;
row 6: FR-26–30; row 7: FR-31–35; row 8: FR-36–37; row 9: FR-11–12). The `Deferred` section is
correctly about *undecided mechanisms*, not cut capabilities — FR-37 and FR-24 are named as
open adapters and containers, which matches PRD Open Questions 8 and 11 exactly. The Consumer
first-run deferral reproduces PRD Open Question 1's own narrowing faithfully: "The Recipe
machinery it would sit on is decided here; only its presentation waits." That is precisely what
the PRD says is and is not gated.

**Not widened.** Nothing in the spine adds a formula language, an LLM API path, an interactive
HTML export, multiple Result Steps, or legacy Excel reading. Two additions are outside the PRD
and both are benign: AD-12's "The application displays its own build version where a Consumer
can read it back to the Author" (sensible, costs nothing) and the deferral of undo/redo (not a
requirement; noted as cheap later, which AD-10 makes true).

**Two factual errors about the PRD's own priorities:**

- Deferred, Recipe format migration: "**Named in the PRD as the first post-MVP candidate.**"
  The PRD names no such thing. §6.2 names the direct LLM API connection as "the first item in
  the post-MVP backlog"; FR-37's note names interactive HTML export as "the strongest candidate
  for the first post-MVP addition". Recipe format migration is never mentioned as a post-MVP
  item anywhere in the PRD. Harmless in itself; it is a claim about the PRD that the PRD does
  not support, and someone will plan against it.
- §6.3's build-order guidance is not reflected: "**the natural build order is the risk order** …
  Reaching a working consolidation-and-export path first … The Recipe format should nonetheless
  be designed for machine authorship from the first commit." AD-14 honours the second half
  explicitly and well. The first half — that the loading/typing/Step/export path is the spine
  to build before the LLM protocol and the Dashboard — is guidance an architecture usually
  records so that epics inherit it. Not a defect; an opportunity, one line in the Deferred
  section or a note under the Structural Seed.

---

## 6. Summary of proposed additions

Nine ADs and four amendments would close everything above.

**New ADs**

| # | Rule | Closes |
| --- | --- | --- |
| A | One disclosure boundary — a single immutable `Disclosure`; the port accepts nothing else; no adapter constructs one | U-1, §6.2 forward constraint, FR-27, FR-29, FR-30, NFR-8 |
| B | A Source retains its bytes and its parse settings; parsing is a pure re-runnable function | U-2, FR-2, FR-3, FR-5–8, FR-24, FR-25, FR-39 |
| C | An unparsed value is a value, not an absence — the marker travels to the Result | M-1, FR-9, FR-17, FR-31 |
| D | Execution is admitted, never merely started — one gate, three preconditions | U-4, FR-9, FR-22, FR-38 |
| E | Every interaction is a command; a pointer gesture is one way to issue it | U-5, NFR-7, FR-1, FR-12, FR-35 |
| F | The table view is a window over a Table handle; the scroll spacer is guarded | U-6, FR-31–33, NFR-3, NFR-4 |
| G | A run is an object — id, clock, Recipe, Sources, Pre-flight, audit settings, diagnostics | U-9, FR-34, FR-37 |
| H | No text is parsed into behaviour; free text is data the system never interprets | U-10, NFR-9, FR-17, §5 |
| I | Detection reads every value in the column, never a sample; `fromCSV` is never called | §4, FR-9 |

**Amendments**

| Target | Change | Closes |
| --- | --- | --- |
| AD-13 | Add `unresolved` severity with options; replace `message` with structured `params`; two renderers, German and model-facing | U-3, M-2 |
| AD-4 | Two-phase Step contract (`plan` / `run`), both pure; remove FR-39 from `binds` | U-3, M-5 |
| AD-8 | Bounded cache with a stated eviction policy and memory budget; diagnostics cached with the table; staleness derived from key inequality; mode and threshold owned here and not serialized | U-8, U-13, U-14, M-3 |
| AD-9 | Widen from an engine rule to a platform rule — every full-column or full-table operation yields on the same scheduler | U-7, FR-8, FR-9, FR-25, FR-33 |

**Smaller edits:** add `Clock` and `DocumentWriter` (or an honest note) to the ports list; add
`core/view/` and `core/recipe/preflight/` to the Structural Seed; extend the Recipe ER with
annotations, name, description, per-Source import settings and saved mappings; split the
Capability Map's FR-22/FR-23 row off AD-11 and move FR-10 off `core/types`; add the Snappy/GZIP
guardrail and an NFR-4 engine posture to the Stack; add NFR-5 to the conventions table; correct
the Recipe-migration claim in Deferred.
