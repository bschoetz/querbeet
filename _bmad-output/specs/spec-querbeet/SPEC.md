---
id: SPEC-querbeet
companions:
  - glossary.md
  - users-and-journeys.md
  - acceptance-criteria.md
  - technology-decisions.md
  - decision-record.md
  - measured-constraints.md
  - ../../planning-artifacts/architecture/architecture-querbeet-2026-08-02/ARCHITECTURE-SPINE.md
sources:
  - ../../planning-artifacts/prds/prd-querbeet-2026-08-01/prd.md
  - ../../planning-artifacts/prds/prd-querbeet-2026-08-01/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# querbeet

Capability ids are minted equal to the PRD's requirement numbers: **CAP-N is FR-N**. The architecture spine's `binds: [FR-1 … FR-39, NFR-1 … NFR-9]` therefore resolves against this contract without a mapping table. Constraint C-N corresponds to NFR-N where one exists.

## Why

A recurring data-consolidation chore — three or four report exports related to each other by hand, once a quarter or once a month — costs its owner hours, runs on PowerQuery or a spreadsheet of VLOOKUPs, and is tied to the one machine it was built on. That is the pain. The failure it produces is the reason this is not a convenience product: **querbeet's characteristic failure mode is a plausible wrong number, not an error message.** Locale-formatted numbers misread by a factor of a thousand, Cartesian products from duplicate join keys, columns dropped on union, rows unmatched on join — each was measured during research as real behaviour of the underlying libraries, and each produces output that looks fine. The opportunity on the other side is that **the pipeline itself can be a portable artifact**: a Recipe is a small JSON file holding the Steps and no data, so a specialist writes one once and a department serves itself with it, without ever sending that department's data to the specialist. And because a Recipe is a plain data structure, a language model can author it from a structural profile alone — never from the values — which makes the Recipe cheap enough to write that the leverage is real rather than theoretical. The whole thing is one HTML file that runs by double-click with no server, no installation, no account and no network request, which is what lets it be tried inside an organisation without an approval process. Three roles are affected and only two of them ever open the tool: the **Author** who builds pipelines, the **Consumer** who runs someone else's Recipe against their own data, and the **Boxchecker** who receives an export as documentation and never operates anything. See `users-and-journeys.md`.

The product's own scope test is one sentence, and it predates every document here: **reports in, consolidated table out.**

## Capabilities

Each capability below states its intent and the single criterion that decides it. The full testable consequence list per capability — what a test suite is written against — is in `acceptance-criteria.md`.

### Loading Sources

- **CAP-1** — Load files as Sources
  - **intent:** A user can add one or more local files — CSV, JSON, NDJSON, XLSX, Parquet — as named Sources by drag-and-drop or file dialog, so a consolidation is built over exports they already have.
  - **success:** Several files dropped at once each become a separate, renamable, individually removable Source; an unsupported or unreadable file produces a named error against that file while every other Source stays loaded.

- **CAP-2** — Determine character encoding, with a visible override
  - **intent:** The system decides how to decode a text file and the user can overrule it.
  - **success:** Text containing German umlauts and the euro sign renders correctly on both the UTF-8 and the Windows-1252 path, and changing the displayed encoding re-reads the file.

- **CAP-3** — Detect CSV delimiter and header row, with correction
  - **intent:** The system proposes a delimiter and a header row per CSV Source, both correctable by the user.
  - **success:** A semicolon-delimited German Excel export is detected as such, and a file whose delimiter cannot be determined produces an explicit question rather than a silent guess.

- **CAP-39** — Detect structurally broken CSV
  - **intent:** A CSV Source whose structure is damaged is reported as damaged rather than parsed into a plausible table.
  - **success:** Rows whose field count differs from the header are counted and named by row number, and an unclosed quoted field is reported as that specific defect rather than as a generic parse failure.

- **CAP-4** — Detect that a JSON Source is malformed
  - **intent:** The system separates a JSON file it can parse from one it cannot, before attempting anything else.
  - **success:** A file that parses strictly is never modified; one that does not is reported with the file name and the position where parsing failed, distinguished from an unsupported-but-valid shape.

