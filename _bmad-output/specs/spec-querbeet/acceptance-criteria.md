# Acceptance Criteria — querbeet

Companion to `SPEC.md`. Per capability, the full list of testable consequences — this is what a test suite is written against. `SPEC.md` states each capability's intent and its single deciding criterion; everything else is here.

Journey ids (UJ-1..UJ-4) refer to `users-and-journeys.md`. Terms are used exactly as `glossary.md` defines them.

---

## Loading Sources

Realizes UJ-1, UJ-2, UJ-4. The user brings report exports into the tool by drag-and-drop or file dialog. Each becomes a named Source with detected columns, a Preview, and a confirmed type mapping. Nothing is uploaded; the browser reads the files the user chose.

### CAP-1 — Load files as Sources

*Realizes UJ-1, UJ-2.* Supported formats: CSV, JSON, NDJSON, XLSX, Parquet.

- Multiple files dropped at once each become a separate Source.
- A Source carries a name, editable by the user, defaulting to the file name.
- Sources can be removed individually; removing a Source that a Step references marks that Step as broken rather than deleting it.
- An unsupported or unreadable file produces a named error against that file and leaves the other Sources loaded.
- A Parquet file written by querbeet's own export (CAP-36) loads back with its columns and types intact.
- There is no limit on the number of Sources; the operative constraint is total row count (C-3).

### CAP-2 — Determine character encoding, with a visible override

*Realizes UJ-1.*

- A UTF-8, UTF-16LE or UTF-16BE byte-order mark decides the encoding outright.
- Absent a BOM, content that is valid UTF-8 is read as UTF-8; content that is not falls back to Windows-1252.
- The chosen encoding is displayed per Source and can be changed, which re-reads the file.
- Text containing German umlauts and the euro sign renders correctly under both the UTF-8 and the Windows-1252 path.

### CAP-3 — Detect CSV delimiter and header row, with correction

*Realizes UJ-1.*

- Semicolon-delimited files, the German Excel default, are detected as such.
- When the delimiter cannot be determined, the system says so explicitly and asks, rather than guessing silently.
- Files with preamble lines before the header can be handled by setting the header row to a later line; the Preview updates to match.
- Both settings are stored in the Recipe.

### CAP-39 — Detect structurally broken CSV

*Realizes UJ-1, UJ-2.*

- Rows whose field count differs from the header row are detected, counted, and reported by row number.
- A quoted field that is never closed is detected and named as that, not reported as a generic parse failure — it is the defect most likely to swallow the remainder of a file into one cell.
- Detection does not attempt repair, and **this asymmetry with CAP-5 is deliberate**: a broken JSON document has a syntactically correct reading a repairer can aim at, while a row with too many fields has no such target — any fix guesses which column the extra value belongs to, and a wrong guess is invisible in the Result.
- The affected rows stay inspectable in their raw form, so the user can decide what happened.
- A Source with structural damage can still be loaded and used, on the user's decision — but the damage is carried into the run status (CAP-34), because a result computed over it is a result to distrust.
- Nothing about this is silent. The failure this capability exists to prevent is the one C-10 names as characteristic.

### CAP-4 — Detect that a JSON Source is malformed

*Realizes UJ-1.*

- Strict parsing is attempted first, and a file that parses strictly is never modified.
- A file that does not parse strictly is reported as malformed, naming the file and the position where parsing failed.
- Detection distinguishes a malformed document from an unsupported shape — a valid JSON scalar or a deeply irregular structure is a different message from a syntax error.
- NDJSON is recognised as a valid shape rather than reported as malformed.

### CAP-5 — Repair a malformed JSON Source

*Realizes UJ-1.*

**Why this exists,** because the handled cases look arbitrary without it: the JSON that reaches querbeet broken most often did not come from a system, it came from a language model. That is why markdown code fences and ellipsis truncation are on the list beside trailing commas — they are what an assistant's answer looks like when it is pasted straight into a file. CAP-28 covers a model's answer arriving through the tool's own paste path; this covers the same answer arriving as a file the user saved.

