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

Four technical research runs precede this document and are treated as settled input, not re-litigated here: the transformation engine (Arquero), the UI framework and delivery path (Vue 3 via a Vite single-file build), file formats and parsing, and performance and table rendering. They live in `_bmad-output/planning-artifacts/research/`. This PRD states *capabilities*; the technology decisions and their consequences are recorded in `addendum.md` beside this file. Where a research finding is a genuine product requirement rather than an implementation detail — silent corruption of German number formats, unfindable rows in a virtualized table, silent Cartesian products on join — it appears here as an FR.

## 1. Vision

querbeet turns a recurring data-consolidation chore into a file you can hand to someone else. It is a single HTML file that runs by double-click in a browser, with no server, no installation and no account. A user drops in two to five report exports — CSV, JSON, Excel — clicks together a short pipeline of union, join, filter and column steps, and gets one consolidated table out, with charts and an export the recipient can act on.

> **BEN:** Frage - warum nur two to five? Ist diese Grenze auf max. 5 nötig? Wo siehst Du das Maximum?

What makes it more than a lightweight PowerQuery is that **the pipeline itself is a portable artifact**. A Recipe is a small JSON file describing the steps, their settings, and the input files it expects. Whoever holds a Recipe can run it against their own data without understanding it, without installing anything, and — this is the point — without sending that data to the person who wrote the Recipe. The author's expertise travels; the data does not. This is what turns a personal utility into leverage: a specialist writes a Recipe once, and a department serves itself with it repeatedly.

The second lever is that Recipes are cheap to write, because a language model can write them. querbeet hands an LLM a structural profile of the loaded Sources together with the user's own Column Annotations — never the raw values — and receives back either a Recipe or a Probe Query. A Probe Query is executed locally against the real data, and only its result travels back to the model. The model comes to *understand* the data without ever *seeing* it. The whole exchange works over plain copy-paste against any chat assistant, so the tool needs no network access at all; an optional API key removes the clipboard step and changes nothing else.

That querbeet makes no network requests is a feature, not a side effect. In an organisation, a tool that provably cannot exfiltrate data needs no approval process to try.

## 2. Target User

querbeet serves two roles. They are the same person often enough that the MVP gives them one interface, but their jobs are different and the product is shaped by the handoff between them.

**The Author** builds pipelines. Technically confident, comfortable with data, not necessarily a programmer — the person who today reaches for PowerQuery, a spreadsheet full of VLOOKUPs, or a short script. They own the correctness of a Recipe.

**The Consumer** receives a Recipe and runs it against their own data. They are competent in their domain and read tables fluently, but they do not build pipelines and do not want to. They are why the Recipe exists.

> **BEN:** Zusätzliche Rolle **The Boxchecker** - beschreibt Compliance-Personal, das sich über die Exporte freut, die irgendwas compliance-mäßiges dokumentieren

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

### 2.2 Non-Users (v1)

- Anyone needing a live connection to a database, an API, or any data source that is not a file the user chose.
- Teams wanting shared state — a server, accounts, permissions, or a Recipe library that several people write to.
- Users at big-data scale. querbeet is designed for roughly 100,000 rows. It imposes no hard cap and will not deliberately break above it, but nothing above that scale is designed for, measured, or promised.

### 2.3 Key User Journeys

Journeys are numbered UJ-1..UJ-N and referenced by ID from the FRs. Note the difference in evidence between them, because it is load-bearing: **UJ-1, UJ-3 and UJ-4 describe work the Author does today and were captured from him. UJ-2 is a hypothesis** — the Consumer it describes has not been interviewed. It is written out because the product is designed for it, and marked so that nothing downstream mistakes it for evidence.

**UJ-1. Ben builds the patch-compliance report.**

- **Persona + context:** Ben runs IT. Once a quarter he owes the compliance file a status, and the CISO a list of people to chase about missing updates. He does it in PowerQuery today.
- **Entry state:** Three exports on the desktop — patch state per device, device-to-user mapping, installed software per device. He opens `querbeet.html` by double-click. No login, no connection.
- **Path:** He drags all three files into the Sources pane; each appears named, with detected columns and its first rows. One CSV gets a doubtful delimiter warning, which he corrects. He switches `LastPatchDate` from text to date and sees the Preview confirm it. He enters the Editor — acknowledging that he is now working on the mechanism — and joins patch state to the user mapping on device ID, then to software on the same ID. After the second join the tool warns that the row count went from 4,200 to 61,000: duplicate keys, many software rows per device. He inserts an Aggregate Step ahead of it. He filters to patch state older than 30 days, then keeps six columns and renames them into German.
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
- **Entry state:** Sources loaded, no Pipeline yet. No API key configured.
- **Path:** He annotates a few columns in his own words. He asks querbeet for a prompt block, which contains his question, the Column Profile of every Source, and his annotations — no cell values. He pastes it into a chat assistant. It answers with a Probe Query rather than a Recipe: it wants to know how many time bookings have no matching project. He pastes that back; querbeet runs it locally and shows the result, along with exactly what would be sent back. He sends the number. The assistant now proposes a Recipe, which he pastes into querbeet.
- **Climax:** The Recipe loads as real Steps he can inspect, and the Preview shows plausible output on the first run.
- **Resolution:** He adjusts two Steps by hand and keeps going. Nothing left the machine except structure, his own descriptions, and numbers he saw before they were sent.
- **Edge case:** The assistant returns a Recipe that references a column that does not exist. querbeet rejects it against the Input Contract and says which reference failed, so he can paste the error back.

