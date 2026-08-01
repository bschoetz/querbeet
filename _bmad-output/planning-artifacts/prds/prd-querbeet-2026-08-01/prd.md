---
title: querbeet
status: draft
created: 2026-08-01
updated: 2026-08-01
---

# PRD: querbeet

*Working title — confirmed, it is the repository name and the product name.*

## 0. Document Purpose

This PRD is the product-level contract for querbeet: what it does, for whom, and where its boundaries are. It is written for the project owner acting as PM, and for the downstream BMad workflows that consume it — architecture, UX, and epic breakdown. Vocabulary is anchored in the Glossary (§3); features are grouped with functional requirements nested underneath and numbered globally as FR-N so later artifacts can reference them stably. Inferences that were not confirmed carry an inline `[ASSUMPTION]` tag and are indexed in §9.

Four technical research runs precede this document and are treated as settled input, not re-litigated here: the transformation engine (Arquero), the UI framework and delivery path (Vue 3 via a Vite single-file build), file formats and parsing, and performance and table rendering. They live in `_bmad-output/planning-artifacts/research/`. This PRD states *capabilities*; the technology decisions and their consequences are recorded in `addendum.md` beside this file. Where a research finding is a genuine product requirement rather than an implementation detail — silent corruption of locale-formatted numbers, unfindable rows in a virtualized table, silent Cartesian products on join — it appears here as an FR.

## 1. Vision

querbeet turns a recurring data-consolidation chore into a file you can hand to someone else. It is a single HTML file that runs by double-click in a browser, with no server, no installation and no account. A user drops in a handful of report exports — CSV, JSON, Excel, Parquet — wires together a small graph of union, join, filter and column operations, and gets one consolidated table out, with charts and an export the recipient can act on.

What makes it more than a lightweight PowerQuery is that **the pipeline itself is a portable artifact**. A Recipe is a small JSON file describing the Steps, their settings, how they connect, and the input files they expect. Whoever holds a Recipe can run it against their own data without understanding it, without installing anything, and — this is the point — without sending that data to the person who wrote the Recipe. The author's expertise travels; the data does not. This is what turns a personal utility into leverage: a specialist writes a Recipe once, and a department serves itself with it repeatedly.

The second lever is that Recipes are cheap to write, because a language model can write them. querbeet hands an LLM a structural profile of the loaded Sources together with the user's own Column Annotations — never the raw values — and receives back either a Recipe or a Probe Query. A Probe Query is executed locally against the real data, and only its result travels back to the model. The model comes to *understand* the data without ever *seeing* it. The exchange runs over plain copy-paste against any chat assistant, so the tool needs no network access at all.

That querbeet makes no network requests is a feature, not a side effect. In an organisation, a tool that provably cannot exfiltrate data needs no approval process to try.

## 2. Target User

querbeet serves three roles. The first two often turn out to be the same person, which is why the MVP gives them one interface; their jobs are nonetheless different, and the product is shaped by the handoff between them. The third never touches the tool at all.

**The Author** builds pipelines. Technically confident, comfortable with data, not necessarily a programmer — the person who today reaches for PowerQuery, a spreadsheet full of VLOOKUPs, or a short script. They own the correctness of a Recipe.

**The Consumer** receives a Recipe and runs it against their own data. They are competent in their domain and read tables fluently, but they do not build pipelines and do not want to. They are why the Recipe exists.

**The Boxchecker** never opens querbeet. They receive its exports as documentation — evidence that something was measured, on a stated date, from stated inputs. Compliance, audit, quality management. They shape one requirement rather than many: an exported artifact must be self-describing enough to stand alone in a file six months later, which is why FR-37 requires it to name its Recipe and its date.

### 2.1 Jobs To Be Done

**As Author:**

- Replace a PowerQuery workflow that works but is slow, opaque and tied to one machine.
- Reach a correct pipeline faster by discussing it with an LLM instead of experimenting by hand.
- Stop being the bottleneck: hand out a Recipe instead of doing someone else's analysis, and without ever receiving their data.
- Produce a defensible artifact — something that goes in the compliance file and a list somebody can act on.

**As Consumer:**

- Get an overview of my own operational reality that today does not exist, or exists as a manual spreadsheet I do not fully trust.
- Answer my own question without waiting for a specialist and without handing my data to one.
- Repeat the same analysis next month against fresh files, with no re-learning.

**As Boxchecker:**

- Receive something that documents a state, is dated, names where it came from, and needs no explanation from the person who produced it.

### 2.2 Non-Users (v1)

- Anyone needing a live connection to a database, an API, or any data source that is not a file the user chose.
- Teams wanting shared state — a server, accounts, permissions, or a Recipe library that several people write to.
- Users at big-data scale. See NFR-3: there is no cap on the number of files, and no deliberate obstruction above the design target, but nothing beyond it is designed for, measured, or promised.

### 2.3 Key User Journeys

Journeys are numbered UJ-1..UJ-N and referenced by ID from the FRs. Note the difference in evidence between them, because it is load-bearing: **UJ-1, UJ-3 and UJ-4 describe work the Author does today and were captured from him. UJ-2 is a hypothesis** — the Consumer it describes has not been interviewed. It is written out because the product is designed for it, and marked so that nothing downstream mistakes it for evidence.

**UJ-1. Ben builds the patch-compliance report.**

- **Persona + context:** Ben runs IT. Once a quarter he owes the compliance file a status, and the CISO a list of people to chase about missing updates. He does it in PowerQuery today.
- **Entry state:** Three exports on the desktop — patch state per device, device-to-user mapping, installed software per device. He opens `querbeet.html` by double-click. No login, no connection.
- **Path:** He drags all three files into the Sources pane; each appears named, with detected columns and its first rows. One CSV gets a doubtful delimiter warning, which he corrects. He switches `LastPatchDate` from text to date and sees the Preview confirm it. He enters the Editor — acknowledging that he is now working on the mechanism — and joins patch state to the user mapping on device ID, then joins that result to software on the same ID. After the second join the tool warns that the row count went from 4,200 to 61,000: duplicate keys, many software rows per device. He inserts an Aggregate Step ahead of it. He filters to patch state older than 30 days, then keeps six columns and renames them into German.
- **Climax:** The Preview shows 143 rows — device, user, department, days behind. That is exactly the list the CISO needs.
- **Resolution:** He exports the list as Excel and the Result as static HTML for the file, then saves the Recipe as `patch-compliance.json`. Next quarter is Recipe plus three fresh files and two minutes.
- **Edge case:** A device missing from the software export would vanish silently under an inner join. After every join the tool reports how many left rows found no match.

