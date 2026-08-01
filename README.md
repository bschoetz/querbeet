# querbeet

**Visual ETL in a single HTML file. Reports in, consolidated table out.**

querbeet lets non-BI users build small ETL pipelines by point and click – entirely in the browser. Load a handful of report files, merge and transform them, and export one clean, consolidated table. No server, no installation, no coding.

> The name is a German pun: *querbeet* means "all over the place / criss-cross", with *query* hiding inside.

## Why

Consolidating a few report files shouldn't require a BI professional, a database, or an ETL suite. querbeet aims to cover the everyday case: three exports from different systems in, one consistent table out.

The part that makes it more than a lightweight PowerQuery is that **the pipeline itself is portable**. A Recipe is a small JSON file describing the steps, their settings, how they connect, and the input files they expect. Whoever holds a Recipe can run it against their own data – without understanding it, without installing anything, and without sending that data to whoever wrote the Recipe. The expertise travels; the data does not.

## Features

- **Single HTML file** – download, open in a browser, done. Works offline, and makes no network request at all.
- **Click-together pipelines** – load, union, join, filter, aggregate and reshape data in a small visual graph, without writing code.
- **Multiple input formats** – CSV, JSON, Excel and Parquet in; the same four out.
- **Recipes** – save a pipeline as JSON and hand it to someone else. They run it against their own files; you never see their data.
- **LLM-assisted authoring** – querbeet produces a copy-ready prompt block containing your question and a *structural* profile of your files: column names, types, distinct counts, null shares. No cell values, unless you release specific ones on purpose. Any chat assistant can answer with a Recipe, which is validated before anything is applied. The exchange is plain copy-paste; querbeet itself never talks to anyone.

## Where the data goes

Nowhere, unless you send it.

- querbeet makes no network requests. No server, no account, no telemetry, and no CDN – every library is compiled into the one file.
- Cell values leave the browser only through an export you triggered, or through an LLM disclosure you saw in full and copied yourself.
- One honest qualification: whatever querbeet remembers between sessions lives in the browser's storage for `file://` pages, and that storage is **shared across all local HTML files you open** rather than isolated per file. Nothing leaves your machine – but another local page you open could read it. There is a one-action delete for exactly this reason.

## Status

🚧 Early stage. Planning and technical research are done and live under `_bmad-output/planning-artifacts/`; the product contract is the PRD there. The feature set above describes the goal, not the current state of the code.

## Getting started

1. Download `querbeet.html` (or clone this repository).
2. Open the file in a modern browser. Chromium-based browsers – Chrome and Edge – are the reference; Firefox is a target but secondary.
3. Load your report files and start clicking your pipeline together.

Nothing to install, nothing to configure, and no internet connection needed – not even the first time you open it.

## Roadmap

- [ ] Load CSV, JSON, Excel and Parquet, with encoding detection and a type-confirmation step
- [ ] Pipeline editor: union, join, filter, column edit, computed column, aggregate
- [ ] Result view, export, and a simple dashboard from the consolidated table
- [ ] Recipes: save, load, and hand over, with a pre-flight check against the recipient's files
- [ ] LLM assistance: column profile, prompt block, validated Recipe import, probe queries

## License

TBD

---

*Part of a small family of tools: [korpus](#) (ontology tool) and [dokufix](#) (Markdown reader/editor).*