**UJ-4. The monthly run.**

- **Persona + context:** Either role, repeating a known analysis against fresh files.
- **Entry state:** A Recipe that worked last month, and this month's exports.
- **Path:** Open the tool, load the Recipe, drop in the files, read the Pre-flight Check, run.
- **Climax:** The Result matches last month's shape, and the differences are in the data rather than in the pipeline.
- **Resolution:** Export, done, under two minutes. No decisions were required.
- **Edge case:** The source system changed its export format between months. The Pre-flight Check is what turns that from a wrong number into a visible problem.

## 3. Glossary

Downstream workflows and readers use these terms exactly. FRs, journeys and metrics use them verbatim. The German column is the UI label, because the interface is German while the code and these documents are English.

| Term | German UI label | Definition |
| --- | --- | --- |
| **Source** | Quelle | One loaded input file, named, with its detected columns, inferred types and a data preview. A Source is immutable once loaded; Steps read from it and never write back. |
| **Column Annotation** | Spaltenbeschreibung | A free-text description the user attaches to a column of a Source, stating what it contains. Annotations are part of the Recipe and are sent to the LLM; they are never sent anywhere else. |
| **Column Profile** | Spaltenprofil | The structural description of a Source that may be shown to an LLM: column names, inferred types, row and column counts, distinct-value counts, null shares, and Column Annotations. It contains no cell values unless the user explicitly releases samples. |
| **Step** | Schritt | One transformation in a Pipeline. Every Step is one of a fixed set of kinds (Union, Join, Filter, Columns, Computed Column, Aggregate), holds its own configuration, and produces one table from its inputs. |
| **Pipeline** | Pipeline | The ordered, linear list of Steps. No branching, no graph. |
| **Result** | Ergebnis | The table produced by the last Step of the Pipeline. Every Step also produces an intermediate result that can be previewed. |
| **Preview** | Vorschau | A windowed view of a Source or of any Step's output. Shows a bounded number of rows at a time; never the whole table at once. |
| **Recipe** | Rezept | A JSON file holding the Pipeline, its Step configurations, the Column Annotations, the Dashboard definition, and the Input Contract. It contains **no data**. |
| **Package** | Paket | A file bundling a Recipe together with the raw data of its Sources, so a recipient can reproduce one concrete run with the tool and this single file. Distinct from a Recipe, not a variant of one. |
| **Input Contract** | Erwartete Eingaben | The part of a Recipe declaring which Sources it expects and, per Source, which columns are required and their coarse types. Input for the Pre-flight Check. |
| **Pre-flight Check** | Vorprüfung | The validation run before a Pipeline executes, comparing the loaded Sources against the Input Contract and reporting per requirement whether it fits, is missing, or is doubtful. |
| **Editor** | Editor | The area in which the Pipeline is built and changed. Deliberately entered, not the landing view. |
| **Probe Query** | Prüfabfrage | A query authored by an LLM and executed locally against the real data, whose *result only* is returned to the LLM. The mechanism by which a model learns about data it may not see. |
| **Dashboard** | Dashboard | An arrangement of Tiles over the Result. |
| **Tile** | Kachel | One element of a Dashboard: a table view, a Top-N/Bottom-N list, a bar chart, a line chart, or a single key figure. |
| **Author** | — | The role that builds a Pipeline and writes a Recipe. |
| **Consumer** | — | The role that receives a Recipe and runs it against their own data. |

## 4. Features

Six feature groups. FRs are numbered globally so downstream artifacts can reference them even if the grouping changes.

A theme runs through several of them and is stated once here rather than repeated: **querbeet's characteristic failure mode is a plausible wrong number, not an error message.** Silent thousand-fold misreads of German numbers, silent Cartesian products on duplicate join keys, silently dropped columns on union, silently unmatched rows on join — each was measured during research as real behaviour of the underlying libraries. Every one of them produces output that looks fine. Making these visible is not defensive polish; it is the difference between a tool whose output can go in a compliance file and one whose output cannot.

### 4.1 Loading Sources

