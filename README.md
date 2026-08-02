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

🚧 Early stage — the feature list above describes the goal. Planning and technical research are done and live under `_bmad-output/planning-artifacts/`; the product contract is the PRD there, and the architecture's load-bearing rules are the numbered decisions in `ARCHITECTURE-SPINE.md`.

Two of twenty-three stories are done and a third is in review. What runs today:

- **CSV Sources.** Load files as named, removable Sources. The encoding ladder — BOM, strict UTF-8 probe, Windows-1252 — with a visible override, delimiter and header-row detection you can correct, and structurally damaged rows reported and kept as raw text rather than guessed into alignment.
- **Source preview.** A bounded row window over each Source's parsed table. The counts are always the Source's totals while the DOM holds about fifty rows, and past ~571,000 rows the view pages rather than scrolls, because a spacer taller than roughly 17.2 M px collapses to zero height in Firefox.
- **Typing as Step zero.** A type and, where relevant, a number or date locale proposed per column by reading *every* value — not a sample, which is how comparable engines corrupt large files silently. Where the evidence decides, the deciding count is named — and the count pointing the other way, if there is one; where nothing in a column settles the reading, the interface says exactly that instead of picking, and the Source cannot be confirmed until a person answers. A column whose two readings would give the same number, such as one of plain integers, is not a question and is never asked as one. Free-text annotations per column.

Not yet: the pipeline editor, execution, the Result view, export, Recipes, and the LLM assistance. Sources cannot yet be transformed — only loaded, inspected and typed.

## Getting started

1. Download `querbeet.html` (or clone this repository).
2. Open the file in a modern browser. Chromium-based browsers – Chrome and Edge – are the reference; Firefox is a target but secondary.
3. Load your report files and start clicking your pipeline together.

Nothing to install, nothing to configure, and no internet connection needed – not even the first time you open it.

## Developing

```
npm install
npm run dev       # Vite dev server
npm run build     # emits dist/index.html — and fails unless it is exactly one file
npm run verify    # lint + both Vitest projects + build + Playwright in both engines
```

`npm run verify` is the gate to run before every commit. It takes well under a minute. It is not three independent steps: the Playwright stage runs against `dist/index.html`, so `verify` builds the artefact on its way through and a stale `dist/` can never be what the end-to-end suite tested.

**Three test envelopes, and which code runs in which is a rule rather than a habit** (AD-27):

| Envelope | Covers | Why it is separate |
| --- | --- | --- |
| Vitest, `environment: 'node'` | `core/`, `ports/`, `adapters/` | The absent DOM is the assertion. A core test that needs one means the framework-free core has been broken upstream of the test. |
| Vitest, `environment: 'happy-dom'` | `ui/` components | A `v-if`, a `:disabled` binding, an interpolated German label exist only inside a render function. Reached for last: state derivation belongs in `core/`. |
| Playwright, `file://` | the built `dist/index.html`, Chromium and Firefox | The shipped artefact has an opaque origin and no network. Only opening the real file from a real `file://` URL tests that. |

Under happy-dom, `ResizeObserver` and `getBoundingClientRect` are unimplemented stubs while `scrollTop` is genuine — so a component test can drive a scroll offset and cannot assert layout. Do not debug an observer that "should" fire there. The details, and the upgrade path when a component genuinely needs real geometry, are in `vitest.config.js` and in R10 of `research-plan.md`.

**The build gate is not decorative.** `dist/` must contain exactly one file: nothing may be fetched at runtime, because a `file://` page cannot fetch. A library that lazy-loads its own icons, fonts or worker chunk fails only in the built artefact, never during development.

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