**UJ-2. Christian measures consultant utilisation. `[ASSUMPTION — hypothesis, not captured]`**

- **Persona + context:** Christian heads the consulting practice. He wants to know how utilised and how profitable his consultants are. That means relating HR data, project and lead data, time bookings and billing — four sources. He is not a BI professional. Today this happens by hand in Excel: incomplete, shallow, and by his own account probably gap- and error-ridden.
- **Entry state:** He has a Recipe from Ben and his four export files. He has never built a pipeline.
- **Path:** He opens `querbeet.html`, loads the Recipe, and drops in his four files. The Pre-flight Check reports per requirement whether it fits, is missing, or is doubtful — one column is named differently in his export and he maps it. He runs the Pipeline and lands on the Dashboard, not the Editor.
- **Climax:** A utilisation figure per consultant per month, and a Top-N of the least profitable engagements — numbers he could not previously assemble at all.
- **Resolution:** He exports the table to Excel for his own further work and the Dashboard as PDF for his management round.
- **Edge case:** A wrong period, a missing consultant, or double-counted hours. The Pipeline's row-count and unmatched-row reporting is what has to make that visible, because he has no independent way to tell a plausible wrong number from a right one.
- **What is unknown and must be validated:** where his four files actually come from and how often; how the Recipe reaches him; whether his primary pain is processing the data he has or acquiring data he lacks. See §8.

**UJ-3. Ben works a problem out with an LLM instead of by trial and error.**

- **Persona + context:** Ben is building a pipeline over unfamiliar exports and does not yet know how the tables relate.
- **Entry state:** Sources loaded, no Pipeline yet.
- **Path:** He annotates a few columns in his own words. He asks querbeet for a prompt block, which contains his question, the Column Profile of every Source, and his annotations — no cell values. He pastes it into a chat assistant. It answers with a Probe Query rather than a Recipe: it wants to know how many time bookings have no matching project. He pastes that back; querbeet runs it locally and shows the result, along with exactly what would be sent back. He copies the number over. The assistant now proposes a Recipe, which he pastes into querbeet.
- **Climax:** The Recipe loads as real Steps he can inspect, and the Preview shows plausible output on the first run.
- **Resolution:** He adjusts two Steps by hand and keeps going. Nothing left the machine except structure, his own descriptions, and numbers he saw before he sent them.
- **Edge case:** The assistant returns a Recipe that references a column that does not exist. querbeet rejects it against the Input Contract and says which reference failed, so he can paste the error back.

**UJ-4. The monthly run.**

- **Persona + context:** Either operating role, repeating a known analysis against fresh files.
- **Entry state:** A Recipe that worked last month, and this month's exports.
- **Path:** Open the tool, load the Recipe, drop in the files, read the Pre-flight Check, run.
- **Climax:** The Result matches last month's shape, and the differences are in the data rather than in the pipeline.
- **Resolution:** Export, done, under two minutes. No decisions were required.
- **Edge case:** The source system changed its export format between months. The Pre-flight Check is what turns that from a wrong number into a visible problem.

## 3. Glossary

Downstream workflows and readers use these terms exactly. FRs, journeys and metrics use them verbatim. The German column is the UI label, because the interface is German while the code and these documents are English.

| Term | German UI label | Definition |
| --- | --- | --- |
| **Source** | Quelle | One loaded input file, named, with its detected columns, confirmed types and a data preview. A Source is immutable once loaded; Steps read from it and never write back. |
| **Column Annotation** | Spaltenbeschreibung | A free-text description the user attaches to a column of a Source, stating what it contains. Annotations are part of the Recipe and are sent to the LLM; they are never sent anywhere else. |
| **Column Profile** | Spaltenprofil | The structural description of a Source that may be shown to an LLM: column names, confirmed types, row and column counts, distinct-value counts, null shares, and Column Annotations. It contains no cell values unless the user explicitly releases samples. |
| **Step** | Schritt | One transformation node in a Pipeline. Every Step is one of a fixed set of kinds (Union, Join, Filter, Columns, Computed Column, Aggregate), carries a user-visible name and its own configuration, takes one or more named inputs, and produces exactly one table. |
| **Pipeline** | Pipeline | A directed acyclic graph of Steps over the loaded Sources. A Step's inputs are Sources or the outputs of other Steps. Exactly one Step is designated the Result Step. |
| **Result** | Ergebnis | The table produced by the Result Step. Every other Step also produces an output that can be previewed. |
| **Preview** | Vorschau | A windowed view of a Source or of any Step's output. Shows a bounded number of rows at a time; never the whole table at once. |
| **Recipe** | Rezept | A JSON file holding the Pipeline — Steps, their configurations and their connections — plus the Column Annotations, the type confirmations, the Dashboard definition, and the Input Contract. It contains **no data**. |
| **Package** | Paket | A compressed container bundling a Recipe together with the raw data of its Sources, so a recipient can reproduce one concrete run with the tool and this single file. Distinct from a Recipe, not a variant of one. |
| **Input Contract** | Erwartete Eingaben | The part of a Recipe declaring which Sources it expects and, per Source, which columns are required and their coarse types. Input for the Pre-flight Check. |
| **Pre-flight Check** | Vorprüfung | The validation run before a Pipeline executes, comparing the loaded Sources against the Input Contract and reporting per requirement whether it fits, is missing, or is doubtful. |
| **Editor** | Editor | The area in which the Pipeline is built and changed. Deliberately entered, not the landing view. |
| **Probe Query** | Prüfabfrage | A query authored by an LLM and executed locally against the real data, whose *result only* is returned to the LLM. The mechanism by which a model learns about data it may not see. |
| **Dashboard** | Dashboard | An arrangement of Tiles over the Result. |
| **Tile** | Kachel | One element of a Dashboard: a table view, a Top-N/Bottom-N list, a bar chart, a line chart, or a single key figure. |
| **Author** | — | The role that builds a Pipeline and writes a Recipe. |
| **Consumer** | — | The role that receives a Recipe and runs it against their own data. |
| **Boxchecker** | — | The role that receives an exported artifact as documentation and never operates the tool. |