- Repair is offered as an action, not performed automatically on the user's behalf without their knowledge.
- Handled cases include trailing commas, missing or single or smart quotes, unquoted keys, comments, markdown code fences, ellipsis truncation, and structurally truncated documents.
- A repair that fails — including by exhausting the call stack rather than raising a parse error — produces a clear message naming the file, and leaves the Source unloaded rather than partially loaded.
- The original file is never modified on disk.

### CAP-6 — Disclose what a repair changed

*Realizes UJ-1.*

- The user can see the differences between the file as delivered and the file as parsed.
- The Source is visibly marked as repaired for as long as it is loaded.
- The fact that a Source was repaired appears in the run status (CAP-34), because a repaired input is a reason to distrust a result.

### CAP-7 — Flatten nested JSON with an explicit array strategy

*Realizes UJ-1.*

- Nested objects flatten to dot-path column names.
- The array strategy is offered as three options: one JSON value per cell, one indexed column per position, or one row per array element.
- The choice is made per Source at import, is visible afterwards, can be changed without reloading the file, and is stored in the Recipe.
- Changing the strategy updates the flattened Preview immediately, so the effect on column count and row count is visible before committing.

### CAP-8 — Preview every Source

*Realizes UJ-1, UJ-2.*

- Row and column counts are shown for the full Source, not for the visible window.
- The Preview renders within an interaction-responsive time regardless of Source size.
- A JSON or NDJSON Source additionally offers a **structure view**: the original nested document as a collapsible tree, independent of the flattening. The user can switch between the structure view and the flattened table view at any time.
- The structure view is what makes an unsuitable array strategy (CAP-7) visible, so it is reachable while the strategy is being chosen and not only afterwards.

### CAP-9 — Detect column types and locales, and require confirmation before running

*Realizes UJ-1, UJ-2.*

- The proposed type, the proposed locale, and the share of values that parse under them are shown per column, e.g. "Date, dd.mm.yyyy — 842 of 900 values readable".
- Locale detection is not fixed to German. A column formatted `1,234.56` and one formatted `1.234,56` are each read correctly, and the system states which interpretation it chose. Sources in different locales can be loaded in the same session, and columns within one Source can carry different locales.
- **Detection reads every value in the column, not a sample.** Every comparable engine samples — DuckDB 20,480 rows, Arquero 1,000, Power Query 200, Frictionless 100 — and the value that resolves an ambiguous column, a day above 12 in `03/04/2025`, is decisive only inside the window that was scanned. That is the documented cause of silent corruption on large files. A querbeet column holds at most the C-3 design target and detection is already a walk over the column, so it reads all of it.
- Where two interpretations are both plausible — `1.234` is one thousand two hundred thirty-four in one locale and 1.234 in another — the system reports the ambiguity rather than picking silently, and the user resolves it. **Two outcomes are distinguished and worded differently:** either one reading carries decisive evidence and the count is shown — "47 values have a day above 12, so dd.mm" — or **nothing in the column settles it**, and the system says exactly that instead of naming a winner. The second state is the one no comparable tool has; DuckDB documents a tie-break in which dd-mm beats mm-dd silently, and Power Query inherits the operating system locale once at workbook creation.
- A leading-zero value such as `0123` stays text unless the user says otherwise.
- The user can change a column's type or locale; the hit rate recomputes immediately.
- Values that do not parse under the chosen type are marked as unparsed and remain inspectable in their original form — they are never silently replaced by null, and the original is retained rather than discarded once a value has been converted.
- The user can declare which tokens count as missing in a column — `-`, `n/a`, `k.A.`, an empty cell — because export formats disagree and the choice is not inferable. It is a first-class part of the column's confirmed typing rather than a display setting: what counts as missing changes null shares in the Column Profile (CAP-26), which rows form their own group (CAP-18), which rows a join matches (CAP-14), and what "is empty" means (CAP-15).
- Running the Pipeline is blocked until confirmation, and the confirmation is stored in the Recipe so the Consumer inherits the Author's decisions.

### CAP-10 — Annotate columns

*Realizes UJ-3.*