**Description:** The user brings two to five report exports into the tool by drag-and-drop or file dialog. Each becomes a named Source with detected columns, a Preview, and a confirmed type mapping. Nothing is uploaded; the browser reads the files the user chose. Realizes UJ-1, UJ-2, UJ-4.

**Functional Requirements:**

#### FR-1: Load files as Sources

The user can add one or more files as Sources, by drag-and-drop onto the Sources pane or through a file dialog. Supported: CSV, JSON, NDJSON, XLSX. Realizes UJ-1, UJ-2.

> **BEN:** was ist mit parquet als quelle?

**Consequences (testable):**
- Multiple files dropped at once each become a separate Source.
- A Source carries a name, editable by the user, defaulting to the file name.
- Sources can be removed individually; removing a Source that a Step references marks that Step as broken rather than deleting it.
- An unsupported or unreadable file produces a named error against that file and leaves the other Sources loaded.

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

#### FR-4: Recover malformed JSON

When a JSON Source fails to parse, the system attempts a repair and shows what it changed. Realizes UJ-1.

**Consequences (testable):**
- Strict parsing is attempted first; repair runs only on failure.
- Trailing commas, missing quotes, unquoted keys, comments, markdown code fences, truncated documents and NDJSON are handled.
- A repair that succeeds is reported to the user as a repair, not silently accepted.
- A repair that fails — including by exhausting the stack rather than raising a parse error — produces a clear message naming the file.

> **BEN:** Das Recover Malformed JSON müssen wir noch ausdetaillieren, am besten trennen in 3 FRs für Erkennung, Repair und Show what it changed?

#### FR-5: Flatten nested JSON with an explicit array strategy

The system flattens nested JSON into a tabular Source, and the handling of arrays is a choice the user makes rather than a hidden default. Realizes UJ-1.

**Consequences (testable):**
- Nested objects flatten to dot-path column names.
- The array strategy is offered as three options: one JSON value per cell, one indexed column per position, or one row per array element.
- The choice is made per Source at import, is visible afterwards, and is stored in the Recipe.
- A nested structure can be inspected as a collapsible tree before the strategy is chosen.

#### FR-6: Preview every Source

Every loaded Source shows its detected columns and a bounded window of its rows. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Row and column counts are shown for the full Source, not for the visible window.
- The Preview renders within a interaction-responsive time regardless of Source size.

> **BEN:** wie sieht Preview bei JSON aus?

#### FR-7: Detect column types and require confirmation before running

The system proposes a type per column using a German-aware parser and does not execute a Pipeline until the user has confirmed the type mapping of each Source once. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- The proposed type and the share of values that parse under it are shown per column, e.g. "Date — 842 of 900 values readable".
- `1.234` is read as one thousand two hundred thirty-four, not as 1.234; `1.234,56` and `31.12.2025` parse correctly; a leading-zero value such as `0123` stays text.
- The user can change a column's type; the hit rate recomputes immediately.
- Values that do not parse under the chosen type are marked as unparsed and remain inspectable — they are never silently replaced by null.
- Running the Pipeline is blocked until confirmation, and the confirmation is stored in the Recipe so the Consumer inherits the Author's decisions.


> **BEN:** Der Gedanke german-aware ist gut - aber gehe davon aus, dass Daten aus verschiedenen Quellen kommen und durchaus auch US-format in einem CSV sein könnte.

#### FR-8: Annotate columns

The user can attach a free-text description to any column of a Source. Realizes UJ-3.

**Consequences (testable):**
- Annotations are visible in the Sources pane and editable at any time.
- Annotations are stored in the Recipe.
- Annotations are included in the Column Profile shown to an LLM.

**Notes:** `[NOTE FOR PM]` FR-7's confirmation gate is the single most user-visible friction in the product and the single strongest correctness guarantee. If usage shows it being clicked through blindly, the mitigation is to make unconfirmed columns visually loud in the Result, not to remove the gate.

### 4.2 Building the Pipeline

**Description:** The Author assembles a linear list of Steps in the Editor. The Editor is a place entered deliberately, not the default view. After every Step the Preview shows what that Step produced, and anything the Step did that could produce a plausible wrong number is reported at the Step. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-9: Enter the Editor deliberately

The Editor is a distinct area of the application which the user enters through an explicit action acknowledging that the Pipeline can be changed there. Realizes UJ-2.

**Consequences (testable):**
- Loading a Recipe does not open the Editor.
- Starting with no Recipe opens the Editor directly, since there is nothing else to show.
- Leaving and re-entering the Editor does not lose Step configuration.

#### FR-10: Manage a linear Step list

The user can add, configure, remove and reorder Steps in a single ordered list. Realizes UJ-1.