## 4. Features

Six feature groups. FRs are numbered globally so downstream artifacts can reference them even if the grouping changes.

A theme runs through several of them and is stated once here rather than repeated: **querbeet's characteristic failure mode is a plausible wrong number, not an error message.** Silent thousand-fold misreads of locale-formatted numbers, silent Cartesian products on duplicate join keys, silently dropped columns on union, silently unmatched rows on join — each was measured during research as real behaviour of the underlying libraries. Every one of them produces output that looks fine. Making these visible is not defensive polish; it is the difference between a tool whose output can go in a compliance file and one whose output cannot.

### 4.1 Loading Sources

**Description:** The user brings report exports into the tool by drag-and-drop or file dialog. Each becomes a named Source with detected columns, a Preview, and a confirmed type mapping. Nothing is uploaded; the browser reads the files the user chose. Realizes UJ-1, UJ-2, UJ-4.

**Functional Requirements:**

#### FR-1: Load files as Sources

The user can add one or more files as Sources, by drag-and-drop onto the Sources pane or through a file dialog. Supported: CSV, JSON, NDJSON, XLSX and Parquet. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Multiple files dropped at once each become a separate Source.
- A Source carries a name, editable by the user, defaulting to the file name.
- Sources can be removed individually; removing a Source that a Step references marks that Step as broken rather than deleting it.
- An unsupported or unreadable file produces a named error against that file and leaves the other Sources loaded.
- A Parquet file written by querbeet's own export (FR-36) loads back with its columns and types intact.
- There is no limit on the number of Sources; the operative constraint is total row count (NFR-3).

#### FR-2: Determine character encoding, with a visible override

The system determines the encoding of a text file and lets the user override it. Realizes UJ-1.

**Consequences (testable):**
- A UTF-8, UTF-16LE or UTF-16BE byte-order mark decides the encoding outright.
- Absent a BOM, content that is valid UTF-8 is read as UTF-8; content that is not falls back to Windows-1252.
- The chosen encoding is displayed per Source and can be changed, which re-reads the file.
- Text containing German umlauts and the euro sign renders correctly under both the UTF-8 and the Windows-1252 path.

#### FR-3: Detect CSV delimiter and header row, with correction

The system proposes a delimiter and a header row for each CSV Source, and the user can correct both. Realizes UJ-1.

**Consequences (testable):**
- Semicolon-delimited files, the German Excel default, are detected as such.
- When the delimiter cannot be determined, the system says so explicitly and asks, rather than guessing silently.
- Files with preamble lines before the header can be handled by setting the header row to a later line; the Preview updates to match.
- Both settings are stored in the Recipe.

#### FR-4: Detect that a JSON Source is malformed

The system distinguishes a JSON file it can parse from one it cannot, before attempting anything else. Realizes UJ-1.

**Consequences (testable):**
- Strict parsing is attempted first, and a file that parses strictly is never modified.
- A file that does not parse strictly is reported as malformed, naming the file and the position where parsing failed.
- Detection distinguishes a malformed document from an unsupported shape — a valid JSON scalar or a deeply irregular structure is a different message from a syntax error.
- NDJSON is recognised as a valid shape rather than reported as malformed.

#### FR-5: Repair a malformed JSON Source

The user can have the system attempt a repair of a malformed JSON Source. Realizes UJ-1.

**Consequences (testable):**
- Repair is offered as an action, not performed automatically on the user's behalf without their knowledge.
- Handled cases include trailing commas, missing or single or smart quotes, unquoted keys, comments, markdown code fences, ellipsis truncation, and structurally truncated documents.
- A repair that fails — including by exhausting the call stack rather than raising a parse error — produces a clear message naming the file, and leaves the Source unloaded rather than partially loaded.
- The original file is never modified on disk.

#### FR-6: Disclose what a repair changed

A repair that succeeded shows the user what it did. Realizes UJ-1.

**Consequences (testable):**
- The user can see the differences between the file as delivered and the file as parsed.
- The Source is visibly marked as repaired for as long as it is loaded.
- The fact that a Source was repaired appears in the run status (FR-34), because a repaired input is a reason to distrust a result.

#### FR-7: Flatten nested JSON with an explicit array strategy

The system flattens nested JSON into a tabular Source, and the handling of arrays is a choice the user makes rather than a hidden default. Realizes UJ-1.

**Consequences (testable):**
- Nested objects flatten to dot-path column names.
- The array strategy is offered as three options: one JSON value per cell, one indexed column per position, or one row per array element.
- The choice is made per Source at import, is visible afterwards, can be changed without reloading the file, and is stored in the Recipe.
- Changing the strategy updates the flattened Preview immediately, so the effect on column count and row count is visible before committing.

#### FR-8: Preview every Source

Every loaded Source shows its detected columns and a bounded window of its rows. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Row and column counts are shown for the full Source, not for the visible window.
- The Preview renders within an interaction-responsive time regardless of Source size.
- A JSON or NDJSON Source additionally offers a **structure view**: the original nested document as a collapsible tree, independent of the flattening. The user can switch between the structure view and the flattened table view at any time.
- The structure view is what makes an unsuitable array strategy (FR-7) visible, so it is reachable while the strategy is being chosen and not only afterwards.

#### FR-9: Detect column types and locales, and require confirmation before running

The system proposes a type and, where relevant, a number and date locale per column, and does not execute a Pipeline until the user has confirmed the type mapping of each Source once. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- The proposed type, the proposed locale, and the share of values that parse under them are shown per column, e.g. "Date, dd.mm.yyyy — 842 of 900 values readable".
- Locale detection is not fixed to German. A column formatted `1,234.56` and one formatted `1.234,56` are each read correctly, and the system states which interpretation it chose. Sources in different locales can be loaded in the same session, and columns within one Source can carry different locales.
- Where two interpretations are both plausible — `1.234` is one thousand two hundred thirty-four in one locale and 1.234 in another — the system reports the ambiguity rather than picking silently, and the user resolves it.
- A leading-zero value such as `0123` stays text unless the user says otherwise.
- The user can change a column's type or locale; the hit rate recomputes immediately.
- Values that do not parse under the chosen type are marked as unparsed and remain inspectable — they are never silently replaced by null.
- Running the Pipeline is blocked until confirmation, and the confirmation is stored in the Recipe so the Consumer inherits the Author's decisions.