- Annotations are visible in the Sources pane and editable at any time.
- Annotations are stored in the Recipe.
- Annotations are included in the Column Profile shown to an LLM.

---

## Building the Pipeline

Realizes UJ-1, UJ-3. The Author assembles a graph of Steps in the Editor, which is a place entered deliberately rather than the default view. Every Step shows what it produced, and anything a Step did that could produce a plausible wrong number is reported at that Step.

### CAP-11 — Enter the Editor deliberately

*Realizes UJ-2.*

- Loading a Recipe does not open the Editor.
- Starting with no Recipe opens the Editor directly, since there is nothing else to show.
- Leaving and re-entering the Editor does not lose Step configuration.

### CAP-12 — Compose a Pipeline as a graph of Steps

*Realizes UJ-1, UJ-3.*

- A Step's inputs are Sources or the outputs of other Steps, chosen explicitly. A Step's output can feed more than one downstream Step, which is what makes a filtered subset reusable without duplicating work.
- Steps carry user-editable names, and those names are how they are referenced — in the Editor, in the Recipe, and in an LLM exchange.
- Exactly one Step is designated the Result Step, and changing that designation is a single action.
- A connection that would create a cycle is refused with a named reason.
- A Step whose input disappears — a removed Source, a deleted upstream Step — is marked broken and names what it lost, rather than being deleted or silently re-wired.
- Steps that do not contribute to the Result Step are visibly marked as such, so an unconnected leftover cannot be mistaken for part of the pipeline.
- Every Step kind states how many inputs it takes: Union takes two or more, Join takes exactly two, the rest take exactly one.
- The graph is navigable and editable by keyboard. Where a pointer gesture such as drag exists, it is an addition to a keyboard-reachable path and never the only way to perform an action (C-7).

### CAP-13 — Union tables with column mapping

*Realizes UJ-1.*

- Columns are matched by name where names agree, and the user maps the rest explicitly.
- Columns present in only some inputs are **listed to the user before the Step runs**, with the choice to map, keep (padded with nulls), or drop them — never dropped silently.
- The output row count equals the sum of the input row counts.

### CAP-14 — Join two tables on one or more keys

*Realizes UJ-1, UJ-2.*

- Multiple key columns are supported and matched pairwise.
- The join type is a per-Step setting; left is the default.
- After execution the Step reports how many left rows found no match.
- When the output row count exceeds the input row count, the Step warns explicitly that duplicate keys produced additional rows, and states the factor.
- An optional **duplicate audit** can be switched on per Step. With it on, the Step reports how many key values occurred more than once on each side and how many output rows each duplicated key produced, so duplication is known precisely rather than inferred from a total. It is off by default because it costs time on large inputs, and the run status (CAP-34) records whether it was on.
- Null handling in key columns is an explicit, documented Step setting — either nulls never match, or nulls match nulls — with the setting stored in the Recipe. The default is stated in the UI rather than implied.
- The Step warns when **both** inputs carry nulls in the key column. See `measured-constraints.md`: this is the case where the obvious fix multiplies rows quadratically instead of dropping them.

### CAP-15 — Filter rows

*Realizes UJ-1, UJ-2.*

- Operators cover equals, not equals, contains, greater than, less than, is empty, is not empty.
- "Is empty" matches null, an empty string, and a value consisting only of whitespace alike; "is not empty" is its exact complement. The UI states this, since it is the one operator where a user's intuition and a database's semantics differ.
- Multiple conditions can be combined; the combination rule (all / any) is explicit.
- Comparison respects the column's confirmed type — a date comparison compares dates, not strings.
- **A comparison value is held in the Recipe in canonical machine form, never in a display form.** A number is a number — `1000`, never `"1.000"` and never `"1000"`. A date is an ISO 8601 string — `"2025-12-31"`, never `"31.12.2025"`. Entry is locale-aware in the interface, storage is not, so a Recipe carries no locale of its own and reads the same wherever it is opened. A value that reached the Recipe in a display form would re-import the exact defect CAP-9 exists to prevent, one level further in, where no type confirmation is left to catch it.
- **A comparison value whose type disagrees with the column's confirmed type is refused, naming the disagreement.** Comparing a date column against `1000`, or a numeric column against `"2025-12-31"`, is a mistake and not a request. The alternative — accepting it and comparing under some coercion — is how established databases produce a silently empty result set, which is indistinguishable from an honest zero rows.
- The Step reports how many rows were removed.