**Consequences (testable):**
- Steps are added from a fixed list of kinds.
- Reordering is available through explicit up/down controls and keyboard shortcuts, so ordering never depends on a drag gesture.
- Reordering a Step that would then reference a table it no longer has marks the Step as broken and names the reason.
- No branching or graph structure exists; each Step's input is the previous Step's output or a named Source.

#### FR-11: Union Sources with column mapping

The user can stack two or more tables, mapping differently-named columns onto each other. Realizes UJ-1.

**Consequences (testable):**
- Columns are matched by name where names agree, and the user maps the rest explicitly.
- Columns present in only some inputs are **listed to the user before the Step runs**, with the choice to map, keep (padded with nulls), or drop them — never dropped silently.
- The output row count equals the sum of the input row counts.

#### FR-12: Join two tables on one or more keys

The user can join two tables on one or several key columns, choosing left or inner join. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Multiple key columns are supported and matched pairwise.
- The join type is a per-Step setting; left is the default.
- After execution the Step reports how many left rows found no match.
- When the output row count exceeds the input row count, the Step warns explicitly that duplicate keys produced additional rows, and states the factor.
- Null handling in key columns is an explicit, documented Step setting — either nulls never match, or nulls match nulls — with the setting stored in the Recipe. The default is stated in the UI rather than implied.

> **BEN:** "output row coun exceeds input row count" ist eine gute heuristik. ich hätte aber gerne auch noch einen optionalen nitpicky-mode, der das pro zeile prüft, damit wir immer wissen, ob es zu dubletten kam.

#### FR-13: Filter rows

The user can restrict rows by conditions on columns. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Operators cover equals, not equals, contains, greater than, less than, is empty, is not empty.
- Multiple conditions can be combined; the combination rule (all / any) is explicit.
- Comparison respects the column's confirmed type — a date comparison compares dates, not strings.
- The Step reports how many rows were removed.

> **BEN:** bei empty auch null und blanks beachten



#### FR-14: Select, rename and reorder columns

The user can choose which columns survive, rename them, and set their order. Realizes UJ-1.

**Consequences (testable):**
- Renaming to a name already in use is refused with a named reason.
- Column order in the Step determines column order in the Result and in every export.

> **BEN:** können wir eigentlich auch zusätzliche tabellen mit teilmengen einer anderen tabelle erstellen?

#### FR-15: Add a computed column

The user can derive a new column by choosing an operation and its inputs from fixed lists. No formula language exists. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Available operations: add, subtract, multiply, divide two numeric columns; ratio of two numeric columns; concatenate two or more columns with a separator; difference between two date columns in days.
- Division by zero and operations on unparsed values produce a marked empty cell, not a crash and not a silent zero.
- The resulting configuration is a plain data structure with no free text to parse, so an LLM can emit it and the system can validate it.

#### FR-16: Aggregate

The user can group rows by one or more columns and compute aggregates. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Aggregations available: count, count distinct, sum, average, minimum, maximum.
- Rows with null in a grouping column form their own visible group rather than disappearing.
- The Step reports the input and output row counts.

#### FR-17: Preview after every Step

Selecting a Step shows the table it produces. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- The Preview shows the row and column count of the full intermediate table.
- Warnings raised by that Step (FR-11, FR-12, FR-13, FR-16) are visible alongside its Preview, not only at the moment of execution.
- Changing a Step's configuration updates its Preview and every downstream Step's Preview.

### 4.3 Recipes and Packages

**Description:** A Recipe is the portable form of a Pipeline — steps, settings, annotations, type confirmations, Dashboard, and the Input Contract, with no data in it. A Package is the other artifact: a Recipe bundled with its data, for reproducing one concrete run. Loading a Recipe against unfamiliar files runs a Pre-flight Check before anything executes. Realizes UJ-2, UJ-4.

**Functional Requirements:**

#### FR-18: Save and load a Recipe

The user can export the current Pipeline as a Recipe file and load one back. Realizes UJ-1, UJ-2, UJ-4.

**Consequences (testable):**
- A Recipe contains Steps and their configuration, Column Annotations, type confirmations, the Dashboard definition, and the Input Contract. It contains no cell values.
- A Recipe carries a name and a free-text description the Author writes for the Consumer.
- A Recipe carries a format version; loading a Recipe of an unknown version is refused with a named reason rather than partially applied.
- The Recipe format is documented well enough that a language model can produce a valid one from the documentation alone.

#### FR-19: Derive and carry an Input Contract

Saving a Recipe records what the Pipeline expects of its inputs. Realizes UJ-2, UJ-4.

**Consequences (testable):**
- Per expected Source: a role name, the columns the Pipeline actually reads, and each column's confirmed type.
- Columns the Pipeline never touches are not part of the contract, so an extra column in the Consumer's export is not a failure.
- The Author can edit the derived contract — loosening a type, marking a column optional — before saving.

#### FR-20: Run a Pre-flight Check before executing