- **CAP-5** — Repair a malformed JSON Source
  - **intent:** The user can ask for a repair of a malformed JSON Source — the cases handled are the ones a language model's answer produces when pasted straight into a file.
  - **success:** Repair happens only on the user's action, never on their behalf; a failed repair names the file and leaves the Source unloaded rather than partially loaded; the file on disk is never modified.

- **CAP-6** — Disclose what a repair changed
  - **intent:** A repair that succeeded shows the user what it did.
  - **success:** The differences between the file as delivered and as parsed are inspectable, the Source stays visibly marked as repaired, and the repair appears in the run status (CAP-34).

- **CAP-7** — Flatten nested JSON with an explicit array strategy
  - **intent:** Nested JSON becomes a tabular Source, and how arrays are handled is a choice the user makes rather than a hidden default.
  - **success:** Three strategies are offered — JSON value per cell, indexed column per position, row per element — chosen per Source, changeable without reloading, stored in the Recipe, with the effect on row and column count visible before committing.

- **CAP-8** — Preview every Source
  - **intent:** Every loaded Source shows its detected columns and a bounded window of its rows, so the user sees what arrived.
  - **success:** Row and column counts are the Source's totals rather than the window's, the Preview renders responsively regardless of Source size, and a JSON or NDJSON Source additionally offers a collapsible structure view reachable while the array strategy is being chosen.

- **CAP-9** — Detect column types and locales, and require confirmation before running
  - **intent:** The system proposes a type and, where relevant, a number and date locale per column, and no Pipeline runs until the user has confirmed the type mapping of each Source once.
  - **success:** Detection reads **every value in the column, not a sample**; where two readings are both plausible the system either names the decisive evidence with its count or states that nothing in the column settles it, and never picks silently; unparsed values stay inspectable in their original form rather than becoming null; execution is blocked until confirmation, and the confirmation is stored in the Recipe.

- **CAP-10** — Annotate columns
  - **intent:** The user attaches a free-text description to any column, stating what it contains.
  - **success:** Annotations are editable at any time, stored in the Recipe, and included in the Column Profile shown to a model.

### Building the Pipeline

- **CAP-11** — Enter the Editor deliberately
  - **intent:** The Editor is a distinct area entered through an explicit action that acknowledges the Pipeline can be changed there.
  - **success:** Loading a Recipe does not open the Editor; starting with no Recipe does; leaving and re-entering loses no Step configuration.

- **CAP-12** — Compose a Pipeline as a graph of Steps
  - **intent:** The user adds Steps, connects them, names them, and designates which one produces the Result.
  - **success:** A connection that would create a cycle is refused with a named reason; a Step whose input disappears is marked broken and names what it lost rather than being deleted or re-wired; Steps not contributing to the Result Step are visibly marked; the graph is navigable and editable by keyboard.

- **CAP-13** — Union tables with column mapping
  - **intent:** The user stacks two or more tables, mapping differently-named columns onto each other.
  - **success:** Columns present in only some inputs are **listed before the Step runs**, with the choice to map, keep padded with nulls, or drop — never dropped silently; the output row count equals the sum of the inputs.

- **CAP-14** — Join two tables on one or more keys
  - **intent:** The user joins two tables on one or several key columns, choosing left or inner.
  - **success:** The Step reports how many left rows found no match; when the output exceeds the input row count it warns explicitly that duplicate keys produced additional rows and states the factor; null handling in key columns is an explicit stored setting whose default is stated in the UI rather than implied.

- **CAP-15** — Filter rows
  - **intent:** The user restricts rows by conditions on columns.
  - **success:** A comparison value is held in the Recipe in **canonical machine form** — a number as a number, a date as an ISO 8601 string, never a display form — and a value whose type disagrees with the column's confirmed type is refused naming the disagreement rather than coerced into a silently empty result.

- **CAP-16** — Select, rename and reorder columns
  - **intent:** The user chooses which columns survive, renames them, and sets their order.
  - **success:** Renaming to a name already in use is refused with a named reason, and the Step's column order determines the order of its output and of every export downstream of it.