### CAP-16 — Select, rename and reorder columns

*Realizes UJ-1.*

- Renaming to a name already in use is refused with a named reason.
- Column order in the Step determines column order in this Step's output and, if it is the Result Step, in every export.

### CAP-40 — Order rows and keep the first or last N

*Realizes UJ-1, UJ-2.* Two Steps that compose: *Sortieren* makes a row order part of the data, *Erste/Letzte N* keeps a window of it.

- Ordering is by one or several columns, each ascending or descending. A second key on a column already used is refused with a named reason.
- **The order is stable:** rows whose keys are equal keep the order they arrived in, and an order already on the input is refined rather than replaced — which is what makes "the first N" reproducible.
- Text compares under German collation, not by code unit, so `Äpfel` sorts beside `Apfel` and not behind `Zebra`.
- **A cell that is empty or did not parse under its confirmed type is placed last in both directions rather than compared**, per key. The Sort Step reports how many rows an unreadable value put there.
- The limit takes its rows from either end of the order in force, and which end is part of its configuration — reaching the other end by reversing the order upstream edits a different Step and turns everything downstream of it around too. It is not a reversal: the kept rows come out in the order they were already in.
- Because every order places unreadable values at the end, the limit reports how many of the rows it **kept** carry one. Reported, never refused: reading exactly those rows is a reason to ask for them.
- A count at or above the row count keeps every row and is not an error; a Step with no count set, and a Sort with no key, let every row through unchanged.
- Both the order and the limit travel in the Recipe and reach every export.

### CAP-17 — Add a computed column

*Realizes UJ-1, UJ-2.* No formula language exists in the MVP (C-9).

- Available operations: add, subtract, multiply, divide two numeric columns; ratio of two numeric columns; concatenate two or more columns with a separator; difference between two date columns in days.
- Division by zero and operations on unparsed values produce a marked empty cell, not a crash and not a silent zero.
- The resulting configuration is a plain data structure with no free text to parse, so an LLM can emit it and the system can validate it.

### CAP-18 — Aggregate

*Realizes UJ-1, UJ-2.*

- Aggregations available: count, count distinct, sum, average, minimum, maximum.
- Rows with null in a grouping column form their own visible group rather than disappearing.
- The Step reports the input and output row counts.

### CAP-19 — Preview every Step

*Realizes UJ-1, UJ-3.*

- The Preview shows the row and column count of that Step's full output.
- Warnings raised by that Step (CAP-13, CAP-14, CAP-15, CAP-18) are visible alongside its Preview, not only at the moment of execution.
- Changing a Step's configuration updates its Preview and the Preview of every Step downstream of it, subject to the execution mode in force (CAP-38).

### CAP-38 — Execute the Pipeline

*Realizes UJ-1, UJ-2, UJ-4.*

- **Below a stated row threshold the Pipeline is live.** Every configuration change recomputes the affected Steps and everything downstream, and the Previews and the Result are always current. No action is required to see the effect of an edit.
- **Above that threshold the Pipeline switches to explicit execution** and says so where the user is working. Edits then change the configuration without recomputing, Previews and Result are marked as belonging to the previous run, and a named action starts the new one.
- **The mode in force is stated, not inferred.** A user must never be in doubt about whether what they are looking at reflects the Step in front of them. This is the whole reason two modes are acceptable: the cost of the second mode is one visible piece of state, and the cost of getting it wrong is a decision made on a stale table.
- The threshold is a stated number the user can see, not a hidden heuristic, and crossing it is announced when it happens rather than discovered.
- Recomputation is incremental in both modes: changing a Step recomputes that Step and its dependents, never the Steps above it.
- In explicit mode, execution begins only after the Pre-flight Check has been shown (CAP-22), and it reports through the run status (CAP-34).
- An execution long enough to be noticed shows progress and leaves the interface responsive, on the same terms as CAP-36's exports.
- The mode is a property of the session and the data in it, not of the Recipe. A Consumer running the same Recipe over a larger extract gets explicit mode without the Recipe saying anything about it.