When a Recipe is loaded together with files, the system validates the files against the Input Contract and reports the outcome before any Step runs. Realizes UJ-2, UJ-4.

**Consequences (testable):**
- Each contract requirement is reported as fits, missing, or doubtful, with the reason.
- A column present under a different name is reported as missing with the actual column list offered for mapping (FR-21).
- A column whose values do not parse under the expected type is reported as doubtful, with the hit rate.
- The Pipeline does not execute while any requirement is missing.
- The outcome of the check remains visible after the run as the run status on the Dashboard (FR-32).

#### FR-21: Map the Consumer's columns onto the contract

Where a required column is missing, the user can map one of their actual columns onto it. Realizes UJ-2.

**Consequences (testable):**
- The mapping is offered per unmet requirement, listing the Source's actual columns.
- Applying a mapping re-runs the Pre-flight Check.
- Mappings can be saved back into the Recipe, so the same correction is not repeated next month.

#### FR-22: Export and import a Package

The user can export a Recipe bundled with the data of its Sources as a single file, and load such a file. Realizes UJ-2.

**Consequences (testable):**
- Importing a Package restores both the Pipeline and the Sources, with no further files needed.
- A Package is visibly distinct from a Recipe — different extension and an unmistakable indication in the UI that it contains data.
- Exporting a Package states the resulting file size before writing it.

> **BEN:** Bitte an Komprimierung denken. Vielleicht ist das Package auch eine Zip-Datei oder ähnliches?

#### FR-23: Persist the session, and make deleting it easy

The current Recipe and the loaded Source data survive closing and reopening the tool, and the user can delete stored data in one obvious action. Realizes UJ-1, UJ-4.

**Consequences (testable):**
- Reopening the tool restores the previous session, including loaded data.
- The UI states plainly and persistently that data is stored in this browser.
- A single, discoverable action deletes all stored data; after it, reopening the tool starts empty.
- Deleting stored data does not require deleting the Recipe, and deleting the Recipe does not require deleting the data.

### 4.4 LLM Assistance

**Description:** querbeet can be driven by a language model without giving that model the data. The tool produces a Column Profile — structure, not values — together with the user's Column Annotations. The model answers with a Recipe or with a Probe Query, which the tool runs locally and whose result only is returned. This works entirely over copy-paste against any chat assistant; an optional API key removes the clipboard step and changes nothing about what is disclosed. Realizes UJ-3.

**Functional Requirements:**

#### FR-24: Produce a Column Profile

The system can produce a structural description of the loaded Sources suitable for showing to a language model. Realizes UJ-3.

**Consequences (testable):**
- The profile contains per Source: name, row count, and per column the name, confirmed type, distinct-value count, null share, and Column Annotation.
- The profile contains no cell values unless the user explicitly releases samples (FR-28).
- The profile is shown to the user in full before it is used for anything.

#### FR-25: Generate a copy-ready prompt block

The user can produce a text block containing their question, the Column Profile, and the instructions a model needs to answer in a form querbeet accepts. Realizes UJ-3.

**Consequences (testable):**
- The block is copyable in one action.
- The block includes the Recipe format specification and the Probe Query format specification, so the model can answer in either.
- Everything that would leave the machine is visible in the block. There is no hidden portion.

#### FR-26: Accept a Recipe from a model, validated

The user can paste a model's answer, and the system validates it before applying anything. Realizes UJ-3.

**Consequences (testable):**
- A syntactically invalid answer is rejected with a message specific enough to paste back to the model.
- A Recipe referencing a column or Source that does not exist is rejected naming the failing reference, not partially applied.
- A valid Recipe loads as ordinary Steps that the user can inspect and edit before running.

#### FR-27: Execute a Probe Query and disclose its result

The user can run a query authored by a model against the real data locally, and see exactly what would be sent back before sending it. Realizes UJ-3.

**Consequences (testable):**
- A Probe Query is expressed in the same Step vocabulary as a Pipeline; it introduces no second query language.
- The result is displayed to the user before any return step.
- The user copies the result back, or sends it via the API path, only after seeing it.
- A Probe Query cannot write, modify or delete anything; it reads.

#### FR-28: Release sample values explicitly

The user can choose to include example values from a column in what goes to the model. Realizes UJ-3.

**Consequences (testable):**
- Sample release is off by default and chosen per column per exchange.
- The samples that would be sent are shown before they are sent.
- The setting does not persist into the Recipe; a Consumer never inherits an Author's disclosure decision.

#### FR-29: Optional API connection

The user can store an API key so that exchanges happen without the clipboard. Realizes UJ-3.

**Consequences (testable):**
- The tool is fully functional with no key configured, and makes no network request in that state.
- With a key configured, what is sent is identical to what the copy-paste block would have contained.
- The UI shows unmistakably when the tool is in a state where it can make network requests.
- The key can be removed, and removal takes effect without reloading.