#### FR-10: Annotate columns

The user can attach a free-text description to any column of a Source. Realizes UJ-3.

**Consequences (testable):**
- Annotations are visible in the Sources pane and editable at any time.
- Annotations are stored in the Recipe.
- Annotations are included in the Column Profile shown to an LLM.

**Notes:** `[NOTE FOR PM]` FR-9's confirmation gate is the single most user-visible friction in the product and the single strongest correctness guarantee. If usage shows it being clicked through blindly, the mitigation is to make unconfirmed columns visually loud in the Result, not to remove the gate.

### 4.2 Building the Pipeline

**Description:** The Author assembles a graph of Steps in the Editor. The Editor is a place entered deliberately, not the default view. Every Step shows what it produced, and anything a Step did that could produce a plausible wrong number is reported at that Step. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-11: Enter the Editor deliberately

The Editor is a distinct area of the application which the user enters through an explicit action acknowledging that the Pipeline can be changed there. Realizes UJ-2.

**Consequences (testable):**
- Loading a Recipe does not open the Editor.
- Starting with no Recipe opens the Editor directly, since there is nothing else to show.
- Leaving and re-entering the Editor does not lose Step configuration.

#### FR-12: Compose a Pipeline as a graph of Steps

The user can add Steps, connect them, name them, and designate which one produces the Result. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- A Step's inputs are Sources or the outputs of other Steps, chosen explicitly. A Step's output can feed more than one downstream Step, which is what makes a filtered subset reusable without duplicating work.
- Steps carry user-editable names, and those names are how they are referenced — in the Editor, in the Recipe, and in an LLM exchange.
- Exactly one Step is designated the Result Step, and changing that designation is a single action.
- A connection that would create a cycle is refused with a named reason.
- A Step whose input disappears — a removed Source, a deleted upstream Step — is marked broken and names what it lost, rather than being deleted or silently re-wired.
- Steps that do not contribute to the Result Step are visibly marked as such, so an unconnected leftover cannot be mistaken for part of the pipeline.
- Every Step kind states how many inputs it takes: Union takes two or more, Join takes exactly two, the rest take exactly one.
- The graph is navigable and editable by keyboard. Where a pointer gesture such as drag exists, it is an addition to a keyboard-reachable path and never the only way to perform an action.

#### FR-13: Union tables with column mapping

The user can stack two or more tables, mapping differently-named columns onto each other. Realizes UJ-1.

**Consequences (testable):**
- Columns are matched by name where names agree, and the user maps the rest explicitly.
- Columns present in only some inputs are **listed to the user before the Step runs**, with the choice to map, keep (padded with nulls), or drop them — never dropped silently.
- The output row count equals the sum of the input row counts.

#### FR-14: Join two tables on one or more keys

The user can join two tables on one or several key columns, choosing left or inner join. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Multiple key columns are supported and matched pairwise.
- The join type is a per-Step setting; left is the default.
- After execution the Step reports how many left rows found no match.
- When the output row count exceeds the input row count, the Step warns explicitly that duplicate keys produced additional rows, and states the factor.
- An optional **duplicate audit** can be switched on per Step. With it on, the Step reports how many key values occurred more than once on each side and how many output rows each duplicated key produced, so duplication is known precisely rather than inferred from a total. It is off by default because it costs time on large inputs, and the run status (FR-34) records whether it was on.
- Null handling in key columns is an explicit, documented Step setting — either nulls never match, or nulls match nulls — with the setting stored in the Recipe. The default is stated in the UI rather than implied.

#### FR-15: Filter rows

The user can restrict rows by conditions on columns. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Operators cover equals, not equals, contains, greater than, less than, is empty, is not empty.
- "Is empty" matches null, an empty string, and a value consisting only of whitespace alike; "is not empty" is its exact complement. The UI states this, since it is the one operator where a user's intuition and a database's semantics differ.
- Multiple conditions can be combined; the combination rule (all / any) is explicit.
- Comparison respects the column's confirmed type — a date comparison compares dates, not strings.
- The Step reports how many rows were removed.

#### FR-16: Select, rename and reorder columns

The user can choose which columns survive, rename them, and set their order. Realizes UJ-1.

**Consequences (testable):**
- Renaming to a name already in use is refused with a named reason.
- Column order in the Step determines column order in this Step's output and, if it is the Result Step, in every export.

#### FR-17: Add a computed column

The user can derive a new column by choosing an operation and its inputs from fixed lists. No formula language exists in the MVP. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Available operations: add, subtract, multiply, divide two numeric columns; ratio of two numeric columns; concatenate two or more columns with a separator; difference between two date columns in days.
- Division by zero and operations on unparsed values produce a marked empty cell, not a crash and not a silent zero.
- The resulting configuration is a plain data structure with no free text to parse, so an LLM can emit it and the system can validate it.

#### FR-18: Aggregate

The user can group rows by one or more columns and compute aggregates. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Aggregations available: count, count distinct, sum, average, minimum, maximum.
- Rows with null in a grouping column form their own visible group rather than disappearing.
- The Step reports the input and output row counts.

#### FR-19: Preview every Step

Selecting a Step shows the table it produces. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- The Preview shows the row and column count of that Step's full output.
- Warnings raised by that Step (FR-13, FR-14, FR-15, FR-18) are visible alongside its Preview, not only at the moment of execution.
- Changing a Step's configuration updates its Preview and the Preview of every Step downstream of it.

### 4.3 Recipes and Packages

**Description:** A Recipe is the portable form of a Pipeline — Steps, connections, settings, annotations, type confirmations, Dashboard, and the Input Contract, with no data in it. A Package is the other artifact: a Recipe bundled with its data, compressed, for reproducing one concrete run. Loading a Recipe against unfamiliar files runs a Pre-flight Check before anything executes. Realizes UJ-2, UJ-4.

**Functional Requirements:**

#### FR-20: Save and load a Recipe

The user can export the current Pipeline as a Recipe file and load one back. Realizes UJ-1, UJ-2, UJ-4.