- **CAP-17** — Add a computed column
  - **intent:** The user derives a new column by choosing an operation and its inputs from fixed lists.
  - **success:** The resulting configuration is a plain data structure with no free text to parse, so a model can emit it and the system can validate it; division by zero and operations on unparsed values produce a marked empty cell, never a crash and never a silent zero.

- **CAP-18** — Aggregate
  - **intent:** The user groups rows by one or more columns and computes aggregates over them.
  - **success:** Rows with null in a grouping column form their own visible group rather than disappearing, and the Step reports its input and output row counts.

- **CAP-19** — Preview every Step
  - **intent:** Selecting a Step shows the table it produces.
  - **success:** The Preview carries that Step's full row and column counts and its own warnings, visible alongside it rather than only at the moment of execution.

- **CAP-38** — Execute the Pipeline
  - **intent:** Execution has one owner, and which of two modes is in force is always visible.
  - **success:** Below a stated, user-visible row threshold every configuration change recomputes the affected Steps and everything downstream with no action required; above it the Pipeline switches to explicit execution, says so where the user is working, and marks Previews and Result as belonging to the previous run. **The mode in force is stated, not inferred** — a user is never in doubt whether what they see reflects the Step in front of them.

### Recipes and Packages

- **CAP-20** — Save and load a Recipe
  - **intent:** The user exports the current Pipeline as a Recipe file and loads one back.
  - **success:** A Recipe carries Steps, configurations, connections, Column Annotations, type and locale confirmations, the Dashboard definition and the Input Contract, and **no cell values**; it carries a format version, and an unknown version is refused with a named reason rather than partially applied.

- **CAP-21** — Derive and carry an Input Contract
  - **intent:** Saving a Recipe records what the Pipeline expects of its inputs.
  - **success:** The contract covers only the columns the Pipeline actually reads, so an extra column in the Consumer's export is not a failure, and the Author can loosen a type or mark a column optional before saving.

- **CAP-22** — Run a Pre-flight Check before executing
  - **intent:** A Recipe loaded together with files is validated against the Input Contract before any Step runs.
  - **success:** Each requirement is reported as fits, missing or doubtful with its reason; the Pipeline does not execute while any requirement is missing; the outcome stays visible after the run as part of the run status.

- **CAP-23** — Map the Consumer's columns onto the contract
  - **intent:** Where a required column is missing, the user maps one of their actual columns onto it.
  - **success:** The mapping is offered per unmet requirement against the Source's real column list, applying it re-runs the check, and it can be saved back into the Recipe so the correction is not repeated next month.

- **CAP-24** — Export and import a Package
  - **intent:** The user bundles a Recipe with the data of its Sources into one compressed file, and loads such a file, so a recipient can reproduce one concrete run from a single artifact.
  - **success:** A Package is visibly distinct from a Recipe — different extension, unmistakable indication that it contains data — states its resulting size before writing, and on a read failure imports nothing rather than importing a Recipe without its data.

- **CAP-25** — Persist the session, and make deleting it easy
  - **intent:** The current Recipe and the loaded Source data survive closing and reopening the tool, and one obvious action deletes everything stored.
  - **success:** The UI states plainly and persistently what "stored in this browser" means — readable by other local pages, shared between copies of the tool, removable by the browser without warning; a session that comes back partial **says so and offers to start clean** rather than presenting a Result computed over data that is no longer all there.

### LLM assistance

- **CAP-26** — Produce a Column Profile
  - **intent:** The system produces a structural description of the loaded Sources suitable for showing to a language model.
  - **success:** The profile contains no cell values unless the user explicitly releases samples, and is shown to the user in full before it is used for anything.

- **CAP-27** — Generate a copy-ready prompt block
  - **intent:** The user produces one text block containing their question, the Column Profile, the current Pipeline, and the format specifications a model needs to answer usably.
  - **success:** The block is copyable in one action and **everything that would leave the machine is visible in it** — there is no hidden portion.

- **CAP-28** — Accept a Recipe from a model, validated
  - **intent:** The user pastes a model's answer and the system validates it before applying anything.
  - **success:** A rejection is specific enough to paste back to the model — the failing reference, the cycle, the offending character are named; a comparison value arriving in the wrong shape is resolved by a **named rule, never by guessing** (a canonical numeric string is coerced, a grouping separator or decimal comma is refused naming the character, a non-ISO date is refused, a type disagreement is refused naming both types); a valid Recipe loads as ordinary inspectable Steps and never replaces the existing Pipeline without the user seeing what changes.