> **BEN:** Lass uns API aus dem MVP entfernen und für Später ins backlog nehmen

### 4.5 Result, View and Dashboard

**Description:** The Result is where the Consumer lands and where the Author checks their work. It offers a virtualized table with transient view filters and its own search, plus a Dashboard of tiles that lives in the Recipe. The distinction between changing the *data* and changing the *view* is deliberate and visible. Realizes UJ-1, UJ-2, UJ-4.

**Functional Requirements:**

#### FR-30: Display the Result as a table

The Result is shown as a table that stays responsive at the design scale. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Row and column counts shown are the totals, not what is rendered.
- Scrolling through a hundred thousand rows stays smooth, and the scroll position maps to the correct rows throughout.
- Column headers remain visible while scrolling.
- Values are displayed in German conventions — decimal comma, thousands separator, `dd.mm.yyyy` dates.
- Cells whose value did not parse under the column's confirmed type are visually marked.

#### FR-31: Filter and sort the view, and promote a view filter into the Pipeline

The user can filter and sort what the table shows without changing the Result, and can turn such a filter into a Pipeline Step. Realizes UJ-2.

**Consequences (testable):**
- View filters are set from the column headers and apply to the full Result, not to the rendered window.
- View filters and sorting are transient: they are not stored in the Recipe and are lost on reload.
- The UI states while a view filter is active that this is a view, not the data.
- A single action converts the active view filters into a Filter Step appended to the Pipeline, after which they are data and are stored in the Recipe.

#### FR-32: Search the full dataset

The user can search the Result and reach matches that are not currently rendered. Realizes UJ-2.

**Consequences (testable):**
- Search runs over every row of the Result, not over the DOM.
- The number of matches is shown, and the user can jump between them.
- Searching a hundred thousand rows returns within an interaction-responsive time.
- The search field is prominent enough to be found by a user who reflexively pressed Ctrl+F first.

#### FR-33: Show the run status

The Dashboard shows whether the run that produced it was clean. Realizes UJ-2, UJ-4.

**Consequences (testable):**
- The status summarises the Pre-flight Check outcome and every warning raised by any Step during the run.
- A run with warnings is distinguishable at a glance from a clean run, without opening the Editor.
- The status names the Steps involved, so a user can act on it.

#### FR-34: Compose a Dashboard from tiles

The user can add, configure, order and size tiles over the Result. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Tile kinds: table, Top-N / Bottom-N, bar chart, line chart, key figure.
- Every tile is configured through the same small form: grouping column, measured column, aggregation, row limit.
- Tiles occupy a fixed grid; order changes through up/down controls and size through three preset steps. There is no free positioning and no overlap.
- The Dashboard definition is stored in the Recipe, so a Consumer sees the Author's Dashboard.
- Starting with no Recipe opens the Editor rather than an empty Dashboard.

### 4.6 Export

**Description:** The Result leaves querbeet as a data file for further work, or as a self-contained view document for someone who will only read it. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-35: Export data files

The user can export the Result as CSV, JSON, XLSX or Parquet. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- CSV export is UTF-8 with a byte-order mark and a configurable delimiter defaulting to semicolon, so German Excel opens it correctly without an import dialog.
- Numbers and dates in CSV and XLSX are written in German conventions.
- XLSX export produces real numbers and real dates with German format codes, preserves leading zeros as text, and preserves umlauts and the euro sign.
- Parquet export produces a file that standard readers accept.
- An export that takes noticeably long shows progress and does not freeze the interface.

#### FR-36: Export a view document

The user can export the Result and Dashboard as a self-contained document to hand to someone who will only read it. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- HTML export is a single file with everything embedded, opening correctly with no network access.
- The exported document shows the Dashboard as configured and the Result table.
- The document is static: no filtering, no sorting, no interaction.
- PDF export produces the same content in paginated form.
- The document states which Recipe produced it and when.

**Notes:** `[NOTE FOR PM]` An interactive HTML export — one the recipient can filter and sort in — was considered and deliberately cut as the most expensive item in the MVP. It is the strongest candidate for the first post-MVP addition, because it collapses the Consumer's setup cost to zero.

### 4.7 Cross-cutting Non-Functional Requirements