**Consequences (testable):**
- A Recipe contains Steps, their configuration and their connections, Column Annotations, type and locale confirmations, the Dashboard definition, and the Input Contract. It contains no cell values.
- A Recipe carries a name and a free-text description the Author writes for the Consumer.
- A Recipe carries a format version; loading a Recipe of an unknown version is refused with a named reason rather than partially applied.
- The Recipe format is documented well enough that a language model can produce a valid one from the documentation alone.

#### FR-21: Derive and carry an Input Contract

Saving a Recipe records what the Pipeline expects of its inputs. Realizes UJ-2, UJ-4.

**Consequences (testable):**
- Per expected Source: a role name, the columns the Pipeline actually reads, and each column's confirmed type and locale.
- Columns the Pipeline never touches are not part of the contract, so an extra column in the Consumer's export is not a failure.
- The Author can edit the derived contract — loosening a type, marking a column optional — before saving.

#### FR-22: Run a Pre-flight Check before executing

When a Recipe is loaded together with files, the system validates the files against the Input Contract and reports the outcome before any Step runs. Realizes UJ-2, UJ-4.

**Consequences (testable):**
- Each contract requirement is reported as fits, missing, or doubtful, with the reason.
- A column present under a different name is reported as missing with the actual column list offered for mapping (FR-23).
- A column whose values do not parse under the expected type or locale is reported as doubtful, with the hit rate.
- The Pipeline does not execute while any requirement is missing.
- The outcome of the check remains visible after the run as part of the run status (FR-34).

#### FR-23: Map the Consumer's columns onto the contract

Where a required column is missing, the user can map one of their actual columns onto it. Realizes UJ-2.

**Consequences (testable):**
- The mapping is offered per unmet requirement, listing the Source's actual columns.
- Applying a mapping re-runs the Pre-flight Check.
- Mappings can be saved back into the Recipe, so the same correction is not repeated next month.

#### FR-24: Export and import a Package

The user can export a Recipe bundled with the data of its Sources as a single compressed file, and load such a file. Realizes UJ-2.

**Consequences (testable):**
- A Package is compressed. Report data compresses heavily, and an uncompressed bundle of five 100k-row Sources would be an unsendable file.
- Importing a Package restores both the Pipeline and the Sources, with no further files needed.
- A Package is visibly distinct from a Recipe — different extension and an unmistakable indication in the UI that it contains data.
- Exporting a Package states the resulting file size before writing it.
- A Package that cannot be read — truncated, wrong version, corrupted — fails with a named reason and imports nothing, rather than importing a Recipe without its data.
- An imported Package and a persisted session (FR-25) do not collide. Because the `file://` origin
  supplies no discriminator — every local page shares one storage bucket, measured in R9 — the
  discriminator has to live in the database or key name, and it has to be there from the first
  version rather than retrofitted once two things are already stored under one key.

#### FR-25: Persist the session, and make deleting it easy

The current Recipe and the loaded Source data survive closing and reopening the tool, and the user can delete stored data in one obvious action. Realizes UJ-1, UJ-4.

**Consequences (testable):**
- Reopening the tool restores the previous session, including loaded data.
- The UI states plainly and persistently that data is stored in this browser.
- A single, discoverable action deletes all stored data; after it, reopening the tool starts empty.
- Deleting stored data does not require deleting the Recipe, and deleting the Recipe does not require deleting the data.

**Measured constraint — the storage is shared, not private to this file.** Research R9 confirmed
IndexedDB works from `file://` in both engines and survives a browser restart, so this requirement
is buildable as written. It also measured something the requirement did not anticipate: **a
`file://` page has an opaque origin, and every local page shares one storage bucket.** A page in a
*different directory*, opened by its own `file://` URL, read back a full 100,000-row Source written
by another directory's page — in Chromium 151 and Firefox 153 alike. This cannot be fixed from
inside querbeet; it is what an opaque origin means.

Three consequences follow, and the first two are user-visible:

- **Two copies of `querbeet.html` on one machine share one stored session.** Opening the second
  copy shows the first copy's Recipe and data. Copying the file is the expected way to distribute
  this tool, so this will happen.
- **Any other local HTML file the user opens can read querbeet's stored data, and querbeet can read
  theirs.** See the qualification added to NFR-8.
- **The one-action delete clears the shared store**, not "this file's" store.

**Additional consequences (testable):**
- The statement that data is stored in this browser says *what that means*: readable by other local
  pages, shared between copies of the tool, and removable by the browser without warning — storage
  cannot be made persistent from `file://` in either engine, so it is best-effort by construction.
- A restored session that is incomplete is reported as incomplete rather than presented as whole.
- Startup never blocks on `navigator.storage.persist()`. R9 measured it never settling in Firefox
  from `file://`, which deadlocked its own probe for 180 seconds before the first byte was stored.

### 4.4 LLM Assistance

**Description:** querbeet can be driven by a language model without giving that model the data. The tool produces a Column Profile — structure, not values — together with the user's Column Annotations. The model answers with a Recipe or with a Probe Query, which the tool runs locally and whose result only is returned. The whole exchange is copy-paste against any chat assistant; querbeet itself makes no network request. Realizes UJ-3.

**Functional Requirements:**

#### FR-26: Produce a Column Profile

The system can produce a structural description of the loaded Sources suitable for showing to a language model. Realizes UJ-3.

**Consequences (testable):**
- The profile contains per Source: name, row count, and per column the name, confirmed type and locale, distinct-value count, null share, and Column Annotation.
- The profile contains no cell values unless the user explicitly releases samples (FR-30).
- The profile is shown to the user in full before it is used for anything.

#### FR-27: Generate a copy-ready prompt block

The user can produce a text block containing their question, the Column Profile, and the instructions a model needs to answer in a form querbeet accepts. Realizes UJ-3.

**Consequences (testable):**
- The block is copyable in one action.
- The block includes the Recipe format specification and the Probe Query format specification, so the model can answer in either.
- The block describes the Pipeline as it currently stands, so a model can be asked to modify rather than only to create.
- Everything that would leave the machine is visible in the block. There is no hidden portion.

#### FR-28: Accept a Recipe from a model, validated

The user can paste a model's answer, and the system validates it before applying anything. Realizes UJ-3.