---

## Recipes and Packages

Realizes UJ-2, UJ-4. A Recipe is the portable form of a Pipeline, with no data in it. A Package is the other artifact: a Recipe bundled with its data, compressed, for reproducing one concrete run.

### CAP-20 — Save and load a Recipe

*Realizes UJ-1, UJ-2, UJ-4.*

- A Recipe contains Steps, their configuration and their connections, Column Annotations, type and locale confirmations, the Dashboard definition, and the Input Contract. It contains no cell values.
- A Recipe carries a name and a free-text description the Author writes for the Consumer.
- A Recipe carries a format version; loading a Recipe of an unknown version is refused with a named reason rather than partially applied.
- The Recipe format is documented well enough that a language model can produce a valid one from the documentation alone (C-13).

### CAP-21 — Derive and carry an Input Contract

*Realizes UJ-2, UJ-4.*

- Per expected Source: a role name, the columns the Pipeline actually reads, and each column's confirmed type and locale.
- Columns the Pipeline never touches are not part of the contract, so an extra column in the Consumer's export is not a failure.
- The Author can edit the derived contract — loosening a type, marking a column optional — before saving.

### CAP-22 — Run a Pre-flight Check before executing

*Realizes UJ-2, UJ-4.*

- Each contract requirement is reported as fits, missing, or doubtful, with the reason.
- A column present under a different name is reported as missing with the actual column list offered for mapping (CAP-23).
- A column whose values do not parse under the expected type or locale is reported as doubtful, with the hit rate.
- The Pipeline does not execute while any requirement is missing.
- The outcome of the check remains visible after the run as part of the run status (CAP-34).

### CAP-23 — Map the Consumer's columns onto the contract

*Realizes UJ-2.*

- The mapping is offered per unmet requirement, listing the Source's actual columns.
- Applying a mapping re-runs the Pre-flight Check.
- Mappings can be saved back into the Recipe, so the same correction is not repeated next month.

### CAP-24 — Export and import a Package

*Realizes UJ-2.*

- A Package is compressed. Report data compresses heavily, and an uncompressed bundle of five 100k-row Sources would be an unsendable file.
- Importing a Package restores both the Pipeline and the Sources, with no further files needed.
- A Package is visibly distinct from a Recipe — different extension and an unmistakable indication in the UI that it contains data.
- Exporting a Package states the resulting file size before writing it.
- A Package that cannot be read — truncated, wrong version, corrupted — fails with a named reason and imports nothing, rather than importing a Recipe without its data.
- An imported Package and a persisted session (CAP-25) do not collide. Because the `file://` origin supplies no discriminator — every local page shares one storage bucket — the discriminator has to live in the database or key name, and it has to be there from the first version rather than retrofitted once two things are already stored under one key.

### CAP-25 — Persist the session, and make deleting it easy

*Realizes UJ-1, UJ-4.*

- Reopening the tool restores the previous session, including loaded data.
- The UI states plainly and persistently that data is stored in this browser, and says *what that means*: readable by other local pages, shared between copies of the tool, and removable by the browser without warning — storage cannot be made persistent from `file://` in either engine, so it is best-effort by construction.
- A single, discoverable action deletes all stored data; after it, reopening the tool starts empty. **It clears the shared store**, not "this file's" store.
- Deleting stored data does not require deleting the Recipe, and deleting the Recipe does not require deleting the data.
- Storing and restoring a session at the upper end of C-3 shows progress and leaves the interface responsive, on the same terms as CAP-36's exports.
- Restored state is treated as possibly incomplete rather than assumed intact. A session that comes back partial says so and offers to start clean, instead of presenting a Result computed over data that is no longer all there.
- Startup never blocks on `navigator.storage.persist()`.

Two user-visible consequences of the shared `file://` bucket, with the measurement behind them in `measured-constraints.md`:

- **Two copies of `querbeet.html` on one machine share one stored session.** Opening the second copy shows the first copy's Recipe and data. Copying the file is the expected way to distribute this tool, so this will happen.
- **Any other local HTML file the user opens can read querbeet's stored data, and querbeet can read theirs.** See C-8.

---

## LLM assistance

Realizes UJ-3. querbeet can be driven by a language model without giving that model the data. The whole exchange is copy-paste against any chat assistant; querbeet itself makes no network request (C-2).

### CAP-26 — Produce a Column Profile

*Realizes UJ-3.*

- The profile contains per Source: name, row count, and per column the name, confirmed type and locale, distinct-value count, null share, and Column Annotation.
- The profile contains no cell values unless the user explicitly releases samples (CAP-30).
- The profile is shown to the user in full before it is used for anything.

### CAP-27 — Generate a copy-ready prompt block

*Realizes UJ-3.*

- The block is copyable in one action.
- The block includes the Recipe format specification and the Probe Query format specification, so the model can answer in either.
- The block describes the Pipeline as it currently stands, so a model can be asked to modify rather than only to create.
- Everything that would leave the machine is visible in the block. There is no hidden portion.
- The block illustrates a **numeric** filter comparison, not only a text one. See `measured-constraints.md`: illustrating only text comparisons is what made four of five independent authoring runs guess the wrong shape.

### CAP-28 — Accept a Recipe from a model, validated

*Realizes UJ-3.*

- A syntactically invalid answer is rejected with a message specific enough to paste back to the model.
- A Recipe referencing a column, Source or Step that does not exist is rejected naming the failing reference, not partially applied.
- A Recipe describing a cyclic graph is rejected naming the cycle.
- A Recipe whose Steps do not all contribute to the Result Step is **not** rejected. Refusing it would make a pasted Recipe stricter than the Editor that produced it, since an Author mid-build always has orphans and CAP-12 marks them rather than refusing them. Orphans are marked on load, as they are anywhere else.
- **A comparison value that arrives in the wrong shape is resolved by a named rule, never by guessing.** A canonical numeric string is coerced to a number; a value carrying a grouping separator or a decimal comma is refused, naming the offending character; a date in any form other than ISO 8601 is refused rather than parsed, since the model had no locale to parse it under either; and a value whose type disagrees with the target column's confirmed type is refused naming both types, on the same reasoning as CAP-15. The validator is where this has to be settled, since a Recipe arrives through the clipboard and none of the mechanisms that constrain a model's output at generation time are available over that channel.
- A valid Recipe loads as ordinary Steps that the user can inspect and edit before running.
- A model's Recipe never replaces the existing Pipeline without the user seeing what changes.

### CAP-29 — Execute a Probe Query and disclose its result

*Realizes UJ-3.*

- A Probe Query is expressed in the same Step vocabulary as a Pipeline; it introduces no second query language.
- A Probe Query is validated on exactly the terms CAP-28 applies to a Recipe, including that an unrecognised field is refused rather than ignored. A validator that accepts what it does not understand cannot tell a Probe Query from a Recipe, which is the one distinction on which the disclosure boundary rests.
- The result is displayed to the user before any return step.
- The user copies the result back only after seeing it.
- A Probe Query cannot write, modify or delete anything; it reads.
- A Probe Query whose result would be large — more rows than a summary — is reported as such rather than producing a wall of data to paste.

### CAP-30 — Release sample values explicitly

*Realizes UJ-3.*

- Sample release is off by default and chosen per column per exchange.
- The samples that would be sent are shown before they are sent.
- The setting does not persist into the Recipe; a Consumer never inherits an Author's disclosure decision.

---

## Result, view and Dashboard

Realizes UJ-1, UJ-2, UJ-4. The Result is where the Consumer lands and where the Author checks their work. The distinction between changing the *data* and changing the *view* is deliberate and visible.

### CAP-31 — Display the Result as a table

*Realizes UJ-1, UJ-2.*