- **NFR-1 — Delivery.** The product is one HTML file, opened by double-click from the local filesystem. It works with no server, no installation, no account, and no network connection. A build step may produce that file; using it must never require one.
- **NFR-2 — Network silence.** With no API key configured, the application makes no network request of any kind. This is verifiable from the built artifact.
- **NFR-3 — Scale.** The design target is roughly 100,000 rows across up to five Sources. Interactive operations — preview, scroll, filter, search, step reconfiguration — stay responsive at that scale. No artificial row cap is imposed; behaviour beyond the target is neither promised nor deliberately obstructed.
- **NFR-4 — Browsers.** Chrome 143+, Edge 143+, Firefox 145+. Safari is optional and may be neglected where it costs effort.
- **NFR-5 — Form factor.** Desktop only, designed for Full HD. Mobile and tablet layouts are not supported and not attempted.
- **NFR-6 — Language.** The interface is German. Code, comments, and project documents are English.
- **NFR-7 — Accessibility.** No WCAG conformance level is targeted and no accessibility testing is required. Semantic markup, ARIA attributes where they are free, and keyboard operability for the main paths are welcome where they cost nothing — explicitly including Step reordering (FR-10), which must not depend on a drag gesture.

> **BEN:** Frage - warum keine drag gesture?

- **NFR-8 — Data residence.** Cell values leave the browser only through an export the user triggered, or through an LLM disclosure the user saw and confirmed. There is no other path out.

## 5. Non-Goals (Explicit)

- **No server, no backend, no accounts, no permissions.** There is nothing to log in to and nothing shared between users. A roles-and-views model is a plausible later addition and is deliberately absent now.
- **No live data sources.** No database connections, no APIs, no scheduled pulls. Data enters as a file the user chose. The one network path that exists is the optional LLM connection, and it carries no cell values the user has not seen.
- **Not a BI suite.** querbeet does not compete with Power BI, Tableau or Metabase. It has no semantic layer, no measures, no drill-down, no cross-filtering between tiles, no scheduled refresh.

> **BEN:** NIcht sicher. ob die BI-suite Aussage stimmt....

- **Not a general query tool.** There is no SQL, no formula language, no scripting. Everything the tool does is expressible as a fixed set of configured Steps — which is what makes Recipes portable and machine-writable.

> **BEN:** Formeln / Skripte / SQL sind nur für den MVP ausgeklammert, kann später hinzukommen

- **Not a data-acquisition tool.** querbeet consolidates files the user already has. Finding, extracting or requesting data they lack is out of scope, and a user whose primary problem is acquisition is not served by this product.
- **No big data.** See NFR-3. No streaming, no chunked out-of-core processing, no server-side pushdown.
- **No collaboration.** No comments, no sharing, no version history. Sharing means sending a file.
- **No accessibility conformance.** See NFR-7.
- **No mobile.** See NFR-5.

## 6. MVP Scope

### 6.1 In Scope

- Loading CSV, JSON, NDJSON and XLSX Sources with encoding, delimiter, header and type handling, including the mandatory type confirmation (FR-1 – FR-8).
- Six Step kinds — Union, Join, Filter, Columns, Computed Column, Aggregate — in a linear Editor with per-Step preview and per-Step warnings (FR-9 – FR-17).
- Recipes with an Input Contract and a Pre-flight Check; Packages; session persistence with an easy delete (FR-18 – FR-23).
- LLM assistance over copy-paste, including Column Profiles, Probe Queries and validated Recipe import; the API connection as an optional convenience (FR-24 – FR-29).
- Result table with view filters, full-dataset search, run status, and a tile Dashboard (FR-30 – FR-34).
- Export as CSV, JSON, XLSX and Parquet, plus a static HTML and PDF view document (FR-35, FR-36).

### 6.2 Out of Scope for MVP

- **Interactive HTML export.** Cut deliberately as the most expensive item; see the note under FR-36. Strongest candidate for the first post-MVP addition.
- **Roles, permissions, a Consumer-only view.** MVP ships one interface with a full Editor for everyone, guarded only by the deliberate-entry rule (FR-9). `[NOTE FOR PM]` This is the item most likely to be needed sooner than planned if Recipes actually reach non-technical Consumers.
- **A node-graph Pipeline editor.** The Step list is linear. Branching is a v2 question, and a large one.
- **A formula language for computed columns.** Fixed operations only (FR-15).
- **Free-form Dashboard layout, additional chart types, cross-tile filtering, drill-down.**
- **Reading legacy Excel formats** — `.xls`, `.xlsb`, `.ods`. Only `.xlsx` is read.
- **Any post-MVP dashboard ambition** from `idea.md` — a layouting engine, complex charts, complex filters.

### 6.3 Scope risk, stated plainly

`[NOTE FOR PM]` The MVP defined above contains three largely independent product surfaces: the ETL pipeline, the LLM collaboration protocol, and the result presentation layer. Each is individually modest; together they are a substantial build for one person. Two observations follow, and neither is a recommendation to cut — the scope decision is the project owner's and has been made deliberately.

First, **only the ETL pipeline is validated by an existing workflow.** The Author's patch-compliance report exists today in PowerQuery and its every step is known. The LLM protocol is a strong idea with no usage behind it, and the Dashboard is evidenced by one named need (patched-versus-unpatched, OS distribution) rather than by a practice.