**Consequences (testable):**
- A syntactically invalid answer is rejected with a message specific enough to paste back to the model.
- A Recipe referencing a column, Source or Step that does not exist is rejected naming the failing reference, not partially applied.
- A Recipe describing a cyclic or disconnected graph is rejected naming the defect.
- A valid Recipe loads as ordinary Steps that the user can inspect and edit before running.
- A model's Recipe never replaces the existing Pipeline without the user seeing what changes.

#### FR-29: Execute a Probe Query and disclose its result

The user can run a query authored by a model against the real data locally, and see exactly what would be sent back before sending it. Realizes UJ-3.

**Consequences (testable):**
- A Probe Query is expressed in the same Step vocabulary as a Pipeline; it introduces no second query language.
- The result is displayed to the user before any return step.
- The user copies the result back only after seeing it.
- A Probe Query cannot write, modify or delete anything; it reads.
- A Probe Query whose result would be large — more rows than a summary — is reported as such rather than producing a wall of data to paste.

#### FR-30: Release sample values explicitly

The user can choose to include example values from a column in what goes to the model. Realizes UJ-3.

**Consequences (testable):**
- Sample release is off by default and chosen per column per exchange.
- The samples that would be sent are shown before they are sent.
- The setting does not persist into the Recipe; a Consumer never inherits an Author's disclosure decision.

### 4.5 Result, View and Dashboard

**Description:** The Result is where the Consumer lands and where the Author checks their work. It offers a virtualized table with transient view filters and its own search, plus a Dashboard of tiles that lives in the Recipe. The distinction between changing the *data* and changing the *view* is deliberate and visible. Realizes UJ-1, UJ-2, UJ-4.

**Functional Requirements:**

#### FR-31: Display the Result as a table

The Result is shown as a table that stays responsive at the design scale. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Row and column counts shown are the totals, not what is rendered.
- Scrolling through a hundred thousand rows stays smooth, and the scroll position maps to the correct rows throughout.
- Column headers remain visible while scrolling.
- Values are displayed in German conventions — decimal comma, thousands separator, `dd.mm.yyyy` dates — regardless of the locale they were read in.
- Cells whose value did not parse under the column's confirmed type are visually marked.

#### FR-32: Filter and sort the view, and promote a view filter into the Pipeline

The user can filter and sort what the table shows without changing the Result, and can turn such a filter into a Pipeline Step. Realizes UJ-2.

**Consequences (testable):**
- View filters are set from the column headers and apply to the full Result, not to the rendered window.
- View filters and sorting are transient: they are not stored in the Recipe and are lost on reload.
- The UI states while a view filter is active that this is a view, not the data.
- A single action converts the active view filters into a Filter Step inserted before the Result Step, after which they are data and are stored in the Recipe.

#### FR-33: Search the full dataset

The user can search the Result and reach matches that are not currently rendered. Realizes UJ-2.

**Consequences (testable):**
- Search runs over every row of the Result, not over the DOM.
- The number of matches is shown, and the user can jump between them.
- Searching a hundred thousand rows returns within an interaction-responsive time.
- The search field is prominent enough to be found by a user who reflexively pressed Ctrl+F first.

#### FR-34: Show the run status

The Dashboard shows whether the run that produced it was clean. Realizes UJ-2, UJ-4.

**Consequences (testable):**
- The status summarises the Pre-flight Check outcome, every warning raised by any Step during the run, whether any Source was repaired (FR-6), and whether the duplicate audit (FR-14) was on.
- A run with warnings is distinguishable at a glance from a clean run, without opening the Editor.
- The status names the Steps involved, so a user can act on it.
- The status travels into the exported view document (FR-37), because the Boxchecker's copy must carry the same caveats the screen did.

#### FR-35: Compose a Dashboard from tiles

The user can add, configure, order and size tiles over the Result. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Tile kinds: table, Top-N / Bottom-N, bar chart, line chart, key figure.
- Every tile is configured through the same small form: grouping column, measured column, aggregation, row limit.
- Tiles occupy a fixed grid; order changes through keyboard-reachable controls and size through three preset steps. There is no free positioning and no overlap.
- The Dashboard definition is stored in the Recipe, so a Consumer sees the Author's Dashboard.
- Starting with no Recipe opens the Editor rather than an empty Dashboard.

### 4.6 Export

**Description:** The Result leaves querbeet as a data file for further work, or as a self-contained view document for someone who will only read it. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-36: Export data files

The user can export the Result as CSV, JSON, XLSX or Parquet. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- CSV export is UTF-8 with a byte-order mark and a configurable delimiter defaulting to semicolon, so German Excel opens it correctly without an import dialog.
- Numbers and dates in CSV and XLSX are written in German conventions.
- XLSX export produces real numbers and real dates with German format codes, preserves leading zeros as text, and preserves umlauts and the euro sign.
- Parquet export produces a file that standard readers accept, and that querbeet itself can load back (FR-1).
- An export that takes noticeably long shows progress and does not freeze the interface.

#### FR-37: Export a view document

The user can export the Result and Dashboard as a self-contained document to hand to someone who will only read it. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- HTML export is a single file with everything embedded, opening correctly with no network access.
- The exported document shows the Dashboard as configured and the Result table.
- The document is static: no filtering, no sorting, no interaction.
- PDF export produces the same content in paginated form.
- The document names the Recipe that produced it, the date, and the Sources by name — enough for a Boxchecker to file it without asking anyone what it is.
- The run status (FR-34) is reproduced in the document, so a result produced from a repaired or doubtful input says so on paper.

**Notes:** `[NOTE FOR PM]` An interactive HTML export — one the recipient can filter and sort in — was considered and deliberately cut as the most expensive item in the MVP. It is the strongest candidate for the first post-MVP addition, because it collapses the Consumer's setup cost to zero.

### 4.7 Cross-cutting Non-Functional Requirements