- Row and column counts shown are the totals, not what is rendered.
- Scrolling through a hundred thousand rows stays smooth, and the scroll position maps to the correct rows throughout.
- Column headers remain visible while scrolling.
- Values are displayed in German conventions — decimal comma, thousands separator, `dd.mm.yyyy` dates — regardless of the locale they were read in.
- Cells whose value did not parse under the column's confirmed type are visually marked.

### CAP-32 — Filter and sort the view, and promote a view filter into the Pipeline

*Realizes UJ-2.*

- View filters are set from the column headers and apply to the full Result, not to the rendered window.
- View filters and sorting are transient: they are not stored in the Recipe and are lost on reload.
- The UI states while a view filter is active that this is a view, not the data.
- A single action converts the active view filters into a Filter Step inserted before the Result Step, after which they are data and are stored in the Recipe.

### CAP-33 — Search the full dataset

*Realizes UJ-2.*

- Search runs over every row of the Result, not over the DOM.
- The number of matches is shown, and the user can jump between them.
- Searching a hundred thousand rows returns within an interaction-responsive time.
- The search field is prominent enough to be found by a user who reflexively pressed Ctrl+F first.

### CAP-34 — Show the run status

*Realizes UJ-2, UJ-4.*

- The status summarises the Pre-flight Check outcome, every warning raised by any Step during the run, whether any Source was repaired (CAP-6), whether any Source was structurally damaged (CAP-39), and whether the duplicate audit (CAP-14) was on.
- A run with warnings is distinguishable at a glance from a clean run, without opening the Editor.
- The status names the Steps involved, so a user can act on it.
- The status travels into the exported view document (CAP-37), because the Boxchecker's copy must carry the same caveats the screen did.

### CAP-35 — Compose a Dashboard from Tiles

*Realizes UJ-1, UJ-2.*

- Tile kinds: table, Top-N/Bottom-N, bar chart, line chart, key figure.
- Every Tile is configured through the same small form: grouping column, measured column, aggregation, row limit.
- Tiles occupy a fixed grid; order changes through keyboard-reachable controls and size through three preset steps. There is no free positioning and no overlap.
- The Dashboard definition is stored in the Recipe, so a Consumer sees the Author's Dashboard.
- Starting with no Recipe opens the Editor rather than an empty Dashboard.

---

## Export

Realizes UJ-1, UJ-2. The Result leaves querbeet as a data file for further work, or as a self-contained view document for someone who will only read it.

### CAP-36 — Export data files

*Realizes UJ-1, UJ-2.* Formats: CSV, JSON, XLSX, Parquet.

- CSV export is UTF-8 with a byte-order mark and a configurable delimiter defaulting to semicolon, so German Excel opens it correctly without an import dialog.
- Numbers and dates in CSV and XLSX are written in German conventions.
- XLSX export produces real numbers and real dates with German format codes, preserves leading zeros as text, and preserves umlauts and the euro sign.
- Parquet export produces a file that standard readers accept, and that querbeet itself can load back (CAP-1).
- An export that takes noticeably long shows progress and does not freeze the interface. The measured export timings that make this mandatory rather than polite are in `measured-constraints.md`.

### CAP-37 — Export a view document

*Realizes UJ-1, UJ-2.*

- HTML export is a single file with everything embedded, opening correctly with no network access.
- The exported document shows the Dashboard as configured and the Result table.
- The document is static: no filtering, no sorting, no interaction.
- PDF export produces the same content in paginated form.
- **Charts arrive in both documents as vector graphics whose axis labels are real, selectable text — not as a screenshot of a chart.** Measured: a vector chart printed to PDF carried 21–35 of the application's own formatted axis labels as text and produced zero raster images, while the same chart drawn to a canvas printed as an image sized by the screen's pixel ratio — legible on the machine that made it and degrading on any other. A Boxchecker filing the document, or anyone searching it for a figure, depends on the first behaviour.
- The document names the Recipe that produced it, the date, and the Sources by name — enough for a Boxchecker to file it without asking anyone what it is.
- The run status (CAP-34) is reproduced in the document, so a result produced from a repaired or doubtful input says so on paper.
- A large Result either goes in whole or goes in truncated **with the omission stated**: the document is static, so windowing does not apply.