- **CAP-29** — Execute a Probe Query and disclose its result
  - **intent:** A query authored by a model runs locally against the real data, and the user sees exactly what would be sent back before sending it.
  - **success:** A Probe Query is expressed in the Step vocabulary and introduces no second query language, is validated on exactly CAP-28's terms including refusing an unrecognised field, reads and never writes, and its result is displayed before any return step.

- **CAP-30** — Release sample values explicitly
  - **intent:** The user can choose to include example values from a column in what goes to the model.
  - **success:** Release is off by default, chosen per column per exchange, shown before sending, and **does not persist into the Recipe** — a Consumer never inherits an Author's disclosure decision.

### Result, view and Dashboard

- **CAP-31** — Display the Result as a table
  - **intent:** The Result is a table that stays responsive at the design scale.
  - **success:** Scrolling a hundred thousand rows stays smooth with the scroll position mapping to the correct rows throughout, headers stay visible, values display in German conventions regardless of the locale they were read in, and cells that did not parse are visually marked.

- **CAP-32** — Filter and sort the view, and promote a view filter into the Pipeline
  - **intent:** The user changes what the table shows without changing the Result, and can turn such a filter into data.
  - **success:** View filters apply to the full Result rather than the rendered window, are transient and unstored, are announced as a view while active, and convert into a Filter Step before the Result Step in a single action.

- **CAP-33** — Search the full dataset
  - **intent:** The user searches the Result and reaches matches that are not currently rendered.
  - **success:** Search runs over every row rather than the DOM, reports the match count with jump-to navigation, and returns responsively at a hundred thousand rows.

- **CAP-34** — Show the run status
  - **intent:** The Dashboard shows whether the run that produced it was clean.
  - **success:** A run with warnings is distinguishable at a glance from a clean run without opening the Editor; the status names the Steps involved and summarises the Pre-flight outcome, every Step warning, whether any Source was repaired, and whether the duplicate audit was on.

- **CAP-35** — Compose a Dashboard from Tiles
  - **intent:** The user adds, configures, orders and sizes Tiles over the Result.
  - **success:** Every Tile is configured through the same small form; Tiles occupy a fixed grid with no free positioning and no overlap, ordered through keyboard-reachable controls; the Dashboard definition is stored in the Recipe so a Consumer sees the Author's Dashboard.

### Export

- **CAP-36** — Export data files
  - **intent:** The Result leaves as CSV, JSON, XLSX or Parquet for further work.
  - **success:** CSV is UTF-8 with a byte-order mark and a semicolon default so German Excel opens it without an import dialog; XLSX carries real numbers and real dates with German format codes, preserves leading zeros as text, and preserves umlauts and the euro sign; Parquet is readable by standard readers and by querbeet itself; a long export shows progress and does not freeze the interface.

- **CAP-37** — Export a view document
  - **intent:** The Result and Dashboard leave as a self-contained static document for someone who will only read it.
  - **success:** **Charts arrive as vector graphics whose axis labels are real, selectable text** rather than a screenshot; the HTML is one file that opens with no network access; PDF carries the same content paginated; and the document names its Recipe, its date, its Sources and the run status — enough for a Boxchecker to file it six months later without asking anyone what it is.

## Constraints