- **NFR-1 — Delivery.** The product is one HTML file, opened by double-click from the local filesystem. It works with no server, no installation, no account, and no network connection. A build step may produce that file; using it must never require one.
- **NFR-2 — Network silence.** The application makes no network request of any kind. This is unconditional in the MVP and verifiable from the built artifact.
- **NFR-3 — Scale.** The design target is roughly 100,000 rows per Source and on the order of half a million rows in total across all Sources. Interactive operations — preview, scroll, filter, search, step reconfiguration — stay responsive at that scale. There is no limit on the number of Sources and no artificial row cap; behaviour beyond the target is neither promised nor deliberately obstructed.
- **NFR-4 — Browsers.** **Chromium is the lead browser** — Edge 143+ and Chrome 143+ — on a project decision of 2026-08-01: every colleague has Edge installed, so a Chromium browser is universally available. Firefox 145+ remains a target but is secondary: it is *measured* during the first builds rather than assumed, and if it does not carry the JavaScript-heavy paths it is dropped rather than specially accommodated. Safari is optional. One consequence is already known and is not a reason to keep Firefox: Firefox is the stricter engine on the scroll-extent limit, collapsing an oversized spacer to zero height at roughly 614,000 rows where Chromium clamps and keeps working — so the spacer guard is built regardless of whether Firefox stays a target.
- **NFR-5 — Form factor.** Desktop only, designed for Full HD. Mobile and tablet layouts are not supported and not attempted.
- **NFR-6 — Language.** The interface is German. Code, comments, and project documents are English.
- **NFR-7 — Accessibility.** No WCAG conformance level is targeted and no accessibility testing is required. Semantic markup and ARIA attributes are welcome where they are free. One rule is not optional, because it is a correctness rule rather than an accessibility one: **no interaction may exist only as a pointer gesture.** Drag-and-drop is permitted and encouraged for file input, Step arrangement and tile ordering — implemented as a gesture that computes a target and updates the underlying model, never as a library that reorders DOM nodes itself, which is the documented cause of a list fighting its own framework. Every such action also has a keyboard-reachable path.
- **NFR-8 — Data residence.** Cell values leave the browser only through an export the user triggered, or through an LLM disclosure the user saw and confirmed before copying it. There is no other path out. **Qualified 2026-08-01 by measurement (R9):** this holds for leaving the *browser*, but not for leaving *querbeet*. Data persisted under FR-25 sits in the shared `file://` storage bucket, where any other local HTML page the user opens can read it — measured across directories in both engines. Nothing leaves the machine, and the guarantee above is unchanged; what is not guaranteed is isolation from other local pages, and the UI must not imply otherwise.

## 5. Non-Goals (Explicit)

Some of these are permanent; some are MVP boundaries. They are marked, because a downstream reader treating a deferral as a principle will build the wrong thing.

**Permanent:**

- **No server, no backend, no accounts.** There is nothing to log in to. Everything is a file on the user's machine.
- **No live data sources.** No database connections, no scheduled pulls, no APIs feeding data in. Data enters as a file the user chose.
- **Not a data-acquisition tool.** querbeet consolidates files the user already has. Finding, extracting or requesting data they lack is out of scope, and a user whose primary problem is acquisition is not served by this product.
- **No collaboration.** No comments, no shared workspace, no version history on a server. Sharing means sending a file.
- **No mobile.** See NFR-5.

**Deferred, not rejected:**

- **The overlap with self-service BI is real, and the boundary is the operating model rather than the feature list.** querbeet aggregates, computes key figures, draws charts, arranges a dashboard and distributes recipes to departments — that is small self-service BI, and pretending otherwise would misdescribe the product. What it does not do, and is not trying to do: run on a server, connect to live sources, hold shared state, refresh on a schedule, or maintain a semantic layer that several reports draw on. It is file in, file out. A department that outgrows that has outgrown querbeet, and that is the correct outcome.
- **No formula language, no scripting, no SQL — in the MVP.** Everything the tool does is expressible as a fixed set of configured Steps, which is what makes Recipes portable and machine-writable. A formula or expression capability is a plausible later addition; it is excluded now because it would enlarge what a language model must get right, not because expressions are wrong.
- **No big data.** See NFR-3. No streaming, no chunked out-of-core processing.
- **No roles, permissions or a Consumer-only view.** See §6.2.
- **No accessibility conformance.** See NFR-7.

## 6. MVP Scope

### 6.1 In Scope

- Loading CSV, JSON, NDJSON, XLSX and Parquet Sources with encoding, delimiter, header, JSON repair, flattening and locale-aware type handling, including the mandatory type confirmation (FR-1 – FR-10).
- A Step graph with six Step kinds — Union, Join, Filter, Columns, Computed Column, Aggregate — with per-Step preview and per-Step warnings (FR-11 – FR-19).
- Recipes with an Input Contract and a Pre-flight Check; compressed Packages; session persistence with an easy delete (FR-20 – FR-25).
- LLM assistance over copy-paste, including Column Profiles, Probe Queries and validated Recipe import (FR-26 – FR-30).
- Result table with view filters, full-dataset search, run status, and a tile Dashboard (FR-31 – FR-35).
- Export as CSV, JSON, XLSX and Parquet, plus a static HTML and PDF view document (FR-36, FR-37).

### 6.2 Out of Scope for MVP

- **A direct LLM API connection.** The MVP talks to a model only through the clipboard. An optional stored API key that automates the same exchange is the first item in the post-MVP backlog; it must, when built, send exactly what the copy-paste block would have contained, so it can never become a second and laxer disclosure path.
- **Interactive HTML export.** Cut deliberately as the most expensive item; see the note under FR-37.
- **Roles, permissions, a Consumer-only view.** MVP ships one interface with a full Editor for everyone, guarded only by the deliberate-entry rule (FR-11). `[NOTE FOR PM]` This is the item most likely to be needed sooner than planned if Recipes actually reach non-technical Consumers.
- **Formula language for computed columns.** Fixed operations only (FR-17).
- **Free-form Dashboard layout, additional chart types, cross-tile filtering, drill-down.**
- **Multiple Result Steps.** Exactly one Step is the Result. A Pipeline producing several outputs at once is a plausible extension of the graph model and is deliberately not attempted now.
- **Reading legacy Excel formats** — `.xls`, `.xlsb`, `.ods`. Only `.xlsx` is read.

### 6.3 Scope risk, stated plainly

`[NOTE FOR PM]` The MVP defined above contains four largely independent product surfaces: the loading and typing layer, the graph Editor, the LLM collaboration protocol, and the result presentation layer. Each is individually modest; together they are a substantial build for one person. Three observations follow. None is a recommendation to cut — the scope decisions are the project owner's and were made deliberately, in some cases after the cost was named.

First, **only the transformation path is validated by an existing workflow.** The Author's patch-compliance report exists today in PowerQuery and its every step is known. The LLM protocol is a strong idea with no usage behind it, and the Dashboard is evidenced by one named need rather than by a practice.

