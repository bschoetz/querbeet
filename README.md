# querbeet

**Visual ETL in a single HTML file. Reports in, consolidated table out.**

querbeet lets non-BI users build small ETL pipelines by point and click – entirely in the browser. Load a handful of report files, merge and transform them, and export one clean, consolidated table. No server, no installation, no coding.

> The name is a German pun: *querbeet* means "all over the place / criss-cross", with *query* hiding inside.

## Why

Consolidating a few report files shouldn't require a BI professional, a database, or an ETL suite. querbeet aims to cover the everyday case: three exports from different systems in, one consistent table out.

## Features

- **Single HTML file** – download, open in a browser, done. Works offline.
- **Click-together pipelines** – load, join, filter, and transform data without writing code.
- **Multiple input files** – combine several report files (e.g. CSV exports) into one consolidated result.
- **Export** – download the resulting table for further use.

## Status

🚧 Early stage / work in progress. The feature set above describes the goal, not necessarily the current state.

## Getting started

1. Download `querbeet.html` (or clone this repository).
2. Open the file in a modern browser (Chrome, Firefox, Edge).
3. Load your report files and start clicking your pipeline together.

No build step, no dependencies to install. External JS libraries are loaded via CDN.

## Roadmap

- [ ] Core pipeline: load → join/union → filter → export
- [ ] Column mapping and renaming
- [ ] Aggregations (group by)
- [ ] Save and reload pipeline definitions
- [ ] Simple dashboards from the consolidated data

## License

TBD

---

*Part of a small family of tools: [korpus](#) (ontology tool) and [dokufix](#) (Markdown reader/editor).*