- **C-1 — Delivery.** One HTML file, opened by double-click from the local filesystem. No server, no installation, no account, no network connection. A build step may produce that file; using it must never require one.
- **C-2 — Network silence.** The application makes no network request of any kind. Unconditional in the MVP and verifiable from the built artifact rather than by reasoning about settings.
- **C-3 — Scale.** The design target is roughly 100,000 rows per Source and on the order of half a million rows in total. Interactive operations stay responsive there. No limit on the number of Sources, no artificial row cap; behaviour beyond the target is neither promised nor deliberately obstructed.
- **C-4 — Browsers.** Chromium is the lead browser — Edge 143+ and Chrome 143+ — because every colleague has Edge installed. Firefox 145+ is secondary: measured during the first builds rather than assumed, and dropped rather than specially accommodated if it does not carry the JavaScript-heavy paths. Safari is optional.
- **C-5 — Form factor.** Desktop only, designed for Full HD. Mobile and tablet layouts are not supported and not attempted.
- **C-6 — Language.** The interface is German. Code, comments and project documents are English.
- **C-7 — Keyboard reachability.** No WCAG conformance level is targeted and no accessibility testing is required, but one rule is not optional because it is a correctness rule: **no interaction may exist only as a pointer gesture.** Drag is permitted and encouraged — implemented as a gesture that computes a target and updates the model, never as a library that reorders DOM nodes.
- **C-8 — Data residence.** Cell values leave the browser only through an export the user triggered or a disclosure the user saw and confirmed before copying. There is no other path out. **Qualified by measurement:** this holds for leaving the *browser*, not for leaving *querbeet* — persisted data sits in the shared `file://` storage bucket where any other local page can read it, and the UI must not imply otherwise.
- **C-9 — Nothing is typed, in the MVP.** No formula, expression, query or script anywhere in the Step vocabulary. This is the capability floor for a user who works fluently in spreadsheets and does not write SQL, and it is what makes CAP-28 tractable. **An MVP boundary, explicitly not a permanent one** — whenever typed queries arrive, the clicked path stays complete on its own.
- **C-10 — Make the silent failures visible.** The characteristic failure of this product is a plausible wrong number, not an error message. Every silent behaviour measured in the underlying libraries — locale misreads, Cartesian products, dropped columns, unmatched rows — must be surfaced at the Step that caused it. This is the difference between output that can go in a compliance file and output that cannot, and it is what makes several capabilities cost more than their feature description suggests.
- **C-11 — Do not optimise time-to-first-result.** The type-confirmation gate (CAP-9) and the Pre-flight Check (CAP-22) deliberately cost time, and they are what separates a right number from a plausible one. Counterbalances the primary success signals.
- **C-12 — Do not optimise breadth of Step kinds or graph expressiveness.** Every addition enlarges the Recipe format, the Editor surface, and what a language model must get right.
- **C-13 — The Recipe format is machine-authorable by construction.** It must be documented well enough that a model produces a valid one from the documentation alone, and **a linear pipeline must be the trivial case of it** — a graph whose every node has one input — so a model asked for something simple can produce something simple.
- **C-14 — The architecture spine is binding, not advisory.** `ARCHITECTURE-SPINE.md` is a companion, and its invariants AD-1 to AD-30 rule out implementations that would otherwise satisfy a capability here. Where the spine and a source document disagree, the spine governs on structure; it has already superseded one addendum decision on those terms.

## Non-goals

**Permanent:**

- **No server, no backend, no accounts.** There is nothing to log in to. Everything is a file on the user's machine.
- **No live data sources.** No database connections, no scheduled pulls, no APIs feeding data in. Data enters as a file the user chose.
- **Not a data-acquisition tool.** querbeet consolidates files the user already has. A user whose primary problem is finding or extracting data they lack is not served by this product.
- **No collaboration.** No comments, no shared workspace, no server-side version history. Sharing means sending a file.
- **No mobile.** See C-5.
- **No big data.** No streaming, no chunked out-of-core processing. See C-3.
- **Not a BI platform.** The overlap with self-service BI is real and the boundary is the operating model, not the feature list: no server, no live sources, no shared state, no scheduled refresh, no semantic layer several reports draw on. A department that outgrows file-in-file-out has outgrown querbeet, and that is the correct outcome.

**MVP boundaries — deferred, not rejected:**

- **No direct LLM API connection.** The MVP talks to a model only through the clipboard. An optional stored key is the first post-MVP item, and when built it must send exactly what the copy-paste block would have contained, so it can never become a second and laxer disclosure path.
- **No interactive HTML export.** Cut as the most expensive single item in the MVP, being effectively a second small product. Named as the strongest post-MVP candidate.
- **No roles, permissions, or a Consumer-only view.** One interface with a full Editor for everyone, guarded only by CAP-11's deliberate entry.
- **No formula language, scripting or SQL.** See C-9.
- **No free-form Dashboard layout, additional chart types, cross-Tile filtering or drill-down.**
- **No multiple Result Steps.** Exactly one Step is the Result. A Pipeline producing several outputs at once is a plausible extension of the graph model and is deliberately not attempted now.
- **No legacy Excel formats.** `.xls`, `.xlsb` and `.ods` are not read. Only `.xlsx`.
- **No Recipe format migration.** A version mismatch is refused rather than migrated.
- **No accessibility conformance level.** See C-7.