Second, **the natural build order is the risk order.** Reaching a working consolidation-and-export path first — a version that replaces the PowerQuery workflow end to end and nothing more — produces a tool that earns its keep on its own, and turns every later block into an addition rather than a prerequisite. The Recipe format should nonetheless be designed for machine authorship from the first commit, because retrofitting that is expensive and designing for it is nearly free.

## 7. Success Metrics

Stakes are personal and internal, so these are deliberately coarse. They exist to prevent optimising the wrong thing, not to be reported to anyone.

**Primary**

- **SM-1: The PowerQuery workflow is retired.** The quarterly patch-compliance report is produced with querbeet, from files to exported artifact, without falling back. Validates FR-1 – FR-17, FR-35, FR-36.
- **SM-2: A Recipe runs in someone else's hands.** At least one Recipe is used at least once by a person other than its Author, against their own data, without the Author touching that data. Validates FR-18 – FR-23. `[ASSUMPTION]` This is the metric that tests the core hypothesis; if it fails, the product is a good personal utility and the Recipe concept was wrong.

**Secondary**

- **SM-3: The monthly rerun costs nothing.** A repeat run against fresh files of the same shape takes under five minutes and requires no decisions beyond the Pre-flight Check. Validates FR-19 – FR-21, FR-23.
- **SM-4: The LLM path shortens authoring.** At least one non-trivial Pipeline is built with substantial LLM help and is correct on inspection. Validates FR-24 – FR-29.

**Counter-metrics (do not optimize)**

- **SM-C1: Speed of first result.** Do not optimise how fast a user reaches a number. The type-confirmation gate (FR-7) and the Pre-flight Check (FR-20) deliberately cost time, and they are what separate a right number from a plausible one. Counterbalances SM-1 and SM-3.
- **SM-C2: Breadth of Step kinds.** Do not optimise how many transformations the tool supports. Every added Step kind enlarges the Recipe format, the Editor surface, and what a language model must get right. Counterbalances SM-4.

## 8. Open Questions

1. **How does Christian actually work today?** The entire Consumer half of the product rests on an uninterviewed user. Where do his four files come from, how often, is his primary pain processing or acquisition? *Owner: project owner. Cheapest resolution: one 20-minute conversation. Revisit before building anything Consumer-specific.*
2. **Does `read-excel-file` construct its internal worker in a way that survives `file://`?** Decides whether XLSX import works in the target deployment at all, or needs the library's dedicated worker export. *From research R3, open question 1. Resolution: read the library source, or load it from a real `file://` page.*
3. **Do `write-excel-file`'s format codes render as German decimal commas in a real German Excel?** The last untested link in "opens cleanly in Excel". *From research R3. Resolution: open a generated file in a German Excel installation.*
4. **Does the Vue authoring pattern hold up for six Step kinds?** Named in research R2 as the only criterion that decides the framework verdict and the only one not measured. *Resolution: build the Step list for two kinds.*
5. **Research R4 is incomplete.** Only the table-rendering dimension ran. Arquero memory in the browser, off-main-thread work and transfer cost, and responsiveness patterns are planned and unexecuted. *Affects the confidence behind NFR-3.*
6. **What exactly does the Recipe format look like, and how is it documented for a model?** FR-18 requires that a model can produce a valid Recipe from documentation alone. That is a design task with real consequences for FR-15, FR-26 and FR-27. *Belongs to architecture, but the PRD depends on it being achievable.*
7. **`idea.md` and `README.md` claim data never leaves the browser.** Both need revising to the accurate form: no data leaves the browser except what the user explicitly discloses to a language model. *Owner: project owner. Small, and it is a promise, so it should not stay wrong.*
8. **Does the Author need a way to test a Recipe against someone else's file shape without their data?** Implied by the handoff but never discussed.

## 9. Assumptions Index

- **§2.3 UJ-2** — The entire Consumer journey is a hypothesis. Christian has not been interviewed; the narrative is constructed from a secondhand statement that he is unhappy, lacks data, and does not know how to process what he has. See Open Question 1.
- **§3, §4.2 FR-16** — Aggregate was added as a sixth Step kind, against `idea.md` and the README roadmap which both place group-by after the MVP. Rationale: utilisation and profitability cannot be expressed without grouping, and Top-N tiles and key figures presuppose it. Confirmed by the project owner in discussion.
- **§7 SM-2** — That a Recipe used by a second person is the right proof of the core hypothesis. It is the cleanest available test, but a single instance is weak evidence.
- **§4.6 FR-36** — That a static view document is sufficient for the decision-maker. The interactive variant was cut on cost, not because it was judged unnecessary.
- **§6.3** — That the ETL path is separable enough to ship first. Stated as a build-order observation; not validated against an architecture.