Second, **the graph Editor is the largest single risk and it arrived late.** It replaces a linear list, reverses an explicit non-goal in `idea.md`, and has three consequences that reach beyond the Editor itself: it enlarges the Recipe format at exactly the point where a language model must produce it correctly (FR-28); it invalidates the assumption behind the framework research, whose winning criterion was literally *a list of heterogeneous steps*; and it is the one component in the entire stack for which no technology research exists. See Open Questions 4 and 9.

Third, **the natural build order is the risk order.** Reaching a working consolidation-and-export path first — a version that replaces the PowerQuery workflow end to end and nothing more — produces a tool that earns its keep on its own, and turns every later block into an addition rather than a prerequisite. The Recipe format should nonetheless be designed for machine authorship from the first commit, because retrofitting that is expensive and designing for it is nearly free.

## 7. Success Metrics

Stakes are personal and internal, so these are deliberately coarse. They exist to prevent optimising the wrong thing, not to be reported to anyone.

**Primary**

- **SM-1: The PowerQuery workflow is retired.** The quarterly patch-compliance report is produced with querbeet, from files to exported artifact, without falling back. Validates FR-1 – FR-19, FR-36, FR-37.
- **SM-2: A Recipe runs in someone else's hands.** At least one Recipe is used at least once by a person other than its Author, against their own data, without the Author touching that data. Validates FR-20 – FR-25. `[ASSUMPTION]` This is the metric that tests the core hypothesis; if it fails, the product is a good personal utility and the Recipe concept was wrong.

**Secondary**

- **SM-3: The monthly rerun costs nothing.** A repeat run against fresh files of the same shape takes under five minutes and requires no decisions beyond the Pre-flight Check. Validates FR-21 – FR-23, FR-25.
- **SM-4: The LLM path shortens authoring.** At least one non-trivial Pipeline is built with substantial LLM help and is correct on inspection. Validates FR-26 – FR-30.

**Counter-metrics (do not optimize)**

- **SM-C1: Speed of first result.** Do not optimise how fast a user reaches a number. The type-confirmation gate (FR-9) and the Pre-flight Check (FR-22) deliberately cost time, and they are what separate a right number from a plausible one. Counterbalances SM-1 and SM-3.
- **SM-C2: Breadth of Step kinds and graph expressiveness.** Do not optimise how many transformations the tool supports or how freely they can be wired. Every addition enlarges the Recipe format, the Editor surface, and what a language model must get right. Counterbalances SM-4.

## 8. Open Questions

1. **How does Christian actually work today?** The entire Consumer half of the product rests on an uninterviewed user. Where do his four files come from, how often, is his primary pain processing or acquisition? *Owner: project owner. Cheapest resolution: one 20-minute conversation. Revisit before building anything Consumer-specific.*
2. **What carries the graph Editor?** No research covers node-graph editor libraries or hand-built canvases against this project's constraints — single file, no runtime fetching, offline, Vue 3, frozen data. This is a new research task, not a design detail, and it is on the critical path for §4.2. *Resolution: a technical research run in the shape of the four that preceded this PRD.*
3. **Does the graph survive machine authorship?** FR-28 requires a language model to emit a valid Recipe from documentation alone. A graph is materially harder to get right than a list. *Resolution: draft the Recipe format for a three-Step graph and have a model produce one from the spec before committing to it.*
4. **Does the framework verdict still hold?** Research R2 chose Vue 3 on the criterion of authoring a list of heterogeneous step kinds. That criterion is now a graph editor. The verdict may well survive — but it has not been re-examined against the actual requirement. *Resolution: revisit R2's C1 scoring once Open Question 2 has a candidate.*
5. **Does `read-excel-file` construct its internal worker in a way that survives `file://`?** Decides whether XLSX import works in the target deployment at all, or needs the library's dedicated worker export. *From research R3, open question 1.*
6. **Do `write-excel-file`'s format codes render as German decimal commas in a real German Excel?** The last untested link in "opens cleanly in Excel". *From research R3. Resolution: open a generated file in a German Excel installation.*
7. **Research R4 is incomplete.** Only the table-rendering dimension ran. Arquero memory in the browser, off-main-thread work and transfer cost, and responsiveness patterns are planned and unexecuted. *Affects the confidence behind NFR-3, whose total-row figure is now larger than when R4 was scoped.*
8. **What is the Package container format, and does compressing 500k rows in the browser stay responsive?** FR-24 requires compression; the mechanism and its cost are unexamined.
9. **`idea.md` and `README.md` claim data never leaves the browser, and `idea.md` excludes a node-based editor from the MVP.** Both documents now contradict this PRD. *Owner: project owner. They are public-facing promises and a stated plan, so they should not stay wrong.*
10. **Does the Author need a way to test a Recipe against someone else's file shape without their data?** Implied by the handoff but never discussed.

## 9. Assumptions Index

- **§2.3 UJ-2** — The entire Consumer journey is a hypothesis. Christian has not been interviewed; the narrative is constructed from a secondhand statement that he is unhappy, lacks data, and does not know how to process what he has. See Open Question 1.
- **§2** — That the Boxchecker's needs are fully served by a self-describing export (FR-37). No Boxchecker was consulted; the role was named by the project owner as an observed reaction to compliance-shaped documents.
- **§3, §4.2 FR-18** — Aggregate was added as a sixth Step kind, against `idea.md` and the README roadmap which both place group-by after the MVP. Confirmed by the project owner in discussion.
- **§3, §4.2 FR-12** — That exactly one Result Step is sufficient. A graph naturally admits several terminal nodes; restricting to one keeps the Dashboard, the export and the Recipe format simple, and was not requested either way.
- **§4.1 FR-9** — That locale ambiguity can be surfaced usefully rather than merely detected. A column of four-digit dotted values is genuinely ambiguous, and the design assumes a user can resolve what a parser cannot.
- **§7 SM-2** — That a Recipe used by a second person is the right proof of the core hypothesis. It is the cleanest available test, but a single instance is weak evidence.
- **§4.6 FR-37** — That a static view document is sufficient for the decision-maker. The interactive variant was cut on cost, not because it was judged unnecessary.
- **§6.3** — That the transformation path is separable enough to ship first. Stated as a build-order observation; not validated against an architecture.