## Success signal

**The PowerQuery workflow is retired** — the quarterly patch-compliance report is produced entirely in querbeet, from three fresh exports to the artifact that goes in the compliance file, without falling back once. **And a Recipe runs in someone else's hands** — at least one Recipe is used at least once by a person other than its Author, against their own data, with the Author never touching that data. The second is the test of the core hypothesis: if it fails, querbeet is a good personal utility and the Recipe concept was wrong.

Secondary, and weaker evidence:

- **The monthly rerun costs nothing.** A repeat run against fresh files of the same shape takes under five minutes and requires no decisions beyond the Pre-flight Check.
- **The LLM path shortens authoring.** At least one non-trivial Pipeline is built with substantial LLM help and is correct on inspection.

## Assumptions

- The entire Consumer journey (UJ-2 in `users-and-journeys.md`) is a hypothesis. The Consumer it describes has not been interviewed; the narrative is constructed from a secondhand statement.
- The Boxchecker's needs are fully served by a self-describing export (CAP-37). No Boxchecker was consulted; the role was named as an observed reaction to compliance-shaped documents.
- Exactly one Result Step is sufficient. A graph naturally admits several terminal nodes; restricting to one keeps the Dashboard, the export and the Recipe format simple, and was not requested either way.
- Locale ambiguity can be surfaced usefully rather than merely detected — that a user can resolve what a parser cannot. A column of four-digit dotted values is genuinely ambiguous.
- A Recipe used by a second person is the right proof of the core hypothesis. It is the cleanest available test, but a single instance is weak evidence.
- A static view document is sufficient for the decision-maker it is written for. The interactive variant was cut on cost, not because anyone judged it unnecessary.
- The transformation path is separable enough to ship first, which makes **the natural build order the risk order**: reaching a working consolidation-and-export path first produces a tool that earns its keep on its own and turns every later block into an addition rather than a prerequisite. Stated as a build-order observation and never validated against an architecture.

## Open Questions

- **How does the Consumer actually work today?** Where do his files come from, how often, and is his primary pain processing the data he has or acquiring data he lacks? This gates the shape of his *first five minutes* only — the landing state, how much of the Pre-flight Check a non-builder is asked to interpret, whether a repair path needs to be gentler than the Editor. The Recipe machinery itself is not gated. Not reachable in the near term as of 2026-08-01.
- **Do `write-excel-file`'s format codes render as German decimal commas in a real German Excel?** The last untested link in "opens cleanly in Excel". Scheduled for 2026-08-02; until it passes, CAP-36's Excel claim is asserted rather than verified.
- **What container does a Package use, and does compressing half a million rows in the browser stay responsive?** CAP-24 requires compression; research answered only the IndexedDB gate beneath it, so the mechanism and its cost are unexamined.
- **Does the Author need a way to test a Recipe against someone else's file shape without their data?** Implied by the handoff the product is built around, never discussed.
- **How is the view document of CAP-37 produced?** Specifically: is the PDF generated by a library, or handed to the browser's own print-to-PDF behind a print stylesheet? The second costs almost nothing and gets typography and pagination for free but cannot be triggered as a download; a library must answer for its size and for embedding an umlaut-capable font inside an already-inlined file. This is the last MVP capability with no research behind it.
- **How many rounds does CAP-28's paste-the-error-back correction loop take?** Five of five independent authoring runs produced a valid Recipe first time, so the failure path the requirement depends on has never been exercised. The measurement wanted is rounds-to-recovery, not first-attempt pass rate.
- **How does a user connect two Steps by keyboard?** Nine of eleven Editor interactions are already keyboard-reachable in both engines; connecting is the one gap, and it waits on a UX decision rather than on anything technical.
