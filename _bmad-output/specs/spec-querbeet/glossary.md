# Glossary — querbeet

Companion to `SPEC.md`. Downstream workflows and readers use these terms exactly; capabilities, journeys and metrics use them verbatim. The German column is the UI label, because the interface is German while the code and these documents are English (C-6). Code uses the English word, capitalised as a type.

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
